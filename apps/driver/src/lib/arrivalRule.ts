// The arrival nudge's rule (Part 4b), pure so scripts/test-nav.ts runs it:
// during a task, the current stop (the first one not yet arrived at) is near
// when a sure enough position lies within 150 m of it, once per stop.

import { distanceKm } from './format';
import type { TaskStop, TaskWithStops } from './types';

export const ARRIVAL_RADIUS_M = 150;
/** A fix less sure than this never triggers the nudge (a Wi-Fi guess can be 100 m off). */
export const ARRIVAL_MAX_ACCURACY_M = 75;

/** The running task's stop the driver is near and has not been nudged about yet, or null. */
export function arrivalDue(
  tasks: TaskWithStops[],
  fix: { lat: number; lng: number; accuracyM?: number | null },
  nudged: string[],
): { task: TaskWithStops; stop: TaskStop } | null {
  if (fix.accuracyM != null && fix.accuracyM > ARRIVAL_MAX_ACCURACY_M) return null;
  const task = tasks.find((t) => t.status === 'in_progress');
  if (!task) return null;
  const stop = [...task.task_stops].sort((a, b) => a.seq - b.seq).find((s) => s.status === 'pending' || s.status === 'arrived');
  if (!stop || stop.status !== 'pending' || stop.lat == null || stop.lng == null || nudged.includes(stop.id)) return null;
  return distanceKm(fix, { lat: stop.lat, lng: stop.lng }) * 1000 <= ARRIVAL_RADIUS_M ? { task, stop } : null;
}
