// Code updates over the air (EAS Update), for builds that include them (the
// preview build).
//
// - Each start: Android itself looks for an update (app.json: ON_LOAD) and
//   opens it straight away when it arrives within a few seconds.
// - Each return to the front, at most every 30 minutes: the app looks again
//   and downloads what it finds. The new code is started only when no task is
//   in progress and nothing is waiting to be uploaded; otherwise it waits for
//   that moment, or for the next start.
// - Me -> "Check for update": the same, on demand and without the 30 minutes.
//
// expo-updates is loaded only when asked for: a build made before it was added
// simply has no updates, instead of failing to start.

import { getJson, KEYS, remove, setJson } from './kv';

type UpdatesModule = typeof import('expo-updates');

const CHECK_EVERY_MS = 30 * 60_000;

let loaded: UpdatesModule | null | undefined;

function updates(): UpdatesModule | null {
  if (loaded === undefined) {
    try {
      loaded = require('expo-updates') as UpdatesModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** The id of the update now running, or null when this build has no updates (development build). */
export function runningUpdateId(): string | null {
  const module = updates();
  return module?.isEnabled ? module.updateId ?? null : null;
}

/** When the code now running was published, or null when this build has no updates (development build). */
export function runningUpdate(): { publishedAt: Date | null; channel: string | null } | null {
  const module = updates();
  if (!module?.isEnabled) return null;
  return { publishedAt: module.createdAt, channel: module.channel };
}

/** Called once at start: whatever was downloaded before is either running now or will run at the next start. */
export function forgetDownloadedUpdate(): void {
  remove(KEYS.updateDownloaded);
}

export type UpdateOutcome = 'not-available' | 'skipped' | 'up-to-date' | 'downloaded' | 'applied' | 'failed';

/** It is safe to restart into new code: no task in progress and nothing waiting to be sent. */
export type SafeToApply = () => boolean;

/** Starts an update downloaded earlier, if there is one and it is safe now. */
export async function applyDownloadedUpdate(safe: SafeToApply): Promise<boolean> {
  const module = updates();
  if (!module?.isEnabled || !getJson<boolean>(KEYS.updateDownloaded) || !safe()) return false;
  try {
    remove(KEYS.updateDownloaded);
    await module.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

/**
 * Looks for a newer update and downloads it. Restarts into it when safe (this
 * call then never returns); otherwise remembers it for later. `force` skips
 * the 30-minute spacing (the button on Me).
 */
export async function checkForUpdate(safe: SafeToApply, force = false): Promise<UpdateOutcome> {
  const module = updates();
  if (!module?.isEnabled) return 'not-available';
  if (await applyDownloadedUpdate(safe)) return 'applied';
  if (getJson<boolean>(KEYS.updateDownloaded)) return 'downloaded';

  const last = getJson<number>(KEYS.lastUpdateCheck) ?? 0;
  if (!force && Date.now() - last < CHECK_EVERY_MS) return 'skipped';
  setJson(KEYS.lastUpdateCheck, Date.now());

  try {
    const check = await module.checkForUpdateAsync();
    if (!check.isAvailable) return 'up-to-date';
    const fetched = await module.fetchUpdateAsync();
    if (!fetched.isNew) return 'up-to-date';
    if (safe()) {
      await module.reloadAsync();
      return 'applied';
    }
    setJson(KEYS.updateDownloaded, true);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
