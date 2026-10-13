// The GPS filter on the phone: its state between deliveries of the background
// location task and the km counters the screens show. Which fixes are worth
// recording is decided in recording.ts (pure, tested by scripts/test-track.ts).

import type * as Location from 'expo-location';

import { getJson, KEYS, setJson } from './kv';
import type { PhoneFix, RecordingState } from './recording';
import { newTrack } from './track';

export { HEARTBEAT_MS, type PhoneFix, recordable } from './recording';

export interface TrackRecord extends RecordingState {
  /** The sharing period the filter state belongs to. */
  sessionId: string;
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
    lastRaw: null,
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
