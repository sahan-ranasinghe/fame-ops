// Part 3b (H1, docs/phase7-plan.md "Part 3b"): Me → Availability, when the driver can't take trips (not HR leave: it only
// tells dispatch). Pure code with no phone modules, so scripts/test-asks.ts runs it as it is.
//   - the list: the driver's own entries ahead (driver_unavailability, ends after now, not removed), soonest first, in
//     words: "Tue 20 Oct · until 13:00 · Half day", and "Added by Palitha" when the office added it;
//   - the form: a day (and a last day for full days), when (full day · morning until the split · afternoon from the
//     split · from–to), the reason, a note → set_my_unavailability (online; a refusal comes back in words).

import { addDays, colomboDate, colomboTime } from './time';

export type AvailPart = 'full_day' | 'morning' | 'afternoon' | 'hours';
export type AvailReason = 'leave' | 'half_day' | 'personal' | 'other';
export const AVAIL_PARTS: AvailPart[] = ['full_day', 'morning', 'afternoon', 'hours'];
export const AVAIL_REASONS: AvailReason[] = ['leave', 'half_day', 'personal', 'other'];
/** The server takes at most 31 days in one entry. */
export const MAX_DAYS = 31;
/** The days the form offers as buttons. */
export const DAYS_AHEAD = 60;

/** The columns the phone reads (the driver reads their own rows). */
export interface UnavailabilityRow {
  id: string;
  starts_at: string;
  ends_at: string;
  part: string;
  reason: string;
  note: string | null;
  created_by_name: string;
  created_by_employee_id: string | null;
  channel: string;
  removed_at?: string | null;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function partKey(part: string): string {
  return part === 'morning' ? 'avail.morning' : part === 'afternoon' ? 'avail.afternoon' : part === 'hours' ? 'avail.hours' : 'avail.full';
}

export function reasonKey(reason: string): string {
  return reason === 'half_day' ? 'avail.halfDay' : reason === 'personal' ? 'avail.personal' : reason === 'other' ? 'avail.other' : 'avail.leave';
}

/** The entries still ahead (or running now), soonest first; removed ones never. */
export function upcomingEntries<R extends UnavailabilityRow>(rows: R[], now: number): R[] {
  return rows
    .filter((row) => !row.removed_at && Date.parse(row.ends_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** The last day of an entry (it ends at the start of the next day for full days). */
function lastInstant(row: Pick<UnavailabilityRow, 'ends_at'>): Date {
  return new Date(Date.parse(row.ends_at) - 1);
}

/** Whether a full-day entry runs over more than one day. */
export function severalDays(row: Pick<UnavailabilityRow, 'starts_at' | 'ends_at'>): boolean {
  return colomboDate(row.starts_at) !== colomboDate(lastInstant(row));
}

/**
 * The entry in words: "Tue 20 Oct · full day · Leave", "Tue 20 Oct – Fri 23 Oct · Leave", "Tue 20 Oct · until 13:00 · Half
 * day", "Tue 20 Oct · from 13:00 · Personal", "Tue 20 Oct · 10:00–12:00 · Other". `dayLabel` reads a day in the
 * driver's language ("Tue 20 Oct", digits Latin).
 */
export function availLine(t: Translate, dayLabel: (at: Date | string) => string, row: UnavailabilityRow): string {
  const day = dayLabel(row.starts_at);
  let when: string;
  if (row.part === 'morning') when = t('avail.lineMorning', { day, time: colomboTime(row.ends_at) });
  else if (row.part === 'afternoon') when = t('avail.lineAfternoon', { day, time: colomboTime(row.starts_at) });
  else if (row.part === 'hours') when = t('avail.lineHours', { day, from: colomboTime(row.starts_at), to: colomboTime(row.ends_at) });
  else when = severalDays(row) ? t('avail.lineDays', { day, last: dayLabel(lastInstant(row)) }) : t('avail.lineFull', { day });
  return `${when} · ${t(reasonKey(row.reason))}`;
}

/** Who added the entry, when it was not the driver ("Added by Palitha"); null for the driver's own. */
export function addedByOther(row: Pick<UnavailabilityRow, 'channel' | 'created_by_employee_id' | 'created_by_name'>, meId: string | null): string | null {
  const mine = row.channel === 'driver' && (row.created_by_employee_id === null || row.created_by_employee_id === meId);
  return mine ? null : row.created_by_name;
}

// --- The form ----------------------------------------------------------------------------------------------------------

export interface AvailForm {
  /** The day (YYYY-MM-DD, Colombo). */
  from: string;
  /** The last day of several full days (null = one day). */
  to: string | null;
  part: AvailPart;
  /** From–to: HH:MM. */
  start: string;
  end: string;
  reason: AvailReason;
  note: string;
}

export function newAvailForm(today: string): AvailForm {
  return { from: today, to: null, part: 'full_day', start: '', end: '', reason: 'leave', note: '' };
}

/** The form for changing an entry. */
export function formFromRow(row: UnavailabilityRow): AvailForm {
  const part = (AVAIL_PARTS as string[]).includes(row.part) ? (row.part as AvailPart) : 'full_day';
  const reason = (AVAIL_REASONS as string[]).includes(row.reason) ? (row.reason as AvailReason) : 'other';
  return {
    from: colomboDate(row.starts_at),
    to: part === 'full_day' && severalDays(row) ? colomboDate(lastInstant(row)) : null,
    part,
    start: part === 'hours' ? colomboTime(row.starts_at) : '',
    end: part === 'hours' ? colomboTime(row.ends_at) : '',
    reason,
    note: row.note ?? '',
  };
}

/** "9:00", "09.00", "0900" → "09:00"; anything else null. */
export function validTime(text: string): string | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** set_my_unavailability's arguments (null where the entry has nothing). */
export interface AvailArgs {
  p_id: string | null;
  p_from: string;
  p_to: string | null;
  p_part: AvailPart;
  p_start: string | null;
  p_end: string | null;
  p_reason: AvailReason;
  p_note: string | null;
}

/**
 * What the form sends, or the problem in words: from–to needs two times, the second after the first. The last day only
 * for full days, and only when it is after the first day (at most 31 days); the server checks the rest (a day that has
 * passed) and says so in words.
 */
export function availArgs(form: AvailForm, id: string | null): { args: AvailArgs } | { problem: 'common.badTime' } {
  let start: string | null = null;
  let end: string | null = null;
  if (form.part === 'hours') {
    start = validTime(form.start);
    end = validTime(form.end);
    if (!start || !end || end <= start) return { problem: 'common.badTime' };
  }
  const to = form.part === 'full_day' && form.to && form.to > form.from ? form.to : null;
  const note = form.note.trim();
  return {
    args: { p_id: id, p_from: form.from, p_to: to, p_part: form.part, p_start: start, p_end: end, p_reason: form.reason, p_note: note === '' ? null : note },
  };
}

/** The days the form offers, from `today` on. */
export function dayChoices(today: string, count = DAYS_AHEAD): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

/** The last days a full-day entry can run to: the days after the first, up to 31 days in all. */
export function lastDayChoices(from: string): string[] {
  return Array.from({ length: MAX_DAYS - 1 }, (_, i) => addDays(from, i + 1));
}

/** Whether the form differs from where it started (the "Discard changes?" question). */
export function availDirty(start: AvailForm, form: AvailForm): boolean {
  return JSON.stringify(start) !== JSON.stringify(form);
}

/** set_my_unavailability's answer: ok with the id, or the refusal's words. */
export function parseAvailAnswer(raw: unknown): { result: 'ok'; id: string | null } | { result: 'refused'; reason: string } {
  const o = (raw ?? {}) as { result?: unknown; id?: unknown; reason?: unknown };
  if (o.result === 'ok') return { result: 'ok', id: typeof o.id === 'string' ? o.id : null };
  return { result: 'refused', reason: typeof o.reason === 'string' && o.reason !== '' ? o.reason : 'refused' };
}
