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
  /** When the refused points were last put back in line (ms), and for which app update. */
  rejectedRetryAt: 'sync.rejectedRetryAt',
  rejectedRetryUpdate: 'sync.rejectedRetryUpdate',
} as const;
