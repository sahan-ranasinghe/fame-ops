// Which fixes the phone stores (pure: no storage, so scripts/test-track.ts
// can run it). The rule since October 2026 is "store raw, filter on the
// server": every fix is kept unless
//
//   - its accuracy is worse than 150 m (a cell-tower guess; a Wi-Fi fix of
//     20–40 m is where the phone really is and stays),
//   - it would need more than 150 km/h from the last stored fix (a jump; three
//     fixes in a row that agree with each other but not with the stored one
//     mean the stored one was wrong, and recording goes on from them),
//   - it repeats the exact coordinates of the fix before it with no speed,
//     under a minute after the last stored point (a cached fix delivered
//     again), or
//   - the vehicle stands still: the fix is within 10 m of the anchor (a fixed
//     radius, never widened by the accuracy, no speed test) and the movement
//     added up fix to fix since the last stored point is 10 m or less. The
//     anchor is the last fix stored for a move. While the vehicle stands still
//     one fix a minute is stored (the most accurate of the delivery), so the
//     office keeps seeing the driver. The first fix over 10 m from the anchor,
//     or the one that takes the added-up movement over 10 m, is stored and
//     becomes the new anchor.
//
// So a moving vehicle gives a point every 5 s (every fix), a driver walking
// at 4 km/h a point every 10–15 m, a parked one a point a minute. Nothing
// waits to be confirmed and no heading rule is needed. The GPS drift filter
// (track.ts) still runs here, but only for the km counters the screens show;
// where the vehicle really went is worked out on the server from the stored
// points. `moving` says what the last fix found (the upload cadence and the
// retry ladder follow it: lib/locationTask.ts, sync/engine.ts).
//
// Every fix seen, stored or dropped is counted (by reason) for the heartbeat.

import { distanceM, type Fix, MOVING_MPS, step, type TrackState } from './track';

export const HEARTBEAT_MS = 60_000;
/** Fixes worse than this are not stored. */
export const MAX_STORE_ACCURACY_M = 150;
/** More than this from the last stored fix is a jump. */
export const MAX_JUMP_KMH = 150;
/** Standing still: within this of the anchor, with no more than this of movement added up since the last stored point. Fixed; the accuracy never widens it. */
export const STILL_RADIUS_M = 10;
/** A repeated fix (same coordinates, no speed) is a duplicate for this long after the last stored point. */
export const DUPLICATE_WINDOW_MS = 60_000;
/** Jump-refused fixes in a row that agree with each other: the stored fix was the wrong one. */
export const JUMP_RUN = 3;

export interface PhoneFix extends Fix {
  heading: number | null;
  mocked: boolean;
}

/** Fixes seen and what became of them since the counters were last taken (the heartbeat takes them). */
export interface DropCounts {
  seen: number;
  stored: number;
  dropped_accuracy: number;
  dropped_jump: number;
  dropped_jitter: number;
  dropped_duplicate: number;
}

export const zeroCounts = (): DropCounts => ({ seen: 0, stored: 0, dropped_accuracy: 0, dropped_jump: 0, dropped_jitter: 0, dropped_duplicate: 0 });

/** What the rules need between deliveries (the saved record holds more). */
export interface RecordingState {
  /** The drift filter, for the km counters only. */
  state: TrackState;
  /** Time of the newest stored fix. */
  lastKeptAt: number;
  /** The last stored fix: the reference for jumps. */
  lastStored?: { at: number; lat: number; lng: number } | null;
  /** Where the vehicle stands: the last fix stored for a move (n is kept for records saved by an earlier version). */
  anchor?: { lat: number; lng: number; n: number } | null;
  /** Coordinates of the last fix delivered, to spot a cached one delivered again. */
  lastRaw?: { lat: number; lng: number } | null;
  /** The last fix that passed the rules up to the still test: the movement is added up from it. */
  lastPassed?: { lat: number; lng: number } | null;
  /** Movement added up fix to fix since the last stored point (metres). */
  movedM?: number;
  /** What the last fix found: moving (stored for a move) or standing still. */
  moving?: boolean;
  /** When a fix of 150 m or better was last seen. */
  lastFixAt?: number | null;
  /** Jump-refused fixes in a row that agree with each other. */
  jumpRun?: Fix[];
  counters?: DropCounts;
  /** The km counters the screens show. */
  taskKm: number;
  odometerKm: number;
}

function tooFast(from: { at: number; lat: number; lng: number }, to: Fix): boolean {
  const seconds = (to.at - from.at) / 1000;
  return seconds > 0 && (distanceM(from, to) / seconds) * 3.6 > MAX_JUMP_KMH;
}

const standing = (fix: Fix) => fix.speedMps == null || fix.speedMps < MOVING_MPS;

/** Whether the last fix found the vehicle moving (the upload cadence and the retry ladder read it). */
export const isMoving = (track: Pick<RecordingState, 'moving'>): boolean => track.moving === true;

/**
 * Feeds a delivery of fixes (any order) through the rules, updates the km
 * counters, and returns the fixes to store, oldest first.
 */
export function recordable<T extends RecordingState>(track: T, fixes: PhoneFix[]): PhoneFix[] {
  const ordered = [...fixes].sort((a, b) => a.at - b.at);
  const keep: PhoneFix[] = [];
  const counts = (track.counters ??= zeroCounts());
  let heartbeat: PhoneFix | null = null;
  let jitterSeen = 0;

  /** Stores a fix. For a move it becomes the anchor; the minute point of a standing vehicle leaves the anchor where it is. */
  const store = (fix: PhoneFix, moved = true) => {
    keep.push(fix);
    track.lastStored = { at: fix.at, lat: fix.lat, lng: fix.lng };
    track.lastKeptAt = Math.max(track.lastKeptAt, fix.at);
    track.jumpRun = [];
    if (moved) {
      track.anchor = { lat: fix.lat, lng: fix.lng, n: 1 };
      track.moving = true;
    }
    track.movedM = 0;
    counts.stored += 1;
  };

  for (const fix of ordered) {
    counts.seen += 1;
    if (fix.accuracyM != null && fix.accuracyM > MAX_STORE_ACCURACY_M) {
      counts.dropped_accuracy += 1;
      continue;
    }
    track.lastFixAt = Math.max(track.lastFixAt ?? 0, fix.at);

    // The km counters: the drift filter decides what counts as movement.
    const result = step(track.state, fix);
    if (result.movedM > 0) {
      track.taskKm += result.movedM / 1000;
      track.odometerKm += result.movedM / 1000;
    }

    const repeated = track.lastRaw != null && track.lastRaw.lat === fix.lat && track.lastRaw.lng === fix.lng;
    track.lastRaw = { lat: fix.lat, lng: fix.lng };
    const last = track.lastStored;
    if (repeated && standing(fix) && last && fix.at - last.at < DUPLICATE_WINDOW_MS) {
      counts.dropped_duplicate += 1;
      continue;
    }

    if (last && tooFast(last, fix)) {
      const run = track.jumpRun ?? [];
      const prev = run[run.length - 1];
      track.jumpRun = prev && !tooFast(prev, fix) ? [...run, fix] : [fix];
      if (track.jumpRun.length >= JUMP_RUN) {
        track.lastPassed = { lat: fix.lat, lng: fix.lng };
        store(fix); // the stored fix was the wrong one: recording goes on from here
        continue;
      }
      counts.dropped_jump += 1;
      continue;
    }

    // Standing still? Within the fixed radius of the anchor, and not more than the radius of movement added up fix to fix.
    const anchor = track.anchor ?? (last ? { lat: last.lat, lng: last.lng, n: 1 } : null);
    const from = track.lastPassed;
    track.lastPassed = { lat: fix.lat, lng: fix.lng };
    if (anchor) {
      track.movedM = (track.movedM ?? 0) + (from ? distanceM(from, fix) : 0);
      if (distanceM(anchor, fix) <= STILL_RADIUS_M && track.movedM <= STILL_RADIUS_M) {
        // One fix a minute, the most accurate of the delivery.
        track.moving = false;
        jitterSeen += 1;
        if (fix.at - track.lastKeptAt >= HEARTBEAT_MS && (!heartbeat || (fix.accuracyM ?? 999) < (heartbeat.accuracyM ?? 999))) heartbeat = fix;
        continue;
      }
    }

    // Moved: stored, and the anchor moves here.
    store(fix);
  }

  if (heartbeat && heartbeat.at - track.lastKeptAt >= HEARTBEAT_MS) {
    store(heartbeat, false);
    jitterSeen -= 1;
  }
  counts.dropped_jitter += jitterSeen;
  return keep.sort((a, b) => a.at - b.at);
}
