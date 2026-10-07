// Local notifications: shown by the app itself when a new task arrives while
// it is running. (Push from the server comes in a later phase.)

import * as Notifications from 'expo-notifications';

const TASKS_CHANNEL = 'tasks';

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
    await ensureChannel();
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

async function ensureChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(TASKS_CHANNEL, {
    name: 'Tasks',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
  });
}

/** Tells the driver about a new task. Does nothing when notifications are not allowed. */
export async function notifyNewTask(title: string, body: string): Promise<void> {
  try {
    if (!(await notificationsAllowed())) return;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { channelId: TASKS_CHANNEL } });
  } catch {
    // A missed banner is not worth an error: the task is on the Today screen.
  }
}
