// Small values kept on the phone (SQLite underneath): who is signed in, the
// last data seen, whether sharing is on. Readable from the background
// location task as well as from the screens.

import Storage from 'expo-sqlite/kv-store';

export function getJson<T>(key: string): T | null {
  const raw = Storage.getItemSync(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setJson(key: string, value: unknown): void {
  Storage.setItemSync(key, JSON.stringify(value));
}

export function remove(key: string): void {
  Storage.removeItemSync(key);
}

export const KEYS = {
  me: 'me',
  language: 'language',
  sharing: 'sharing',
  lastFlush: 'lastFlush',
  tasks: 'cache.tasks',
  vehicles: 'cache.vehicles',
  reports: 'cache.reports',
  permissionsSeen: 'permissionsSeen',
  /** When the location service last delivered a position (ms). */
  lastFix: 'tracking.lastFix',
  /** The GPS filter's state and the km counters (see lib/tracking.ts). */
  track: 'tracking.track',
  /** When the "sharing has stopped" notification is due to fire (ms). */
  watchdogAt: 'tracking.watchdogAt',
  /** When the app last looked for a code update (ms). */
  lastUpdateCheck: 'updates.lastCheck',
  /** An update was downloaded but not started yet (a task was running or something was waiting to upload). */
  updateDownloaded: 'updates.downloaded',
  /** The Expo push token this phone registered with the office. */
  pushToken: 'push.token',
  /** The shift nudge's time and days, as the office set them (Phase 6). */
  shift: 'shift.settings',
  /** The settings the nudge is scheduled with right now (JSON), so it is not rescheduled on every run. */
  shiftArmed: 'shift.armed',
  /** "Upload videos on Wi-Fi only" (Me tab). */
  videoWifiOnly: 'video.wifiOnly',
  /** The upload backoff after a failed connection (sync/engine.ts). */
  backoff: 'sync.backoff',
  /** The office is watching this driver until here (ms; the heartbeat's answer): uploads every 10 s while moving. */
  watchedUntil: 'tracking.watchedUntil',
  /** The last heartbeat while on duty ({at, sessionId}): over 3 minutes to the next one means the phone stopped the app. */
  lastBeat: 'phone.lastBeat',
  /** When the last heartbeat was built (the location task sends one when the JS timers are frozen in the background). */
  lastHeartbeatAt: 'heartbeat.lastAt',
  /** Those gaps, the last 7 days (lib/phoneSetup.ts), and when the driver last tapped Done on the Phone setup card. */
  phoneGaps: 'phone.gaps',
  phoneSetupDoneAt: 'phone.setupDoneAt',
  /** The stops the arrival nudge already spoke about (lib/arrival.ts). */
  arrivalNudged: 'arrival.nudged',
  /** The watchdog: when it last restarted the location service (ms), and how often since the last heartbeat. */
  lastRestartAt: 'tracking.lastRestartAt',
  locationRestarts: 'tracking.locationRestarts',
  /** Phase 7: the server ended this driver's duty (the cut-off or the office): {at, reason}, for the notice on Today. */
  dutyEnded: 'duty.ended',
  /** Phase 7: the vehicle the driver held last (off duty the logs, fuel and reports still go to it). */
  lastVehicle: 'duty.lastVehicle',
  /** Phase 7: the newest "taken over" banner the driver closed (the assignment id), so it does not come back. */
  takenSeen: 'duty.takenSeen',
  /** When the refused points were last put back in line (ms), and for which app update. */
  rejectedRetryAt: 'sync.rejectedRetryAt',
  rejectedRetryUpdate: 'sync.rejectedRetryUpdate',
} as const;
