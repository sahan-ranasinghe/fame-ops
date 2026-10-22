// The date rules (Phase 7 §8; docs/ui-patterns.md §2 and §3), pure: the presets Today / Yesterday / Last 7 days / This
// week (Monday–Sunday) / This month / Last month, and Custom (days tapped on the calendar), as Colombo dates
// (YYYY-MM-DD), read from and written to the URL (?range=…&from=YYYY-MM-DD&to=YYYY-MM-DD); the calendar's months and its
// tap rule (start, then end; one day twice = that day); the week strip's weeks. DateRangePicker.tsx and DayPicker.tsx
// draw them.
import { addDays, TZ } from "../lib/format";

export type RangeKey = "any" | "today" | "yesterday" | "last7" | "week" | "month" | "last_month" | "custom";

export const RANGE_OPTIONS: [RangeKey, string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last7", "Last 7 days"],
  ["week", "This week"],
  ["month", "This month"],
  ["last_month", "Last month"],
  ["custom", "Custom"],
];
/** The picker's presets (every range but Custom, which is days tapped on the calendar). */
export const PRESETS = RANGE_OPTIONS.filter(([k]) => k !== "custom") as [Exclude<RangeKey, "custom">, string][];
/**
 * Round 4–7: "Any time" (no dates at all), offered only by a page whose default it is (the Issues page's Open tab: an open
 * issue is open whenever it was opened). Its from and to are empty: such a page sends no dates.
 */
export const ANY_TIME: [Exclude<RangeKey, "custom">, string] = ["any", "Any time"];
/** One-day mode (the Route): a route is one day. */
export const ONE_DAY_OPTIONS: [RangeKey, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["custom", "Custom day"]];

export interface DayRange {
  range: RangeKey;
  from: string;
  to: string;
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Colombo date of a moment (Colombo is UTC+5:30: 18:30 UTC is already the next day there). */
export const colomboDay = (at: Date = new Date()): string => dayFmt.format(at);

/** "2026-02-30" is not a date; "2026-02-28" is. */
export function isDay(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s + "T12:00:00Z");
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

/** The Monday of the week the day is in (weeks run Monday to Sunday). */
export function mondayOf(day: string): string {
  const dow = new Date(day + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The first and last day of the day's month. */
export function monthOf(day: string): { from: string; to: string } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)); // 1–12
  // Day 0 of the next month is the last day of this one (Date.UTC rolls December over into January).
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: day.slice(0, 8) + "01", to: last };
}

/** The dates a range means on a given Colombo day (custom keeps its own). */
export function rangeDates(range: Exclude<RangeKey, "custom">, today: string): { from: string; to: string } {
  switch (range) {
    case "any":
      return { from: "", to: "" };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "week": {
      const mon = mondayOf(today);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "month":
      return monthOf(today);
    case "last_month":
      return monthOf(addDays(monthOf(today).from, -1));
  }
}

/** Days from `from` to `to`, both counted. */
export function daysIn(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
}

/** A custom range as typed: From after To is swapped; anything that is not a date is refused in words. */
export function customRange(from: string, to: string): { from: string; to: string } | { error: string } {
  if (!isDay(from)) return { error: "Pick a From date." };
  if (!isDay(to)) return { error: "Pick a To date." };
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Over the page's limit: the sentence to show instead of asking the server. */
export function tooLong(from: string, to: string, maxDays?: number): string | undefined {
  if (!maxDays) return undefined;
  return daysIn(from, to) > maxDays ? `At most ${maxDays} days at a time: pick a shorter range.` : undefined;
}

/**
 * Reads ?range=&from=&to=; anything missing or wrong falls back to the page's default. One-day mode keeps To = From.
 * "any" is read only on a page whose default it is.
 */
export function readRange(params: Pick<URLSearchParams, "get">, def: RangeKey, today: string, oneDay = false): DayRange {
  const allowed: RangeKey[] = [...(oneDay ? ONE_DAY_OPTIONS : RANGE_OPTIONS).map(([k]) => k), ...(def === "any" && !oneDay ? ["any" as const] : [])];
  const fallback = def === "custom" || !allowed.includes(def) ? "today" : def;
  const asked = params.get("range") as RangeKey | null;
  const range = asked && allowed.includes(asked) ? asked : fallback;
  if (range === "custom") {
    const from = params.get("from");
    const to = oneDay ? from : params.get("to") || from;
    const c = from && to ? customRange(from, to) : null;
    if (c && !("error" in c)) return { range, ...c };
    return { range: fallback, ...rangeDates(fallback as Exclude<RangeKey, "custom">, today) };
  }
  return { range, ...rangeDates(range, today) };
}

/**
 * The URL after a choice, other parameters kept (driver=, …). The page's default
 * range leaves no trace; custom carries its dates (one-day mode only From).
 */
export function writeRange(params: URLSearchParams, next: { range: RangeKey; from?: string; to?: string }, def: RangeKey, oneDay = false): URLSearchParams {
  const out = new URLSearchParams(params);
  out.delete("range");
  out.delete("from");
  out.delete("to");
  if (next.range === "custom") {
    out.set("range", "custom");
    if (next.from) out.set("from", next.from);
    if (!oneDay && next.to) out.set("to", next.to);
  } else if (next.range !== def) {
    out.set("range", next.range);
  }
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu 15 Oct" (+ " 2026"): spelt out here, so no locale adds a comma or other digits. */
function short(d: string, year: boolean): string {
  const t = new Date(d + "T12:00:00Z");
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${year ? ` ${t.getUTCFullYear()}` : ""}`;
}

/** "Thu 15 Oct 2026", "Mon 12 Oct – Sun 18 Oct 2026", "Mon 28 Dec 2026 – Sun 3 Jan 2027". */
export function rangeText(from: string, to: string): string {
  if (from === to) return short(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${short(from, !sameYear)} – ${short(to, true)}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thu 15 Oct" (+ the year), for a chip or a button. */
export const dayText = (d: string, year = false): string => short(d, year);

/**
 * The range on the picker's button, short: "This month · 1–31 Oct", "Mon 12 – Sun 18 Oct", "Thu 15 Oct",
 * "28 Sep – 4 Oct", "28 Dec 2026 – 3 Jan 2027". The year only when it is not this year's (or the range crosses one).
 */
export function pickerText(range: RangeKey, from: string, to: string, today: string): string {
  if (range === "any") return ANY_TIME[1];
  const preset = RANGE_OPTIONS.find(([k]) => k === range && k !== "custom")?.[1];
  const year = from.slice(0, 4) !== to.slice(0, 4) || from.slice(0, 4) !== today.slice(0, 4);
  let days: string;
  if (from === to) days = short(from, year);
  else {
    const f = new Date(from + "T12:00:00Z");
    const t = new Date(to + "T12:00:00Z");
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    if (daysIn(from, to) <= 7) {
      // A week: the weekdays help ("Mon 12 – Sun 18 Oct").
      days = sameMonth
        ? `${WEEKDAYS[f.getUTCDay()]} ${f.getUTCDate()} – ${short(to, year)}`
        : `${short(from, from.slice(0, 4) !== to.slice(0, 4))} – ${short(to, year)}`;
    } else if (sameMonth) {
      days = `${f.getUTCDate()}–${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${year ? ` ${t.getUTCFullYear()}` : ""}`;
    } else {
      const crosses = from.slice(0, 4) !== to.slice(0, 4);
      days = `${f.getUTCDate()} ${MONTHS[f.getUTCMonth()]}${crosses ? ` ${f.getUTCFullYear()}` : ""} – ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${year ? ` ${t.getUTCFullYear()}` : ""}`;
    }
  }
  return preset ? `${preset} · ${days}` : days;
}

// ---------- the calendar ----------

/** "2026-10" → "October 2026". */
export const monthTitle = (ym: string): string => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** A month moved by n months ("2026-12", 1 → "2027-01"). */
export function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const t = new Date(Date.UTC(y, m, 1));
  return t.toISOString().slice(0, 7);
}

/** The month's weeks, Monday first; the days of the months beside it are null (left blank). */
export function monthGrid(ym: string): (string | null)[][] {
  const { from, to } = monthOf(ym + "-01");
  const lead = (new Date(from + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The weekday heads, Monday first. */
export const WEEK_HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A range being picked on the calendar: the start, and the end once tapped (null = waiting for it). */
export interface Picking {
  from: string | null;
  to: string | null;
}

/**
 * The calendar's tap rule: the first tap is the start, the second the end (an earlier day swaps them); the same day
 * twice is that one day; a tap after a whole range starts a new one.
 */
export function tapDay(p: Picking, day: string): Picking {
  if (p.from && !p.to) return day < p.from ? { from: day, to: p.from } : { from: p.from, to: day };
  return { from: day, to: null };
}

/** The range a Picking gives on Apply: a start alone is that one day; nothing picked is null. */
export function pickedRange(p: Picking): { from: string; to: string } | null {
  if (!p.from) return null;
  return { from: p.from, to: p.to ?? p.from };
}

/**
 * A day the calendar greys out: before `min` or after `max`, or, while the end is being picked, further than the page's
 * limit (maxDays, both days counted) from the start.
 */
export function dayDisabled(day: string, opts: { min?: string; max?: string; maxDays?: number; picking?: Picking }): boolean {
  if (opts.min && day < opts.min) return true;
  if (opts.max && day > opts.max) return true;
  const p = opts.picking;
  if (opts.maxDays && p?.from && !p.to) return (day < p.from ? daysIn(day, p.from) : daysIn(p.from, day)) > opts.maxDays;
  return false;
}

/** Where a day sits in the range being shown: its ends and the days between are marked. */
export function dayRole(day: string, p: Picking): "single" | "start" | "end" | "between" | null {
  const r = pickedRange(p);
  if (!r) return null;
  if (r.from === r.to) return day === r.from ? "single" : null;
  if (day === r.from) return "start";
  if (day === r.to) return "end";
  return day > r.from && day < r.to ? "between" : null;
}

// ---------- the week strip ----------

/** The seven days of the week that starts on `monday`. */
export const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** A week strip's week moved by n weeks (its Monday). */
export const shiftWeek = (monday: string, n: number): string => addDays(mondayOf(monday), 7 * n);

/** "Mon", "Tue" … and the day of the month, for a strip's cell. */
export function stripCell(day: string): { weekday: string; date: number } {
  const t = new Date(day + "T12:00:00Z");
  return { weekday: WEEKDAYS[t.getUTCDay()], date: t.getUTCDate() };
}

/** The week strip's heading: "12–18 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function weekTitle(monday: string): string {
  const sun = addDays(monday, 6);
  const f = new Date(monday + "T12:00:00Z");
  const t = new Date(sun + "T12:00:00Z");
  if (monday.slice(0, 7) === sun.slice(0, 7)) return `${f.getUTCDate()}–${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
  if (monday.slice(0, 4) === sun.slice(0, 4)) return `${f.getUTCDate()} ${MONTHS[f.getUTCMonth()]} – ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
  return `${f.getUTCDate()} ${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()} – ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** A trip's day on its chip: Today, Tomorrow, else "Thu 23 Oct" (the year when it is not this year's). */
export function tripDayText(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return short(day, day.slice(0, 4) !== today.slice(0, 4));
}

/** The day before. */
export const yesterdayOf = (day: string): string => addDays(day, -1);
