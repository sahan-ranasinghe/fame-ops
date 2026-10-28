// The map search (Part 4): openrouteservice's answer, the 30-day cache, the daily cap; a fake fetch and a fake database.
import { assert, assertEquals } from "@std/assert";
import type { Db } from "./db.ts";
import { BUSY_NOTE, COUNTER_NOTE, LIMIT_NOTE, normaliseQuery, orsAutocomplete, orsPlaces } from "./geocode.ts";

const ANSWER = {
  features: [
    {
      geometry: { coordinates: [80.6337, 7.2906] },
      properties: {
        gid: "openstreetmap:venue:node/1",
        name: "Kandy City Centre",
        label: "Kandy City Centre, Kandy, Central Province",
        source: "openstreetmap",
      },
    },
    {
      geometry: { coordinates: [80.64, 7.29] },
      properties: { gid: "whosonfirst:locality:1", name: "Kandy", label: "Kandy, Central Province", source: "whosonfirst" },
    },
    { geometry: { coordinates: [] }, properties: { name: "no point" } },
  ],
};

/** A database with the two tables the map search reads and writes, and the counter. */
function fakeDb(calls = 0) {
  const cache = new Map<string, { answer: unknown; fetched_at: string }>();
  const state = { calls, bumped: 0 };
  const chain = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return q;
      },
      gte: () => q,
      maybeSingle: () => {
        if (table === "geocode_cache") {
          const hit = cache.get(String(filters.query));
          return Promise.resolve({ data: hit ?? null, error: null });
        }
        return Promise.resolve({ data: { calls: state.calls }, error: null });
      },
      upsert: (row: { query: string; answer: unknown; fetched_at: string }) => {
        cache.set(row.query, { answer: row.answer, fetched_at: row.fetched_at });
        return Promise.resolve({ error: null });
      },
    };
    return q;
  };
  const minutes = { n: 0 };
  const db = {
    from: chain,
    rpc: (name: string) => {
      if (name === "bump_minute_calls") return Promise.resolve({ data: ++minutes.n, error: null });
      state.bumped += 1;
      state.calls += 1;
      return Promise.resolve({ error: null });
    },
  } as unknown as Db;
  return { db, state, cache, minutes };
}

Deno.test("the answer: name, label, point and the credit per source; features without a point are left out", () => {
  const places = orsPlaces(ANSWER);
  assertEquals(places.length, 2);
  assertEquals(places[0], {
    provider: "ors",
    ref: "openstreetmap:venue:node/1",
    name: "Kandy City Centre",
    label: "Kandy City Centre, Kandy, Central Province",
    lat: 7.2906,
    lng: 80.6337,
    attribution: "© OpenStreetMap contributors · openrouteservice",
    storable: true,
  });
  assertEquals(places[1].attribution, "Who's On First · openrouteservice");
  assertEquals(normaliseQuery("  Kandy,   City-Centre! "), "kandy city centre");
});

Deno.test("one counted call, then the cache for the same text in any spelling; the key never in the URL", async () => {
  const { db, state } = fakeDb();
  const seen: { url: string; auth: string | null }[] = [];
  const fetcher = ((url: URL, init: RequestInit) => {
    seen.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
    return Promise.resolve(Response.json(ANSWER));
  }) as unknown as typeof fetch;
  const deps = {
    db,
    key: "KEY",
    cap: 1000,
    perMinute: 90,
    focus: { lat: 6.97, lng: 79.92 },
    now: new Date("2026-10-15T01:00:00Z"),
    fetch: fetcher,
  };
  const first = await orsAutocomplete("Kandy City", deps);
  assertEquals(first.places.length, 2);
  assertEquals(state.bumped, 1);
  assert(
    seen[0].url.startsWith("https://api.heigit.org/pelias/v1/autocomplete?") && seen[0].url.includes("boundary.country=LK") &&
      seen[0].url.includes("size=8") && seen[0].url.includes("focus.point.lat=6.97") && !seen[0].url.includes("KEY"),
  );
  assertEquals(seen[0].auth, "KEY");
  const again = await orsAutocomplete("  kandy,  CITY ", deps);
  assertEquals([again.cached, again.places.length, state.bumped, seen.length], [true, 2, 1, 1]);
});

Deno.test("the daily cap: no call, the note; under 3 characters: nothing; no key: said so", async () => {
  const { db } = fakeDb(1000);
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  const deps = { db, key: "KEY", cap: 1000, perMinute: 90, focus: null, now: new Date(), fetch: never };
  assertEquals(await orsAutocomplete("Galle Face", deps), { places: [], note: LIMIT_NOTE });
  assertEquals(await orsAutocomplete("Ga", deps), { places: [] });
  assertEquals((await orsAutocomplete("Galle Face", { ...deps, key: undefined })).note, "Map search is not set up");
});

Deno.test("a refused or slow answer is counted as an error and said in words; nothing cached", async () => {
  const { db, state, cache } = fakeDb();
  const busy = (() => Promise.resolve(new Response("{}", { status: 429 }))) as unknown as typeof fetch;
  const r = await orsAutocomplete("Matara", { db, key: "KEY", cap: 1000, perMinute: 90, focus: null, now: new Date(), fetch: busy });
  assertEquals([r.places.length, r.note, state.bumped, cache.size], [0, "Map search is busy, try again in a minute", 1, 0]);
});

Deno.test("the throttle: over the calls a minute, no call and the busy note", async () => {
  const { db, minutes } = fakeDb();
  minutes.n = 90; // 90 calls already this minute
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  const r = await orsAutocomplete("Galle Face", { db, key: "KEY", cap: 2500, perMinute: 90, focus: null, now: new Date(), fetch: never });
  assertEquals(r, { places: [], note: BUSY_NOTE });
});

Deno.test("Round 48: a day counter that cannot be read makes no call (fail closed), with the note; nothing is bumped", async () => {
  const { db, state } = fakeDb();
  const broken = {
    ...db,
    from: (table: string) => {
      const q = (db as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
      if (table !== "routing_calls") return q;
      return {
        ...q,
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "timeout" } }) }) }),
        }),
      };
    },
  } as unknown as Db;
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  const r = await orsAutocomplete("Galle Face", {
    db: broken,
    key: "KEY",
    cap: 2500,
    perMinute: 90,
    focus: null,
    now: new Date(),
    fetch: never,
  });
  assertEquals([r.places.length, r.note, state.bumped], [0, COUNTER_NOTE, 0]);
});

Deno.test("Round 48: a minute counter that errors or answers no number makes no call either (before: the call went out)", async () => {
  const never = (() => Promise.reject(new Error("must not be called"))) as unknown as typeof fetch;
  for (const answer of [{ data: null, error: { message: "permission denied" } }, { data: "many", error: null }]) {
    const { db, state } = fakeDb();
    const broken = {
      ...db,
      rpc: (name: string) =>
        name === "bump_minute_calls" ? Promise.resolve(answer) : (db as unknown as { rpc: (n: string) => unknown }).rpc(name),
    } as unknown as Db;
    const r = await orsAutocomplete("Galle Face", {
      db: broken,
      key: "KEY",
      cap: 2500,
      perMinute: 90,
      focus: null,
      now: new Date(),
      fetch: never,
    });
    assertEquals([r.places.length, r.note, state.bumped], [0, COUNTER_NOTE, 0]);
  }
});

Deno.test("Round 48: the new host's 404 counts as a failed request before the old host answers (two bumps, one answer)", async () => {
  const { db, state } = fakeDb();
  const urls: string[] = [];
  const fetcher = ((url: URL) => {
    urls.push(String(url));
    return Promise.resolve(String(url).includes("api.heigit.org") ? new Response("gone", { status: 404 }) : Response.json(ANSWER));
  }) as unknown as typeof fetch;
  const r = await orsAutocomplete("Matara", { db, key: "KEY", cap: 2500, perMinute: 90, focus: null, now: new Date(), fetch: fetcher });
  assertEquals([r.places.length, urls.length, state.bumped], [2, 2, 2]);
});
