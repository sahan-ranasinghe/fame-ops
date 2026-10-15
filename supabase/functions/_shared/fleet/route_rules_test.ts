// The route rules added for route quality (October 2026): outliers, display
// smoothing, gap kinds from heartbeats, late uploads, holes, poor fixes, and
// that the km never change with any of it.
import { assert, assertEquals } from "@std/assert";
import {
  buildRoute,
  dropOutliers,
  gapParts,
  holesOf,
  insertByTime,
  lateWindows,
  type LinePoint,
  type RouteFix,
  smoothLine,
} from "./route.ts";
import { distanceM, type Fix } from "./track.ts";

const T0 = Date.parse("2026-10-14T02:30:00Z"); // 08:00 in Colombo
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = 111.32 * Math.cos((6.9 * Math.PI) / 180);
const min = (n: number) => n * 60000;

interface At {
  lat: number;
  lng: number;
  at: number;
}

/** A drive of `km` at `kmh`, a fix every 5 s, north (or east). */
function drive(from: At, km: number, kmh: number, east = false, accuracyM = 8): RouteFix[] {
  const fixes: RouteFix[] = [];
  const seconds = (km / kmh) * 3600;
  for (let t = 0; t <= seconds; t += 5) {
    const gone = (kmh / 3600) * t;
    fixes.push({
      at: from.at + t * 1000,
      lat: east ? from.lat : from.lat + gone / KM_PER_DEG_LAT,
      lng: east ? from.lng + gone / KM_PER_DEG_LNG : from.lng,
      accuracyM,
      speedMps: kmh / 3.6,
    });
  }
  return fixes;
}

/** Parked: a fix a minute (the phone's parked rate), a little jitter, no speed. */
function park(where: At, minutes: number, jitterM = 12, accuracyM = 10): RouteFix[] {
  const fixes: RouteFix[] = [];
  for (let t = 0; t <= minutes * 60; t += 60) {
    const wobble = Math.sin((t + 20) / 70) * jitterM;
    fixes.push({ at: where.at + t * 1000, lat: where.lat + wobble / 111320, lng: where.lng, accuracyM, speedMps: 0 });
  }
  return fixes;
}

const endOf = (fixes: Fix[]): At => {
  const last = fixes[fixes.length - 1];
  return { lat: last.lat, lng: last.lng, at: last.at };
};
const everyMinute = (from: number, to: number) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += 60000) out.push(t);
  return out;
};

Deno.test("outliers: a tower jump for one fix is dropped, the drive around it stays", () => {
  const leg = drive({ lat: 6.9, lng: 79.9, at: T0 }, 3, 40);
  const i = Math.floor(leg.length / 2);
  const jumped = [...leg];
  jumped.splice(i, 0, { ...leg[i], at: leg[i].at - 2500, lng: leg[i].lng + 0.02, accuracyM: 120 }); // 2.2 km east for 2.5 s
  const r = dropOutliers(jumped);
  assertEquals(r.dropped, 1);
  assertEquals(r.fixes.length, leg.length);
  assert(!r.fixes.some((f) => f.accuracyM === 120));
});

Deno.test("outliers: an out-and-back spike while parked is dropped; the wobble is not", () => {
  const parked = park({ lat: 6.9575, lng: 79.8941, at: T0 }, 10);
  const spiked = [...parked];
  spiked.splice(5, 0, { ...parked[5], at: parked[5].at + 30000, lng: parked[5].lng + 0.0006, accuracyM: 8 }); // 66 m east, 30 s
  const r = dropOutliers(spiked);
  assertEquals(r.dropped, 1, "the spike");
  assertEquals(dropOutliers(parked).dropped, 0, "12 m of wobble is under the spike size");
});

Deno.test("outliers: a legitimate expressway speed is kept whole; a sharp corner at 40 km/h too", () => {
  const fast = drive({ lat: 7.0, lng: 80.0, at: T0 }, 10, 110);
  assertEquals(dropOutliers(fast).dropped, 0);
  const north = drive({ lat: 6.9, lng: 79.87, at: T0 }, 1, 40);
  const corner = endOf(north);
  const east = drive({ ...corner, at: corner.at + 5000 }, 1, 40, true);
  assertEquals(dropOutliers([...north, ...east]).dropped, 0);
});

Deno.test("outliers: a wrong first fix is dropped once three fixes in a row agree against it", () => {
  const stale: RouteFix = { at: T0 - 10000, lat: 7.3, lng: 80.6, accuracyM: 20, speedMps: 0 }; // Kandy, 100 km away
  const leg = drive({ lat: 6.9, lng: 79.9, at: T0 }, 1, 40);
  const r = dropOutliers([stale, ...leg]);
  assertEquals(r.dropped, 1);
  assertEquals(r.fixes[0].at, leg[0].at);
});

Deno.test("smoothing keeps a corner (moved by less than its accuracy) and takes wobble out of a straight run", () => {
  const north = drive({ lat: 6.9, lng: 79.87, at: T0 }, 0.5, 40);
  const corner = endOf(north);
  const east = drive({ ...corner, at: corner.at }, 0.5, 40, true).slice(1); // the next fix is already heading east
  const line: LinePoint[] = [...north, ...east].map((f) => ({ at: f.at, lat: f.lat, lng: f.lng, kmh: 40, acc: f.accuracyM }));
  const smooth = smoothLine(line);
  const ci = north.length - 1;
  assert(distanceM(line[ci], smooth[ci]) < 8, `the corner moved ${distanceM(line[ci], smooth[ci])} m`);
  assert(distanceM(line[ci], smooth[ci]) > 0.5, "but it did move a little towards the inside");

  // Wobble of ±6 m across a straight northward run: after smoothing the lateral spread is smaller.
  const wobbly = north.map((f, i) => ({ at: f.at, lat: f.lat, lng: f.lng + ((i % 2 ? 6 : -6) / 111320), kmh: 40, acc: 8 }));
  const spread = (l: LinePoint[]) => l.slice(1, -1).reduce((s, p) => s + Math.abs(p.lng - 79.87) * 111320, 0) / (l.length - 2);
  assert(spread(smoothLine(wobbly)) < spread(wobbly) / 2, `spread ${spread(smoothLine(wobbly))} vs ${spread(wobbly)}`);
  // The ends and the two points of a wait never move.
  const wait: LinePoint[] = [
    { at: 0, lat: 6.9, lng: 79.8, kmh: 0, acc: 8 },
    { at: 60000, lat: 6.9, lng: 79.8, kmh: 0, acc: 8 },
    { at: 120000, lat: 6.901, lng: 79.8, kmh: 30, acc: 8 },
  ];
  assertEquals(smoothLine(wait).map((p) => [p.lat, p.lng]), wait.map((p) => [p.lat, p.lng]));
});

Deno.test("gap kinds: heartbeats present → no_gps; none → no_data; heartbeats that stop part way → both", () => {
  const from = T0, to = T0 + min(20);
  assertEquals(gapParts(from, to, everyMinute(from, to)), [{ from, to, kind: "no_gps" }]);
  assertEquals(gapParts(from, to, []), [{ from, to, kind: "no_data" }]);
  const parts = gapParts(from, to, everyMinute(from, from + min(8)));
  assertEquals(parts.map((p) => p.kind), ["no_gps", "no_data"]);
  assertEquals(parts[0].to, from + min(8));
  assertEquals(parts[1].to, to);
});

Deno.test("timeline: a gap with heartbeats is 'no_gps', without them 'no_data'; the gaps list says which", () => {
  const leg1 = drive({ lat: 7.0, lng: 80.0, at: T0 }, 5, 50);
  const there = endOf(leg1);
  const leg2 = drive({ lat: there.lat + 0.05, lng: there.lng, at: there.at + min(20) }, 5, 50);
  const alive = buildRoute([...leg1, ...leg2], { heartbeats: everyMinute(there.at, there.at + min(20)) });
  assertEquals(alive.segments.map((s) => s.kind), ["driving", "no_gps", "driving"]);
  assertEquals(alive.gaps[0].kind, "no_gps");
  const dead = buildRoute([...leg1, ...leg2]);
  assertEquals(dead.segments.map((s) => s.kind), ["driving", "no_data", "driving"]);
  assertEquals(dead.gaps[0].kind, "no_data");
});

Deno.test("late uploads: the stretch that landed over 5 minutes late is its own driving piece saying when it landed", () => {
  const leg = drive({ lat: 6.9, lng: 79.9, at: T0 }, 20, 40); // 30 min
  const offlineFrom = T0 + min(10), offlineTo = T0 + min(20), landed = T0 + min(30); // data came back at 08:30
  const withReceipt = leg.map((f) => ({
    ...f,
    receivedAt: f.at >= offlineFrom && f.at <= offlineTo ? landed : f.at + 20000,
  }));
  const windows = lateWindows(withReceipt);
  assertEquals(windows.length, 1);
  assertEquals(windows[0].uploadedAt, landed);
  const r = buildRoute(withReceipt);
  assertEquals(r.segments.map((s) => s.kind), ["driving", "driving", "driving"]);
  assertEquals(r.segments.map((s) => s.uploadedAt ?? null), [null, landed, null]);
  const total = r.segments.reduce((s, x) => s + (x.km ?? 0), 0);
  assert(Math.abs(total - r.km) < 0.2, `pieces ${total} km vs ${r.km} km`);
  assert(r.segments[1].minutes >= 9 && r.segments[1].minutes <= 11, `offline piece ${r.segments[1].minutes} min`);
  assertEquals(buildRoute(leg).late, [], "nothing late when received_at is unknown");
});

Deno.test("km come from the raw points: smoothing and the thinning tolerance change the line, never the km", () => {
  const leg1 = drive({ lat: 6.9, lng: 79.87, at: T0 }, 8, 45);
  const corner = endOf(leg1);
  const leg2 = drive({ ...corner, at: corner.at + 5000 }, 4, 30, true);
  const fixes = [...leg1, ...leg2].map((f, i) => ({ ...f, lng: f.lng + ((i % 3) - 1) * 0.00004 })); // ±4 m wobble
  const a = buildRoute(fixes);
  const b = buildRoute(fixes, { smooth: false });
  const c = buildRoute(fixes, { simplifyM: 3, maxPoints: 3000 });
  assertEquals(a.km, b.km);
  assertEquals(a.km, c.km);
  assert(Math.abs(a.km - 12) < 0.5, `km ${a.km}`);
  assert(c.pointsShown > a.pointsShown, `3 m keeps more points (${c.pointsShown}) than 12 m (${a.pointsShown})`);
  assertEquals(a.pointsStored, fixes.length);
  assert(c.pointsShown <= 3000);
});

Deno.test("holes: over 2 minutes between two places is a hole (dashed on the map); a wait is not", () => {
  const line: LinePoint[] = [
    { at: T0, lat: 6.9, lng: 79.8, kmh: 0, acc: 8 },
    { at: T0 + min(1), lat: 6.9, lng: 79.8, kmh: 0, acc: 8 }, // a wait: same place
    { at: T0 + min(6), lat: 6.92, lng: 79.8, kmh: 15, acc: 8 }, // 5 minutes with nothing in between
    { at: T0 + min(7), lat: 6.925, lng: 79.8, kmh: 33, acc: 8 },
  ];
  const holes = holesOf(line, everyMinute(T0, T0 + min(7)));
  assertEquals(holes.length, 1);
  assertEquals(holes[0].minutes, 5);
  assertEquals(holes[0].kind, "no_gps");
  assertEquals(holesOf(line)[0].kind, "no_data");
  // The thinning keeps both ends of the hole, so the dashed segment stays where it belongs.
  const leg = drive({ lat: 6.9, lng: 79.8, at: T0 }, 2, 40);
  const later = drive({ lat: endOf(leg).lat + 0.02, lng: 79.8, at: endOf(leg).at + min(5) }, 2, 40);
  const r = buildRoute([...leg, ...later]);
  assertEquals(r.holes.length, 1);
  assert(r.line.some((p) => p.at === r.holes[0].from) && r.line.some((p) => p.at === r.holes[0].to));
});

Deno.test("poor fixes (50–150 m) fill a stretch with no precise fix, drawn with their accuracy, and never count km", () => {
  const leg1 = drive({ lat: 6.9, lng: 79.9, at: T0 }, 5, 40);
  const there = endOf(leg1);
  // 12 minutes through an urban canyon: moving, but every fix is 80 m (the phone stores them, the km filter ignores them).
  const canyon = drive({ ...there, at: there.at + 5000 }, 6, 30, false, 80).slice(1)
    .map((f, i) => ({ ...f, lng: f.lng + (Math.sin(i / 1.3) * 5) / 111320 })); // a little wobble, as real fixes have
  const out = endOf(canyon);
  const leg2 = drive({ ...out, at: out.at + 5000 }, 5, 40).slice(1);
  // Thinned hardly at all here, so the points can be counted (12 m would rightly leave only the ends of a straight run).
  const r = buildRoute([...leg1, ...canyon, ...leg2], { heartbeats: everyMinute(there.at, out.at), simplifyM: 1 });
  const poor = r.line.filter((p) => (p.acc ?? 0) > 50);
  assert(poor.length >= 10, `the canyon is on the line (${poor.length} points)`);
  assert(poor.every((p) => p.acc === 80));
  // The km: the two precise legs, plus the straight line across the canyon (as before: poor fixes never count).
  assert(Math.abs(r.km - 16) < 0.5, `km ${r.km}`);
  assert(r.segments.some((s) => s.kind === "no_gps"), r.segments.map((s) => s.kind).join(","));
  assertEquals(r.usable, leg1.length + leg2.length);
  // A parked phone indoors with 80 m fixes within 80 m of where it stopped adds nothing to the line.
  const indoors = park({ ...there, at: there.at + min(1) }, 28, 20, 80);
  const r2 = buildRoute([...leg1, ...indoors]);
  assertEquals(r2.line.filter((p) => (p.acc ?? 0) > 50).length, 0);
});

Deno.test("insertByTime puts a late point where it belongs and recomputes the speeds around it", () => {
  const line: LinePoint[] = [
    { at: 0, lat: 6.9, lng: 79.8, kmh: 0, acc: 8 },
    { at: 20000, lat: 6.902, lng: 79.8, kmh: 40, acc: 8 },
  ];
  const out = insertByTime(line, { at: 10000, lat: 6.901, lng: 79.8, kmh: 0, acc: 8 });
  assertEquals(out.map((p) => p.at), [0, 10000, 20000]);
  assertEquals(out[1].kmh, 40);
  assertEquals(out[2].kmh, 40);
  assertEquals(insertByTime(out, { at: 10000, lat: 6.95, lng: 79.8, kmh: 0 }), out, "a point already there is ignored");
  assertEquals(insertByTime(out, { at: 30000, lat: 6.903, lng: 79.8, kmh: 0, acc: 8 }).length, 4);
});
