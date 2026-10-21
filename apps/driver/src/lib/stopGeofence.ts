// Round 2 (21 October 2026): the in-app arrival prompt (Uber's "Arrived?" card). Pure, so scripts/test-stop-slides.ts
// runs it. While a task is under way and its screen is open:
//   - arrive: the phone has stayed within 150 m of the current stop (not yet arrived) for 60 s → "Arrived at <stop>?"
//   - leave_previous: the current stop was Arrived but never Left, and the phone has stayed within 150 m of the next stop
//     for 60 s → "Mark <stop> as done?"
// Leaving the 150 m (a sure fix outside) starts the count again and the card goes; nothing is ever marked by itself.
// A fix that is not sure enough (over 75 m, the nudge's own limit) or no fix says nothing: the count is kept, but the
// card shows only while the latest fix is inside.
// Round 2b: a stop driven past (the current stop never Arrived, the phone 60 s at the next stop) → "Did you stop at
// <stop>?" (Yes, I was there / Skip it); and the same rule from the background location task (backgroundArrival): one
// notification per stop, "Arrived at <stop>? Open to confirm" (lib/arrival.ts).

import { ARRIVAL_MAX_ACCURACY_M, ARRIVAL_RADIUS_M } from './arrivalRule';
import { distanceKm } from './format';
import type { TaskStop } from './types';

export const GEOFENCE_RADIUS_M = ARRIVAL_RADIUS_M;
export const GEOFENCE_DWELL_MS = 60_000;

export type GeofenceTarget =
  | { kind: 'arrive'; stop: TaskStop }
  | { kind: 'leave_previous'; stop: TaskStop; next: TaskStop }
  /** Round 2b: the current stop was driven past (never Arrived) and the phone is at the next one: "Did you stop at …?" */
  | { kind: 'passed'; stop: TaskStop; next: TaskStop };

/** Since when the phone has been inside the target's 150 m (key = kind + stop). */
export interface Dwell {
  key: string | null;
  since: number | null;
}
export const NO_DWELL: Dwell = { key: null, since: null };

type GeoFix = { lat: number; lng: number; accuracyM?: number | null };
const hasPin = (s: TaskStop) => s.lat != null && s.lng != null;

/**
 * Everything the phone could be asked about now, from the task's stops (removed ones are never held), in order: the
 * current stop not yet arrived ("Arrived at …?", when it has a pin), then the same stop driven past when the phone is at
 * the next stop still to do ("Did you stop at …?"); or the current stop Arrived but never Left ("Mark … as done?").
 */
export function geofenceTargets(stops: readonly TaskStop[]): GeofenceTarget[] {
  const list = stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
  const i = list.findIndex((s) => s.status === 'pending' || s.status === 'arrived');
  if (i < 0) return [];
  const current = list[i];
  const next = list.slice(i + 1).find((s) => s.status === 'pending');
  const nextHere = next && hasPin(next) ? next : null;
  if (current.status === 'pending') {
    const out: GeofenceTarget[] = [];
    if (hasPin(current)) out.push({ kind: 'arrive', stop: current });
    if (nextHere) out.push({ kind: 'passed', stop: current, next: nextHere });
    return out;
  }
  return nextHere ? [{ kind: 'leave_previous', stop: current, next: nextHere }] : [];
}

/** The first thing the phone could be asked about (the current stop's own question), or null. */
export function geofenceTarget(stops: readonly TaskStop[]): GeofenceTarget | null {
  return geofenceTargets(stops)[0] ?? null;
}

const targetKey = (target: GeofenceTarget) => `${target.kind}:${target.stop.id}`;
/** The stop whose 150 m the question waits for (the current one for "Arrived?", else the next one). */
export const fenceStop = (target: GeofenceTarget): TaskStop => (target.kind === 'arrive' ? target.stop : target.next);

/** Inside the target's 150 m (true), surely outside (false), or not known (no fix, or one not sure enough). */
export function insideFence(target: GeofenceTarget, fix: GeoFix | null): boolean | null {
  if (!fix || (fix.accuracyM != null && fix.accuracyM > ARRIVAL_MAX_ACCURACY_M)) return null;
  const stop = fenceStop(target);
  if (stop.lat == null || stop.lng == null) return null;
  return distanceKm(fix, { lat: stop.lat, lng: stop.lng }) * 1000 <= GEOFENCE_RADIUS_M;
}

/**
 * One step: the new count and the card to show (or null). The question is the first one whose 150 m the phone is in; a new
 * question or sure fixes outside every fence start again; the first fix inside starts the count; the card shows once the
 * count is 60 s old and the latest fix is inside.
 */
export function geofenceStep(
  stops: readonly TaskStop[],
  fix: GeoFix | null,
  dwell: Dwell,
  now: number,
): { dwell: Dwell; prompt: GeofenceTarget | null } {
  const targets = geofenceTargets(stops);
  if (targets.length === 0) return { dwell: NO_DWELL, prompt: null };
  const keys = targets.map(targetKey);
  const inside = targets.map((target) => insideFence(target, fix));
  const at = inside.findIndex((x) => x === true);
  if (at < 0) {
    if (inside.every((x) => x === false)) return { dwell: { key: keys[0], since: null }, prompt: null };
    // Not known: the count is kept (for a question still asked), nothing shows.
    return { dwell: dwell.key !== null && keys.includes(dwell.key) ? dwell : { key: keys[0], since: null }, prompt: null };
  }
  const key = keys[at];
  const since = (dwell.key === key ? dwell.since : null) ?? now;
  return { dwell: { key, since }, prompt: now - since >= GEOFENCE_DWELL_MS ? targets[at] : null };
}

/** What the background location task keeps between deliveries: its own count and the stops it already spoke about. */
export interface ArrivalWatch {
  dwell: Dwell;
  notified: string[];
}
export const NO_WATCH: ArrivalWatch = { dwell: NO_DWELL, notified: [] };
const KEEP_NOTIFIED = 200;

/**
 * Round 2b: the same rule from the background location task (the screen off, or another app in front): the fixes of one
 * delivery in time order through geofenceStep; when a question comes up, ONE notification for the stop it waits at
 * ("Arrived at <stop>? Open to confirm"), never again for that stop. Only a task under way.
 */
export function backgroundArrival<T extends { status: string; task_stops: TaskStop[] }>(
  tasks: readonly T[],
  fixes: readonly (GeoFix & { at: number })[],
  watch: ArrivalWatch,
): { watch: ArrivalWatch; notify: { task: T; target: GeofenceTarget; stop: TaskStop } | null } {
  const task = tasks.find((t) => t.status === 'in_progress');
  if (!task) return { watch: { ...watch, dwell: NO_DWELL }, notify: null };
  let dwell = watch.dwell;
  let found: GeofenceTarget | null = null;
  for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
    const step = geofenceStep(task.task_stops, fix, dwell, fix.at);
    dwell = step.dwell;
    found = step.prompt;
  }
  if (!found || watch.notified.includes(fenceStop(found).id)) return { watch: { ...watch, dwell }, notify: null };
  const stop = fenceStop(found);
  return { watch: { dwell, notified: [...watch.notified, stop.id].slice(-KEEP_NOTIFIED) }, notify: { task, target: found, stop } };
}
