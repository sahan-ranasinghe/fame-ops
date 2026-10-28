import { assertEquals, assertThrows } from "@std/assert";
import { cacheKey, estimateLeg, legMinutes, minuteLimiter, orsRequest, orsResponse, providerFromEnv, rushHourFactor } from "./routing.ts";
import { SETTINGS_DEFAULTS } from "./settings.ts";

const COLOMBO = { lat: 6.9344, lng: 79.8428 };
const KALUTARA = { lat: 6.5854, lng: 79.9607 };
const GALLE = { lat: 6.0329, lng: 80.2168 };
const MATARA = { lat: 5.9549, lng: 80.555 };
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

Deno.test("the provider comes from ROUTING_PROVIDER; an old google means ors (Google is the map package's now); anything else is the estimate", () => {
  assertEquals(providerFromEnv("ors"), "ors");
  assertEquals(providerFromEnv(" Google "), "ors");
  assertEquals(providerFromEnv(undefined), "estimate");
  assertEquals(providerFromEnv("mapbox"), "estimate");
});

Deno.test("openrouteservice: [lng, lat] in the request, highways avoided only when asked", () => {
  const req = orsRequest(COLOMBO, GALLE, { avoid_expressway: false }, "k");
  assertEquals((req.body as { coordinates: number[][] }).coordinates, [[79.8428, 6.9344], [80.2168, 6.0329]]);
  assertEquals((req.body as { preference: string }).preference, "fastest");
  assertEquals((req.body as { extra_info: string[] }).extra_info, ["waycategory"]);
  assertEquals((req.body as { options?: unknown }).options, undefined);
  assertEquals(req.headers.Authorization, "k");
  const avoid = orsRequest(COLOMBO, GALLE, { avoid_expressway: true }, "k");
  assertEquals((avoid.body as { options: unknown }).options, { avoid_features: ["highways"] });
});

Deno.test("openrouteservice: metres and seconds become km and minutes; the highway bit flags the leg", () => {
  const json = {
    routes: [{
      summary: { distance: 118750, duration: 5460 },
      extras: { waycategory: { values: [[0, 10, 0], [10, 40, 1], [40, 60, 0]] } },
    }],
  };
  assertEquals(orsResponse(json), { km: 118.8, minutes: 91, via_expressway: true });
  const noHighway = { routes: [{ summary: { distance: 42000, duration: 3600 }, extras: { waycategory: { values: [[0, 12, 0]] } } }] };
  assertEquals(orsResponse(noHighway), { km: 42, minutes: 60, via_expressway: false });
  assertThrows(() => orsResponse({ routes: [] }));
});

Deno.test("the estimate: straight line × 1.3 at 35 km/h", () => {
  const leg = estimateLeg(COLOMBO, KALUTARA, SETTINGS_DEFAULTS);
  assertEquals(leg.km, 53.2); // 40.95 km straight × 1.3
  assertEquals(leg.minutes, 91.2);
  assertEquals(leg.via_expressway, null);
});

Deno.test("rush hour: only a Colombo leg, only in a band, only on a weekday", () => {
  const rush = SETTINGS_DEFAULTS.rush_hour;
  assertEquals(rushHourFactor(COLOMBO, KALUTARA, at("2026-10-19", "08:00"), rush), 1.3); // Monday 08:00, starts in Colombo
  assertEquals(rushHourFactor(KALUTARA, COLOMBO, at("2026-10-19", "17:00"), rush), 1.3); // ends in Colombo
  assertEquals(rushHourFactor(GALLE, MATARA, at("2026-10-19", "08:00"), rush), 1); // far from Colombo
  assertEquals(rushHourFactor(COLOMBO, KALUTARA, at("2026-10-19", "11:00"), rush), 1); // between the bands
  assertEquals(rushHourFactor(COLOMBO, KALUTARA, at("2026-10-19", "09:30"), rush), 1); // the band ends at 09:30
  assertEquals(rushHourFactor(COLOMBO, KALUTARA, at("2026-10-24", "08:00"), rush), 1); // Saturday
});

Deno.test("the cache key rounds to 3 decimals; the limiter allows n a minute", () => {
  assertEquals(cacheKey({ lat: 6.93441234, lng: 79.84279 }, GALLE, true, "ors"), {
    from_lat: 6.934,
    from_lng: 79.843,
    to_lat: 6.033,
    to_lng: 80.217,
    avoid_expressway: true,
    provider: "ors",
  });
  const allow = minuteLimiter(2);
  assertEquals([allow(), allow(), allow()], [true, true, false]);
});

Deno.test("Part 6: openrouteservice's answer keeps its road line (encoded polyline) with the leg; none, no line", () => {
  const json = { routes: [{ summary: { distance: 12345, duration: 1500 }, geometry: "_p~iF~ps|U_ulLnnqC" }] };
  const leg = orsResponse(json);
  assertEquals([leg.km, leg.minutes, leg.line], [12.3, 25, "_p~iF~ps|U_ulLnnqC"]);
  assertEquals("line" in orsResponse({ routes: [{ summary: { distance: 1000, duration: 60 } }] }), false);
});

// ---- Round 48 (6a): the directions call's own budget, through legMinutes with the ors provider ----

const ORS_ANSWER = { routes: [{ summary: { distance: 12345, duration: 1500 }, extras: { waycategory: { values: [] } } }] };

/** The route cache (empty) and the day counter, which may be broken; every bump recorded. */
function orsDb(counter: "ok" | "error" = "ok", calls = 0) {
  const bumps: { provider: string; ok: boolean }[] = [];
  const q = {
    select: () => q,
    match: () => q,
    eq: () => q,
    gte: () => q,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ error: null }),
  };
  const rc = {
    select: () => rc,
    eq: () => rc,
    maybeSingle: () =>
      counter === "error" ? Promise.resolve({ data: null, error: { message: "connection reset" } }) : Promise.resolve({ data: { calls }, error: null }),
  };
  const db = {
    from: (table: string) => (table === "routing_calls" ? rc : q),
    rpc: (_name: string, args: { p_provider: string; p_ok: boolean }) => {
      bumps.push({ provider: args.p_provider, ok: args.p_ok });
      return Promise.resolve({ error: null });
    },
  } as unknown as import("./db.ts").Db;
  return { db, bumps };
}

async function withOrs<T>(run: () => Promise<T>): Promise<T> {
  const before = [Deno.env.get("ROUTING_PROVIDER"), Deno.env.get("ORS_KEY")];
  Deno.env.set("ROUTING_PROVIDER", "ors");
  Deno.env.set("ORS_KEY", "KEY");
  try {
    return await run();
  } finally {
    before[0] === undefined ? Deno.env.delete("ROUTING_PROVIDER") : Deno.env.set("ROUTING_PROVIDER", before[0]);
    before[1] === undefined ? Deno.env.delete("ORS_KEY") : Deno.env.set("ORS_KEY", before[1]);
  }
}

Deno.test("Round 48: a day counter that cannot be read makes no openrouteservice call: the leg is the estimate, never a thrown plan", async () => {
  await withOrs(async () => {
    const { db, bumps } = orsDb("error");
    let fetched = 0;
    const leg = await legMinutes(db, COLOMBO, GALLE, at("2026-10-19", "11:00"), { avoid_expressway: false }, SETTINGS_DEFAULTS, (() => {
      fetched += 1;
      return Promise.resolve(Response.json(ORS_ANSWER));
    }) as unknown as typeof fetch);
    assertEquals([leg.source, fetched, bumps.length], ["estimate", 0, 0]);
  });
});

Deno.test("Round 48: at the budget no call; under it one call counted ok; the new host's 404 is counted as failed before the old host", async () => {
  await withOrs(async () => {
    const full = orsDb("ok", 1900);
    let fetched = 0;
    const leg = await legMinutes(full.db, COLOMBO, GALLE, at("2026-10-19", "11:00"), { avoid_expressway: false }, SETTINGS_DEFAULTS, (() => {
      fetched += 1;
      return Promise.resolve(Response.json(ORS_ANSWER));
    }) as unknown as typeof fetch);
    assertEquals([leg.source, fetched], ["estimate", 0]);
    const { db, bumps } = orsDb("ok", 10);
    const urls: string[] = [];
    const fetcher = ((url: string) => {
      urls.push(url);
      return Promise.resolve(url.includes("api.heigit.org") ? new Response("gone", { status: 410 }) : Response.json(ORS_ANSWER));
    }) as unknown as typeof fetch;
    const ok = await legMinutes(db, COLOMBO, GALLE, at("2026-10-19", "11:00"), { avoid_expressway: false }, SETTINGS_DEFAULTS, fetcher);
    assertEquals([ok.source, ok.km, urls.length], ["ors", 12.3, 2]);
    assertEquals(bumps, [{ provider: "ors", ok: false }, { provider: "ors", ok: true }]);
  });
});
