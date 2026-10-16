// The arrival nudge (Part 4b): during a task, when a position lands within
// 150 m of the current stop (the first one not yet arrived at), the phone shows
// "Arrived at <stop>? Tap to mark Arrived" once for that stop (the tap opens the
// task screen) and records the time on the stop as auto_detected_at, which the
// office sees next to the driver's own tap. Run from the background location
// task, so it works with the screen off. The rule is pure (arrivalDue) for
// scripts/test-nav.ts; the rest reads and writes the phone's small store.

import { translate } from '../i18n';
import { enqueue } from '../sync';
import { arrivalDue } from './arrivalRule';
import { stopNumber } from './dayRules';
import { getJson, KEYS, setJson } from './kv';
import { notifyArrival } from './notifications';
import type { Language, TaskWithStops } from './types';

export { ARRIVAL_MAX_ACCURACY_M, ARRIVAL_RADIUS_M, arrivalDue } from './arrivalRule';

const KEEP_NUDGED = 200;

/** After a delivery of positions: nudge, record the time on the stop (through the queue), remember the stop. */
export async function checkArrival(fix: { lat: number; lng: number; accuracyM?: number | null; at: number }): Promise<boolean> {
  const tasks = getJson<TaskWithStops[]>(KEYS.tasks) ?? [];
  const nudged = getJson<string[]>(KEYS.arrivalNudged) ?? [];
  const due = arrivalDue(tasks, fix, nudged);
  if (!due) return false;
  const at = new Date(fix.at).toISOString();
  setJson(KEYS.arrivalNudged, [...nudged, due.stop.id].slice(-KEEP_NUDGED));
  enqueue({ kind: 'stop_patch', id: due.stop.id, patch: { auto_detected_at: at } });
  setJson(KEYS.tasks, tasks.map((t) => (t.id === due.task.id
    ? { ...t, task_stops: t.task_stops.map((s) => (s.id === due.stop.id ? { ...s, auto_detected_at: at } : s)) }
    : t)));
  const language = getJson<Language>(KEYS.language) ?? 'en';
  // "Arrived at Stop 2 · Kurunegala site?" (Phase 7, §11: stops are named by their place in the order).
  const stop = translate(language, 'stop.short', { n: stopNumber(due.task, due.stop.id), place: due.stop.place_name });
  await notifyArrival(translate(language, 'arrival.title', { stop }), translate(language, 'arrival.body'), due.task.id);
  return true;
}
