// Road time and distance for one leg, from one of three providers:
//   ors       openrouteservice Directions v2 (secret ORS_KEY; free plan: 2,000 a
//             day, 40 a minute); coordinates are [lng, lat] in the request and
//             the response; avoid_features ["highways"] when the task avoids the
//             expressway; waycategory tells whether the leg uses one
//   google    Routes API computeRoutes, TRAFFIC_AWARE with the departure time
//             (secret GOOGLE_ROUTES_KEY)
//   estimate  straight line × road_factor ÷ avg_speed_kmh (no key needed)
// ROUTING_PROVIDER picks one; unset means estimate. Answers from ors and google
// are cached 30 days by rounded coordinates (route_legs); the rush-hour factor
// is applied after the cache, to ors and estimate legs, never to google (which
// already knows the traffic). On any error: the cache, then the estimate, and
// the leg says which (source). The calls are counted per day and provider
// (routing_calls); ors stops at ORS_DAILY_BUDGET and ORS_PER_MINUTE.

import type { Db } from "./db.ts";
import { unwrap, unwrapMaybe } from "./db.ts";
import { haversineKm } from "./geo.ts";
import type { LegResult, LegSource, PlanPoint } from "./plan.ts";
import type { RushHour, Settings } from "./settings.ts";

export type Provider = LegSource;

export const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/json";
export const GOOGLE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const ORS_DAILY_BUDGET = 1900;
export const ORS_PER_MINUTE = 40;
export const CACHE_DAYS = 30;
export const TIMEOUT_MS = 5000;
/** The highway bit of an openrouteservice waycategory value. */
const ORS_HIGHWAY_BIT = 1;
const COLOMBO_OFFSET_MS = 5.5 * 3600000;

export function providerFromEnv(value: string | undefined | null): Provider {
  const v = (value ?? "").trim().toLowerCase();
  return v === "ors" || v === "google" ? v : "estimate";
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface LegAnswer {
  km: number;
  minutes: number;
  via_expressway: boolean | null;
}

/** openrouteservice wants [lng, lat] pairs. */
export function orsRequest(from: PlanPoint, to: PlanPoint, opts: { avoid_expressway: boolean }, key: string): HttpRequest {
  const body: Record<string, unknown> = {
    coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
    preference: "fastest",
    extra_info: ["waycategory"],
    instructions: false,
  };
  if (opts.avoid_expressway) body.options = { avoid_features: ["highways"] };
  return { url: ORS_URL, headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/json" }, body };
}

/** The first route's summary (metres, seconds) and whether any segment is a highway. */
export function orsResponse(json: unknown): LegAnswer {
  const route =
    (json as { routes?: { summary?: { distance?: number; duration?: number }; extras?: { waycategory?: { values?: number[][] } } }[] })
      ?.routes?.[0];
  if (!route?.summary || typeof route.summary.distance !== "number" || typeof route.summary.duration !== "number") {
    throw new Error("openrouteservice: no route in the answer");
  }
  const values = route.extras?.waycategory?.values ?? [];
  const via = values.some((row) => Array.isArray(row) && typeof row[2] === "number" && (row[2] & ORS_HIGHWAY_BIT) === ORS_HIGHWAY_BIT);
  return { km: Math.round(route.summary.distance / 100) / 10, minutes: Math.round(route.summary.duration / 6) / 10, via_expressway: via };
}

/** Google's Routes API wants latitude / longitude objects; departureTime only in the future. */
export function googleRequest(
  from: PlanPoint,
  to: PlanPoint,
  departAt: string,
  opts: { avoid_expressway: boolean },
  key: string,
  now = new Date(),
): HttpRequest {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };
  if (new Date(departAt).getTime() > now.getTime() + 60000) body.departureTime = new Date(departAt).toISOString();
  if (opts.avoid_expressway) body.routeModifiers = { avoidHighways: true };
  return {
    url: GOOGLE_URL,
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters", "Content-Type": "application/json" },
    body,
  };
}

/** "842s" and distanceMeters; Google does not say whether a highway was used. */
export function googleResponse(json: unknown): LegAnswer {
  const route = (json as { routes?: { duration?: string; distanceMeters?: number }[] })?.routes?.[0];
  const seconds = route?.duration ? Number(route.duration.replace(/s$/, "")) : NaN;
  if (!route || !Number.isFinite(seconds) || typeof route.distanceMeters !== "number") {
    throw new Error("Google Routes: no route in the answer");
  }
  return { km: Math.round(route.distanceMeters / 100) / 10, minutes: Math.round(seconds / 6) / 10, via_expressway: null };
}

/** Straight line × road_factor at avg_speed_kmh. */
export function estimateLeg(from: PlanPoint, to: PlanPoint, s: Pick<Settings, "avg_speed_kmh" | "road_factor">): LegAnswer {
  const km = Math.round(haversineKm(from, to) * s.road_factor * 10) / 10;
  return { km, minutes: Math.round((km / s.avg_speed_kmh) * 600) / 10, via_expressway: null };
}

/** The factor for a leg that starts or ends within the radius of the centre and departs inside a band on one of its days (Colombo time). */
export function rushHourFactor(from: PlanPoint, to: PlanPoint, departAt: string, rush: RushHour): number {
  const near = haversineKm(from, rush.centre) <= rush.radius_km || haversineKm(to, rush.centre) <= rush.radius_km;
  if (!near) return 1;
  const local = new Date(new Date(departAt).getTime() + COLOMBO_OFFSET_MS);
  const day = local.getUTCDay();
  const hhmm = local.toISOString().slice(11, 16);
  const inBand = rush.bands.some((b) => b.days.includes(day) && hhmm >= b.from && hhmm < b.to);
  return inBand ? rush.factor : 1;
}

export interface CacheKey {
  from_lat: number;
  from_lng: number;
  to_lat: number;
  to_lng: number;
  avoid_expressway: boolean;
  provider: Provider;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Coordinates rounded to 3 decimals (about 110 m): one cached leg serves every departure time. */
export function cacheKey(from: PlanPoint, to: PlanPoint, avoid: boolean, provider: Provider): CacheKey {
  return { from_lat: r3(from.lat), from_lng: r3(from.lng), to_lat: r3(to.lat), to_lng: r3(to.lng), avoid_expressway: avoid, provider };
}

/** A small per-isolate limiter: at most n calls in any 60 s. */
export function minuteLimiter(n: number): () => boolean {
  const stamps: number[] = [];
  return () => {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60000) stamps.shift();
    if (stamps.length >= n) return false;
    stamps.push(now);
    return true;
  };
}
const orsMinute = minuteLimiter(ORS_PER_MINUTE);

async function cached(db: Db, key: CacheKey): Promise<LegAnswer | null> {
  const since = new Date(Date.now() - CACHE_DAYS * 86400000).toISOString();
  const row = unwrapMaybe(
    await db.from("route_legs").select("km, minutes, via_expressway").match(key).gte("computed_at", since).maybeSingle(),
    "route cache",
  );
  return row ? { km: row.km, minutes: row.minutes, via_expressway: row.via_expressway } : null;
}

async function store(db: Db, key: CacheKey, leg: LegAnswer): Promise<void> {
  unwrap(
    await db.from("route_legs").upsert({
      ...key,
      km: leg.km,
      minutes: leg.minutes,
      via_expressway: leg.via_expressway,
      computed_at: new Date().toISOString(),
    }, {
      onConflict: "from_lat,from_lng,to_lat,to_lng,avoid_expressway,provider",
    }),
    "route cache",
  );
}

async function callsToday(db: Db, provider: Provider): Promise<number> {
  const day = new Date(Date.now() + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
  const row = unwrapMaybe(
    await db.from("routing_calls").select("calls").eq("day", day).eq("provider", provider).maybeSingle(),
    "routing calls",
  );
  return row?.calls ?? 0;
}

async function bump(db: Db, provider: Provider, ok: boolean): Promise<void> {
  await db.rpc("bump_routing_calls", { p_provider: provider, p_ok: ok }).then(() => undefined, () => undefined);
}

async function callProvider(
  db: Db,
  provider: "ors" | "google",
  from: PlanPoint,
  to: PlanPoint,
  departAt: string,
  opts: { avoid_expressway: boolean },
): Promise<LegAnswer | null> {
  const key = Deno.env.get(provider === "ors" ? "ORS_KEY" : "GOOGLE_ROUTES_KEY");
  if (!key) return null;
  if (provider === "ors") {
    if ((await callsToday(db, "ors")) >= ORS_DAILY_BUDGET || !orsMinute()) return null;
  }
  const req = provider === "ors" ? orsRequest(from, to, opts, key) : googleRequest(from, to, departAt, opts, key);
  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${provider} ${res.status}`);
    const leg = provider === "ors" ? orsResponse(json) : googleResponse(json);
    await bump(db, provider, true);
    return leg;
  } catch (error) {
    console.error(`routing ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    await bump(db, provider, false);
    return null;
  }
}

/**
 * How long a leg takes, departing at departAt. Tries the configured provider
 * (through the cache first), then any cached answer, then the estimate.
 */
export async function legMinutes(
  db: Db,
  from: PlanPoint,
  to: PlanPoint,
  departAt: string,
  opts: { avoid_expressway: boolean },
  settings: Settings,
): Promise<LegResult> {
  const provider = providerFromEnv(Deno.env.get("ROUTING_PROVIDER"));
  const factor = rushHourFactor(from, to, departAt, settings.rush_hour);
  const withFactor = (leg: LegAnswer, source: Provider, isCached: boolean): LegResult => ({
    km: leg.km,
    minutes: source === "google" ? leg.minutes : Math.round(leg.minutes * factor * 10) / 10,
    source,
    via_expressway: leg.via_expressway,
    factor: source === "google" ? 1 : factor,
    cached: isCached,
  } as LegResult & { cached: boolean });

  if (provider !== "estimate") {
    const key = cacheKey(from, to, opts.avoid_expressway, provider);
    const hit = await cached(db, key).catch(() => null);
    if (hit) return withFactor(hit, provider, true);
    const fresh = await callProvider(db, provider, from, to, departAt, opts);
    if (fresh) {
      await store(db, key, fresh).catch(() => undefined);
      return withFactor(fresh, provider, false);
    }
    // The other provider's cache is better than a guess.
    const other: Provider = provider === "ors" ? "google" : "ors";
    const otherHit = await cached(db, cacheKey(from, to, opts.avoid_expressway, other)).catch(() => null);
    if (otherHit) return withFactor(otherHit, other, true);
  }
  return withFactor(estimateLeg(from, to, settings), "estimate", false);
}

/** The leg function the planner takes, bound to a database and the settings. */
export function legFnFor(db: Db, settings: Settings) {
  return (from: PlanPoint, to: PlanPoint, departAt: string, opts: { avoid_expressway: boolean }) =>
    legMinutes(db, from, to, departAt, opts, settings);
}
