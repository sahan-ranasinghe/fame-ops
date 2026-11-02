// Push notifications: registering this phone with the office so that the
// server can reach it when the app is closed (Edge Function push-task, through
// Expo's push service and FCM).
//
// The token is registered after sign-in (and again whenever notifications are
// allowed) and removed on sign-out. A build without the Firebase file cannot
// get a token; then nothing is registered and the app relies on Realtime
// while it is open.
//
// Hotfix 2 (B): the token is registered AFTER the channels are made, naming the
// "New tasks" channel (p_channels ['new-tasks']): push-task then sends this phone's
// task pushes on it; a phone that never named it keeps the old channels. Part 3b: also
// "driver-asks" (the office's questions) once made. A server
// without p_channels yet (the update reached the phone first) gets the call
// without it, as before. Part 6: once the server has taken the token with the
// 1.3.0 channels, the 1.2.0 channels they replace are deleted (never before).

import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { channelsToRegister } from './channels';
import { getJson, KEYS, remove, setJson } from './kv';
import { ensureChannels, notificationsAllowed, removeReplacedChannels } from './notifications';
import { supabase } from './supabase';
import type { Language } from './types';
import { reregisterDue } from './pushDue';

/** The push token this phone has registered, if any. */
/** When this process last registered the token (0 = not yet): see pushDue.ts. */
let lastRegisteredAt = 0;

/** Registers the token again when it is due (pushDue.ts): when the app comes to the front. */
export async function registerPushIfDue(now = Date.now()): Promise<boolean> {
  if (!reregisterDue(now, lastRegisteredAt)) return false;
  return registerPush();
}

export function pushToken(): string | null {
  return getJson<string>(KEYS.pushToken);
}

/** Gets this phone's Expo push token and registers it for the signed-in driver. */
export async function registerPush(): Promise<boolean> {
  try {
    if (!(await notificationsAllowed())) return false;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!token) return false;
    const args = {
      p_token: token,
      p_platform: 'android',
      p_device_model: Device.modelName ?? undefined,
      p_app_version: Application.nativeApplicationVersion ?? undefined,
      p_language: getJson<Language>(KEYS.language) ?? undefined,
    };
    // The channels first: the server is told about "New tasks" only once it exists on this phone.
    const channels = channelsToRegister(await ensureChannels());
    let { error } = channels.length > 0
      ? await supabase.rpc('register_device_token', { ...args, p_channels: channels } as typeof args)
      : await supabase.rpc('register_device_token', args);
    let named = channels.length > 0 && !error;
    // PGRST202: no such function with these arguments (a server without p_channels): as before.
    if (error && channels.length > 0 && error.code === 'PGRST202') {
      ({ error } = await supabase.rpc('register_device_token', args));
      named = false;
    }
    if (error) return false;
    setJson(KEYS.pushToken, token);
    lastRegisteredAt = Date.now();
    // Part 6: the server now sends on the 1.3.0 channels, so the 1.2.0 ones they replace can go (only then).
    if (named) await removeReplacedChannels(channels);
    return true;
  } catch {
    // No Firebase in this build, no connection, or notifications refused: nothing to register.
    return false;
  }
}

/** Removes this phone's token (sign-out). Best effort: with no connection the server removes it at the next sign-in elsewhere. */
export async function unregisterPush(): Promise<void> {
  const token = pushToken();
  if (!token) return;
  try {
    await supabase.rpc('remove_device_token', { p_token: token });
  } catch {
    // Left for later.
  }
  remove(KEYS.pushToken);
}
