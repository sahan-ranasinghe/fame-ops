// The steps the RouteStepper draws (Part B design pass, docs/design-pass.md §4.5), from what the server sends: a plan's
// timeline (Review, a request still to drive: plan_task / the request's trip) and a task's stops with their progress
// (task_detail: the live part, stopTimelineLogic.ts). The start is always S, the stops 1…n in order, the way back B; the
// leg to the next step travels with the step before it. Pure (scripts/test-steps.ts).

import type { Step, StepState } from '@/components/patterns/RouteStepper';
import { stopLine } from './stopTimelineLogic';
import { legTextT, stopTimesT } from './trip/words';
import type { Stop, TimelineItem } from './types';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "Pickup · People", "Drop-off", "Visit": a stop's type and what it is for, in words. */
export function stopType(t: T, type?: string, what?: string): string | undefined {
  const kind = type && ['pickup', 'drop', 'visit'].includes(type) ? t(`office.trip.type_${type}`) : undefined;
  const why = what && ['people', 'goods', 'documents', 'other'].includes(what) ? t(`office.trip.what_${what}`) : undefined;
  return [kind, why].filter(Boolean).join(' · ') || undefined;
}

/**
 * A plan's timeline as steps (nothing driven yet: every step still to come). `reached`: stops already behind a task whose
 * stops are being changed (their numbers stay); `startName`: where the trip starts when no stop is the start;
 * `back`: the way back to base with its time and a line under it ("Back by 17:00", "Vehicle free by 17:00").
 */
export function planSteps(t: T, items: readonly TimelineItem[], o: { reached?: number; startName?: string; back?: BackWay } = {}): Step[] {
  const steps: Step[] = [];
  const leave = items.find((x) => x.kind === 'leave');
  for (const x of items) {
    if (x.kind === 'leg') {
      if (x.from_n === 'start' && !steps.length) {
        steps.push({ key: 'start', mark: 'S', state: 'todo', place: o.startName || t('office.trip.rowTheStart'), time: leave?.kind === 'leave' ? leave.at : undefined, times: leave?.kind === 'leave' ? t('office.trip.rowLeave', { time: leave.at }) : undefined });
      }
      const prev = steps[steps.length - 1];
      if (prev) prev.legAfter = [legTextT(t, x, o.startName), x.rush_factor && x.rush_factor !== 1 ? t('office.trip.rushHour', { f: x.rush_factor }) : '', x.via_expressway ? t('office.trip.viaExpressway') : ''].filter(Boolean).join(' · ');
      continue;
    }
    if (x.kind !== 'stop') continue;
    const late = x.late_min != null && x.late_min > 0;
    steps.push({
      key: x.is_start ? 'start' : `stop-${x.n}`,
      mark: x.is_start ? 'S' : String(x.n + (o.reached ?? 0)),
      state: 'todo',
      place: x.place,
      time: x.is_start ? x.planned_leave : x.planned_arrive,
      times: stopTimesT(t, x),
      delta: x.arrive_by ? { text: late ? t('office.task.minLate', { min: x.late_min ?? 0 }) : t('office.trip.onTime'), tone: late ? 'late' : 'ok' } : undefined,
      note: x.arrive_by ? t('office.request.arriveBy', { time: x.arrive_by }) : undefined,
    });
  }
  if (o.back && steps.length) steps.push(backStep(t, o.back));
  return steps;
}

/** The way back to base: where, the planned time, a line under it ("Back by 17:00", "About 15:40"). */
export interface BackWay {
  place: string;
  time?: string;
  line?: string;
}

function backStep(t: T, back: BackWay & { state?: StepState }): Step {
  return { key: 'back', mark: 'B', state: back.state ?? 'todo', place: t('office.request.backAt', { place: back.place }), time: back.time, times: back.line || undefined };
}

/**
 * A task's stops as steps, with what happened (task_detail's stops[].progress): left = done, at the stop = here, the one
 * being driven to = next, skipped, else still to come. `started`: the task is under way or over (else every step is still
 * to come). `start`: the start when no stop is it ("Left 07:06" once started); `back`: the way back to base.
 */
export function taskSteps(t: T, stops: readonly Stop[], o: { started: boolean; start?: { place: string; planned?: string; left?: string }; back?: BackWay }): Step[] {
  const steps: Step[] = [];
  if (o.start && !stops.some((s) => s.is_start)) {
    steps.push({
      key: 'start',
      mark: 'S',
      state: o.start.left ? 'done' : 'todo',
      place: o.start.place,
      time: o.start.planned,
      actual: o.start.left,
      times: [o.start.planned ? t('office.task.planned', { time: o.start.planned }) : '', o.start.left ? t('office.task.left', { time: o.start.left }) : ''].filter(Boolean).join(' · ') || undefined,
    });
  }
  for (const s of stops) {
    const line = stopLine(s, t);
    const planned = s.progress?.planned_arrive ?? s.planned_arrive;
    const plannedText = planned ? t('office.timeline.planned', { time: planned }) : '';
    // The planned time is the step's time column: the line keeps what happened (arrived, left, skipped).
    const happened = line.times.split(' · ').filter((x) => x && x !== plannedText).join(' · ');
    const state: StepState = !o.started ? 'todo'
      : line.state === 'left' ? 'done'
      : line.state === 'skipped' ? 'skipped'
      : line.state === 'here' ? 'here'
      : line.current ? 'next' : 'todo';
    steps.push({
      key: s.id ?? `stop-${s.seq}`,
      mark: s.is_start ? 'S' : String(s.n ?? s.seq),
      state,
      place: s.place || s.address || s.label || '',
      type: stopType(t, s.type, s.what),
      time: planned,
      actual: s.progress?.arrived ?? s.arrived,
      times: happened || undefined,
      delta: line.delta ? { text: line.delta.text, tone: line.delta.tone === 'late' ? 'late' : 'ok' } : undefined,
      note: line.estimate ?? line.arriveBy ?? line.confirmed ?? undefined,
      noteTone: line.estimate ? 'blue' : 'muted',
    });
  }
  if (o.back) {
    const allLeft = o.started && stops.length > 0 && stops.every((s) => s.status === 'done' || s.status === 'skipped');
    steps.push(backStep(t, { ...o.back, state: allLeft ? 'next' : 'todo' }));
  }
  return steps;
}
