// A trip's stops as a live delivery timeline (Round 2, 21 October 2026; Uber / DoorDash / Samsara route progress), pure:
// what each row says from task_detail's stops[].progress (the server's stopProgress.ts): "Planned 10:30 · Arrived 10:52 ·
// Left 11:40", the arrival's delta in words (late amber, early / on time green; on time within 2 minutes, the same rule as
// deltaKind), and for a stop still to come "about 12:10 (updated 10:52)". A stop with no progress (an older server) falls
// back to its planned / arrived / done times. components/office/StopTimeline.tsx draws it; scripts/test-stop-timeline.ts.

import type { Stop } from './types';

type T = (key: string, vars?: Record<string, string | number>) => string;

export type DeltaTone = 'late' | 'early' | 'on_time';

export interface StopLine {
  /** "Planned 10:30 · Arrived 10:52 · Left 11:40" (or "Skipped · closed"). */
  times: string;
  /** "22 min late" / "8 min early" / "On time", with its tone; null when not arrived. */
  delta: { text: string; tone: DeltaTone } | null;
  /** "About 12:10 (updated 10:52)" for a stop still to come. */
  estimate: string | null;
  /** "Arrive by 10:30", the deadline. */
  arriveBy: string | null;
  current: boolean;
  state: 'left' | 'here' | 'next' | 'skipped';
}

/** A skip reason's words (the server sends the code: closed, nobody_there, not_needed, not_visited, other). */
const SKIP_KEYS: Record<string, string> = { closed: 'closed', nobody_there: 'nobodyThere', not_needed: 'notNeeded', not_visited: 'notVisited', other: 'other' };
export function skipWords(t: T, reason: string | undefined): string {
  const k = reason ? SKIP_KEYS[reason] : undefined;
  return k ? t(`office.timeline.skip_${k}`) : '';
}

export function deltaOf(delta: number | undefined): { tone: DeltaTone; min: number } | null {
  if (delta === undefined || delta === null) return null;
  if (Math.abs(delta) <= 2) return { tone: 'on_time', min: 0 };
  return delta > 0 ? { tone: 'late', min: delta } : { tone: 'early', min: -delta };
}

export function stopLine(s: Stop, t: T): StopLine {
  const p = s.progress;
  const planned = p?.planned_arrive ?? s.planned_arrive;
  const arrived = p?.arrived ?? s.arrived;
  const left = p?.left ?? s.done;
  const skipped = s.status === 'skipped';
  const parts: string[] = [];
  if (planned) parts.push(t('office.timeline.planned', { time: planned }));
  if (skipped) {
    const why = skipWords(t, s.skip_reason);
    parts.push(why ? t('office.timeline.skippedWhy', { why }) : t('office.timeline.skipped'));
  }
  else {
    if (arrived) parts.push(t('office.timeline.arrived', { time: arrived }));
    if (left) parts.push(t('office.timeline.left', { time: left }));
  }
  const d = skipped ? null : deltaOf(p?.arrive_delta_min);
  const delta = d
    ? { tone: d.tone, text: d.tone === 'on_time' ? t('office.timeline.onTime') : t(d.tone === 'late' ? 'office.timeline.late' : 'office.timeline.early', { min: d.min }) }
    : null;
  const estimate = !skipped && !arrived && p?.estimate
    ? t('office.timeline.estimate', { time: p.estimate.arrive, updated: p.estimate.updated })
    : null;
  const state: StopLine['state'] = skipped ? 'skipped' : left || s.status === 'done' ? 'left' : arrived ? 'here' : 'next';
  return {
    times: parts.join(' · '),
    delta,
    estimate,
    arriveBy: s.arrive_by && !left ? t('office.timeline.arriveBy', { time: s.arrive_by }) : null,
    current: !!p?.current,
    state,
  };
}
