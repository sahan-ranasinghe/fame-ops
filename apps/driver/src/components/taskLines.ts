// What the driver's screens say about a task's stops and a vehicle swap (Phase 7 Part 2). Pure: no React, so
// scripts/test-rules.ts runs it.
//   - Stops are named by their place in the order (§11): "Stop 2 · Drop"; the start (is_start) is Stop 1.
//   - The time at each stop (§17): "09:00–10:30 at Kurunegala site", from the plan's arrival and leave times.
//   - The vehicle swap during a task (§2, the addition at the Part 2 go): the two readings owed or logged, and
//     each vehicle's km on the task ("40 km in WP CAB-4521").

import { stopNumber, swapReadingsWaiting, taskKmSoFar } from '../lib/dayRules';
import { colomboTime } from '../lib/time';
import type { TaskSegment, TaskStop, TaskWithStops } from '../lib/types';

/** The app's t() (useApp): a key and its {placeholders}. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const TYPE_KEY: Record<string, string> = { pickup: 'stop.pickup', drop: 'stop.drop', visit: 'stop.visit' };

/** "Stop 2 · Drop": the number is the stop's place among the task's stops (removed ones not counted). */
export function stopLabel(t: Translate, task: Pick<TaskWithStops, 'task_stops'>, stop: Pick<TaskStop, 'id' | 'type'>): string {
  const type = t(TYPE_KEY[stop.type] ?? 'stop.visit');
  const n = stopNumber(task, stop.id);
  return n > 0 ? t('stop.label', { n, type }) : type;
}

/** "09:00–10:30 at Kurunegala site" (Colombo time) when the plan has both times, else null. */
export function stopTimeAt(t: Translate, stop: Pick<TaskStop, 'planned_arrive_at' | 'planned_depart_at' | 'place_name'>): string | null {
  if (!stop.planned_arrive_at || !stop.planned_depart_at) return null;
  return t('stop.timeAt', { from: colomboTime(stop.planned_arrive_at), to: colomboTime(stop.planned_depart_at), place: stop.place_name });
}

type Segments = Pick<TaskWithStops, 'task_vehicle_segments'>;

function ordered(task: Segments): TaskSegment[] {
  return [...(task.task_vehicle_segments ?? [])].sort((a, b) => a.seq - b.seq);
}

/** The swap card on the task screen: each reading owed (a button) or logged ("Logged ✓ 10,040 km"). */
export interface SwapCardState {
  /** The vehicle the task is in now. */
  newVehicleId: string;
  /** The vehicle the driver left. */
  oldVehicleId: string;
  /** The old vehicle's end reading; while owed, the start of its stretch (the lowest end allowed). */
  oldEnd: { owed: true; startKm: number | null } | { owed: false; km: number | null };
  /** The new vehicle's start reading. */
  newStart: { owed: true } | { owed: false; km: number | null };
}

/** The swap card's state, or null when there was no swap or both readings are in (the card goes). */
export function swapCard(task: Segments): SwapCardState | null {
  const segments = ordered(task);
  if (segments.length < 2) return null;
  const waiting = swapReadingsWaiting(task);
  if (!waiting.oldEnd && !waiting.newStart) return null;
  const last = segments[segments.length - 1];
  const before = segments[segments.length - 2];
  return {
    newVehicleId: last.vehicle_id,
    oldVehicleId: waiting.oldEnd?.vehicleId ?? before.vehicle_id,
    oldEnd: waiting.oldEnd ? { owed: true, startKm: waiting.oldEnd.startKm } : { owed: false, km: before.end_odometer_km },
    newStart: waiting.newStart ? { owed: true } : { owed: false, km: last.start_odometer_km },
  };
}

/**
 * Each vehicle's km on a task after a swap, in order ("40 km in WP CAB-4521"); empty without a swap. The last stretch
 * ends at the task's end reading (the server copies it there; the phone's own copy may not have it yet). A stretch
 * still missing a reading is left out.
 */
export function stretches(task: Segments & Pick<TaskWithStops, 'end_odometer_km'>): { vehicleId: string; km: number }[] {
  const segments = ordered(task);
  if (segments.length < 2) return [];
  return segments.flatMap((s, i) => {
    const end = s.end_odometer_km ?? (i === segments.length - 1 ? task.end_odometer_km : null);
    return s.start_odometer_km != null && end != null && end >= s.start_odometer_km ? [{ vehicleId: s.vehicle_id, km: end - s.start_odometer_km }] : [];
  });
}

/** A finished task's km: after a swap the stretches added up (as the server's task_km), else the task's km. */
export function shownTaskKm(task: Segments & Pick<TaskWithStops, 'km' | 'start_odometer_km' | 'end_odometer_km'>): number | null {
  if ((task.task_vehicle_segments?.length ?? 0) >= 2 && task.end_odometer_km != null) return taskKmSoFar(task, task.end_odometer_km) ?? task.km;
  return task.km;
}

/** The place a sentence's plate goes ("{plate}: end reading"): the screens draw the plate there in its mono chip. */
export const PLATE_SLOT = '{plate}';

/** A sentence around its plate: t(key) with {plate} left in, split where the plate goes; null when it has none. */
export function splitAtPlate(text: string): { before: string; after: string } | null {
  const at = text.indexOf(PLATE_SLOT);
  if (at < 0) return null;
  return { before: text.slice(0, at), after: text.slice(at + PLATE_SLOT.length) };
}
