// The heartbeat: what the phone says about itself, separate from GPS points,
// so the office sees the truth within about a minute: on duty or not, Android
// Location services on or off, the location permission, battery, the app
// version, whether the phone has a data connection, whether the app is in the
// foreground, how old the last GPS fix is, how many points are waiting or were
// refused, and what became of the fixes seen since the last heartbeat (stored,
// or dropped for accuracy, a jump, jitter, a repeat).
//
// Sent about every 60 s while on duty (lib/heartbeat loop, started by the app
// state), at once when Location or the permission changes, once when duty
// ends, and whenever the background job runs. Two copies: the newest one feeds
// driver_latest (queued with replaceOp: only the newest waits), and every one
// goes into the history (driver_heartbeats) in batches, also after an outage,
// so the office later knows the app was alive while nothing arrived.

import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

import type { HeartbeatRow } from './api';
import { getSharing, type Readiness, readiness } from './location';
import { lastFixAgeS, takeCounters } from './tracking';
import { enqueueLatest, flushNow, logHeartbeat } from '../sync';
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

/** Whether the phone has a usable data connection right now (mobile data or Wi-Fi), as Android reports it. */
export async function dataAvailable(): Promise<boolean | null> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isInternetReachable ?? state.isConnected ?? null;
  } catch {
    return null;
  }
}

/** Builds one heartbeat, queues it (newest for driver_latest, every one for the history), then tries to send. Returns what the phone found. */
export async function sendHeartbeat(): Promise<Readiness> {
  const ready = await readiness();
  const counts = takeCounters();
  const queue = queueCounts();
  const row: HeartbeatRow = {
    at: new Date().toISOString(),
    sharing: getSharing() !== null,
    location_on: ready.servicesOn,
    permission: ready.permission,
    battery_pct: await batteryPercent(),
    app_version: appVersionLabel(),
    queued_points: queue.points,
    rejected_points: queue.rejected,
    data_available: await dataAvailable(),
    app_state: AppState.currentState === 'active' ? 'foreground' : 'background',
    fix_age_s: lastFixAgeS(),
    session_id: getSharing()?.sessionId ?? null,
    fixes_seen: counts.seen,
    fixes_stored: counts.stored,
    dropped_accuracy: counts.dropped_accuracy,
    dropped_jump: counts.dropped_jump,
    dropped_jitter: counts.dropped_jitter,
    dropped_duplicate: counts.dropped_duplicate,
  };
  enqueueLatest({ kind: 'heartbeat', row });
  logHeartbeat(row);
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
