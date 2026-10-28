// Part 3b (H3): the rules of Ask drivers, pure: the form as the link opens it, its check and ask_drivers' arguments, an
// answer as a chip, a row's state line, the question's open line and counts, the Assign link per case, and the driver,
// day and time the dispatch pages take from ?driver= / ?date= / ?time=.
import type { Ask, AskDriverRow, AskKind } from "../../data/types";
import { joinDots, type Tone } from "../../lib/format";
import type { AskLinkParams } from "./askLink";

/** The three questions, as the page's choice cards show them. */
export const ASK_KINDS: readonly { kind: AskKind; title: string; sub: string }[] = [
  { kind: "free_for_trip", title: "Free for a trip?", sub: "Yes · No · Call me" },
  { kind: "office_time", title: "When can you be at the office?", sub: "They pick a time" },
  { kind: "where_now", title: "Where are you now?", sub: "They share where they are, once" },
];

/** At most this many drivers in one question (ask_drivers' limit). */
export const MAX_ASK_DRIVERS = 100;
export const MAX_ASK_NOTE = 300;

export type AskWho = "picked" | "all_free";

export interface AskForm {
  kind: AskKind;
  /** The trip (free_for_trip): YYYY-MM-DD, HH:MM, HH:MM or "". */
  date: string;
  from: string;
  to: string;
  note: string;
  who: AskWho;
  /** The drivers picked: usernames (a name for a driver with none). */
  drivers: string[];
}

const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The form as the link opens it: its question, trip and drivers (or all the free ones); today when it names no day. */
export function askFormFrom(link: AskLinkParams, today: string): AskForm {
  return {
    kind: link.kind ?? "free_for_trip",
    date: link.date ?? today,
    from: link.from ?? "",
    to: link.to ?? "",
    note: "",
    who: link.allFree ? "all_free" : "picked",
    drivers: [...new Set(link.drivers ?? [])],
  };
}

/** A Colombo day and time as ms. */
export const colomboMs = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:30`);

/**
 * ask_drivers' arguments, or what is missing in one sentence. `link`: the task or request the question is for. `now`
 * (ms): a trip that has started cannot be asked about (the server says the same).
 */
export function askInput(
  f: AskForm,
  link: { task?: string; request?: string } = {},
  now = Date.now(),
): { error: string } | { input: Record<string, unknown> } {
  const input: Record<string, unknown> = { kind: f.kind };
  if (f.kind === "free_for_trip") {
    if (!isDay(f.date)) return { error: "Choose the day of the trip." };
    if (!isTime(f.from)) return { error: "Add the time the trip starts (From)." };
    if (f.to && !isTime(f.to)) return { error: "The time To is not a time: clear it or type HH:MM." };
    if (f.to && f.to <= f.from) return { error: "To must be later than From." };
    if (colomboMs(f.date, f.from) <= now) return { error: "That trip time has passed: ask about a later time." };
    input.date = f.date;
    input.from = f.from;
    if (f.to) input.to = f.to;
  }
  if (f.who === "all_free") input.all_free = true;
  else {
    const drivers = [...new Set(f.drivers.map((d) => d.trim()).filter(Boolean))];
    if (!drivers.length) return { error: "Add the drivers to ask, or choose All free ones." };
    if (drivers.length > MAX_ASK_DRIVERS) return { error: `At most ${MAX_ASK_DRIVERS} drivers in one question.` };
    input.drivers = drivers;
  }
  const note = f.note.trim();
  if (note.length > MAX_ASK_NOTE) return { error: `The note is too long (at most ${MAX_ASK_NOTE} characters).` };
  if (note) input.note = note;
  if (link.task) input.task_id = link.task;
  if (link.request) input.request_id = link.request;
  return { input };
}

/** An answer as a chip: Yes green, No grey, Call me amber, a time or a shared point blue; null = no answer yet. */
export function answerChip(r: Pick<AskDriverRow, "answer" | "answer_text" | "answer_time">): { text: string; tone: Tone } | null {
  switch (r.answer) {
    case "yes":
      return { text: "Yes", tone: "ok" };
    case "no":
      return { text: "No", tone: "" };
    case "call_me":
      return { text: "Call me", tone: "warn" };
    case "time":
      return { text: r.answer_text ?? (r.answer_time ? `At the office at ${r.answer_time}` : "A time"), tone: "live" };
    case "location":
      return { text: r.answer_text ?? "Shared where they are", tone: "live" };
    default:
      return r.answer_text ? { text: r.answer_text, tone: "" } : null;
  }
}

/** "Sent 10:02 · Seen 10:03 · Answered 10:05", as far as the driver got. */
export const stateLine = (r: Pick<AskDriverRow, "sent" | "seen" | "answered">): string =>
  joinDots([`Sent ${r.sent}`, r.seen && `Seen ${r.seen}`, r.answered && `Answered ${r.answered}`]);

/** Where a shared point is: "near Kadawatha · ±12 m". */
export const placeLine = (loc: NonNullable<AskDriverRow["location"]>): string =>
  joinDots([loc.near ? `near ${loc.near}` : "Shared point", loc.accuracy_m != null ? `±${loc.accuracy_m} m` : ""]);

/** "Open until Mon 20 Oct 09:00", or "Closed" once it expired. */
export const openLine = (a: Pick<Ask, "expired" | "expires">): string => (a.expired ? "Closed" : `Open until ${a.expires}`);

/** "5 asked · 3 seen · 2 answered · 1 yes" (yes only for a trip question). */
export function countsLine(a: Pick<Ask, "kind" | "counts">): string {
  const c = a.counts;
  return joinDots([`${c.asked} asked`, `${c.seen} seen`, `${c.answered} answered`, a.kind === "free_for_trip" ? `${c.yes} yes` : ""]);
}

/**
 * Assign on a Yes (a row the server marks assignable): the task's change page with the driver, else the request's decide
 * page, else a new task on the trip's day and time. Null when the row cannot be assigned or the person lacks the tool.
 */
export function assignLink(ask: Pick<Ask, "task_id" | "request_id" | "trip">, row: Pick<AskDriverRow, "assignable" | "username">, tools: readonly string[]): string | null {
  if (!row.assignable || !row.username) return null;
  const q = new URLSearchParams({ driver: row.username });
  if (ask.task_id) return tools.includes("update_task") ? `/tasks/${encodeURIComponent(ask.task_id)}/edit?${q}` : null;
  if (ask.request_id) return tools.includes("decide_request") ? `/requests/${encodeURIComponent(ask.request_id)}/decide?${q}` : null;
  if (!tools.includes("create_task")) return null;
  if (ask.trip?.date) q.set("date", ask.trip.date);
  if (ask.trip?.from) q.set("time", ask.trip.from);
  return `/tasks/new?${q}`;
}

/**
 * The driver a dispatch page opens with (?driver=<username>, from Assign on an answer); "" for none. TaskEdit's own
 * ?driver=1 (the push for a task that needs a driver) only focuses the field, so it is not a driver.
 */
export function linkedDriver(q: Pick<URLSearchParams, "get">): string {
  const d = (q.get("driver") ?? "").trim();
  return d && d !== "1" && d.length <= 80 ? d : "";
}

/** ?time=HH:MM on New task (the trip's From); "" when it is not a time. */
export function linkedTime(q: Pick<URLSearchParams, "get">): string {
  const t = (q.get("time") ?? "").trim();
  return isTime(t) ? t : "";
}

/**
 * Round 48: drivers_board's arguments for the Ask drivers page: the trip's day and times once a free_for_trip question
 * has them (every row then says free or busy for that window), else none (the board as it is now).
 */
export function tripBoardArgs(f: Pick<AskForm, "kind" | "date" | "from" | "to">): Record<string, unknown> {
  if (f.kind !== "free_for_trip" || !isDay(f.date) || !isTime(f.from)) return {};
  const args: Record<string, unknown> = { trip_date: f.date, trip_from: f.from };
  if (isTime(f.to) && f.to > f.from) args.trip_to = f.to;
  return args;
}
