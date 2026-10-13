// The heartbeat: what the phone says about itself, separate from GPS points,
// so the office sees the truth within about a minute: sharing on or off,
// Android Location services on or off, the location permission, battery, the
// app version and how many points are still waiting on the phone.
//
// Sent about every 60 s while sharing is on (lib/heartbeat loop, started by
// the app state), at once when Location or the permission changes, once when
// sharing stops, and whenever the background job runs. Queued like points:
// only the newest heartbeat waits (sync/store replaceOp), and the server
// ignores one that arrives after a newer one.

import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Updates from 'expo-updates';

import type { HeartbeatRow } from './api';
import { getSharing, type Readiness, readiness } from './location';
import { enqueueLatest, flushNow } from '../sync';
import { queueCounts } from '../sync/store';

export const HEARTBEAT_EVERY_MS = 60_000;
/** How often the phone looks at Location and the permission while sharing (a change is sent at once). */
export const READINESS_EVERY_MS = 10_000;

export function appVersionLabel(): string {
  const native = Application.nativeApplicationVersion ?? '?';
  const update = Updates.updateId ? `+${Updates.updateId.slice(0, 8)}` : '';
  return `${native}${update}`;
}

async function batteryPercent(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 && level <= 1 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

/** Builds and queues one heartbeat, then tries to send. Returns what the phone found. */
export async function sendHeartbeat(): Promise<Readiness> {
  const ready = await readiness();
  const row: HeartbeatRow = {
    at: new Date().toISOString(),
    sharing: getSharing() !== null,
    location_on: ready.servicesOn,
    permission: ready.permission,
    battery_pct: await batteryPercent(),
    app_version: appVersionLabel(),
    queued_points: queueCounts().points,
  };
  enqueueLatest({ kind: 'heartbeat', row });
  void flushNow();
  return ready;
}

const key = (r: Readiness) => `${r.servicesOn}/${r.permission}`;

/**
 * While sharing is on: a heartbeat every minute, and a quick look at Location
 * and the permission every 10 s with a heartbeat the moment either changes.
 * Returns the function that stops it.
 */
export function startHeartbeatLoop(onChange?: (ready: Readiness) => void): () => void {
  let last: string | null = null;
  let stopped = false;
  void sendHeartbeat().then((ready) => {
    last = key(ready);
    onChange?.(ready);
  });
  const beat = setInterval(() => {
    if (!stopped && getSharing()) void sendHeartbeat();
  }, HEARTBEAT_EVERY_MS);
  const look = setInterval(() => {
    if (stopped) return;
    void readiness().then((ready) => {
      const now = key(ready);
      if (last !== null && now !== last && getSharing()) void sendHeartbeat();
      if (now !== last) onChange?.(ready);
      last = now;
    });
  }, READINESS_EVERY_MS);
  return () => {
    stopped = true;
    clearInterval(beat);
    clearInterval(look);
  };
}
