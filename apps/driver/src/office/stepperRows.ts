// Round 4–7, item 12 (the approved mockups 2–4; item 11's rules): a trip's rows for the route stepper
// (components/patterns/RouteStepper.tsx), pure, so the scripts read them (scripts/test-office-3.ts). Two sources:
// - the plan (Review, the request page, the plan screen): plan_task's / task_detail's timeline items: the start (S) at the
//   leave time, each stop with its planned arrival, ONE meta line (the stay, the leave time, the arrive-by deadline) and its
//   chip (on time / N min late against the deadline), each leg as the short line under the stop before it ("99 km ·
//   2 h 23 min"; via the expressway kept there), and Back at base (B) at the end time;
// - a request's own rows (approveLogic.ts tripView: no timeline yet, the stops as asked);
// - the plan screen (task/[id]/plan.tsx, Round 4–7 unify: one stepper in the app): the same timeline in the screen's own
//   words, in full (timelineRows): each stop's times as a sentence, each leg with its source; that screen has no ⓘ.
// The explanations (where the leave time came from, each leg's source, the rush-hour factor) are not in planRows' rows: they
// go to the ⓘ sheet (planNotes) so nothing the plan says is lost.

import type { TimelineItem } from './types';

export type MetaIcon = 'stay' | 'leave' | 'by' | 'people' | 'next';
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'muted';

export interface PlanMeta { icon?: MetaIcon; text: string; tone?: Tone | 'ink'; mono?: boolean }

export interface PlanRow {
  key: string;
  mark: string;
  kind: 'start' | 'stop' | 'back';
  time?: string;
  title: string;
  titleLines?: 1 | 2;
  chip?: { text: string; tone: Tone } | null;
  meta?: PlanMeta[];
  /** A sentence under the row, wrapped (the plan screen's times in words). */
  words?: string;
  leg?: string;
}

export interface PlanWords {
  /** "1 h stay" (with "usual here" when the place's own time was used). */
  stay: (dur: string, usual: boolean) => string;
  leave: (time: string) => string;
  by: (time: string) => string;
  passengersHere: string;
  onTime: string;
  late: (min: number) => string;
  km: (km: number) => string;
  dur: (min: number) => string;
  expressway: string;
  /** The start's name when the plan does not give one. */
  theStart: string;
  backAt: (place: string) => string;
}

/** "99 km · 2 h 23 min" (· via the expressway). */
export function legShort(l: Extract<TimelineItem, { kind: 'leg' }>, w: Pick<PlanWords, 'km' | 'dur' | 'expressway'>): string {
  return [w.km(Math.round(l.km * 10) / 10), w.dur(l.minutes), l.via_expressway ? w.expressway : ''].filter(Boolean).join(' · ');
}

/**
 * The plan's rows. `offset`: the stops already reached (a running task's Change stops keeps their numbers). `back`: Back at
 * base when the trip returns (the end time, the start's name, an optional meta line such as "back by 18:00").
 */
export function planRows(items: readonly TimelineItem[], o: { startName?: string; offset?: number; back?: { time?: string; place: string; meta?: string } | null }, w: PlanWords): PlanRow[] {
  const rows: PlanRow[] = [];
  const hasStartStop = items.some((x) => x.kind === 'stop' && x.is_start);
  for (const x of items) {
    if (x.kind === 'leave') {
      if (!hasStartStop) rows.push({ key: 'leave', mark: 'S', kind: 'start', time: x.at, title: o.startName || w.theStart });
      continue;
    }
    if (x.kind === 'leg') {
      const last = rows[rows.length - 1];
      if (last) last.leg = legShort(x, w);
      continue;
    }
    if (x.is_start) {
      rows.push({ key: `s${x.n}`, mark: 'S', kind: 'start', time: x.planned_leave || x.planned_arrive, title: x.place || o.startName || w.theStart, meta: [{ icon: 'people', text: w.passengersHere }] });
      continue;
    }
    const late = x.late_min != null && x.late_min > 0;
    const meta: PlanMeta[] = [{ icon: 'stay', text: w.stay(w.dur(Math.max(0, x.dwell_min)), x.dwell_source === 'place') }];
    if (x.planned_leave) meta.push({ icon: 'leave', text: w.leave(x.planned_leave) });
    if (x.arrive_by) meta.push({ icon: 'by', text: w.by(x.arrive_by) });
    rows.push({
      key: `s${x.n}`,
      mark: String(x.n + (o.offset ?? 0)),
      kind: 'stop',
      time: x.planned_arrive,
      title: x.place || x.label,
      chip: x.arrive_by ? (late ? { text: w.late(x.late_min ?? 0), tone: 'amber' } : { text: w.onTime, tone: 'green' }) : null,
      meta,
    });
  }
  if (o.back) rows.push({ key: 'back', mark: 'B', kind: 'back', time: o.back.time, title: w.backAt(o.back.place), meta: o.back.meta ? [{ text: o.back.meta }] : undefined });
  return rows;
}

/**
 * What the ⓘ sheet says about a plan: where the leave time came from, and each leg in full ("From Head office · 42 km ·
 * 1 h 5 min · Google traffic · rush hour ×1.3"): the words the screens showed before item 12, nothing new.
 */
export function planNotes(items: readonly TimelineItem[], leaveLine: string | null, legLine: (l: Extract<TimelineItem, { kind: 'leg' }>) => string): string[] {
  const out: string[] = [];
  if (leaveLine) out.push(leaveLine);
  for (const x of items) if (x.kind === 'leg') out.push(legLine(x));
  return out;
}

type StopItem = Extract<TimelineItem, { kind: 'stop' }>;
type LegItem = Extract<TimelineItem, { kind: 'leg' }>;

/** The plan screen's words (task/[id]/plan.tsx: office/trip/words.ts stopTimesT / legTextT and its keys). */
export interface TimelineWords {
  /** "Leave by". */
  leaveBy: string;
  /** "Arrive 10:40 · 1 h · Leave 11:40" (the start: "Leave 08:35 · Passengers get in here"). */
  stopTimes: (x: StopItem) => string;
  arriveBy: (time: string) => string;
  onTime: string;
  late: (min: number) => string;
  /** The leg in full: "From Head office · 42 km · 1 h 5 min · Google traffic" (· via the expressway). */
  leg: (x: LegItem) => string;
}

/**
 * A task's plan as the plan screen shows it, on the route stepper: the leave time (S, "Leave by"), each stop by its number
 * with its planned arrival on the left, the server's label ("Stop 2 · Drop · Kurunegala site"), the on time / N min late
 * chip against its deadline, its times in words under it ("Arrive 10:40 · 1 h · Leave 11:40 · Arrive by 11:00"), and each
 * leg in full under the row before it (from the start under S, the drive back under the last stop): every word the screen
 * said before the stepper, nothing new. The server's timeline opens with the leave time (tasks.ts planTimeline).
 */
export function timelineRows(items: readonly TimelineItem[], w: TimelineWords): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const x of items) {
    if (x.kind === 'leave') {
      rows.push({ key: 'leave', mark: 'S', kind: 'start', time: x.at, title: w.leaveBy });
      continue;
    }
    if (x.kind === 'leg') {
      const text = w.leg(x);
      const last = rows[rows.length - 1];
      if (!last) rows.push({ key: 'leave', mark: 'S', kind: 'start', title: w.leaveBy, leg: text });
      else last.leg = last.leg ? `${last.leg}\n${text}` : text;
      continue;
    }
    const late = x.late_min != null && x.late_min > 0;
    rows.push({
      key: `s${x.n}`,
      mark: String(x.n),
      kind: 'stop',
      time: x.planned_arrive,
      title: x.label || x.place,
      titleLines: 2,
      chip: x.arrive_by ? (late ? { text: w.late(x.late_min ?? 0), tone: 'amber' } : { text: w.onTime, tone: 'green' }) : null,
      words: [w.stopTimes(x), x.arrive_by ? w.arriveBy(x.arrive_by) : ''].filter(Boolean).join(' · '),
    });
  }
  return rows;
}

/** A request's rows as approveLogic's tripView gives them (S / numbered / B, the place, its parts in words). */
export function requestRows(rows: readonly { kind: 'start' | 'stop' | 'back'; mark: string; place: string; parts: string[]; time?: string }[]): PlanRow[] {
  return rows.map((r, i) => ({ key: `${r.mark}-${i}`, mark: r.mark, kind: r.kind, time: r.time, title: r.place, meta: r.parts.length ? [{ text: r.parts.join(' · ') }] : undefined }));
}
