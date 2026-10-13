// Which fixes the phone records (pure: no storage, so scripts/test-track.ts
// can run it). The GPS filter in track.ts decides what counts as movement;
// this file decides what is worth keeping:
//
//   - every fix that moved the vehicle (after the filter agreed), and the fix
//     where it arrived: driving at 5 s per fix
//   - otherwise one fix a minute while parked, so the office keeps seeing the
//     driver: only a precise fix (under 50 m) qualifies, never a cell-tower or
//     Wi-Fi guess, which would draw the vehicle somewhere it is not
//   - a fix that repeats the exact coordinates of the fix before it is a cached
//     location Android delivered again (a cell tower's position, a stale fix):
//     dropped before the filter sees it
//
// Learnt from test.driver's phone on 12 October 2026: parked indoors it got
// the same cell-tower position (accuracy 100 m) five times, and on the road
// with no GPS fix for 12 minutes it recorded network guesses every minute.

import { type Fix, step, type TrackState, usable } from './track';

export const HEARTBEAT_MS = 60_000;

export interface PhoneFix extends Fix {
  heading: number | null;
  mocked: boolean;
}

/** What the filter needs between deliveries (the saved record holds more). */
export interface RecordingState {
  state: TrackState;
  /** Time of the newest recorded fix. */
  lastKeptAt: number;
  /** The km counters the screens show. */
  taskKm: number;
  odometerKm: number;
  /** Coordinates of the last fix delivered, to spot a cached one delivered again. */
  lastRaw?: { lat: number; lng: number } | null;
}

/**
 * Feeds a delivery of fixes (any order) through the filter, updates the km
 * counters, and returns the fixes to record, oldest first.
 */
export function recordable<T extends RecordingState>(track: T, fixes: PhoneFix[]): PhoneFix[] {
  const ordered = [...fixes].sort((a, b) => a.at - b.at);
  const byTime = new Map(ordered.map((fix) => [fix.at, fix]));
  const keep = new Map<number, PhoneFix>();
  let heartbeat: { fix: PhoneFix; still: boolean } | null = null;

  for (const fix of ordered) {
    // The same coordinates as the fix before: Android handed us a cached location again.
    if (track.lastRaw && track.lastRaw.lat === fix.lat && track.lastRaw.lng === fix.lng) continue;
    track.lastRaw = { lat: fix.lat, lng: fix.lng };

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
    // Heartbeat: when nothing has been recorded for a minute, keep the most trustworthy precise fix of this delivery.
    if (usable(fix) && fix.at - track.lastKeptAt >= HEARTBEAT_MS) {
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
