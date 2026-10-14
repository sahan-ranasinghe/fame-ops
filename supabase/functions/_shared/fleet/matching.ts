// Snap to roads (map matching) for the office's route maps, behind the fleet
// setting map_matching.provider: none | google_roads | osrm.
//
//   google_roads  Google Roads API snapToRoads (secret GOOGLE_ROADS_KEY): GET
//                 with up to 100 points per call and interpolate=true. Every
//                 answer point either belongs to an input point (originalIndex)
//                 or is a road vertex between two; its time is interpolated by
//                 distance between the two input points around it.
//   osrm          a self-hosted OSRM /match (secret OSRM_URL, e.g.
//                 https://osrm.example.com): GET /match/v1/driving/{lng,lat;…}
//                 with timestamps, radiuses (the accuracy) and per-leg distance
//                 annotations; a matching's legs carry the road geometry between
//                 consecutive matched input points, timed the same way.
//
// Before a call a leg is thinned (Douglas–Peucker 5 m) and cut where two fixes
// are 2 minutes or more apart: a longer gap is never bridged along the road
// (it stays dashed), a shorter one is bridged by the matcher. Each piece goes
// in chunks of 100 points, consecutive chunks sharing one point. The answers
// are stored per driving leg in route_matched (snapLegs); a leg that is still
// growing (today) is matched again at most every 2 minutes. Every HTTP call is
// counted per day and provider in routing_calls, like the road-time providers.
// On any error the leg is drawn from the raw GPS line and the legend says so.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import { simplifyKeep } from "./route.ts";
import type { MapMatchingProvider } from "./settings.ts";
import { distanceM } from "./track.ts";

export const MATCH_CHUNK = 100;
export const MATCH_SIMPLIFY_M = 5;
export const MATCH_GAP_MS = 2 * 60000;
export const MATCH_DEBOUNCE_MS = 2 * 60000;
export const MATCH_TIMEOUT_MS = 8000;
export const GOOGLE_ROADS_URL = "https://roads.googleapis.com/v1/snapToRoads";

export interface MatchInput {
  at: number;
  lat: number;
  lng: number;
  acc?: number | null;
}

export interface MatchedPoint {
  at: number;
  lat: number;
  lng: number;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The pieces to send: cut at gaps of 2 minutes or more (on the raw points), each thinned to 5 m, in chunks of 100 sharing one point. */
export function chunkForMatching(points: MatchInput[]): MatchInput[][] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const pieces: MatchInput[][] = [];
  let piece: MatchInput[] = [];
  for (const p of sorted) {
    const last = piece[piece.length - 1];
    if (last && p.at - last.at >= MATCH_GAP_MS) {
      if (piece.length >= 2) pieces.push(piece);
      piece = [];
    }
    piece.push(p);
  }
  if (piece.length >= 2) pieces.push(piece);
  const chunks: MatchInput[][] = [];
  for (const raw of pieces) {
    const keep = simplifyKeep(raw, MATCH_SIMPLIFY_M);
    const part = raw.filter((_, i) => keep[i]);
    for (let i = 0; i < part.length - 1; i += MATCH_CHUNK - 1) chunks.push(part.slice(i, i + MATCH_CHUNK));
  }
  return chunks;
}

/** Times for a run of road vertices between two timed anchors, by cumulative distance. */
function timeAlong(coords: { lat: number; lng: number }[], fromAt: number, toAt: number, distances?: number[]): MatchedPoint[] {
  const steps = distances && distances.length === coords.length - 1 ? distances : coords.slice(1).map((c, i) => distanceM(coords[i], c));
  const total = steps.reduce((s, d) => s + d, 0);
  const out: MatchedPoint[] = [];
  let gone = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) gone += steps[i - 1];
    const k = total > 0 ? gone / total : i / Math.max(1, coords.length - 1);
    out.push({ at: Math.round(fromAt + (toAt - fromAt) * k), lat: coords[i].lat, lng: coords[i].lng });
  }
  return out;
}

export function googleRoadsRequest(points: MatchInput[], key: string): string {
  const path = points.map((p) => `${r6(p.lat)},${r6(p.lng)}`).join("|");
  return `${GOOGLE_ROADS_URL}?interpolate=true&path=${encodeURIComponent(path)}&key=${encodeURIComponent(key)}`;
}

/** snappedPoints with originalIndex for the input points, road vertices between them (interpolate=true). */
export function googleRoadsResponse(json: unknown, points: MatchInput[]): MatchedPoint[] {
  const snapped = (json as { snappedPoints?: { location?: { latitude?: number; longitude?: number }; originalIndex?: number }[] })
    ?.snappedPoints;
  if (!Array.isArray(snapped)) throw new Error("Google Roads: no snappedPoints in the answer");
  const vertices = snapped.map((s) => ({
    lat: Number(s.location?.latitude),
    lng: Number(s.location?.longitude),
    index: typeof s.originalIndex === "number" ? s.originalIndex : null,
  }));
  if (vertices.some((v) => !isFinite(v.lat) || !isFinite(v.lng))) throw new Error("Google Roads: a point without coordinates");
  const out: MatchedPoint[] = [];
  let runStart = 0;
  let prevAnchor: { pos: number; at: number } | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v.index === null) continue;
    const at = points[v.index]?.at;
    if (at === undefined) throw new Error("Google Roads: originalIndex out of range");
    const run = vertices.slice(prevAnchor ? prevAnchor.pos : runStart, i + 1);
    if (prevAnchor) out.push(...timeAlong(run, prevAnchor.at, at).slice(1));
    else out.push(...run.map((c) => ({ at, lat: c.lat, lng: c.lng })));
    prevAnchor = { pos: i, at };
    runStart = i + 1;
  }
  if (prevAnchor && prevAnchor.pos < vertices.length - 1) {
    out.push(...vertices.slice(prevAnchor.pos + 1).map((c) => ({ at: prevAnchor!.at, lat: c.lat, lng: c.lng })));
  }
  return out;
}

export function osrmRequest(points: MatchInput[], baseUrl: string): string {
  const coords = points.map((p) => `${r6(p.lng)},${r6(p.lat)}`).join(";");
  const timestamps = points.map((p) => Math.round(p.at / 1000)).join(";");
  const radiuses = points.map((p) => Math.min(50, Math.max(5, Math.round(p.acc ?? 10)))).join(";");
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/match/v1/driving/${coords}?geometries=geojson&overview=full&annotations=distance&tidy=true&timestamps=${timestamps}&radiuses=${radiuses}`;
}

interface OsrmAnswer {
  code?: string;
  message?: string;
  matchings?: { geometry?: { coordinates?: [number, number][] }; legs?: { annotation?: { distance?: number[] } }[] }[];
  tracepoints?: ({ matchings_index?: number; waypoint_index?: number } | null)[];
}

/** The matchings' road geometry, each leg between two matched input points, timed by the leg's distances. */
export function osrmResponse(json: unknown, points: MatchInput[]): MatchedPoint[] {
  const a = json as OsrmAnswer;
  if (a?.code !== "Ok" || !Array.isArray(a.matchings)) throw new Error(`OSRM: ${a?.code ?? "no answer"}${a?.message ? ` ${a.message}` : ""}`);
  const out: MatchedPoint[] = [];
  a.matchings.forEach((m, mi) => {
    const anchors = (a.tracepoints ?? [])
      .map((t, i) => (t && t.matchings_index === mi ? { at: points[i]?.at, wi: t.waypoint_index ?? 0 } : null))
      .filter((x): x is { at: number; wi: number } => x !== null && typeof x.at === "number")
      .sort((x, y) => x.wi - y.wi);
    const coords = (m.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
    const legs = m.legs ?? [];
    if (coords.length < 2 || anchors.length < 2) return;
    let idx = 0;
    for (let j = 0; j < legs.length && j + 1 < anchors.length; j++) {
      const dists = legs[j].annotation?.distance;
      const n = dists?.length ?? Math.max(1, Math.floor((coords.length - 1) / legs.length));
      const run = coords.slice(idx, idx + n + 1);
      if (run.length < 2) break;
      const timed = timeAlong(run, anchors[j].at, anchors[j + 1].at, dists);
      out.push(...(out.length ? timed.slice(1) : timed));
      idx += n;
    }
  });
  if (out.length === 0) throw new Error("OSRM: no matched geometry");
  return out;
}

export interface MatchEnv {
  key?: string;
  url?: string;
}

/**
 * Matches one leg: every chunk through the provider, answers joined in time order.
 * `onCall(ok)` counts each HTTP call. Throws on the first failed call.
 */
export async function matchPoints(
  provider: Exclude<MapMatchingProvider, "none">,
  points: MatchInput[],
  env: MatchEnv,
  fetchFn: Fetcher = fetch,
  onCall: (ok: boolean) => Promise<void> | void = () => undefined,
): Promise<MatchedPoint[]> {
  if (provider === "google_roads" && !env.key) throw new Error("GOOGLE_ROADS_KEY is not set");
  if (provider === "osrm" && !env.url) throw new Error("OSRM_URL is not set");
  const out: MatchedPoint[] = [];
  for (const chunk of chunkForMatching(points)) {
    const url = provider === "google_roads" ? googleRoadsRequest(chunk, env.key!) : osrmRequest(chunk, env.url!);
    let json: unknown;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(MATCH_TIMEOUT_MS) });
      json = await res.json();
      if (!res.ok) throw new Error(`${provider} ${res.status}`);
      await onCall(true);
    } catch (error) {
      await onCall(false);
      throw error;
    }
    const matched = provider === "google_roads" ? googleRoadsResponse(json, chunk) : osrmResponse(json, chunk);
    const lastAt = out.length ? out[out.length - 1].at : -Infinity;
    out.push(...matched.filter((p) => p.at > lastAt));
  }
  return out;
}

export interface SnapLeg {
  from: number;
  to: number;
  points: MatchInput[];
}

export interface SnappedLeg {
  from: number;
  to: number;
  /** matched: the road geometry; raw: the provider failed (or had nothing), draw the GPS line. */
  source: "matched" | "raw";
  points: MatchedPoint[];
  /** matched: up to when the stored answer covers the leg (a growing leg is matched again at most every 2 minutes). */
  matchedTo?: number;
}

export interface SnapResult {
  status: "ok" | "partial" | "failed";
  legs: SnappedLeg[];
}

function envFor(provider: MapMatchingProvider): MatchEnv {
  return { key: Deno.env.get("GOOGLE_ROADS_KEY") ?? undefined, url: Deno.env.get("OSRM_URL") ?? undefined };
}

/**
 * The driving legs of a day matched to roads, through the route_matched store: a leg matched before with
 * the same end is reused; a leg that grew is matched again only when its last match is over 2 minutes old
 * (until then the stored part is used and the rest is raw); a failed leg stays raw.
 */
export async function snapLegs(
  db: Db,
  employeeId: string,
  date: string,
  provider: Exclude<MapMatchingProvider, "none">,
  legs: SnapLeg[],
  now: Date,
  fetchFn: Fetcher = fetch,
): Promise<SnapResult> {
  const env = envFor(provider);
  const stored = unwrap(
    await db.from("route_matched").select("leg_from, leg_to, geometry, matched_at, status")
      .eq("employee_id", employeeId).eq("date", date).eq("provider", provider),
    "matched routes",
  );
  const byFrom = new Map(stored.map((r) => [new Date(r.leg_from).getTime(), r]));
  const bump = async (ok: boolean): Promise<void> => {
    await db.rpc("bump_routing_calls", { p_provider: provider, p_ok: ok }).then(() => undefined, () => undefined);
  };
  const out: SnappedLeg[] = [];
  let failed = 0;
  for (const leg of legs) {
    const have = byFrom.get(leg.from);
    const haveTo = have ? new Date(have.leg_to).getTime() : null;
    const recent = have ? now.getTime() - new Date(have.matched_at).getTime() < MATCH_DEBOUNCE_MS : false;
    if (have && have.status === "ok" && haveTo !== null && (haveTo >= leg.to || recent)) {
      out.push({ from: leg.from, to: leg.to, source: "matched", points: geometryOf(have.geometry), matchedTo: Math.min(haveTo, leg.to) });
      continue;
    }
    if (have && have.status !== "ok" && recent) {
      failed += 1;
      out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
      continue;
    }
    try {
      const points = await matchPoints(provider, leg.points, env, fetchFn, bump);
      await db.from("route_matched").upsert({
        employee_id: employeeId,
        date,
        provider,
        leg_from: new Date(leg.from).toISOString(),
        leg_to: new Date(leg.to).toISOString(),
        geometry: points.map((p) => [p.at, r6(p.lat), r6(p.lng)]),
        matched_at: now.toISOString(),
        status: "ok",
        error: null,
      }, { onConflict: "employee_id,date,provider,leg_from" });
      out.push({ from: leg.from, to: leg.to, source: "matched", points, matchedTo: leg.to });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`map matching ${provider}: ${message}`);
      await db.from("route_matched").upsert({
        employee_id: employeeId,
        date,
        provider,
        leg_from: new Date(leg.from).toISOString(),
        leg_to: new Date(leg.to).toISOString(),
        geometry: [],
        matched_at: now.toISOString(),
        status: "failed",
        error: message.slice(0, 200),
      }, { onConflict: "employee_id,date,provider,leg_from" }).then(() => undefined, () => undefined);
      out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
    }
  }
  return { status: failed === 0 ? "ok" : failed === legs.length ? "failed" : "partial", legs: out };
}

function geometryOf(geometry: unknown): MatchedPoint[] {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .filter((g): g is [number, number, number] => Array.isArray(g) && g.length === 3 && g.every((n) => typeof n === "number"))
    .map(([at, lat, lng]) => ({ at, lat, lng }));
}
