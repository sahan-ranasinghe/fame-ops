// Tests of the GPS drift filter as the connector uses it.
//   deno test geo_test.ts     (the README runs it in Docker)
// The fuller test, on the real indoor recording, is apps/driver/scripts/test-track.ts.

import { assert, assertEquals } from "@std/assert";
import { type Point, summariseRoute } from "./geo.ts";

const START = Date.parse("2026-10-08T03:00:00Z");
const KM_PER_DEG_LAT = 111.32;

function drive(
  from: { lat: number; lng: number; at: number },
  km: number,
  kmh: number,
): Point[] {
  const points: Point[] = [];
  const seconds = (km / kmh) * 3600;
  for (let t = 0; t <= seconds; t += 5) {
    points.push({
      at: new Date(from.at + t * 1000).toISOString(),
      lat: from.lat + (((kmh / 3600) * t) / KM_PER_DEG_LAT),
      lng: from.lng,
      accuracyM: 8,
      speedMps: kmh / 3.6,
    });
  }
  return points;
}

function park(
  where: { lat: number; lng: number; at: number },
  minutes: number,
): Point[] {
  const points: Point[] = [];
  for (let t = 0; t <= minutes * 60; t += 60) {
    const wobble = Math.sin(t / 7) * 12;
    points.push({
      at: new Date(where.at + t * 1000).toISOString(),
      lat: where.lat + wobble / 111320,
      lng: where.lng,
      accuracyM: 10,
      speedMps: 0,
    });
  }
  return points;
}

Deno.test("a drive, a 15 minute stop and another drive", () => {
  const leg1 = drive({ lat: 6.9, lng: 79.9, at: START }, 10, 60);
  const end1 = leg1[leg1.length - 1];
  const parked = park({
    lat: end1.lat,
    lng: end1.lng,
    at: Date.parse(end1.at) + 5000,
  }, 15);
  const end2 = parked[parked.length - 1];
  const leg2 = drive(
    { lat: end2.lat, lng: end2.lng, at: Date.parse(end2.at) + 5000 },
    5,
    40,
  );
  const route = summariseRoute([...leg1, ...parked, ...leg2]);
  assert(Math.abs(route.km - 15) <= 0.3, `km ${route.km}`);
  assertEquals(route.stops.length, 1);
  assert(
    Math.abs(route.stops[0].minutes - 15) <= 1,
    `stop ${route.stops[0].minutes} min`,
  );
});

Deno.test("standing still with wrong Wi-Fi fixes adds nothing and is one stop", () => {
  const points = park({ lat: 7.0, lng: 80.0, at: START }, 40).map((
    p,
    i,
  ) => (i % 5 === 0 ? { ...p, lat: p.lat + 0.004, accuracyM: 15 } : p));
  const route = summariseRoute(points);
  assertEquals(route.km, 0);
  assertEquals(route.stops.length, 1);
  assert(route.stops[0].minutes >= 35, `stop ${route.stops[0].minutes} min`);
});

Deno.test("fixes with a poor accuracy and a jump are ignored", () => {
  const leg = drive({ lat: 6.9, lng: 79.9, at: START }, 10, 60);
  const middle = Math.floor(leg.length / 2);
  const noisy = leg.map((
    p,
    i,
  ) => (i % 4 === 2 ? { ...p, accuracyM: 160, lat: p.lat + 0.01 } : p));
  noisy.splice(middle, 0, {
    ...leg[middle],
    at: new Date(Date.parse(leg[middle].at) - 2500).toISOString(),
    lng: leg[middle].lng + 0.05,
  });
  const route = summariseRoute(noisy);
  assert(Math.abs(route.km - 10) <= 0.3, `km ${route.km}`);
  assertEquals(route.stops.length, 0);
});

Deno.test("no points, no distance", () => {
  assertEquals(summariseRoute([]), { km: 0, stops: [], usable: 0 });
});
