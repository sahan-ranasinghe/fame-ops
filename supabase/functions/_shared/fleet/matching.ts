// Snap to roads (map matching) for the office's route maps, behind the fleet
// setting map_matching.provider: none | google_roads | osrm.
//
//   google_roads  Google Roads API snapToRoads (secret GOOGLE_SERVER_KEY; the google
//                 package, on a Google map only, Part 5): GET with up to 100
//                 points per call and interpolate=true, each call counted before it is
//                 made (the roads cap; refused = the leg stays raw). Every answer point
//                 either belongs to an input point (originalIndex) or is a road vertex
//                 between two; its time is interpolated by distance between the two
//                 input points around it. NEVER STORED (Round 48, Sahan's decision, 28 October
//                 2026: Google's road-snapped lines are display only): the answers live in this
//                 isolate's memory for 30 minutes (googleRoadsStore, at most 200 legs, the least
//                 recently used dropped first), so a page's 60-second refresh does not pay for
//                 the same leg again; a new isolate, or a leg not asked for in 30 minutes, asks
//                 Google again, unless the asker says it holds the line (HeldLine, the tool's snap_held). Before Round
//                 48 they were kept 30 days in route_matched.
//   osrm          a self-hosted OSRM /match (secret OSRM_URL, e.g.
//                 https://osrm.example.com): GET /match/v1/driving/{lng,lat;…}
//                 with timestamps, radiuses (the accuracy) and per-leg distance
//                 annotations; a matching's legs carry the road geometry between
//                 consecutive matched input points, timed the same way.
//
// Before a call a leg is cut where two fixes are 2 minutes or more apart: a longer gap is never bridged along the road
// (it stays dashed), a shorter one is bridged by the matcher. OSRM's pieces are thinned to about one point per 50 m (Phase
// 7, §26) and go in chunks of 100 (about 5 km), consecutive chunks sharing one point. Google's use its documented sparse
// method (the snap cost fix, 2 November 2026): consecutive points up to 300 m apart with the turns kept and interpolate=true
// (thinForRoads), and one request carries up to 100 points of as many pieces as fit (packForRoads): a day's short legs and
// the pieces around a pause share a call, and the road vertices between two pieces are dropped. The answers
// are kept per driving leg (snapLegs: OSRM's in route_matched, Google's in memory). A leg that is still growing (today's last, while the
// driver drives) is sent only in whole chunks: once 100 new thinned points have collected since the last snapped
// one, or when the leg ends; until then the tail since the last snap is drawn raw. A window inside a leg already
// snapped (a task's route, playback) reuses that leg, clipped, so the same road is never paid for twice. Every HTTP
// call is counted per day and provider in routing_calls, like the road-time providers. On any error the leg is
// drawn from the raw GPS line and the legend says so.

import type { Db } from "./db.ts";
import { unwrap } from "./db.ts";
import { refusedNote, takeGoogleCall, takeTripCall } from "./google.ts";
import type { GoogleCaps, MapMatchingProvider } from "./settings.ts";
import { distanceM } from "./track.ts";

export const MATCH_CHUNK = 100;
/** About one point per 50 m: a chunk of 100 covers about 5 km of road. */
export const MATCH_SPACING_M = 50;
export const MATCH_GAP_MS = 2 * 60000;
/** A leg whose match failed is tried again at most this often (a cap refusal costs no call). */
export const MATCH_DEBOUNCE_MS = 2 * 60000;
/**
 * Round 48 snap hotfix (Google's live-tracking guidance; Uber does the same): a leg still growing is snapped
 * incrementally, at most every TAIL_MIN_MS and only once TAIL_MIN_POINTS thinned points are waiting (or a whole chunk),
 * with MATCH_OVERLAP points sent again for a clean join; between refreshes its tail is drawn raw. A 2-hour drive with a
 * point every 20 s costs about 14 Roads calls, whoever watches.
 */
export const TAIL_MIN_MS = 3 * 60000;
export const TAIL_MIN_POINTS = 30;
export const MATCH_OVERLAP = 5;
export const MATCH_TIMEOUT_MS = 8000;
/** Google's guidance for snapToRoads: consecutive points within 300 m of each other, interpolate=true fills in the road. */
export const ROADS_SPACING_M = 300;
/** A bend of at least this many degrees, seen over at least ROADS_TURN_MIN_M either side, keeps its point (GPS noise is shorter). */
export const ROADS_TURN_DEG = 35;
export const ROADS_TURN_MIN_M = 80;
/** A piece that never leaves this radius (a vehicle that stood, GPS drift) has no road to find: it stays raw and costs nothing. */
export const ROADS_MIN_EXTENT_M = 50;
/**
 * The asker already draws the line up to a time (HeldLine): what came after it goes once HELD_MIN_POINTS thinned points wait
 * (about 12 km) or HELD_FLUSH_MS after that line's last call, whichever is first; until then it is drawn raw. A page open all
 * day on a driver who drives all day costs about two calls an hour.
 */
export const HELD_MIN_POINTS = 50;
export const HELD_FLUSH_MS = 30 * 60000;
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

/** About one point per `spacingM` along the line: the first, then each at least that far from the last kept, and the last. */
export function thinBySpacing(points: MatchInput[], spacingM = MATCH_SPACING_M): MatchInput[] {
  if (points.length <= 2) return [...points];
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (distanceM(last, points[i]) >= spacingM) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function bearingOf(a: MatchInput, b: MatchInput): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.atan2(y, x) / rad;
}

/**
 * Google's sparse points: the first and the last; between them the last point before the next would be over `spacingM` from
 * the one kept, and every turn (the bearing changes by ROADS_TURN_DEG, each side at least ROADS_TURN_MIN_M long). A raw gap
 * over the spacing stays as it is. Pure.
 */
export function thinForRoads(points: MatchInput[], spacingM = ROADS_SPACING_M): MatchInput[] {
  if (points.length <= 2) return [...points];
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    const here = distanceM(last, points[i]);
    if (distanceM(last, points[i + 1]) > spacingM) {
      if (here >= 1) out.push(points[i]);
      continue;
    }
    if (here < ROADS_TURN_MIN_M) continue;
    let ahead = i + 1;
    while (ahead < points.length - 1 && distanceM(points[i], points[ahead]) < ROADS_TURN_MIN_M) ahead++;
    if (distanceM(points[i], points[ahead]) < ROADS_TURN_MIN_M) continue;
    const turn = Math.abs(((bearingOf(points[i], points[ahead]) - bearingOf(last, points[i]) + 540) % 360) - 180);
    if (turn >= ROADS_TURN_DEG) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** A leg cut at gaps of 2 minutes or more (on the raw points), in time order; a piece of one point is dropped. */
function piecesOf(points: MatchInput[]): MatchInput[][] {
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
  return pieces;
}

/** OSRM's pieces: each thinned to about 50 m, in chunks of 100 sharing one point. */
export function chunkForMatching(points: MatchInput[]): MatchInput[][] {
  const chunks: MatchInput[][] = [];
  for (const raw of piecesOf(points)) {
    const part = thinBySpacing(raw);
    for (let i = 0; i < part.length - 1; i += MATCH_CHUNK - 1) chunks.push(part.slice(i, i + MATCH_CHUNK));
  }
  return chunks;
}

/**
 * What of a leg's new part goes now (Phase 7, §26): an ended leg sends it all; a leg still growing sends only whole
 * chunks (100 thinned points each, sharing one), up to the time of the last point of the last whole chunk, so watching
 * a driver costs no more than opening the day later. null = wait (the tail is drawn raw meanwhile). Pure.
 */
export function tailToSend(
  tail: MatchInput[],
  legOpen: boolean,
  /** Round 48 snap hotfix: how long ago this leg was last snapped (undefined = never). */
  sinceMs?: number,
  /** How the provider thins (Google's sparse points, OSRM's 50 m). */
  thin: (points: MatchInput[]) => MatchInput[] = thinBySpacing,
): { points: MatchInput[]; upTo: number } | null {
  if (tail.length < 2) return null;
  if (!legOpen) return { points: tail, upTo: tail[tail.length - 1].at };
  const thinned = thin(tail);
  const whole = Math.floor((thinned.length - 1) / (MATCH_CHUNK - 1));
  if (whole >= 1) {
    const upTo = thinned[whole * (MATCH_CHUNK - 1)].at;
    return { points: tail.filter((p) => p.at <= upTo), upTo };
  }
  // Less than a chunk waiting: it goes once TAIL_MIN_MS passed since the last snap and TAIL_MIN_POINTS are waiting
  // (a leg never snapped waits for the points alone), so a watcher's minute poll costs nothing in between.
  const due = sinceMs === undefined || sinceMs >= TAIL_MIN_MS;
  if (due && thinned.length >= TAIL_MIN_POINTS) return { points: tail, upTo: tail[tail.length - 1].at };
  return null;
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

interface RoadsVertex {
  lat: number;
  lng: number;
  index: number | null;
}

function roadsVertices(json: unknown): RoadsVertex[] {
  const snapped = (json as { snappedPoints?: { location?: { latitude?: number; longitude?: number }; originalIndex?: number }[] })
    ?.snappedPoints;
  if (!Array.isArray(snapped)) throw new Error("Google Roads: no snappedPoints in the answer");
  const vertices = snapped.map((s) => ({
    lat: Number(s.location?.latitude),
    lng: Number(s.location?.longitude),
    index: typeof s.originalIndex === "number" ? s.originalIndex : null,
  }));
  if (vertices.some((v) => !isFinite(v.lat) || !isFinite(v.lng))) throw new Error("Google Roads: a point without coordinates");
  return vertices;
}

/** snappedPoints with originalIndex for the input points, road vertices between them (interpolate=true). */
export function googleRoadsResponse(json: unknown, points: MatchInput[]): MatchedPoint[] {
  return timedVertices(roadsVertices(json), points);
}

function timedVertices(vertices: RoadsVertex[], points: MatchInput[]): MatchedPoint[] {
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
  if (a?.code !== "Ok" || !Array.isArray(a.matchings)) {
    throw new Error(`OSRM: ${a?.code ?? "no answer"}${a?.message ? ` ${a.message}` : ""}`);
  }
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

/** One Roads request: up to 100 points, and which leg (job) each run of them belongs to. */
export interface RoadsRequest {
  points: MatchInput[];
  runs: { job: number; start: number; end: number }[];
}

/**
 * What the legs cost: every piece thinned (thinForRoads), then packed in order into requests of up to 100 points. The next
 * piece joins the request while it starts within ROADS_SPACING_M of the last point (a stop or a pause between them: Google
 * sees one path, and the road between the two pieces is dropped from the answer); a jump over that starts a new request, as
 * a path with a long jump in it snaps badly. A piece longer than the room left goes on in the next request, sharing a point.
 */
export function packForRoads(jobs: MatchInput[][]): RoadsRequest[] {
  const requests: RoadsRequest[] = [];
  let cur: RoadsRequest = { points: [], runs: [] };
  const flush = () => {
    if (cur.points.length) requests.push(cur);
    cur = { points: [], runs: [] };
  };
  jobs.forEach((points, job) => {
    for (const raw of piecesOf(points)) {
      if (raw.every((p) => distanceM(raw[0], p) < ROADS_MIN_EXTENT_M)) continue;
      const piece = thinForRoads(raw);
      const lastPoint = cur.points[cur.points.length - 1];
      if (lastPoint && (distanceM(lastPoint, piece[0]) > ROADS_SPACING_M || cur.points.length > MATCH_CHUNK - 2)) flush();
      let i = 0;
      while (i < piece.length - 1 || cur.points.length === 0) {
        const take = piece.slice(i, i + MATCH_CHUNK - cur.points.length);
        cur.runs.push({ job, start: cur.points.length, end: cur.points.length + take.length - 1 });
        cur.points.push(...take);
        i += take.length;
        if (i >= piece.length) break;
        flush();
        i -= 1; // The next request starts on this request's last point.
      }
    }
  });
  flush();
  return requests;
}

/** A request's answer, run by run: each run's anchors and the road between them; the road between two runs is dropped. */
export function roadsRuns(json: unknown, request: RoadsRequest): { job: number; points: MatchedPoint[] }[] {
  const vertices = roadsVertices(json);
  return request.runs.map((run) => {
    const inRun = (v: RoadsVertex) => v.index !== null && v.index >= run.start && v.index <= run.end;
    const first = vertices.findIndex(inRun);
    const last = vertices.findLastIndex(inRun);
    return { job: run.job, points: first < 0 ? [] : timedVertices(vertices.slice(first, last + 1), request.points) };
  });
}

/**
 * The legs' new parts through Google in as few requests as they fit: each job's points in time order, or its error. Stops at
 * the first refusal or failure: what is left stays raw until the next try, and nothing more is paid while Google says no.
 */
async function matchRoads(
  jobs: MatchInput[][],
  env: MatchEnv,
  fetchFn: Fetcher,
  onCall: (ok: boolean) => Promise<void> | void,
  gate: () => Promise<string | null>,
): Promise<{ matched: MatchedPoint[][]; errors: Map<number, Error> }> {
  const matched: MatchedPoint[][] = jobs.map(() => []);
  const errors = new Map<number, Error>();
  const requests = packForRoads(jobs);
  for (let r = 0; r < requests.length; r++) {
    const request = requests[r];
    try {
      if (!env.key) throw new Error("GOOGLE_SERVER_KEY is not set");
      const refused = await gate();
      if (refused) throw new Error(refused);
      let json: unknown;
      try {
        const res = await fetchFn(googleRoadsRequest(request.points, env.key), { signal: AbortSignal.timeout(MATCH_TIMEOUT_MS) });
        json = await res.json();
        if (!res.ok) throw new Error(`google_roads ${res.status}`);
        await onCall(true);
      } catch (error) {
        await onCall(false);
        throw error;
      }
      for (const run of roadsRuns(json, request)) {
        const lastAt = matched[run.job].length ? matched[run.job][matched[run.job].length - 1].at : -Infinity;
        matched[run.job].push(...run.points.filter((p) => p.at > lastAt));
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const left of requests.slice(r)) for (const run of left.runs) errors.set(run.job, failure);
      break;
    }
  }
  return { matched, errors };
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
  /** Asked before each HTTP call (Google's cap); a refusal throws its note and the leg stays raw. */
  gate: () => Promise<string | null> = () => Promise.resolve(null),
): Promise<MatchedPoint[]> {
  if (provider === "google_roads" && !env.key) throw new Error("GOOGLE_SERVER_KEY is not set");
  if (provider === "osrm" && !env.url) throw new Error("OSRM_URL is not set");
  if (provider === "google_roads") {
    const { matched, errors } = await matchRoads([points], env, fetchFn, onCall, gate);
    const failure = errors.get(0);
    if (failure) throw failure;
    return matched[0];
  }
  const out: MatchedPoint[] = [];
  for (const chunk of chunkForMatching(points)) {
    const refused = await gate();
    if (refused) throw new Error(refused);
    const url = osrmRequest(chunk, env.url!);
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
    const matched = osrmResponse(json, chunk);
    const lastAt = out.length ? out[out.length - 1].at : -Infinity;
    out.push(...matched.filter((p) => p.at > lastAt));
  }
  return out;
}

export interface SnapLeg {
  from: number;
  to: number;
  points: MatchInput[];
  /** Still growing (today's last leg while the driver drives): its new part goes only in whole chunks. */
  open?: boolean;
}

export interface SnappedLeg {
  from: number;
  to: number;
  /** matched: the road geometry; raw: the provider failed (or had nothing), draw the GPS line. */
  source: "matched" | "raw";
  points: MatchedPoint[];
  /** matched: up to when the stored answer covers the leg (the tail of a growing leg after it is drawn raw). */
  matchedTo?: number;
}

export interface SnapResult {
  status: "ok" | "partial" | "failed";
  legs: SnappedLeg[];
  /** How many legs went to the provider in this answer (a held line's last call moves only when some did). */
  sent: number;
}

/** The asker already draws the snapped line up to `to` (the page's own copy): only what came after it is needed. */
export interface HeldLine {
  to: number;
  /** When that line's last call was made. */
  snappedAt: number;
}

function envFor(): MatchEnv {
  return { key: Deno.env.get("GOOGLE_SERVER_KEY") ?? undefined, url: Deno.env.get("OSRM_URL") ?? undefined };
}

/** A leg's last match, however it is kept: times as Unix ms, the geometry as points. */
export interface StoredLeg {
  legFrom: number;
  legTo: number;
  geometry: MatchedPoint[];
  matchedAt: number;
  status: "ok" | "failed";
  error: string | null;
}

/** Where a provider's matched legs are kept: OSRM's in route_matched, Google's in this isolate's memory (never the database). */
export interface MatchStore {
  load(employeeId: string, date: string, now: number): Promise<StoredLeg[]>;
  save(employeeId: string, date: string, leg: StoredLeg): Promise<void>;
  /** A match of a stored leg's new part failed: the leg keeps its road, its matched_at and error move on (the debounce). */
  tried(employeeId: string, date: string, legFrom: number, matchedAt: number, error: string): Promise<void>;
}

/** How long a Google-snapped leg stays in memory after it was last matched. */
export const GOOGLE_MEMORY_TTL_MS = 30 * 60000;
/** How many Google-snapped legs the memory holds at most (an isolate serves one project; a day has a handful of legs). */
export const GOOGLE_MEMORY_MAX = 200;

/**
 * The in-memory store (Round 48): a Map in insertion order used as an LRU: a read moves the leg to the end, a write past
 * the limit drops the first (the least recently used), and a leg older than the TTL since its last match is dropped
 * when read. Nothing outlives the isolate. Never Google's lines in the database (the Roads API's terms allow caching for
 * display, which Sahan chose not to use beyond the page's refresh).
 */
export class MemoryMatchStore implements MatchStore {
  private readonly legs = new Map<string, StoredLeg>();
  constructor(private readonly max = GOOGLE_MEMORY_MAX, private readonly ttlMs = GOOGLE_MEMORY_TTL_MS) {}
  private key(employeeId: string, date: string, legFrom: number) {
    return `${employeeId}|${date}|${legFrom}`;
  }
  size(): number {
    return this.legs.size;
  }
  clear(): void {
    this.legs.clear();
  }
  load(employeeId: string, date: string, now: number): Promise<StoredLeg[]> {
    const prefix = `${employeeId}|${date}|`;
    const out: StoredLeg[] = [];
    for (const [k, leg] of [...this.legs]) {
      if (!k.startsWith(prefix)) continue;
      if (now - leg.matchedAt >= this.ttlMs) {
        this.legs.delete(k);
        continue;
      }
      // Read: the leg becomes the most recently used.
      this.legs.delete(k);
      this.legs.set(k, leg);
      out.push(leg);
    }
    return Promise.resolve(out);
  }
  save(employeeId: string, date: string, leg: StoredLeg): Promise<void> {
    const k = this.key(employeeId, date, leg.legFrom);
    this.legs.delete(k);
    this.legs.set(k, leg);
    while (this.legs.size > this.max) this.legs.delete(this.legs.keys().next().value as string);
    return Promise.resolve();
  }
  tried(employeeId: string, date: string, legFrom: number, matchedAt: number, error: string): Promise<void> {
    const leg = this.legs.get(this.key(employeeId, date, legFrom));
    if (leg) return this.save(employeeId, date, { ...leg, matchedAt, error });
    return Promise.resolve();
  }
}

/** Google's road-snapped legs for this isolate: memory only. */
export const googleRoadsStore = new MemoryMatchStore();

/** route_matched, as before Round 48, for the providers whose lines we may keep (OSRM: our own server's answers). */
export function dbMatchStore(db: Db, provider: Exclude<MapMatchingProvider, "none" | "google_roads">): MatchStore {
  return {
    async load(employeeId, date) {
      const rows = unwrap(
        await db.from("route_matched").select("leg_from, leg_to, geometry, matched_at, status, error")
          .eq("employee_id", employeeId).eq("date", date).eq("provider", provider),
        "matched routes",
      );
      return rows.map((r): StoredLeg => ({
        legFrom: new Date(r.leg_from).getTime(),
        legTo: new Date(r.leg_to).getTime(),
        geometry: geometryOf(r.geometry),
        matchedAt: new Date(r.matched_at).getTime(),
        status: r.status === "ok" ? "ok" : "failed",
        error: r.error ?? null,
      }));
    },
    async save(employeeId, date, leg) {
      await db.from("route_matched").upsert({
        employee_id: employeeId,
        date,
        provider,
        leg_from: new Date(leg.legFrom).toISOString(),
        leg_to: new Date(leg.legTo).toISOString(),
        geometry: leg.geometry.map((p) => [p.at, r6(p.lat), r6(p.lng)]),
        matched_at: new Date(leg.matchedAt).toISOString(),
        status: leg.status,
        error: leg.error,
      }, { onConflict: "employee_id,date,provider,leg_from" });
    },
    async tried(employeeId, date, legFrom, matchedAt, error) {
      await db.from("route_matched").update({ matched_at: new Date(matchedAt).toISOString(), error })
        .eq("employee_id", employeeId).eq("date", date).eq("provider", provider).eq("leg_from", new Date(legFrom).toISOString())
        .then(() => undefined, () => undefined);
    },
  };
}

/** The store for a provider: Google's answers never reach the database (Round 48). */
export function storeFor(db: Db, provider: Exclude<MapMatchingProvider, "none">): MatchStore {
  return provider === "google_roads" ? googleRoadsStore : dbMatchStore(db, provider);
}

/**
 * The driving legs of a day matched to roads, through the provider's store: a leg matched before with the same
 * end is reused, and a window inside a stored leg is that leg clipped; a leg that grew sends only its new part, in
 * whole chunks while it is still growing (the rest raw meanwhile); a failed leg stays raw (tried again after 2 min).
 * Google's legs come from and go to this isolate's memory only (googleRoadsStore); OSRM's from route_matched.
 */
export async function snapLegs(
  db: Db,
  employeeId: string,
  date: string,
  provider: Exclude<MapMatchingProvider, "none">,
  legs: SnapLeg[],
  now: Date,
  fetchFn: Fetcher = fetch,
  /** Google's caps: every snapToRoads call is recorded before it is made. */
  caps?: GoogleCaps,
  store: MatchStore = storeFor(db, provider),
  /** Round 48 snap hotfix: the source counted with each Google call, and the per-driver-day budget taken before it. */
  opts: { source?: string; budget?: { employeeId: string; cap: number }; held?: HeldLine } = {},
): Promise<SnapResult> {
  const env = envFor();
  const gate = async (): Promise<string | null> => {
    if (provider !== "google_roads") return null;
    if (!caps) return refusedNote("roads", "counter");
    if (opts.budget) {
      const b = await takeTripCall(db, opts.budget.employeeId, opts.budget.cap);
      if (!b.allowed) return refusedNote("roads", b.reason === "trip" ? "trip" : "counter");
    }
    const g = await takeGoogleCall(db, "roads", caps, opts.source);
    return g.allowed ? null : refusedNote("roads", g.reason, g);
  };
  const rows = await store.load(employeeId, date, now.getTime());
  const byFrom = new Map(rows.map((r) => [r.legFrom, r]));
  const bump = async (ok: boolean): Promise<void> => {
    await db.rpc("bump_routing_calls", { p_provider: provider, p_ok: ok }).then(() => undefined, () => undefined);
  };
  const thin = provider === "google_roads" ? thinForRoads : thinBySpacing;
  const held = opts.held;
  const out: SnappedLeg[] = [];
  let failed = 0;
  const jobs: {
    slot: number;
    leg: SnapLeg;
    stored: MatchedPoint[];
    haveTo: number | null;
    send: { points: MatchInput[]; upTo: number };
    /** Only the part after a line the asker holds: not a whole leg, so it is not kept for the next viewer. */
    partial: boolean;
  }[] = [];
  for (const leg of legs) {
    // A window inside a leg snapped before (a task's route, playback): that leg's road, clipped. Never paid twice.
    const covering = rows.find((r) => r.status === "ok" && r.legFrom <= leg.from && r.legTo >= leg.to && r.legFrom !== leg.from);
    if (covering) {
      const clipped = covering.geometry.filter((p) => p.at >= leg.from && p.at <= leg.to);
      // A window so short that no road vertex falls inside it is drawn raw: it is not worth a call.
      if (clipped.length >= 2) out.push({ from: leg.from, to: leg.to, source: "matched", points: clipped, matchedTo: leg.to });
      else out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
      continue;
    }
    const have = byFrom.get(leg.from);
    const haveTo = have ? have.legTo : null;
    const recent = have ? now.getTime() - have.matchedAt < MATCH_DEBOUNCE_MS : false;
    if (have && have.status === "ok" && haveTo !== null && haveTo >= leg.to) {
      out.push({ from: leg.from, to: leg.to, source: "matched", points: have.geometry, matchedTo: Math.min(haveTo, leg.to) });
      continue;
    }
    if (have && have.status !== "ok" && recent) {
      failed += 1;
      out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
      continue;
    }
    // A leg that grew since its last match: only the new part goes out, joined to the stored one, and while the leg
    // is still growing only in whole chunks (the tail is drawn raw meanwhile). A leg the asker holds part of starts after
    // that part, when this isolate has nothing further.
    const partial = !!held && leg.from < held.to && (!have || have.status !== "ok" || haveTo! < held.to);
    const stored = !partial && have && have.status === "ok" && haveTo !== null && haveTo < leg.to ? have.geometry : [];
    const from = partial ? held!.to : stored.length ? haveTo! : null;
    // A finished leg with nothing after what is matched is done: a leg's end can lie past its last line point (the line
    // leaves out a vehicle slowing to a stop). Before this every refresh paid for that leg's last points again, for good.
    if (from !== null && !leg.open && !leg.points.some((p) => p.at > from)) {
      out.push({ from: leg.from, to: leg.to, source: "matched", points: stored, matchedTo: leg.to });
      continue;
    }
    // The tail since the last snap, with a few points before it sent again for a clean join (the answer's points up
    // to the last stored one are dropped below).
    const firstNew = from !== null ? leg.points.findIndex((p) => p.at >= from) : 0;
    const tail = from !== null ? (firstNew < 0 ? [] : leg.points.slice(Math.max(0, firstNew - MATCH_OVERLAP))) : leg.points;
    const send = held
      ? (tail.length >= 2 ? { points: tail, upTo: tail[tail.length - 1].at } : null)
      : tailToSend(tail, leg.open === true, have ? now.getTime() - have.matchedAt : undefined, thin);
    if (!send) {
      if (stored.length) out.push({ from: leg.from, to: leg.to, source: "matched", points: stored, matchedTo: haveTo! });
      else out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
      continue;
    }
    jobs.push({ slot: out.length, leg, stored, haveTo, send, partial });
    out.push({ from: leg.from, to: leg.to, source: "raw", points: leg.points });
  }
  // Someone who holds the line waits: what came after it goes once it is worth a call.
  const waits = !!held && now.getTime() - held.snappedAt < HELD_FLUSH_MS &&
    jobs.reduce((n, j) => n + thin(j.send.points).length, 0) < HELD_MIN_POINTS;
  if (waits) {
    for (const j of jobs) {
      if (j.stored.length) out[j.slot] = { from: j.leg.from, to: j.leg.to, source: "matched", points: j.stored, matchedTo: j.haveTo! };
    }
    return { status: failed === 0 ? "ok" : failed === legs.length ? "failed" : "partial", legs: out, sent: 0 };
  }
  const results = new Map<number, MatchedPoint[] | Error>();
  if (provider === "google_roads") {
    const { matched, errors } = await matchRoads(jobs.map((j) => j.send.points), env, fetchFn, bump, gate);
    jobs.forEach((_, i) => results.set(i, errors.get(i) ?? matched[i]));
  } else {
    for (let i = 0; i < jobs.length; i++) {
      results.set(
        i,
        await matchPoints(provider, jobs[i].send.points, env, fetchFn, bump, gate)
          .catch((error) => (error instanceof Error ? error : new Error(String(error)))),
      );
    }
  }
  for (let i = 0; i < jobs.length; i++) {
    const { slot, leg, stored, haveTo, send, partial } = jobs[i];
    const result = results.get(i)!;
    if (!(result instanceof Error)) {
      // A finished leg is matched to its end, whatever its last line point's time.
      const upTo = leg.open ? send.upTo : leg.to;
      const lastAt = stored.length ? stored[stored.length - 1].at : -Infinity;
      const points = [...stored, ...result.filter((p) => p.at > lastAt)];
      // Up to the last point sent: a growing leg's tail after it waits for its next whole chunk.
      if (!partial) {
        await store.save(employeeId, date, {
          legFrom: leg.from,
          legTo: upTo,
          geometry: points,
          matchedAt: now.getTime(),
          status: "ok",
          error: null,
        });
      }
      out[slot] = { from: leg.from, to: leg.to, source: "matched", points, matchedTo: upTo };
      continue;
    }
    failed += 1;
    const message = result.message;
    console.error(`map matching ${provider}: ${message}`);
    if (stored.length) {
      // The part matched before stays; the new part is raw until the next try.
      await store.tried(employeeId, date, leg.from, now.getTime(), message.slice(0, 200));
      out[slot] = { from: leg.from, to: leg.to, source: "matched", points: stored, matchedTo: haveTo! };
      continue;
    }
    if (partial) continue;
    await store.save(employeeId, date, {
      legFrom: leg.from,
      legTo: leg.to,
      geometry: [],
      matchedAt: now.getTime(),
      status: "failed",
      error: message.slice(0, 200),
    })
      .catch(() => undefined);
  }
  return { status: failed === 0 ? "ok" : failed === legs.length ? "failed" : "partial", legs: out, sent: jobs.length };
}

function geometryOf(geometry: unknown): MatchedPoint[] {
  if (!Array.isArray(geometry)) return [];
  return geometry
    .filter((g): g is [number, number, number] => Array.isArray(g) && g.length === 3 && g.every((n) => typeof n === "number"))
    .map(([at, lat, lng]) => ({ at, lat, lng }));
}
