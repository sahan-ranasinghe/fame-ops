// "Sharing my location": on = a sharing period (duty session) is open and the
// phone records points in the background; off = nothing is recorded at all.

import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Location from 'expo-location';

import { enqueue, flushNow } from '../sync';
import { getJson, KEYS, remove, setJson } from './kv';
import type { Employee } from './types';
import { colors } from '../theme';

export const LOCATION_TASK = 'fame-driver-location';

export interface SharingState {
  sessionId: string;
  vehicleId: string | null;
  startedAt: string;
}

export function getSharing(): SharingState | null {
  return getJson<SharingState>(KEYS.sharing);
}

/** The texts of the notification Android shows while the location service runs. */
export interface ServiceTexts {
  title: string;
  body: string;
}

async function beginUpdates(texts: ServiceTexts): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 20_000,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: texts.title,
      notificationBody: texts.body,
      notificationColor: colors.amber,
    },
  });
}

async function isRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export type StartResult = 'on' | 'no_permission';

/** Turns sharing on. Needs the location permission; says so when it is missing. */
export async function startSharing(texts: ServiceTexts): Promise<StartResult> {
  const me = getJson<Employee>(KEYS.me);
  if (!me) return 'no_permission';
  if (getSharing() && (await isRunning())) return 'on';

  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) return 'no_permission';

  // Open the sharing period first: the background task only keeps points while one is open.
  let state = getSharing();
  if (!state) {
    state = { sessionId: Crypto.randomUUID(), vehicleId: me.current_vehicle_id, startedAt: new Date().toISOString() };
    setJson(KEYS.sharing, state);
    enqueue({
      kind: 'session_start',
      id: state.sessionId,
      employee_id: me.id,
      vehicle_id: state.vehicleId,
      started_at: state.startedAt,
      device_info: {
        model: Device.modelName,
        os: `${Device.osName ?? 'Android'} ${Device.osVersion ?? ''}`.trim(),
        app: Application.nativeApplicationVersion,
      },
    });
  }

  try {
    await beginUpdates(texts);
  } catch {
    await stopSharing('auto');
    return 'no_permission';
  }
  void flushNow();
  return 'on';
}

/** Turns sharing off: stops recording and closes the sharing period. */
export async function stopSharing(reason: 'driver' | 'auto'): Promise<void> {
  try {
    if (await isRunning()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // Already stopped.
  }
  const state = getSharing();
  if (state) {
    remove(KEYS.sharing);
    enqueue({ kind: 'session_end', id: state.sessionId, ended_at: new Date().toISOString(), end_reason: reason });
  }
  void flushNow();
}

/**
 * Called when the app opens: if sharing was on but Android has stopped the
 * location service (phone restarted, app force-stopped), start it again, or
 * close the sharing period when that is not possible.
 */
export async function restoreSharing(texts: ServiceTexts): Promise<boolean> {
  if (!getSharing()) return false;
  if (await isRunning()) return true;
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('no permission');
    await beginUpdates(texts);
    return true;
  } catch {
    await stopSharing('auto');
    return false;
  }
}

export interface PermissionStatus {
  location: boolean;
  background: boolean;
}

export async function locationPermissions(): Promise<PermissionStatus> {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  return { location: foreground.granted, background: background.granted };
}

/** Asks for location, then for "Allow all the time" (Android opens its own screen for that). */
export async function requestLocationPermissions(): Promise<PermissionStatus> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return { location: false, background: false };
  const background = await Location.requestBackgroundPermissionsAsync();
  return { location: true, background: background.granted };
}

/** The phone's last known position, when location is allowed. */
export async function lastPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const position = await Location.getLastKnownPositionAsync();
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  } catch {
    return null;
  }
}
