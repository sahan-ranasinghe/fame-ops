// The calendar's rules (docs/ui-patterns.md §2 and §3), pure: the month grid, the date range picked by two taps (tap the
// start day, then the end day; tap one day twice for a single day), the presets, a page's limit, the week strip's days.
// Dates are Colombo days, YYYY-MM-DD; no time zones here.

/** The day `n` days after `date` (n may be negative). */
export function plusDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Days from a to b (b − a), whole days. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday (the office's week starts on Monday). */
export function weekdayMon(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const mondayOf = (date: string): string => plusDays(date, -weekdayMon(date));

export function monthOf(date: string): { from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return { from: `${date.slice(0, 8)}01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** The first day of the month `n` months after the one that holds `date`. */
export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** The month's grid: weeks of seven cells from Monday; a cell outside the month is null. */
export function monthGrid(anyDayOfMonth: string): (string | null)[][] {
  const { from, to } = monthOf(anyDayOfMonth);
  const cells: (string | null)[] = Array.from({ length: weekdayMon(from) }, () => null);
  for (let d = from; d <= to; d = plusDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The seven days of the week that holds `date` (Monday first). */
export const weekDays = (date: string): string[] => Array.from({ length: 7 }, (_, i) => plusDays(mondayOf(date), i));

// ---------------------------------------------------------------------------
// The range picked on one calendar
// ---------------------------------------------------------------------------

/** The picking state: nothing yet, a start waiting for its end, or a whole range. */
export interface RangeDraft {
  from: string | null;
  to: string | null;
}

/**
 * A tap on a day: the first tap starts a range; the second ends it (an earlier day than the start becomes the new start
 * and the old start the end); tapping the start again picks that single day; a tap after a whole range starts again.
 */
export function tapDay(r: RangeDraft, day: string): RangeDraft {
  if (!r.from || r.to) return { from: day, to: null };
  if (day === r.from) return { from: day, to: day };
  return day < r.from ? { from: day, to: r.from } : { from: r.from, to: day };
}

/** A day's look on the calendar. */
export function dayState(r: RangeDraft, day: string): 'start' | 'end' | 'single' | 'inside' | 'none' {
  if (r.from && r.to && r.from === r.to && day === r.from) return 'single';
  if (day === r.from) return r.to ? 'start' : 'single';
  if (day === r.to) return 'end';
  if (r.from && r.to && day > r.from && day < r.to) return 'inside';
  return 'none';
}

export type PresetKey = 'today' | 'yesterday' | 'last7' | 'this_week' | 'this_month' | 'last_month';
export const PRESETS: readonly PresetKey[] = ['today', 'yesterday', 'last7', 'this_month', 'last_month'];

export function presetRange(key: PresetKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = plusDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: plusDays(today, -6), to: today };
    case 'this_week': return { from: mondayOf(today), to: today };
    case 'this_month': return { from: monthOf(today).from, to: today };
    case 'last_month': return monthOf(plusDays(monthOf(today).from, -1));
  }
}

/** The preset a range is, when it is one (the button names it). */
export function presetOf(r: { from: string; to: string }, today: string, keys: readonly PresetKey[] = PRESETS): PresetKey | null {
  return keys.find((k) => { const p = presetRange(k, today); return p.from === r.from && p.to === r.to; }) ?? null;
}

/** Whether a day may be tapped: not after `max` (e.g. today for history), not before `min`, and within `maxDays` of a start waiting for its end. */
export function dayAllowed(day: string, o: { min?: string; max?: string; maxDays?: number; pending?: string | null }): boolean {
  if (o.max && day > o.max) return false;
  if (o.min && day < o.min) return false;
  if (o.maxDays && o.pending && Math.abs(daysBetween(o.pending, day)) + 1 > o.maxDays) return false;
  return true;
}

/** The range as words: one day, a range in one month, or across months. `names` gives the short weekday and month names. */
export function rangeWords(r: { from: string; to: string }, names: { days: string[]; months: string[] }): string {
  const parts = (d: string) => ({ wd: names.days[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? '', day: Number(d.slice(8, 10)), mon: names.months[Number(d.slice(5, 7)) - 1] ?? '', y: d.slice(0, 4) });
  const a = parts(r.from);
  const b = parts(r.to);
  if (r.from === r.to) return `${a.wd} ${a.day} ${a.mon}`;
  if (a.mon === b.mon && a.y === b.y) return `${a.day}–${b.day} ${b.mon}`;
  return `${a.day} ${a.mon} – ${b.day} ${b.mon}${a.y !== b.y ? ` ${b.y}` : ''}`;
}
