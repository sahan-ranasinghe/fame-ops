// Office mode (Phase 8, O1): Task detail (design 14) and Needs a driver (design 11), the pure rules, tested in
// scripts/test-office.ts: the status pills, the progress steps with their times, the stops planned against what
// happened, Who can take it's arguments, the picked driver, the reassign input, the cancel input, and "leaves in 42 min".

import type { AvailableDriver, Availability, Stop, TaskDetail } from './types';

type Task = TaskDetail['task'];

/**
 * The five steps of design 14 with a time each ("~10:38" = planned, "—" = not yet). Sahan's removals (22 October 2026): the
 * task page no longer draws them as a card (its facts are on the page: dispatchParts below, the stops, the banner); the
 * rule stays for its test until the steps' words (office.task.step_*) go with the next strings merge.
 */
export interface Step {
  key: 'approved' | 'accepted' | 'on_the_way' | 'arrived' | 'done';
  time: string;
  state: 'done' | 'now' | 'todo';
}

export function steps(t: Pick<Task, 'approved_by' | 'sent' | 'accepted' | 'started' | 'completed' | 'status' | 'eta'>, stops: readonly Pick<Stop, 'arrived' | 'status' | 'planned_arrive'>[]): Step[] {
  const firstStop = stops.find((s) => s.status !== 'removed');
  const arrived = stops.find((s) => s.arrived)?.arrived;
  const approvedAt = t.approved_by?.at ?? t.sent ?? '';
  const running = t.status === 'in_progress';
  const done = t.status === 'completed';
  const arrivedPlanned = t.eta?.next ?? firstStop?.planned_arrive;
  return [
    { key: 'approved', time: approvedAt || '—', state: approvedAt ? 'done' : 'todo' },
    { key: 'accepted', time: t.accepted ?? '—', state: t.accepted ? 'done' : t.status === 'assigned' ? 'now' : 'todo' },
    { key: 'on_the_way', time: t.started ?? '—', state: t.started ? (running && !arrived ? 'now' : 'done') : 'todo' },
    { key: 'arrived', time: arrived ?? (running && arrivedPlanned ? `~${arrivedPlanned}` : '—'), state: arrived ? (done ? 'done' : 'now') : 'todo' },
    { key: 'done', time: t.completed ?? '—', state: done ? 'done' : 'todo' },
  ];
}

/** One fact of the task's dispatch on its timeline: the words' key and the time ("2026-10-21 07:24", said with shortWhen). */
export interface DispatchPart {
  key: 'office.task.sentAt' | 'office.task.seenAt' | 'office.line.accepted' | 'office.timeline.left';
  time: string;
}

/**
 * Sahan's removals (22 October 2026): the five-steps card is gone; what it said goes on the task's timeline, its first lines.
 * The approval (by whom, when) with the plan version, as the card's line had them, then "Sent 12:08 · Seen 12:10 · Accepted
 * 12:15" (each only when it happened; the server's "not opened yet" is no time: the banner says it), and "Left 07:31" when
 * no start row on the timeline says it (a task with no start place, or no leave-by on it). Arriving is on each stop's row,
 * done on the banner (the server's "Done 11:40 · 42 km logged").
 */
export function dispatchParts(t: Pick<Task, 'sent' | 'seen' | 'accepted' | 'started'>, startShown: boolean): DispatchPart[] {
  const at = (x: string | undefined): x is string => !!x && /\d{2}:\d{2}$/.test(x);
  const out: DispatchPart[] = [];
  if (at(t.sent)) out.push({ key: 'office.task.sentAt', time: t.sent });
  if (at(t.seen)) out.push({ key: 'office.task.seenAt', time: t.seen });
  if (at(t.accepted)) out.push({ key: 'office.line.accepted', time: t.accepted });
  if (!startShown && at(t.started)) out.push({ key: 'office.timeline.left', time: t.started });
  return out;
}

/** The line above it: "Approved by Palitha · 16:40 · plan v3" (the card's own line, word for word). */
export function approvedParts(t: Pick<Task, 'approved_by' | 'plan_version'>): { approvedBy?: { name: string; at: string }; planVersion?: number } {
  return {
    ...(t.approved_by ? { approvedBy: { name: t.approved_by.name, at: t.approved_by.at } } : {}),
    ...(t.plan_version !== undefined ? { planVersion: t.plan_version } : {}),
  };
}

/** The status pill: the task's status, with "needs a driver" and "missed" as the board says them. */
export function taskStatusKey(t: Pick<Task, 'status' | 'accepted' | 'needs_driver'>): string {
  if (t.needs_driver && t.status !== 'cancelled' && t.status !== 'completed') return 'declined';
  if (t.status === 'assigned' && t.accepted) return 'accepted';
  return t.status;
}

/** "planned 08:30 · left 08:31 · 4 passengers" / "arrive by 10:30 · about 10:38 · 8 min late · 1 h 30 there": the parts. */
export function stopParts(s: Stop, words: {
  planned: (t: string) => string;
  left: (t: string) => string;
  arriveBy: (t: string) => string;
  about: (t: string) => string;
  arrived: (t: string) => string;
  done: (t: string) => string;
  late: (min: number) => string;
  there: (min: number) => string;
  skipped: (why: string) => string;
}): string[] {
  const parts: string[] = [];
  if (s.is_start) {
    if (s.planned_arrive || s.planned_depart) parts.push(words.planned(s.planned_depart ?? s.planned_arrive ?? ''));
    if (s.done) parts.push(words.left(s.done));
    else if (s.arrived) parts.push(words.left(s.arrived));
    return parts;
  }
  if (s.arrive_by) parts.push(words.arriveBy(s.arrive_by));
  if (s.arrived) parts.push(words.arrived(s.arrived));
  else if (s.planned_arrive) parts.push(words.about(s.planned_arrive));
  if (s.status === 'skipped') parts.push(words.skipped(s.skip_reason ?? ''));
  else if (s.done) parts.push(words.done(s.done));
  if (s.dwell_min) parts.push(words.there(s.dwell_min));
  return parts;
}

/** Minutes late at a stop against its arrive-by, from the planned or the actual arrival; 0 when on time or unknown. */
export function stopLateMin(s: Pick<Stop, 'arrive_by' | 'arrived' | 'planned_arrive'>): number {
  const at = s.arrived ?? s.planned_arrive;
  if (!s.arrive_by || !at) return 0;
  const m = (x: string) => {
    const r = /(\d{2}):(\d{2})$/.exec(x);
    return r ? Number(r[1]) * 60 + Number(r[2]) : NaN;
  };
  const d = m(at) - m(s.arrive_by);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** "leaves in 42 min" / "leave-by passed 10 min ago" / null, from the task's day and leave-by (Colombo), for the header. */
export function leaveIn(date: string | undefined, leaveBy: string | undefined, now: number): { key: 'leavesIn' | 'passed'; minutes: number } | null {
  const time = (leaveBy ?? '').match(/\d{2}:\d{2}/)?.[0];
  if (!date || !time) return null;
  const min = Math.round((Date.parse(`${date}T${time}:00+05:30`) - now) / 60_000);
  if (Number.isNaN(min)) return null;
  if (min >= 0) return min < 120 ? { key: 'leavesIn', minutes: min } : null;
  return { key: 'passed', minutes: -min };
}

/** Who can take it: availability at the task's leave-by until its end, for its type and passengers, nearest its first stop. */
export function availabilityArgsForTask(p: Pick<TaskDetail, 'task' | 'stops'>): Record<string, unknown> | null {
  const t = p.task;
  const date = t.date?.trim() ?? '';
  const time = (t.leave_by ?? t.time ?? '').match(/\d{2}:\d{2}/)?.[0] ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) return null;
  const args: Record<string, unknown> = { at: `${date} ${time}` };
  const until = t.end_by?.match(/\d{2}:\d{2}/)?.[0];
  if (until && until > time) args.until = until;
  if (t.vehicle_type_wanted) args.need_type = t.vehicle_type_wanted;
  if (typeof t.passengers === 'number') args.pax = Math.max(0, Math.min(80, t.passengers));
  const first = p.stops.find((s) => s.status !== 'removed' && !s.is_start) ?? p.stops.find((s) => s.status !== 'removed');
  if (first && first.lat !== undefined && first.lng !== undefined) {
    args.lat = first.lat;
    args.lng = first.lng;
  } else if (first?.place) args.first_stop = first.place.slice(0, 160);
  return args;
}

/** The driver picked first: the best match; never the driver who declined it. */
export function firstPickForTask(t: Pick<Task, 'driver' | 'needs_driver'>, avail: Pick<Availability, 'best' | 'drivers'> | null): string {
  if (!avail) return '';
  const declined = t.needs_driver ? t.driver : undefined;
  const best = avail.best?.username ?? avail.drivers.find((d) => d.name === avail.best?.name)?.username ?? '';
  const bestRow = avail.drivers.find((d) => d.username === best);
  if (best && bestRow && bestRow.name !== declined) return best;
  const free = avail.drivers.find((d) => d.free && d.username && d.name !== declined);
  return free?.username ?? '';
}

/** The declined driver's row says so (design 11: "Declined this task · not available"). */
export const declinedThisTask = (t: Pick<Task, 'driver' | 'needs_driver'>, d: Pick<AvailableDriver, 'name'>): boolean =>
  !!t.needs_driver && t.needs_driver.reason === 'declined' && d.name === t.driver;

/** reassign_task's input: the driver, and the vehicle they hold today when known (else the server takes their regular one). */
export function reassignInput(taskId: string, d: Pick<AvailableDriver, 'username' | 'vehicle'>): Record<string, unknown> {
  const input: Record<string, unknown> = { task_id: taskId, driver: d.username };
  if (d.vehicle?.reg_no) input.vehicle = d.vehicle.reg_no;
  return input;
}

/** The cancel reasons' words for the office (the site and Claude read them), whatever the phone's language. */
export const CANCEL_TEXT: Record<'not_needed' | 'plans_changed' | 'no_vehicle' | 'other', string> = { not_needed: 'Not needed any more', plans_changed: 'Plans changed', no_vehicle: 'No vehicle', other: 'Other' };

/** cancel_task's input: the reason's words and the note. */
export function cancelInput(taskId: string, label: string, note: string): { task_id: string; reason: string } {
  return { task_id: taskId, reason: [label, note.trim()].filter(Boolean).join(' — ').slice(0, 300) };
}

/** The driver's plate from "WP CAB-4521 · Toyota HiAce". */
export const plateOf = (vehicle: string | undefined): string => (vehicle ?? '').split(' · ')[0];

/** Which of the page's actions a task still allows: a reassign and a cancel while it is not over. */
export function allowedActions(t: Pick<Task, 'status'>): { reassign: boolean; cancel: boolean } {
  const over = t.status === 'completed' || t.status === 'cancelled' || t.status === 'missed';
  return { reassign: !over && t.status !== 'in_progress', cancel: !over };
}
