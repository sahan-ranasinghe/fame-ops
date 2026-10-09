// GPS drift filter: which position fixes count as movement, how far the
// vehicle went, and where it stood still.
//
// This file is shared word for word by the driver app (apps/driver/src/lib/
// track.ts) and the office connector (supabase/functions/_shared/fleet/track.ts).
// It has no imports so that both copies stay identical; scripts/test-track.ts
// checks that they are.
//
// The rules, learnt from a phone that stood still indoors for 47 minutes and
// "travelled" 11.6 km (scripts/fixtures/indoor-still-2026-10-08.json):
//
//   1. A fix with an accuracy worse than 50 m is ignored.
//   2. A fix that would need more than 150 km/h from the last accepted
//      position is a jump, not a drive: ignored.
//   3. Movement smaller than the accuracy radius (the two accuracies added,
//      at least 25 m) is standing still: no distance is added.
//   4. A fix further away than that only counts once a second fix agrees
//      with it: the fix must report a speed (a moving vehicle always does),
//      and the next fix must be about where that speed says it should be.
//      A single fix that is 200 m away with no speed, or with a speed the
//      next fix does not bear out, is a wrong Wi-Fi fix or a GPS hiccup.
//   5. When several fixes in a row agree with each other but not with the
//      accepted position, the accepted position was the wrong one (a poor
//      first fix): the phone is moved there without adding distance.
//
// Raw fixes are never thrown away by this file; it only decides what counts.

export const MAX_ACCURACY_M = 50;
export const MAX_SPEED_KMH = 150;
export const MIN_MOVE_M = 25;
/** Reported speed from which a fix counts as "moving" (3.6 km/h). */
export const MOVING_MPS = 1;
export const STOP_MINUTES = 10;
/** How many fixes in a row, spanning at least REANCHOR_SECONDS, move the accepted position without adding distance. */
export const REANCHOR_FIXES = 3;
export const REANCHOR_SECONDS = 30;

const EARTH_M = 6371000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface Fix {
  /** Unix time in milliseconds. */
  at: number;
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedMps: number | null;
}

export interface Stop {
  /** Unix time in milliseconds. */
  from: number;
  to: number;
  minutes: number;
  lat: number;
  lng: number;
}

/** The position the phone was last accepted at, how long it has been there, and what is waiting to be confirmed. */
export interface TrackState {
  anchor: Fix | null;
  /** When the anchor was set. */
  stopStart: number;
  /** The newest fix seen at the anchor. */
  lastStill: number;
  /** A fix that moved away from the anchor and is waiting for the next fix to agree. */
  pending: Fix | null;
  /** Fixes in a row that agree with each other but not with the anchor. */
  driftRun: Fix[];
  /** Distance accepted so far, in metres. */
  metres: number;
  /** true right after a move, until the phone is seen standing still again. */
  justMoved: boolean;
}

export type Verdict =
  | 'first'
  | 'still'
  | 'moved'
  | 'pending'
  | 'reanchored'
  | 'bad_accuracy'
  | 'jump'
  | 'drift'
  | 'out_of_order';

export interface StepResult {
  verdict: Verdict;
  /** Metres added by this fix (0 unless `moved`). */
  movedM: number;
  /** The fix that was accepted as the new position: the earlier pending fix on `moved`, this fix on `first`, the run's first fix on `reanchored`. */
  accepted?: Fix;
  /** true on the first fix standing still after a move: where the vehicle arrived. */
  arrived?: boolean;
  /** A stop that ended with this fix (the phone left a place it stayed at for 10 minutes or more). */
  stop?: Stop;
}

export function newTrack(): TrackState {
  return { anchor: null, stopStart: 0, lastStill: 0, pending: null, driftRun: [], metres: 0, justMoved: false };
}

/** Straight-line distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function usable(fix: Fix): boolean {
  return fix.accuracyM == null || fix.accuracyM <= MAX_ACCURACY_M;
}

function moving(fix: Fix): boolean {
  return fix.speedMps != null && fix.speedMps >= MOVING_MPS;
}

/** How far two fixes must be apart to count as different places. */
export function moveThresholdM(a: Fix, b: Fix): number {
  return Math.max(MIN_MOVE_M, (a.accuracyM ?? MIN_MOVE_M) + (b.accuracyM ?? MIN_MOVE_M));
}

function tooFast(from: Fix, fromAt: number, to: Fix): boolean {
  const seconds = (to.at - fromAt) / 1000;
  return seconds > 0 && (distanceM(from, to) / seconds) * 3.6 > MAX_SPEED_KMH;
}

/**
 * Does `next` bear out the movement `pending` reported? Over the few seconds
 * between them the phone should have covered about the distance their speeds
 * say: between 0.4 and 3 times that (plus the accuracy radius). A stationary
 * phone with a phantom speed fails this, a car does not.
 */
function consistent(pending: Fix, next: Fix): boolean {
  const seconds = (next.at - pending.at) / 1000;
  if (seconds <= 0) return false;
  const expected = (((pending.speedMps ?? 0) + (next.speedMps ?? 0)) / 2) * seconds;
  const actual = distanceM(pending, next);
  return actual >= 0.4 * expected && actual <= 3 * expected + moveThresholdM(pending, next);
}

function stopAt(state: TrackState): Stop | undefined {
  const anchor = state.anchor;
  if (!anchor) return undefined;
  const minutes = (state.lastStill - state.stopStart) / 60000;
  if (minutes < STOP_MINUTES) return undefined;
  return { from: state.stopStart, to: state.lastStill, minutes: Math.round(minutes), lat: anchor.lat, lng: anchor.lng };
}

function setAnchor(state: TrackState, fix: Fix, at: number): void {
  state.anchor = fix;
  state.stopStart = fix.at;
  state.lastStill = at;
  state.pending = null;
  state.driftRun = [];
}

/** Feeds one fix, in time order. Changes `state` in place. */
export function step(state: TrackState, fix: Fix): StepResult {
  if (!usable(fix)) return { verdict: 'bad_accuracy', movedM: 0 };

  if (!state.anchor) {
    setAnchor(state, fix, fix.at);
    return { verdict: 'first', movedM: 0, accepted: fix };
  }

  const reference = state.pending ?? state.anchor;
  const referenceAt = state.pending ? state.pending.at : state.lastStill;
  if (fix.at <= referenceAt) return { verdict: 'out_of_order', movedM: 0 };
  if (tooFast(reference, referenceAt, fix)) return { verdict: 'jump', movedM: 0 };

  let result: StepResult | null = null;

  // A pending move is settled by this fix: confirmed when the fix agrees with it, dropped otherwise.
  if (state.pending) {
    const pending = state.pending;
    if (consistent(pending, fix)) {
      const metres = distanceM(state.anchor, pending);
      const stop = stopAt(state);
      state.metres += metres;
      setAnchor(state, pending, pending.at);
      state.justMoved = true;
      result = { verdict: 'moved', movedM: metres, accepted: pending, stop };
    } else {
      state.pending = null;
    }
  }

  const anchor = state.anchor;
  const metres = distanceM(anchor, fix);
  if (metres <= moveThresholdM(anchor, fix)) {
    state.lastStill = fix.at;
    state.driftRun = [];
    const arrived = state.justMoved;
    state.justMoved = false;
    return result ? { ...result, arrived } : { verdict: 'still', movedM: 0, arrived };
  }

  if (moving(fix)) {
    state.pending = fix;
    state.driftRun = [];
    return result ?? { verdict: 'pending', movedM: 0 };
  }

  // No speed: a wrong fix, unless a run of fixes keeps agreeing on this other place.
  const run = state.driftRun;
  if (run.length > 0 && distanceM(run[run.length - 1], fix) > moveThresholdM(run[run.length - 1], fix)) run.length = 0;
  run.push(fix);
  if (run.length >= REANCHOR_FIXES && (fix.at - run[0].at) / 1000 >= REANCHOR_SECONDS) {
    const stop = stopAt(state);
    const first = run[0];
    setAnchor(state, first, fix.at);
    state.justMoved = false;
    return { verdict: 'reanchored', movedM: 0, accepted: first, stop: result?.stop ?? stop };
  }
  return result ?? { verdict: 'drift', movedM: 0 };
}

/** The stop the phone is in at the end of the data, if it has lasted 10 minutes or more. */
export function openStop(state: TrackState): Stop | undefined {
  return stopAt(state);
}

export interface TrackSummary {
  km: number;
  stops: Stop[];
  /** Fixes that passed the accuracy rule. */
  usable: number;
  /** Fixes that added distance. */
  moved: number;
}

/** Distance and stops for a whole list of fixes (oldest first). */
export function summarise(fixes: Fix[]): TrackSummary {
  const state = newTrack();
  const stops: Stop[] = [];
  let usableCount = 0;
  let moved = 0;
  for (const fix of fixes) {
    const result = step(state, fix);
    if (result.verdict !== 'bad_accuracy') usableCount += 1;
    if (result.verdict === 'moved') moved += 1;
    if (result.stop) stops.push(result.stop);
  }
  const last = openStop(state);
  if (last) stops.push(last);
  return { km: Math.round((state.metres / 1000) * 10) / 10, stops, usable: usableCount, moved };
}
