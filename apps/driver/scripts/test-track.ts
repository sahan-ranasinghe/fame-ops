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

import { isMoving, type PhoneFix, recordable, type RecordingState, zeroCounts } from '../src/lib/recording';
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
const connectorCopy = readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fleet', 'track.ts'), 'utf8');
check(appCopy === connectorCopy, 'the connector has the same track.ts as the app');

// --- 4. what the phone stores (src/lib/recording.ts) ---------------------------
// Store raw, filter on the server: every fix of 150 m or better is stored unless
// it is a jump, a repeat, or the vehicle stands still (within a fixed 10 m of the
// anchor and under 10 m of movement added up; then one a minute).
const phone = (fixes: Fix[], heading: number | null = null): PhoneFix[] => fixes.map((f) => ({ ...f, heading, mocked: false }));
const freshRecord = (): RecordingState => ({ state: newTrack(), lastKeptAt: 0, lastStored: null, anchor: null, lastRaw: null, taskKm: 0, odometerKm: 0, counters: zeroCounts() });
/** Android hands fixes to the app in batches of up to 15 s: feed them that way. */
function deliver(rec: RecordingState, fixes: PhoneFix[], batchMs = 15_000): PhoneFix[] {
  const kept: PhoneFix[] = [];
  const ordered = [...fixes].sort((a, b) => a.at - b.at);
  let batch: PhoneFix[] = [];
  for (const fix of ordered) {
    if (batch.length && fix.at - batch[0].at >= batchMs) {
      kept.push(...recordable(rec, batch));
      batch = [];
    }
    batch.push(fix);
  }
  if (batch.length) kept.push(...recordable(rec, batch));
  return kept;
}
const BASE = { lat: 6.9575, lng: 79.8941, at: Date.parse('2026-10-12T08:00:00+05:30') };
/** Walking at `kmh` with a fix every 5 s and the speed the phone reports, `accuracyM` metres. */
function walk(from: { lat: number; lng: number; at: number }, minutes: number, kmh: number, accuracyM = 8): Fix[] {
  const fixes: Fix[] = [];
  for (let t = 0; t <= minutes * 60; t += 5) {
    fixes.push({ at: from.at + t * 1000, lat: from.lat + ((kmh / 3600) * t) / KM_PER_DEG_LAT, lng: from.lng, accuracyM, speedMps: kmh / 3.6 });
  }
  return fixes;
}
{
  // Driving: every fix is stored (no waiting for a confirming fix), with its heading.
  const rec = freshRecord();
  const fixes = drive(BASE, 2, 40);
  const kept = deliver(rec, phone(fixes, 10));
  check(kept.length === fixes.length, `driving: every one of ${fixes.length} fixes stored (${kept.length})`, kept.length);
  check(kept.every((f) => f.heading === 10), 'driving: the heading is stored');
  check(rec.taskKm > 1.9 && rec.taskKm < 2.1, 'driving: the km counter follows', rec.taskKm);
  check(rec.counters?.stored === fixes.length && rec.counters?.seen === fixes.length, 'driving: the counters say seen = stored', rec.counters);
}
{
  // Walking at 4 km/h (1.1 m/s, about 5.5 m per fix): a point every 10–15 m (the first fix over 10 m from the anchor), and the rules say moving.
  const rec = freshRecord();
  const fixes = walk(BASE, 5, 4);
  const kept = deliver(rec, phone(fixes));
  const gaps = kept.slice(1).map((f, i) => stepM(kept[i], f));
  check(gaps.length > 0 && gaps.every((g) => g >= 10 && g <= 15), `walking at 4 km/h: a point every 10–15 m (${kept.length} of ${fixes.length} fixes; gaps ${Math.min(...gaps).toFixed(1)}–${Math.max(...gaps).toFixed(1)} m)`, gaps.slice(0, 5));
  check(kept.length >= fixes.length / 2 - 1 && kept.length <= fixes.length / 2 + 1, 'walking: about every second fix', kept.length);
  check(isMoving(rec), 'walking: the rules say moving');
  // A slow wander (1.2 m a fix, back and forth inside the radius): the movement added up passes 10 m about every ninth fix, and that fix is stored.
  const rec2 = freshRecord();
  const wander: Fix[] = [];
  for (let i = 0; i <= 120; i++) wander.push({ at: BASE.at + i * 5000, lat: BASE.lat + ((i % 2) * 1.2) / 111320, lng: BASE.lng, accuracyM: 6, speedMps: 0.3 });
  const kept2 = deliver(rec2, phone(wander));
  check(kept2.length >= 11 && kept2.length <= 16, `a slow wander of 1.2 m a fix: a point about every ninth fix from the added-up movement (${kept2.length} of ${wander.length})`, kept2.length);
}
{
  // A parked car: fixes every 5 s with the small wobble a standing GPS shows (half a metre): one point a minute (the
  // heartbeat point), the rest is jitter, and the rules say standing.
  const rec = freshRecord();
  const kept = deliver(rec, phone(park(BASE, 3, 0.5)));
  check(kept.length >= 3 && kept.length <= 5, `parked 3 min: ${kept.length} points (one a minute)`, kept.length);
  check((rec.counters?.dropped_jitter ?? 0) > 25, 'parked: the rest is counted as jitter', rec.counters);
  check(!isMoving(rec), 'parked: the rules say standing');
  // Leaving: the first fix over 10 m from the anchor is stored at once and becomes the anchor.
  const away = { at: BASE.at + 181_000, lat: BASE.lat + 15 / 111320, lng: BASE.lng, accuracyM: 8, speedMps: 0 };
  const left = recordable(rec, phone([away]));
  check(left.length === 1 && isMoving(rec) && Math.abs((rec.anchor?.lat ?? 0) - away.lat) < 1e-9, 'leaving: the first fix 15 m away is stored at once, speed or not, and is the new anchor', left.length);
  // No speed test: a fix 3 m from the anchor is still, whatever speed it reports.
  const rec2 = freshRecord();
  deliver(rec2, phone(park(BASE, 2, 0.5)));
  const rolling = { at: BASE.at + 121_000, lat: BASE.lat + 3 / 111320, lng: BASE.lng, accuracyM: 8, speedMps: 1.5 };
  check(recordable(rec2, phone([rolling])).length === 0, 'no speed test: a fix 3 m from the anchor is still, whatever speed it reports');
  // A phone whose fixes wobble 8 m while parked: the wobble adds up to movement under the fixed 10 m rule, so more than one a minute.
  const rec3 = freshRecord();
  const wobbly = deliver(rec3, phone(park(BASE, 3, 8)));
  check(wobbly.length > 5, `parked with an 8 m wobble: ${wobbly.length} points in 3 min (the wobble counts as movement; the server's filter removes it)`, wobbly.length);
}
{
  // The radius is a fixed 10 m, never widened by the accuracy: a 30 m fix 8 m from the anchor is still; one 20 m away is stored.
  const rec = freshRecord();
  recordable(rec, phone([{ ...BASE, accuracyM: 30, speedMps: 0 }]));
  const near = recordable(rec, phone([{ at: BASE.at + 5000, lat: BASE.lat + 8 / 111320, lng: BASE.lng, accuracyM: 30, speedMps: 0 }]));
  const far = recordable(rec, phone([{ at: BASE.at + 10000, lat: BASE.lat + 20 / 111320, lng: BASE.lng, accuracyM: 30, speedMps: 0 }]));
  check(near.length === 0 && far.length === 1, 'the still radius is a fixed 10 m around the anchor, whatever the accuracy', { near: near.length, far: far.length });
}
{
  // Accuracy: 150 m is stored, 151 m is not; the counters say why.
  const rec = freshRecord();
  const kept = deliver(rec, phone([
    { ...BASE, accuracyM: 150, speedMps: 0 },
    { at: BASE.at + 5000, lat: BASE.lat + 0.002, lng: BASE.lng, accuracyM: 151, speedMps: 0 },
    { at: BASE.at + 10000, lat: BASE.lat + 0.004, lng: BASE.lng, accuracyM: 800, speedMps: 0 },
  ]));
  check(kept.length === 1 && kept[0].accuracyM === 150, 'accuracy: 150 m stored, worse dropped', kept.map((f) => f.accuracyM));
  check(rec.counters?.dropped_accuracy === 2, 'accuracy: two counted as dropped_accuracy', rec.counters);
}
{
  // A jump: a fix that would need over 150 km/h from the last stored one is dropped; three in a row that agree win.
  const rec = freshRecord();
  const leg = drive(BASE, 1, 40);
  deliver(rec, phone(leg));
  const lastLeg = last(leg);
  const tower = { at: lastLeg.at + 5000, lat: lastLeg.lat + 0.02, lng: lastLeg.lng, accuracyM: 120, speedMps: 0 }; // 2.2 km in 5 s
  check(recordable(rec, phone([tower])).length === 0 && rec.counters?.dropped_jump === 1, 'a jump is dropped and counted', rec.counters);
  const back = { at: lastLeg.at + 10000, lat: lastLeg.lat + 0.0005, lng: lastLeg.lng, accuracyM: 8, speedMps: 11 };
  check(recordable(rec, phone([back])).length === 1, 'the next real fix is stored');
  // The phone really is far away (the stored fix was wrong): three fixes agreeing with each other are taken from the third on.
  const rec2 = freshRecord();
  recordable(rec2, phone([{ at: BASE.at, lat: 7.3, lng: 80.6, accuracyM: 20, speedMps: 0 }])); // a stale fix in Kandy
  const real = drive({ ...BASE, at: BASE.at + 5000 }, 0.2, 40);
  const kept = deliver(rec2, phone(real));
  check(kept.length === real.length - 2, `a wrong stored fix: recording goes on from the third agreeing fix (${kept.length} of ${real.length})`, kept.length);
}
{
  // The same cached location delivered again (identical coordinates, no speed) within a minute of the last point is a duplicate.
  const rec = freshRecord();
  const first = recordable(rec, phone([{ at: BASE.at, lat: 6.9575, lng: 79.8941, accuracyM: 10, speedMps: 0 }]));
  const repeats: Fix[] = [];
  for (let s = 5; s <= 55; s += 5) repeats.push({ at: BASE.at + s * 1000, lat: 6.9575, lng: 79.8941, accuracyM: 10, speedMps: 0 });
  const kept = deliver(rec, phone(repeats));
  check(first.length === 1 && kept.length === 0 && rec.counters?.dropped_duplicate === repeats.length, 'identical repeats within a minute are duplicates', rec.counters);
  // A minute later the same coordinates are stored once (the heartbeat point): the office keeps seeing the phone.
  const later = recordable(rec, phone([{ at: BASE.at + 65_000, lat: 6.9575, lng: 79.8941, accuracyM: 10, speedMps: 0 }]));
  check(later.length === 1, 'after a minute the repeated place is stored once more', later.length);
}
{
  // The real indoor recording (47 minutes standing still, accuracy all over the place): the scatter counts as movement
  // under the fixed 10 m rule, so many of its fixes are stored; the server's filter (part 1 above) removes the phantom km.
  const rec = freshRecord();
  const kept = deliver(rec, phone(indoor));
  const minutesIndoors = (indoor[indoor.length - 1].at - indoor[0].at) / 60000;
  check(kept.length <= indoor.length, `indoors for ${Math.round(minutesIndoors)} min: ${kept.length} of ${indoor.length} fixes stored (the scatter counts as movement; the server's filter removes it)`, kept.length);
  check(kept.every((f) => (f.accuracyM ?? 0) <= 150), 'indoors: nothing worse than 150 m stored');
}
{
  // Mock locations are stored and marked, never dropped.
  const rec = freshRecord();
  const kept = recordable(rec, [{ ...BASE, accuracyM: 5, speedMps: 0, heading: null, mocked: true }]);
  check(kept.length === 1 && kept[0].mocked, 'a mock fix is stored with its flag');
}

console.log(failures === 0 ? '\nAll track tests passed.' : `\n${failures} track test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

function stepM(a: Fix, b: Fix): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
