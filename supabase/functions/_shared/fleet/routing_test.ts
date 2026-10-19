import { assertEquals, assertThrows } from "@std/assert";
import { cacheKey, estimateLeg, minuteLimiter, orsRequest, orsResponse, providerFromEnv, rushHourFactor } from "./routing.ts";
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
