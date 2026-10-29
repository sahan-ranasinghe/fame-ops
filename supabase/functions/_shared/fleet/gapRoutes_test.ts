// The estimated lines of gaps (Part 5b): which gaps qualify, the openrouteservice answer, the cache per
// gap, the daily cap inside the directions budget, no key. A fake database and a fake fetch.
import { assert, assertEquals } from "@std/assert";
import type { Db } from "./db.ts";
import {
  COUNTER_NOTE,
  estimatedLines,
  type Fetcher,
  GAP_NEW_PER_ROUTE,
  gapGeometry,
  gapKey,
  gapRequestBody,
  NO_ROAD_NOTE,
} from "./gapRoutes.ts";
import { buildRoute, type Jump, jumpsOf, type LinePoint } from "./route.ts";

const NOW = new Date("2026-10-16T04:30:00Z");
const jump = (i: number): Jump => ({
  from: 1000 * i,
  to: 1000 * i + 120000,
  metres: 900,
  fromPoint: { lat: 6.9 + i * 0.01, lng: 79.86 },
  toPoint: { lat: 6.908 + i * 0.01, lng: 79.862 },
});
const ANSWER = {
  type: "FeatureCollection",
  features: [{
    geometry: { coordinates: [[79.86, 6.9], [79.8605, 6.9031], [79.8611, 6.9055], [79.862, 6.908]] },
    properties: { summary: { distance: 1234.5 } },
  }],
};

function fakeDb(calls: { ors?: number; ors_gap?: number } = {}) {
  const cache = new Map<string, { geometry: unknown; km: number | null }>();
  const counts = { ors: calls.ors ?? 0, ors_gap: calls.ors_gap ?? 0 };
  const db = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        match: (m: Record<string, unknown>) => {
          Object.assign(filters, m);
          return q;
        },
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        gte: () => q,
        maybeSingle: () => {
          if (table === "route_gap_lines") {
            return Promise.resolve({
              data: cache.get(JSON.stringify([filters.from_lat, filters.from_lng, filters.to_lat, filters.to_lng])) ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: { calls: counts[filters.provider as "ors" | "ors_gap"] ?? 0 }, error: null });
        },
        upsert: (row: Record<string, unknown>) => {
          cache.set(JSON.stringify([row.from_lat, row.from_lng, row.to_lat, row.to_lng]), { geometry: row.geometry, km: row.km as number });
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
    rpc: (_name: string, args: { p_provider: "ors" | "ors_gap" }) => {
      counts[args.p_provider] += 1;
      return Promise.resolve({ error: null });
    },
  } as unknown as Db;
  return { db, cache, counts };
}

function counted() {
  let n = 0;
  const fetchFn = () => {
    n += 1;
    return Promise.resolve(Response.json(ANSWER));
  };
  return { fetchFn, n: () => n };
}

async function withKey<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = Deno.env.get("ORS_KEY");
  if (value === undefined) Deno.env.delete("ORS_KEY");
  else Deno.env.set("ORS_KEY", value);
  try {
    return await run();
  } finally {
    if (before === undefined) Deno.env.delete("ORS_KEY");
    else Deno.env.set("ORS_KEY", before);
  }
}

Deno.test("a jump is over 300 m and over 60 s between two consecutive points; its ends stay on the thinned line", () => {
  const p = (s: number, lat: number): LinePoint => ({ at: s * 1000, lat, lng: 79.86, kmh: 0, acc: 8 });
  // 0.003° of latitude is about 333 m.
  const line = [p(0, 6.9), p(30, 6.903), p(200, 6.906), p(230, 6.9061), p(400, 6.9062)];
  assertEquals(
    jumpsOf(line).map((j) => [j.from / 1000, j.to / 1000]),
    [[30, 200]],
    "30 s and 333 m: no; 170 s and 333 m: yes; 170 s and 11 m: no",
  );
  const fixes = Array.from({ length: 40 }, (_, i) => ({ at: i * 5000, lat: 6.9 + i * 0.0004, lng: 79.86, speedMps: 10, accuracyM: 8 }));
  // A two-minute silence while driving 1.2 km, then on along the same straight road.
  const later = Array.from(
    { length: 40 },
    (_, i) => ({ at: 320000 + i * 5000, lat: 6.9156 + 0.011 + i * 0.0004, lng: 79.86, speedMps: 10, accuracyM: 8 }),
  );
  const route = buildRoute([...fixes, ...later], { simplifyM: 50 });
  assertEquals(route.jumps.length, 1);
  const [j] = route.jumps;
  assert(
    route.line.some((x) => x.at === j.from) && route.line.some((x) => x.at === j.to),
    "the jump's ends are kept on a line thinned at 50 m",
  );
});

Deno.test("openrouteservice: [lng, lat] in, the road line out as [lat, lng] with its km; the ends rounded for the cache", () => {
  assertEquals(gapRequestBody(jump(0)), { coordinates: [[79.86, 6.9], [79.862, 6.908]], preference: "fastest", instructions: false });
  assertEquals(gapGeometry(ANSWER), { points: [[6.9, 79.86], [6.9031, 79.8605], [6.9055, 79.8611], [6.908, 79.862]], km: 1.2 });
  assertEquals(gapKey({ fromPoint: { lat: 6.912345, lng: 79.861234 }, toPoint: { lat: 6.9, lng: 79.8 } }), {
    from_lat: 6.9123,
    from_lng: 79.8612,
    to_lat: 6.9,
    to_lng: 79.8,
  });
});

Deno.test("one call per gap, then the cache: a second view costs nothing", async () => {
  await withKey("KEY", async () => {
    const { db, counts } = fakeDb();
    const { fetchFn, n } = counted();
    const first = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0), jump(1)], NOW, fetchFn);
    assertEquals([first.lines.length, first.lines.every((l) => !l.cached), n(), counts.ors_gap, first.note], [2, true, 2, 2, undefined]);
    const again = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0), jump(1)], NOW, fetchFn);
    assertEquals([again.lines.length, again.lines.every((l) => l.cached), n()], [2, true, 2]);
  });
});

Deno.test("the caps: its own daily cap, the directions budget shared with the road times, 25 new a view; no key", async () => {
  await withKey("KEY", async () => {
    const capped = fakeDb({ ors_gap: 300 });
    const c1 = counted();
    const r1 = await estimatedLines(capped.db, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, c1.fetchFn);
    assertEquals([r1.lines.length, c1.n(), r1.note], [0, 0, "Estimated line limit reached for today: the other gaps are straight"]);
    const budget = fakeDb({ ors: 1800, ors_gap: 100 });
    const c2 = counted();
    const r2 = await estimatedLines(budget.db, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, c2.fetchFn);
    assertEquals([r2.lines.length, c2.n()], [0, 0], "1,800 road times + 100 gaps = the 1,900 budget");
    const many = fakeDb();
    const c3 = counted();
    const r3 = await estimatedLines(many.db, { ors_gap_daily_cap: 300 }, Array.from({ length: 30 }, (_, i) => jump(i)), NOW, c3.fetchFn);
    assertEquals([r3.lines.length, c3.n(), r3.note], [
      GAP_NEW_PER_ROUTE,
      GAP_NEW_PER_ROUTE,
      "5 more gaps are straight: at most 25 new estimated lines a view",
    ]);
  });
  await withKey(undefined, async () => {
    const { db } = fakeDb();
    const c = counted();
    const r = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, c.fetchFn);
    assertEquals([r.lines.length, c.n(), r.note], [0, 0, "Estimated lines need the openrouteservice key: the other gaps are straight"]);
  });
});

Deno.test("Round 48: a counter that cannot be read makes no call (fail closed): the gaps stay straight, with the note", async () => {
  await withKey("KEY", async () => {
    const { db } = fakeDb();
    const broken = {
      ...db,
      from: (table: string) => {
        const q = (db as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        if (table !== "routing_calls") return q;
        return {
          ...q,
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection reset" } }) }) }),
          }),
        };
      },
    } as unknown as Db;
    const { fetchFn, n } = counted();
    const r = await estimatedLines(broken, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, fetchFn);
    assertEquals([r.lines.length, n(), r.note], [0, 0, COUNTER_NOTE]);
  });
});

Deno.test("Round 48: the new host's 404 is a request too: counted as failed, then the old host answers (one line, two counts)", async () => {
  await withKey("KEY", async () => {
    const { db, counts } = fakeDb();
    const urls: string[] = [];
    const fetchFn = (url: string) => {
      urls.push(url);
      return Promise.resolve(url.includes("api.heigit.org") ? new Response("gone", { status: 404 }) : Response.json(ANSWER));
    };
    const r = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, fetchFn as unknown as Fetcher);
    assertEquals([r.lines.length, urls.length, counts.ors_gap], [1, 2, 2]);
    assert(urls[0].includes("api.heigit.org") && urls[1].includes("api.openrouteservice.org"));
  });
});

Deno.test("Round 49: a gap with no road near an end (openrouteservice 2010): one request, counted as made (not an error), kept 30 days, never asked again", async () => {
  await withKey("KEY", async () => {
    const { db, cache } = fakeDb();
    const oks: boolean[] = [];
    const rpc = (db as unknown as { rpc: (n: string, a: { p_provider: "ors" | "ors_gap"; p_ok: boolean }) => Promise<unknown> }).rpc;
    (db as unknown as { rpc: unknown }).rpc = (n: string, a: { p_provider: "ors" | "ors_gap"; p_ok: boolean }) => {
      oks.push(a.p_ok);
      return rpc(n, a);
    };
    const urls: string[] = [];
    const fetchFn = (url: string) => {
      urls.push(url);
      return Promise.resolve(
        Response.json({ error: { code: 2010, message: "Could not find routable point within a radius of 350.0 meters" } }, { status: 404 }),
      );
    };
    const first = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0), jump(1)], NOW, fetchFn as unknown as Fetcher);
    assertEquals([first.lines.length, urls.length, first.note], [0, 2, NO_ROAD_NOTE], "one request per gap, on the new host only");
    assertEquals(oks, [true, true], "counted as calls made, not as errors");
    assertEquals([...cache.values()].map((c) => c.geometry), [[], []], "kept as empty lines");
    const again = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0), jump(1)], NOW, fetchFn as unknown as Fetcher);
    assertEquals(
      [again.lines.length, urls.length, again.note],
      [0, 2, NO_ROAD_NOTE],
      "the next view asks nothing: straight, with the note",
    );
  });
});

Deno.test("Round 49: a real failure (a 500) is still an error and is not cached", async () => {
  await withKey("KEY", async () => {
    const { db, cache, counts } = fakeDb();
    const fetchFn = () => Promise.resolve(Response.json({ error: { code: 2099, message: "Unknown internal error" } }, { status: 500 }));
    const r = await estimatedLines(db, { ors_gap_daily_cap: 300 }, [jump(0)], NOW, fetchFn as unknown as Fetcher);
    assertEquals([r.lines.length, cache.size, counts.ors_gap], [0, 0, 1]);
    assertEquals(r.note, "openrouteservice did not answer for some gaps: they are straight");
  });
});
