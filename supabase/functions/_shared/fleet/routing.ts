// Road time and distance for one leg (the open package):
//   ors       openrouteservice Directions v2 on api.heigit.org, the deprecated
//             api.openrouteservice.org only on a 404 or 410 (orsHosts.ts; secret
//             ORS_KEY; free plan: 2,000 a day, 40 a minute); coordinates are [lng, lat] in the request and
//             the response; avoid_features ["highways"] when the task avoids the
//             expressway; waycategory tells whether the leg uses one
//   estimate  straight line × road_factor ÷ avg_speed_kmh (no key needed)
// ROUTING_PROVIDER picks one; unset means estimate (an old "google" value means ors:
// Google is the map package's now). ors answers are cached 30 days by rounded
// coordinates (route_legs); the rush-hour factor is applied after the cache. On any
// error: the cache, then the estimate, and the leg says which (source). The calls are
// counted per day and provider (routing_calls); ors stops at ORS_DAILY_BUDGET and
// ORS_PER_MINUTE.
//
// Under the google package (Part 5) a plan or an ETA first asks Google's Routes API once
// for all its legs (googleLegs: computeRoutes TRAFFIC_AWARE with the stops as intermediates,
// counted before the call, never cached: the Routes terms allow keeping only coordinates);
// the planner's passes then read those legs (memoLegFn), and any leg Google did not answer
// comes from the chain above.

import type { Db } from "./db.ts";
import { unwrap, unwrapMaybe } from "./db.ts";
import { haversineKm } from "./geo.ts";
import { type Fetcher, GOOGLE_MAX_INTERMEDIATES, googleUse, guarded, routesRequest, routesResponse, send } from "./google.ts";
import type { LegFn, LegResult, LegSource, PlanPoint } from "./plan.ts";
import type { RushHour, Settings } from "./settings.ts";
import { ORS_DIRECTIONS_URLS, orsFetch } from "./orsHosts.ts";

export type Provider = LegSource;

/** The new host's directions URL (orsHosts.ts has the fallback). */
export const ORS_URL = ORS_DIRECTIONS_URLS[0];
export const ORS_DAILY_BUDGET = 1900;
export const ORS_PER_MINUTE = 40;
export const CACHE_DAYS = 30;
export const TIMEOUT_MS = 5000;
/** The highway bit of an openrouteservice waycategory value. */
const ORS_HIGHWAY_BIT = 1;
const COLOMBO_OFFSET_MS = 5.5 * 3600000;

export function providerFromEnv(value: string | undefined | null): "ors" | "estimate" {
  const v = (value ?? "").trim().toLowerCase();
  return v === "ors" || v === "google" ? "ors" : "estimate";
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

async function callOrs(
  db: Db,
  from: PlanPoint,
  to: PlanPoint,
  opts: { avoid_expressway: boolean },
): Promise<LegAnswer | null> {
  const key = Deno.env.get("ORS_KEY");
  if (!key) return null;
  if ((await callsToday(db, "ors")) >= ORS_DAILY_BUDGET || !orsMinute()) return null;
  const req = orsRequest(from, to, opts, key);
  try {
    const init = { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: AbortSignal.timeout(TIMEOUT_MS) };
    const res = await orsFetch(ORS_DIRECTIONS_URLS, init);
    const json = await res.json();
    if (!res.ok) throw new Error(`ors ${res.status}`);
    const leg = orsResponse(json);
    await bump(db, "ors", true);
    return leg;
  } catch (error) {
    console.error(`routing ors: ${error instanceof Error ? error.message : String(error)}`);
    await bump(db, "ors", false);
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
    minutes: Math.round(leg.minutes * factor * 10) / 10,
    source,
    via_expressway: leg.via_expressway,
    factor,
    cached: isCached,
  } as LegResult & { cached: boolean });

  if (provider === "ors") {
    const key = cacheKey(from, to, opts.avoid_expressway, "ors");
    const hit = await cached(db, key).catch(() => null);
    if (hit) return withFactor(hit, "ors", true);
    const fresh = await callOrs(db, from, to, opts);
    if (fresh) {
      await store(db, key, fresh).catch(() => undefined);
      return withFactor(fresh, "ors", false);
    }
  }
  return withFactor(estimateLeg(from, to, settings), "estimate", false);
}

/** The key of a leg between two points, for the legs one Google call answered. */
export const legKey = (from: PlanPoint, to: PlanPoint) => `${from.lat},${from.lng}>${to.lat},${to.lng}`;

/**
 * Every leg of a sequence of points from one Google Routes call (TRAFFIC_AWARE, the stops as
 * intermediates), recorded before it is made (routes cap); a note instead when Google is not in
 * use, refused or failed. The answer is used for this plan or ETA only, never stored as a cache.
 */
export async function googleLegs(
  db: Db,
  settings: Settings,
  points: PlanPoint[],
  departAt: string,
  opts: { avoid_expressway: boolean },
  now: Date,
  fetchFn: Fetcher = fetch,
): Promise<{ legs: Map<string, LegResult> } | { note: string }> {
  const key = Deno.env.get("GOOGLE_SERVER_KEY");
  if (!googleUse(settings).routes || !key) return { note: "Google road times are not in use" };
  if (points.length < 2) return { legs: new Map() };
  if (points.length - 2 > GOOGLE_MAX_INTERMEDIATES) return { note: "Too many stops for one Google call" };
  const r = await guarded(db, "routes", settings.google_caps, async () =>
    routesResponse(await send(routesRequest(points, departAt, key, opts, now), fetchFn), points.length - 1));
  if (!r.ok) return { note: r.note };
  const legs = new Map<string, LegResult>();
  r.value.forEach((leg, i) => {
    legs.set(legKey(points[i], points[i + 1]), { km: leg.km, minutes: leg.minutes, source: "google", via_expressway: null, factor: 1 });
  });
  return { legs };
}

/** A leg function that answers from one Google call's legs, and from `fallback` for any other. */
export function memoLegFn(legs: Map<string, LegResult>, fallback: LegFn): LegFn {
  return (from, to, departAt, opts) => {
    const hit = legs.get(legKey(from, to));
    return hit ? Promise.resolve(hit) : fallback(from, to, departAt, opts);
  };
}

/** The estimate alone (no calls): the rough pass that finds when a Google-planned trip leaves. */
export function estimateLegFn(settings: Settings): LegFn {
  return (from, to, departAt) => {
    const leg = estimateLeg(from, to, settings);
    const factor = rushHourFactor(from, to, departAt, settings.rush_hour);
    return Promise.resolve({ km: leg.km, minutes: Math.round(leg.minutes * factor * 10) / 10, source: "estimate", via_expressway: null, factor });
  };
}

/** The leg function the planner takes, bound to a database and the settings. */
export function legFnFor(db: Db, settings: Settings) {
  return (from: PlanPoint, to: PlanPoint, departAt: string, opts: { avoid_expressway: boolean }) =>
    legMinutes(db, from, to, departAt, opts, settings);
}
