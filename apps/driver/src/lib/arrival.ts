// The arrival notification, run from the background location task (so it works with the screen off).
//   - The record (Part 4b, unchanged): when a position lands within 150 m of the current stop, the time goes on the stop
//     as auto_detected_at (once per stop, through the queue), which the office sees next to the driver's own slide.
//   - The notification (Round 2b, replaces the Part 4b nudge that fired at once): the in-app card's own rule
//     (lib/stopGeofence.ts: 60 s within 150 m), so the driver hears "Arrived at <stop>? Open to confirm" once per stop
//     while the app is in the background (Uber's driver app); the tap opens the task (Today underneath) where the card
//     waits. With the task's own screen in front, the card is enough: no notification (and it can still come later).
// The rules are pure (arrivalDue for scripts/test-nav.ts, backgroundArrival for scripts/test-stop-slides.ts); the rest
// reads and writes the phone's small store.

import { AppState } from 'react-native';

import { translate } from '../i18n';
import { enqueue } from '../sync';
import { arrivalDue } from './arrivalRule';
import { stopNumber } from './dayRules';
import { getJson, KEYS, setJson } from './kv';
import { notifyArrival } from './notifications';
import { type ArrivalWatch, backgroundArrival, NO_WATCH } from './stopGeofence';
import type { Language, TaskWithStops } from './types';

export { ARRIVAL_MAX_ACCURACY_M, ARRIVAL_RADIUS_M, arrivalDue } from './arrivalRule';

const KEEP_NUDGED = 200;

/** The task whose screen is in front (app/task/[id].tsx sets it), so its card is not doubled by a notification. */
let taskOnScreen: string | null = null;
export function setTaskOnScreen(id: string | null): void {
  taskOnScreen = id;
}

type BgFix = { lat: number; lng: number; accuracyM?: number | null; at: number };

/** After a delivery of positions: record the time near the stop, then the 60 s rule's notification. */
export async function checkArrival(fixes: BgFix[]): Promise<boolean> {
  if (fixes.length === 0) return false;
  let tasks = getJson<TaskWithStops[]>(KEYS.tasks) ?? [];
  const newest = [...fixes].sort((a, b) => b.at - a.at)[0];

  // The record (Part 4b), from the newest position, once per stop.
  const nudged = getJson<string[]>(KEYS.arrivalNudged) ?? [];
  const due = arrivalDue(tasks, newest, nudged);
  if (due) {
    const at = new Date(newest.at).toISOString();
    setJson(KEYS.arrivalNudged, [...nudged, due.stop.id].slice(-KEEP_NUDGED));
    enqueue({ kind: 'stop_patch', id: due.stop.id, patch: { auto_detected_at: at } });
    tasks = tasks.map((t) => (t.id === due.task.id
      ? { ...t, task_stops: t.task_stops.map((s) => (s.id === due.stop.id ? { ...s, auto_detected_at: at } : s)) }
      : t));
    setJson(KEYS.tasks, tasks);
  }

  // The notification: 60 s within 150 m, once per stop.
  const watch = getJson<ArrivalWatch>(KEYS.arrivalWatch) ?? NO_WATCH;
  const step = backgroundArrival(tasks, fixes, watch);
  if (!step.notify) {
    setJson(KEYS.arrivalWatch, step.watch);
    return false;
  }
  if (AppState.currentState === 'active' && taskOnScreen === step.notify.task.id) {
    // The card is on screen: keep the count, not "spoken about" (it may still be needed once the app goes behind).
    setJson(KEYS.arrivalWatch, { dwell: step.watch.dwell, notified: watch.notified });
    return false;
  }
  setJson(KEYS.arrivalWatch, step.watch);
  const language = getJson<Language>(KEYS.language) ?? 'en';
  // "Arrived at Stop 2 · Kurunegala site?" (Phase 7, §11: stops are named by their place in the order).
  const { task, stop: fence } = step.notify;
  const stop = translate(language, 'stop.short', { n: stopNumber(task, fence.id), place: fence.place_name });
  await notifyArrival(translate(language, 'arrival.title', { stop }), translate(language, 'arrival.body'), task.id);
  return true;
}
