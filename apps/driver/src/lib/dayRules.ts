// A task can't be finished before it has been driven (Phase 7, item 18; docs/phase7-plan.md §18).
// Pure, so scripts/test-rules.ts runs it:
//   - Arrived works within 300 m of the stop's pin with a fix of 100 m or better; farther, the
//     driver may still mark it with "I'm here, the pin is wrong" (flag override, with the
//     distance); with no usable fix for 60 s, the same (flag no_gps); a stop with no pin: no_pin.
//   - Done only after Arrived.
//   - Complete task only once the last stop is Done or Skipped.
//   - At Complete, the odometer against the plan up to the last stop: under 70 % of the planned km,
//     or under half the planned drive time, asks "Check the reading" (the server flags it the same way).

import { distanceKm } from './format';
import { colomboDate } from './time';
import type { TaskStop, TaskWithStops } from './types';

export const ARRIVE_WITHIN_M = 300;
export const ARRIVE_MAX_ACCURACY_M = 100;
/** With no usable fix this long, "I'm here" is offered (flag no_gps). */
export const NO_GPS_OVERRIDE_AFTER_MS = 60_000;
/** Plans shorter than this are not checked (an odometer counts whole km); the server uses the same. */
export const EARLY_MIN_PLANNED_KM = 3;

export type ArrivalFlag = 'ok' | 'override' | 'no_gps' | 'no_pin';

export type ArrivalCheck =
  /** Within 300 m: Arrived works (flag ok). */
  | { state: 'ok'; distanceM: number }
  /** Farther: "You are 42 km from …" with the override. */
  | { state: 'far'; distanceM: number }
  /** No fix yet, or not sure enough: "Waiting for GPS…" (the override after 60 s). */
  | { state: 'waiting' }
  /** The stop has no pin: Arrived is allowed (flag no_pin). */
  | { state: 'no_pin' };

export interface Fix {
  lat: number;
  lng: number;
  accuracyM?: number | null;
}

export function arrivalCheck(stop: Pick<TaskStop, 'lat' | 'lng'>, fix: Fix | null): ArrivalCheck {
  if (stop.lat == null || stop.lng == null) return { state: 'no_pin' };
  if (!fix || (fix.accuracyM != null && fix.accuracyM > ARRIVE_MAX_ACCURACY_M)) return { state: 'waiting' };
  const distanceM = Math.round(distanceKm(fix, { lat: stop.lat, lng: stop.lng }) * 1000);
  return distanceM <= ARRIVE_WITHIN_M ? { state: 'ok', distanceM } : { state: 'far', distanceM };
}

/** The flag and distance an Arrived tap records, from the check and whether the driver used the override. */
export function arrivalRecord(check: ArrivalCheck): { flag: ArrivalFlag; distanceM: number | null } {
  switch (check.state) {
    case 'ok':
      return { flag: 'ok', distanceM: check.distanceM };
    case 'far':
      return { flag: 'override', distanceM: check.distanceM };
    case 'waiting':
      return { flag: 'no_gps', distanceM: null };
    case 'no_pin':
      return { flag: 'no_pin', distanceM: null };
  }
}

/** Done appears only once the stop is Arrived. */
export function canMarkDone(stop: Pick<TaskStop, 'status' | 'arrived_at'>): boolean {
  return stop.status === 'arrived' && stop.arrived_at != null;
}

/** The last stop still open (pending or arrived) when it blocks Complete task, else null. */
export function lastStopOpen(task: Pick<TaskWithStops, 'task_stops'>): TaskStop | null {
  const stops = task.task_stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
  const last = stops.at(-1);
  return last && (last.status === 'pending' || last.status === 'arrived') ? last : null;
}

export interface EarlyFinish {
  km: number;
  plannedKm: number;
  minutes: number;
  plannedMinutes: number;
}

/** The odometer against the plan at Complete: the numbers to ask about, or null when it looks right. */
/**
 * The reading the end is checked against: the task's start, or after a vehicle swap (Phase 7) the start of the
 * stretch in the vehicle the driver has now. Null while that start reading is still to be entered.
 */
export function stretchStartKm(task: Pick<TaskWithStops, 'start_odometer_km' | 'task_vehicle_segments'>): number | null {
  const segments = task.task_vehicle_segments ?? [];
  if (segments.length === 0) return task.start_odometer_km;
  return [...segments].sort((a, b) => a.seq - b.seq)[segments.length - 1].start_odometer_km;
}

/**
 * The task's km with this end reading: end − start, or after a swap the earlier stretches added to the one in the
 * vehicle now (the server's task_km does the same). Null when a reading of an earlier stretch is still missing.
 */
export function taskKmSoFar(task: Pick<TaskWithStops, 'start_odometer_km' | 'task_vehicle_segments'>, endKm: number): number | null {
  const segments = [...(task.task_vehicle_segments ?? [])].sort((a, b) => a.seq - b.seq);
  if (segments.length === 0) return task.start_odometer_km == null ? null : endKm - task.start_odometer_km;
  let km = 0;
  for (const [i, s] of segments.entries()) {
    const end = i === segments.length - 1 ? endKm : s.end_odometer_km;
    if (s.start_odometer_km == null || end == null) return null;
    km += end - s.start_odometer_km;
  }
  return km;
}

/** The swap's readings the driver still owes: the old vehicle's end, the new one's start (Phase 7). */
export function swapReadingsWaiting(task: Pick<TaskWithStops, 'task_vehicle_segments'>): {
  oldEnd: { vehicleId: string; startKm: number | null } | null;
  newStart: { vehicleId: string } | null;
} {
  const segments = [...(task.task_vehicle_segments ?? [])].sort((a, b) => a.seq - b.seq);
  const closed = segments.filter((s) => s.to_at !== null && s.end_odometer_km === null);
  const last = segments[segments.length - 1];
  return {
    oldEnd: closed.length > 0 ? { vehicleId: closed[closed.length - 1].vehicle_id, startKm: closed[closed.length - 1].start_odometer_km } : null,
    newStart: last && last.seq > 1 && last.start_odometer_km === null ? { vehicleId: last.vehicle_id } : null,
  };
}

/** A clock-out the server made on an earlier day (the first cut-off run) is silent: no notice, no notification. */
export function dutyEndIsToday(endedAt: string, now: number): boolean {
  return colomboDate(endedAt) === colomboDate(now);
}

export function earlyFinish(
  task: Pick<TaskWithStops, 'plan_json' | 'start_odometer_km' | 'started_at' | 'task_vehicle_segments'>,
  endKm: number,
  now: number,
): EarlyFinish | null {
  // The plan up to the last stop: the driver completes there, before any drive back to base (to_seq -1); the server does the same.
  const legs = (task.plan_json as { legs?: { km?: unknown; minutes?: unknown; to_seq?: unknown }[] } | null)?.legs;
  const toStops = Array.isArray(legs) ? legs.filter((l) => l.to_seq !== -1) : [];
  const kms = toStops.map((l) => l.km).filter((km): km is number => typeof km === 'number');
  const plannedKm = kms.length > 0 ? kms.reduce((a, b) => a + b, 0) : null;
  const plannedMinutes = toStops.reduce((sum, l) => sum + (typeof l.minutes === 'number' ? l.minutes : 0), 0);
  if (plannedKm === null || plannedKm < EARLY_MIN_PLANNED_KM || task.start_odometer_km == null || !task.started_at) return null;
  // After a vehicle swap the km are the stretches added up; a reading still missing means no question.
  const km = taskKmSoFar(task, endKm);
  if (km === null) return null;
  const minutes = Math.round((now - new Date(task.started_at).getTime()) / 60000);
  const early = km < 0.7 * plannedKm || (plannedMinutes > 0 && minutes < 0.5 * plannedMinutes);
  return early ? { km, plannedKm: Math.round(plannedKm * 10) / 10, minutes, plannedMinutes: Math.round(plannedMinutes) } : null;
}
