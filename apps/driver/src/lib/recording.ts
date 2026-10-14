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
//   - it is jitter: within max(10 m, its accuracy) of the anchor with a speed
//     under 1 m/s. The anchor is where the vehicle stands: the last stored fix
//     when it stops, then the mean of the still fixes around it (so the GPS
//     scatter around a parked vehicle stays inside the radius). While it
//     stands still only one such fix a minute is stored (the most accurate of
//     the delivery), so the office keeps seeing the driver.
//
// So a moving vehicle gives a point every 5 s (every fix), a walking driver
// too, a parked one a point a minute. Nothing waits to be confirmed and no
// heading rule is needed. The GPS drift filter (track.ts) still runs here,
// but only for the km counters the screens show; where the vehicle really
// went is worked out on the server from the stored points.
//
// Every fix seen, stored or dropped is counted (by reason) for the heartbeat.

import { distanceM, type Fix, MOVING_MPS, step, type TrackState } from './track';

export const HEARTBEAT_MS = 60_000;
/** Fixes worse than this are not stored. */
export const MAX_STORE_ACCURACY_M = 150;
/** More than this from the last stored fix is a jump. */
export const MAX_JUMP_KMH = 150;
/** Within max(this, the accuracy) of the last stored fix with no speed is jitter. */
export const JITTER_MIN_M = 10;
/** A repeated fix (same coordinates, no speed) is a duplicate for this long after the last stored point. */
export const DUPLICATE_WINDOW_MS = 60_000;
/** Jump-refused fixes in a row that agree with each other: the stored fix was the wrong one. */
export const JUMP_RUN = 3;
/** The anchor of a standing vehicle is the mean of at most this many of its still fixes (so it can follow a slow correction). */
export const ANCHOR_FIXES = 20;

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
  /** Where the vehicle stands: the mean of the still fixes since it last moved (the anchor for jitter), and how many. */
  anchor?: { lat: number; lng: number; n: number } | null;
  /** Coordinates of the last fix delivered, to spot a cached one delivered again. */
  lastRaw?: { lat: number; lng: number } | null;
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

  const store = (fix: PhoneFix, moved = true) => {
    keep.push(fix);
    track.lastStored = { at: fix.at, lat: fix.lat, lng: fix.lng };
    track.lastKeptAt = Math.max(track.lastKeptAt, fix.at);
    track.jumpRun = [];
    if (moved) track.anchor = { lat: fix.lat, lng: fix.lng, n: 1 };
    counts.stored += 1;
  };
  /** A still fix moves the anchor a little towards itself (a running mean of at most ANCHOR_FIXES fixes). */
  const settle = (fix: PhoneFix) => {
    const a = track.anchor;
    if (!a) {
      track.anchor = { lat: fix.lat, lng: fix.lng, n: 1 };
      return;
    }
    const n = Math.min(a.n + 1, ANCHOR_FIXES);
    track.anchor = { lat: a.lat + (fix.lat - a.lat) / n, lng: a.lng + (fix.lng - a.lng) / n, n };
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
        store(fix); // the stored fix was the wrong one: recording goes on from here
        continue;
      }
      counts.dropped_jump += 1;
      continue;
    }

    const anchor = track.anchor ?? last;
    if (anchor && standing(fix) && distanceM(anchor, fix) <= Math.max(JITTER_MIN_M, fix.accuracyM ?? JITTER_MIN_M)) {
      // Standing still: one fix a minute, the most accurate of the delivery.
      settle(fix);
      jitterSeen += 1;
      if (fix.at - track.lastKeptAt >= HEARTBEAT_MS && (!heartbeat || (fix.accuracyM ?? 999) < (heartbeat.accuracyM ?? 999))) heartbeat = fix;
      continue;
    }

    // Stored. A fix with a speed moves the anchor to itself (the vehicle drove off); a standing fix outside the
    // radius (a GPS excursion while parked) only pulls the anchor a little, so one excursion does not start a chain.
    store(fix, !standing(fix));
    if (standing(fix)) settle(fix);
  }

  if (heartbeat && heartbeat.at - track.lastKeptAt >= HEARTBEAT_MS) {
    store(heartbeat, false);
    jitterSeen -= 1;
  }
  counts.dropped_jitter += jitterSeen;
  return keep.sort((a, b) => a.at - b.at);
}
