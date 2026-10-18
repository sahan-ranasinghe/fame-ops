// One way to say how long something takes and how far away a time is (Hotfix 2, D; the office and the server have the
// same rules in @fleet/durations). Pure: no React, so scripts/test-durations.ts runs it in both languages.
//
//   a length of time   "45 min", "3 h 20 min", "2 h"
//   a time from now    under 60 min "in 45 min"; the same Colombo day, or under 6 hours away, "in 3 h 20 min"; the
//                      next day "tomorrow 09:00"; later "Mon 19 Oct 09:00 (in 2 days)". The same back in time:
//                      "45 min ago", "3 h 20 min ago", "yesterday 09:00", "Fri 16 Oct 09:00 (2 days ago)". Under half a
//                      minute either way: "now". (09:00 tomorrow seen at 14:00 is "tomorrow 09:00", not "in 19 h".)
//
// Colombo time (lib/time.ts), whole minutes (rounded), Latin digits in both languages (the numbers go into the
// sentences as numbers; only the day and month names are translated).

import { colomboDate, colomboParts, colomboTime } from './time';

/** The app's t() (useApp): a key and its {placeholders}. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** The short day names (Sunday first) and month names (January first) of the language: tList('days'), tList('months'). */
export interface DateNames {
  days: readonly string[];
  months: readonly string[];
}

const MINUTE_MS = 60_000;
const DAY_MIN = 24 * 60;
/** Within this many minutes a time on another day is still said in hours ("in 5 h" late in the evening). */
const HOURS_REACH_MIN = 6 * 60;

/** "45 min", "3 h 20 min", "2 h", from a day on "2 d 3 h": a length of time in whole minutes (never negative). */
export function durationText(t: Translate, minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return t('dur.minutes', { n: m });
  if (m >= DAY_MIN) {
    const d = Math.floor(m / DAY_MIN);
    const h = Math.floor((m % DAY_MIN) / 60);
    return h === 0 ? t('dur.daysOnly', { d }) : t('dur.days', { d, h });
  }
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? t('dur.hoursOnly', { h }) : t('dur.hours', { h, m: rest });
}

/** Colombo calendar days from `from` to `to`: the next day is 1, the day before -1, the same day 0. */
export function colomboDayDiff(from: Date | string | number, to: Date | string | number): number {
  const a = Date.parse(`${colomboDate(from)}T00:00:00Z`);
  const b = Date.parse(`${colomboDate(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "Mon 19 Oct" in the language of the names (the day of the month in Latin digits). */
export function shortDate(names: DateNames, at: Date | string | number): string {
  const { weekday, day, month } = colomboParts(at);
  return `${names.days[weekday] ?? ''} ${day} ${names.months[month] ?? ''}`.trim();
}

/**
 * How far `at` is from `now`: "in 45 min", "in 3 h 20 min", "tomorrow 09:00", "Mon 19 Oct 09:00 (in 2 days)", and back
 * in time "45 min ago" … "Fri 16 Oct 09:00 (2 days ago)". The same Colombo day, or under 6 hours either way, counts the
 * hours; otherwise the calendar day decides (the next day "tomorrow", the day before "yesterday"). The server's
 * @fleet/durations says it the same way.
 */
export function relativeTime(t: Translate, names: DateNames, at: Date | string | number, now: Date | string | number = Date.now()): string {
  const diff = new Date(at).getTime() - new Date(now).getTime();
  const m = Math.round(Math.abs(diff) / MINUTE_MS);
  if (m === 0) return t('dur.now');
  const future = diff > 0;
  if (m < 60) return t(future ? 'dur.inMin' : 'dur.agoMin', { n: m });
  const days = colomboDayDiff(now, at);
  if (days === 0 || m < HOURS_REACH_MIN) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (rest === 0) return t(future ? 'dur.inHoursOnly' : 'dur.agoHoursOnly', { h });
    return t(future ? 'dur.inHours' : 'dur.agoHours', { h, m: rest });
  }
  const time = colomboTime(at);
  if (days === 1) return t('dur.tomorrow', { time });
  if (days === -1) return t('dur.yesterday', { time });
  const date = shortDate(names, at);
  return future ? t('dur.later', { date, time, days }) : t('dur.earlier', { date, time, days: -days });
}
