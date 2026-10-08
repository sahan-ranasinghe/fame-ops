// The GPS filter on the phone: its state between deliveries of the background
// location task, the km counters the screens show, and the choice of which
// fixes are worth recording.
//
// Recording: every fix that moved the vehicle (after the filter in track.ts
// agreed), the fix where it arrived, and otherwise one fix a minute as a
// heartbeat, so the office keeps seeing the driver while the vehicle is
// parked. Driving at 5 s per fix, parked at 1 fix a minute.

import type * as Location from 'expo-location';

import { getJson, KEYS, setJson } from './kv';
import { type Fix, newTrack, step, type TrackState } from './track';

export const HEARTBEAT_MS = 60_000;

export interface PhoneFix extends Fix {
  heading: number | null;
  mocked: boolean;
}

export interface TrackRecord {
  /** The sharing period the filter state belongs to. */
  sessionId: string;
  state: TrackState;
  /** Time of the newest recorded fix. */
  lastKeptAt: number;
  /** The task in progress and the km driven since it started. */
  taskId: string | null;
  taskKm: number;
  /** Km since this phone last saved an odometer reading (any task, any vehicle). */
  odometerKm: number;
  updatedAt: number;
}

function fresh(sessionId: string, carry?: TrackRecord | null): TrackRecord {
  return {
    sessionId,
    state: newTrack(),
    lastKeptAt: 0,
    taskId: carry?.taskId ?? null,
    taskKm: carry?.taskKm ?? 0,
    odometerKm: carry?.odometerKm ?? 0,
    updatedAt: Date.now(),
  };
}

/** The saved record, whatever period it belongs to (for the counters). */
export function currentTrack(): TrackRecord {
  return getJson<TrackRecord>(KEYS.track) ?? fresh('');
}

/** The record for one sharing period. A new period starts the filter afresh but keeps the km counters. */
export function loadTrack(sessionId: string): TrackRecord {
  const saved = getJson<TrackRecord>(KEYS.track);
  return saved && saved.sessionId === sessionId ? saved : fresh(sessionId, saved);
}

export function saveTrack(track: TrackRecord): void {
  track.updatedAt = Date.now();
  setJson(KEYS.track, track);
}

export function toPhoneFix(location: Location.LocationObject): PhoneFix {
  const { coords } = location;
  return {
    at: location.timestamp,
    lat: coords.latitude,
    lng: coords.longitude,
    accuracyM: coords.accuracy,
    speedMps: coords.speed !== null && coords.speed >= 0 ? coords.speed : null,
    heading: coords.heading !== null && coords.heading >= 0 ? coords.heading : null,
    mocked: location.mocked === true,
  };
}

/**
 * Feeds a delivery of fixes (any order) through the filter, updates the km
 * counters, and returns the fixes to record, oldest first.
 */
export function recordable(track: TrackRecord, fixes: PhoneFix[]): PhoneFix[] {
  const ordered = [...fixes].sort((a, b) => a.at - b.at);
  const byTime = new Map(ordered.map((fix) => [fix.at, fix]));
  const keep = new Map<number, PhoneFix>();
  let heartbeat: { fix: PhoneFix; still: boolean } | null = null;

  for (const fix of ordered) {
    const result = step(track.state, fix);
    if (result.movedM > 0) {
      track.taskKm += result.movedM / 1000;
      track.odometerKm += result.movedM / 1000;
    }
    if (result.accepted) {
      const accepted = byTime.get(result.accepted.at) ?? { ...result.accepted, heading: null, mocked: false };
      keep.set(accepted.at, accepted);
      track.lastKeptAt = Math.max(track.lastKeptAt, accepted.at);
    }
    if (result.arrived) {
      keep.set(fix.at, fix);
      track.lastKeptAt = Math.max(track.lastKeptAt, fix.at);
    }
    // Heartbeat: when nothing has been recorded for a minute, keep the most trustworthy fix of this delivery.
    if (fix.at - track.lastKeptAt >= HEARTBEAT_MS) {
      const still = result.verdict === 'still';
      const better = !heartbeat ||
        (still && !heartbeat.still) ||
        (still === heartbeat.still && (fix.accuracyM ?? 999) < (heartbeat.fix.accuracyM ?? 999));
      if (better) heartbeat = { fix, still };
    }
  }

  if (heartbeat && heartbeat.fix.at - track.lastKeptAt >= HEARTBEAT_MS) {
    keep.set(heartbeat.fix.at, heartbeat.fix);
    track.lastKeptAt = Math.max(track.lastKeptAt, heartbeat.fix.at);
  }
  return [...keep.values()].sort((a, b) => a.at - b.at);
}

// --- counters the screens use ------------------------------------------------

export interface KmCounters {
  taskId: string | null;
  taskKm: number;
  odometerKm: number;
}

export function kmCounters(): KmCounters {
  const { taskId, taskKm, odometerKm } = currentTrack();
  return { taskId, taskKm, odometerKm };
}

/** A task starts: its km counter starts at zero. */
export function beginTaskKm(taskId: string): void {
  const track = currentTrack();
  track.taskId = taskId;
  track.taskKm = 0;
  saveTrack(track);
}

/** The task is over: nothing is counted for a task any more. */
export function endTaskKm(): void {
  const track = currentTrack();
  track.taskId = null;
  saveTrack(track);
}

/** An odometer reading was saved: km since the last reading starts at zero. */
export function resetOdometerKm(): void {
  const track = currentTrack();
  track.odometerKm = 0;
  saveTrack(track);
}
