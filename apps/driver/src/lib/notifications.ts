// Notifications on the phone.
//
// Channels (Android plays the channel's sound; the sounds are made by
// scripts/make-sounds.sh and bundled by the expo-notifications plugin):
//   tasks-new       a new task: loud ring, strong vibration (push from the server)
//   tasks-changed   a task changed or cancelled (push)
//   general         a task given to someone else (push)
//   tracking        the location-sharing watchdog (local)
//
// Local notifications made here:
//   - the tracking watchdog: scheduled 12 minutes ahead by the background
//     location task and pushed back each time it runs. It only ever fires
//     when positions have stopped arriving while sharing is on (the phone has
//     killed the app). Tapping it opens the app, which restarts sharing.
//   - a new task seen through Realtime, only on a phone with no push token;
//   - the "test sound" on the Permissions screen;
//   - the shift nudge (Phase 6): "At work? Switch On duty" at the fleet's
//     shift_start on each of shift_days, armed while the driver is off duty
//     and disarmed when On duty is switched on. Tapping it opens Today.

import * as Notifications from 'expo-notifications';

import { getJson, KEYS, remove, setJson } from './kv';

export const CHANNELS = {
  tasksNew: 'tasks-new',
  tasksChanged: 'tasks-changed',
  general: 'general',
  tracking: 'tracking',
} as const;

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

let channelsReady = false;

/** Creates the channels once per app start (Android keeps them; a channel's sound cannot change later). */
export async function ensureChannels(): Promise<void> {
  if (channelsReady) return;
  await Notifications.setNotificationChannelAsync(CHANNELS.tasksNew, {
    name: 'New tasks',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'new_task.wav',
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableLights: true,
    lightColor: '#f2a900',
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.tasksChanged, {
    name: 'Task changes',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'task_changed.wav',
    vibrationPattern: [0, 300, 150, 300],
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.general, {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'general.wav',
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.tracking, {
    name: 'On duty',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
  });
  channelsReady = true;
}

/** Shows a new-task notification from the app itself (used when the phone has no push token). */
export async function notifyNewTask(title: string, body: string, taskId: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId, kind: 'new' } },
      trigger: { channelId: CHANNELS.tasksNew },
    });
  } catch {
    // A missed banner is not worth an error: the task is on the Today screen.
  }
}

/** "Arrived at <stop>? Tap to mark Arrived": the tap opens the task (the task id travels with it). */
export async function notifyArrival(title: string, body: string, taskId: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId, kind: 'arrival' } },
      trigger: { channelId: CHANNELS.tasksChanged },
    });
  } catch {
    // The stop's Arrived button is on the task screen either way.
  }
}

/** Plays the new-task ring once, so the driver can check the volume. */
export async function showTestNotification(title: string, body: string): Promise<void> {
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { kind: 'test' } },
      trigger: { channelId: CHANNELS.tasksNew },
    });
  } catch {
    // Nothing to do: notifications are not allowed.
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
        channelId: CHANNELS.tracking,
      },
    });
    setJson(KEYS.watchdogAt, Date.now() + WATCHDOG_AFTER_MS);
  } catch {
    // Without notifications the in-app check still restarts sharing when the app is opened.
  }
}

/** Shows "sharing stopped, tap to turn it back on" now (the background job found the service dead and could not restart it). */
export async function notifyTrackingStopped(title: string, body: string, kind: 'restart' | 'watchdog'): Promise<void> {
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: WATCHDOG_ID,
      content: { title, body, data: { kind } },
      trigger: { channelId: CHANNELS.tracking },
    });
  } catch {
    // Notifications not allowed: the in-app check restarts sharing when the app is opened.
  }
}

const DUTY_ENDED_ID = 'duty-ended';

/** Phase 7: "You were clocked out" when the app found out by itself (the push did not come or was missed). */
export async function notifyDutyEnded(title: string, body: string): Promise<void> {
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: DUTY_ENDED_ID,
      content: { title, body, data: { kind: 'duty_ended' } },
      trigger: { channelId: CHANNELS.general },
    });
  } catch {
    // Notifications not allowed: Today shows the same words.
  }
}

/** Phase 7: a push about the driver's day arrived while the app runs (vehicle_taken, vehicle_moved, the clock-outs). */
export function onPushReceived(listener: (kind: string | undefined) => void): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as { kind?: unknown } | undefined;
    listener(typeof data?.kind === 'string' ? data.kind : undefined);
  });
  return () => sub.remove();
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

export interface TapData {
  kind?: string;
  taskId?: string;
}

/** What a notification carried, from a response to a tap. */
export function tapData(response: Notifications.NotificationResponse | null | undefined): TapData {
  const data = response?.notification.request.content.data as TapData | undefined;
  return { kind: typeof data?.kind === 'string' ? data.kind : undefined, taskId: typeof data?.taskId === 'string' ? data.taskId : undefined };
}

/** Runs `callback` when the driver taps a notification while the app is running. */
export function onNotificationTap(callback: (data: TapData) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => callback(tapData(response)));
  return () => subscription.remove();
}

/** The shift nudge's time and days (0 = Sunday … 6 = Saturday, as the office stores them). */
export interface ShiftSettings {
  shift_start: string;
  shift_days: number[];
}

const SHIFT_ID = (day: number) => `shift-${day}`;

/**
 * Schedules the nudge: one weekly notification per day, at the shift's start.
 * Cheap to call often: nothing is touched while the settings and texts are the
 * ones already scheduled.
 */
export async function armShiftNudge(settings: ShiftSettings, texts: { title: string; body: string }): Promise<void> {
  const want = JSON.stringify({ ...settings, ...texts });
  if (getJson<string>(KEYS.shiftArmed) === want) return;
  const m = /^(\d{2}):(\d{2})$/.exec(settings.shift_start);
  if (!m) return;
  try {
    if (!(await notificationsAllowed())) return;
    await ensureChannels();
    await disarmShiftNudge();
    for (const day of settings.shift_days) {
      await Notifications.scheduleNotificationAsync({
        identifier: SHIFT_ID(day),
        content: { title: texts.title, body: texts.body, data: { kind: 'shift' } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: day + 1, // Expo counts Sunday as 1
          hour: Number(m[1]),
          minute: Number(m[2]),
          channelId: CHANNELS.general,
        },
      });
    }
    setJson(KEYS.shiftArmed, want);
  } catch {
    // Notifications not allowed, or the trigger refused: the Today screen still shows the On duty switch.
  }
}

/** Cancels the nudge (the driver went on duty, or signed out). */
export async function disarmShiftNudge(): Promise<void> {
  remove(KEYS.shiftArmed);
  try {
    for (let day = 0; day <= 6; day++) await Notifications.cancelScheduledNotificationAsync(SHIFT_ID(day));
  } catch {
    // Nothing was scheduled.
  }
}
