// Tests of the GPS drift filter (src/lib/track.ts). Pure code, no stack needed:
//
//   npm run test:track          (from apps/driver)
//
// 1. The real indoor recording from 8 October 2026 (a phone standing still for
//    47 minutes that "travelled" 11.6 km before the filter) must come out as
//    almost no distance and one long stop.
// 2. Made-up drives: distance within a few percent, jumps and bad fixes
//    ignored, a parked period found as a stop.
// 3. The connector's copy of the file is identical to the app's.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Fix, newTrack, step, summarise } from '../src/lib/track';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

// --- 1. the real indoor recording ------------------------------------------
interface Fixture {
  points: [string, number, number, number | null, number | null][];
}
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'indoor-still-2026-10-08.json'), 'utf8')) as Fixture;
const indoor: Fix[] = fixture.points.map(([at, lat, lng, accuracyM, speedMps]) => ({
  at: new Date(at).getTime(),
  lat,
  lng,
  accuracyM,
  speedMps,
}));

const naive = indoor.reduce((sum, p, i) => (i === 0 ? 0 : sum + stepM(indoor[i - 1], p)), 0) / 1000;
const still = summarise(indoor);
check(naive > 10, `the raw indoor points sum to ${naive.toFixed(1)} km of phantom movement`, naive);
check(still.km <= 0.3, `after the filter the same phone moved ${still.km} km (at most 0.3)`, still);
check(
  still.stops.length === 1 && still.stops[0].minutes >= 25,
  `and one stop of ${still.stops[0]?.minutes ?? 0} minutes is found (none was found before)`,
  still.stops,
);

// --- 2. made-up drives --------------------------------------------------------
const START = Date.parse('2026-10-08T03:00:00Z');
const KM_PER_DEG_LAT = 111.32;

/** Fixes every 5 s along a straight line heading north at `kmh`, starting at `from`. */
function drive(from: { lat: number; lng: number; at: number }, km: number, kmh: number, accuracyM = 8): Fix[] {
  const fixes: Fix[] = [];
  const seconds = (km / kmh) * 3600;
  for (let t = 0; t <= seconds; t += 5) {
    fixes.push({
      at: from.at + t * 1000,
      lat: from.lat + (((kmh / 3600) * t) / KM_PER_DEG_LAT),
      lng: from.lng,
      accuracyM,
      speedMps: kmh / 3.6,
    });
  }
  return fixes;
}

/** Fixes every 5 s standing at `where` for `minutes`, with a little GPS jitter and no speed. */
function park(where: { lat: number; lng: number; at: number }, minutes: number, jitterM = 12): Fix[] {
  const fixes: Fix[] = [];
  for (let t = 0; t <= minutes * 60; t += 5) {
    const wobble = Math.sin(t / 7) * jitterM;
    fixes.push({ at: where.at + t * 1000, lat: where.lat + wobble / 111320, lng: where.lng, accuracyM: 10, speedMps: 0 });
  }
  return fixes;
}

const last = (fixes: Fix[]) => fixes[fixes.length - 1];
const leg1 = drive({ lat: 6.9, lng: 79.9, at: START }, 10, 60);
const parked = park({ ...last(leg1), at: last(leg1).at + 5000 }, 15);
const leg2 = drive({ ...last(parked), at: last(parked).at + 5000 }, 5, 40);
const trip = summarise([...leg1, ...parked, ...leg2]);
check(Math.abs(trip.km - 15) <= 0.3, `10 km drive, 15 min parked, 5 km drive = ${trip.km} km (15 ± 0.3)`, trip.km);
check(trip.stops.length === 1 && Math.abs(trip.stops[0].minutes - 15) <= 1, `with one stop of ${trip.stops[0]?.minutes} minutes`, trip.stops);

// A phone that jumps 5 km for one fix and comes back.
const jumpAt = Math.floor(leg1.length / 2);
const jumped = [...leg1];
jumped.splice(jumpAt, 0, { ...leg1[jumpAt], at: leg1[jumpAt].at - 2500, lng: leg1[jumpAt].lng + 0.045 });
check(Math.abs(summarise(jumped).km - summarise(leg1).km) < 0.01, 'a 5 km jump for one fix adds nothing', summarise(jumped).km);

// Fixes with a poor accuracy in the middle of a drive are ignored, the rest still adds up.
const noisy = leg1.map((fix, i) => (i % 4 === 2 ? { ...fix, accuracyM: 120, lat: fix.lat + 0.003 } : fix));
check(Math.abs(summarise(noisy).km - 10) <= 0.3, `bad-accuracy fixes are skipped: ${summarise(noisy).km} km of 10`, summarise(noisy).km);

// Confident but wrong fixes while parked (Wi-Fi positioning) add nothing without a speed.
const wifi = park({ lat: 7.0, lng: 80.0, at: START }, 20).map((fix, i) =>
  i % 9 === 0 ? { ...fix, lat: fix.lat + 0.004, accuracyM: 15 } : fix,
);
const wifiSum = summarise(wifi);
check(wifiSum.km === 0 && wifiSum.stops.length === 1, 'wrong Wi-Fi fixes (450 m off, speed 0) while parked add nothing', wifiSum);

// Step by step, the same answer as all at once.
const state = newTrack();
for (const fix of [...leg1, ...parked, ...leg2]) step(state, fix);
check(Math.abs(state.metres / 1000 - trip.km) < 0.1, 'feeding fixes one by one gives the same distance', state.metres);

// --- 3. the two copies are the same file ---------------------------------------
const appCopy = readFileSync(join(here, '..', 'src', 'lib', 'track.ts'), 'utf8');
const connectorCopy = readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', 'office-mcp', 'track.ts'), 'utf8');
check(appCopy === connectorCopy, 'the connector has the same track.ts as the app');

console.log(failures === 0 ? '\nAll track tests passed.' : `\n${failures} track test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

function stepM(a: Fix, b: Fix): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
