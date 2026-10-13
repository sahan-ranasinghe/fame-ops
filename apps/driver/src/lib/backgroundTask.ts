// The tracking check that runs without the app: a WorkManager job
// (expo-background-task) Android runs about every 15 minutes while the app
// is installed and not force-stopped, even when the app itself has been
// killed. It is imported from the entry file (index.ts) so that it is
// defined before Android runs it headless.
//
// What it does when "Sharing my location" is on but no position has arrived
// for 3 minutes (the service is dead):
//   - Android 11 and older: starts the location service again, silently.
//   - Android 12 and newer: a background job may not start a location
//     service (ForegroundServiceStartNotAllowedException), so it shows the
//     notification "Location sharing stopped. Tap to turn it back on".
//     Tapping it opens the app, which restarts sharing (lib/location.ts).
//
// Limits: Android decides when the job runs (15 minutes is the minimum, Doze
// and OPPO's battery rules can stretch it to an hour or more), and a
// force-stopped app runs no jobs at all until it is opened again.

import * as BackgroundTask from 'expo-background-task';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { translate } from '../i18n';
import { flushNow } from '../sync';
import { sendHeartbeat } from './heartbeat';
import { getJson, KEYS, setJson } from './kv';
import { DEAD_AFTER_MS, getSharing, LOCATION_TASK, serviceTextsFor, startLocationUpdates } from './location';
import { notifyTrackingStopped } from './notifications';
import type { Language } from './types';

export const TRACKING_CHECK_TASK = 'fame-driver-tracking-check';
const EVERY_MINUTES = 15;

TaskManager.defineTask(TRACKING_CHECK_TASK, async () => {
  try {
    const sharing = getSharing();
    if (!sharing) return BackgroundTask.BackgroundTaskResult.Success;

    // Whenever Android lets the job run: tell the office how the phone is, and send any backlog.
    await sendHeartbeat().catch(() => undefined);
    await flushNow().catch(() => undefined);

    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
    const lastFix = getJson<number>(KEYS.lastFix) ?? Date.parse(sharing.startedAt);
    if (running && Date.now() - lastFix <= DEAD_AFTER_MS) return BackgroundTask.BackgroundTaskResult.Success;

    const language = getJson<Language>(KEYS.language) ?? 'en';
    try {
      if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      await startLocationUpdates(serviceTextsFor(language));
      setJson(KEYS.lastFix, Date.now());
    } catch {
      // Android 12+: a job cannot start the service. Ask the driver to tap.
      await notifyTrackingStopped(translate(language, 'tracking.stoppedTitle'), translate(language, 'tracking.stoppedBody'), 'restart');
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers the job (after sign-in). Does nothing where background tasks are not available. */
export async function registerTrackingCheck(): Promise<void> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TRACKING_CHECK_TASK)) return;
    await BackgroundTask.registerTaskAsync(TRACKING_CHECK_TASK, { minimumInterval: EVERY_MINUTES });
  } catch {
    // Not available on this phone: the in-app check and the watchdog still work.
  }
}

/** Removes the job (sign-out). */
export async function unregisterTrackingCheck(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(TRACKING_CHECK_TASK)) await BackgroundTask.unregisterTaskAsync(TRACKING_CHECK_TASK);
  } catch {
    // Nothing registered.
  }
}
