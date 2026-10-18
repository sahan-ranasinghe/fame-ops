// Hotfix 3 (L6, docs/phase7-plan.md "Hotfix 3"): nothing on Today grows without limit. Pure (no React), so
// scripts/test-lists.ts runs it.
//
//   - Today: the next task's card, then at most TODAY_LATER (3) later ones (later today first, then coming up), then the
//     row "All today's tasks" with "{n} more later today" when Today leaves some out (app/today-tasks.tsx lists them all).
//   - The lists that grow (Report's my reports, Fuel's fills, the Mileage tab's tasks, the all-tasks list) show PAGE (20)
//     rows, then "Load more" with "Showing {n} of {total}": first the rows the phone holds, then (my reports) the
//     server's older ones, PAGE at a time. Offline the phone's rows, PAGE at a time.
//   - A missed task (Hotfix 3 L2: never started, its leave-by over a day ago; tasks.status 'missed') is shown nowhere.
//     The phone's own copy not read again yet (offline) is judged by the server's rule (mark_missed_tasks()). A start
//     already saved on the phone made the copy in_progress, so it stays (the server takes that start and un-misses it).

import { colomboDate } from './time';
import type { TaskWithStops } from './types';

/** Rows a growing list shows at a time. */
export const PAGE = 20;
/** Tasks Today shows after the next task's card. */
export const TODAY_LATER = 3;
/** A task never started is missed this long after its leave-by (the server's rule). */
export const MISSED_AFTER_MS = 24 * 60 * 60 * 1000;

type TaskTimes = Pick<TaskWithStops, 'status' | 'leave_by' | 'start_at'>;

/** Missed on the server, or a copy on the phone that the server's rule would have marked missed by now. */
export function isMissed(task: TaskTimes, now: number): boolean {
  if (task.status === 'missed') return true;
  if (task.status !== 'assigned' && task.status !== 'declined') return false;
  const at = Date.parse(task.leave_by ?? task.start_at);
  return Number.isFinite(at) && at < now - MISSED_AFTER_MS;
}

/** The tasks any screen may show: every one but the missed. */
export function visibleTasks<T extends TaskTimes>(tasks: readonly T[], now: number): T[] {
  return tasks.filter((task) => !isMissed(task, now));
}

export interface TodayLists<T> {
  /** The task under way, if any. */
  running: T | undefined;
  /** The card: the task under way, else the first one still to start. */
  next: T | undefined;
  /** Every task still to start after the card's, today (and any earlier one not missed yet) … */
  laterToday: T[];
  /** … and on later days ("Coming up"). */
  upcoming: T[];
  /** What Today shows of them: at most TODAY_LATER together, in order. */
  shownToday: T[];
  shownUpcoming: T[];
  /** Later-today tasks Today leaves out: "{n} more later today". */
  moreToday: number;
  /** Today shows the row "All today's tasks" when there is a task after the card. */
  allRow: boolean;
  /** The all-tasks list: the card's task and every later one, today's first (the running one on top), then coming up. */
  all: T[];
  /** How many of `all` are today's (the rest come under "Coming up"). */
  allToday: number;
}

export function todayLists<T extends TaskTimes>(tasks: readonly T[], now: number, max = TODAY_LATER): TodayLists<T> {
  const visible = visibleTasks(tasks, now);
  const running = visible.find((task) => task.status === 'in_progress');
  const assigned = visible.filter((task) => task.status === 'assigned').sort((a, b) => a.start_at.localeCompare(b.start_at));
  const next = running ?? assigned[0];
  const rest = assigned.filter((task) => task !== next);
  const today = colomboDate(now);
  const isToday = (task: T) => colomboDate(task.start_at) <= today;
  const laterToday = rest.filter(isToday);
  const upcoming = rest.filter((task) => !isToday(task));
  const shownToday = laterToday.slice(0, max);
  const shownUpcoming = upcoming.slice(0, Math.max(0, max - shownToday.length));
  const todays = [...(running ? [running] : []), ...assigned.filter(isToday)];
  return {
    running,
    next,
    laterToday,
    upcoming,
    shownToday,
    shownUpcoming,
    moreToday: laterToday.length - shownToday.length,
    allRow: rest.length > 0,
    all: [...todays, ...assigned.filter((task) => !isToday(task))],
    allToday: todays.length,
  };
}

// --- Load more ------------------------------------------------------------------------------------------------------

export interface PageInfo {
  /** Rows on screen. */
  n: number;
  /** Rows in all: the ones the phone holds plus the server's older ones, when known. */
  total: number;
  /** "Load more" is offered. */
  more: boolean;
}

/** "Showing {n} of {total}" for a list showing `shown` rows of the `held` ones, with `remaining` more on the server (null: not known). */
export function pageInfo(shown: number, held: number, remaining: number | null = null): PageInfo {
  const n = Math.min(Math.max(0, shown), held);
  const total = held + Math.max(0, remaining ?? 0);
  return { n, total, more: n < total };
}

/** "Load more": PAGE rows more; the server is asked when the phone holds fewer than that and the server has more. */
export function loadMore(shown: number, held: number, remaining: number | null, page = PAGE): { shown: number; fetch: boolean } {
  const target = Math.min(shown, held) + page;
  return { shown: target, fetch: target > held && (remaining ?? 0) > 0 };
}

/** The rows a list shows: the first `shown`. */
export function windowOf<T>(rows: readonly T[], shown: number): T[] {
  return rows.slice(0, Math.max(0, shown));
}

// --- My reports, from the server PAGE at a time -----------------------------------------------------------------------

export interface Dated {
  id: string;
  created_at: string;
}

/** Where the server's next page starts: below the oldest row held. */
export interface Cursor {
  created_at: string;
  id: string;
}

const time = (at: string) => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
};

/** Newest first, the same order as the server's (created_at, then id, both descending). */
export function newestFirst(a: Dated, b: Dated): number {
  return time(b.created_at) - time(a.created_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Lists of rows as one, newest first; a row in more than one list is taken from the first list that has it. */
export function mergeNewest<T extends Dated>(...lists: readonly (readonly T[])[]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const row of list) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort(newestFirst);
}

/** The oldest row held (the server's next page starts below it); null when the phone holds none. */
export function oldestOf(rows: readonly Dated[]): Cursor | null {
  let oldest: Dated | null = null;
  for (const row of rows) if (!oldest || newestFirst(row, oldest) > 0) oldest = row;
  return oldest ? { created_at: oldest.created_at, id: oldest.id } : null;
}
