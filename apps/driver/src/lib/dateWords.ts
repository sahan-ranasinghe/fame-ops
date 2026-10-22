// Dates in words, everywhere (Round 3 Part A4, Sahan 21 October 2026): never "2026-10-20 20:47" or "2026-10-20" on a
// screen. The pattern is Gmail's and Google Calendar's list dates: "Today 20:47", "Yesterday 20:47", "Tomorrow 09:00",
// "Mon 19 Oct 20:47", and the year only when it is not this year ("Fri 12 Dec 2025 09:00"); a date alone the same without
// the time ("Today", "Thu 12 Mar 2027"). Asia/Colombo (lib/time.ts), Latin digits in both languages; the day and month
// names are the app's own (`days`, `months` in en.json / si.json, as lib/durations.ts shortDate uses them).
//
// ONE formatter for Office mode, /m/ and the driver app. What it reads:
//   - "YYYY-MM-DD HH:MM": a Colombo wall time, as the server sends it (_shared/fleet/time.ts colomboDateTime);
//   - "YYYY-MM-DD": a day (colomboDate, and the database's date columns: expiry dates, a trip's day);
//   - an instant with its zone ("2026-10-20T15:17:00Z", "…+05:30"), a Date or epoch ms: shown in Colombo time.
// Anything else is shown as it is (never a guess). Machine values (route params, tool inputs, keys, sorting) stay as they
// are: only what is put on the screen goes through here. Pure: scripts/test-date-words.ts.

import { colomboDate, colomboTime } from './time';

/** The app's t() (useApp): a key and its {placeholders}. `days.N` and `months.N` read the language's name lists. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
/** A server date (with its time) inside a sentence: "2026-10-20 20:47 by Kamal", "expired on 2026-10-12." */
const IN_TEXT = /\b\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?\b(?![T:])/g;

interface Parts {
  /** The Colombo day, YYYY-MM-DD. */
  day: string;
  /** HH:MM, or null for a date alone. */
  time: string | null;
}

/** The Colombo day and time a value names, or null when it is not a date this app knows. */
export function dateParts(value: Date | string | number | null | undefined): Parts | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (DAY_ONLY.test(s)) return realDay(s) ? { day: s, time: null } : null;
    const m = s.match(WALL_TIME);
    if (m) {
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      return realDay(day) && Number(m[4]) < 24 && Number(m[5]) < 60 ? { day, time: `${m[4]}:${m[5]}` } : null;
    }
    // An instant needs its zone: a bare "2026-10-20T10:00" is read above as Colombo's wall clock.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return { day: colomboDate(at), time: colomboTime(at) };
}

function realDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Tomorrow", "Mon 19 Oct", "Fri 12 Dec 2025": a Colombo day (YYYY-MM-DD) said from `today`. */
export function dayWords(t: Translate, day: string, today: string): string {
  if (day === today) return t('date.today');
  if (day === addDays(today, -1)) return t('date.yesterday');
  if (day === addDays(today, 1)) return t('date.tomorrow');
  const d = new Date(`${day}T00:00:00Z`);
  const words = `${t(`days.${d.getUTCDay()}`)} ${d.getUTCDate()} ${t(`months.${d.getUTCMonth()}`)}`;
  return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${day.slice(0, 4)}`;
}

/**
 * A date the server or the phone gives, in words: "Today 20:47", "Yesterday 20:47", "Mon 19 Oct 20:47", "Mon 19 Oct 2025
 * 20:47"; a date alone "Today", "Mon 19 Oct". Not a date: the value as it is ('' for nothing).
 */
export function dateWords(t: Translate, value: Date | string | number | null | undefined, now: Date | string | number = Date.now()): string {
  const p = dateParts(value);
  if (!p) return value === null || value === undefined ? '' : String(value);
  const day = dayWords(t, p.day, colomboDate(now));
  return p.time ? `${day} ${p.time}` : day;
}

/** The server's own day words (colomboDayTime: "Thu 22 Oct", with "2027" in another year). */
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_DAY = /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?\b/g;

/** "Thu 22 Oct" as a Colombo day (YYYY-MM-DD): the year given, else the one near `today` whose weekday matches. */
function enDay(dayName: string, date: string, month: string, year: string | undefined, today: string): string | null {
  const m = EN_MONTHS.indexOf(month);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y0 = Number(today.slice(0, 4));
  for (const y of year ? [Number(year)] : [y0, y0 + 1, y0 - 1]) {
    const day = `${y}-${pad(m + 1)}-${pad(Number(date))}`;
    if (realDay(day) && new Date(`${day}T00:00:00Z`).getUTCDay() === EN_DAYS.indexOf(dayName)) return day;
  }
  return null;
}

/** Every server date inside a sentence in words: "2026-10-20 20:47 by Kamal" → "Today 20:47 by Kamal"; the server's
 *  "Thu 22 Oct" in the language's own day and month names (never made relative inside a sentence). */
export function datesInWords(t: Translate, text: string | null | undefined, now: Date | string | number = Date.now()): string {
  if (!text) return '';
  const today = colomboDate(now);
  return text
    .replace(IN_TEXT, (found) => (dateParts(found) ? dateWords(t, found, now) : found))
    .replace(EN_DAY, (found, dn: string, dd: string, mon: string, yy: string | undefined) => {
      const day = enDay(dn, dd, mon, yy, today);
      if (!day) return found;
      const d = new Date(`${day}T00:00:00Z`);
      const words = `${t(`days.${d.getUTCDay()}`)} ${d.getUTCDate()} ${t(`months.${d.getUTCMonth()}`)}`;
      return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${day.slice(0, 4)}`;
    });
}

/** A relative phrase as keys: the dur.* key (the server's @fleet/durations words, the same in en.json) and its values. */
export interface RelWords {
  key: string;
  vars: Record<string, string | RelWords>;
  /** The server's "Fri 16 Oct" in a farther time: said with the language's day and month names. */
  day?: string;
}

/**
 * The server's relative words (Part B, M5: "2 h ago" was English on Sinhala screens). @fleet/durations whenText and duration
 * say a time from now and a length in English: "now", "in 45 min", "in 3 h 20 min", "in 3 h", "tomorrow 09:00", "Mon 19 Oct
 * 09:00 (in 2 days)", "45 min ago", "3 h 20 min ago", "3 h ago", "yesterday 09:00", "Fri 16 Oct 09:00 (2 days ago)", a length
 * "45 min", "1 h 15 min", "2 h", "2 d 3 h", "2 d", and "20 min late". Null when the text is none of them.
 */
export function relativeKey(text: string): RelWords | null {
  const s = text.trim();
  let m: RegExpMatchArray | null;
  if (s === 'now') return { key: 'dur.now', vars: {} };
  if ((m = s.match(/^in (\d+) min$/))) return { key: 'dur.inMin', vars: { n: m[1] } };
  if ((m = s.match(/^in (\d+) h (\d+) min$/))) return { key: 'dur.inHours', vars: { h: m[1], m: m[2] } };
  if ((m = s.match(/^in (\d+) h$/))) return { key: 'dur.inHoursOnly', vars: { h: m[1] } };
  if ((m = s.match(/^tomorrow (\d{2}:\d{2})$/))) return { key: 'dur.tomorrow', vars: { time: m[1] } };
  if ((m = s.match(/^(.+) (\d{2}:\d{2}) \(in (\d+) days\)$/))) return { key: 'dur.later', vars: { time: m[2], days: m[3] }, day: m[1] };
  if ((m = s.match(/^(\d+) min ago$/))) return { key: 'dur.agoMin', vars: { n: m[1] } };
  if ((m = s.match(/^(\d+) h (\d+) min ago$/))) return { key: 'dur.agoHours', vars: { h: m[1], m: m[2] } };
  if ((m = s.match(/^(\d+) h ago$/))) return { key: 'dur.agoHoursOnly', vars: { h: m[1] } };
  if ((m = s.match(/^yesterday (\d{2}:\d{2})$/))) return { key: 'dur.yesterday', vars: { time: m[1] } };
  if ((m = s.match(/^(.+) (\d{2}:\d{2}) \((\d+) days ago\)$/))) return { key: 'dur.earlier', vars: { time: m[2], days: m[3] }, day: m[1] };
  if ((m = s.match(/^(\d+) min$/))) return { key: 'dur.minutes', vars: { n: m[1] } };
  if ((m = s.match(/^(\d+) h (\d+) min$/))) return { key: 'dur.hours', vars: { h: m[1], m: m[2] } };
  if ((m = s.match(/^(\d+) h$/))) return { key: 'dur.hoursOnly', vars: { h: m[1] } };
  if ((m = s.match(/^(\d+) d (\d+) h$/))) return { key: 'dur.days', vars: { d: m[1], h: m[2] } };
  if ((m = s.match(/^(\d+) d$/))) return { key: 'dur.daysOnly', vars: { d: m[1] } };
  if ((m = s.match(/^(.+) late$/))) {
    const length = relativeKey(m[1]);
    return length && !length.day && /^dur\.(minutes|hours|hoursOnly|days|daysOnly)$/.test(length.key) ? { key: 'dur.late', vars: { dur: length } } : null;
  }
  return null;
}

/** The server's relative words in the person's language ("2 h ago" → "පැය 2 කට පෙර"), or null when the text is not one. */
export function relativeWords(t: Translate, text: string | null | undefined, now: Date | string | number = Date.now()): string | null {
  const r = text ? relativeKey(text) : null;
  return r ? relText(t, r, now) : null;
}

function relText(t: Translate, r: RelWords, now: Date | string | number): string {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.vars)) vars[k] = typeof v === 'string' ? v : relText(t, v, now);
  if (r.day) vars.date = datesInWords(t, r.day, now);
  return t(r.key, vars);
}

/**
 * A when-field the server sends ("Thu 22 Oct 08:30", "tomorrow 13:07", "2026-10-22 08:30", "08:30") in words, as the
 * screens say dates: "Tomorrow 08:30", "Mon 19 Oct 08:30" (Sinhala names in Sinhala). A time alone stays as it is. The
 * server's relative words ("2 h ago", "in 45 min", "Fri 16 Oct 09:00 (2 days ago)") in the person's language too (M5).
 */
export function whenWords(t: Translate, value: string | null | undefined, now: Date | string | number = Date.now()): string {
  const s = (value ?? '').trim();
  if (!s) return '';
  const rel = s.match(/^(today|tomorrow|yesterday)(?: (\d{2}:\d{2}))?$/i);
  if (rel) return [t(`date.${rel[1].toLowerCase()}`), rel[2]].filter(Boolean).join(' ');
  const ago = relativeWords(t, s, now);
  if (ago) return ago;
  const en = s.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?: (\d{4}))?(?: (\d{2}:\d{2}))?$/);
  if (en) {
    const day = enDay(en[1], en[2], en[3], en[4], colomboDate(now));
    if (day) return [dayWords(t, day, colomboDate(now)), en[5]].filter(Boolean).join(' ');
  }
  return dateParts(s) ? dateWords(t, s, now) : datesInWords(t, s, now);
}

/** A month the server names ("2026-10"): "Oct", the year only when it is not this year ("Dec 2025"). Else as it is. */
export function monthWords(t: Translate, month: string | null | undefined, now: Date | string | number = Date.now()): string {
  const m = (month ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return month ?? '';
  const words = t(`months.${Number(m[2]) - 1}`);
  return m[1] === colomboDate(now).slice(0, 4) ? words : `${words} ${m[1]}`;
}

/**
 * Where only a little room is left (a step's time under its dot, a time beside a word): the time alone today ("08:31"),
 * else as dateWords says it ("Yesterday 08:31", "Mon 19 Oct 08:31"). Gmail's list: today's mail shows its time only.
 */
export function shortWhen(t: Translate, value: Date | string | number | null | undefined, now: Date | string | number = Date.now()): string {
  const p = dateParts(value);
  if (p?.time && p.day === colomboDate(now)) return p.time;
  return dateWords(t, value, now);
}

/** A span: "Today 08:31–11:40" on one day, "Mon 19 Oct 22:10 – Tue 20 Oct 01:05" across two; the start alone without an end. */
export function spanWords(t: Translate, from: string | null | undefined, to: string | null | undefined, now: Date | string | number = Date.now()): string {
  const a = dateParts(from);
  const b = dateParts(to);
  if (!from) return '';
  if (!to) return dateWords(t, from, now);
  if (a?.time && b?.time && a.day === b.day) return `${dateWords(t, from, now)}–${b.time}`;
  return `${dateWords(t, from, now)} – ${dateWords(t, to, now)}`;
}
