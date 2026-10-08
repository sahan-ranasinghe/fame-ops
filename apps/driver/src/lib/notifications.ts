// Local notifications, shown by the app itself:
//   - a new task arrived while the app is running (push from the server comes
//     in a later phase);
//   - the tracking watchdog: a notification scheduled 12 minutes ahead by the
//     background location task and pushed back each time it runs. It only ever
//     fires when positions have stopped arriving while sharing is on, that is,
//     when the phone has killed the app. Tapping it opens the app, which
//     restarts location sharing.

import * as Notifications from 'expo-notifications';

import { getJson, KEYS, remove, setJson } from './kv';

const TASKS_CHANNEL = 'tasks';
const TRACKING_CHANNEL = 'tracking';
const WATCHDOG_ID = 'tracking-watchdog';

/** The watchdog fires this long after the last position, if nothing pushed it back. */
export const WATCHDOG_AFTER_MS = 12 * 60_000;
/** It is pushed back only when it would fire within this long, so the task does not reschedule it on every position. */
const WATCHDOG_REARM_WITHIN_MS = 7 * 60_000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    await ensureChannels();
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function ensureChannels(): Promise<void> {
  await Notifications.setNotificationChannelAsync(TASKS_CHANNEL, {
    name: 'Tasks',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });
  await Notifications.setNotificationChannelAsync(TRACKING_CHANNEL, {
    name: 'Location sharing',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
  });
}

/** Tells the driver about a new task. Does nothing when notifications are not allowed. */
export async function notifyNewTask(title: string, body: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { channelId: TASKS_CHANNEL } });
  } catch {
    // A missed banner is not worth an error: the task is on the Today screen.
  }
}

/**
 * (Re)schedules the watchdog so that it fires WATCHDOG_AFTER_MS from now.
 * Cheap to call often: it only talks to Android when the pending one is close.
 */
export async function armWatchdog(title: string, body: string): Promise<void> {
  const due = getJson<number>(KEYS.watchdogAt) ?? 0;
  if (due - Date.now() > WATCHDOG_REARM_WITHIN_MS) return;
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: WATCHDOG_ID,
      content: { title, body, data: { kind: 'watchdog' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(WATCHDOG_AFTER_MS / 1000),
        channelId: TRACKING_CHANNEL,
      },
    });
    setJson(KEYS.watchdogAt, Date.now() + WATCHDOG_AFTER_MS);
  } catch {
    // Without notifications the in-app check still restarts sharing when the app is opened.
  }
}

/** Cancels the watchdog (sharing was switched off on purpose). */
export async function disarmWatchdog(): Promise<void> {
  remove(KEYS.watchdogAt);
  try {
    await Notifications.cancelScheduledNotificationAsync(WATCHDOG_ID);
    await Notifications.dismissNotificationAsync(WATCHDOG_ID);
  } catch {
    // Nothing was scheduled.
  }
}

/** Runs `callback` when the driver taps a notification (while the app is running). */
export function onNotificationTap(callback: (kind: string | undefined) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { kind?: string } | undefined;
    callback(data?.kind);
  });
  return () => subscription.remove();
}
