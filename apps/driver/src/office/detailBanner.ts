// Round 4–7, item 12 (the approved mockups 3 and 4): the ONE status banner of a request page and of a task page, pure (the
// screens draw it with components/patterns/StatusBanner.tsx; scripts/test-office-3.ts reads these rules). The tone says the
// state: amber waiting / late, blue on the way, green done / approved, red needs a driver / declined / missed, grey closed.

import type { RequestCard, TaskDetail } from './types';

export type BannerTone = 'blue' | 'green' | 'amber' | 'red' | 'muted';
export type BannerIcon = 'clock' | 'check' | 'x' | 'calendarX' | 'navigation' | 'userX' | 'send' | 'flag';

export interface Banner {
  tone: BannerTone;
  icon: BannerIcon;
  /** What the title says: the request's own words, or the task's state. */
  title: 'waiting' | 'changed' | 'status' | 'onTheWay' | 'needsDriver';
}

/** A request page's banner (the approver's "Waiting for your OK"; the asker's status). */
export function requestBanner(card: Pick<RequestCard, 'status'>, open: boolean, decider: boolean): Banner {
  if (open && card.status === 'changed') return { tone: 'amber', icon: 'clock', title: 'changed' };
  if (open || (card.status === 'waiting' && decider)) return { tone: 'amber', icon: 'clock', title: 'waiting' };
  if (card.status === 'waiting' || card.status === 'changed') return { tone: 'amber', icon: 'clock', title: 'status' };
  if (card.status === 'approved') return { tone: 'green', icon: 'check', title: 'status' };
  if (card.status === 'declined') return { tone: 'red', icon: 'x', title: 'status' };
  if (card.status === 'expired') return { tone: 'muted', icon: 'calendarX', title: 'status' };
  return { tone: 'muted', icon: 'x', title: 'status' };
}

/** A task page's banner: on the way (blue), needs a driver (red), sent / accepted (amber / green), done, missed, cancelled. */
export function taskBanner(task: Pick<TaskDetail['task'], 'status' | 'needs_driver' | 'accepted'>): Banner {
  if (task.needs_driver && task.status !== 'cancelled' && task.status !== 'completed') return { tone: 'red', icon: 'userX', title: 'needsDriver' };
  switch (task.status) {
    case 'in_progress': return { tone: 'blue', icon: 'navigation', title: 'onTheWay' };
    case 'completed': return { tone: 'green', icon: 'check', title: 'status' };
    case 'cancelled': return { tone: 'muted', icon: 'x', title: 'status' };
    case 'missed': return { tone: 'red', icon: 'calendarX', title: 'status' };
    case 'assigned': return task.accepted ? { tone: 'green', icon: 'check', title: 'status' } : { tone: 'amber', icon: 'send', title: 'status' };
    default: return { tone: 'muted', icon: 'flag', title: 'status' };
  }
}

/** The late chip of a running task: the driver's own "Running late" wins, else the ETA's minutes late. */
export function lateMinutes(task: Pick<TaskDetail['task'], 'status' | 'eta' | 'late_report'>): number | null {
  if (task.status !== 'in_progress' || task.late_report) return null;
  return task.eta?.late_min && task.eta.late_min > 0 ? task.eta.late_min : null;
}

/**
 * The task page's bottom bar (Uber for Business and Samsara's trip page: the two jobs done most often on the bar, the rest
 * under ⋯ More). Order of use for an office person on a live trip: give it a driver when it needs one, then change the
 * task (the time), then another driver, change the stops, swap the vehicle, reopen; Cancel task under ⋯ (rare and
 * destructive). Returns the bar's two and the rest in order. A bar would never hold ⋯ More alone: with none of the first
 * jobs allowed, one or two others go on the bar themselves (no ⋯), three put the first (the most used: the driven route)
 * on the bar and the rest under ⋯.
 */
export type TaskAction = 'giveDriver' | 'time' | 'reassign' | 'stops' | 'swap' | 'reopen' | 'cancel' | 'route' | 'plan';
export function taskActions(may: Partial<Record<TaskAction, boolean>>, needsDriver: boolean): { bar: TaskAction[]; more: TaskAction[] } {
  const order: TaskAction[] = needsDriver
    ? ['giveDriver', 'time', 'stops', 'swap', 'reopen']
    : ['time', 'reassign', 'stops', 'swap', 'reopen'];
  const allowed = order.filter((a) => (a === 'giveDriver' ? may.reassign : may[a]));
  const bar = allowed.slice(0, 2);
  const more = [...allowed.slice(2), ...(['route', 'plan', 'cancel'] as const).filter((a) => may[a])];
  if (bar.length === 0) return more.length <= 2 ? { bar: more, more: [] } : { bar: more.slice(0, 1), more: more.slice(1) };
  return { bar, more };
}
