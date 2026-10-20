// Office mode (Stage 1, O3 item 1): a driver's previous days, the rules only (pure: no react-native, no i18n). The days:
// today and the 89 before it (90 in all, the server keeps points 90 days); a past day is read once, today every minute;
// the day's tasks (list_tasks for that driver and day, assign_tasks) with their km. The playback is Live's
// (office/liveRouteLogic.ts and components/office/PlaybackBar.tsx): one set of rules, one bar.

import { plusDays } from '@/lib/patterns/calendarLogic';
import type { HistoryTask } from './types';

/** How many days back a driver's history goes (today included): location points are kept 90 days. */
export const HISTORY_DAYS = 90;

/** The first day the day strip offers. */
export const historyMin = (today: string): string => plusDays(today, -(HISTORY_DAYS - 1));

/** A day inside the history window (else today: a link with an old or broken date opens today). */
export function historyDay(asked: string | undefined | null, today: string): string {
  if (!asked || !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return today;
  if (asked > today || asked < historyMin(today)) return today;
  return asked;
}

/** driver_route's input for a day: every stored point (tolerance 0, up to 3,000) and the estimated roads over gaps. */
export function dayRouteArgs(driver: string, date: string): Record<string, unknown> {
  return { driver, date, line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true };
}

/** driver_route's input for the profile's "Today's route" card: today's numbers only (a short line; km, driving and the stops
 *  come from every stored point whatever the line's size). */
export function todaySummaryArgs(driver: string, date: string): Record<string, unknown> {
  return { driver, date, line_tolerance_m: 50, max_line_points: 50 };
}

/** driver_route's input for a task's own window (Start task to Save & finish), the same line as a day. */
export function taskRouteArgs(taskId: string): Record<string, unknown> {
  return { task_id: taskId, line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true };
}

/** Today is read again every minute; a past day once (it does not change). */
export const routeEvery = (date: string, today: string): number | undefined => (date === today ? 60_000 : undefined);

/** list_tasks's input for one driver's day. */
export function dayTasksArgs(driver: string, date: string): Record<string, unknown> {
  return { from: date, to: date, driver, limit: 50 };
}

/** The day's tasks in time order, the cancelled ones last; the km of the finished ones added up. */
export function dayTasks(tasks: readonly HistoryTask[]): { tasks: HistoryTask[]; km: number } {
  const order = (t: HistoryTask) => (t.status === 'cancelled' || t.status === 'declined' ? 1 : 0);
  const sorted = [...tasks].sort((a, b) => order(a) - order(b) || a.time.localeCompare(b.time));
  const km = sorted.reduce((s, t) => s + (t.status === 'completed' && typeof t.km === 'number' ? t.km : 0), 0);
  return { tasks: sorted, km: Math.round(km * 10) / 10 };
}
