// The snap cost fix (2 November 2026): Google's sparse points, one request for several pieces, and the asker's own copy of the
// line. The matcher runs with fresh memory stores (a cold isolate each) and a fake Roads API that answers the points sent.
import { assert, assertEquals } from "jsr:@std/assert";
import type { Db } from "./db.ts";
import {
  HELD_FLUSH_MS,
  MATCH_CHUNK,
  type MatchInput,
  MemoryMatchStore,
  packForRoads,
  ROADS_SPACING_M,
  roadsRuns,
  type SnapLeg,
  snapLegs,
  thinForRoads,
} from "./matching.ts";
import { heldLine, heldUpTo } from "./tools/locations.ts";
import { distanceM } from "./track.ts";

const KEY_WAS = Deno.env.get("GOOGLE_SERVER_KEY");
Deno.env.set("GOOGLE_SERVER_KEY", "test-key");

const caps = {
  map_loads: { day: 430, month: 9500 },
  places_autocomplete: { day: 430, month: 9500 },
  places_details: { day: 430, month: 9500 },
  routes: { day: 215, month: 4750 },
  roads: { day: 800, month: 4750 },
};
const db = {
  rpc: (name: string) =>
    Promise.resolve({
      data: name === "google_take"
        ? { allowed: true, day: 1, day_cap: 800, month: 1, month_cap: 4750 }
        : { allowed: true, used: 1, cap: 60 },
      error: null,
    }),
} as unknown as Db;

function fakeRoads(failing = false) {
  const state = { calls: 0, sizes: [] as number[] };
  const fetchFn = (url: string): Promise<Response> => {
    state.calls += 1;
    if (failing) return Promise.resolve(new Response("{}", { status: 500 }));
    const pairs = (new URL(url).searchParams.get("path") ?? "").split("|").map((p) => p.split(",").map(Number));
    state.sizes.push(pairs.length);
    const snappedPoints = pairs.flatMap(([lat, lng], i) => {
      const anchor = { location: { latitude: lat, longitude: lng }, originalIndex: i };
      const next = pairs[i + 1];
      return next ? [anchor, { location: { latitude: (lat + next[0]) / 2, longitude: (lng + next[1]) / 2 } }] : [anchor];
    });
    return Promise.resolve(new Response(JSON.stringify({ snappedPoints }), { status: 200 }));
  };
  return { state, fetchFn };
}

const T0 = Date.parse("2026-11-02T03:00:00Z");
/** A straight road north: a fix every 5 s at 40 km/h (about 55 m apart). */
const road = (t0: number, km: number, lat0 = 7.0, lng = 80.0): MatchInput[] =>
  Array.from({ length: Math.round(km * 1000 / 55) + 1 }, (_, i) => ({ at: t0 + i * 5000, lat: lat0 + i * 55 / 111320, lng, acc: 8 }));
const legOf = (points: MatchInput[], open = false): SnapLeg => ({ from: points[0].at, to: points[points.length - 1].at, points, open });
const snap = (
  legs: SnapLeg[],
  now: number,
  fetchFn: ReturnType<typeof fakeRoads>["fetchFn"],
  store = new MemoryMatchStore(),
  held?: { to: number; snappedAt: number },
) => snapLegs(db, "e1", "2026-11-02", "google_roads", legs, new Date(now), fetchFn, caps, store, { source: "site_route", held });

Deno.test("thinForRoads: consecutive points within 300 m on a straight road, about one every 300 m", () => {
  const points = road(T0, 30);
  const thin = thinForRoads(points);
  for (let i = 1; i < thin.length; i++) assert(distanceM(thin[i - 1], thin[i]) <= ROADS_SPACING_M);
  assert(thin.length <= 30000 / 250, `${thin.length} points for 30 km`);
  assertEquals(thin[0], points[0]);
  assertEquals(thin[thin.length - 1], points[points.length - 1]);
});

Deno.test("thinForRoads: a turn between two 300 m marks keeps a point there; GPS noise on a straight road does not", () => {
  const north = road(T0, 0.2);
  const corner = north[north.length - 1];
  const east = Array.from(
    { length: 5 },
    (_, i) => ({ at: corner.at + (i + 1) * 5000, lat: corner.lat, lng: corner.lng + (i + 1) * 55 / 110000, acc: 8 }),
  );
  const kept = thinForRoads([...north, ...east]);
  assert(kept.slice(1, -1).some((p) => distanceM(p, corner) <= 60), "a point at the corner, or one fix before it, is kept");
  const noisy = road(T0, 3).map((p, i) => ({ ...p, lng: p.lng + (i % 2 ? 0.00003 : -0.00003) }));
  assert(thinForRoads(noisy).length <= thinForRoads(road(T0, 3)).length + 2, "3 m of noise adds no turns");
});

Deno.test("packForRoads: a day's short legs share one request; each leg gets its own road and none between them", () => {
  const legs: MatchInput[][] = [];
  let at = T0;
  let lat = 7.0;
  for (let i = 0; i < 12; i++) {
    const leg = road(at, 1.5, lat);
    legs.push(leg);
    at = leg[leg.length - 1].at + 15 * 60000; // a stop of 15 minutes at the same place
    lat = leg[leg.length - 1].lat;
  }
  const requests = packForRoads(legs);
  assertEquals(requests.length, 1, "twelve legs, one call");
  assert(requests[0].points.length <= MATCH_CHUNK);
  assertEquals(requests[0].runs.length, 12);
  const vertices = requests[0].points.flatMap((
    p,
    i,
  ) => [{ location: { latitude: p.lat, longitude: p.lng }, originalIndex: i }, { location: { latitude: 1, longitude: 1 } }]);
  const runs = roadsRuns({ snappedPoints: vertices }, requests[0]);
  assertEquals(runs.map((r) => r.job), legs.map((_, i) => i));
  const between = runs[0].points[runs[0].points.length - 1];
  assert(between.lat !== 1, "the road vertex after a run's last point belongs to no run");
  for (const [i, run] of runs.entries()) {
    assert(
      run.points[0].at >= legs[i][0].at && run.points[run.points.length - 1].at <= legs[i][legs[i].length - 1].at,
      "times stay inside the leg",
    );
  }
});

Deno.test("packForRoads: a jump over 300 m starts a new request; a long leg goes on sharing a point; a vehicle that stood costs nothing", () => {
  const a = road(T0, 2);
  const far = road(a[a.length - 1].at + 600000, 2, 7.5);
  assertEquals(packForRoads([a, far]).length, 2, "never one path across a long jump");
  const long = packForRoads([road(T0, 60)]);
  assertEquals(long.length, 3, "60 km in three calls");
  assert(long.every((r) => r.points.length <= MATCH_CHUNK));
  assertEquals(long[1].points[0], long[0].points[long[0].points.length - 1], "consecutive requests share a point");
  const stood = Array.from({ length: 20 }, (_, i) => ({ at: T0 + i * 60000, lat: 7 + (i % 2) * 0.0001, lng: 80, acc: 20 }));
  assertEquals(packForRoads([stood]), []);
});

Deno.test("cold views: a 100 km day of ten legs is at most 5 calls; three viewers on three isolates pay three times that at most, once each", async () => {
  const legs: SnapLeg[] = [];
  let at = T0;
  let lat = 6.5;
  for (let i = 0; i < 10; i++) {
    const leg = road(at, 10, lat);
    legs.push(legOf(leg));
    at = leg[leg.length - 1].at + 20 * 60000;
    lat = leg[leg.length - 1].lat;
  }
  const roads = fakeRoads();
  const now = at;
  const first = await snap(legs, now, roads.fetchFn);
  assertEquals(first.status, "ok");
  assert(roads.state.calls <= 5, `${roads.state.calls} calls`);
  assert(first.legs.every((l) => l.source === "matched" && l.points.length >= 2));
  const one = roads.state.calls;
  await snap(legs, now, roads.fetchFn);
  await snap(legs, now, roads.fetchFn);
  assertEquals(roads.state.calls, one * 3);
});

Deno.test("the bug of 2 November: a finished leg whose end lies past its last line point costs one view, not one view a minute", async () => {
  const points = road(T0, 2);
  const leg: SnapLeg = { from: points[0].at, to: points[points.length - 1].at + 25000, points };
  const roads = fakeRoads();
  const store = new MemoryMatchStore();
  let now = leg.to + 60000;
  const first = await snap([leg], now, roads.fetchFn, store);
  assertEquals(first.legs[0].matchedTo, leg.to, "matched to the leg's end");
  assertEquals(roads.state.calls, 1);
  for (let i = 0; i < 25; i++) {
    now += 60000;
    const again = await snap([leg], now, roads.fetchFn, store);
    assertEquals(again.legs[0].source, "matched");
    assert(again.legs[0].points.length >= 2, "the road is still there");
  }
  assertEquals(roads.state.calls, 1, "25 refreshes on the same isolate within the 30 minutes, no call");
});

Deno.test("a refresh with the line held: a finished day costs nothing on a cold isolate", async () => {
  const leg = legOf(road(T0, 20));
  const roads = fakeRoads();
  const held = { to: leg.to + 60000, snappedAt: leg.to };
  const now = leg.to + 3600000;
  // The tool leaves out every leg the asker holds whole: nothing is left to send.
  const answer = await snap([], now, roads.fetchFn, new MemoryMatchStore(), held);
  assertEquals(roads.state.calls, 0);
  assertEquals(answer.status, "ok");
});

Deno.test("a refresh with the line held: only the part after it goes, once it is worth a call, and it is not kept as the whole leg", async () => {
  const all = road(T0, 30);
  const heldTo = all[Math.floor(all.length / 3)].at;
  const store = new MemoryMatchStore();
  const roads = fakeRoads();
  const shortTail = all.filter((p) => p.at <= heldTo + 60000);
  const shortLeg = legOf(shortTail, true);
  // A minute of driving after the held line, on a cold isolate: nothing is paid and the tail stays raw.
  const waited = await snap([shortLeg], shortLeg.to, roads.fetchFn, store, { to: heldTo, snappedAt: shortLeg.to - 60000 });
  assertEquals(roads.state.calls, 0, "under 50 thinned points and under 30 minutes");
  assertEquals(waited.sent, 0);
  // 20 km more: the part after the held line goes in as few calls as it fits.
  const leg = legOf(all, true);
  const sent = await snap([leg], leg.to, roads.fetchFn, store, { to: heldTo, snappedAt: leg.to - 60000 });
  assertEquals(roads.state.calls, 1);
  assertEquals(sent.sent, 1);
  assertEquals(sent.legs[0].source, "matched");
  assertEquals(sent.legs[0].matchedTo, leg.to);
  assert(roads.state.sizes[0] <= MATCH_CHUNK);
  assertEquals(store.size(), 0, "a part is never read as the whole leg by the next viewer");
  // Next viewer, no line held, same isolate: pays for the whole leg, and gets it whole.
  const whole = await snap([leg], leg.to, roads.fetchFn, store);
  assert(whole.legs[0].points[0].at === all[0].at, "starts at the leg's start");
});

Deno.test("a refresh with the line held: a short trip goes after 30 minutes even with few points, and a failed call keeps the line", async () => {
  const short = legOf(road(T0 + 3600000, 1));
  const roads = fakeRoads();
  const heldTo = T0;
  const soon = await snap([short], short.to + 60000, roads.fetchFn, new MemoryMatchStore(), { to: heldTo, snappedAt: short.to });
  assertEquals(roads.state.calls, 0);
  assertEquals(soon.legs[0].source, "raw");
  assertEquals(heldUpTo(soon.legs, heldTo), heldTo, "the line held does not move past a raw leg");
  const due = await snap([short], short.to + HELD_FLUSH_MS, roads.fetchFn, new MemoryMatchStore(), { to: heldTo, snappedAt: short.to });
  assertEquals(roads.state.calls, 1);
  assertEquals(heldUpTo(due.legs, heldTo), short.to);
  const down = fakeRoads(true);
  const failed = await snap([short], short.to + HELD_FLUSH_MS, down.fetchFn, new MemoryMatchStore(), { to: heldTo, snappedAt: short.to });
  assertEquals(failed.status, "failed");
  assertEquals(heldUpTo(failed.legs, heldTo), heldTo);
});

Deno.test("a failure stops the rest: Google down costs one call for a whole day, and every leg stays raw", async () => {
  const legs = [legOf(road(T0, 60)), legOf(road(T0 + 7200000, 60, 8))];
  const down = fakeRoads(true);
  const out = await snap(legs, T0 + 86400000, down.fetchFn);
  assertEquals(down.state.calls, 1);
  assertEquals(out.status, "failed");
  assert(out.legs.every((l) => l.source === "raw"));
});

Deno.test("heldLine: another day, or a point inside the line that arrived since, asks for the whole line", () => {
  const token = `v1.2026-11-02.${T0}.${T0 + 1000}.${T0 + 500}`;
  assertEquals(heldLine(undefined, "2026-11-02", []), null);
  assertEquals(heldLine(token, "2026-11-03", []), null);
  assertEquals(heldLine(token, "2026-11-02", [{ at: T0 - 5000, receivedAt: T0 - 4000 }]), { to: T0, snappedAt: T0 + 500 });
  assertEquals(
    heldLine(token, "2026-11-02", [{ at: T0 + 5000, receivedAt: T0 + 9000 }]),
    { to: T0, snappedAt: T0 + 500 },
    "after the line: the normal tail",
  );
  assertEquals(heldLine(token, "2026-11-02", [{ at: T0 - 5000, receivedAt: T0 + 2000 }]), null, "uploaded late, inside the line");
});

Deno.test("heldUpTo: up to the first raw leg, or the matched part of a growing leg", () => {
  const leg = (from: number, to: number, source: "matched" | "raw", matchedTo?: number) => ({ from, to, source, points: [], matchedTo });
  assertEquals(heldUpTo([leg(1, 2, "matched", 2), leg(3, 4, "matched", 4)], null), 4);
  assertEquals(heldUpTo([leg(1, 2, "matched", 2), leg(3, 4, "raw"), leg(5, 6, "matched", 6)], null), 2);
  assertEquals(heldUpTo([leg(1, 2, "matched", 2), leg(3, 9, "matched", 5)], null), 5);
  assertEquals(heldUpTo([leg(3, 4, "raw")], null), null);
  assertEquals(heldUpTo([leg(3, 4, "raw")], 2), 2);
  assertEquals(heldUpTo([], 2), 2);
});

Deno.test({
  name: "restore the key",
  fn: () => {
    if (KEY_WAS === undefined) Deno.env.delete("GOOGLE_SERVER_KEY");
    else Deno.env.set("GOOGLE_SERVER_KEY", KEY_WAS);
  },
});
