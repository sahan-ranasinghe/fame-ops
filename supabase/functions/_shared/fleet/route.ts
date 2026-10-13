// A driver's route from their phone's points: the line to draw, the timeline
// (driving / stopped / no data), the day's numbers, and the thinning of the
// line by shape. Shared by the connector (driver_route) and the office web app
// and artifact (imported as @fleet/route through a Vite alias). Only the GPS
// drift filter in track.ts is imported, so it runs unchanged in Deno, in the
// browser and in the tests. Times are Unix milliseconds; the callers format.
//
//   line       the positions the drift filter accepted, in time order, with the
//              speed of the step that reached each one (km/h); where the vehicle
//              waited, a second point at the same place marks the end of the
//              wait, so a playback marker stays put for as long as it did
//   segments   "driving" (between stops; traffic lights and short halts are
//              part of driving), "stopped" (10 minutes or more at one place,
//              from the filter), "no_data" (over 10 minutes with no usable fix:
//              no coverage, phone off, the app frozen); a stop that spans a
//              data gap is cut in two around it
//   numbers    km (drift filtered, a little under the odometer), driving and
//              stopped minutes, the number of stops
//
// A fix that repeats the exact coordinates of the fix before it is a cached
// location the phone delivered again (a cell tower's position, a stale fix):
// it is dropped before anything else looks at it.

import { distanceM, type Fix, newTrack, openStop, step, type Stop, type TrackState, usable } from "./track.ts";

/** No usable fix for this long is a gap in the data. */
export const GAP_MINUTES = 10;
/** Douglas–Peucker tolerance: a point further than this from the straight line between its neighbours is a corner worth keeping. */
export const SIMPLIFY_M = 12;
/** The line never has more points than this; the tolerance doubles until it fits. */
export const MAX_LINE_POINTS = 3000;
/** Speed classes for colouring the line (km/h): under 3 standing, under 20 slow, under 60 normal, else fast. */
export const SPEED_SLOW_KMH = 3;
export const SPEED_NORMAL_KMH = 20;
export const SPEED_FAST_KMH = 60;

export type SpeedClass = "stopped" | "slow" | "normal" | "fast";

export function speedClass(kmh: number): SpeedClass {
  if (kmh < SPEED_SLOW_KMH) return "stopped";
  if (kmh < SPEED_NORMAL_KMH) return "slow";
  if (kmh < SPEED_FAST_KMH) return "normal";
  return "fast";
}

export interface LinePoint {
  at: number;
  lat: number;
  lng: number;
  /** Speed over the step that reached this point (from the point before it on the thinned line), km/h; 0 for the first point and for a wait. */
  kmh: number;
}

export type SegmentKind = "driving" | "stopped" | "no_data";

export interface Segment {
  kind: SegmentKind;
  from: number;
  to: number;
  minutes: number;
  /** driving: km of this leg. */
  km?: number;
  /** stopped: where. */
  lat?: number;
  lng?: number;
}

export interface Gap {
  from: number;
  to: number;
  minutes: number;
}

export interface RouteBuild {
  line: LinePoint[];
  segments: Segment[];
  stops: Stop[];
  gaps: Gap[];
  km: number;
  drivingMinutes: number;
  stoppedMinutes: number;
  /** Stops of 10 minutes or more (a stop cut by a data gap counts once). */
  stopsCount: number;
  /** Fixes precise enough to use (under 50 m), after dropping repeats. */
  usable: number;
  /** Repeated cached fixes dropped. */
  repeats: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface BuildOptions {
  simplifyM?: number;
  maxPoints?: number;
}

const minutes = (from: number, to: number) => Math.max(0, Math.round((to - from) / 60000));
const roundKm = (metres: number) => Math.round((metres / 1000) * 10) / 10;

/** Drops a fix that repeats the exact coordinates of the one before it. */
export function dropRepeats(fixes: Fix[]): { fixes: Fix[]; repeats: number } {
  const out: Fix[] = [];
  let repeats = 0;
  let prev: Fix | null = null;
  for (const fix of fixes) {
    if (prev && prev.lat === fix.lat && prev.lng === fix.lng) {
      repeats += 1;
      continue;
    }
    out.push(fix);
    prev = fix;
  }
  return { fixes: out, repeats };
}

/** Douglas–Peucker: which points to keep so that the line stays within `toleranceM` of the original. */
export function simplifyKeep(points: { lat: number; lng: number }[], toleranceM: number): boolean[] {
  const n = points.length;
  const keep = new Array<boolean>(n).fill(false);
  if (n === 0) return keep;
  keep[0] = true;
  keep[n - 1] = true;
  if (n < 3) return keep;
  // Flat metres around the line's mean latitude: plenty for a day's driving.
  const lat0 = (points.reduce((s, p) => s + p.lat, 0) / n) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  const xs = points.map((p) => p.lng * kx);
  const ys = points.map((p) => p.lat * ky);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = toleranceM;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (len2 === 0) d = Math.hypot(xs[i] - xs[a], ys[i] - ys[a]);
      else {
        const t = ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2;
        const u = Math.max(0, Math.min(1, t));
        d = Math.hypot(xs[i] - (xs[a] + u * dx), ys[i] - (ys[a] + u * dy));
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([a, best], [best, b]);
    }
  }
  return keep;
}

/** Thins the line by shape (corners stay, straight runs go), keeping the waits and the first and last point. */
export function simplifyLine(line: LinePoint[], opts: BuildOptions = {}): LinePoint[] {
  let tolerance = opts.simplifyM ?? SIMPLIFY_M;
  const max = opts.maxPoints ?? MAX_LINE_POINTS;
  for (;;) {
    const keep = simplifyKeep(line, tolerance);
    for (let i = 1; i < line.length; i++) {
      // A wait (same place as the point before) is a time anchor: keep it and the point it waits at.
      if (line[i].lat === line[i - 1].lat && line[i].lng === line[i - 1].lng) {
        keep[i] = true;
        keep[i - 1] = true;
      }
    }
    const out = line.filter((_, i) => keep[i]);
    if (out.length <= max || tolerance > 5000) return withSpeeds(out);
    tolerance *= 2;
  }
}

/** The speed of each step of a (thinned) line: distance over time from the point before, km/h; the first point and a wait get 0. */
function withSpeeds(line: LinePoint[]): LinePoint[] {
  return line.map((p, i) => {
    if (i === 0 || p.at <= line[i - 1].at) return { ...p, kmh: 0 };
    return { ...p, kmh: Math.round((distanceM(line[i - 1], p) / ((p.at - line[i - 1].at) / 1000)) * 3.6) };
  });
}

/** The whole route of a list of fixes (any order; sorted here). */
export function buildRoute(input: Fix[], opts: BuildOptions = {}): RouteBuild {
  const sorted = [...input].sort((a, b) => a.at - b.at);
  const { fixes, repeats } = dropRepeats(sorted);
  const state: TrackState = newTrack();
  const line: LinePoint[] = [];
  const stops: Stop[] = [];
  const gaps: Gap[] = [];
  /** Movement accepted, by the time it was accepted at (for the km of each leg). */
  const moves: { at: number; metres: number }[] = [];
  let usableCount = 0;
  let prevUsableAt: number | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  const push = (at: number, lat: number, lng: number) => {
    const prev = line[line.length - 1];
    let kmh = 0;
    if (prev && at > prev.at) kmh = Math.round((distanceM(prev, { lat, lng }) / ((at - prev.at) / 1000)) * 3.6);
    line.push({ at, lat, lng, kmh });
  };

  for (const fix of fixes) {
    if (!usable(fix)) continue;
    usableCount += 1;
    if (firstAt === null) firstAt = fix.at;
    lastAt = fix.at;
    if (prevUsableAt !== null && fix.at - prevUsableAt > GAP_MINUTES * 60000) {
      gaps.push({ from: prevUsableAt, to: fix.at, minutes: minutes(prevUsableAt, fix.at) });
    }
    prevUsableAt = fix.at;

    const waitedUntil = state.lastStill;
    const result = step(state, fix);
    if (result.stop) stops.push(result.stop);
    if (result.accepted) {
      const prev = line[line.length - 1];
      // The vehicle waited at the previous position: mark the end of the wait before the move.
      if (prev && waitedUntil > prev.at && result.verdict !== "first") line.push({ at: waitedUntil, lat: prev.lat, lng: prev.lng, kmh: 0 });
      push(result.accepted.at, result.accepted.lat, result.accepted.lng);
      if (result.movedM > 0) moves.push({ at: result.accepted.at, metres: result.movedM });
    }
  }
  const open = openStop(state);
  if (open) stops.push(open);
  const last = line[line.length - 1];
  if (last && lastAt !== null && lastAt > last.at && state.anchor && state.anchor.lat === last.lat && state.anchor.lng === last.lng) {
    line.push({ at: lastAt, lat: last.lat, lng: last.lng, kmh: 0 });
  }

  const segments = buildSegments(firstAt, lastAt, stops, gaps, moves);
  const km = roundKm(state.metres);
  return {
    line: simplifyLine(line, opts),
    segments,
    stops,
    gaps,
    km,
    drivingMinutes: segments.filter((s) => s.kind === "driving").reduce((s, x) => s + x.minutes, 0),
    stoppedMinutes: segments.filter((s) => s.kind === "stopped").reduce((s, x) => s + x.minutes, 0),
    stopsCount: stops.length,
    usable: usableCount,
    repeats,
    firstAt,
    lastAt,
  };
}

/** Stops and driving legs over the day, then the data gaps cut into them. */
export function buildSegments(
  firstAt: number | null,
  lastAt: number | null,
  stops: Stop[],
  gaps: Gap[],
  moves: { at: number; metres: number }[],
): Segment[] {
  if (firstAt === null || lastAt === null) return [];
  const kmBetween = (from: number, to: number) => roundKm(moves.filter((m) => m.at > from && m.at <= to).reduce((s, m) => s + m.metres, 0));
  const legs: Segment[] = [];
  let cursor = firstAt;
  const ordered = [...stops].sort((a, b) => a.from - b.from);
  const addLeg = (from: number, to: number) => {
    if (to - from < 60000) return;
    const km = kmBetween(from, to);
    legs.push({ kind: "driving", from, to, minutes: minutes(from, to), km });
  };
  for (const stop of ordered) {
    addLeg(cursor, stop.from);
    legs.push({ kind: "stopped", from: stop.from, to: stop.to, minutes: minutes(stop.from, stop.to), lat: stop.lat, lng: stop.lng });
    cursor = stop.to;
  }
  addLeg(cursor, lastAt);

  // Cut every leg around the gaps; a piece under a minute is not worth a row.
  const out: Segment[] = [];
  for (const leg of legs) {
    let piece: Segment | null = { ...leg };
    for (const gap of gaps) {
      if (!piece || gap.to <= piece.from || gap.from >= piece.to) continue;
      const before = { ...piece, to: gap.from, minutes: minutes(piece.from, gap.from) };
      if (before.minutes >= 1) out.push(before.kind === "driving" ? { ...before, km: kmBetween(before.from, before.to) } : before);
      out.push({ kind: "no_data", from: gap.from, to: gap.to, minutes: gap.minutes });
      piece = gap.to < piece.to ? { ...piece, from: gap.to, minutes: minutes(gap.to, piece.to) } : null;
      if (piece && piece.kind === "driving") piece.km = kmBetween(piece.from, piece.to);
    }
    if (piece && piece.minutes >= 1) out.push(piece);
  }
  // A gap that fell between two legs (not inside one) still needs its row.
  for (const gap of gaps) {
    if (!out.some((s) => s.kind === "no_data" && s.from === gap.from)) {
      out.push({ kind: "no_data", from: gap.from, to: gap.to, minutes: gap.minutes });
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The position on the line at a moment, interpolated between the two points around it (for playback). */
export function positionAt(line: LinePoint[], at: number): { lat: number; lng: number; kmh: number } | null {
  if (!line.length) return null;
  if (at <= line[0].at) return { lat: line[0].lat, lng: line[0].lng, kmh: 0 };
  const last = line[line.length - 1];
  if (at >= last.at) return { lat: last.lat, lng: last.lng, kmh: 0 };
  let lo = 0;
  let hi = line.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line[mid].at <= at) lo = mid;
    else hi = mid;
  }
  const a = line[lo];
  const b = line[hi];
  const k = b.at === a.at ? 0 : (at - a.at) / (b.at - a.at);
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, kmh: b.kmh };
}
