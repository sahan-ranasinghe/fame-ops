// Office mode (Phase 8, O2): the Live tab's route rules (design 15, the plan's §6 and the site's Live), tested in
// scripts/test-live-route.ts: today's trails (every sharing driver's line, at most TRAILS_CAP of them, each in a muted
// colour), the shown route (the selected driver's day: the line as runs of one speed band, the holes dashed, the
// estimated road over a GPS gap, the stops over 10 minutes) and its playback (the path in time order, the marker's
// position at a time, the clock stepping by speed). Copied from the office site and cut to what the phone draws:
//   apps/office/src/data/route.ts        routeOf (the tool's columns), insertByTime (the shared route module's),
//                                        mergeRoute (a fresh answer merged by time, never replacing), holesOf
//   apps/office/src/screens/playbackLogic.ts   playbackPath, spreadTies, bearing, positionOn, advance, gapWindowsOf
//   apps/office/src/screens/Live.tsx     the tool's arguments (tolerance 0, 3,000 points, the estimated roads; never
//                                        snap: the free map must not get Google's roads, and a Roads call costs),
//                                        sharingNow, the shown route left out of the trails
// The speed bands and their colours are the driver page's (office/driversLogic.ts BAND_COLORS: grey standing, amber
// under 20, blue 20–60, dark blue over 60 km/h) so the two screens read the same. Pure: no React, no native module;
// the words come through `t`, so both languages read the same fields.

import { boundsOf, type Frame, frameOf, kmText, type LatLng, ORS_CREDIT } from '../components/taskMapLogic';
import { durationText } from '../lib/durations';
import { NO_ROUTE_LAYERS, type RouteLayers } from '../lib/mapLayout';
import { distanceM } from '../lib/track';
import type { Words } from './liveLogic';
import { type EndMarks, endsOf, type GapMark, gapMarksOf } from './routeMarks';
import type { DriverRoute, GapKind, LiveDriver, SegmentKind } from './types';

// ---- The tool ---------------------------------------------------------------------------------------------------------

/**
 * driver_route's arguments for every line the Live tab draws: every stored point up to 3,000 (tolerance 0; above that the
 * tool picks the smallest tolerance that fits) and the gaps' estimated road lines. Never `snap`.
 */
export const ROUTE_ARGS = { line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true } as const;

export function routeArgs(username: string): { driver: string; line_tolerance_m: 0; max_line_points: 3000; estimate_gaps: true } {
  return { driver: username, ...ROUTE_ARGS };
}

/** The trails and the shown route are fetched again this often while the tab is in front (merged, never replaced). */
export const ROUTE_REFRESH_MS = 60_000;

// ---- The route on the phone -------------------------------------------------------------------------------------------

export interface RoutePoint {
  /** Unix ms. */
  at: number;
  lat: number;
  lng: number;
  /** The speed of the step that reached this point, km/h (0 for the first point and a wait). */
  kmh: number;
  /** The fix's accuracy in metres, when the tool gave it. */
  acc?: number | null;
}

export interface RouteStopView {
  from: string;
  to: string;
  minutes: number;
  near: string | null;
  lat: number;
  lng: number;
}

export interface HoleView {
  fromAt: number;
  toAt: number;
  minutes: number;
  kind: GapKind;
}

/** A gap of over 300 m and 60 s as the likely road (openrouteservice, estimate_gaps): drawn dashed, never km. */
export interface EstimatedView {
  fromAt: number;
  toAt: number;
  km?: number;
  points: LatLng[];
}

export interface TimelineRow {
  kind: SegmentKind;
  fromAt: number;
  toAt: number;
}

export interface Route {
  username: string;
  date: string;
  /** The day's km from the raw points (the tool's drift filter), when the tool gave them. */
  km?: number;
  /** Points recorded (raw). */
  count: number;
  /** Points on the line the tool drew (after thinning). */
  shown?: number;
  first?: string;
  last?: string;
  points: RoutePoint[];
  stops: RouteStopView[];
  holes: HoleView[];
  estimated: EstimatedView[];
  timeline: TimelineRow[];
  /** The time of the last point of the line the tool drew. */
  lineEndAt: number | null;
  drivingMinutes?: number;
  stoppedMinutes?: number;
  stopsCount?: number;
  note?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The tool's columns (time, lat, lng, km/h, at, acc; older answers four or five) → the points in the tool's order. */
function pointsOf(date: string, route: DriverRoute['route'] | undefined): RoutePoint[] {
  const cols = route?.columns ?? ['time', 'lat', 'lng', 'km/h'];
  const la = cols.indexOf('lat');
  const lo = cols.indexOf('lng');
  const sp = cols.indexOf('km/h');
  const at = cols.indexOf('at');
  const tm = cols.indexOf('time');
  const ac = cols.indexOf('acc');
  const dayStart = Date.parse(`${date}T00:00:00+05:30`);
  const points: RoutePoint[] = [];
  for (const r of route?.points ?? []) {
    const lat = num(r[la]);
    const lng = num(r[lo]);
    if (lat === null || lng === null) continue;
    // The ISO time when the tool gives it; else the HH:MM on the day (older answers).
    let ms = at >= 0 ? Date.parse(String(r[at])) : NaN;
    if (!Number.isFinite(ms) && tm >= 0 && Number.isFinite(dayStart)) {
      const [h, m] = String(r[tm]).split(':').map(Number);
      ms = dayStart + (h * 60 + m) * 60000;
    }
    const p: RoutePoint = { at: Number.isFinite(ms) ? ms : points.length, lat, lng, kmh: sp >= 0 ? num(r[sp]) ?? 0 : 0 };
    if (ac >= 0) {
      const acc = num(r[ac]);
      if (acc !== null) p.acc = acc;
    }
    points.push(p);
  }
  return points;
}

const hasPin = <S extends { lat?: number; lng?: number }>(s: S): s is S & { lat: number; lng: number } =>
  typeof s.lat === 'number' && Number.isFinite(s.lat) && typeof s.lng === 'number' && Number.isFinite(s.lng);

/** The tool's answer → the route the screen draws. Older answers (four columns, no timeline, no holes) still work. */
export function routeOf(username: string, p: DriverRoute): Route {
  const points = pointsOf(p.date, p.route);
  const timeline: TimelineRow[] = (p.timeline ?? []).map((s) => ({ kind: s.kind, fromAt: Date.parse(s.from_at), toAt: Date.parse(s.to_at) }));
  const holes: HoleView[] = (p.holes ?? []).map((h) => ({ fromAt: Date.parse(h.from_at), toAt: Date.parse(h.to_at), minutes: h.minutes, kind: h.kind }));
  const estimated: EstimatedView[] = (p.estimated ?? []).map((e) => ({
    fromAt: Date.parse(e.from_at), toAt: Date.parse(e.to_at), km: e.km_road, points: e.points.map(([lat, lng]) => ({ lat, lng })),
  }));
  return {
    username,
    date: p.date,
    km: p.km,
    count: p.recorded_points ?? points.length,
    shown: p.points_shown,
    first: p.first_point,
    last: p.last_point,
    points,
    stops: (p.stops_over_10_min ?? []).filter(hasPin).map((s) => ({ from: s.from, to: s.to, minutes: s.minutes, near: s.near ?? null, lat: s.lat, lng: s.lng })),
    holes,
    estimated,
    timeline,
    lineEndAt: points.length ? points[points.length - 1].at : null,
    drivingMinutes: p.driving_minutes,
    stoppedMinutes: p.stopped_minutes,
    stopsCount: p.stops_count,
    note: p.note,
  };
}

/** The speed of the step from a to b, km/h, rounded (0 when b is not later). */
const stepKmh = (a: RoutePoint, b: RoutePoint) => (b.at > a.at ? Math.round((distanceM(a, b) / ((b.at - a.at) / 1000)) * 3.6) : 0);

/**
 * Inserts a point into a line by time (a late backlog lands in the right place); a point already there (the same time)
 * is ignored. The speeds of the step reaching the new point and of the one leaving it follow (the shared route module).
 */
export function insertByTime(line: RoutePoint[], point: RoutePoint): RoutePoint[] {
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (line[mid].at < point.at) lo = mid + 1;
    else hi = mid;
  }
  if (line[lo] && line[lo].at === point.at) return line;
  const out = [...line.slice(0, lo), point, ...line.slice(lo)];
  for (const i of [lo, lo + 1]) {
    if (i <= 0 || i >= out.length) continue;
    out[i] = { ...out[i], kmh: stepKmh(out[i - 1], out[i]) };
  }
  return out;
}

/**
 * A fresh answer from the tool (the 60-second refetch) merged into the line already drawn: the fresh line's points plus
 * every point the line drawn has at a time the fresh one lacks (a thinner fresh line never collapses the dense one); the
 * km, the stops, the holes and the timeline come from the fresh answer. Another driver's or day's answer replaces it.
 */
export function mergeRoute(current: Route, fresh: Route): Route {
  if (current.username !== fresh.username || current.date !== fresh.date) return fresh;
  const have = new Set(fresh.points.map((p) => p.at));
  let points = fresh.points;
  for (const p of current.points) {
    if (have.has(p.at)) continue;
    have.add(p.at);
    points = insertByTime(points, p);
  }
  return { ...fresh, points, lineEndAt: points.length ? points[points.length - 1].at : null };
}

// ---- The line by speed ------------------------------------------------------------------------------------------------

export type SpeedBand = 'standing' | 'slow' | 'mid' | 'fast';
export const SPEED_BANDS: readonly SpeedBand[] = ['standing', 'slow', 'mid', 'fast'];
/** Under 3 km/h the vehicle stands (GPS drift at a stop reads up to that). */
export const SPEED_STANDING_KMH = 3;
export const SPEED_MID_KMH = 20;
export const SPEED_FAST_KMH = 60;

/** The band of a step: standing under 3 km/h, slow under 20, mid 20–60, fast over 60. */
export function speedBand(kmh: number): SpeedBand {
  if (!(kmh >= SPEED_STANDING_KMH)) return 'standing';
  if (kmh < SPEED_MID_KMH) return 'slow';
  if (kmh < SPEED_FAST_KMH) return 'mid';
  return 'fast';
}

/** The bands' colours (the driver page's): grey, amber, blue, dark blue. A hole dashed grey, an estimated road dashed slate. */
export const BAND_COLORS: Record<SpeedBand, string> = { standing: '#8d9096', slow: '#f2a900', mid: '#1e4fa0', fast: '#0f2d66' };
export const HOLE_COLOR = '#8d9096';
export const ESTIMATED_COLOR = '#5d646c';

/** Over 2 minutes between two line points at different places: a hole, drawn dashed (the shared route module's rule). */
export const HOLE_MINUTES = 2;

export interface HoleLine {
  from: LatLng;
  to: LatLng;
  fromAt: number;
  toAt: number;
  /** The tool's kind; null for a hole found on the points that came after the tool's line. */
  kind: GapKind | null;
}

const holeKey = (h: { fromAt: number; toAt: number }) => `${h.fromAt}|${h.toAt}`;

/**
 * The holes to draw dashed: the tool's holes, each cut by any point merged inside it since, and the same rule over the
 * points that came after the tool's line. A thinned straight run is never a hole: only the tool knows which points it
 * left out.
 */
export function holesOf(route: Pick<Route, 'holes' | 'lineEndAt'>, points: RoutePoint[]): HoleLine[] {
  const out: HoleLine[] = [];
  const add = (a: RoutePoint, b: RoutePoint, kind: GapKind | null) => {
    if ((a.lat === b.lat && a.lng === b.lng) || b.at - a.at < HOLE_MINUTES * 60000) return;
    out.push({ from: { lat: a.lat, lng: a.lng }, to: { lat: b.lat, lng: b.lng }, fromAt: a.at, toAt: b.at, kind });
  };
  for (const h of route.holes) {
    const inside = points.filter((p) => p.at >= h.fromAt && p.at <= h.toAt);
    for (let i = 1; i < inside.length; i++) add(inside[i - 1], inside[i], h.kind);
  }
  if (route.lineEndAt !== null) {
    const end = route.lineEndAt;
    const tail = points.filter((p) => p.at >= end);
    for (let i = 1; i < tail.length; i++) add(tail[i - 1], tail[i], null);
  }
  return out;
}

export interface Run {
  band: SpeedBand;
  color: string;
  points: LatLng[];
}

/**
 * The line as runs of one speed band: each step (from one point to the next) takes the band of the speed that reached
 * its end, and runs of one band are joined, each sharing its first point with the run before so the line has no breaks.
 * A step in `breaks` (a hole drawn dashed, a gap drawn as its estimated road; keyed "fromAt|toAt") is left out and starts
 * a new run after it. A run of one point is nothing to draw.
 */
export function runsOf(points: readonly RoutePoint[], breaks: ReadonlySet<string> = new Set()): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (breaks.has(`${a.at}|${b.at}`)) {
      cur = null;
      continue;
    }
    const band = speedBand(b.kmh);
    if (!cur || cur.band !== band) {
      cur = { band, color: BAND_COLORS[band], points: [a, b] };
      runs.push(cur);
    } else cur.points.push(b);
  }
  return runs;
}

export interface StopMark extends LatLng {
  key: string;
  /** "09:12". */
  from: string;
  to: string;
  minutes: number;
  near: string | null;
  /** "09:12–09:40 · 28 min": shown when the circle is tapped. */
  label: string;
}

/** "09:12–09:40 · 28 min" (one time when the stop began and ended within the same minute). */
export function stopLabel(stop: Pick<RouteStopView, 'from' | 'to' | 'minutes'>, t: Words): string {
  const when = stop.from === stop.to ? stop.from : `${stop.from}–${stop.to}`;
  return `${when} · ${durationText(t, stop.minutes)}`;
}

export interface RouteDrawing {
  /** The driver and the day: the map frames the route once per key, never on the merges that grow it. */
  key: string;
  username: string;
  runs: Run[];
  holes: HoleLine[];
  estimated: { key: string; points: LatLng[] }[];
  stops: StopMark[];
  /** Round 48 (item 3): the start and end pins, and the gap markers (drawn by the Layers filter: office/routeMarks.ts). */
  ends: EndMarks | null;
  gaps: GapMark[];
  /** The frame around the line and the estimated roads. */
  frame: Frame;
}

/**
 * What both engines draw for the shown route: the runs by speed, the holes dashed (a hole covered by an estimated road
 * line is drawn as that line instead), the estimated roads, the stops with their labels, and the frame around it all.
 * Null with no route or no point.
 */
export function drawingOf(route: Route | null, t: Words): RouteDrawing | null {
  if (!route || route.points.length === 0) return null;
  const est = route.estimated.filter((e) => e.points.length > 1);
  const estKeys = new Set(est.map(holeKey));
  const holes = holesOf(route, route.points).filter((h) => !estKeys.has(holeKey(h)));
  const breaks = new Set([...estKeys, ...holes.map(holeKey)]);
  return {
    key: `${route.username}:${route.date}`,
    username: route.username,
    runs: runsOf(route.points, breaks),
    holes,
    estimated: est.map((e, i) => ({ key: `est:${i}:${e.fromAt}`, points: e.points })),
    stops: route.stops.map((s, i) => ({ key: `stop:${i}:${s.from}`, lat: s.lat, lng: s.lng, from: s.from, to: s.to, minutes: s.minutes, near: s.near, label: stopLabel(s, t) })),
    ends: endsOf(route.points, clockS),
    gaps: gapMarksOf(gapSources(route), route.points, clockS),
    frame: frameOf([...route.points, ...est.flatMap((e) => e.points)]),
  };
}

/** The gaps that get a marker: the timeline's no-GPS and no-app rows (the same gaps the card counts), else the line's holes. */
function gapSources(route: Pick<Route, 'timeline' | 'holes'>): { kind: GapKind; fromAt: number; toAt: number; minutes?: number }[] {
  const rows = route.timeline.filter((r) => r.kind === 'no_gps' || r.kind === 'no_data');
  if (rows.length) return rows.map((r) => ({ kind: r.kind as GapKind, fromAt: r.fromAt, toAt: r.toAt }));
  return route.holes.map((h) => ({ kind: h.kind, fromAt: h.fromAt, toAt: h.toAt, minutes: h.minutes }));
}

/** The stop circle's sizes, so Google's anchor (a fraction of the view) lands on the circle's centre under the label. */
export const STOP_PIN = { size: 18, labelHeight: 24, gap: 4 } as const;

/** Google's anchor y for a stop: the circle's centre, under the label when it is open. */
export function stopPinAnchorY(labelled: boolean): number {
  if (!labelled) return 0.5;
  const total = STOP_PIN.labelHeight + STOP_PIN.gap + STOP_PIN.size;
  return (STOP_PIN.labelHeight + STOP_PIN.gap + STOP_PIN.size / 2) / total;
}

/** "Today: 61 km · driving 2 h 10 min · stopped 45 min · 3 stops" (the parts the answer has); null with no point. */
export function routeSummary(route: Route | null, t: Words): string | null {
  if (!route || route.points.length === 0) return null;
  const parts = [t('office.live.routeToday', { km: kmText(route.km ?? 0) })];
  if (typeof route.drivingMinutes === 'number') parts.push(t('office.live.routeDriving', { dur: durationText(t, route.drivingMinutes) }));
  if (typeof route.stoppedMinutes === 'number') parts.push(t('office.live.routeStopped', { dur: durationText(t, route.stoppedMinutes) }));
  const n = route.stopsCount ?? route.stops.length;
  parts.push(n === 1 ? t('office.live.routeStopsOne') : t('office.live.routeStops', { n }));
  return parts.join(' · ');
}

// ---- Today's trails ---------------------------------------------------------------------------------------------------

/** At most this many drivers' trails at once; the rest are "+N not drawn". */
export const TRAILS_CAP = 10;

/** Muted colours, one per trail in the drawn order (never a band's colour, so a trail is never read as the shown route). */
export const TRAIL_COLORS: readonly string[] = [
  '#7a8ca8', '#9a8f6a', '#8c7fa6', '#6f9a8a', '#a8847a', '#7f98b0', '#a39a7c', '#8a9d6f', '#9b7f8e', '#7d8f9a',
];

/** The driver is sharing now (the site's rule): the signal says so, else the card's state. */
export function sharingNow(d: Pick<LiveDriver, 'signal' | 'state'>): boolean {
  return d.signal ? d.signal.sharing : d.state !== 'not_sharing';
}

export interface TrailsPlan {
  /** The usernames whose trail is drawn, in the server's order. */
  draw: string[];
  /** Sharing drivers past the cap. */
  notDrawn: number;
}

/** Which sharing drivers get a trail: the first `cap` in the server's order; the rest are counted. */
export function trailsPlan(drivers: readonly Pick<LiveDriver, 'username' | 'signal' | 'state'>[], cap = TRAILS_CAP): TrailsPlan {
  const sharing = drivers.filter(sharingNow).map((d) => d.username);
  return { draw: sharing.slice(0, cap), notDrawn: Math.max(0, sharing.length - cap) };
}

export interface TrailLine {
  username: string;
  color: string;
  points: LatLng[];
  holes: HoleLine[];
}

/**
 * The trails to draw: the planned drivers' routes that have at least two points, each in its colour by place in the plan,
 * with its holes dashed; the driver whose route is shown in full colour is left out (`except`).
 */
export function trailsOf(routes: ReadonlyMap<string, Route>, plan: readonly string[], except: string | null): TrailLine[] {
  return plan.flatMap((u, i): TrailLine[] => {
    if (u === except) return [];
    const r = routes.get(u);
    if (!r || r.points.length < 2) return [];
    return [{ username: u, color: TRAIL_COLORS[i % TRAIL_COLORS.length], points: r.points, holes: holesOf(r, r.points) }];
  });
}

/** True while a planned trail has not come yet (the first load): "Loading trails…". */
export function trailsLoading(plan: readonly string[], routes: ReadonlyMap<string, Route>): boolean {
  return plan.some((u) => !routes.has(u));
}

// ---- The credits ------------------------------------------------------------------------------------------------------

/** openrouteservice's credit wherever one of its lines is drawn, in its own words (never translated). */
export const ORS_CREDIT_FULL = `${ORS_CREDIT} · map data © OpenStreetMap contributors`;

/**
 * The map's credit line with openrouteservice's when an estimated road is drawn: the free map's base already credits
 * OpenStreetMap, Google's map (no base) gets the full line.
 */
export function creditWithOrs(base: string | null, googleMap: boolean, estimated: boolean): string | null {
  if (!estimated) return base;
  const ors = googleMap ? ORS_CREDIT_FULL : ORS_CREDIT;
  return base ? `${base} · ${ors}` : ors;
}

// ---- Playback ---------------------------------------------------------------------------------------------------------

export const SPEEDS = [1, 5, 20, 60] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

/** A tick longer than this (the app in the background, a stall) moves the clock this much only: the marker never leaps. */
export const MAX_FRAME_MS = 250;
/** The clock ticks this often while playing (a native marker moving 8 times a second reads as smooth). */
export const PLAYBACK_TICK_MS = 125;

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

/** Within a second of each other: an estimated line's ends and the line points it joins. */
const SAME_MS = 1000;

/**
 * The path for a line and its gaps' estimated lines: the points in time order (exact repeats dropped), each estimated
 * line put between the two line points it joins with its points timed along it by distance, and every run of points
 * sharing one time spread between the times around it (by distance), so the position never jumps.
 */
export function playbackPath(line: readonly { at: number; lat: number; lng: number }[], estimated: readonly EstimatedView[] = []): PathPoint[] {
  const sorted = [...line].filter((p) => Number.isFinite(p.at) && Number.isFinite(p.lat) && Number.isFinite(p.lng)).sort((a, b) => a.at - b.at);
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
function headingAt(path: readonly PathPoint[], i: number): number | null {
  for (let s = i; s >= 1; s--) if (distanceM(path[s - 1], path[s]) >= TURN_MIN_M) return bearing(path[s - 1], path[s]);
  for (let s = i + 1; s < path.length; s++) if (distanceM(path[s - 1], path[s]) >= TURN_MIN_M) return bearing(path[s - 1], path[s]);
  return null;
}

export interface Position {
  lat: number;
  lng: number;
  /** The path's direction, degrees from north; null when the path never moves. */
  heading: number | null;
  /** In a gap: no real position (drawn hollow, the label says "estimated"). */
  estimated: boolean;
}

/** Is t inside a gap window (from inclusive, to exclusive). */
export const inGap = (windows: readonly GapWindow[], t: number) => windows.some((w) => t >= w.fromAt && t < w.toAt);

/** The last index of the path at or before t (0 before the start, the last index past the end; -1 on an empty path). */
export function indexAt(path: readonly PathPoint[], t: number): number {
  if (!path.length) return -1;
  if (t < path[0].at) return 0;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].at <= t) lo = mid;
    else hi = mid;
  }
  return path[hi].at <= t ? hi : lo;
}

/** The index after i, never past the end. */
export const nextIndex = (path: readonly PathPoint[], i: number) => Math.min(path.length - 1, Math.max(0, i + 1));

/** The marker at time t: interpolated along the path (clamped to its ends). */
export function positionOn(path: readonly PathPoint[], t: number, windows: readonly GapWindow[] = []): Position | null {
  if (!path.length) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (path.length === 1 || t <= first.at) return { lat: first.lat, lng: first.lng, heading: headingAt(path, 1), estimated: inGap(windows, t) };
  if (t >= last.at) return { lat: last.lat, lng: last.lng, heading: headingAt(path, path.length - 1), estimated: inGap(windows, t) };
  const lo = indexAt(path, t);
  const hi = nextIndex(path, lo);
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

/** The recorded clock after one tick: frameMs of real time × the speed (a long tick capped), never past the end. */
export function advance(t: number, frameMs: number, speed: number, end: number): number {
  const real = Math.max(0, Math.min(MAX_FRAME_MS, frameMs));
  return Math.min(end, t + real * speed);
}

/**
 * The windows with no real position on a route: the tool's holes, the estimated lines, and the timeline rows with no GPS
 * fix or no app (the marker stays where the line says, hollow).
 */
export function gapWindowsOf(route: Pick<Route, 'holes' | 'estimated' | 'timeline'> | null): GapWindow[] {
  if (!route) return [];
  const out: GapWindow[] = [];
  for (const h of route.holes) out.push({ fromAt: h.fromAt, toAt: h.toAt });
  for (const e of route.estimated) out.push({ fromAt: e.fromAt, toAt: e.toAt });
  for (const r of route.timeline) if (r.kind === 'no_data' || r.kind === 'no_gps') out.push({ fromAt: r.fromAt, toAt: r.toAt });
  return out.filter((w) => Number.isFinite(w.fromAt) && Number.isFinite(w.toAt) && w.toAt > w.fromAt).sort((a, b) => a.fromAt - b.fromAt);
}

/** The km/h of the step under way at t: the speed that reaches the first line point after t; 0 before the line or past its end. */
export function speedAtTime(points: readonly RoutePoint[], t: number): number {
  if (!points.length || t < points[0].at || t >= points[points.length - 1].at) return 0;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].at <= t) lo = mid;
    else hi = mid;
  }
  return points[hi].kmh;
}

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const two = (n: number) => String(n).padStart(2, '0');

/** "14:32:05" in Colombo time (Latin digits), from Unix ms. */
export function clockS(ms: number): string {
  const d = new Date(ms + COLOMBO_OFFSET_MS);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
}

/** The playback marker: where, the recorded time, the speed (null while estimated), hollow while estimated, turned to the path. */
export interface Cursor extends LatLng {
  time: string;
  kmh: number | null;
  estimated: boolean;
  heading: number | null;
}

export function cursorAt(route: Pick<Route, 'points'> | null, path: readonly PathPoint[], windows: readonly GapWindow[], t: number): Cursor | null {
  const pos = positionOn(path, t, windows);
  if (!pos || !route) return null;
  return { lat: pos.lat, lng: pos.lng, heading: pos.heading, estimated: pos.estimated, time: clockS(t), kmh: pos.estimated ? null : speedAtTime(route.points, t) };
}

/** The slider's place for a time: 0 at the start, 1 at the end (0 on a route with no span). */
export function sliderFraction(t: number, start: number, end: number): number {
  if (!(end > start)) return 0;
  return Math.max(0, Math.min(1, (t - start) / (end - start)));
}

/** The time at a place on the slider (clamped). */
export function timeAtFraction(k: number, start: number, end: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, k));
}

/** The playback bar shows for a path with a span to play. */
export const canPlay = (path: readonly PathPoint[]) => path.length >= 2 && path[path.length - 1].at > path[0].at;

// ---- What both engines are given --------------------------------------------------------------------------------------

export interface LiveLayers {
  trails: TrailLine[];
  route: RouteDrawing | null;
  cursor: Cursor | null;
  /** Round 48 (item 3): the Layers choices of the Filter sheet (the gap markers, every stop's time). */
  show: RouteLayers;
}

export const NO_LAYERS: LiveLayers = { trails: [], route: null, cursor: null, show: NO_ROUTE_LAYERS };

/** The box around a route's line, for a test or a frame by hand. */
export const routeBounds = (route: Pick<Route, 'points'>) => boundsOf(route.points);
