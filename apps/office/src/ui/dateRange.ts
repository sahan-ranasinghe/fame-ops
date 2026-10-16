// The date-range control's rules (Phase 7 §8), pure: Today / Yesterday / This
// week (Monday–Sunday) / This month / Last month / Custom, as Colombo dates
// (YYYY-MM-DD), read from and written to the URL
// (?range=…&from=YYYY-MM-DD&to=YYYY-MM-DD). DateRange.tsx draws it.
import { addDays, TZ } from "../lib/format";

export type RangeKey = "today" | "yesterday" | "week" | "month" | "last_month" | "custom";

export const RANGE_OPTIONS: [RangeKey, string][] = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This week"],
  ["month", "This month"],
  ["last_month", "Last month"],
  ["custom", "Custom"],
];
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
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
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

/** Reads ?range=&from=&to=; anything missing or wrong falls back to the page's default. One-day mode keeps To = From. */
export function readRange(params: Pick<URLSearchParams, "get">, def: RangeKey, today: string, oneDay = false): DayRange {
  const allowed = (oneDay ? ONE_DAY_OPTIONS : RANGE_OPTIONS).map(([k]) => k);
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
