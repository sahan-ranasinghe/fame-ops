// The recording rules' state between deliveries of the background location
// task, the km counters the screens show, and the counters the heartbeat
// reports. Which fixes are stored is decided in recording.ts (pure, tested by
// scripts/test-track.ts).

import type * as Location from 'expo-location';

import { getJson, KEYS, setJson } from './kv';
import { type DropCounts, type PhoneFix, type RecordingState, zeroCounts } from './recording';
import { newTrack } from './track';

export { type DropCounts, HEARTBEAT_MS, isMoving, type PhoneFix, recordable } from './recording';

export interface TrackRecord extends RecordingState {
  /** The sharing period the state belongs to. */
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
    lastStored: null,
    anchor: null,
    lastRaw: null,
    lastFixAt: carry?.lastFixAt ?? null,
    jumpRun: [],
    counters: carry?.counters ?? zeroCounts(),
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

/** The record for one sharing period. A new period starts the rules afresh but keeps the km counters. */
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

// --- watched mode (the heartbeat's answer) --------------------------------------

/** The phone keeps watched mode this long after a heartbeat that said so (heartbeats come every 60 s; one may be missed). */
export const WATCHED_FOR_MS = 150_000;

/** The heartbeat's answer: the office is (not) watching this driver. */
export function setWatched(on: boolean, now = Date.now()): void {
  setJson(KEYS.watchedUntil, on ? now + WATCHED_FOR_MS : 0);
}

/** Whether the office is watching this driver right now: uploads every 10 s while moving. */
export function isWatched(now = Date.now()): boolean {
  return (getJson<number>(KEYS.watchedUntil) ?? 0) > now;
}

// --- what the heartbeat reports -----------------------------------------------

/** The fix counters since they were last taken; taking them starts them again at zero. */
export function takeCounters(): DropCounts {
  const track = currentTrack();
  const counts = track.counters ?? zeroCounts();
  track.counters = zeroCounts();
  saveTrack(track);
  return counts;
}

/** Seconds since a fix of 150 m or better was last seen, or null when there was none this period. */
export function lastFixAgeS(now = Date.now()): number | null {
  const at = currentTrack().lastFixAt;
  return at ? Math.max(0, Math.round((now - at) / 1000)) : null;
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
