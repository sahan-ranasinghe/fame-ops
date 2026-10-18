// The "New tasks" notification channel (Hotfix 2, B). Pure: no expo-notifications here, so scripts/test-preview.ts
// checks it (lib/notifications.ts turns it into Android's channel).
//
// Android fixes a channel's sound, vibration and importance when the channel is first made, so the louder settings
// need a new channel id: `new-tasks`. The office's push-task sends new, changed, reassigned and cancelled task pushes on
// it to the phones that registered their token with it (register_device_token p_channels); older phones keep the old
// channels. A channel can only play a sound that is in the installed build (the expo-notifications plugin bundles
// assets/sounds/*.wav listed in app.json): new_task.wav is in the 1.2.0 build.

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

/** The channels this phone tells the server it has (register_device_token p_channels): the new one once it is made. */
export function channelsToRegister(newTasksReady: boolean): string[] {
  return newTasksReady ? [NEW_TASKS_CHANNEL] : [];
}
