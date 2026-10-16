// The plan on the map (Phase 7, §20), pure: the pins and Google's road line
// from a plan answer (plan_task or task_detail with with_line).
// - Pins: the start as "S" (unless passengers get in there: then it is Stop 1),
//   then every stop by its number, labelled "2 · Kurunegala site · 09:00–10:30"
//   (arrive and leave); a missed arrive-by is red.
// - Lines: each leg's Google polyline, decoded, only for Google's map.
// - Rule 10: a Google pin (a stop with google: true, a Google start) and
//   Google's lines go into the plan only when Google's map is the one in use;
//   otherwise they are listed under the map ("Google place, not drawn: …").
import { decodePolyline } from "@fleet/polyline";
import type { PlanTimeline, TimelineItem } from "../data/types";
import type { MapPlan, PlanPin } from "../map/types";
import { toMin } from "./departureLogic";

type LatLng = { lat: number; lng: number };

/** A stop as plan_task and task_detail answer it, with what the map needs (lat, lng, google: not in data/types' PlannedStop yet). */
export interface PlanMapStop {
  n?: number;
  place?: string;
  lat?: number;
  lng?: number;
  google?: boolean;
  is_start?: boolean;
  planned_arrive?: string;
  planned_leave?: string;
  planned_depart?: string;
  arrive_by?: string;
}

/** The start: plan_task's `start` (lat, lng, google: not in data/types' PlanPreview yet), or task_detail's start fields. */
export interface PlanMapStart {
  name?: string;
  lat?: number;
  lng?: number;
  /** A Google place: its pin is Google's. */
  google?: boolean;
}

/** A leg with Google's road line (with_line: true). */
export type LegWithLine = Extract<TimelineItem, { kind: "leg" }>;

export const START_PIN = "start";
export const stopPin = (n: number) => `stop-${n}`;

export interface PlanMapView {
  plan: MapPlan;
  /** Google places left off a map that is not Google's (rule 10): "2 · Kurunegala site". */
  googleNotDrawn: string[];
  /** Pins with no coordinates: "3 · Kurunegala town". */
  noPin: string[];
}

const has = (p: { lat?: number | null; lng?: number | null } | null | undefined): p is LatLng =>
  !!p && typeof p.lat === "number" && typeof p.lng === "number" && isFinite(p.lat) && isFinite(p.lng);

/** Is an arrival after its deadline (HH:MM; the timeline's late_min when it has one). */
export function missed(arrive?: string, by?: string, lateMin?: number): boolean {
  if (lateMin != null) return lateMin > 0;
  const a = toMin(arrive), b = toMin(by);
  return a !== null && b !== null && a > b;
}

/**
 * The plan for the map from a plan answer. `google`: Google's map is the one in use (then its pins and lines are drawn).
 * `offset`: stops before the plan's first (already reached), so the numbers follow the task's. Null when there is
 * nothing to place (no plan and no stops).
 */
export function planMapOf({ timeline, stops = [], start, google, offset = 0, selected = null }: {
  timeline?: PlanTimeline | null;
  stops?: PlanMapStop[];
  start?: PlanMapStart | null;
  google: boolean;
  offset?: number;
  selected?: string | null;
}): PlanMapView | null {
  const items = timeline?.items ?? [];
  const planStops = items.filter((x): x is Extract<TimelineItem, { kind: "stop" }> => x.kind === "stop");
  if (!planStops.length && !stops.length) return null;
  const byN = (n: number, i: number) => stops.find((s) => s.n === n) ?? (stops.every((s) => s.n == null) ? stops[i] : undefined);
  const pins: PlanPin[] = [];
  const googleNotDrawn: string[] = [];
  const noPin: string[] = [];
  const add = (pin: Omit<PlanPin, "lat" | "lng">, where: Partial<LatLng> | null | undefined, isGoogle: boolean, name: string) => {
    if (isGoogle && !google) {
      googleNotDrawn.push(name);
      return;
    }
    if (!has(where)) {
      noPin.push(name);
      return;
    }
    pins.push({ ...pin, lat: where.lat, lng: where.lng, ...(isGoogle ? { google: true } : {}) });
  };

  // The start, unless passengers get in there (then the start is Stop 1).
  const startIsStop = planStops.some((x) => x.is_start) || stops.some((s) => s.is_start);
  const leave = items.find((x) => x.kind === "leave");
  if (start && !startIsStop) {
    const name = start.name ? `S · ${start.name}` : "S · the start";
    const label = leave && leave.kind === "leave" ? `${name} · leave ${leave.at}` : name;
    add({ id: START_PIN, n: "S", label }, start, !!start.google, name);
  }

  const list = planStops.length
    ? planStops.map((x, i) => ({ n: x.n, place: x.place, arrive: x.planned_arrive, leave: x.planned_leave, late: missed(x.planned_arrive, x.arrive_by, x.late_min), stop: byN(x.n, i) }))
    : stops.map((s, i) => {
      const n = s.n ?? i + 1;
      return { n, place: s.place ?? "", arrive: s.planned_arrive, leave: s.planned_leave ?? s.planned_depart, late: missed(s.planned_arrive, s.arrive_by), stop: s };
    });
  for (const s of list) {
    const shown = s.n + offset;
    const name = `${shown} · ${s.place || "the stop"}`;
    const times = s.arrive && s.leave && s.arrive !== s.leave ? `${s.arrive}–${s.leave}` : s.arrive ?? s.leave;
    add({ id: stopPin(s.n), n: shown, label: times ? `${name} · ${times}` : name, ...(s.late ? { late: true } : {}) }, s.stop, !!s.stop?.google, name);
  }

  const plan: MapPlan = { pins, selected };
  if (google) {
    const lines = items
      .filter((x): x is LegWithLine => x.kind === "leg")
      .map((l) => (l.line ? decodePolyline(l.line) : []))
      .filter((l) => l.length > 1);
    if (lines.length) plan.lines = lines;
  }
  return { plan, googleNotDrawn, noPin };
}
