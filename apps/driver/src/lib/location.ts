// "Sharing my location": on = a sharing period (duty session) is open and the
// phone records points in the background; off = nothing is recorded at all.
//
// Android (some brands much more than others: OPPO, Realme, Xiaomi, Vivo,
// Huawei) kills apps that work in the background. checkTracking() notices a
// dead location service while sharing is on, starts it again, and reports what
// the driver has to fix: location switched off, permission taken away, battery
// saving. The background task also keeps a notification armed that fires if
// positions stop arriving (lib/notifications.ts).

import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { Linking } from 'react-native';

import { translate } from '../i18n';
import { enqueue, flushNow } from '../sync';
import { getJson, KEYS, remove, setJson } from './kv';
import { armWatchdog, disarmWatchdog } from './notifications';
import { settingsIntents, type SetupBrand } from './phoneSetup';
import type { Employee, Language } from './types';
import { colors } from '../theme';

export const LOCATION_TASK = 'fame-driver-location';

/** A position every 5 s; the phone hands them to the app in batches of up to 15 s to save battery. */
const FIX_INTERVAL_MS = 5_000;
const DELIVER_EVERY_MS = 15_000;
/** No position for this long while sharing is on means the service has died (or location is off). */
export const DEAD_AFTER_MS = 3 * 60_000;

export interface SharingState {
  sessionId: string;
  vehicleId: string | null;
  startedAt: string;
}

export function getSharing(): SharingState | null {
  return getJson<SharingState>(KEYS.sharing);
}

/** The texts of the notification Android shows while the location service runs, and of the watchdog. */
export interface ServiceTexts {
  title: string;
  body: string;
  stoppedTitle: string;
  stoppedBody: string;
}

/** The notification texts in a language, for code that runs without the screens (the background job). */
export function serviceTextsFor(language: Language): ServiceTexts {
  return {
    title: translate(language, 'service.title'),
    body: translate(language, 'service.body'),
    stoppedTitle: translate(language, 'tracking.stoppedTitle'),
    stoppedBody: translate(language, 'tracking.stoppedBody'),
  };
}

/** Starts the location service (Android: with its foreground notification). Throws when Android refuses. */
export async function startLocationUpdates(texts: ServiceTexts): Promise<void> {
  await beginUpdates(texts);
}

async function beginUpdates(texts: ServiceTexts): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: FIX_INTERVAL_MS,
    distanceInterval: 0,
    deferredUpdatesInterval: DELIVER_EVERY_MS,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: texts.title,
      notificationBody: texts.body,
      notificationColor: colors.amber,
      killServiceOnDestroy: false,
    },
  });
  setJson(KEYS.lastFix, Date.now());
  await armWatchdog(texts.stoppedTitle, texts.stoppedBody);
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
        brand: Device.brand,
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
  await disarmWatchdog();
  remove(KEYS.lastFix);
  const state = getSharing();
  if (state) {
    remove(KEYS.sharing);
    enqueue({ kind: 'session_end', id: state.sessionId, ended_at: new Date().toISOString(), end_reason: reason });
  }
  void flushNow();
}

export type TrackingProblem = 'location_off' | 'no_permission' | 'no_background' | 'battery' | null;

export interface TrackingStatus {
  sharing: boolean;
  problem: TrackingProblem;
  /** The service was found dead and started again in this check. */
  restarted: boolean;
  /** When the last position arrived, if sharing. */
  lastFixAt: number | null;
}

const OFF: TrackingStatus = { sharing: false, problem: null, restarted: false, lastFixAt: null };

/**
 * Called when the app opens or returns to the front, and every minute while
 * it is on screen. If sharing is on but no position has arrived for 3 minutes
 * (or the service is not running at all), the service is started again.
 * Returns what else is wrong so the driver can be told.
 */
export async function checkTracking(texts: ServiceTexts): Promise<TrackingStatus> {
  const state = getSharing();
  if (!state) {
    // Sharing is off: make sure no service is left running from before.
    if (await isRunning()) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
    return OFF;
  }

  const [services, permissions, running, batterySaving] = await Promise.all([
    Location.hasServicesEnabledAsync().catch(() => true),
    locationPermissions(),
    isRunning(),
    Battery.isBatteryOptimizationEnabledAsync().catch(() => false),
  ]);
  if (!permissions.location) {
    await stopSharing('auto');
    return { ...OFF, problem: 'no_permission' };
  }

  const lastFix = getJson<number>(KEYS.lastFix);
  const since = lastFix ?? Date.parse(state.startedAt);
  const dead = !running || Date.now() - since > DEAD_AFTER_MS;
  let restarted = false;
  if (dead) {
    try {
      if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      await beginUpdates(texts); // also resets lastFix, so a restart is tried at most every 3 minutes
      restarted = true;
    } catch {
      await stopSharing('auto');
      return { ...OFF, problem: 'no_permission' };
    }
  }

  const problem: TrackingProblem = !services ? 'location_off' : !permissions.background ? 'no_background' : batterySaving ? 'battery' : null;
  return { sharing: true, problem, restarted, lastFixAt: lastFix };
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

export type LocationPermission = 'always' | 'foreground' | 'denied' | 'unknown';

/** Is this phone ready for work: Location services on, and the permission "Allow all the time". */
export interface Readiness {
  servicesOn: boolean;
  permission: LocationPermission;
  ok: boolean;
}

export async function readiness(): Promise<Readiness> {
  const [servicesOn, foreground, background] = await Promise.all([
    Location.hasServicesEnabledAsync().catch(() => true),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ]);
  const permission: LocationPermission = !foreground || !background
    ? 'unknown'
    : background.granted
    ? 'always'
    : foreground.granted
    ? 'foreground'
    : 'denied';
  return { servicesOn, permission, ok: servicesOn && permission === 'always' };
}

/**
 * Android's own dialog to switch Location on (Google Play services), as
 * ride-hailing apps show it. Resolves true when Location is on afterwards.
 * Phones without the dialog get the Location settings page instead.
 */
export async function enableLocation(): Promise<boolean> {
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    await openLocationSettings();
  }
  return Location.hasServicesEnabledAsync().catch(() => false);
}

/** Android's location settings (to switch location on). */
export async function openLocationSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS).catch(() => Linking.openSettings());
}

/** This app's own settings page (permissions, battery). */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/**
 * The watchdog's restart: the service is stopped and started again (the phone's battery manager had frozen
 * it while it still counted as running). Resolves true when it runs again.
 */
export async function restartLocationUpdates(texts: ServiceTexts): Promise<boolean> {
  try {
    if (await isRunning()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    await beginUpdates(texts);
    return true;
  } catch {
    return false;
  }
}

/** The brand's battery or startup settings (lib/phoneSetup.ts), else this app's App info page. */
export async function openBrandSettings(brand: SetupBrand): Promise<void> {
  const appId = Application.applicationId ?? 'com.fameglobal.driver';
  for (const intent of settingsIntents(brand, appId, Application.applicationName ?? 'Fame Driver')) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', { packageName: intent.packageName, className: intent.className, extra: intent.extra });
      return;
    } catch {
      // Not on this phone (or not opened to other apps): the next one.
    }
  }
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, { data: `package:${appId}` }).catch(() => Linking.openSettings());
}

/** Android's own one-tap question: "Let the app always run in the background?" */
export async function askIgnoreBatteryOptimisation(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: `package:${Application.applicationId}`,
    });
  } catch {
    // Some phones do not offer the question; show the list of apps instead.
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => undefined);
  }
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
