// The background location task. Android runs this for every batch of
// positions while "Sharing my location" is on, also when the app is closed.
// It is imported from the app's entry file (index.ts) so that it is always
// defined before Android delivers the first position.
//
// Each point goes into the phone's queue first; uploads happen about once a
// minute, or sooner when 10 or more points are waiting.

import * as Battery from 'expo-battery';
import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { flushNow } from '../sync';
import { addPoints, queueCounts } from '../sync/store';
import { getJson, KEYS } from './kv';
import { getSharing, LOCATION_TASK } from './location';

const UPLOAD_EVERY_MS = 60_000;
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

  const battery = await batteryPercent();
  addPoints(
    locations.map((location) => ({
      session_id: sharing.sessionId,
      recorded_at: new Date(location.timestamp).toISOString(),
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy_m: location.coords.accuracy,
      speed_mps: location.coords.speed !== null && location.coords.speed >= 0 ? location.coords.speed : null,
      heading: location.coords.heading !== null && location.coords.heading >= 0 ? location.coords.heading : null,
      battery_pct: battery,
      is_mock: location.mocked === true,
    })),
  );

  const sinceLast = Date.now() - (getJson<number>(KEYS.lastFlush) ?? 0);
  const waiting = queueCounts().points;
  if (sinceLast >= UPLOAD_EVERY_MS || (waiting >= UPLOAD_WHEN_QUEUED && sinceLast >= RETRY_NO_SOONER_MS)) {
    await flushNow();
  }
});
