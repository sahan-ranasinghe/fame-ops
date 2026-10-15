// A task can't be finished before it has been driven (Phase 7, item 18; docs/phase7-plan.md §18).
// Pure, so scripts/test-rules.ts runs it:
//   - Arrived works within 300 m of the stop's pin with a fix of 100 m or better; farther, the
//     driver may still mark it with "I'm here, the pin is wrong" (flag override, with the
//     distance); with no usable fix for 60 s, the same (flag no_gps); a stop with no pin: no_pin.
//   - Done only after Arrived.
//   - Complete task only once the last stop is Done or Skipped.
//   - At Complete, the odometer against the plan: under 70 % of the planned km, or under half the
//     planned drive time, asks "Check the reading" (the server flags it the same way).

import { distanceKm } from './format';
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
export function earlyFinish(
  task: Pick<TaskWithStops, 'plan_json' | 'start_odometer_km' | 'started_at'>,
  endKm: number,
  now: number,
): EarlyFinish | null {
  const plan = task.plan_json as { total_km?: unknown; total_drive_min?: unknown } | null;
  const plannedKm = typeof plan?.total_km === 'number' ? plan.total_km : null;
  const plannedMinutes = typeof plan?.total_drive_min === 'number' ? plan.total_drive_min : 0;
  if (plannedKm === null || plannedKm < EARLY_MIN_PLANNED_KM || task.start_odometer_km == null || !task.started_at) return null;
  const km = endKm - task.start_odometer_km;
  const minutes = Math.round((now - new Date(task.started_at).getTime()) / 60000);
  const early = km < 0.7 * plannedKm || (plannedMinutes > 0 && minutes < 0.5 * plannedMinutes);
  return early ? { km, plannedKm: Math.round(plannedKm * 10) / 10, minutes, plannedMinutes: Math.round(plannedMinutes) } : null;
}
