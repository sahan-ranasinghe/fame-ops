// Map matching: the pieces sent to a provider, the two providers' answers with a
// recorded sample and a mocked response, the call counting, and the fallback.
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { Db } from "./db.ts";
import {
  chunkForMatching,
  GOOGLE_MEMORY_MAX,
  GOOGLE_MEMORY_TTL_MS,
  googleRoadsRequest,
  googleRoadsResponse,
  googleRoadsStore,
  type MatchInput,
  matchPoints,
  MemoryMatchStore,
  osrmRequest,
  osrmResponse,
  snapLegs,
  type StoredLeg,
  tailToSend,
  thinBySpacing,
} from "./matching.ts";

const T0 = Date.parse("2026-10-14T03:00:00Z");
const sec = (n: number) => T0 + n * 1000;

/** A recorded sample: 5 fixes along Galle Road, Colombo, heading south at about 30 km/h, 5 s apart. */
const SAMPLE: MatchInput[] = [
  { at: sec(0), lat: 6.9050, lng: 79.8530, acc: 8 },
  { at: sec(5), lat: 6.9046, lng: 79.8531, acc: 8 },
  { at: sec(10), lat: 6.9042, lng: 79.8532, acc: 12 },
  { at: sec(15), lat: 6.9038, lng: 79.8532, acc: 8 },
  { at: sec(20), lat: 6.9035, lng: 79.8533, acc: 8 },
];

Deno.test("chunking: about one point per 50 m, cut at a gap of 2 minutes, chunks of 100 sharing a point (Phase 7, §26)", () => {
  // 250 fixes 5 s and 28 m apart (20 km/h): every other one is kept (56 m), and the last: 126 points.
  const slow: MatchInput[] = [];
  for (let i = 0; i < 250; i++) slow.push({ at: sec(i * 5), lat: 6.9 + i * 0.00025, lng: 79.85, acc: 8 });
  const thinned = thinBySpacing(slow);
  assertEquals(thinned.length, 126, "the first, every 56 m after it, and the last");
  const chunks = chunkForMatching(slow);
  assertEquals(chunks.map((c) => c.length), [100, 27], "100 + 27, sharing one point at the join (about 5 km a call)");
  assertEquals(chunks[0][chunks[0].length - 1], chunks[1][0]);
  // 250 fixes 55 m apart (40 km/h): all kept: 100 + 100 + 52.
  const fast = slow.map((p, i) => ({ ...p, lat: 6.9 + i * 0.0005 }));
  assertEquals(chunkForMatching(fast).map((c) => c.length), [100, 100, 52]);
  const gap = chunkForMatching([...SAMPLE, { at: sec(20 + 130), lat: 6.90, lng: 79.8535, acc: 8 }, {
    at: sec(20 + 135),
    lat: 6.8995,
    lng: 79.8536,
    acc: 8,
  }]);
  assertEquals(gap.length, 2, "a gap of over 2 minutes is never bridged: two pieces");
  assertEquals(chunkForMatching(SAMPLE.slice(0, 1)), [], "one point is nothing to match");
});

Deno.test("Google Roads: the request and a mocked answer with interpolated road vertices, timed by distance", () => {
  const url = googleRoadsRequest(SAMPLE, "KEY");
  assert(url.startsWith("https://roads.googleapis.com/v1/snapToRoads?interpolate=true&path="));
  assert(url.includes("6.905%2C79.853%7C6.9046%2C79.8531") && url.endsWith("&key=KEY"));
  // The road bends between the second and third fix: Google adds a vertex without an originalIndex.
  const answer = {
    snappedPoints: [
      { location: { latitude: 6.90501, longitude: 79.85301 }, originalIndex: 0, placeId: "a" },
      { location: { latitude: 6.90461, longitude: 79.85311 }, originalIndex: 1, placeId: "a" },
      { location: { latitude: 6.90441, longitude: 79.85320 }, placeId: "a" },
      { location: { latitude: 6.90421, longitude: 79.85322 }, originalIndex: 2, placeId: "a" },
      { location: { latitude: 6.90381, longitude: 79.85321 }, originalIndex: 3, placeId: "b" },
      { location: { latitude: 6.90351, longitude: 79.85331 }, originalIndex: 4, placeId: "b" },
    ],
  };
  const out = googleRoadsResponse(answer, SAMPLE);
  assertEquals(out.length, 6);
  assertEquals(out.map((p) => p.at).filter((_, i) => i !== 2), [sec(0), sec(5), sec(10), sec(15), sec(20)]);
  assert(out[2].at > sec(5) && out[2].at < sec(10), `the road vertex is timed between its neighbours (${(out[2].at - T0) / 1000} s)`);
  assertEquals(out[2].lat, 6.90441);
  assertEquals(googleRoadsResponse({ snappedPoints: [] }, SAMPLE), []);
  let threw = false;
  try {
    googleRoadsResponse({ error: { message: "bad key" } }, SAMPLE);
  } catch {
    threw = true;
  }
  assert(threw, "an error answer throws");
});

Deno.test("OSRM: the request carries timestamps and radiuses; the answer's legs are timed by their distances", () => {
  const url = osrmRequest(SAMPLE, "https://osrm.example.com/");
  assert(url.startsWith("https://osrm.example.com/match/v1/driving/79.853,6.905;79.8531,6.9046;"));
  assert(url.includes("timestamps=" + [0, 5, 10, 15, 20].map((s) => Math.round(sec(s) / 1000)).join(";")));
  assert(url.includes("radiuses=8;8;12;8;8"));
  const answer = {
    code: "Ok",
    tracepoints: [
      { matchings_index: 0, waypoint_index: 0 },
      { matchings_index: 0, waypoint_index: 1 },
      null, // the third fix could not be matched
      { matchings_index: 0, waypoint_index: 2 },
      { matchings_index: 0, waypoint_index: 3 },
    ],
    matchings: [{
      confidence: 0.9,
      geometry: { coordinates: [[79.85301, 6.90501], [79.85311, 6.90461], [79.85318, 6.90440], [79.85321, 6.90381], [79.85331, 6.90351]] },
      legs: [
        { annotation: { distance: [45] } }, // fix 0 → fix 1: one step
        { annotation: { distance: [25, 65] } }, // fix 1 → fix 3 via a road vertex
        { annotation: { distance: [35] } }, // fix 3 → fix 4
      ],
    }],
  };
  const out = osrmResponse(answer, SAMPLE);
  assertEquals(out.length, 5);
  assertEquals(out.map((p) => p.at).filter((_, i) => i !== 2), [sec(0), sec(5), sec(15), sec(20)]);
  // The vertex is 25 of 90 m along the 10 s leg from fix 1 (5 s) to fix 3 (15 s): about 7.8 s.
  assert(Math.abs(out[2].at - sec(5 + 10 * (25 / 90))) < 600, `vertex at ${(out[2].at - T0) / 1000} s`);
  let threw = false;
  try {
    osrmResponse({ code: "NoMatch", message: "Could not match the trace." }, SAMPLE);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("matchPoints: every chunk is one counted call; a failed call counts, throws and leaves the leg raw", async () => {
  const calls: string[] = [];
  const counted: boolean[] = [];
  const fake = (body: unknown, status = 200) => (url: string) => {
    calls.push(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  };
  // A server that snaps every point it is sent onto itself (the request's path, thinned to 5 m first).
  const echo = (url: string) => {
    calls.push(url);
    const path = decodeURIComponent(new URL(url).searchParams.get("path") ?? "");
    const snappedPoints = path.split("|").map((pair, i) => {
      const [lat, lng] = pair.split(",").map(Number);
      return { location: { latitude: lat, longitude: lng }, originalIndex: i };
    });
    return Promise.resolve(
      new Response(JSON.stringify({ snappedPoints }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  const out = await matchPoints("google_roads", SAMPLE, { key: "K" }, echo, (ok) => void counted.push(ok));
  assert(out.length >= 2 && out.length <= SAMPLE.length, `${out.length} points back`);
  assertEquals(out[0].at, SAMPLE[0].at);
  assertEquals(out[out.length - 1].at, SAMPLE[SAMPLE.length - 1].at);
  assertEquals(counted, [true]);
  assertEquals(calls.length, 1);
  await assertRejects(() =>
    matchPoints("google_roads", SAMPLE, { key: "K" }, fake({ error: "quota" }, 403), (ok) => void counted.push(ok))
  );
  assertEquals(counted, [true, false]);
  await assertRejects(() => matchPoints("osrm", SAMPLE, {}, fake({}), () => undefined), Error, "OSRM_URL");
});

Deno.test("a growing leg goes in whole chunks, or (Round 48 snap hotfix) its tail once 3 minutes and 30 points are waiting; all of it at the leg's end", () => {
  // Fixes 55 m apart: every one is kept by the thinning. Snapped a second ago: only whole chunks go.
  const run = (n: number) => Array.from({ length: n }, (_, i) => ({ at: sec(i * 5), lat: 6.9 + i * 0.0005, lng: 79.85, acc: 8 }));
  assertEquals(tailToSend(run(99), true, 1000), null, "99 new points a second after the last snap: the tail stays raw");
  assertEquals(tailToSend(run(99), true)?.points.length, 99, "99 points never snapped: they go (the first snap of a leg)");
  assertEquals(tailToSend(run(100), true, 1000)?.points.length, 100, "100: one whole chunk goes whenever");
  const more = tailToSend(run(119), true, 1000);
  assertEquals(
    [more?.points.length, more?.upTo],
    [100, sec(99 * 5)],
    "119: still one whole chunk, up to its last point (never a small extra call)",
  );
  assertEquals(tailToSend(run(199), true, 1000)?.points.length, 199, "199: two whole chunks sharing a point");
  assertEquals(tailToSend(run(20), false)?.points.length, 20, "the leg ended: the rest goes");
  assertEquals(tailToSend(run(1), false), null, "one point is nothing to send");
});

// ---- Round 48 item 5 (28 October 2026, Sahan's decision): Google's road-snapped lines are never stored -----------------

/** The database as snapLegs sees it: what it reads (route_matched, OSRM rows only), writes, counts and takes. */
function fakeDb(osrmRows: Record<string, unknown>[] = []) {
  const upserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const takes: string[] = [];
  const bumps: string[] = [];
  const done = (data: unknown) => ({ data, error: null });
  const db = {
    from: (table: string) => {
      assertEquals(table, "route_matched");
      const q = {
        select: () => q,
        eq: () => q,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(done(osrmRows)).then(ok, bad),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return Promise.resolve(done(null));
        },
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          const u = {
            eq: () => u,
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(done(null)).then(ok, bad),
          };
          return u;
        },
      };
      return q;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "google_take") {
        takes.push(String(args.p_feature));
        return Promise.resolve(
          done({ allowed: true, reason: null, day: takes.length, month: takes.length, day_cap: 215, month_cap: 4750 }),
        );
      }
      assertEquals(name, "bump_routing_calls");
      bumps.push(String(args.p_provider));
      return Promise.resolve(done(null));
    },
  } as unknown as Db;
  return { db, upserts, updates, takes, bumps };
}

const CAPS = {
  map_loads: { day: 430, month: 9500 },
  places_autocomplete: { day: 430, month: 9500 },
  places_details: { day: 430, month: 9500 },
  routes: { day: 215, month: 4750 },
  roads: { day: 215, month: 4750 },
};

/** A Google server that snaps every point onto itself, counting its calls. */
function googleEcho() {
  const state = { calls: 0 };
  const fetchFn = (url: string) => {
    state.calls += 1;
    const path = decodeURIComponent(new URL(url).searchParams.get("path") ?? "");
    const snappedPoints = path.split("|").map((pair, i) => {
      const [lat, lng] = pair.split(",").map(Number);
      return { location: { latitude: lat, longitude: lng }, originalIndex: i };
    });
    return Promise.resolve(
      new Response(JSON.stringify({ snappedPoints }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { state, fetchFn };
}

const withEnv = async (keys: Record<string, string>, run: () => Promise<void>) => {
  const before = Object.fromEntries(Object.keys(keys).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(keys)) Deno.env.set(k, v);
  try {
    await run();
  } finally {
    for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
};

Deno.test("Round 48: a Google leg is matched, kept in memory and never written; asked again within 30 minutes it makes no Roads call and takes no count; after 30 minutes it is asked again", async () => {
  await withEnv({ GOOGLE_SERVER_KEY: "K" }, async () => {
    googleRoadsStore.clear();
    const { db, upserts, updates, takes, bumps } = fakeDb();
    const google = googleEcho();
    const now = new Date("2026-10-28T04:00:00Z");
    const leg = { from: SAMPLE[0].at, to: SAMPLE[4].at, points: SAMPLE };
    const first = await snapLegs(db, "e1", "2026-10-28", "google_roads", [leg], now, google.fetchFn, CAPS);
    assertEquals(first.status, "ok");
    assertEquals(first.legs[0].source, "matched");
    assert(first.legs[0].points.length >= 2);
    assertEquals(google.state.calls, 1, "one Roads call");
    assertEquals(takes, ["roads"], "counted before it was made");
    assertEquals(bumps, ["google_roads"]);
    assertEquals(upserts, [], "nothing written to route_matched");
    assertEquals(updates, []);
    assertEquals(googleRoadsStore.size(), 1, "kept in memory");
    // The page's 60-second refresh: the same leg from memory.
    const again = await snapLegs(db, "e1", "2026-10-28", "google_roads", [leg], new Date(now.getTime() + 60000), google.fetchFn, CAPS);
    assertEquals(again.legs[0].source, "matched");
    assertEquals(again.legs[0].points, first.legs[0].points);
    assertEquals(google.state.calls, 1, "no second Roads call");
    assertEquals(takes.length, 1, "no second count");
    assertEquals(upserts, []);
    // A window inside the leg (a task's route): clipped from memory, never paid twice.
    const inside = await snapLegs(
      db,
      "e1",
      "2026-10-28",
      "google_roads",
      [{ from: SAMPLE[1].at, to: SAMPLE[4].at, points: SAMPLE.slice(1) }],
      new Date(now.getTime() + 90000),
      google.fetchFn,
      CAPS,
    );
    assertEquals(inside.legs[0].source, "matched");
    assertEquals(google.state.calls, 1);
    // Another driver's day is its own entry.
    await snapLegs(db, "e2", "2026-10-28", "google_roads", [leg], now, google.fetchFn, CAPS);
    assertEquals(google.state.calls, 2);
    assertEquals(googleRoadsStore.size(), 2);
    // 31 minutes after the last match the leg is forgotten: the next view asks Google again (the cost of not storing).
    const later = await snapLegs(
      db,
      "e1",
      "2026-10-28",
      "google_roads",
      [leg],
      new Date(now.getTime() + GOOGLE_MEMORY_TTL_MS + 60000),
      google.fetchFn,
      CAPS,
    );
    assertEquals(later.legs[0].source, "matched");
    assertEquals(google.state.calls, 3);
    assertEquals(takes.length, 3);
    assertEquals(upserts, [], "still nothing in the database");
    googleRoadsStore.clear();
  });
});

Deno.test("Round 48: a failed Google match is remembered 2 minutes in memory (the debounce), not in the database", async () => {
  await withEnv({ GOOGLE_SERVER_KEY: "K" }, async () => {
    googleRoadsStore.clear();
    const { db, upserts, takes } = fakeDb();
    let calls = 0;
    const broken = () => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: "quota" }), { status: 403, headers: { "Content-Type": "application/json" } }),
      );
    };
    const now = new Date("2026-10-28T04:00:00Z");
    const leg = { from: SAMPLE[0].at, to: SAMPLE[4].at, points: SAMPLE };
    const first = await snapLegs(db, "e1", "2026-10-28", "google_roads", [leg], now, broken, CAPS);
    assertEquals(first.status, "failed");
    assertEquals(first.legs[0].source, "raw");
    assertEquals(calls, 1);
    const soon = await snapLegs(db, "e1", "2026-10-28", "google_roads", [leg], new Date(now.getTime() + 60000), broken, CAPS);
    assertEquals(soon.legs[0].source, "raw");
    assertEquals(calls, 1, "not tried again within 2 minutes");
    await snapLegs(db, "e1", "2026-10-28", "google_roads", [leg], new Date(now.getTime() + 3 * 60000), broken, CAPS);
    assertEquals(calls, 2, "tried again after 2 minutes");
    assertEquals(takes.length, 2, "each try counted before it was made");
    assertEquals(upserts, [], "the failure is not written either");
    googleRoadsStore.clear();
  });
});

Deno.test("Round 48: an OSRM leg is still written to route_matched (our own server's answer), and read back from it", async () => {
  await withEnv({ OSRM_URL: "https://osrm.example.com" }, async () => {
    const { db, upserts } = fakeDb();
    const answer = {
      code: "Ok",
      tracepoints: SAMPLE.map((_, i) => ({ matchings_index: 0, waypoint_index: i })),
      matchings: [{
        geometry: { coordinates: SAMPLE.map((p) => [p.lng, p.lat]) },
        legs: SAMPLE.slice(1).map(() => ({ annotation: { distance: [45] } })),
      }],
    };
    let calls = 0;
    const osrm = () => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    const now = new Date("2026-10-28T04:00:00Z");
    const leg = { from: SAMPLE[0].at, to: SAMPLE[4].at, points: SAMPLE };
    const out = await snapLegs(db, "e1", "2026-10-28", "osrm", [leg], now, osrm, CAPS);
    assertEquals(out.legs[0].source, "matched");
    assertEquals(calls, 1);
    assertEquals(upserts.length, 1, "written to route_matched");
    assertEquals(upserts[0].provider, "osrm");
    assertEquals(upserts[0].status, "ok");
    assertEquals(googleRoadsStore.size(), 0, "never in Google's memory");
    // Read back: the stored row answers the next view without a call.
    const stored = fakeDb([{
      leg_from: new Date(leg.from).toISOString(),
      leg_to: new Date(leg.to).toISOString(),
      geometry: upserts[0].geometry,
      matched_at: now.toISOString(),
      status: "ok",
      error: null,
    }]);
    const again = await snapLegs(stored.db, "e1", "2026-10-28", "osrm", [leg], new Date(now.getTime() + 60000), osrm, CAPS);
    assertEquals(again.legs[0].source, "matched");
    assertEquals(calls, 1, "no second OSRM call");
    assertEquals(stored.upserts, []);
  });
});

Deno.test("the memory store: at most 200 legs, the least recently used dropped first; a leg older than 30 minutes is forgotten", async () => {
  assertEquals([GOOGLE_MEMORY_MAX, GOOGLE_MEMORY_TTL_MS], [200, 30 * 60000]);
  const legAt = (from: number, at = 0): StoredLeg => ({
    legFrom: from,
    legTo: from + 1000,
    geometry: [],
    matchedAt: at,
    status: "ok",
    error: null,
  });
  const small = new MemoryMatchStore(2, 1000);
  await small.save("e", "d", legAt(1));
  await small.save("e", "d", legAt(2));
  // Reading leg 1 makes it the most recently used; leg 2 is then the one to go.
  await small.save("e", "d", legAt(1));
  await small.save("e", "d", legAt(3));
  assertEquals(small.size(), 2);
  assertEquals((await small.load("e", "d", 0)).map((l) => l.legFrom).sort(), [1, 3]);
  const ttl = new MemoryMatchStore(10, 1000);
  await ttl.save("e", "d", legAt(7, 5000));
  assertEquals((await ttl.load("e", "d", 5999)).length, 1, "within the TTL");
  assertEquals((await ttl.load("e", "d", 6000)).length, 0, "at the TTL it is gone");
  assertEquals(ttl.size(), 0);
  assertEquals((await ttl.load("other", "d", 0)).length, 0, "another driver's day sees nothing");
});
