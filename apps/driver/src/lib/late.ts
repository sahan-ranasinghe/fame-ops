// Part 3b (H4, docs/phase7-plan.md "Part 3b"): Running late and Can't make it. Pure code with no phone modules, so
// scripts/test-asks.ts runs it as it is.
//   - Running late: 10, 15, 30 min or a number (5–180), before or during the task; report_running_late through the offline
//     queue (op task_late; the server keeps the latest report and tells the office); the task then says "You said 15 min
//     late at 08:52" (tasks.late_report_min / late_report_at).
//   - Can't make it: before Start task only, after accepting (before it reads "Can't do this task"): the reasons sheet,
//     decline_task (the existing task_decline op). Never on a trip the driver started.

import { colomboTime } from './time';
import type { TaskWithStops } from './types';

export const LATE_CHOICES = [10, 15, 30] as const;
export const LATE_MIN = 5;
export const LATE_MAX = 180;

/** A typed number of minutes, or null when it is not a whole number from 5 to 180. */
export function lateMinutes(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= LATE_MIN && n <= LATE_MAX ? n : null;
}

type LateTask = Pick<TaskWithStops, 'status' | 'kind'>;

/** Running late: on a dispatched task before it starts or while it runs (not on a trip the driver started). */
export function canReportLate(task: LateTask | null | undefined): boolean {
  return !!task && task.kind !== 'self' && (task.status === 'assigned' || task.status === 'in_progress');
}

/** The decline link before Start task: "Can't make it" once accepted, else "Can't do this task"; none on a self trip or once started. */
export function declineKey(task: Pick<TaskWithStops, 'status' | 'kind' | 'accepted_at'>): 'task.cantMakeIt' | 'task.cantDo' | null {
  if (task.kind === 'self' || task.status !== 'assigned') return null;
  return task.accepted_at ? 'task.cantMakeIt' : 'task.cantDo';
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "You said 15 min late at 08:52", or null when the driver has not said. */
export function lateLine(t: Translate, task: Pick<TaskWithStops, 'late_report_min' | 'late_report_at'>): string | null {
  if (task.late_report_min == null || !task.late_report_at) return null;
  return t('late.lastSaid', { n: task.late_report_min, time: colomboTime(task.late_report_at) });
}

/** The queue's op (sync/engine.ts): report_running_late with the phone's time; id = the task. Every answer is final. */
export interface TaskLateOp {
  kind: 'task_late';
  /** The task's id. */
  id: string;
  /** This report's own id on the phone (the screen hears its answer by it). */
  client_id: string;
  minutes: number;
  at: string;
}

/** report_running_late's answer: 'ok', 'closed' (the task is over) or 'not_yours' (given to someone else): all final. */
export type LateReply = 'ok' | 'closed' | 'not_yours';
