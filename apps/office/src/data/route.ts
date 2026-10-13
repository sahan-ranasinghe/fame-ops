// A driver's route on the client: the tool's answer (driver_route) turned into
// points, stops, gaps and timeline rows, plus what the page does by itself:
// it grows today's line from the driver_latest rows Realtime delivers, zooms
// to a timeline row, and feeds the playback. The speed classes and the
// interpolation come from the shared route module, the limits from the shared
// drift filter (the files the connector runs).
import { type LinePoint, positionAt, speedClass } from "@fleet/route";
import { colomboClock } from "@fleet/status";
import { distanceM, MAX_ACCURACY_M, MIN_MOVE_M } from "@fleet/track";
import { joinDots } from "../lib/format";
import type { MapRoute } from "../map/types";
import type { LatestRow } from "./live";
import type { DriverRoute, SegmentKind } from "./types";

export { positionAt, speedClass };

export type RoutePoint = LinePoint;

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
  text: string;
}

export interface Route {
  username: string;
  date: string;
  km?: number;
  /** Points recorded (raw). */
  count: number;
  usable?: number;
  first?: string;
  last?: string;
  points: RoutePoint[];
  stops: StopView[];
  gaps: { from: string; to: string; minutes: number }[];
  timeline: TimelineRow[];
  drivingMinutes?: number;
  stoppedMinutes?: number;
  stopsCount?: number;
  note?: string;
  task?: DriverRoute["task"];
  window?: DriverRoute["window"];
}

/** The tool's answer → the route the screens use. Older answers (four columns, no timeline) still work. */
export function routeOf(username: string, p: DriverRoute): Route {
  const cols = p.route?.columns ?? ["time", "lat", "lng", "km/h"];
  const la = cols.indexOf("lat"), lo = cols.indexOf("lng"), sp = cols.indexOf("km/h"), at = cols.indexOf("at"), tm = cols.indexOf("time");
  const dayStart = Date.parse(`${p.date}T00:00:00+05:30`);
  const points: RoutePoint[] = [];
  for (const r of p.route?.points ?? []) {
    const lat = Number(r[la]), lng = Number(r[lo]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    // The ISO time when the tool gives it; else the HH:MM on the day (older answers).
    let ms = at >= 0 ? Date.parse(String(r[at])) : NaN;
    if (!isFinite(ms) && tm >= 0 && isFinite(dayStart)) {
      const [h, m] = String(r[tm]).split(":").map(Number);
      ms = dayStart + (h * 60 + m) * 60000;
    }
    points.push({ at: isFinite(ms) ? ms : points.length, lat, lng, kmh: sp >= 0 ? Number(r[sp]) || 0 : 0 });
  }
  const stops: StopView[] = (p.stops_over_10_min ?? []).map((s) => ({ ...s, text: joinDots([`${s.from}–${s.to}`, s.near && `near ${s.near}`, `${s.minutes} min`]) }));
  const timeline: TimelineRow[] = (p.timeline ?? []).map((s) => ({
    kind: s.kind, from: s.from, to: s.to, fromAt: Date.parse(s.from_at), toAt: Date.parse(s.to_at), minutes: s.minutes, km: s.km, near: s.near, lat: s.lat, lng: s.lng, text: s.text,
  }));
  return {
    username, date: p.date, km: p.km, count: p.recorded_points ?? points.length, usable: p.usable_points, first: p.first_point, last: p.last_point,
    points, stops, gaps: p.gaps ?? [], timeline, drivingMinutes: p.driving_minutes, stoppedMinutes: p.stopped_minutes, stopsCount: p.stops_count,
    note: p.note, task: p.task, window: p.window,
  };
}

/**
 * A Realtime row from driver_latest grows today's line: a precise position that
 * moved becomes a point; standing still only extends the wait at the last place.
 * The numbers and the timeline follow at the next refresh of the tool.
 */
export function appendLive(route: Route, row: LatestRow): Route {
  if (!row.recorded_at || row.lat == null || row.lng == null) return route;
  if (row.accuracy_m != null && row.accuracy_m > MAX_ACCURACY_M) return route;
  const at = Date.parse(row.recorded_at);
  const last = route.points[route.points.length - 1];
  if (!isFinite(at) || (last && at <= last.at)) return route;
  const here = { lat: row.lat, lng: row.lng };
  const lastClock = colomboClock(row.recorded_at);
  if (!last) return { ...route, points: [{ at, ...here, kmh: 0 }], count: route.count + 1, last: lastClock };
  const metres = distanceM(last, here);
  if (metres < MIN_MOVE_M) {
    const before = route.points[route.points.length - 2];
    const wait = { at, lat: last.lat, lng: last.lng, kmh: 0 };
    const stillWaiting = before && before.lat === last.lat && before.lng === last.lng;
    return { ...route, points: stillWaiting ? [...route.points.slice(0, -1), wait] : [...route.points, wait], count: route.count + 1, last: lastClock };
  }
  const kmh = Math.round((metres / ((at - last.at) / 1000)) * 3.6);
  const km = route.km != null ? Math.round((route.km + metres / 1000) * 10) / 10 : undefined;
  return { ...route, points: [...route.points, { at, ...here, kmh }], count: route.count + 1, km, last: lastClock };
}

/** The points of a timeline row, to zoom the map to. */
export function focusOf(route: Route, row: TimelineRow): { lat: number; lng: number }[] {
  if (row.kind === "stopped" && row.lat != null && row.lng != null) return [{ lat: row.lat, lng: row.lng }];
  const inside = route.points.filter((p) => p.at >= row.fromAt && p.at <= row.toAt);
  if (inside.length) return inside;
  return gapEnds(route, row.fromAt, row.toAt);
}

/** The last known position before a gap and the first after it. */
function gapEnds(route: Route, fromAt: number, toAt: number): RoutePoint[] {
  let before: RoutePoint | undefined;
  for (const p of route.points) {
    if (p.at <= fromAt) before = p;
    else break;
  }
  const after = route.points.find((p) => p.at >= toAt);
  return [before, after].filter((p): p is RoutePoint => !!p);
}

/** "1 h 5 min", "45 min". */
export const minutesText = (m: number | undefined | null) => m == null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;

/** What the map draws for a route: the line by speed, the stops with their times, the gaps dashed, the playback marker. */
export function mapRouteOf(route: Route | null, cursor?: { lat: number; lng: number; label: string } | null): MapRoute | null {
  if (!route || !route.points.length) return null;
  const gaps = route.timeline.filter((r) => r.kind === "no_data").map((r) => gapEnds(route, r.fromAt, r.toAt)).filter((e) => e.length === 2).map(([from, to]) => ({ from, to }));
  return {
    points: route.points,
    bySpeed: true,
    stops: route.stops.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng!, label: `${s.from}–${s.to}` })),
    gaps,
    cursor: cursor ?? null,
  };
}

/** The lighter line of another driver on the live map. */
export const trailOf = (route: Route): MapRoute => ({ points: route.points });

export const KIND_LABEL: Record<SegmentKind, string> = { driving: "Driving", stopped: "Stopped", no_data: "No data" };
