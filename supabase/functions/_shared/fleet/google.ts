// The Google package (Phase 6, Part 5; docs/google-maps-setup.md).
//
// One rule for every Google call: it is recorded in the database BEFORE it is made
// (google_take: the feature's count for the Colombo day and month, under the daily cap
// and the monthly ceiling), and it is made only when that answer says allowed. A cap
// reached, an unknown answer or any error reading or writing the counter refuses the
// call (fail closed); the caller then uses the open package (openrouteservice, the
// estimate, the raw GPS line, no Google map) and says why.
//
//   map_loads            one per Maps JavaScript map (the web keeps one map alive per tab;
//                        the browser key is handed out only after the load is recorded)
//   places_autocomplete  Places Autocomplete (New), every request: a session that ends in a
//                        Place Details Essentials call still pays for its first 12 requests
//   places_details       Place Details (New) with the Essentials field mask only (the name comes
//                        from the suggestion; displayName would make the call Pro, and a session
//                        ending in Pro fields is billed as Enterprise + Atmosphere)
//   routes               Routes API computeRoutes, TRAFFIC_AWARE (Compute Routes Pro), one call
//                        per plan or ETA for all its legs
//   roads                Roads API snapToRoads, one call per 100 points
//
// The keys: GOOGLE_MAPS_JS_KEY (the browser key, served to the web app only) and
// GOOGLE_SERVER_KEY (Places, Routes, Roads); with neither, everything is the open package.

import type { Db } from "./db.ts";
import type { PlanPoint } from "./plan.ts";
import type { GoogleCaps, GoogleFeature, Settings } from "./settings.ts";

export const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
export const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/";
export const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
/** Place Details Essentials fields only: displayName would make every call Place Details Pro. */
export const DETAILS_FIELDS = "location,formattedAddress,shortFormattedAddress,addressComponents";
export const AUTOCOMPLETE_FIELDS =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat";
export const ROUTES_FIELDS = "routes.legs.duration,routes.legs.distanceMeters";
/** computeRoutes takes up to 25 intermediates (11 to 25 is Pro, which TRAFFIC_AWARE is anyway). */
export const GOOGLE_MAX_INTERMEDIATES = 25;
/** Google's terms let us keep Places and Routes coordinates for 30 consecutive days. */
export const GOOGLE_COORDS_DAYS = 30;
export const GOOGLE_TIMEOUT_MS = 6000;
/** The map search's bias around the base place. */
export const BIAS_RADIUS_M = 50000;
/** Places content shown off a Google map credits "Google Maps" (the Places policies; the logo where there is room). */
export const GOOGLE_ATTRIBUTION = "Google Maps";

export type Package = "google" | "open";

/** What each part of the app uses now: Google only under the google package and with its key. */
export interface GoogleUse {
  package: Package;
  configured: { js: boolean; server: boolean };
  map: boolean;
  places: boolean;
  routes: boolean;
  /** Snap to roads draws Google geometry: only where the map is Google's too. */
  roads: boolean;
}

export interface KeySource {
  get(name: string): string | undefined;
}

export function googleUse(settings: Pick<Settings, "map_package">, env: KeySource = Deno.env): GoogleUse {
  const js = !!env.get("GOOGLE_MAPS_JS_KEY");
  const server = !!env.get("GOOGLE_SERVER_KEY");
  const on = settings.map_package === "google";
  return {
    package: on && (js || server) ? "google" : "open",
    configured: { js, server },
    map: on && js,
    places: on && server,
    routes: on && server,
    roads: on && server && js,
  };
}

export type RefuseReason = "day" | "month" | "counter";

export interface Gate {
  allowed: boolean;
  reason?: RefuseReason;
  day?: number;
  day_cap?: number;
  month?: number;
  month_cap?: number;
}

export const FEATURE_TEXT: Record<GoogleFeature, string> = {
  map_loads: "Google map",
  places_autocomplete: "Google place search",
  places_details: "Google place details",
  routes: "Google road times",
  roads: "Google snap to roads",
};

/** The sentence the office sees when a feature is refused. */
export function refusedNote(feature: GoogleFeature, reason: RefuseReason | undefined, gate?: Gate): string {
  if (reason !== "counter" && (gate?.day_cap === 0 || gate?.month_cap === 0)) {
    return `${FEATURE_TEXT[feature]} is off: its cap is 0 (Settings → Fleet)`;
  }
  // A refused map load means no map (Google's pages may carry Google content); the rest fall back to the open package.
  const after = feature === "map_loads"
    ? ["back on the 1st", "back tomorrow"]
    : ["the open package until the 1st", "the open package until tomorrow"];
  if (reason === "month") return `${FEATURE_TEXT[feature]} limit reached for this month: ${after[0]}`;
  if (reason === "day") return `${FEATURE_TEXT[feature]} limit reached for today: ${after[1]}`;
  return `${FEATURE_TEXT[feature]} paused: the call counter could not be read`;
}

/**
 * Records one call of the feature and says whether it may be made. Fail closed: any error,
 * an answer of the wrong shape or a throw refuses it.
 */
export async function takeGoogleCall(db: Db, feature: GoogleFeature, caps: GoogleCaps): Promise<Gate> {
  try {
    const cap = caps[feature];
    const { data, error } = await db.rpc("google_take", { p_feature: feature, p_day_cap: cap.day, p_month_cap: cap.month });
    const gate = data as unknown as Gate | null;
    if (error || !gate || typeof gate !== "object" || typeof gate.allowed !== "boolean") {
      if (error) console.error(`google_take ${feature}: ${error.message}`);
      return { allowed: false, reason: "counter" };
    }
    return gate;
  } catch (error) {
    console.error(`google_take ${feature}: ${error instanceof Error ? error.message : String(error)}`);
    return { allowed: false, reason: "counter" };
  }
}

export type Guarded<T> = { ok: true; value: T; gate: Gate } | { ok: false; gate: Gate; note: string; error?: string };

/** The call runs only after it was recorded and allowed; a failed call stays counted (Google may bill it). */
export async function guarded<T>(
  db: Db,
  feature: GoogleFeature,
  caps: GoogleCaps,
  call: () => Promise<T>,
): Promise<Guarded<T>> {
  const gate = await takeGoogleCall(db, feature, caps);
  if (!gate.allowed) return { ok: false, gate, note: refusedNote(feature, gate.reason, gate) };
  try {
    return { ok: true, value: await call(), gate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`google ${feature}: ${message}`);
    return { ok: false, gate, note: `${FEATURE_TEXT[feature]} did not answer`, error: message };
  }
}

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
}

// ---- Places Autocomplete (New) ---------------------------------------------------------------

export interface GooglePrediction {
  place_id: string;
  /** The main text: the place's name, kept as the place's name when it is picked. */
  name: string;
  /** The whole line ("Kandy City Centre, Dalada Veediya, Kandy, Sri Lanka"). */
  label: string;
  /** The second line ("Dalada Veediya, Kandy, Sri Lanka"). */
  secondary?: string;
}

export function autocompleteRequest(text: string, key: string, opts: { session?: string | null; focus?: PlanPoint | null }): HttpRequest {
  const body: Record<string, unknown> = {
    input: text.trim().slice(0, 100),
    includedRegionCodes: ["lk"],
    languageCode: "en",
  };
  if (opts.session) body.sessionToken = opts.session;
  if (opts.focus) {
    body.locationBias = { circle: { center: { latitude: opts.focus.lat, longitude: opts.focus.lng }, radius: BIAS_RADIUS_M } };
  }
  return {
    url: PLACES_AUTOCOMPLETE_URL,
    method: "POST",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": AUTOCOMPLETE_FIELDS, "Content-Type": "application/json" },
    body,
  };
}

export function autocompleteResponse(json: unknown): GooglePrediction[] {
  const suggestions = (json as { suggestions?: unknown[] } | null)?.suggestions;
  if (!Array.isArray(suggestions)) return [];
  const out: GooglePrediction[] = [];
  for (const s of suggestions) {
    const p = (s as {
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }).placePrediction;
    if (!p?.placeId) continue;
    const name = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
    if (!name) continue;
    const secondary = p.structuredFormat?.secondaryText?.text;
    out.push({ place_id: p.placeId, name, label: p.text?.text ?? name, ...(secondary ? { secondary } : {}) });
  }
  return out;
}

// ---- Place Details (New), Essentials ----------------------------------------------------------

export interface GoogleDetails {
  lat: number;
  lng: number;
  address: string | null;
  short_address: string | null;
  district: string | null;
}

export function detailsRequest(placeId: string, key: string, session?: string | null): HttpRequest {
  const q = new URLSearchParams({ languageCode: "en" });
  if (session) q.set("sessionToken", session);
  return {
    url: `${PLACE_DETAILS_URL}${encodeURIComponent(placeId)}?${q.toString()}`,
    method: "GET",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_FIELDS },
  };
}

export function detailsResponse(json: unknown): GoogleDetails {
  const p = json as {
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
    shortFormattedAddress?: string;
    addressComponents?: { longText?: string; types?: string[] }[];
  } | null;
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") throw new Error("Place Details: no location in the answer");
  const district = p?.addressComponents?.find((c) => c.types?.includes("administrative_area_level_2"))?.longText ?? null;
  return {
    lat,
    lng,
    address: p?.formattedAddress ?? null,
    short_address: p?.shortFormattedAddress ?? null,
    district: district ? district.replace(/ District$/, "") : null,
  };
}

// ---- Routes API computeRoutes (Compute Routes Pro: TRAFFIC_AWARE) ---------------------------

export interface RouteLeg {
  km: number;
  minutes: number;
}

/** One call for a whole sequence: the start, the stops in order (intermediates), the last one. */
export function routesRequest(
  points: PlanPoint[],
  departAt: string,
  key: string,
  opts: { avoid_expressway: boolean },
  now = new Date(),
): HttpRequest {
  if (points.length < 2) throw new Error("A route needs two points");
  const at = (p: PlanPoint) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const body: Record<string, unknown> = {
    origin: at(points[0]),
    destination: at(points[points.length - 1]),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };
  if (points.length > 2) body.intermediates = points.slice(1, -1).map(at);
  // Google refuses a departure time in the past; a minute ahead stands for "now".
  if (new Date(departAt).getTime() > now.getTime() + 60000) body.departureTime = new Date(departAt).toISOString();
  if (opts.avoid_expressway) body.routeModifiers = { avoidHighways: true };
  return {
    url: ROUTES_URL,
    method: "POST",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTES_FIELDS, "Content-Type": "application/json" },
    body,
  };
}

export function routesResponse(json: unknown, legs: number): RouteLeg[] {
  const route = (json as { routes?: { legs?: { duration?: string; distanceMeters?: number }[] }[] } | null)?.routes?.[0];
  const out = (route?.legs ?? []).map((l) => {
    const seconds = typeof l.duration === "string" ? Number(l.duration.replace(/s$/, "")) : NaN;
    if (!Number.isFinite(seconds)) throw new Error("Google Routes: a leg without a duration");
    return { km: Math.round((l.distanceMeters ?? 0) / 100) / 10, minutes: Math.round(seconds / 6) / 10 };
  });
  if (out.length !== legs) throw new Error(`Google Routes: ${out.length} legs for ${legs}`);
  return out;
}

// ---- One HTTP call ---------------------------------------------------------------------------------

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function send(req: HttpRequest, fetchFn: Fetcher = fetch): Promise<unknown> {
  const res = await fetchFn(req.url, {
    method: req.method,
    headers: req.headers,
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 160);
    try {
      message = (JSON.parse(text) as { error?: { status?: string; message?: string } }).error?.status ?? message;
    } catch { /* not JSON */ }
    throw new Error(`HTTP ${res.status} ${message}`);
  }
  return text ? JSON.parse(text) : {};
}
