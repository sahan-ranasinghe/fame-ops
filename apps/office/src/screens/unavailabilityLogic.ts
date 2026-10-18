// Part 3b (H1): when a driver is not available for dispatch (not HR leave), the pure part of the editor: the form from an
// entry (or a new one for a day), the words of each choice (the morning ends and the afternoon starts at the setting
// half_day_split, 13:00 by default), the checks the server makes too (said before the call), set_unavailability's
// arguments, and the short chip of an entry in the week view. Pure.
import type { UnavailablePart, UnavailableEntry, UnavailableReason } from "../data/types";

export interface EntryForm {
  /** The first day, YYYY-MM-DD. */
  day: string;
  /** Full day only: the last day ("" or the same day = one day). */
  last_day: string;
  part: UnavailablePart;
  /** From–to only: HH:MM. */
  from: string;
  to: string;
  reason: UnavailableReason;
  note: string;
}

/** The default split between the morning and the afternoon. */
export const DEFAULT_SPLIT = "13:00";
/** A full-day entry runs at most this many days (the server's rule: the last day at most 30 days after the first). */
export const MAX_DAYS = 31;
export const NOTE_MAX = 300;

export const REASONS: [UnavailableReason, string][] = [
  ["leave", "Leave"],
  ["half_day", "Half day"],
  ["personal", "Personal"],
  ["other", "Other"],
];

/** The setting half_day_split as a time, else 13:00. */
export function splitOf(value: unknown): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_SPLIT;
}

/** The choices of "When", in words: Full day · Morning until 13:00 · Afternoon from 13:00 · From–to. */
export function partChoices(split: string): [UnavailablePart, string][] {
  return [
    ["full_day", "Full day"],
    ["morning", `Morning until ${split}`],
    ["afternoon", `Afternoon from ${split}`],
    ["hours", "From–to"],
  ];
}

/** The form for an entry (to change it), or a new one on `day` (a full day of leave). */
export function entryForm(entry?: UnavailableEntry | null, day = ""): EntryForm {
  if (!entry) return { day, last_day: "", part: "full_day", from: "", to: "", reason: "leave", note: "" };
  return {
    day: entry.day,
    last_day: entry.part === "full_day" && entry.last_day !== entry.day ? entry.last_day : "",
    part: entry.part,
    from: entry.part === "hours" ? entry.start_time ?? "" : "",
    to: entry.part === "hours" ? entry.end_time ?? "" : "",
    reason: entry.reason,
    note: entry.note ?? "",
  };
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const dayNumber = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000);

/** What is wrong with the form, in one sentence (the server says the same), or null. `today` is Colombo's YYYY-MM-DD. */
export function entryError(f: EntryForm, today: string): string | null {
  if (!isDate(f.day)) return "Choose the day.";
  const last = f.part === "full_day" && f.last_day ? f.last_day : "";
  if (last && !isDate(last)) return "The last day is not a date.";
  if (last && last < f.day) return "The last day comes after the first.";
  if (last && dayNumber(last) - dayNumber(f.day) >= MAX_DAYS) return `At most ${MAX_DAYS} days at a time.`;
  if ((last || f.day) < today) return "That day has passed.";
  if (f.part === "hours") {
    if (!isTime(f.from) || !isTime(f.to)) return "Give the time from and the time to.";
    if (f.to <= f.from) return "The time to comes after the time from.";
  }
  if (!REASONS.some(([r]) => r === f.reason)) return "Choose the reason.";
  if (f.note.trim().length > NOTE_MAX) return `The note can be ${NOTE_MAX} characters at most.`;
  return null;
}

/**
 * set_unavailability's arguments: the driver, the day, the last day (full days only, when later), the part, from and to
 * (from–to only), the reason, the note (left out when empty: a change then clears it), and the entry's id when changing.
 */
export function setUnavailabilityArgs(driver: string, f: EntryForm, id?: string): Record<string, unknown> {
  const args: Record<string, unknown> = { driver, date: f.day, part: f.part, reason: f.reason };
  if (f.part === "full_day" && f.last_day && f.last_day > f.day) args.to_date = f.last_day;
  if (f.part === "hours") {
    args.from = f.from;
    args.to = f.to;
  }
  const note = f.note.trim();
  if (note) args.note = note;
  if (id) args.id = id;
  return args;
}

/** The week view's chip: "Leave · all day", "Half day · until 13:00", "Personal · 09:00–11:30". */
export function entryChip(e: Pick<UnavailableEntry, "part" | "reason_text" | "start_time" | "end_time">): string {
  const when = e.part === "full_day"
    ? "all day"
    : e.part === "morning"
    ? `until ${e.end_time ?? ""}`.trim()
    : e.part === "afternoon"
    ? `from ${e.start_time ?? ""}`.trim()
    : `${e.start_time ?? ""}–${e.end_time ?? ""}`;
  return `${e.reason_text} · ${when}`;
}

/** "Mon 20 Oct", or "Mon 20 – Wed 22 Oct" for several full days: when an entry is, for the driver's page. */
export function entryDays(e: Pick<UnavailableEntry, "day" | "last_day">): string {
  if (!e.last_day || e.last_day === e.day) return shortDay(e.day);
  return `${shortDay(e.day)} – ${shortDay(e.last_day)}`;
}

/** "Mon 20 Oct" from YYYY-MM-DD. */
export function shortDay(d: string): string {
  if (!isDate(d)) return d;
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
