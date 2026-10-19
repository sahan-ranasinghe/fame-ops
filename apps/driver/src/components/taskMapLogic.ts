// The task map's rules (Phase 7, §20 and §24). Pure: no React, so scripts/test-rules.ts runs it.
//   - The stops on the map: numbered by their place in the order (the start stop marked), each with its arrive-by time,
//     else its planned arrival (HH:MM, Colombo); reached, done and skipped stops muted, the current one standing out.
//   - The planned road line: each plan leg's Google polyline (legs[].line), on Google's map only (rule 10,
//     lib/mapRule.ts). Where there is none to draw (the free map, or a plan without Google's line) dashed straight lines
//     join the start and the stops the map draws, in order (Part 6: the same map on both engines). The free map never
//     gets a Google stop.
//   - "Distance left by road": the current leg's road km in proportion to the straight distance still to go, plus the
//     road km of the later legs to stops still to do (never the leg back to base).
//   - The compass shows while the map is turned or tilted.

import { stopNumber } from '../lib/dayRules';
import { distanceKm } from '../lib/format';
import { drawnDestination } from '../lib/mapRule';
import { decodePolyline, type LatLng } from '../lib/polyline';
import { colomboTime } from '../lib/time';
import type { TaskStop, TaskWithStops } from '../lib/types';

export type { LatLng };

/** One leg of the stored plan (plan_json.legs[]), read defensively: the JSON may come from an older plan. */
export interface PlanLeg {
  /** 0 = the start; else a stop's seq. */
  from_seq: number;
  /** A stop's seq; -1 = back to base. */
  to_seq: number;
  km: number | null;
  /** Google's encoded polyline (only when the plan came from Google's Routes call; removed after 30 days). */
  line: string | null;
}

export function planLegs(plan: unknown): PlanLeg[] {
  const legs = plan !== null && typeof plan === 'object' ? (plan as { legs?: unknown }).legs : null;
  if (!Array.isArray(legs)) return [];
  return legs.flatMap((leg): PlanLeg[] => {
    if (leg === null || typeof leg !== 'object') return [];
    const { from_seq, to_seq, km, line } = leg as Record<string, unknown>;
    if (typeof from_seq !== 'number' || typeof to_seq !== 'number') return [];
    return [{
      from_seq,
      to_seq,
      km: typeof km === 'number' && Number.isFinite(km) && km >= 0 ? km : null,
      line: typeof line === 'string' && line !== '' ? line : null,
    }];
  });
}

type StopsOf = Pick<TaskWithStops, 'task_stops'>;

/** The stops still on the task, in order (removed ones never shown). */
function ordered(task: StopsOf): TaskStop[] {
  return task.task_stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
}

/** The stop being driven to (or stood at): the first one not yet done or skipped, as the task screen's nextStop. */
export function currentStop(task: StopsOf): TaskStop | null {
  return ordered(task).find((s) => s.status === 'pending' || s.status === 'arrived') ?? null;
}

function pointOf(stop: Pick<TaskStop, 'lat' | 'lng'> | null | undefined): LatLng | null {
  return stop?.lat != null && stop.lng != null ? { lat: stop.lat, lng: stop.lng } : null;
}

export type StopState = 'current' | 'todo' | 'done';

export interface MapStop {
  id: string;
  /** The stop's number by its place in the order ("Stop 2"). */
  n: number;
  lat: number;
  lng: number;
  /** "09:00": the arrive-by, else the planned arrival (Colombo); null when the plan has neither. */
  time: string | null;
  /** The start stop ("passengers get in here"): Stop 1, marked. */
  isStart: boolean;
  state: StopState;
}

/** The stops the map draws: those with a pin, a Google place only on Google's map (rule 10). */
export function mapStops(task: StopsOf, googleMap: boolean): MapStop[] {
  const current = currentStop(task);
  return ordered(task).flatMap((s): MapStop[] => {
    const point = drawnDestination(s, googleMap);
    if (!point) return [];
    const at = s.arrive_by ?? s.planned_arrive_at;
    const state: StopState = current?.id === s.id ? 'current' : s.status === 'pending' ? 'todo' : 'done';
    return [{ id: s.id, n: stopNumber(task, s.id), lat: point[1], lng: point[0], time: at ? colomboTime(at) : null, isStart: s.is_start === true, state }];
  });
}

type StartOf = Pick<TaskWithStops, 'task_stops' | 'start_lat' | 'start_lng' | 'start_google_place_id'>;

/**
 * Where the trip starts, when it is not a stop (with "passengers get in here" the start is Stop 1, drawn as a stop).
 * A start picked from Google's search is drawn on Google's map only.
 */
export function startPoint(task: StartOf, googleMap: boolean): LatLng | null {
  if (ordered(task).some((s) => s.is_start === true)) return null;
  const point = drawnDestination({ lat: task.start_lat, lng: task.start_lng, google_place_id: task.start_google_place_id }, googleMap);
  return point ? { lat: point[1], lng: point[0] } : null;
}

export interface RouteLeg {
  key: string;
  /** The leg's stop is reached (arrived, done or skipped): drawn muted. */
  done: boolean;
  points: LatLng[];
  /** A straight line between two points (no road line to draw): dashed. */
  dashed?: boolean;
}

type PlanOf = Pick<TaskWithStops, 'task_stops' | 'plan_json'>;

/**
 * The planned road line, leg by leg, decoded from the plan's Google polylines. Google's content: none at all unless
 * the map is Google's (rule 10). A leg to a stop no longer on the task is left out.
 */
export function routeLines(task: PlanOf, googleMap: boolean): RouteLeg[] {
  if (!googleMap) return [];
  const bySeq = new Map(ordered(task).map((s) => [s.seq, s]));
  return planLegs(task.plan_json).flatMap((leg, i): RouteLeg[] => {
    if (!leg.line) return [];
    const to = leg.to_seq === -1 ? null : bySeq.get(leg.to_seq);
    if (leg.to_seq !== -1 && !to) return [];
    const points = decodePolyline(leg.line);
    if (points.length < 2) return [];
    return [{ key: `${i}:${leg.from_seq}-${leg.to_seq}`, done: to ? to.status !== 'pending' : false, points }];
  });
}

/**
 * Dashed straight lines from the start through the stops the map draws, in order: what both maps show when there is no
 * road line to draw. A leg is muted once its stop is reached. Ours only (our pins, never Google's line).
 */
export function straightLines(stops: readonly MapStop[], start: LatLng | null): RouteLeg[] {
  const points: { id: string; p: LatLng; done: boolean }[] = [
    ...(start ? [{ id: 'start', p: start, done: true }] : []),
    ...stops.map((s) => ({ id: s.id, p: { lat: s.lat, lng: s.lng }, done: s.state === 'done' })),
  ];
  const legs: RouteLeg[] = [];
  for (let i = 1; i < points.length; i++) {
    legs.push({ key: `straight:${points[i - 1].id}-${points[i].id}`, done: points[i].done, points: [points[i - 1].p, points[i].p], dashed: true });
  }
  return legs;
}

/** The lines a map draws: Google's road line on Google's map when the plan has it, else the dashed straight lines. */
export function mapLines(task: PlanOf, googleMap: boolean, stops: readonly MapStop[], start: LatLng | null): RouteLeg[] {
  const road = routeLines(task, googleMap);
  return road.length > 0 ? road : straightLines(stops, start);
}

/** The task has a planned road line stored (any leg with a usable polyline). */
export function hasRouteLine(task: Pick<TaskWithStops, 'plan_json'>): boolean {
  return planLegs(task.plan_json).some((leg) => leg.line !== null && decodePolyline(leg.line).length >= 2);
}

type RoadOf = Pick<TaskWithStops, 'task_stops' | 'plan_json' | 'start_lat' | 'start_lng'>;

/** Where a leg begins: the stop it leaves (or the task's start), else the first point of its own line. */
function legStart(leg: PlanLeg, task: RoadOf, bySeq: Map<number, TaskStop>): LatLng | null {
  const from = leg.from_seq === 0
    ? (task.start_lat != null && task.start_lng != null ? { lat: task.start_lat, lng: task.start_lng } : null)
    : pointOf(bySeq.get(leg.from_seq));
  if (from) return from;
  const line = leg.line ? decodePolyline(leg.line) : [];
  return line[0] ?? null;
}

/**
 * The road km still to drive (§20): the current stop's leg's road km × (the straight distance from me to that stop ÷
 * the leg's straight length from its start to that stop, at most 1), plus the road km of every later leg to a stop
 * still to do. A reached stop's leg counts nothing; the leg back to base (to_seq -1) is left out. Null when it can't
 * be said (no plan, no km for those legs, no position, no pin): the screen then shows the straight line. 0 when no
 * stop is left to do.
 */
export function roadKmLeft(task: RoadOf, me: LatLng | null): number | null {
  const legs = planLegs(task.plan_json);
  if (legs.length === 0) return null;
  const stops = ordered(task);
  const bySeq = new Map(stops.map((s) => [s.seq, s]));
  const current = currentStop(task);
  if (!current) return 0;
  let km = 0;
  if (current.status === 'pending') {
    const leg = legs.find((l) => l.to_seq === current.seq);
    const to = pointOf(current);
    if (!leg || leg.km === null || !to || !me) return null;
    const from = legStart(leg, task, bySeq);
    if (!from) return null;
    const legStraight = distanceKm(from, to);
    const toGo = distanceKm(me, to);
    const share = legStraight > 0 ? Math.min(1, toGo / legStraight) : toGo > 0 ? 1 : 0;
    km += leg.km * share;
  }
  for (const leg of legs) {
    if (leg.to_seq === -1) continue;
    const stop = bySeq.get(leg.to_seq);
    if (!stop || stop.seq <= current.seq || stop.status !== 'pending') continue;
    if (leg.km === null) return null;
    km += leg.km;
  }
  return km;
}

/** "4.2" under 10 km, "42" above (Latin digits in both languages); 9.96 is "10", never "10.0". */
export function kmText(km: number): string {
  return km < 9.95 ? km.toFixed(1) : String(Math.round(km));
}

/** The corners of the box around the points; null for none. */
export function boundsOf(points: readonly LatLng[]): { sw: LatLng; ne: LatLng } | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { sw: { lat: south, lng: west }, ne: { lat: north, lng: east } };
}

/** How the map frames the points: nothing to show, one place (a box under ~200 m), or the box around them. */
export type Frame = { kind: 'none' } | { kind: 'point'; center: LatLng } | { kind: 'box'; sw: LatLng; ne: LatLng };

export function frameOf(points: readonly LatLng[]): Frame {
  const box = boundsOf(points);
  if (!box) return { kind: 'none' };
  if (box.ne.lat - box.sw.lat < 0.002 && box.ne.lng - box.sw.lng < 0.002) {
    return { kind: 'point', center: { lat: (box.sw.lat + box.ne.lat) / 2, lng: (box.sw.lng + box.ne.lng) / 2 } };
  }
  return { kind: 'box', ...box };
}

/**
 * What the map fits to, as a key: it changes when the stops, the line or the start change (the office's edits reach the
 * phone through Realtime) and once when the first position comes, never with each new position or a stop's status.
 */
export function fitKey(stops: readonly MapStop[], lines: readonly RouteLeg[], start: LatLng | null, hasMe: boolean): string {
  const at = (p: { lat: number; lng: number }) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return [
    stops.map((s) => `${s.id}@${at(s)}`).join(';'),
    lines.map((l) => `${l.key}:${l.points.length}`).join(';'),
    start ? at(start) : '',
    hasMe ? 'me' : '',
  ].join('|');
}

/** The map is turned away from north or tilted (more than a degree): the compass shows. */
export function isTurned(heading: number | null | undefined, pitch: number | null | undefined): boolean {
  const h = ((heading ?? 0) % 360 + 360) % 360;
  return Math.min(h, 360 - h) > 1 || Math.abs(pitch ?? 0) > 1;
}
