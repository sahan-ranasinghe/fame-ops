// Notifications on the phone.
//
// Channels (Android plays the channel's sound; the sounds are made by
// scripts/make-sounds.sh and bundled by the expo-notifications plugin):
//   new-tasks       Hotfix 2 (B): new, changed, reassigned and cancelled tasks, maximum
//                   importance, a long vibration, heads-up, the whole text on the lock
//                   screen (lib/channels.ts). Its name is in the driver's language.
//                   push-task uses it for the phones that registered it (lib/push.ts).
//   driver-asks     Part 3b (H3): the office's questions (free for a trip, a time, where
//                   you are), maximum importance, four short pulses, general.wav; its name
//                   in the driver's language; registered with the token like new-tasks.
//                   A tap opens the question (app/ask/[id].tsx) with Today underneath.
//   task-ring       Part 6 (the 1.3.0 build): "New tasks", a new task rings for 30 s (task_ring.ogg) until the driver
//                   opens the app or the task (stopRinging clears the notification, and its sound with it).
//   task-updates    Part 6: a task changed, cancelled, given to someone else or reopened (task_update.ogg).
//   office-asks     Part 6: the office's questions with their own tone (office_ask.ogg).
//   task-reminders  Part 6: leave in 30 min, leave now, accept or decline, the arrival nudge (new_task.wav).
//                   The four are made only on a 1.3.0 build; there the app no longer makes new-tasks, driver-asks,
//                   tasks-new or tasks-changed, and deletes them once the server has the token with the new ones
//                   (removeReplacedChannels, lib/push.ts). The server's push-task must know the new ones first: the
//                   round deploys push-task before any phone runs 1.3.0.
//   tasks-new       a new task: loud ring, strong vibration (push from the server; phones
//                   on an older update)
//   tasks-changed   a task changed or cancelled (push; phones on an older update)
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
//   - Round 4–7 (§33.2): "Fill up on the way? Log fuel", 30 minutes after a
//     start where the driver said "I'll fill up on the way" (the reminders
//     channel; on a build before 1.3.0 the task changes one). Its tap opens Log
//     fuel for the task; a fill logged (or the task finished) cancels it.

import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';

import { translate } from '../i18n';
import { AppState } from 'react-native';

import {
  asksChannel,
  type ChannelSpec,
  type ChannelsReady,
  hasPart6Sounds,
  isRinging,
  newTasksChannel,
  officeAsksChannel,
  officeIssuesChannel,
  officeRequestsChannel,
  REMINDERS_CHANNEL,
  remindersChannel,
  replacedChannels,
  RING_CHANNEL,
  ringChannel,
  updatesChannel,
} from './channels';
import { getJson, KEYS, remove, setJson } from './kv';
import { getOfficeMe } from '../office/store';
import type { Language } from './types';

export const CHANNELS = {
  /** Hotfix 2 (B): the loud one, for every task push on phones that registered it (1.2.0; removed on 1.3.0). */
  newTasks: 'new-tasks',
  /** Part 3b (H3): the office's questions (1.2.0; removed on 1.3.0, office-asks instead). */
  asks: 'driver-asks',
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

/** With the app open, a new task's ring stops after a few seconds: the driver is already looking at the phone. */
export const RING_IN_APP_MS = 6000;

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    if (isRinging(n.request.content)) setTimeout(() => void stopRinging(), RING_IN_APP_MS);
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

/**
 * Part 6: clears the new-task notifications still on show, which stops a ring still going (Android stops a notification's
 * sound when it is cleared). Called when the app starts or comes to the front, when a notification is opened and a few
 * seconds after a new task arrives with the app open. Only new tasks and the sound test (channels.ts isRinging): the "On
 * duty" notification and the rest stay.
 */
export async function stopRinging(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown.filter((n) => isRinging(n.request.content)).map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Nothing on show, or the notification is gone already.
  }
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') void stopRinging();
});
// Opened from the launcher while it rang: a cold start sends no 'change'.
if (AppState.currentState === 'active') void stopRinging();

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
let newTasksReady = false;
let asksReady = false;
let ringReady = false;
let updatesReady = false;
let officeAsksReady = false;
let remindersReady = false;
let officeRequestsReady = false;
let officeIssuesReady = false;

/** The "New tasks" channel in a language (Android lets an existing channel's name and description change, nothing else). */
async function setNewTasksChannel(language: Language): Promise<boolean> {
  return setChannel(newTasksChannel((key, vars) => translate(language, key, vars)));
}

/** Part 3b: the questions' channel in a language. */
async function setAsksChannel(language: Language): Promise<boolean> {
  return setChannel(asksChannel((key, vars) => translate(language, key, vars)));
}

async function setChannel(spec: ChannelSpec): Promise<boolean> {
  try {
    await Notifications.setNotificationChannelAsync(spec.id, {
      name: spec.name,
      description: spec.description,
      importance: Notifications.AndroidImportance.MAX,
      sound: spec.sound,
      vibrationPattern: spec.vibrationPattern,
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableLights: true,
      lightColor: spec.lightColor,
      showBadge: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Part 6: a channel the app no longer uses (gone already, or never made: nothing to do). */
async function removeChannel(id: string): Promise<void> {
  try {
    await Notifications.deleteNotificationChannelAsync(id);
  } catch {
    // Not there.
  }
}

/** Part 6: the 1.3.0 build's three channels in a language. */
/** Office mode's two channels in a language. */
async function setOfficeChannels(language: Language): Promise<void> {
  const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);
  officeRequestsReady = await setChannel(officeRequestsChannel(t));
  officeIssuesReady = await setChannel(officeIssuesChannel(t));
}

async function setPart6Channels(language: Language): Promise<void> {
  const t = (key: string, vars?: Record<string, string | number>) => translate(language, key, vars);
  ringReady = await setChannel(ringChannel(t));
  updatesReady = await setChannel(updatesChannel(t));
  officeAsksReady = await setChannel(officeAsksChannel(t));
  remindersReady = await setChannel(remindersChannel(t));
}

/**
 * Part 6: deletes the 1.2.0 channels whose pushes all have a 1.3.0 channel the server now knows (lib/push.ts calls it once
 * the token is registered with them), so the phone's settings list each kind once. Never before: a push sent on an old
 * channel id would otherwise land on a deleted channel.
 */
export async function removeReplacedChannels(registered: readonly string[]): Promise<void> {
  for (const id of replacedChannels(registered)) await removeChannel(id);
}

/** The driver changed the language: the app's own channels' names in Android's settings follow. */
export async function renameChannels(language: Language): Promise<void> {
  if (newTasksReady) await setNewTasksChannel(language);
  if (asksReady) await setAsksChannel(language);
  if (ringReady || updatesReady || officeAsksReady || remindersReady) await setPart6Channels(language);
  if (officeRequestsReady || officeIssuesReady) await setOfficeChannels(language);
}

/** Whether the "New tasks" channel exists (the push token is registered with it only then). */
export function newTasksChannelReady(): boolean {
  return newTasksReady;
}

/**
 * Creates the channels once per app start (Android keeps them; a channel's sound cannot change later). Answers which of
 * the app's own channels ("New tasks", the questions) are there, so the push token can be registered with them.
 */
export async function ensureChannels(): Promise<ChannelsReady> {
  const ready = (): ChannelsReady => ({
    newTasks: newTasksReady,
    asks: asksReady,
    ring: ringReady,
    updates: updatesReady,
    officeAsks: officeAsksReady,
    reminders: remindersReady,
    officeRequests: officeRequestsReady,
    officeIssues: officeIssuesReady,
  });
  // Office mode's channels: whenever an office person is signed in (also after a sign-in in a running app), never for a driver.
  if (getOfficeMe() && hasPart6Sounds(Application.nativeApplicationVersion) && !(officeRequestsReady && officeIssuesReady)) {
    await setOfficeChannels(getJson<Language>(KEYS.language) === 'si' ? 'si' : 'en');
  }
  if (channelsReady) return ready();
  const language = getJson<Language>(KEYS.language) === 'si' ? 'si' : 'en';
  if (hasPart6Sounds(Application.nativeApplicationVersion)) await setPart6Channels(language);
  // The 1.3.0 channels replace the 1.2.0 ones for tasks and questions: a 1.3.0 phone no longer makes those, and deletes the
  // ones a 1.2.0 build left once the server has its token with the new channels (removeReplacedChannels, lib/push.ts).
  // An older build makes them as before.
  if (!(ringReady && updatesReady)) newTasksReady = await setNewTasksChannel(language);
  if (!officeAsksReady) asksReady = await setAsksChannel(language);
  if (!(ringReady && remindersReady && officeAsksReady)) await setOldTasksNew();
  if (!(updatesReady && remindersReady)) await setOldTasksChanged();
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
  return ready();
}

/** The 1.2.0 build's channels for tasks, as they were (a build before 1.3.0 still makes them). */
async function setOldTasksNew(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNELS.tasksNew, {
    name: 'New tasks',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'new_task.wav',
    vibrationPattern: [0, 500, 200, 500, 200, 500],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableLights: true,
    lightColor: '#f2a900',
  });
}

async function setOldTasksChanged(): Promise<void> {
  await Notifications.setNotificationChannelAsync(CHANNELS.tasksChanged, {
    name: 'Task changes',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'task_changed.wav',
    vibrationPattern: [0, 300, 150, 300],
  });
}

/** Shows a new-task notification from the app itself (used when the phone has no push token), on the "New tasks" channel. */
export async function notifyNewTask(title: string, body: string, taskId: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    const ready = await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId, kind: 'new' } },
      trigger: { channelId: ready.ring ? RING_CHANNEL : ready.newTasks ? CHANNELS.newTasks : CHANNELS.tasksNew },
    });
  } catch {
    // A missed banner is not worth an error: the task is on the Today screen.
  }
}

/** "Arrived at <stop>? Tap to mark Arrived": the tap opens the task (the task id travels with it). */
export async function notifyArrival(title: string, body: string, taskId: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    const ready = await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { taskId, kind: 'arrival' } },
      trigger: { channelId: ready.reminders ? REMINDERS_CHANNEL : CHANNELS.tasksChanged },
    });
  } catch {
    // The stop's Arrived button is on the task screen either way.
  }
}

/**
 * Plays the new-task ring once, on the channel the new tasks use, so the driver can check the volume (on 1.3.0 the ring,
 * stopped after a few seconds like a new task with the app open).
 */
export async function showTestNotification(title: string, body: string): Promise<void> {
  try {
    const ready = await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { kind: 'test' } },
      trigger: { channelId: ready.ring ? RING_CHANNEL : ready.newTasks ? CHANNELS.newTasks : CHANNELS.tasksNew },
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

const FUEL_REMINDER_ID = 'fuel-reminder';

/**
 * Round 4–7 (§33.2): "Fill up on the way? Log fuel" `afterMs` from now (one at a time: the running task's). The tap's data
 * (kind fuel, the task) opens Log fuel for the task (app/_layout.tsx).
 */
export async function armFuelReminder(taskId: string, texts: { title: string; body: string }, afterMs: number): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    const ready = await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      identifier: FUEL_REMINDER_ID,
      content: { title: texts.title, body: texts.body, data: { kind: 'fuel', taskId } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(60, Math.round(afterMs / 1000)),
        channelId: ready.reminders ? REMINDERS_CHANNEL : CHANNELS.tasksChanged,
      },
    });
  } catch {
    // Notifications not allowed: the task screen's "Fill up on the way · Log fuel" says the same.
  }
}

/** Cancels the fill-up reminder (a fill was logged, or the task finished), and takes it out of the tray. */
export async function disarmFuelReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(FUEL_REMINDER_ID);
    await Notifications.dismissNotificationAsync(FUEL_REMINDER_ID);
  } catch {
    // Nothing was scheduled.
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
  /** Part 3b (H3): a question from the office (push kind ask): the tap opens it. */
  askId?: string;
  /** A "Task changed" push: what changed (Hotfix 2, I: the preview marks it). */
  changes?: unknown;
  /** When the notification came (ms). */
  at?: number;
  /** Phase 8 (O1 item 9): an office notification's link (the site's path), opened in Office mode. */
  url?: string;
  /** Round 4–7 (7): an office notification's event (a holder.* push opens the Asks page for who cannot open the task). */
  event?: string;
}

function dataOf(notification: Notifications.Notification | null | undefined): TapData {
  const data = notification?.request.content.data as Record<string, unknown> | undefined;
  return {
    kind: typeof data?.kind === 'string' ? data.kind : undefined,
    taskId: typeof data?.taskId === 'string' ? data.taskId : undefined,
    askId: typeof data?.askId === 'string' ? data.askId : undefined,
    changes: data?.changes,
    at: typeof notification?.date === 'number' ? notification.date : undefined,
    url: typeof data?.url === 'string' ? data.url : undefined,
    event: typeof data?.event === 'string' ? data.event : undefined,
  };
}

/** What a notification carried, from a response to a tap. */
export function tapData(response: Notifications.NotificationResponse | null | undefined): TapData {
  return dataOf(response?.notification);
}

/** A task push arrived while the app runs (Hotfix 2, I): its data, so a "Task changed" push's changes are kept. */
export function onTaskPushReceived(listener: (data: TapData) => void): () => void {
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = dataOf(notification);
    if (data.taskId) listener(data);
  });
  return () => sub.remove();
}

/** The task pushes still in the tray (the app was closed when they came): their changes are kept the same way. */
export async function presentedTaskPushes(): Promise<TapData[]> {
  try {
    return (await Notifications.getPresentedNotificationsAsync()).map(dataOf).filter((d) => !!d.taskId);
  } catch {
    return [];
  }
}

/** Runs `callback` when the driver taps a notification while the app is running. */
export function onNotificationTap(callback: (data: TapData) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    // Part 6: opening any notification stops a new task's ring still going.
    void stopRinging();
    callback(tapData(response));
  });
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
