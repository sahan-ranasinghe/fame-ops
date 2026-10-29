// The estimated line of a gap (Phase 6, Part 5b): where two consecutive points of a route are
// over 300 m and 60 s apart (the phone lost its fixes while the vehicle moved), the route views
// draw the likely road between them, dashed and labelled "estimated", instead of a straight
// line. openrouteservice driving (the GeoJSON directions, api.heigit.org), one call per gap,
// cached 30 days by the gap's ends rounded to 4 decimals (route_gap_lines). Never used for km:
// the km stay those of the recorded points.
//
// The calls are counted per day as ors_gap in routing_calls, under their own cap
// (ors_gap_daily_cap, 300 by default) and, with the road times' ors calls, under the directions
// budget (ORS_DAILY_BUDGET of openrouteservice's 2,000 a day); at most 25 new gaps per route
// asked, and the 40 a minute shared with the road times. Over a cap, without a key or on an
// error, the gap stays a straight dashed line and the answer says why.
// Round 49: a gap with no road near one of its ends (a poor fix off the road: openrouteservice's 2010, "Could not find
// routable point") is an answer, not an error: counted as a call made, cached 30 days as an empty line (geometry []) so
// no view asks again, and drawn straight with its own note. Only that answer is kept: any other failure is an error and
// is asked again next time, as before.

import type { Db } from "./db.ts";
import { ORS_GEOJSON_URLS, orsErrorCode, orsFetch, orsNotRoutable } from "./orsHosts.ts";
import type { Jump } from "./route.ts";
import { simplifyKeep } from "./route.ts";
import { bump, callsToday, ORS_DAILY_BUDGET, orsMinute, TIMEOUT_MS } from "./routing.ts";
import type { Settings } from "./settings.ts";

export const GAP_PROVIDER = "ors_gap";
export const GAP_NEW_PER_ROUTE = 25;
export const GAP_CACHE_DAYS = 30;
export const GAP_SIMPLIFY_M = 8;
export const GAP_MAX_POINTS = 400;
/** The counter could not be read: no call is made (fail closed). */
export const COUNTER_NOTE = "Estimated lines paused: the call counter could not be read; the gaps are straight";
/** Gaps whose end has no road nearby (a poor GPS fix): known from the cache or the answer, never asked again for 30 days. */
export const NO_ROAD_NOTE = "Some gaps have no road near a GPS point (a poor fix): they are straight";

export interface EstimatedLine {
  from: number;
  to: number;
  /** [lat, lng] along the road. */
  points: [number, number][];
  /** The road's length (for the label only; never added to the km). */
  km: number | null;
  cached: boolean;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function gapKey(j: Pick<Jump, "fromPoint" | "toPoint">) {
  return { from_lat: r4(j.fromPoint.lat), from_lng: r4(j.fromPoint.lng), to_lat: r4(j.toPoint.lat), to_lng: r4(j.toPoint.lng) };
}

/** The request body: [lng, lat] pairs, the fastest road, no instructions. */
export function gapRequestBody(j: Pick<Jump, "fromPoint" | "toPoint">) {
  return {
    coordinates: [[j.fromPoint.lng, j.fromPoint.lat], [j.toPoint.lng, j.toPoint.lat]],
    preference: "fastest",
    instructions: false,
  };
}

/** The GeoJSON answer's line as [lat, lng], thinned to 8 m (at most 400 points), and its km. */
export function gapGeometry(json: unknown): { points: [number, number][]; km: number | null } {
  const f = (json as { features?: { geometry?: { coordinates?: number[][] }; properties?: { summary?: { distance?: number } } }[] } | null)
    ?.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) throw new Error("openrouteservice: no line in the answer");
  const all = coords.filter((c) => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number").map((c) => ({
    lat: c[1],
    lng: c[0],
  }));
  let tolerance = GAP_SIMPLIFY_M;
  let kept = all;
  for (let i = 0; i < 6; i++) {
    const keep = simplifyKeep(all, tolerance);
    kept = all.filter((_, k) => keep[k]);
    if (kept.length <= GAP_MAX_POINTS) break;
    tolerance *= 2;
  }
  const distance = f?.properties?.summary?.distance;
  return {
    points: kept.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]),
    km: typeof distance === "number" ? Math.round(distance / 100) / 10 : null,
  };
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** The estimated lines of a route's jumps: the cache, then new calls while the caps allow. */
export async function estimatedLines(
  db: Db,
  settings: Pick<Settings, "ors_gap_daily_cap">,
  jumps: Jump[],
  now: Date,
  fetchFn: Fetcher = (url, init) => fetch(url, init),
): Promise<{ lines: EstimatedLine[]; note?: string }> {
  if (jumps.length === 0) return { lines: [] };
  const since = new Date(now.getTime() - GAP_CACHE_DAYS * 86400000).toISOString();
  const lines: EstimatedLine[] = [];
  const misses: Jump[] = [];
  let noRoad = 0;
  for (const j of jumps) {
    const k = gapKey(j);
    const { data } = await db.from("route_gap_lines").select("geometry, km").match(k).gte("fetched_at", since).maybeSingle();
    if (data && Array.isArray(data.geometry)) {
      // An empty line = openrouteservice said no road is near one end: straight, and not asked again.
      if (data.geometry.length === 0) noRoad += 1;
      else lines.push({ from: j.from, to: j.to, points: data.geometry as [number, number][], km: data.km, cached: true });
    } else misses.push(j);
  }
  if (misses.length === 0) return { lines, ...(noRoad ? { note: NO_ROAD_NOTE } : {}) };
  const key = Deno.env.get("ORS_KEY");
  if (!key) return { lines, note: "Estimated lines need the openrouteservice key: the other gaps are straight" };
  let note: string | undefined;
  let made = 0;
  for (const j of misses) {
    if (made >= GAP_NEW_PER_ROUTE) {
      note = `${misses.length - made} more gaps are straight: at most ${GAP_NEW_PER_ROUTE} new estimated lines a view`;
      break;
    }
    // The counters first; one that cannot be read means no call (Round 48, fail closed): the gaps stay straight.
    let mine: number;
    let ors: number;
    try {
      [mine, ors] = await Promise.all([callsToday(db, GAP_PROVIDER), callsToday(db, "ors")]);
    } catch (error) {
      console.error(`gap line: the call counter could not be read: ${error instanceof Error ? error.message : String(error)}`);
      note = COUNTER_NOTE;
      break;
    }
    if (mine >= settings.ors_gap_daily_cap || mine + ors >= ORS_DAILY_BUDGET) {
      note = "Estimated line limit reached for today: the other gaps are straight";
      break;
    }
    if (!orsMinute()) {
      note = "openrouteservice is busy: the other gaps are straight for now";
      break;
    }
    made += 1;
    try {
      const res = await orsFetch(
        ORS_GEOJSON_URLS,
        {
          method: "POST",
          headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
          body: JSON.stringify(gapRequestBody(j)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        "",
        fetchFn as typeof fetch,
        // The new host's 404 or 410 was a request too: counted as failed before the old host is tried.
        () => bump(db, GAP_PROVIDER, false),
      );
      const json = await res.json();
      const code = orsErrorCode(json);
      if (!res.ok && orsNotRoutable(json)) {
        // No road near one end: openrouteservice's real answer. Counted as made, kept as an empty line for 30 days.
        await bump(db, GAP_PROVIDER, true);
        await db.from("route_gap_lines").upsert({ ...gapKey(j), geometry: [], km: null, provider: "ors", fetched_at: now.toISOString() }, {
          onConflict: "from_lat,from_lng,to_lat,to_lng",
        }).then(() => undefined, () => undefined);
        noRoad += 1;
        continue;
      }
      if (!res.ok) throw new Error(`ors ${res.status}${code !== null ? ` (${code})` : ""}`);
      const g = gapGeometry(json);
      await bump(db, GAP_PROVIDER, true);
      await db.from("route_gap_lines").upsert({
        ...gapKey(j),
        geometry: g.points,
        km: g.km,
        provider: "ors",
        fetched_at: now.toISOString(),
      }, {
        onConflict: "from_lat,from_lng,to_lat,to_lng",
      }).then(() => undefined, () => undefined);
      lines.push({ from: j.from, to: j.to, points: g.points, km: g.km, cached: false });
    } catch (error) {
      console.error(`gap line: ${error instanceof Error ? error.message : String(error)}`);
      await bump(db, GAP_PROVIDER, false);
      note = "openrouteservice did not answer for some gaps: they are straight";
    }
  }
  return { lines: lines.sort((a, b) => a.from - b.from), note: note ?? (noRoad ? NO_ROAD_NOTE : undefined) };
}
