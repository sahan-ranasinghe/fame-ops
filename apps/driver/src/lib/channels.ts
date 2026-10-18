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

/** Which of the app's own channels exist on this phone (lib/notifications.ts ensureChannels). */
export interface ChannelsReady {
  newTasks: boolean;
  asks: boolean;
}

/**
 * The channels this phone tells the server it has (register_device_token p_channels): each once it is made. A plain
 * boolean is the "New tasks" channel alone (as before Part 3b).
 */
export function channelsToRegister(ready: boolean | ChannelsReady): string[] {
  const r = typeof ready === 'boolean' ? { newTasks: ready, asks: false } : ready;
  return [...(r.newTasks ? [NEW_TASKS_CHANNEL] : []), ...(r.asks ? [ASKS_CHANNEL] : [])];
}
