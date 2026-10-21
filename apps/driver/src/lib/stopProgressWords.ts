// Round 2 (21 October 2026): a stop's progress in the driver's words, from lib/stopProgress.ts (the shared rule):
// "Planned 10:30 · Arrived 10:52 · Left 11:40", the arrival against the plan ("22 min late" in amber, "8 min early" or
// "on time" in green), and for a stop still to come once something was confirmed "about 12:10". Pure (scripts/test-stop-slides.ts).

import { deltaKind, type StopProgress } from './stopProgress';
import { colomboTime } from './time';

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface ProgressWords {
  /** "Planned 10:30 · Arrived 10:52 · Left 11:40", or '' when there is nothing to say. */
  line: string;
  /** The arrival against the plan; late = amber, early / on time = green. */
  delta: { text: string; late: boolean } | null;
  /** "about 12:10" for a stop still to come, from the re-estimate. */
  about: string | null;
}

/**
 * `corrected` (Round 2b): the driver undid this stop's Arrived and marked it again (lib/stopCorrections.ts): "Arrived 10:52 ·
 * corrected". Only while the stop is Arrived.
 */
export function progressWords(t: T, p: StopProgress | undefined, corrected = false): ProgressWords {
  if (!p) return { line: '', delta: null, about: null };
  // Round 2b: a stop driven past and confirmed later: its times from the location points, or "Visited · time not recorded".
  const line = [
    p.planned_arrive ? t('task.progress.planned', { time: colomboTime(p.planned_arrive) }) : null,
    p.time_not_recorded ? t('task.progress.timeNotRecorded') : null,
    p.arrived ? t('task.progress.arrived', { time: colomboTime(p.arrived) }) : null,
    p.arrived && corrected ? t('task.progress.corrected') : null,
    p.left ? t('task.progress.left', { time: colomboTime(p.left) }) : null,
    p.confirmed_later ? t('task.progress.confirmedLater') : null,
  ].filter(Boolean).join(' · ');
  const kind = deltaKind(p.arrived ? p.arrive_delta_min : null);
  const delta = kind
    ? {
      text: kind.kind === 'late' ? t('task.progress.late', { n: kind.min }) : kind.kind === 'early' ? t('task.progress.early', { n: kind.min }) : t('task.progress.onTime'),
      late: kind.kind === 'late',
    }
    : null;
  const about = p.estimate && !p.arrived ? t('task.progress.about', { time: colomboTime(p.estimate.arrive) }) : null;
  return { line, delta, about };
}

/** The next stop's "about HH:MM" for a card (Today): the first stop still to reach, when it has an estimate. */
export function nextAbout(progress: readonly StopProgress[]): { id: string; time: string } | null {
  const p = progress.find((x) => !x.arrived && !x.left && !x.time_not_recorded);
  return p?.estimate ? { id: p.id, time: colomboTime(p.estimate.arrive) } : null;
}
