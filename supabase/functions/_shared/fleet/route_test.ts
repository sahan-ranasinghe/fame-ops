import { assert, assertEquals } from "@std/assert";
import { buildRoute, dropRepeats, positionAt, simplifyKeep, speedClass } from "./route.ts";
import type { Fix } from "./track.ts";

const T0 = Date.parse("2026-10-12T02:30:00Z"); // 08:00 in Colombo
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = 111.32 * Math.cos((6.9 * Math.PI) / 180);
const min = (n: number) => n * 60000;

interface At {
  lat: number;
  lng: number;
  at: number;
}

/** A drive of `km` at `kmh`, a fix every 5 s, north (or east). */
function drive(from: At, km: number, kmh: number, east = false): Fix[] {
  const fixes: Fix[] = [];
  const seconds = (km / kmh) * 3600;
  for (let t = 0; t <= seconds; t += 5) {
    const gone = (kmh / 3600) * t;
    fixes.push({
      at: from.at + t * 1000,
      lat: east ? from.lat : from.lat + gone / KM_PER_DEG_LAT,
      lng: east ? from.lng + gone / KM_PER_DEG_LNG : from.lng,
      accuracyM: 8,
      speedMps: kmh / 3.6,
    });
  }
  return fixes;
}

/** Parked: a fix a minute (the phone's parked rate), a little jitter, no speed. */
function park(where: At, minutes: number, jitterM = 12): Fix[] {
  const fixes: Fix[] = [];
  for (let t = 0; t <= minutes * 60; t += 60) {
    const wobble = Math.sin((t + 20) / 70) * jitterM; // never exactly the place the vehicle arrived at
    fixes.push({ at: where.at + t * 1000, lat: where.lat + wobble / 111320, lng: where.lng, accuracyM: 10, speedMps: 0 });
  }
  return fixes;
}

const endOf = (fixes: Fix[]): At => {
  const last = fixes[fixes.length - 1];
  return { lat: last.lat, lng: last.lng, at: last.at };
};

Deno.test("a day: drive, a stop cut in two by a data gap, drive again", () => {
  const start: At = { lat: 6.9, lng: 79.87, at: T0 };
  const leg1 = drive(start, 20, 40); // 30 min
  const there = endOf(leg1);
  const stop1 = park({ ...there, at: there.at + 60000 }, 29);
  const stop2 = park({ ...there, at: there.at + min(60) }, 30); // nothing between 08:30 and 09:00: no data
  const off = endOf(stop2);
  const leg2 = drive({ lat: off.lat + 0.00002, lng: off.lng, at: off.at + 60000 }, 10, 60); // 10 min
  const r = buildRoute([...leg2, ...stop2, ...stop1, ...leg1]); // any order

  assertEquals(r.segments.map((s) => s.kind), ["driving", "stopped", "no_data", "stopped", "driving"]);
  const [d1, s1, gap, s2, d2] = r.segments;
  assert(Math.abs(d1.km! - 20) < 1, `leg 1 km ${d1.km}`);
  assert(Math.abs(d2.km! - 10) < 1, `leg 2 km ${d2.km}`);
  assert(Math.abs(r.km - 30) < 1.5, `day km ${r.km}`);
  assert(d1.minutes >= 28 && d1.minutes <= 33, `leg 1 ${d1.minutes} min`);
  assertEquals(gap.minutes, 30);
  assert(s1.minutes >= 26 && s1.minutes <= 31 && s2.minutes >= 29 && s2.minutes <= 31, `stops ${s1.minutes} ${s2.minutes}`);
  assertEquals(r.stopsCount, 1, "one stop, cut in two by the gap");
  assertEquals(r.gaps.length, 1);
  assert(r.drivingMinutes >= 38 && r.drivingMinutes <= 44, `driving ${r.drivingMinutes}`);
  assert(r.stoppedMinutes >= 55 && r.stoppedMinutes <= 62, `stopped ${r.stoppedMinutes}`);
  assertEquals(r.repeats, 0);

  // Two straight legs and a wait: a handful of points, the wait kept as two points at the same place.
  assert(r.line.length < 20, `line has ${r.line.length} points`);
  const waits = r.line.filter((p, i) => i > 0 && p.lat === r.line[i - 1].lat && p.lng === r.line[i - 1].lng);
  assert(waits.length >= 1, "a wait marks the stop");
  assert(waits.some((w) => Math.abs(w.at - off.at) < min(2)), "the wait ends when the vehicle leaves");
  assertEquals(r.line[0].at, leg1[0].at);
  assert(r.line[r.line.length - 1].at >= leg2[leg2.length - 2].at, "the line ends at the last accepted position");
  assert(r.line.slice(1).some((p) => p.kmh >= 35 && p.kmh <= 45), "the speed of a 40 km/h step");
});

Deno.test("a gap between two drives is a no_data row, no stop", () => {
  const leg1 = drive({ lat: 7.0, lng: 80.0, at: T0 }, 5, 50);
  const there = endOf(leg1);
  const leg2 = drive({ lat: there.lat + 0.05, lng: there.lng, at: there.at + min(20) }, 5, 50);
  const r = buildRoute([...leg1, ...leg2]);
  assertEquals(r.segments.map((s) => s.kind), ["driving", "no_data", "driving"]);
  assertEquals(r.stopsCount, 0);
  assertEquals(r.gaps[0].minutes, 20);
});

Deno.test("the line keeps a corner", () => {
  const north = drive({ lat: 6.9, lng: 79.87, at: T0 }, 5, 40);
  const corner = endOf(north);
  const east = drive({ ...corner, at: corner.at + 5000 }, 5, 40, true);
  const r = buildRoute([...north, ...east]);
  assert(r.line.length <= 6, `line has ${r.line.length} points`);
  assert(r.line.some((p) => Math.abs(p.lat - corner.lat) < 0.0005 && Math.abs(p.lng - corner.lng) < 0.0005), "the corner is a point");
});

Deno.test("Douglas–Peucker keeps the ends, drops jitter on a straight run, keeps a corner", () => {
  const straight = [0, 1, 2, 3, 4].map((i) => ({ lat: 6.9 + (i % 2) * 0.00003, lng: 79.8 + i * 0.01 }));
  assertEquals(simplifyKeep(straight, 12), [true, false, false, false, true]);
  const corner = [{ lat: 6.9, lng: 79.8 }, { lat: 6.91, lng: 79.8 }, { lat: 6.92, lng: 79.8 }, { lat: 6.92, lng: 79.81 }, {
    lat: 6.92,
    lng: 79.82,
  }];
  assertEquals(simplifyKeep(corner, 12), [true, false, true, false, true]);
  assertEquals(simplifyKeep(corner.slice(0, 2), 12), [true, true]);
  assertEquals(simplifyKeep([], 12), []);
});

Deno.test("a cached fix delivered again is dropped before anything looks at it", () => {
  const parked = park({ lat: 6.9575, lng: 79.8941, at: T0 }, 10);
  // No GPS for three minutes: the phone hands over the cell tower's position again and again.
  const tower: Fix = { at: T0 + min(11), lat: 6.9585879, lng: 79.8939055, accuracyM: 100, speedMps: 0 };
  const again = { ...tower, at: tower.at + 60000 };
  const andAgain = { ...tower, at: tower.at + 120000 };
  const r = buildRoute([...parked, tower, again, andAgain, ...park({ lat: 6.9575, lng: 79.8941, at: T0 + min(15) }, 3)]);
  assertEquals(r.repeats, 2);
  assertEquals(r.usable, parked.length + 4, "the tower fix (100 m) is not usable either");
  assert(!r.line.some((p) => p.lat === tower.lat), "the tower never appears on the line");
  assertEquals(dropRepeats([tower, again, { ...tower, at: tower.at + 5, lat: 6.96 }]).fixes.length, 2);
});

Deno.test("no fixes: an empty route", () => {
  const r = buildRoute([]);
  assertEquals(r.segments, []);
  assertEquals(r.line, []);
  assertEquals(r.km, 0);
  assertEquals(r.firstAt, null);
});

Deno.test("positionAt interpolates by time and holds the ends", () => {
  const line = [{ at: 0, lat: 6.9, lng: 79.8, kmh: 0 }, { at: 10000, lat: 6.91, lng: 79.8, kmh: 40 }, {
    at: 20000,
    lat: 6.91,
    lng: 79.81,
    kmh: 36,
  }];
  const mid = positionAt(line, 5000)!;
  assert(Math.abs(mid.lat - 6.905) < 1e-9 && mid.kmh === 40);
  assertEquals(positionAt(line, -5), { lat: 6.9, lng: 79.8, kmh: 0 });
  assertEquals(positionAt(line, 99999), { lat: 6.91, lng: 79.81, kmh: 0 });
  assertEquals(positionAt([], 0), null);
});

Deno.test("speed classes", () => {
  assertEquals([0, 2.9, 3, 19, 20, 59, 60, 120].map(speedClass), [
    "stopped",
    "stopped",
    "slow",
    "slow",
    "normal",
    "normal",
    "fast",
    "fast",
  ]);
});
