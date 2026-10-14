// A driver's route on the client: the tool's answer (driver_route) turned into
// points, stops, holes and timeline rows, plus what the pages do by themselves:
// they grow today's lines point by point from the location_points rows Realtime
// delivers (each one put in by its time, so a late backlog fills its gap in
// the right place: the driver page and the live map's trails), zoom to a
// timeline row, and feed the playback. The speed
// classes, the hole rule and the interpolation come from the shared route
// module, the limits from the shared drift filter (the files the connector runs).
import { HOLE_MINUTES, insertByTime, type LinePoint, OUTLIER_SPEED_KMH, positionAt, SPIKE_FACTOR, SPIKE_MIN_M, SPIKE_WINDOW_MS, speedClass } from "@fleet/route";
import { colomboClock } from "@fleet/status";
import { distanceM } from "@fleet/track";
import { joinDots } from "../lib/format";
import type { MapRoute, RoutePoint as MapPoint } from "../map/types";
import type { PointRow } from "./realtime";
import type { DriverRoute, GapKind, SegmentKind } from "./types";

export { positionAt, speedClass };

export type RoutePoint = LinePoint;

/** Stored fixes worse than this are not drawn (the phone does not store them either). */
export const DRAW_MAX_ACCURACY_M = 150;

export interface StopView {
  from: string;
  to: string;
  minutes: number;
  near?: string | null;
  maps?: string;
  lat?: number;
  lng?: number;
  text: string;
}

export interface TimelineRow {
  kind: SegmentKind;
  from: string;
  to: string;
  fromAt: number;
  toAt: number;
  minutes: number;
  km?: number;
  near?: string | null;
  lat?: number;
  lng?: number;
  /** "HH:MM" when the leg's points landed late (the phone was offline here). */
  uploaded?: string;
  text: string;
}

export interface HoleView {
  fromAt: number;
  toAt: number;
  minutes: number;
  kind: GapKind;
  text: string;
}

export interface Route {
  username: string;
  date: string;
  km?: number;
  /** Points recorded (raw). */
  count: number;
  usable?: number;
  /** Points on the line the tool drew (after thinning). */
  shown?: number;
  first?: string;
  last?: string;
  points: RoutePoint[];
  /** The line with the driving legs snapped to roads, when the tool answered one. */
  snappedPoints?: (RoutePoint & { snapped?: boolean })[];
  snapped?: DriverRoute["snapped"];
  stops: StopView[];
  gaps: { from: string; to: string; minutes: number; kind?: GapKind }[];
  holes: HoleView[];
  /** The time of the last point of the line the tool drew (points after it came from Realtime). */
  lineEndAt: number | null;
  timeline: TimelineRow[];
  drivingMinutes?: number;
  stoppedMinutes?: number;
  stopsCount?: number;
  note?: string;
  task?: DriverRoute["task"];
  window?: DriverRoute["window"];
}

function pointsOf(date: string, route: DriverRoute["route"] | undefined): (RoutePoint & { snapped?: boolean })[] {
  const cols = route?.columns ?? ["time", "lat", "lng", "km/h"];
  const la = cols.indexOf("lat"), lo = cols.indexOf("lng"), sp = cols.indexOf("km/h"), at = cols.indexOf("at"), tm = cols.indexOf("time");
  const ac = cols.indexOf("acc"), sn = cols.indexOf("snapped");
  const dayStart = Date.parse(`${date}T00:00:00+05:30`);
  const points: (RoutePoint & { snapped?: boolean })[] = [];
  for (const r of route?.points ?? []) {
    const lat = Number(r[la]), lng = Number(r[lo]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    // The ISO time when the tool gives it; else the HH:MM on the day (older answers).
    let ms = at >= 0 ? Date.parse(String(r[at])) : NaN;
    if (!isFinite(ms) && tm >= 0 && isFinite(dayStart)) {
      const [h, m] = String(r[tm]).split(":").map(Number);
      ms = dayStart + (h * 60 + m) * 60000;
    }
    const p: RoutePoint & { snapped?: boolean } = { at: isFinite(ms) ? ms : points.length, lat, lng, kmh: sp >= 0 ? Number(r[sp]) || 0 : 0 };
    if (ac >= 0 && r[ac] != null && isFinite(Number(r[ac]))) p.acc = Number(r[ac]);
    if (sn >= 0) p.snapped = Number(r[sn]) === 1;
    points.push(p);
  }
  return points;
}

/** The tool's answer → the route the screens use. Older answers (four columns, no timeline) still work. */
export function routeOf(username: string, p: DriverRoute): Route {
  const points = pointsOf(p.date, p.route);
  const stops: StopView[] = (p.stops_over_10_min ?? []).map((s) => ({ ...s, text: joinDots([`${s.from}–${s.to}`, s.near && `near ${s.near}`, `${s.minutes} min`]) }));
  const timeline: TimelineRow[] = (p.timeline ?? []).map((s) => ({
    kind: s.kind, from: s.from, to: s.to, fromAt: Date.parse(s.from_at), toAt: Date.parse(s.to_at), minutes: s.minutes, km: s.km, near: s.near, lat: s.lat, lng: s.lng,
    uploaded: s.uploaded, text: s.text,
  }));
  const holes: HoleView[] = (p.holes ?? []).map((h) => ({ fromAt: Date.parse(h.from_at), toAt: Date.parse(h.to_at), minutes: h.minutes, kind: h.kind, text: h.text }));
  return {
    username, date: p.date, km: p.km, count: p.recorded_points ?? points.length, usable: p.usable_points, shown: p.points_shown, first: p.first_point, last: p.last_point,
    points, snappedPoints: p.route_snapped ? pointsOf(p.date, p.route_snapped) : undefined, snapped: p.snapped,
    stops, gaps: p.gaps ?? [], holes, lineEndAt: points.length ? points[points.length - 1].at : null, timeline,
    drivingMinutes: p.driving_minutes, stoppedMinutes: p.stopped_minutes, stopsCount: p.stops_count,
    note: p.note, task: p.task, window: p.window,
  };
}

/** Is a point an outlier against its neighbours on the line: a jump of over 150 km/h, or an out-and-back spike. */
export function outlierAgainst(point: RoutePoint, prev: RoutePoint | undefined, next: RoutePoint | undefined): boolean {
  if (prev && point.at > prev.at && (distanceM(prev, point) / ((point.at - prev.at) / 1000)) * 3.6 > OUTLIER_SPEED_KMH) return true;
  if (next && next.at > point.at && (distanceM(point, next) / ((next.at - point.at) / 1000)) * 3.6 > OUTLIER_SPEED_KMH) return true;
  if (prev && next && next.at - prev.at <= SPIKE_WINDOW_MS) {
    const spike = Math.max(SPIKE_FACTOR * (point.acc ?? 10), SPIKE_MIN_M);
    const dPrev = distanceM(prev, point), dNext = distanceM(point, next);
    if (dPrev > spike && dNext > spike && distanceM(prev, next) < Math.min(dPrev, dNext) / 2) return true;
  }
  return false;
}

/**
 * A new location point (Realtime) goes into today's line by its time, so a late backlog fills its gap in
 * the right place. Fixes worse than 150 m and outliers against their neighbours are left out; a point at a
 * time the line already has is ignored. The km, the timeline and the holes' kinds follow at the next refresh.
 */
export function insertPoint(route: Route, row: PointRow): Route {
  if (row.accuracy_m != null && row.accuracy_m > DRAW_MAX_ACCURACY_M) return route;
  const at = Date.parse(row.recorded_at);
  if (!isFinite(at)) return route;
  const point: RoutePoint = { at, lat: row.lat, lng: row.lng, kmh: 0, acc: row.accuracy_m ?? null };
  let lo = 0, hi = route.points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (route.points[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  if (route.points[lo]?.at === at) return route;
  if (outlierAgainst(point, route.points[lo - 1], route.points[lo])) return route;
  const points = insertByTime(route.points, point);
  const last = points[points.length - 1];
  return { ...route, points, count: route.count + 1, last: last.at === at ? colomboClock(row.recorded_at) : route.last };
}

/** The points of a timeline row, to zoom the map to. */
export function focusOf(route: Route, row: TimelineRow): { lat: number; lng: number }[] {
  if (row.kind === "stopped" && row.lat != null && row.lng != null) return [{ lat: row.lat, lng: row.lng }];
  const inside = route.points.filter((p) => p.at >= row.fromAt && p.at <= row.toAt);
  if (inside.length) return inside;
  return gapEnds(route.points, row.fromAt, row.toAt);
}

/** The last known position before a gap and the first after it. */
function gapEnds(points: RoutePoint[], fromAt: number, toAt: number): RoutePoint[] {
  let before: RoutePoint | undefined;
  for (const p of points) {
    if (p.at <= fromAt) before = p;
    else break;
  }
  const after = points.find((p) => p.at >= toAt);
  return [before, after].filter((p): p is RoutePoint => !!p);
}

/** "1 h 5 min", "45 min". */
export const minutesText = (m: number | undefined | null) => m == null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;

export const KIND_LABEL: Record<SegmentKind, string> = { driving: "Driving", stopped: "Stopped", no_gps: "Stopped · no GPS signal", no_data: "App not running" };
const HOLE_LABEL: Record<GapKind, string> = { no_gps: "No GPS signal", no_data: "App not running" };

/**
 * The holes to draw dashed: the tool's holes (over 2 minutes between two line points at different places;
 * the thinned line keeps both ends), each cut by any point Realtime put inside it since, and the same rule
 * over the points that came after the tool's line. A thinned straight run is never a hole: only the tool
 * knows which points it left out.
 */
export function holesOf(route: Route, points: RoutePoint[]): { from: MapPoint; to: MapPoint; label: string }[] {
  const out: { from: MapPoint; to: MapPoint; label: string }[] = [];
  const add = (a: RoutePoint, b: RoutePoint, kind: GapKind | undefined) => {
    if ((a.lat === b.lat && a.lng === b.lng) || b.at - a.at < HOLE_MINUTES * 60000) return;
    out.push({ from: a, to: b, label: `${kind ? HOLE_LABEL[kind] : "No position"} · ${Math.round((b.at - a.at) / 60000)} min` });
  };
  for (const h of route.holes) {
    const inside = points.filter((p) => p.at >= h.fromAt && p.at <= h.toAt);
    for (let i = 1; i < inside.length; i++) add(inside[i - 1], inside[i], h.kind);
  }
  if (route.lineEndAt != null) {
    const tail = points.filter((p) => p.at >= route.lineEndAt!);
    for (let i = 1; i < tail.length; i++) add(tail[i - 1], tail[i], undefined);
  }
  return out;
}

/** What the map draws for a route: the line by speed (snapped to roads when asked and available), the stops, the holes dashed, the playback marker. */
export function mapRouteOf(route: Route | null, cursor?: { lat: number; lng: number; label: string } | null, snap = false): MapRoute | null {
  if (!route || !route.points.length) return null;
  const points = snap && route.snappedPoints && route.snappedPoints.length > 1 ? route.snappedPoints : route.points;
  return {
    points,
    bySpeed: true,
    stops: route.stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng!, label: `${s.from}–${s.to}` })),
    holes: holesOf(route, points),
    cursor: cursor ?? null,
  };
}

/** The lighter line of another driver on the live map. */
export const trailOf = (route: Route): MapRoute => ({ points: route.points });

/** The legend line for the snapped line: what the map shows and where the km come from. */
export function snapLegend(route: Route | null, snap: boolean): string | null {
  if (!route?.snapped || route.snapped.status === "off") return null;
  if (!snap) return "Raw GPS line";
  if (route.snapped.status === "failed" || !route.snappedPoints?.length) return "Raw GPS (snapping to roads failed)";
  return `Snapped to roads · km from odometer${route.snapped.status === "partial" ? " · some legs raw GPS" : ""}`;
}
