// Office mode (Stage 1, O3 item 3): Tasks → History (list_tasks, the site's TaskHistory) and Load more on the board's
// columns (task_board's column paging, the site's boardPaging), the rules only. Pure: no react-native; the words come
// through `t`, so scripts/test-task-history.ts reads the same fields in both languages.
//
// History: every task that starts in the chosen days (the date range pattern, at most 366 days, Last 7 days at first),
// newest first, narrowed by driver, vehicle, status and kind through the one Filter button, and by the words searched for
// (title, label, driver or plate: the tool's own `search`), 25 at a time with Load more on the cursor. The totals are
// the whole range's (the server counts every task the filters match, not only the page).

import { presetRange } from '@/lib/patterns/calendarLogic';
import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';
import type { Board, BoardCard, HistoryTask, TaskHistory } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

/** list_tasks answers up to 366 days at a time. */
export const HISTORY_MAX_DAYS = 366;
/** A page of the history. */
export const HISTORY_LIMIT = 25;
/** The words typed go to the server this long after the last key. */
export const HISTORY_SEARCH_MS = 500;

export const HISTORY_STATUSES = ['assigned', 'in_progress', 'completed', 'cancelled', 'declined', 'missed'] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];
export const HISTORY_KINDS = ['dispatch', 'self'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** The days shown first: the last 7 days, today included (the site's default is the week). */
export const defaultHistoryRange = (today: string): { from: string; to: string } => presetRange('last7', today);

export interface HistoryChoice {
  driver: string;
  vehicle: string;
  status: HistoryStatus | '';
  kind: HistoryKind | '';
}

/**
 * The Filter sheet's sections (docs/ui-patterns.md §1): the driver and the vehicle (only when their lists came: the
 * person may lack list_drivers or list_vehicles), the status and the kind; each one of a kind with "All" by default.
 */
export function historyFilterDefs(drivers: readonly { username?: string | null; name: string }[], vehicles: readonly { reg_no: string }[], t: Words): FilterDef[] {
  const defs: FilterDef[] = [];
  const people = drivers.filter((d) => !!d.username);
  if (people.length) {
    defs.push({
      key: 'driver', label: t('office.history2.driver'), kind: 'single', default: '',
      options: [{ value: '', label: t('office.history2.allDrivers') }, ...people.map((d) => ({ value: d.username as string, label: d.name }))],
    });
  }
  if (vehicles.length) {
    defs.push({
      key: 'vehicle', label: t('office.history2.vehicle'), kind: 'single', default: '',
      options: [{ value: '', label: t('office.history2.allVehicles') }, ...vehicles.map((v) => ({ value: v.reg_no, label: v.reg_no }))],
    });
  }
  defs.push({
    key: 'status', label: t('office.history2.status'), kind: 'single', default: '',
    options: [{ value: '', label: t('office.history2.allStatuses') }, ...HISTORY_STATUSES.map((s) => ({ value: s, label: t(`office.history.status_${s}`) }))],
  });
  defs.push({
    key: 'kind', label: t('office.history2.kind'), kind: 'single', default: '',
    options: [{ value: '', label: t('office.history2.kind_all') }, ...HISTORY_KINDS.map((k) => ({ value: k, label: t(`office.history2.kind_${k}`) }))],
  });
  return defs;
}

export const emptyHistoryValues = (): FilterValues => ({ driver: '', vehicle: '', status: '', kind: '' });

/** The values chosen, read back (a status or kind the tool does not know is dropped). */
export function historyChoice(v: FilterValues): HistoryChoice {
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  return {
    driver: s('driver'),
    vehicle: s('vehicle'),
    status: (HISTORY_STATUSES as readonly string[]).includes(s('status')) ? (s('status') as HistoryStatus) : '',
    kind: (HISTORY_KINDS as readonly string[]).includes(s('kind')) ? (s('kind') as HistoryKind) : '',
  };
}

export const narrowed = (c: HistoryChoice): boolean => !!(c.driver || c.vehicle || c.status || c.kind);

/** list_tasks' input: the days, a page, and only what was chosen (and the words searched for). */
export function historyArgs(range: { from: string; to: string }, c: HistoryChoice, search: string, cursor?: string): Record<string, unknown> {
  const words = search.trim();
  return {
    from: range.from,
    to: range.to,
    limit: HISTORY_LIMIT,
    ...(c.driver ? { driver: c.driver } : {}),
    ...(c.vehicle ? { vehicle: c.vehicle } : {}),
    ...(c.status ? { status: c.status } : {}),
    ...(c.kind ? { kind: c.kind } : {}),
    ...(words ? { search: words } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** The next page after the ones on screen (a task already shown is not shown twice). */
export function appendHistory(list: TaskHistory, page: TaskHistory): TaskHistory {
  const seen = new Set(list.tasks.map((x) => x.id));
  return { ...list, tasks: [...list.tasks, ...page.tasks.filter((x) => !seen.has(x.id))], next: page.next, total: page.total ?? list.total };
}

const n = (x: number) => x.toLocaleString('en-US');

/** "14 tasks · 9 completed · 2 cancelled · 184 km · 3 driver-started · 1 personal" (the parts that are not zero). */
export function totalsLine(d: Pick<TaskHistory, 'count' | 'total' | 'totals'>, t: Words): string {
  const all = d.total ?? d.count;
  const x = d.totals as TaskHistory['totals'] & { missed?: number };
  return [
    all === 1 ? t('office.history2.tasksOne') : t('office.history2.tasks', { n: n(all) }),
    x.completed ? t('office.history2.completed', { n: n(x.completed) }) : '',
    x.cancelled ? t('office.history2.cancelled', { n: n(x.cancelled) }) : '',
    x.missed ? t('office.history2.missed', { n: n(x.missed) }) : '',
    x.km ? `${n(Math.round(x.km))} km` : '',
    x.driver_started ? t('office.history2.driverStarted', { n: n(x.driver_started) }) : '',
    x.personal ? t('office.history2.personal', { n: n(x.personal) }) : '',
  ].filter(Boolean).join(' · ');
}

/** "Head office → Kurunegala site · 4 stops", "Head office", "" (nothing known). */
export function routeText(x: Pick<HistoryTask, 'from' | 'to' | 'stops_count'>, t: Words): string {
  const line = x.from && x.to ? `${x.from} → ${x.to}` : x.from ?? x.to ?? '';
  return x.stops_count > 2 && line ? `${line} · ${t('office.history2.stopsN', { n: x.stops_count })}` : line;
}

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'muted';
const STATUS_TONE: Record<string, Tone> = { assigned: 'amber', in_progress: 'blue', completed: 'green', cancelled: 'red', declined: 'red', missed: 'red' };
export const historyTone = (status: string): Tone => STATUS_TONE[status] ?? 'muted';

/** The status word's key (office.history.status_*), or null for a status the app has no word for (shown as it came). */
export const statusKey = (status: string): string | null => ((HISTORY_STATUSES as readonly string[]).includes(status) ? `office.history.status_${status}` : null);

/**
 * The second line of a row: the tags (the project label, Driver-started, Personal), then when it ran ("09:10–11:40",
 * "09:10–now") or why it was cancelled, then the km once completed.
 */
export function rowSub(x: Pick<HistoryTask, 'label' | 'kind' | 'purpose' | 'status' | 'started' | 'completed' | 'cancelled_reason' | 'km'>, t: Words): string {
  const hm = (s?: string) => (s ? s.slice(-5) : '');
  const ran = x.status === 'cancelled'
    ? x.cancelled_reason ?? ''
    : x.started ? `${hm(x.started)}–${x.completed ? hm(x.completed) : t('office.history2.now')}` : '';
  return [
    x.label ?? '',
    x.kind === 'self' ? t('office.history2.kind_self') : '',
    x.purpose === 'personal' ? t('office.history2.personalTag') : '',
    ran,
    x.status === 'completed' && typeof x.km === 'number' ? `${n(x.km)} km` : '',
  ].filter(Boolean).join(' · ');
}

/** The empty state's key: the words searched for, the filters, or simply none in these days. */
export function emptyKey(search: string, c: HistoryChoice): 'office.history2.emptySearch' | 'office.history2.emptyFiltered' | 'office.history2.empty' {
  if (search.trim()) return 'office.history2.emptySearch';
  return narrowed(c) ? 'office.history2.emptyFiltered' : 'office.history2.empty';
}

/** The answer on screen is the range asked for (while other days load: the skeleton, never the old days' rows). */
export const sameRange = (d: Pick<TaskHistory, 'from' | 'to'> | null | undefined, r: { from: string; to: string }): boolean => !!d && d.from === r.from && d.to === r.to;

// ---------------------------------------------------------------------------
// The board's columns: Load more (task_board(date, column, limit, cursor) answers that column's next page only)
// ---------------------------------------------------------------------------

/** The cards each column holds at first, and on each Load more. */
export const BOARD_LIMIT = 50;
export type BoardColumn = 'in_progress' | 'assigned' | 'completed';
export const BOARD_COLUMNS: readonly BoardColumn[] = ['in_progress', 'assigned', 'completed'];

/** The pages loaded after the board's first one, per column, and the cursor after them (null: nothing more). */
export interface ColumnMore {
  cards: BoardCard[];
  next: string | null;
}

/** task_board's input for one column's next page. */
export const columnArgs = (date: string, column: BoardColumn, cursor: string): Record<string, unknown> => ({ date, limit: BOARD_LIMIT, column, cursor });

/** A Load more answer added to what the column already loaded (a card already there is not added twice). */
export function addColumnPage(more: ColumnMore | undefined, page: Pick<Board, BoardColumn | 'next'>, column: BoardColumn): ColumnMore {
  const prev = more?.cards ?? [];
  const seen = new Set(prev.map((c) => c.id));
  return { cards: [...prev, ...(page[column] ?? []).filter((c) => !seen.has(c.id))], next: page.next?.[column] ?? null };
}

/**
 * A column as shown: the board's first page (read again every minute) with the pages loaded since, every card once; its
 * total (every card of the column) and the cursor for Load more (none once everything is shown).
 */
export function columnView(b: Pick<Board, BoardColumn | 'totals' | 'next' | 'counts'>, column: BoardColumn, more?: ColumnMore): { cards: BoardCard[]; total: number; next: string | null } {
  const first = b[column] ?? [];
  const seen = new Set(first.map((c) => c.id));
  const cards = more ? [...first, ...more.cards.filter((c) => !seen.has(c.id))] : first;
  const total = b.totals?.[column] ?? b.counts[column] ?? cards.length;
  const next = more ? more.next : b.next?.[column] ?? null;
  return { cards, total, next: cards.length < total ? next : null };
}
