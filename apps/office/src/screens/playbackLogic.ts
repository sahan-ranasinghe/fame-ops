// Playback on a constant time scale (Phase 7, §22), the maths only (pure):
// - The path the marker follows: the drawn line (the snapped one where the
//   answer has it) in time order; a gap with an estimated road line follows
//   that line, its time spread along it by distance over the gap's whole
//   duration; a gap without one is the straight dashed hole.
// - The position at a time t: interpolated along the path between its two
//   neighbouring points, so it is continuous in time (never jumps: points that
//   share a time are spread between the times around them); still at a stop;
//   heading = the direction of the path there (kept through a stop);
//   `estimated` inside a gap (a hole, an estimated line, or a timeline row of no
//   GPS or no app), drawn hollow.
// - The clock: recorded time moves on by each animation frame's real time × the
//   speed (1×, 5×, 20×, 60×), so a full pass at 60× takes the day's span ÷ 60.
import { colomboClockS } from "@fleet/status";
import { distanceM } from "@fleet/track";
import type { Route } from "../data/route";

type LatLng = { lat: number; lng: number };

export const SPEEDS = [1, 5, 20, 60] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

/** A frame longer than this (a tab in the background, a stall) moves the clock this much only: the marker never leaps. */
export const MAX_FRAME_MS = 250;

export interface PathPoint {
  at: number;
  lat: number;
  lng: number;
  /** The step reaching this point runs along a gap's estimated road line. */
  est?: boolean;
}

/** A window of recorded time with no real position: the marker is estimated (hollow) inside it. */
export interface GapWindow {
  fromAt: number;
  toAt: number;
}

/** An estimated road line over a gap between two line points (driver_route estimate_gaps). */
export interface EstimatedLine extends GapWindow {
  points: LatLng[];
}

/** Within a second of each other: an estimated line's ends and the line points it joins. */
const SAME_MS = 1000;

/**
 * The path for a line and its gaps' estimated lines: the points in time order (exact repeats dropped), each estimated
 * line put between the two line points it joins with its points timed along it by distance, and every run of points
 * sharing one time spread between the times around it (by distance), so the position never jumps.
 */
export function playbackPath(line: { at: number; lat: number; lng: number }[], estimated: EstimatedLine[] = []): PathPoint[] {
  const sorted = [...line].filter((p) => isFinite(p.at) && isFinite(p.lat) && isFinite(p.lng)).sort((a, b) => a.at - b.at);
  const out: PathPoint[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.at === p.at && prev.lat === p.lat && prev.lng === p.lng) continue;
    if (prev) {
      const e = estimated.find((x) => Math.abs(x.fromAt - prev.at) < SAME_MS && Math.abs(x.toAt - p.at) < SAME_MS && x.points.length > 1);
      if (e && p.at > prev.at) {
        // The road line's own ends are the two line points (or close to them): only its inside points are added.
        const inner = e.points.slice(1, -1);
        const chain: LatLng[] = [prev, ...inner, p];
        let total = 0;
        const cum = [0];
        for (let i = 1; i < chain.length; i++) {
          total += distanceM(chain[i - 1], chain[i]);
          cum.push(total);
        }
        for (let i = 1; i < chain.length - 1; i++) {
          const k = total > 0 ? cum[i] / total : i / (chain.length - 1);
          out.push({ at: prev.at + (p.at - prev.at) * k, lat: chain[i].lat, lng: chain[i].lng, est: true });
        }
        out.push({ at: p.at, lat: p.lat, lng: p.lng, est: true });
        continue;
      }
    }
    out.push({ at: p.at, lat: p.lat, lng: p.lng });
  }
  return spreadTies(out);
}

/** Points sharing a time are spread over the time before it (by distance), the first of the path over the time after. */
function spreadTies(path: PathPoint[]): PathPoint[] {
  const out = path.map((p) => ({ ...p }));
  let i = 1;
  while (i < out.length) {
    if (out[i].at !== out[i - 1].at) {
      i++;
      continue;
    }
    // A run out[j..k] at one time (j = i - 1).
    const j = i - 1;
    let k = i;
    while (k + 1 < out.length && out[k + 1].at === out[j].at) k++;
    const t = out[j].at;
    if (j > 0) {
      // Spread out[j..k-1] between the time before (out[j-1]) and t; out[k] stays at t.
      const t0 = out[j - 1].at;
      const chain = out.slice(j - 1, k + 1);
      spreadBetween(chain, t0, t);
      for (let m = j; m < k; m++) out[m].at = chain[m - j + 1].at;
    } else if (k + 1 < out.length) {
      // The path starts with a run: spread out[1..k] between t and the time after.
      const t1 = out[k + 1].at;
      const chain = out.slice(0, k + 2);
      spreadBetween(chain, t, t1);
      for (let m = 1; m <= k; m++) out[m].at = chain[m].at;
    }
    i = k + 1;
  }
  return out;
}

/** Times along a chain from t0 (its first point) to t1 (its last), in proportion to the distance; a chain that does not move, evenly. */
function spreadBetween(chain: PathPoint[], t0: number, t1: number) {
  const cum = [0];
  for (let i = 1; i < chain.length; i++) cum.push(cum[i - 1] + distanceM(chain[i - 1], chain[i]));
  const total = cum[cum.length - 1];
  const n = chain.length - 1;
  // Evenly by count when nothing moves; a tiny share per tie otherwise keeps every step's time positive.
  for (let i = 1; i < n; i++) {
    const k = total > 0 ? cum[i] / total : i / n;
    chain[i] = { ...chain[i], at: t0 + (t1 - t0) * Math.min(1 - 1e-6, Math.max(1e-6, k)) };
  }
  chain[n] = { ...chain[n], at: t1 };
}

/** The bearing from a to b in degrees (0 = north, clockwise). */
export function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** A step shorter than this does not turn the marker (GPS jitter at a stop). */
const TURN_MIN_M = 3;

/** The direction of the path at step i (the step from i-1 to i), or the last one before it that moved, else the first after. */
function headingAt(path: PathPoint[], i: number): number | null {
  for (let s = i; s >= 1; s--) if (distanceM(path[s - 1], path[s]) >= TURN_MIN_M) return bearing(path[s - 1], path[s]);
  for (let s = i + 1; s < path.length; s++) if (distanceM(path[s - 1], path[s]) >= TURN_MIN_M) return bearing(path[s - 1], path[s]);
  return null;
}

export interface Position {
  lat: number;
  lng: number;
  /** The path's direction, degrees from north; null when the path never moves. */
  heading: number | null;
  /** In a gap: no real position (drawn hollow, the clock says "estimated"). */
  estimated: boolean;
}

/** Is t inside a gap window (from inclusive, to exclusive). */
export const inGap = (windows: GapWindow[], t: number) => windows.some((w) => t >= w.fromAt && t < w.toAt);

/** The marker at time t: interpolated along the path (clamped to its ends). */
export function positionOn(path: PathPoint[], t: number, windows: GapWindow[] = []): Position | null {
  if (!path.length) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (path.length === 1 || t <= first.at) return { lat: first.lat, lng: first.lng, heading: headingAt(path, 1), estimated: inGap(windows, t) };
  if (t >= last.at) return { lat: last.lat, lng: last.lng, heading: headingAt(path, path.length - 1), estimated: inGap(windows, t) };
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].at <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
  return {
    lat: a.lat + (b.lat - a.lat) * k,
    lng: a.lng + (b.lng - a.lng) * k,
    heading: headingAt(path, hi),
    estimated: !!b.est || inGap(windows, t),
  };
}

/** The recorded clock after one animation frame: frameMs of real time × the speed, never past the end. */
export function advance(t: number, frameMs: number, speed: number, end: number): number {
  const real = Math.max(0, Math.min(MAX_FRAME_MS, frameMs));
  return Math.min(end, t + real * speed);
}

/**
 * The windows with no real position on a route: the tool's holes, the estimated lines, and the timeline rows with no GPS
 * fix or no app (the marker stays where the line says, hollow).
 */
export function gapWindowsOf(route: Route | null): GapWindow[] {
  if (!route) return [];
  const out: GapWindow[] = [];
  for (const h of route.holes) out.push({ fromAt: h.fromAt, toAt: h.toAt });
  for (const e of route.estimated ?? []) out.push({ fromAt: e.fromAt, toAt: e.toAt });
  for (const r of route.timeline) if (r.kind === "no_data" || r.kind === "no_gps") out.push({ fromAt: r.fromAt, toAt: r.toAt });
  return out.filter((w) => isFinite(w.fromAt) && isFinite(w.toAt) && w.toAt > w.fromAt).sort((a, b) => a.fromAt - b.fromAt);
}

/** The clock's words: the recorded time "14:32:05", plus "estimated" in a gap. */
export const clockText = (t: number, estimated: boolean) => `${colomboClockS(new Date(t).toISOString())}${estimated ? " · estimated" : ""}`;
