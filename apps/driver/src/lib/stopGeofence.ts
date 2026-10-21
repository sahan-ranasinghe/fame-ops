// Round 2 (21 October 2026): the in-app arrival prompt (Uber's "Arrived?" card). Pure, so scripts/test-stop-slides.ts
// runs it. While a task is under way and its screen is open:
//   - arrive: the phone has stayed within 150 m of the current stop (not yet arrived) for 60 s → "Arrived at <stop>?"
//   - leave_previous: the current stop was Arrived but never Left, and the phone has stayed within 150 m of the next stop
//     for 60 s → "Mark <stop> as done?"
// Leaving the 150 m (a sure fix outside) starts the count again and the card goes; nothing is ever marked by itself.
// A fix that is not sure enough (over 75 m, the nudge's own limit) or no fix says nothing: the count is kept, but the
// card shows only while the latest fix is inside. The background nudge notification (lib/arrival.ts) is separate.

import { ARRIVAL_MAX_ACCURACY_M, ARRIVAL_RADIUS_M } from './arrivalRule';
import { distanceKm } from './format';
import type { TaskStop } from './types';

export const GEOFENCE_RADIUS_M = ARRIVAL_RADIUS_M;
export const GEOFENCE_DWELL_MS = 60_000;

export type GeofenceTarget =
  | { kind: 'arrive'; stop: TaskStop }
  | { kind: 'leave_previous'; stop: TaskStop; next: TaskStop };

/** Since when the phone has been inside the target's 150 m (key = kind + stop). */
export interface Dwell {
  key: string | null;
  since: number | null;
}
export const NO_DWELL: Dwell = { key: null, since: null };

/** What the phone could be asked about now, from the task's stops (removed ones are never held). */
export function geofenceTarget(stops: readonly TaskStop[]): GeofenceTarget | null {
  const list = stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
  const i = list.findIndex((s) => s.status === 'pending' || s.status === 'arrived');
  if (i < 0) return null;
  const current = list[i];
  if (current.status === 'pending') return current.lat != null && current.lng != null ? { kind: 'arrive', stop: current } : null;
  const next = list.slice(i + 1).find((s) => s.status === 'pending');
  return next && next.lat != null && next.lng != null ? { kind: 'leave_previous', stop: current, next } : null;
}

const targetKey = (target: GeofenceTarget) => `${target.kind}:${target.stop.id}`;
const fenceStop = (target: GeofenceTarget) => (target.kind === 'arrive' ? target.stop : target.next);

/** Inside the target's 150 m (true), surely outside (false), or not known (no fix, or one not sure enough). */
export function insideFence(target: GeofenceTarget, fix: { lat: number; lng: number; accuracyM?: number | null } | null): boolean | null {
  if (!fix || (fix.accuracyM != null && fix.accuracyM > ARRIVAL_MAX_ACCURACY_M)) return null;
  const stop = fenceStop(target);
  if (stop.lat == null || stop.lng == null) return null;
  return distanceKm(fix, { lat: stop.lat, lng: stop.lng }) * 1000 <= GEOFENCE_RADIUS_M;
}

/**
 * One step: the new count and the card to show (or null). A new target or a sure fix outside starts again; the first fix
 * inside starts the count; the card shows once the count is 60 s old and the latest fix is inside.
 */
export function geofenceStep(
  stops: readonly TaskStop[],
  fix: { lat: number; lng: number; accuracyM?: number | null } | null,
  dwell: Dwell,
  now: number,
): { dwell: Dwell; prompt: GeofenceTarget | null } {
  const target = geofenceTarget(stops);
  if (!target) return { dwell: NO_DWELL, prompt: null };
  const key = targetKey(target);
  const kept: Dwell = dwell.key === key ? dwell : { key, since: null };
  const inside = insideFence(target, fix);
  if (inside === false) return { dwell: { key, since: null }, prompt: null };
  if (inside === null) return { dwell: kept, prompt: null };
  const since = kept.since ?? now;
  return { dwell: { key, since }, prompt: now - since >= GEOFENCE_DWELL_MS ? target : null };
}
