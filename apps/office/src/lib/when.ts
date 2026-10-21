// Dates in words (Round 3 Part A, A4): the relative dates of Gmail's list and Google Calendar ("Today 20:47",
// "Yesterday 20:47", "Mon 19 Oct 20:47"; the year only when it is not this year's), never "2026-10-20 20:47" on a
// screen. The one formatter of the site: every date the server sends as Colombo text ("YYYY-MM-DD HH:MM",
// "YYYY-MM-DD") or as an ISO time goes through `whenText` where it is shown; `datesInWords` does the same for the dates
// inside a server sentence ("Snoozed until 2026-10-22 07:00"). Machine values (inputs, URLs, sorting) keep the raw
// form: only what is drawn on the screen is turned into words. Asia/Colombo, which has no daylight saving.
import { addDays, TZ } from "./format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Colombo wall-clock text, no zone: "2026-10-20 20:47" (seconds allowed, a T instead of the space too). */
const LOCAL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
/** A plain date: "2026-10-20". */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A moment with its zone: "2026-10-20T15:17:00.000Z", "2026-10-20T20:47:00+05:30". */
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** The same three inside a sentence. */
const IN_TEXT = /\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d:])/g;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** A moment as Colombo's date and clock: { day: "2026-10-21", time: "00:00" }. */
function colombo(at: Date): { day: string; time: string } {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(at)) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

export interface WhenOptions {
  /** The moment "today" is taken from (tests); default now. */
  now?: Date;
  /** Inside a sentence: "today", "yesterday", "tomorrow" in small letters ("Opened today 20:47"). */
  inline?: boolean;
}

/**
 * A Colombo day in words: "Today", "Yesterday", "Tomorrow", else "Mon 19 Oct" ("Mon 19 Oct 2025" when it is not this
 * year's). Not a day ("", "—", words): given back as it is.
 */
export function dayWords(day: string | null | undefined, opts: WhenOptions = {}): string {
  const d = String(day ?? "").trim();
  if (!DAY.test(d)) return d;
  const t = new Date(d + "T12:00:00Z");
  if (isNaN(t.getTime())) return d;
  const today = colombo(opts.now ?? new Date()).day;
  const word = d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : d === addDays(today, 1) ? "Tomorrow" : null;
  if (word) return opts.inline ? word.toLowerCase() : word;
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}`;
}

/**
 * A date or a date and time from the server, in words: "2026-10-21 20:47" → "Today 20:47", "2026-10-20 20:47" →
 * "Yesterday 20:47", "2026-10-19 20:47" → "Mon 19 Oct 20:47", "2025-10-19" → "Sun 19 Oct 2025"; an ISO time is first
 * moved to Colombo. Anything else (a clock "08:41", words, "never", empty) is given back unchanged.
 */
export function whenText(value: string | null | undefined, opts: WhenOptions = {}): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const local = v.match(LOCAL);
  if (local) return `${dayWords(local[1], opts)} ${local[2]}:${local[3]}`;
  if (DAY.test(v)) return dayWords(v, opts);
  if (ZONED.test(v)) {
    const at = new Date(v);
    if (isNaN(at.getTime())) return v;
    const c = colombo(at);
    return `${dayWords(c.day, opts)} ${c.time}`;
  }
  return v;
}

/**
 * Every date inside a sentence in words: "Snoozed until 2026-10-22 07:00 · by Kamal" → "Snoozed until tomorrow 07:00 ·
 * by Kamal" (small letters inside a sentence; a capital at its start or after a " · "). Text with no date is given back
 * unchanged.
 */
export function datesInWords(text: string | null | undefined, opts: WhenOptions = {}): string {
  const s = String(text ?? "");
  return s.replace(IN_TEXT, (m, offset: number) => {
    const before = s.slice(0, offset).trim();
    const start = before === "" || /[·—–(]$/.test(before);
    return whenText(m, { ...opts, inline: opts.inline ?? !start });
  });
}
