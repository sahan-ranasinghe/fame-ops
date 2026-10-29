// The "New tasks" notification channel (Hotfix 2, B). Pure: no expo-notifications here, so scripts/test-preview.ts
// checks it (lib/notifications.ts turns it into Android's channel).
//
// Android fixes a channel's sound, vibration and importance when the channel is first made, so the louder settings
// need a new channel id: `new-tasks`. The office's push-task sends new, changed, reassigned and cancelled task pushes on
// it to the phones that registered their token with it (register_device_token p_channels); older phones keep the old
// channels. A channel can only play a sound that is in the installed build (the expo-notifications plugin bundles
// assets/sounds/*.wav listed in app.json): new_task.wav is in the 1.2.0 build.
//
// Part 3b (H3): `driver-asks`, the office's questions (maximum importance, four short pulses, general.wav from the 1.2.0
// build until Part 6's native build brings a sound of its own). push-task sends an ask on it to a phone that registered it,
// else on tasks-new.

/** The app's t() (useApp): a key and its {placeholders}. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const NEW_TASKS_CHANNEL = 'new-tasks';
/** In the 1.2.0 build (app.json, the expo-notifications plugin's sounds). */
export const NEW_TASKS_SOUND = 'new_task.wav';
/** A long vibration: three long pulses (ms: wait, buzz, pause, buzz, pause, buzz). */
export const NEW_TASKS_VIBRATION = [0, 800, 400, 800, 400, 800];

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  /** max = heads-up (a banner over whatever is on screen), sound and vibration. */
  importance: 'max';
  sound: string;
  vibrationPattern: number[];
  /** public = the whole notification on the lock screen. */
  lockscreen: 'public';
  lightColor: string;
}

/** The channel in the driver's language (the name and description show in Android's settings). */
export function newTasksChannel(t: Translate): ChannelSpec {
  return {
    id: NEW_TASKS_CHANNEL,
    name: t('channel.newTasks'),
    description: t('channel.newTasksDesc'),
    importance: 'max',
    sound: NEW_TASKS_SOUND,
    vibrationPattern: NEW_TASKS_VIBRATION,
    lockscreen: 'public',
    lightColor: '#f2a900',
  };
}

export const ASKS_CHANNEL = 'driver-asks';
/** In the 1.2.0 build (app.json, the expo-notifications plugin's sounds). */
export const ASKS_SOUND = 'general.wav';
/** Its own vibration: four short pulses (ms: wait, buzz, pause, buzz, …), unlike the three long ones of a new task. */
export const ASKS_VIBRATION = [0, 250, 150, 250, 150, 250, 150, 250];

/** The questions' channel in the driver's language. */
export function asksChannel(t: Translate): ChannelSpec {
  return {
    id: ASKS_CHANNEL,
    name: t('channel.asks'),
    description: t('channel.asksDesc'),
    importance: 'max',
    sound: ASKS_SOUND,
    vibrationPattern: ASKS_VIBRATION,
    lockscreen: 'public',
    lightColor: '#1e4fa0',
  };
}

// The 1.3.0 build (Phase 7, Part 6) bundles three sounds of its own (scripts/make-sounds.sh, OGG), so three new channel ids
// (a channel's sound is fixed when it is first made):
//   task-ring     a new task: the 30-second ringtone, like a ride-hailing app; the app clears the notification, and the
//                 ring with it, when the driver opens the app or the task (lib/notifications.ts stopRinging)
//   task-updates  a task changed, cancelled or given to someone else: a short falling tone of its own
//   office-asks   a question from the office: a rising question-like tone
// push-task sends each kind on its channel to the phones that registered it, else on the channels before. They replace
// new-tasks and driver-asks, which the app then removes (lib/notifications.ts ensureChannels).

export const RING_CHANNEL = 'task-ring';
export const RING_SOUND = 'task_ring.ogg';
/** Five long pulses (the ring itself goes on for 30 s). */
export const RING_VIBRATION = [0, 800, 400, 800, 400, 800, 400, 800, 400, 800];
export const UPDATES_CHANNEL = 'task-updates';
export const UPDATES_SOUND = 'task_update.ogg';
export const UPDATES_VIBRATION = [0, 200, 100, 200, 100, 200];
export const OFFICE_ASKS_CHANNEL = 'office-asks';
export const OFFICE_ASKS_SOUND = 'office_ask.ogg';
/**
 * Part 6, after the checkpoint: the reminders (leave in 30 min, leave now, accept or decline, the arrival nudge) on a 1.3.0
 * channel of their own, so the phone needs none of the 1.2.0 channels for tasks: with new_task.wav (in every build, kept
 * through resource shrinking since 1.3.0).
 */
export const REMINDERS_CHANNEL = 'task-reminders';
export const REMINDERS_SOUND = 'new_task.wav';
export const REMINDERS_VIBRATION = [0, 500, 200, 500, 200, 500];
// Office mode's own channels (Sahan, 21 October 2026: office pushes ring like the driver's, under the office's names): made
// only on a phone with an office person signed in, each with the closest of the sounds already in the 1.3.0 build (a channel's
// sound is fixed when it is made; 1.4.0 brings two sounds of their own under new ids, docs/release-1.4.0.md). notify-office
// sends a push on one only when the phone registered it, else on the channels before.
//   office-requests  "Requests and approvals": a request to approve, a task that needs a driver, a booking or a request
//                    changed, a trip on its way: office_ask.ogg (the rising question tone: something to decide)
//   office-issues    "Issues": a critical issue, an issue given to you: new_task.wav (the loudest short tone)
export const OFFICE_REQUESTS_CHANNEL = 'office-requests';
export const OFFICE_REQUESTS_SOUND = 'office_ask.ogg';
export const OFFICE_REQUESTS_VIBRATION = [0, 400, 200, 400];
export const OFFICE_ISSUES_CHANNEL = 'office-issues';
export const OFFICE_ISSUES_SOUND = 'new_task.wav';
export const OFFICE_ISSUES_VIBRATION = [0, 600, 250, 600, 250, 600];

// Release 1.4.0 (docs/release-1.4.0.md item 5): the office's own two sounds, under new ids (a channel's sound is fixed when it
// is made). A 1.4.0 build makes these instead of the two above and deletes the old two once the server has its token with
// the new ones (replacedChannels); notify-office prefers them.
//   office-requests-2  "Requests and approvals": request_waiting.ogg (a bright rising C–E–G twice: decide this)
//   office-issues-2    "Issues": issue_critical.ogg (quick alternating high–low pulses twice: an alarm)
export const OFFICE_REQUESTS_2_CHANNEL = 'office-requests-2';
export const OFFICE_REQUESTS_2_SOUND = 'request_waiting.ogg';
export const OFFICE_ISSUES_2_CHANNEL = 'office-issues-2';
export const OFFICE_ISSUES_2_SOUND = 'issue_critical.ogg';

/** "Requests and approvals"; `own` (a 1.4.0 build) = the office's own sound under the new id. */
export function officeRequestsChannel(t: Translate, own = false): ChannelSpec {
  return {
    id: own ? OFFICE_REQUESTS_2_CHANNEL : OFFICE_REQUESTS_CHANNEL,
    name: t('channel.officeRequests'),
    description: t('channel.officeRequestsDesc'),
    importance: 'max',
    sound: own ? OFFICE_REQUESTS_2_SOUND : OFFICE_REQUESTS_SOUND,
    vibrationPattern: OFFICE_REQUESTS_VIBRATION,
    lockscreen: 'public',
    lightColor: '#f2a900',
  };
}

/** "Issues"; `own` (a 1.4.0 build) = the office's own sound under the new id. */
export function officeIssuesChannel(t: Translate, own = false): ChannelSpec {
  return {
    id: own ? OFFICE_ISSUES_2_CHANNEL : OFFICE_ISSUES_CHANNEL,
    name: t('channel.officeIssues'),
    description: t('channel.officeIssuesDesc'),
    importance: 'max',
    sound: own ? OFFICE_ISSUES_2_SOUND : OFFICE_ISSUES_SOUND,
    vibrationPattern: OFFICE_ISSUES_VIBRATION,
    lockscreen: 'public',
    lightColor: '#b3261e',
  };
}

/** The 1.2.0 build's own channels for tasks (made by lib/notifications.ts before 1.3.0, named "New tasks" and "Task changes"). */
export const OLD_TASKS_NEW_CHANNEL = 'tasks-new';
export const OLD_TASKS_CHANGED_CHANNEL = 'tasks-changed';

/** The 1.3.0 channels in the driver's language. */
export function ringChannel(t: Translate): ChannelSpec {
  return {
    id: RING_CHANNEL,
    name: t('channel.ring'),
    description: t('channel.ringDesc'),
    importance: 'max',
    sound: RING_SOUND,
    vibrationPattern: RING_VIBRATION,
    lockscreen: 'public',
    lightColor: '#f2a900',
  };
}

export function updatesChannel(t: Translate): ChannelSpec {
  return {
    id: UPDATES_CHANNEL,
    name: t('channel.updates'),
    description: t('channel.updatesDesc'),
    importance: 'max',
    sound: UPDATES_SOUND,
    vibrationPattern: UPDATES_VIBRATION,
    lockscreen: 'public',
    lightColor: '#f2a900',
  };
}

export function officeAsksChannel(t: Translate): ChannelSpec {
  return { ...asksChannel(t), id: OFFICE_ASKS_CHANNEL, sound: OFFICE_ASKS_SOUND };
}

export function remindersChannel(t: Translate): ChannelSpec {
  return {
    id: REMINDERS_CHANNEL,
    name: t('channel.reminders'),
    description: t('channel.remindersDesc'),
    importance: 'max',
    sound: REMINDERS_SOUND,
    vibrationPattern: REMINDERS_VIBRATION,
    lockscreen: 'public',
    lightColor: '#f2a900',
  };
}

/** Which of the app's own channels exist on this phone (lib/notifications.ts ensureChannels). */
export interface ChannelsReady {
  newTasks: boolean;
  asks: boolean;
  /** Part 6 (the 1.3.0 build). */
  ring?: boolean;
  updates?: boolean;
  officeAsks?: boolean;
  reminders?: boolean;
  /** Office mode (21 October 2026): only on a phone with an office person signed in. */
  officeRequests?: boolean;
  officeIssues?: boolean;
  /** Release 1.4.0: the office's own sounds (office-requests-2, office-issues-2). */
  officeRequests2?: boolean;
  officeIssues2?: boolean;
}

/**
 * The channels this phone tells the server it has (register_device_token p_channels): each once it is made. A plain
 * boolean is the "New tasks" channel alone (as before Part 3b).
 */
export function channelsToRegister(ready: boolean | ChannelsReady): string[] {
  const r: ChannelsReady = typeof ready === 'boolean' ? { newTasks: ready, asks: false } : ready;
  return [
    ...(r.newTasks ? [NEW_TASKS_CHANNEL] : []),
    ...(r.asks ? [ASKS_CHANNEL] : []),
    ...(r.ring ? [RING_CHANNEL] : []),
    ...(r.updates ? [UPDATES_CHANNEL] : []),
    ...(r.officeAsks ? [OFFICE_ASKS_CHANNEL] : []),
    ...(r.reminders ? [REMINDERS_CHANNEL] : []),
    ...(r.officeRequests ? [OFFICE_REQUESTS_CHANNEL] : []),
    ...(r.officeIssues ? [OFFICE_ISSUES_CHANNEL] : []),
    ...(r.officeRequests2 ? [OFFICE_REQUESTS_2_CHANNEL] : []),
    ...(r.officeIssues2 ? [OFFICE_ISSUES_2_CHANNEL] : []),
  ];
}

/**
 * Part 6: the 1.2.0 channels a phone deletes once the server has taken its token with these channels (lib/push.ts): each
 * only when every push it carried has a registered replacement, so push-task never sends to a deleted channel
 * (scripts/test-preview.ts checks this against push-task's channelFor for every kind).
 *   new-tasks      new, changed, cancelled, removed       → task-ring, task-updates
 *   driver-asks    a question                             → office-asks
 *   tasks-new      new, leave now, accept, a question     → task-ring, task-reminders, office-asks
 *   tasks-changed  changed, cancelled, leave in 30, reopened → task-updates, task-reminders
 * Release 1.4.0, the same rule for the office's two 1.3.0 channels:
 *   office-requests  → office-requests-2
 *   office-issues    → office-issues-2
 */
export function replacedChannels(registered: readonly string[]): string[] {
  const has = (c: string) => registered.includes(c);
  return [
    ...(has(RING_CHANNEL) && has(UPDATES_CHANNEL) ? [NEW_TASKS_CHANNEL] : []),
    ...(has(OFFICE_ASKS_CHANNEL) ? [ASKS_CHANNEL] : []),
    ...(has(RING_CHANNEL) && has(REMINDERS_CHANNEL) && has(OFFICE_ASKS_CHANNEL) ? [OLD_TASKS_NEW_CHANNEL] : []),
    ...(has(UPDATES_CHANNEL) && has(REMINDERS_CHANNEL) ? [OLD_TASKS_CHANGED_CHANNEL] : []),
    ...(has(OFFICE_REQUESTS_2_CHANNEL) ? [OFFICE_REQUESTS_CHANNEL] : []),
    ...(has(OFFICE_ISSUES_2_CHANNEL) ? [OFFICE_ISSUES_CHANNEL] : []),
  ];
}

/** Release 1.4.0: whether the installed build carries the office's two sounds (1.4.0 or later). */
export function hasOfficeSounds(nativeVersion: string | null | undefined): boolean {
  const [major, minor] = (nativeVersion ?? '').split('.').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 1 || (major === 1 && minor >= 4);
}

/**
 * Part 6: whether the installed build carries the three sounds (1.3.0 or later). This code also runs in an older build
 * (a development build on live reload): there the channels would be made with the phone's default sound, for good.
 */
export function hasPart6Sounds(nativeVersion: string | null | undefined): boolean {
  const [major, minor] = (nativeVersion ?? '').split('.').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 1 || (major === 1 && minor >= 3);
}

/** The start of push-task's title of a new task ("New task Sat 09:30"), in both languages. */
export const NEW_TASK_TITLES = ['New task', 'නව කාර්යය'];

/**
 * Part 6: a notification whose ring the app stops (lib/notifications.ts stopRinging): a new task or the sound test. A push
 * that Android showed by itself while the app was in the background keeps no data, only its title and text, so a new
 * task's push is also known by its title.
 */
export function isRinging(content: { title?: string | null; data?: unknown }): boolean {
  const kind = (content.data as { kind?: unknown } | null | undefined)?.kind;
  if (kind === 'new' || kind === 'test') return true;
  const title = content.title ?? '';
  return NEW_TASK_TITLES.some((start) => title.startsWith(start));
}
