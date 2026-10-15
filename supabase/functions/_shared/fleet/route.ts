// A driver's route from their phone's points: the line to draw, the timeline
// (driving / stopped / no GPS / app not running), the day's numbers, and the
// thinning of the line by shape. Shared by the connector (driver_route) and the
// office web app and artifact (imported as @fleet/route through a Vite alias).
// Only the GPS drift filter in track.ts is imported, so it runs unchanged in
// Deno, in the browser and in the tests. Times are Unix milliseconds; the
// callers format.
//
// The phone stores every fix with an accuracy of 150 m or better (one a minute
// while parked, every fix while moving); the rules live here, on the server:
//
//   outliers   a fix that would need over 150 km/h from the fix before it, and
//              an "out-and-back" spike (a fix far from both its neighbours while
//              they are close to each other) are dropped before anything else
//              (dropOutliers, used for the km and for the line alike)
//   km         the drift filter (track.ts) over the fixes under 50 m, raw
//              positions, nothing smoothed: a little under the odometer
//   line       the positions the drift filter accepted, each with its accuracy;
//              where the vehicle waited a minute or more, a second point at the
//              same place marks the end of the wait. Fixes between 50 and 150 m
//              fill only the stretches with no precise fix (drawn thin and
//              lighter). A display-only smoothing (3 points, weighted by
//              accuracy, each point moved at most its own accuracy) takes the
//              GPS wobble out; then the line is thinned by shape
//   holes      over 2 minutes between two line points at different places: the
//              map draws a dashed straight segment, labelled by its kind
//   segments   "driving" (between stops), "stopped" (10 minutes or more at one
//              place; stops with under 100 m of movement between them are one
//              stay), "no_gps" (over 10 minutes with no precise fix while the
//              phone kept sending heartbeats: no GPS signal) and "no_data" (no
//              heartbeats either: the app was not running). A leg whose points
//              reached the server over 5 minutes after they were recorded is
//              marked "uploaded later" (uploadedAt), cut out of its driving leg
//   numbers    km, driving and stopped minutes, the number of stops
//
// A fix that repeats the exact coordinates of the fix before it is a cached
// location the phone delivered again: it is dropped before anything else.

import {
  distanceM,
  type Fix,
  MAX_ACCURACY_M,
  newTrack,
  openStop,
  step,
  type Stop,
  STOP_MINUTES,
  type TrackState,
  usable,
} from "./track.ts";

/** No precise fix for this long is a gap in the data. */
export const GAP_MINUTES = 10;
/** Douglas–Peucker tolerance: a point further than this from the straight line between its neighbours is a corner worth keeping. */
export const SIMPLIFY_M = 12;
/** The line never has more points than this; the tolerance doubles until it fits. */
export const MAX_LINE_POINTS = 3000;
/**
 * Under this much accepted movement, the time between two stops (or before the first, after the last) was
 * not a drive: the filter only corrected where the parked phone is. The stops are one stay.
 */
export const MIN_LEG_M = 100;
/** A pause shorter than this is part of the drive; the line gets a wait (two points at one place) only for a longer one. */
export const WAIT_SECONDS = 60;
/** Speed classes for colouring the line (km/h): under 3 standing, under 20 slow, under 60 normal, else fast. */
export const SPEED_SLOW_KMH = 3;
export const SPEED_NORMAL_KMH = 20;
export const SPEED_FAST_KMH = 60;
/** Fixes worse than this are not drawn at all (the phone does not store them either). */
export const DRAW_MAX_ACCURACY_M = 150;
/** Up to this accuracy a point is drawn as a normal line; worse (to 150 m) thin and lighter. */
export const GOOD_ACCURACY_M = 30;
/** A fix that would need more than this from the fix before it is an outlier. */
export const OUTLIER_SPEED_KMH = 150;
/** A spike is further than this many times its accuracy (at least SPIKE_MIN_M) from both neighbours, within SPIKE_WINDOW_MS. */
export const SPIKE_FACTOR = 3;
export const SPIKE_MIN_M = 30;
/** An out-and-back spike is a matter of seconds: its two neighbours are at most this far apart in time. */
export const SPIKE_WINDOW_MS = 2 * 60000;
/** Over this long between two line points at different places is a hole, drawn dashed. */
export const HOLE_MINUTES = 2;
/** A jump between two line points this far apart in space and time is drawn as an estimated road line (Part 5b). */
export const JUMP_MIN_M = 300;
export const JUMP_MIN_S = 60;
/** A point that reached the server this long after it was recorded was uploaded later (the phone was offline). */
export const LATE_UPLOAD_MINUTES = 5;
/** Heartbeats come about every minute; up to this long between two still means the app was alive. */
export const HEARTBEAT_COVER_MINUTES = 5;
/** A gap with no heartbeat at all this long or longer: the app was not running (a shorter one is too short to tell). */
export const HEARTBEAT_MISS_MINUTES = 3;
/** A poor fix (50–150 m) is drawn only when no precise fix exists within this long of it. */
export const POOR_FILL_MINUTES = 2;

export type SpeedClass = "stopped" | "slow" | "normal" | "fast";

export function speedClass(kmh: number): SpeedClass {
  if (kmh < SPEED_SLOW_KMH) return "stopped";
  if (kmh < SPEED_NORMAL_KMH) return "slow";
  if (kmh < SPEED_FAST_KMH) return "normal";
  return "fast";
}

/** A stored fix with, when known, the time the server received it. */
export interface RouteFix extends Fix {
  receivedAt?: number | null;
}

export interface LinePoint {
  at: number;
  lat: number;
  lng: number;
  /** Speed over the step that reached this point (from the point before it on the thinned line), km/h; 0 for the first point and for a wait. */
  kmh: number;
  /** The fix's reported accuracy in metres (null when the phone gave none). */
  acc?: number | null;
}

export type SegmentKind = "driving" | "stopped" | "no_gps" | "no_data";
export type GapKind = "no_gps" | "no_data";

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
  /** The points of this leg reached the server over 5 minutes late: when the last of them landed. */
  uploadedAt?: number;
}

export interface Gap {
  from: number;
  to: number;
  minutes: number;
  kind: GapKind;
}

/** Over 2 minutes between two line points at different places. */
export interface Hole {
  from: number;
  to: number;
  minutes: number;
  kind: GapKind;
  fromPoint: { lat: number; lng: number };
  toPoint: { lat: number; lng: number };
}

/**
 * Two consecutive line points over 300 m and 60 s apart (the phone lost its fixes while the vehicle
 * moved): the map draws an estimated road line between them (dashed, routed by openrouteservice), never km.
 */
export interface Jump {
  from: number;
  to: number;
  metres: number;
  fromPoint: { lat: number; lng: number };
  toPoint: { lat: number; lng: number };
}

/** A stretch of points that were uploaded over 5 minutes after they were recorded. */
export interface LateWindow {
  from: number;
  to: number;
  uploadedAt: number;
}

export interface RouteBuild {
  line: LinePoint[];
  segments: Segment[];
  stops: Stop[];
  gaps: Gap[];
  holes: Hole[];
  /** Jumps over 300 m and 60 s: their ends are always kept on the drawn line. */
  jumps: Jump[];
  late: LateWindow[];
  km: number;
  drivingMinutes: number;
  stoppedMinutes: number;
  /** Stops of 10 minutes or more (a stop cut by a data gap counts once). */
  stopsCount: number;
  /** Fixes precise enough for the km (under 50 m), after dropping repeats and outliers. */
  usable: number;
  /** Repeated cached fixes dropped. */
  repeats: number;
  /** Outliers dropped (jumps and spikes). */
  outliers: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Fixes given. */
  pointsStored: number;
  /** Points on the line after thinning. */
  pointsShown: number;
}

export interface BuildOptions {
  simplifyM?: number;
  maxPoints?: number;
  /** Heartbeat times (ms) in the window: a gap with heartbeats is "no GPS", without them "app not running". */
  heartbeats?: number[];
  /** Display smoothing of the line (default on). The km never use it. */
  smooth?: boolean;
}

const minutes = (from: number, to: number) => Math.max(0, Math.round((to - from) / 60000));
const roundKm = (metres: number) => Math.round((metres / 1000) * 10) / 10;

/** Drops a fix that repeats the exact coordinates of the one before it. */
export function dropRepeats<T extends Fix>(fixes: T[]): { fixes: T[]; repeats: number } {
  const out: T[] = [];
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

function tooFast(from: Fix, to: Fix): boolean {
  const seconds = (to.at - from.at) / 1000;
  return seconds > 0 && (distanceM(from, to) / seconds) * 3.6 > OUTLIER_SPEED_KMH;
}

/**
 * Outliers, in two passes over fixes in time order:
 *   1. a fix that would need over 150 km/h from the fix kept before it is a jump (a cell tower, a stale fix).
 *      Three fixes in a row that agree with each other but not with the kept fix mean the kept fix was the
 *      odd one out: it goes, they stay;
 *   2. an out-and-back spike: a fix further than 3 × its accuracy (at least 30 m) from both its neighbours
 *      while the neighbours are close to each other (under half of that) and under 2 minutes apart: a real
 *      out-and-back trip takes longer and leaves more than one point.
 * Used for the km and for the line alike. Nothing here uses speed or heading.
 */
export function dropOutliers<T extends Fix>(input: T[]): { fixes: T[]; dropped: number } {
  const kept: T[] = [];
  let run: T[] = [];
  for (const fix of input) {
    const prev = kept[kept.length - 1];
    if (prev && tooFast(prev, fix)) {
      const last = run[run.length - 1];
      run = last && !tooFast(last, fix) ? [...run, fix] : [fix];
      if (run.length >= 3) {
        kept.pop();
        kept.push(...run);
        run = [];
      }
      continue;
    }
    run = [];
    kept.push(fix);
  }
  const out: T[] = [];
  for (let i = 0; i < kept.length; i++) {
    const p = kept[i];
    const prev = out[out.length - 1];
    const next = kept[i + 1];
    if (prev && next && next.at - prev.at <= SPIKE_WINDOW_MS) {
      const spike = Math.max(SPIKE_FACTOR * (p.accuracyM ?? 10), SPIKE_MIN_M);
      const dPrev = distanceM(prev, p);
      const dNext = distanceM(p, next);
      if (dPrev > spike && dNext > spike && distanceM(prev, next) < Math.min(dPrev, dNext) / 2) continue;
    }
    out.push(p);
  }
  return { fixes: out, dropped: input.length - out.length };
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

const sameSpot = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => a.lat === b.lat && a.lng === b.lng;

/**
 * Thins the line by shape (corners stay, straight runs go), keeping the waits, the ends of holes (`keepAt`:
 * the times of points that must stay) and the first and last point. The speeds are recomputed per step.
 * A tolerance of 0 (the web maps) removes nothing while the line fits `maxPoints`; above that it finds the
 * smallest tolerance that gets under (doubling from 0.5 m, then bisecting to 5 cm). A tolerance above 0
 * (Claude's default 12 m) is applied as given and doubled until the line fits, as before.
 */
export function simplifyLine(line: LinePoint[], opts: BuildOptions = {}, keepAt?: Set<number>): LinePoint[] {
  const requested = opts.simplifyM ?? SIMPLIFY_M;
  const max = opts.maxPoints ?? MAX_LINE_POINTS;
  const thin = (tolerance: number): LinePoint[] => {
    const keep = simplifyKeep(line, tolerance);
    for (let i = 1; i < line.length; i++) {
      // A wait (same place as the point before) is a time anchor: keep it and the point it waits at.
      if (sameSpot(line[i], line[i - 1])) {
        keep[i] = true;
        keep[i - 1] = true;
      }
    }
    if (keepAt) { for (let i = 0; i < line.length; i++) if (keepAt.has(line[i].at)) keep[i] = true; }
    return line.filter((_, i) => keep[i]);
  };
  if (requested <= 0) {
    if (line.length <= max) return withSpeeds(line);
    let lo = 0;
    let hi = 0.5;
    let fit = thin(hi);
    while (fit.length > max && hi < 5000) {
      lo = hi;
      hi *= 2;
      fit = thin(hi);
    }
    for (let i = 0; i < 12 && hi - lo > 0.05; i++) {
      const mid = (lo + hi) / 2;
      const out = thin(mid);
      if (out.length > max) lo = mid;
      else {
        hi = mid;
        fit = out;
      }
    }
    return withSpeeds(fit);
  }
  for (let tolerance = requested;; tolerance *= 2) {
    const out = thin(tolerance);
    if (out.length <= max || tolerance > 5000) return withSpeeds(out);
  }
}

/** The speed of each step of a (thinned) line: distance over time from the point before, km/h; the first point and a wait get 0. */
export function withSpeeds(line: LinePoint[]): LinePoint[] {
  return line.map((p, i) => {
    if (i === 0 || p.at <= line[i - 1].at) return { ...p, kmh: 0 };
    return { ...p, kmh: Math.round((distanceM(line[i - 1], p) / ((p.at - line[i - 1].at) / 1000)) * 3.6) };
  });
}

/**
 * Display smoothing: each point moves towards the accuracy-weighted mean of itself and its two neighbours,
 * by at most its own accuracy (10 m when the phone gave none), so a corner never moves further than the GPS
 * could have been wrong. The two points of a wait stay where they are. The raw points are never changed:
 * the km come from them.
 */
export function smoothLine(line: LinePoint[]): LinePoint[] {
  if (line.length < 3) return line;
  const weight = (p: LinePoint) => 1 / Math.max(p.acc ?? 10, 3) ** 2;
  const out = line.map((p) => ({ ...p }));
  for (let i = 1; i < line.length - 1; i++) {
    const prev = line[i - 1];
    const p = line[i];
    const next = line[i + 1];
    if (sameSpot(prev, p) || sameSpot(p, next)) continue;
    const w0 = weight(prev), w1 = weight(p), w2 = weight(next);
    const sum = w0 + w1 + w2;
    const lat = (prev.lat * w0 + p.lat * w1 + next.lat * w2) / sum;
    const lng = (prev.lng * w0 + p.lng * w1 + next.lng * w2) / sum;
    const shift = distanceM(p, { lat, lng });
    const cap = p.acc ?? 10;
    if (shift <= cap) {
      out[i].lat = lat;
      out[i].lng = lng;
    } else {
      const k = cap / shift;
      out[i].lat = p.lat + (lat - p.lat) * k;
      out[i].lng = p.lng + (lng - p.lng) * k;
    }
  }
  return out;
}

/**
 * The kind of every part of a gap: the heartbeat times inside it cut it into pieces; a piece between two
 * signals (a fix or a heartbeat) under 5 minutes apart is "no_gps" (the app was alive, no GPS), a longer one
 * "no_data" (the app was not running). No heartbeat at all in a gap of 3 minutes or more is "no_data" too.
 * Same-kind pieces are merged; a piece under a minute goes with its neighbour.
 */
export function gapParts(from: number, to: number, heartbeats: number[] = []): { from: number; to: number; kind: GapKind }[] {
  const cover = HEARTBEAT_COVER_MINUTES * 60000;
  const inside = heartbeats.filter((h) => h > from && h < to).sort((a, b) => a - b);
  // No heartbeat at all inside: the app was not running, unless the gap is too short for one to be missed.
  if (inside.length === 0) return [{ from, to, kind: to - from < HEARTBEAT_MISS_MINUTES * 60000 ? "no_gps" : "no_data" }];
  const bounds = [from, ...inside, to];
  const parts: { from: number; to: number; kind: GapKind }[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const kind: GapKind = bounds[i] - bounds[i - 1] <= cover ? "no_gps" : "no_data";
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.to = bounds[i];
    else parts.push({ from: bounds[i - 1], to: bounds[i], kind });
  }
  // A piece under a minute is not worth a row of its own.
  for (let i = parts.length - 1; i >= 0 && parts.length > 1; i--) {
    if (parts[i].to - parts[i].from >= 60000) continue;
    const into = i > 0 ? parts[i - 1] : parts[i + 1];
    into.from = Math.min(into.from, parts[i].from);
    into.to = Math.max(into.to, parts[i].to);
    parts.splice(i, 1);
  }
  return parts;
}

/** The kind of a whole hole: the kind of its longest part. */
function holeKind(from: number, to: number, heartbeats: number[] | undefined): GapKind {
  const parts = gapParts(from, to, heartbeats);
  let best = parts[0];
  for (const p of parts) if (p.to - p.from > best.to - best.from) best = p;
  return best?.kind ?? "no_data";
}

/** Stretches of fixes that reached the server over 5 minutes after they were recorded. */
export function lateWindows(fixes: RouteFix[]): LateWindow[] {
  const late = LATE_UPLOAD_MINUTES * 60000;
  const out: LateWindow[] = [];
  let open: LateWindow | null = null;
  for (const fix of fixes) {
    const isLate = fix.receivedAt != null && fix.receivedAt - fix.at > late;
    if (isLate) {
      if (open) {
        open.to = fix.at;
        open.uploadedAt = Math.max(open.uploadedAt, fix.receivedAt!);
      } else {
        open = { from: fix.at, to: fix.at, uploadedAt: fix.receivedAt! };
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/** The holes of a line: over 2 minutes between two points at different places. */
export function holesOf(line: LinePoint[], heartbeats?: number[]): Hole[] {
  const out: Hole[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (sameSpot(a, b) || b.at - a.at < HOLE_MINUTES * 60000) continue;
    out.push({
      from: a.at,
      to: b.at,
      minutes: minutes(a.at, b.at),
      kind: holeKind(a.at, b.at, heartbeats),
      fromPoint: { lat: a.lat, lng: a.lng },
      toPoint: { lat: b.lat, lng: b.lng },
    });
  }
  return out;
}

/** The jumps of a line: over 300 m and over 60 s between two consecutive points. */
export function jumpsOf(line: LinePoint[]): Jump[] {
  const out: Jump[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (b.at - a.at <= JUMP_MIN_S * 1000) continue;
    const metres = distanceM(a, b);
    if (metres <= JUMP_MIN_M) continue;
    out.push({
      from: a.at,
      to: b.at,
      metres: Math.round(metres),
      fromPoint: { lat: a.lat, lng: a.lng },
      toPoint: { lat: b.lat, lng: b.lng },
    });
  }
  return out;
}

/** The whole route of a list of fixes (any order; sorted here). */
export function buildRoute(input: RouteFix[], opts: BuildOptions = {}): RouteBuild {
  const sorted = [...input].sort((a, b) => a.at - b.at);
  const { fixes: noRepeat, repeats } = dropRepeats(sorted);
  const drawable = noRepeat.filter((f) => f.accuracyM == null || f.accuracyM <= DRAW_MAX_ACCURACY_M);
  const { fixes, dropped: outliers } = dropOutliers(drawable);
  const state: TrackState = newTrack();
  const line: LinePoint[] = [];
  const stops: Stop[] = [];
  const rawGaps: { from: number; to: number }[] = [];
  /** Movement accepted, by the time it was accepted at (for the km of each leg). */
  const moves: { at: number; metres: number }[] = [];
  const usableAt: number[] = [];
  let prevUsableAt: number | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  const push = (at: number, lat: number, lng: number, acc: number | null | undefined) => {
    const prev = line[line.length - 1];
    let kmh = 0;
    if (prev && at > prev.at) kmh = Math.round((distanceM(prev, { lat, lng }) / ((at - prev.at) / 1000)) * 3.6);
    line.push({ at, lat, lng, kmh, acc: acc ?? null });
  };

  for (const fix of fixes) {
    if (!usable(fix)) continue;
    usableAt.push(fix.at);
    if (firstAt === null) firstAt = fix.at;
    lastAt = fix.at;
    if (prevUsableAt !== null && fix.at - prevUsableAt > GAP_MINUTES * 60000) rawGaps.push({ from: prevUsableAt, to: fix.at });
    prevUsableAt = fix.at;

    const waitedUntil = state.lastStill;
    const result = step(state, fix);
    if (result.stop) stops.push(result.stop);
    if (result.accepted) {
      const prev = line[line.length - 1];
      // The vehicle waited at the previous position for a minute or more: mark the end of the wait before the move.
      // A shorter pause (slow traffic, a fix that had not moved far enough yet) is part of the step, at its true average speed.
      if (prev && waitedUntil - prev.at >= WAIT_SECONDS * 1000 && result.verdict !== "first") {
        line.push({ at: waitedUntil, lat: prev.lat, lng: prev.lng, kmh: 0, acc: prev.acc });
      }
      push(result.accepted.at, result.accepted.lat, result.accepted.lng, result.accepted.accuracyM);
      if (result.movedM > 0) moves.push({ at: result.accepted.at, metres: result.movedM });
    }
  }
  const open = openStop(state);
  if (open) stops.push(open);
  const last = line[line.length - 1];
  if (
    last && lastAt !== null && lastAt - last.at >= WAIT_SECONDS * 1000 && state.anchor && state.anchor.lat === last.lat &&
    state.anchor.lng === last.lng
  ) {
    line.push({ at: lastAt, lat: last.lat, lng: last.lng, kmh: 0, acc: last.acc });
  }

  // Poor fixes (50–150 m) fill the stretches with no precise fix, thin and lighter on the map; never the km.
  const merged = withPoorFixes(line, fixes.filter((f) => f.accuracyM != null && f.accuracyM > MAX_ACCURACY_M), usableAt);

  const settled = settleStops(firstAt, lastAt, stops, moves);
  // No stop of 10 minutes from the filter and no movement at all: the whole time is one stay at the first position.
  const stay: Stop[] =
    settled.length === 0 && firstAt !== null && lastAt !== null && lastAt - firstAt >= 60000 && state.metres < MIN_LEG_M && line.length > 0
      ? [{ from: firstAt, to: lastAt, minutes: minutes(firstAt, lastAt), lat: line[0].lat, lng: line[0].lng }]
      : [];
  const stays = settled.length ? settled : stay;
  const reported = stays.filter((s) => s.minutes >= STOP_MINUTES);
  const gaps: Gap[] = rawGaps.flatMap((g) =>
    gapParts(g.from, g.to, opts.heartbeats).map((p) => ({ from: p.from, to: p.to, minutes: minutes(p.from, p.to), kind: p.kind }))
  );
  const late = lateWindows(fixes);
  const segments = buildSegments(firstAt, lastAt, stays, gaps, moves, late);
  const holes = holesOf(merged, opts.heartbeats);
  const jumps = jumpsOf(merged);
  const keepAt = new Set<number>();
  for (const h of [...holes, ...jumps]) {
    keepAt.add(h.from);
    keepAt.add(h.to);
  }
  const drawn = simplifyLine(opts.smooth === false ? merged : smoothLine(merged), opts, keepAt);
  return {
    line: drawn,
    segments,
    stops: reported,
    gaps,
    holes,
    jumps,
    late,
    km: roundKm(state.metres),
    drivingMinutes: segments.filter((s) => s.kind === "driving").reduce((s, x) => s + x.minutes, 0),
    stoppedMinutes: segments.filter((s) => s.kind === "stopped").reduce((s, x) => s + x.minutes, 0),
    stopsCount: reported.length,
    usable: usableAt.length,
    repeats,
    outliers,
    firstAt,
    lastAt,
    pointsStored: input.length,
    pointsShown: drawn.length,
  };
}

/**
 * Poor fixes into the line, by time: only where no precise fix exists within 2 minutes, and only when further
 * than its own accuracy from the line point before it (closer adds nothing but wobble).
 */
export function withPoorFixes(line: LinePoint[], poor: Fix[], usableAt: number[]): LinePoint[] {
  if (poor.length === 0) return line;
  const near = POOR_FILL_MINUTES * 60000;
  const covered = (at: number): boolean => {
    // Binary search for the nearest precise fix in time.
    let lo = 0, hi = usableAt.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (usableAt[mid] < at) lo = mid + 1;
      else hi = mid - 1;
    }
    const after = usableAt[lo];
    const before = usableAt[lo - 1];
    return (after !== undefined && after - at <= near) || (before !== undefined && at - before <= near);
  };
  const out: LinePoint[] = [];
  let i = 0, j = 0;
  const candidates = poor.filter((f) => !covered(f.at));
  while (i < line.length || j < candidates.length) {
    const takeLine = j >= candidates.length || (i < line.length && line[i].at <= candidates[j].at);
    if (takeLine) {
      out.push(line[i++]);
      continue;
    }
    const fix = candidates[j++];
    const prev = out[out.length - 1];
    if (prev && distanceM(prev, fix) <= (fix.accuracyM ?? DRAW_MAX_ACCURACY_M)) continue;
    out.push({ at: fix.at, lat: fix.lat, lng: fix.lng, kmh: 0, acc: fix.accuracyM ?? null });
  }
  return withSpeeds(out);
}

/**
 * The filter's stops, settled into stays. A parked phone's position is corrected now and then (a poor first fix,
 * drift indoors): the filter ends one stop and starts another a few minutes later without adding distance. With
 * under 100 m of accepted movement between them that was no drive: the stops are one stay, at the place of its
 * longest part. The same goes for the minutes before the first stop and after the last one.
 */
export function settleStops(firstAt: number | null, lastAt: number | null, stops: Stop[], moves: { at: number; metres: number }[]): Stop[] {
  const metresBetween = (from: number, to: number) => moves.filter((m) => m.at > from && m.at <= to).reduce((s, m) => s + m.metres, 0);
  const out: Stop[] = [];
  /** How long the part that gave each stay its position lasted. */
  const longest: number[] = [];
  for (const stop of [...stops].sort((a, b) => a.from - b.from)) {
    const prev = out[out.length - 1];
    const lasted = stop.to - stop.from;
    if (prev && metresBetween(prev.to, stop.from) < MIN_LEG_M) {
      const here = lasted > longest[longest.length - 1] ? stop : prev;
      longest[longest.length - 1] = Math.max(lasted, longest[longest.length - 1]);
      out[out.length - 1] = {
        from: prev.from,
        to: Math.max(prev.to, stop.to),
        minutes: minutes(prev.from, Math.max(prev.to, stop.to)),
        lat: here.lat,
        lng: here.lng,
      };
    } else {
      out.push({ ...stop });
      longest.push(lasted);
    }
  }
  if (out.length && firstAt !== null && lastAt !== null) {
    const first = out[0];
    if (first.from > firstAt && metresBetween(firstAt, first.from) < MIN_LEG_M) {
      out[0] = { ...first, from: firstAt, minutes: minutes(firstAt, first.to) };
    }
    const last = out[out.length - 1];
    if (last.to < lastAt && metresBetween(last.to, lastAt) < MIN_LEG_M) {
      out[out.length - 1] = { ...last, to: lastAt, minutes: minutes(last.from, lastAt) };
    }
  }
  return out;
}

/** Stops and driving legs over the day, the data gaps cut into them (with their kind), then the late uploads marked. */
export function buildSegments(
  firstAt: number | null,
  lastAt: number | null,
  stops: Stop[],
  gaps: Gap[],
  moves: { at: number; metres: number }[],
  late: LateWindow[] = [],
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

  const withKm = (s: Segment): Segment => (s.kind === "driving" ? { ...s, km: kmBetween(s.from, s.to) } : s);
  // Cut every leg around the gaps; a piece under a minute is not worth a row.
  const cut: Segment[] = [];
  for (const leg of legs) {
    let piece: Segment | null = { ...leg };
    for (const gap of gaps) {
      if (!piece || gap.to <= piece.from || gap.from >= piece.to) continue;
      const before = { ...piece, to: gap.from, minutes: minutes(piece.from, gap.from) };
      if (before.minutes >= 1) cut.push(withKm(before));
      cut.push({ kind: gap.kind, from: gap.from, to: gap.to, minutes: gap.minutes });
      piece = gap.to < piece.to ? withKm({ ...piece, from: gap.to, minutes: minutes(gap.to, piece.to) }) : null;
    }
    if (piece && piece.minutes >= 1) cut.push(piece);
  }
  // A gap that fell between two legs (not inside one) still needs its row.
  for (const gap of gaps) {
    if (!cut.some((s) => s.kind === gap.kind && s.from === gap.from)) {
      cut.push({ kind: gap.kind, from: gap.from, to: gap.to, minutes: gap.minutes });
    }
  }
  // Late uploads: a driving leg is cut around each window (the inside piece says when it landed); a stop is only marked.
  const out: Segment[] = [];
  for (const seg of cut.sort((a, b) => a.from - b.from || a.to - b.to)) {
    if (seg.kind === "stopped") {
      const over = late.find((w) => w.from < seg.to && w.to > seg.from);
      out.push(over ? { ...seg, uploadedAt: over.uploadedAt } : seg);
      continue;
    }
    if (seg.kind !== "driving") {
      out.push(seg);
      continue;
    }
    let piece: Segment | null = { ...seg };
    for (const w of late) {
      if (!piece || w.to <= piece.from || w.from >= piece.to) continue;
      const from = Math.max(w.from, piece.from);
      const to = Math.min(w.to, piece.to);
      const before = { ...piece, to: from, minutes: minutes(piece.from, from) };
      if (before.minutes >= 1) out.push(withKm(before));
      const inside: Segment = withKm({ kind: "driving", from, to, minutes: minutes(from, to), uploadedAt: w.uploadedAt });
      if (inside.minutes >= 1 || (before.minutes < 1 && to >= piece.to)) out.push(inside);
      piece = to < piece.to ? withKm({ ...piece, from: to, minutes: minutes(to, piece.to) }) : null;
    }
    if (piece && piece.minutes >= 1) out.push(piece);
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

/** Inserts a point into a line by time (a late backlog lands in the right place); a point already there (same time) is ignored. */
export function insertByTime(line: LinePoint[], point: LinePoint): LinePoint[] {
  let lo = 0, hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (line[mid].at < point.at) lo = mid + 1;
    else hi = mid;
  }
  if (line[lo] && line[lo].at === point.at) return line;
  const out = [...line.slice(0, lo), point, ...line.slice(lo)];
  // The speeds of the step reaching the new point and of the one leaving it.
  for (const i of [lo, lo + 1]) {
    if (i <= 0 || i >= out.length) continue;
    const a = out[i - 1], b = out[i];
    out[i] = { ...b, kmh: b.at > a.at ? Math.round((distanceM(a, b) / ((b.at - a.at) / 1000)) * 3.6) : 0 };
  }
  return out;
}
