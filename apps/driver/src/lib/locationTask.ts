// The background location task. Android runs this for every batch of
// positions while "On duty" is on, also when the app is closed. It is imported
// from the app's entry file (index.ts) so that it is always defined before
// Android delivers the first position.
//
// Positions arrive every 5 s (in batches of up to 15 s). Each one goes through
// the recording rules (lib/recording.ts: every fix is stored unless it is a
// cell-tower guess, a jump, a repeat or jitter while standing); what is stored
// goes into the phone's queue, and uploads happen about every 20 s while the
// vehicle moves (10 s while the office is watching this driver: the
// heartbeat's answer) and every 60 s while it stands (the rules say which), or
// sooner when 10 or more points are waiting (the queue's own backoff decides
// whether an attempt is due after a failure). Every delivery also notes the time (so
// the app can tell a dead service from a live one) and pushes back the
// watchdog notification that fires when deliveries stop.

import * as Battery from 'expo-battery';
import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { translate } from '../i18n';
import { flushNow } from '../sync';
import { addPoints, queueCounts } from '../sync/store';
import { getJson, KEYS, setJson } from './kv';
import { getSharing, LOCATION_TASK } from './location';
import { armWatchdog } from './notifications';
import { isMoving, isWatched, loadTrack, recordable, saveTrack, toPhoneFix } from './tracking';
import type { Language } from './types';

/** Uploads about this often while the vehicle moves and the office is watching this driver (the heartbeat's answer) … */
export const UPLOAD_WATCHED_MS = 10_000;
/** … while it moves unwatched … */
export const UPLOAD_MOVING_MS = 20_000;
/** … and while it stands still (the heartbeat sends every minute too). */
export const UPLOAD_PARKED_MS = 60_000;
/** The old name: the parked cadence. */
export const UPLOAD_EVERY_MS = UPLOAD_PARKED_MS;
export const UPLOAD_WHEN_QUEUED = 10;

async function batteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 && level <= 1 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  // Nothing is recorded unless a sharing period is open.
  const sharing = getSharing();
  const locations = data?.locations ?? [];
  if (!sharing || locations.length === 0) return;

  setJson(KEYS.lastFix, Date.now());

  const track = loadTrack(sharing.sessionId);
  const keep = recordable(track, locations.map(toPhoneFix));
  saveTrack(track);

  if (keep.length > 0) {
    const battery = await batteryPercent();
    addPoints(
      keep.map((fix) => ({
        session_id: sharing.sessionId,
        recorded_at: new Date(fix.at).toISOString(),
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracyM,
        speed_mps: fix.speedMps,
        heading: fix.heading,
        battery_pct: battery,
        is_mock: fix.mocked,
      })),
    );
  }

  const language = getJson<Language>(KEYS.language) ?? 'en';
  await armWatchdog(translate(language, 'tracking.stoppedTitle'), translate(language, 'tracking.stoppedBody'));

  const sinceLast = Date.now() - (getJson<number>(KEYS.lastFlush) ?? 0);
  const waiting = queueCounts().points;
  const every = isMoving(track) ? (isWatched() ? UPLOAD_WATCHED_MS : UPLOAD_MOVING_MS) : UPLOAD_PARKED_MS;
  if (waiting > 0 && (sinceLast >= every || waiting >= UPLOAD_WHEN_QUEUED)) {
    await flushNow();
  }
});
