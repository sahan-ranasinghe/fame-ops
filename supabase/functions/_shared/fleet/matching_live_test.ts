// Round 48 snap hotfix: a live two-hour drive (a point every 20 s) watched by the driver's own screen and two office
// viewers, each polling the route every minute, costs under 15 Roads calls in all; a second viewer adds none; a past
// day's playback is one batch, served to every viewer after it from the same short-lived memory. The matcher runs with
// the real MemoryMatchStore and a fake Roads API that answers the points sent; the database is a fake that counts.
import { assert, assertEquals } from "jsr:@std/assert";
import { MATCH_CHUNK, MemoryMatchStore, type SnapLeg, snapLegs, TAIL_MIN_MS, TAIL_MIN_POINTS, tailToSend } from "./matching.ts";
import type { Db } from "./db.ts";

const KEY_WAS = Deno.env.get("GOOGLE_SERVER_KEY");
Deno.env.set("GOOGLE_SERVER_KEY", "test-key");

function fakeDb(counts: { google: number; trip: number; refusedTrip: number }, tripCap = 20) {
  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === "google_take") {
      counts.google += 1;
      return Promise.resolve({ data: { allowed: true, day: counts.google, day_cap: 215, month: counts.google, month_cap: 4750 }, error: null });
    }
    if (name === "roads_trip_take") {
      if (counts.trip >= tripCap) {
        counts.refusedTrip += 1;
        return Promise.resolve({ data: { allowed: false, reason: "trip", used: counts.trip, cap: tripCap }, error: null });
      }
      counts.trip += 1;
      void args;
      return Promise.resolve({ data: { allowed: true, used: counts.trip, cap: tripCap }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return { rpc } as unknown as Db;
}

/** The Roads API that answers the points it was sent (snapped = the same places), counting each call. */
function fakeRoads(calls: { n: number }) {
  return (url: string): Promise<Response> => {
    calls.n += 1;
    const path = new URL(url).searchParams.get("path") ?? "";
    const snapped = path.split("|").map((pair, i) => {
      const [lat, lng] = pair.split(",").map(Number);
      return { location: { latitude: lat, longitude: lng }, originalIndex: i };
    });
    return Promise.resolve(new Response(JSON.stringify({ snappedPoints: snapped }), { status: 200 }));
  };
}

const caps = {
  map_loads: { day: 430, month: 9500 },
  places_autocomplete: { day: 430, month: 9500 },
  places_details: { day: 430, month: 9500 },
  routes: { day: 215, month: 4750 },
  roads: { day: 215, month: 4750 },
};

/** A drive north at about 40 km/h: a point every 20 s, 220 m apart (over the 50 m thinning, so every point counts). */
const drive = (t0: number, n: number) => Array.from({ length: n }, (_, i) => ({ at: t0 + i * 20000, lat: 6.9 + i * 0.002, lng: 79.95, acc: 8 }));

Deno.test("a live two-hour drive watched by three screens polling every minute: under 15 Roads calls, the second viewer adds none", async () => {
  const t0 = Date.parse("2026-10-28T08:00:00Z");
  const all = drive(t0, 361); // 2 hours
  const counts = { google: 0, trip: 0, refusedTrip: 0 };
  const db = fakeDb(counts);
  const calls = { n: 0 };
  const store = new MemoryMatchStore();
  const callsAfterOneViewer: number[] = [];
  // Every minute for two hours: the driver's screen, then two office viewers, each asking the route so far (one open leg).
  for (let minute = 1; minute <= 120; minute++) {
    const now = new Date(t0 + minute * 60000);
    const points = all.filter((p) => p.at <= now.getTime());
    const leg: SnapLeg = { from: points[0].at, to: points[points.length - 1].at, points, open: true };
    for (let viewer = 0; viewer < 3; viewer++) {
      const r = await snapLegs(db, "driver-1", "2026-10-28", "google_roads", [leg], now, fakeRoads(calls), caps, store, {
        source: viewer === 0 ? "app_route" : "site_live",
        budget: { employeeId: "driver-1", cap: 20 },
      });
      assert(r.status === "ok", `status ${r.status} at minute ${minute}`);
      if (viewer === 0) callsAfterOneViewer.push(calls.n);
      else assertEquals(calls.n, callsAfterOneViewer[callsAfterOneViewer.length - 1], `viewer ${viewer} at minute ${minute} paid`);
    }
  }
  assert(calls.n < 15, `${calls.n} Roads calls for the drive`);
  assert(calls.n >= 8, `${calls.n} Roads calls: the line must still follow the driver (about one every 8 minutes)`);
  assertEquals(counts.google, calls.n, "every call counted before it was made");
  assertEquals(counts.trip, calls.n, "and taken from the driver's budget first");
  assertEquals(counts.refusedTrip, 0);
  // The last snap covers the drive up to the last whole refresh; the newest tail is raw meanwhile.
  const last = await snapLegs(db, "driver-1", "2026-10-28", "google_roads", [{ from: all[0].at, to: all[all.length - 1].at, points: all, open: true }], new Date(t0 + 120 * 60000), fakeRoads(calls), caps, store, { budget: { employeeId: "driver-1", cap: 20 } });
  assertEquals(last.legs[0].source, "matched");
  assert((last.legs[0].matchedTo ?? 0) >= all[all.length - TAIL_MIN_POINTS - 1].at, "the snapped line is never more than a refresh behind");
});

Deno.test("the driver's budget: past the cap that day's route is raw, the fleet counter untouched", async () => {
  const t0 = Date.parse("2026-10-28T08:00:00Z");
  const all = drive(t0, 361);
  const counts = { google: 0, trip: 0, refusedTrip: 0 };
  const db = fakeDb(counts, 3);
  const calls = { n: 0 };
  const store = new MemoryMatchStore();
  let raw = 0;
  for (let minute = 10; minute <= 120; minute += 10) {
    const now = new Date(t0 + minute * 60000);
    const points = all.filter((p) => p.at <= now.getTime());
    const r = await snapLegs(db, "driver-1", "2026-10-28", "google_roads", [{ from: points[0].at, to: points[points.length - 1].at, points, open: true }], now, fakeRoads(calls), caps, store, { budget: { employeeId: "driver-1", cap: 3 } });
    if (r.status !== "ok") raw += 1;
  }
  assertEquals(calls.n, 3, "three calls, then the budget refuses");
  assertEquals(counts.google, 3, "the fleet counter saw only the allowed three");
  assert(counts.refusedTrip >= 1 && raw >= 1, "a refused refresh leaves the newest part raw");
});

Deno.test("yesterday's playback: one batch for the first viewer, nothing for the next two", async () => {
  const t0 = Date.parse("2026-10-27T03:00:00Z");
  const all = drive(t0, 400);
  const counts = { google: 0, trip: 0, refusedTrip: 0 };
  const db = fakeDb(counts);
  const calls = { n: 0 };
  const store = new MemoryMatchStore();
  const leg: SnapLeg = { from: all[0].at, to: all[all.length - 1].at, points: all };
  const now = new Date("2026-10-28T09:00:00Z");
  const first = await snapLegs(db, "driver-1", "2026-10-27", "google_roads", [leg], now, fakeRoads(calls), caps, store, { source: "site_route_playback", budget: { employeeId: "driver-1", cap: 20 } });
  assertEquals(first.status, "ok");
  const batch = calls.n;
  assertEquals(batch, Math.ceil((400 - 1) / (MATCH_CHUNK - 1)), "one batch: a call per 100-point chunk");
  for (let viewer = 0; viewer < 2; viewer++) {
    await snapLegs(db, "driver-1", "2026-10-27", "google_roads", [leg], new Date(now.getTime() + 60000 * (viewer + 1)), fakeRoads(calls), caps, store, { budget: { employeeId: "driver-1", cap: 20 } });
  }
  assertEquals(calls.n, batch, "the next viewers pay nothing");
});

Deno.test("tailToSend: a growing leg waits for a whole chunk, or for 3 minutes and 30 points; a closed leg goes at once", () => {
  const t0 = 0;
  const pts = drive(t0, 40);
  assertEquals(tailToSend(pts, true, undefined)?.points.length, 40, "never snapped and 30+ points: it goes");
  assertEquals(tailToSend(pts, true, TAIL_MIN_MS - 1000), null, "snapped under 3 minutes ago: it waits");
  assertEquals(tailToSend(pts, true, TAIL_MIN_MS)?.points.length, 40, "3 minutes on: it goes");
  assertEquals(tailToSend(pts.slice(0, 20), true, TAIL_MIN_MS * 2), null, "too few points: it waits however long");
  assertEquals(tailToSend(pts.slice(0, 20), false, undefined)?.points.length, 20, "a closed leg goes whole");
  const many = drive(t0, 250);
  const sent = tailToSend(many, true, 1000);
  assertEquals(sent?.points.length, 199, "two whole chunks go even seconds after the last snap; the rest waits");
});

Deno.test({ name: "restore the key", fn: () => { if (KEY_WAS === undefined) Deno.env.delete("GOOGLE_SERVER_KEY"); else Deno.env.set("GOOGLE_SERVER_KEY", KEY_WAS); } });
