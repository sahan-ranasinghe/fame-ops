// Map matching: the pieces sent to a provider, the two providers' answers with a
// recorded sample and a mocked response, the call counting, and the fallback.
import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  chunkForMatching,
  googleRoadsRequest,
  googleRoadsResponse,
  type MatchInput,
  matchPoints,
  osrmRequest,
  osrmResponse,
  sendTailNow,
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

Deno.test("a growing leg goes in whole chunks: 100 new thinned points, or the leg's end (Phase 7, §26)", () => {
  const run = (n: number) => Array.from({ length: n }, (_, i) => ({ at: sec(i * 5), lat: 6.9 + i * 0.0005, lng: 79.85, acc: 8 }));
  assertEquals(sendTailNow(run(99), true), false, "99 new points while driving: the tail stays raw");
  assertEquals(sendTailNow(run(100), true), true, "100: one whole chunk goes");
  assertEquals(sendTailNow(run(20), false), true, "the leg ended: the rest goes");
  assertEquals(sendTailNow(run(1), false), false, "one point is nothing to send");
});
