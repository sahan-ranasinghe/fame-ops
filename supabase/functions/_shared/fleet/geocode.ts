// Public places for the location search box (Phase 6, Part 4): the third layer
// after our own places and the places used before. One provider interface so
// the open package (openrouteservice's geocode autocomplete, the existing
// ORS_KEY) can later be replaced by Google Places Autocomplete under
// map_package google.
//
//   ors     GET api.heigit.org/pelias/v1/autocomplete (the deprecated
//           api.openrouteservice.org/geocode/autocomplete only on a 404 or 410:
//           orsHosts.ts), boundary.country=LK, focus.point = the base place, size
//           8, from 3 characters. Answers are cached 30 days per normalised text
//           (geocode_cache) and counted per day in routing_calls (provider
//           ors_autocomplete) and per minute in api_minute_calls; the cache never
//           counts. The dashboard's Geocoding quota (3,000 a day, 100 a minute) is
//           shared by autocomplete, search and reverse, so the box stops at
//           ors_autocomplete_daily_cap (2,500) with "Map search limit reached for
//           today", and at ors_autocomplete_per_minute (90) with "Map search is
//           busy, try again in a minute". Results carry their attribution (OpenStreetMap contributors,
//           and so on) and may be saved as places (storable).
//   google  (not built) Places Autocomplete (New) with a session token per typing
//           session; predictions carry no coordinates, the pick asks Place
//           Details with the same token (one billed session); Google's terms
//           forbid keeping its coordinates beyond caching and showing them on
//           other maps, so a Google pick is `storable: false`: the stop keeps
//           the place id and the name, the pin is fetched again when needed, and
//           it is drawn on Google tiles only. The cache below would then hold
//           only the place ids (allowed), never the coordinates.

import type { Db } from "./db.ts";
import { ORS_AUTOCOMPLETE_URLS, orsFetch } from "./orsHosts.ts";

export const PUBLIC_MIN_CHARS = 3;
export const PUBLIC_SIZE = 8;
export const CACHE_DAYS = 30;
export const ORS_AUTOCOMPLETE_URL = ORS_AUTOCOMPLETE_URLS[0];
export const BUSY_NOTE = "Map search is busy, try again in a minute";
export const COUNTER = "ors_autocomplete";
export const LIMIT_NOTE = "Map search limit reached for today";

export interface PublicPlace {
  provider: "ors" | "google";
  /** The provider's id for the place (ORS gid, Google place id). */
  ref: string;
  name: string;
  /** The longer line: "Kandy City Centre, Kandy, Central Province". */
  label: string;
  lat?: number;
  lng?: number;
  /** Whom to credit when it is shown or saved. */
  attribution: string;
  /** May be saved as one of our places with its coordinates (false for Google). */
  storable: boolean;
}

export interface PublicSearch {
  places: PublicPlace[];
  /** Why there is nothing from the map today: the limit, no key, the provider failing. */
  note?: string;
  /** Served from the 30-day cache (no call counted). */
  cached?: boolean;
}

export interface Focus {
  lat: number;
  lng: number;
}

/** Lower case, accents kept, punctuation to spaces, single spaces: the cache key. */
export function normaliseQuery(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const SOURCE_CREDIT: Record<string, string> = {
  openstreetmap: "© OpenStreetMap contributors",
  openaddresses: "OpenAddresses",
  whosonfirst: "Who's On First",
  geonames: "GeoNames",
};

/** openrouteservice's GeoJSON answer → public places (no coordinates, no place). */
export function orsPlaces(answer: unknown): PublicPlace[] {
  const features = (answer as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PublicPlace[] = [];
  for (const f of features) {
    const feature = f as { geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> };
    const [lng, lat] = (feature.geometry?.coordinates ?? []) as number[];
    const p = feature.properties ?? {};
    const name = typeof p.name === "string" ? p.name : "";
    if (!name || typeof lat !== "number" || typeof lng !== "number") continue;
    const source = typeof p.source === "string" ? p.source : "";
    out.push({
      provider: "ors",
      ref: typeof p.gid === "string" ? p.gid : typeof p.id === "string" ? p.id : `${lat},${lng}`,
      name,
      label: typeof p.label === "string" ? p.label : name,
      lat,
      lng,
      attribution: `${SOURCE_CREDIT[source] ?? source}${SOURCE_CREDIT[source] || source ? " · " : ""}openrouteservice`,
      storable: true,
    });
  }
  return out;
}

export interface OrsDeps {
  db: Db;
  key: string | undefined;
  cap: number;
  /** Calls a minute at most (the throttle). */
  perMinute: number;
  focus: Focus | null;
  now: Date;
  fetch?: typeof fetch;
}

const today = (now: Date) => new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

/** Public places for a text: the cache, else one counted call while under the daily cap. */
export async function orsAutocomplete(text: string, deps: OrsDeps): Promise<PublicSearch> {
  const query = normaliseQuery(text);
  if (query.length < PUBLIC_MIN_CHARS) return { places: [] };
  const { db, now } = deps;
  const since = new Date(now.getTime() - CACHE_DAYS * 86400000).toISOString();
  const hit = await db.from("geocode_cache").select("answer, fetched_at").eq("provider", "ors").eq("query", query).gte("fetched_at", since)
    .maybeSingle();
  if (!hit.error && hit.data) return { places: (hit.data.answer as unknown as PublicPlace[]) ?? [], cached: true };
  if (!deps.key) return { places: [], note: "Map search is not set up" };
  const used = await db.from("routing_calls").select("calls").eq("day", today(now)).eq("provider", COUNTER).maybeSingle();
  if ((used.data?.calls ?? 0) >= deps.cap) return { places: [], note: LIMIT_NOTE };
  // The throttle: this call's number in the current minute (counted whether or not it goes out).
  const minute = await db.rpc("bump_minute_calls", { p_provider: COUNTER });
  if (!minute.error && typeof minute.data === "number" && minute.data > deps.perMinute) return { places: [], note: BUSY_NOTE };
  const params = new URLSearchParams();
  params.set("text", text.trim().slice(0, 100));
  params.set("boundary.country", "LK");
  params.set("size", String(PUBLIC_SIZE));
  if (deps.focus) {
    params.set("focus.point.lat", String(deps.focus.lat));
    params.set("focus.point.lon", String(deps.focus.lng));
  }
  let ok = false;
  let places: PublicPlace[] = [];
  let note: string | undefined;
  try {
    const res = await orsFetch(
      ORS_AUTOCOMPLETE_URLS,
      { headers: { Authorization: deps.key, Accept: "application/json" }, signal: AbortSignal.timeout(6000) },
      `?${params.toString()}`,
      deps.fetch,
    );
    if (res.status === 429) note = BUSY_NOTE;
    else if (!res.ok) note = "Map search did not answer";
    else {
      places = orsPlaces(await res.json());
      ok = true;
    }
  } catch {
    note = "Map search did not answer";
  }
  await db.rpc("bump_routing_calls", { p_provider: COUNTER, p_ok: ok }).then(() => undefined, () => undefined);
  if (ok) {
    await db.from("geocode_cache").upsert({ provider: "ors", query, answer: places as unknown as never, fetched_at: now.toISOString() }, {
      onConflict: "provider,query",
    })
      .then(() => undefined, () => undefined);
  }
  return note ? { places, note } : { places };
}
