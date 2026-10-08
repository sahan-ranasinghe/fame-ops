// The background location task. Android runs this for every batch of
// positions while "Sharing my location" is on, also when the app is closed.
// It is imported from the app's entry file (index.ts) so that it is always
// defined before Android delivers the first position.
//
// Positions arrive every 5 s (in batches of up to 15 s). Each one goes
// through the GPS filter; what is worth keeping (lib/tracking.ts) goes into
// the phone's queue, and uploads happen about every 30 s, or sooner when 10
// or more points are waiting. Every delivery also notes the time (so the app
// can tell a dead service from a live one) and pushes back the watchdog
// notification that fires when deliveries stop.

import * as Battery from 'expo-battery';
import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { translate } from '../i18n';
import { flushNow } from '../sync';
import { addPoints, queueCounts } from '../sync/store';
import { getJson, KEYS, setJson } from './kv';
import { getSharing, LOCATION_TASK } from './location';
import { armWatchdog } from './notifications';
import { loadTrack, recordable, saveTrack, toPhoneFix } from './tracking';
import type { Language } from './types';

const UPLOAD_EVERY_MS = 30_000;
const UPLOAD_WHEN_QUEUED = 10;
const RETRY_NO_SOONER_MS = 15_000;

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
  if (waiting > 0 && (sinceLast >= UPLOAD_EVERY_MS || (waiting >= UPLOAD_WHEN_QUEUED && sinceLast >= RETRY_NO_SOONER_MS))) {
    await flushNow();
  }
});
