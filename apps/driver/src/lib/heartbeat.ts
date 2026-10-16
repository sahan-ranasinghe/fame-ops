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
// ends, and whenever the background job runs. In the background the loop's
// timers do not run: React Native pauses JS timers when the app leaves the
// front (JavaTimerManager.onHostPause) and runs them only while a headless
// task is active, so the background location task sends the heartbeat too
// (heartbeatDue, at most once a minute): a gap in the heartbeats then means
// the app really stopped. Each one also notes a gap of
// over 3 minutes since the previous one (the Phone setup card), and the loop's
// 10-second look runs the watchdog that restarts a frozen location service. Two copies: the newest one feeds
// driver_latest (queued with replaceOp: only the newest waits), and every one
// goes into the history (driver_heartbeats) in batches, also after an outage,
// so the office later knows the app was alive while nothing arrived.

import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

import type { HeartbeatRow } from './api';
import { getJson, KEYS, remove, setJson } from './kv';
import { getSharing, type Readiness, readiness, restartLocationUpdates, serviceTextsFor } from './location';
import { type Beat, type Gap, keepGaps, noteBeat } from './phoneSetup';
import { currentTrack, isMoving, lastFixAgeS, takeCounters } from './tracking';
import type { Language } from './types';
import { enqueueLatest, flushNow, logHeartbeat } from '../sync';
import { queueCounts } from '../sync/store';

export const HEARTBEAT_EVERY_MS = 60_000;
/** While on duty and moving, no position for this long: the phone froze the location service, which is restarted. */
export const SILENT_RESTART_MS = 90_000;
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

/** A heartbeat while on duty: over 3 minutes since the one before (same duty period) is a gap the Phone setup card shows. */
function noteGap(now: number): void {
  const sessionId = getSharing()?.sessionId ?? null;
  const gap = noteBeat(getJson<Beat>(KEYS.lastBeat), { at: now, sessionId });
  if (sessionId) setJson(KEYS.lastBeat, { at: now, sessionId });
  else remove(KEYS.lastBeat);
  if (gap) setJson(KEYS.phoneGaps, keepGaps([...(getJson<Gap[]>(KEYS.phoneGaps) ?? []), gap], now));
}

/** The watchdog's restarts since the previous heartbeat; taking them starts the count again. */
function takeRestarts(): number {
  const n = getJson<number>(KEYS.locationRestarts) ?? 0;
  if (n) setJson(KEYS.locationRestarts, 0);
  return n;
}

/**
 * The watchdog (every 10 s with the readiness look): on duty, moving, and no position for 90 s means the
 * phone's battery manager froze the location service while it still counts as running. It is stopped and
 * started again (at most once every 90 s) and the next heartbeat says so (location_restarts).
 */
export async function watchLocation(now = Date.now()): Promise<boolean> {
  if (!getSharing() || !isMoving(currentTrack())) return false;
  const lastFix = getJson<number>(KEYS.lastFix) ?? now;
  const lastRestart = getJson<number>(KEYS.lastRestartAt) ?? 0;
  if (now - lastFix < SILENT_RESTART_MS || now - lastRestart < SILENT_RESTART_MS) return false;
  setJson(KEYS.lastRestartAt, now);
  const ok = await restartLocationUpdates(serviceTextsFor(getJson<Language>(KEYS.language) ?? 'en'));
  if (ok) setJson(KEYS.locationRestarts, (getJson<number>(KEYS.locationRestarts) ?? 0) + 1);
  return ok;
}

/** Builds one heartbeat, queues it (newest for driver_latest, every one for the history), then tries to send. Returns what the phone found. */
export async function sendHeartbeat(): Promise<Readiness> {
  setJson(KEYS.lastHeartbeatAt, Date.now());
  noteGap(Date.now());
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
    video_uploads_waiting: queue.videos,
    video_bytes_waiting: queue.videoBytes,
    location_restarts: takeRestarts(),
  };
  enqueueLatest({ kind: 'heartbeat', row });
  logHeartbeat(row);
  void flushNow();
  return ready;
}

/** The location task's turn: a heartbeat once a minute while positions keep arriving and the loop's timers are frozen. */
export function heartbeatDue(now = Date.now()): boolean {
  return getSharing() !== null && now - (getJson<number>(KEYS.lastHeartbeatAt) ?? 0) >= HEARTBEAT_EVERY_MS - 5_000;
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
  // At most one a minute, whichever sends it: the location task sends one too (heartbeatDue), and in the
  // background this interval fires late, next to the task's.
  const beat = setInterval(() => {
    if (!stopped && heartbeatDue()) void sendHeartbeat();
  }, HEARTBEAT_EVERY_MS);
  const look = setInterval(() => {
    if (stopped) return;
    void watchLocation().catch(() => false);
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
