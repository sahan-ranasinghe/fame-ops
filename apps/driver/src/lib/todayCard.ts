// Round 4–7, item 12 (design/mockups/2026-10-22, mockups 5 and 6): what the driver's Today card and the running task's
// sheet say, worked out here so scripts/test-driver-3.ts runs it as it is (no React, no phone modules).
//
//   - The chip beside "Next task": "Leave in 25 min" (amber), "Leave now" (amber), "12 min late" (red), another day's
//     task its day (grey: "Tomorrow", "Sat 24 Oct"). Google Maps / Uber's "leave in" line, said once.
//   - The card's stepper: S for where the trip starts (the start stop, else the task's start place), each stop by its
//     number in the order, B for "Back at base" when the trip returns; a time on the right (the plan's: leaving the
//     start, arriving at a stop, back at base). Up to four stops, then "Show all N stops" (Hotfix 2).
//   - "3 people · 197 km" (the passengers' count and the plan's road km), the rows' grey meta line too.
//   - The running sheet: "Next stop · 2 of 3", the stats (km left by road or in a straight line, the time to arrive
//     about, the deadline), the call button's person.

import { colomboDate, colomboTime } from './time';
import { colomboDayDiff, durationText } from './durations';
import { cardStops, planTotals, totalKmText } from './taskPreview';
import type { TaskStop, TaskWithStops } from './types';

/** The app's t() (useApp): a key and its {placeholders}. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const MINUTE_MS = 60_000;

/** A chip's colour: the README's tokens (amber waiting / late soon, red late, blue under way, green done, grey neutral). */
export type ChipTone = 'amber' | 'red' | 'blue' | 'green' | 'grey';
export interface Chip {
  text: string;
  tone: ChipTone;
}

/** When to leave: the plan's leave-by, else the office's start time. */
function leaveAt(task: Pick<TaskWithStops, 'leave_by' | 'start_at'>): string {
  return task.leave_by ?? task.start_at;
}

/**
 * The chip beside "Next task" (a task still to start; none under way). Another day: "Tomorrow" or its day (grey). Today:
 * "Leave in 25 min" while the leave time is ahead, "Leave now" within the minute, then "12 min late" (red).
 */
export function leaveChip(
  t: Translate,
  task: Pick<TaskWithStops, 'status' | 'leave_by' | 'start_at'>,
  now: number,
  dayLabel: (at: string) => string,
): Chip | null {
  // Under way the card's big time says when it started: no chip.
  if (task.status !== 'assigned') return null;
  const leave = leaveAt(task);
  const minutes = Math.round((new Date(leave).getTime() - now) / MINUTE_MS);
  const days = colomboDayDiff(now, leave);
  if (days > 0) return { text: days === 1 ? t('date.tomorrow') : dayLabel(leave), tone: 'grey' };
  if (minutes > 0) return { text: t('todayCard.leaveIn', { time: durationText(t, minutes) }), tone: 'amber' };
  if (minutes >= -1) return { text: t('todayCard.leaveNow'), tone: 'amber' };
  return { text: t('dur.late', { dur: durationText(t, -minutes) }), tone: 'red' };
}

// --- The stepper ----------------------------------------------------------------------------------------------------

export type StepKind = 'start' | 'stop' | 'base';
export interface StepRow {
  key: string;
  kind: StepKind;
  /** "S", "2", "B". */
  mark: string;
  /** The place; for the base row the screen says "Back at base". */
  name: string;
  /** pickup / drop are said after the name ("· pickup"); a visit says nothing. */
  type: 'pickup' | 'drop' | null;
  /** HH:MM (Colombo), or null when the plan has none. */
  time: string | null;
  /** Done or skipped: drawn quieter, with a tick. */
  passed: boolean;
  /** The stop being driven to (a task under way). */
  current: boolean;
  /** A Google place (its credit is shown under the list). */
  google: boolean;
  /** The stop row's id (none for the start place or the base). */
  stopId: string | null;
}

type StepOf = Pick<TaskWithStops, 'task_stops' | 'start_name' | 'leave_by' | 'start_at' | 'return_to_base' | 'plan_json' | 'status' | 'kind'>;

/** The stops still on the task, in order. */
export function orderedStops<S extends Pick<TaskStop, 'status' | 'seq'>>(stops: readonly S[]): S[] {
  return stops.filter((s) => s.status !== 'removed').sort((a, b) => a.seq - b.seq);
}

const isPassed = (s: Pick<TaskStop, 'status'>) => s.status === 'done' || s.status === 'skipped';

/** When the plan has the trip back at base (plan_json.ends_at), HH:MM; else null. */
export function backAtBaseTime(plan: unknown): string | null {
  const ends = plan && typeof plan === 'object' ? (plan as { ends_at?: unknown }).ends_at : null;
  return typeof ends === 'string' && !Number.isNaN(Date.parse(ends)) ? colomboTime(ends) : null;
}

/**
 * The card's rows: S (the start), the stops by number (the first four unless expanded), B (back at base). `hidden` = the
 * stops left out ("Show all N stops").
 */
export function stepperRows(task: StepOf, expanded = false): { rows: StepRow[]; hidden: number; total: number } {
  const stops = orderedStops(task.task_stops);
  const leave = colomboTime(leaveAt(task));
  const hasStartStop = stops.some((s) => s.is_start);
  const running = task.status === 'in_progress';
  const current = running ? stops.find((s) => !isPassed(s)) ?? null : null;
  const { shown, hidden } = cardStops(stops, expanded);
  const rows: StepRow[] = [];
  // The task's own start place (no start stop): where to leave from, as the first row (never on a trip of the driver's own).
  if (!hasStartStop && task.start_name && task.kind !== 'self') {
    rows.push({ key: 'start', kind: 'start', mark: 'S', name: task.start_name, type: null, time: leave, passed: running, current: false, google: false, stopId: null });
  }
  for (const stop of shown) {
    const n = stops.indexOf(stop) + 1;
    const time = stop.is_start
      ? (stop.planned_depart_at ? colomboTime(stop.planned_depart_at) : leave)
      : stop.planned_arrive_at ? colomboTime(stop.planned_arrive_at) : stop.arrive_by ? colomboTime(stop.arrive_by) : null;
    rows.push({
      key: stop.id,
      kind: stop.is_start ? 'start' : 'stop',
      mark: stop.is_start ? 'S' : String(n),
      name: stop.place_name,
      type: stop.type === 'pickup' || stop.type === 'drop' ? stop.type : null,
      time,
      passed: isPassed(stop),
      current: current?.id === stop.id,
      google: !!stop.google_place_id,
      stopId: stop.id,
    });
  }
  if (task.return_to_base) {
    rows.push({ key: 'base', kind: 'base', mark: 'B', name: '', type: null, time: backAtBaseTime(task.plan_json), passed: false, current: false, google: false, stopId: null });
  }
  return { rows, hidden, total: stops.length };
}

/**
 * A row of the card's stepper as the one route stepper draws it (components/patterns/RouteStepper.tsx StepperRow, compact,
 * the time on the right): S / the stop's number / B, the place with "· pickup" / "· drop" (B "Back at base"), the plan's
 * time, the deadline "by 11:00" as the row's amber chip while the stop is still ahead, the stops behind the driver
 * `passed`, the one being driven to `current`, and what a screen reader says for the row.
 */
export interface TodayStep {
  key: string;
  mark: string;
  kind: 'start' | 'stop' | 'back';
  state: 'passed' | 'current' | 'todo';
  title: string;
  time?: string;
  chip: { text: string; tone: 'amber' } | null;
  accessibilityLabel: string;
}

/**
 * The card's stepper rows in the driver's words (stepperRows, then the words). `showAllAfter`: the row "Show all N stops"
 * goes under (the last stop shown, before Back at base), or null when every stop is shown; `google`: the Google credit
 * goes under the list.
 */
export function todaySteps(t: Translate, task: StepOf, expanded = false): { steps: TodayStep[]; showAllAfter: number | null; total: number; google: boolean } {
  const { rows, hidden, total } = stepperRows(task, expanded);
  const deadline = new Map(task.task_stops.map((s) => [s.id, s.arrive_by]));
  const typeWord: Record<'pickup' | 'drop', string> = { pickup: t('todayCard.pickup'), drop: t('todayCard.drop') };
  const lastStop = rows.reduce((at, row, i) => (row.kind !== 'base' ? i : at), -1);
  const steps = rows.map((row): TodayStep => {
    const title = row.kind === 'base' ? t('todayCard.backAtBase') : `${row.name}${row.type ? ` · ${typeWord[row.type]}` : ''}`;
    const by = row.stopId ? deadline.get(row.stopId) : null;
    return {
      key: row.key,
      mark: row.mark,
      kind: row.kind === 'base' ? 'back' : row.kind,
      state: row.passed ? 'passed' : row.current ? 'current' : 'todo',
      title,
      time: row.time ?? undefined,
      chip: by && !row.passed ? { text: t('preview.arriveBy', { time: colomboTime(by) }), tone: 'amber' } : null,
      accessibilityLabel: [row.kind === 'start' ? t('stop.start') : null, title, row.time].filter(Boolean).join(', '),
    };
  });
  return { steps, showAllAfter: hidden > 0 && lastStop >= 0 ? lastStop : null, total, google: rows.some((row) => row.google) };
}

// --- People and km --------------------------------------------------------------------------------------------------

/** "3 people", "1 person"; null for none. */
export function peopleWords(t: Translate, passengers: number | null | undefined): string | null {
  if (passengers == null || passengers <= 0) return null;
  return passengers === 1 ? t('todayCard.onePerson') : t('todayCard.people', { n: passengers });
}

/** The plan's road km as a number to show ("197", "4.2"); null without a plan. */
export function tripKmText(plan: unknown): string | null {
  const { km } = planTotals(plan);
  return km === null || km <= 0 ? null : totalKmText(km);
}

/**
 * A list row's grey line: "2 people · 58 km · From Head office" (the passengers, the plan's road km, then where it starts,
 * or for a trip of the driver's own where it goes); each part only when known.
 */
export function rowMeta(t: Translate, task: Pick<TaskWithStops, 'passengers' | 'plan_json' | 'task_stops' | 'kind'>): string {
  const km = tripKmText(task.plan_json);
  const stops = orderedStops(task.task_stops);
  const place = stops.length === 0 ? null : task.kind === 'self' ? stops[stops.length - 1].place_name : t('today.from', { place: stops[0].place_name });
  return [peopleWords(t, task.passengers), km ? `${km} ${t('common.km')}` : null, place].filter((p): p is string => !!p).join(' · ');
}

/** A list row's chip: In progress (blue), Accepted (green) or Not accepted yet (amber). "Changed" is its own tag. */
export function rowChip(t: Translate, task: Pick<TaskWithStops, 'status' | 'accepted_at'>): Chip | null {
  if (task.status === 'in_progress') return { text: t('todayCard.inProgress'), tone: 'blue' };
  if (task.status !== 'assigned') return null;
  return task.accepted_at ? { text: t('today.accepted'), tone: 'green' } : { text: t('today.notAccepted'), tone: 'amber' };
}

/** The words after the big time: "leave from Head office" (the start stop or start place), else "leave". */
export function leaveFromWords(t: Translate, task: Pick<TaskWithStops, 'task_stops' | 'start_name' | 'kind'>): string {
  const start = orderedStops(task.task_stops).find((s) => s.is_start);
  const place = start?.place_name ?? (task.kind !== 'self' ? task.start_name : null);
  return place ? t('todayCard.leaveFrom', { place }) : t('todayCard.leave');
}

/** "Good morning, Kanishka" by the Colombo hour. */
export function greetingKey(hour: number): string {
  return hour < 12 ? 'todayCard.goodMorning' : hour < 17 ? 'todayCard.goodAfternoon' : 'todayCard.goodEvening';
}

// --- The running task's sheet ---------------------------------------------------------------------------------------

/** "Next stop · 2 of 3": the stop's place in the order (the start counted) and how many there are; null when not on the task. */
export function stopPosition(task: Pick<TaskWithStops, 'task_stops'>, stopId: string | null | undefined): { n: number; total: number } | null {
  if (!stopId) return null;
  const stops = orderedStops(task.task_stops);
  const n = stops.findIndex((s) => s.id === stopId) + 1;
  return n > 0 ? { n, total: stops.length } : null;
}

/** The stop being driven to (the first not done or skipped); null when every stop is behind the driver. */
export function openStop<S extends Pick<TaskStop, 'status' | 'seq'>>(stops: readonly S[]): S | null {
  return orderedStops(stops).find((s) => !isPassed(s)) ?? null;
}

export interface SheetStats {
  /** "42" (by road, approx.) or "≈ 42" (a straight line); null when it can't be said. */
  km: { text: string; kind: 'road' | 'straight' } | null;
  /** HH:MM: the re-estimated arrival when there is one, else the plan's. */
  about: string | null;
  /** HH:MM: the stop's deadline. */
  by: string | null;
}

/** The grey stats box: km left, arrive about, be there by. */
export function sheetStats(
  stop: Pick<TaskStop, 'arrive_by' | 'planned_arrive_at' | 'status'> | null,
  roadKm: number | null,
  straightKm: number | null,
  estimate: string | null,
  kmText: (km: number) => string,
): SheetStats {
  const km = roadKm !== null ? { text: kmText(roadKm), kind: 'road' as const } : straightKm !== null ? { text: `≈ ${kmText(straightKm)}`, kind: 'straight' as const } : null;
  const about = stop && stop.status === 'pending' ? estimate ?? (stop.planned_arrive_at ? colomboTime(stop.planned_arrive_at) : null) : null;
  return { km, about, by: stop?.arrive_by ? colomboTime(stop.arrive_by) : null };
}

/** The day a task starts, for the rows of "Coming up". */
export function isOtherDay(at: string, now: number): boolean {
  return colomboDate(at) !== colomboDate(now);
}
