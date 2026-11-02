// The snap cost fix (2 November 2026), through the tool: driver_route on a fake database and a fake Roads API. The first view
// answers the whole line and a token; a refresh with it on a cold isolate pays nothing and answers only what came after it.
import { assert, assertEquals } from "jsr:@std/assert";
import type { Db } from "./db.ts";
import { googleRoadsStore } from "./matching.ts";
import { driverRoute } from "./tools/locations.ts";

const T0 = Date.parse("2026-11-02T03:00:00Z");
const DRIVER = { id: "e1", name: "Test Driver", username: "test.driver", code: "E1", role: "driver", active: true };

/** Three fixes a minute on a road north for 20 minutes, a stop of 20 minutes, then 20 more. */
function pointsUpTo(minutes: number, receivedAt = T0) {
  const rows: Record<string, unknown>[] = [];
  let lat = 7;
  for (let s = 0; s <= minutes * 60; s += 20) {
    const stopped = s > 20 * 60 && s < 40 * 60;
    if (!stopped) lat += 220 / 111320;
    const at = new Date(T0 + s * 1000).toISOString();
    rows.push({
      id: s,
      recorded_at: at,
      lat,
      lng: 80,
      speed_mps: stopped ? 0 : 11,
      accuracy_m: 8,
      received_at: new Date(Math.max(receivedAt, T0 + s * 1000)).toISOString(),
    });
  }
  return rows;
}

function fakeDb(points: Record<string, unknown>[]) {
  const tables: Record<string, unknown[]> = {
    employees: [DRIVER],
    location_points: points,
    fleet_settings: [{ key: "map_package", value: "google" }],
  };
  const chain = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const self: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        if (prop === "range") return (from: number) => Promise.resolve({ data: from === 0 ? tables[table] ?? [] : [], error: null });
        return () => self;
      },
    });
    return self;
  };
  return {
    from: chain,
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "google_take"
          ? { allowed: true, day: 1, day_cap: 800, month: 1, month_cap: 4750 }
          : name === "roads_trip_take"
          ? { allowed: true, used: 1, cap: 20 }
          : null,
        error: null,
      }),
  } as unknown as Db;
}

async function withRoads(run: (calls: { n: number }) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const key = Deno.env.get("GOOGLE_SERVER_KEY");
  const jsKey = Deno.env.get("GOOGLE_MAPS_JS_KEY");
  Deno.env.set("GOOGLE_SERVER_KEY", "K");
  Deno.env.set("GOOGLE_MAPS_JS_KEY", "J");
  const calls = { n: 0 };
  globalThis.fetch = ((url: string) => {
    calls.n += 1;
    const pairs = (new URL(String(url)).searchParams.get("path") ?? "").split("|");
    const snappedPoints = pairs.map((p, i) => {
      const [latitude, longitude] = p.split(",").map(Number);
      return { location: { latitude, longitude }, originalIndex: i };
    });
    return Promise.resolve(new Response(JSON.stringify({ snappedPoints }), { status: 200 }));
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) Deno.env.delete("GOOGLE_SERVER_KEY");
    else Deno.env.set("GOOGLE_SERVER_KEY", key);
    if (jsKey === undefined) Deno.env.delete("GOOGLE_MAPS_JS_KEY");
    else Deno.env.set("GOOGLE_MAPS_JS_KEY", jsKey);
  }
}

const ask = (points: Record<string, unknown>[], nowMs: number, snap_held?: string) =>
  driverRoute.run(
    { driver: "test.driver", date: "2026-11-02", line_tolerance_m: 0, max_line_points: 3000, snap: true, source: "site_route", snap_held },
    { db: fakeDb(points), now: new Date(nowMs), actor: { channel: "web", name: "Office", employeeId: "o1" } } as never,
  ) as Promise<
    { result: { snapped: { status: string; held?: string; from?: string }; route_snapped?: { columns: string[]; points: unknown[][] } } }
  >;

Deno.test("driver_route: the first view is whole with a token; a refresh on a cold isolate pays nothing and answers only what is new; a late upload asks for the whole line", async () => {
  await withRoads(async (calls) => {
    googleRoadsStore.clear();
    const day = pointsUpTo(60);
    const now = T0 + 3600000 + 600000;
    const first = (await ask(day, now)).result;
    assert(calls.n >= 1);
    assertEquals(first.snapped.status, "ok");
    assert(first.snapped.held, "a token");
    assertEquals(first.snapped.from, undefined, "a whole answer");
    const atColumn = first.route_snapped!.columns.indexOf("at");
    const firstAt = Date.parse(String(first.route_snapped!.points[0][atColumn]));
    const paid = calls.n;

    // The next minute, a new isolate: nothing new since the line, nothing paid.
    googleRoadsStore.clear();
    const refresh = (await ask(day, now + 60000, first.snapped.held)).result;
    assertEquals(calls.n, paid, "no call");
    assertEquals(refresh.snapped.status, "ok");
    assert(refresh.snapped.from, "says from where");
    assert(refresh.snapped.held, "still a token");
    const from = Date.parse(refresh.snapped.from!);
    assert(from > firstAt);
    for (const p of refresh.route_snapped?.points ?? []) {
      assert(Date.parse(String(p[atColumn])) > from, "nothing the asker holds is sent again");
    }

    // A point inside the line arrived after the token: the whole line again.
    googleRoadsStore.clear();
    const late = day.map((p, i) => (i === 5 ? { ...p, received_at: new Date(now + 90000).toISOString() } : p));
    const whole = (await ask(late, now + 120000, refresh.snapped.held)).result;
    assertEquals(whole.snapped.from, undefined, "a whole answer");
    assert(calls.n > paid, "paid again, once");
    googleRoadsStore.clear();
  });
});

Deno.test("driver_route: a token of another day is ignored", async () => {
  await withRoads(async () => {
    googleRoadsStore.clear();
    const answer = (await ask(pointsUpTo(20), T0 + 3600000, `v1.2026-11-01.${T0}.${T0}.${T0}`)).result;
    assertEquals(answer.snapped.status, "ok");
    assertEquals(answer.snapped.from, undefined);
    googleRoadsStore.clear();
  });
});
