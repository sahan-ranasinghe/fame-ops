// Round 48 (item 4): FREE / BUSY BY THE TRIP'S DATE, the one rule. Pure: only time.ts behind it, so fleet.ts (the assign
// check) and availability.ts (Who's available, the best match) read the same rule with no import cycle.
import { colomboDate, colomboDay, colomboTime, dayRange } from "./time.ts";

/** The window a list is asked for (availability.ts AvailabilityWindow, without the import). */
interface Window {
  from: string;
  /** null = the rest of the day. */
  to: string | null;
  /** The end of the window's day (the default `to`). */
  day_end: string;
}

/** A task as the window rule sees it. */
interface TaskEnd {
  end_by: string | null;
  /** The last planned departure (or arrival) of the task, when it has a plan. */
  ends_planned?: string | null;
}

// ---------------------------------------------------------------------------
// Round 48 (item 4): FREE / BUSY BY THE TRIP'S DATE. The pattern is Google Calendar's room and attendee picker: a room is
// free or busy for the MEETING'S time, never for "now". Every list that shows a driver or a vehicle for a task, a
// request, a trip, a proposed task or an ask (Who's available, Who can take it, the best match, suggest_vehicles, Ask
// drivers' All free, task_detail's suggestions, the assign check) takes its window from ONE rule, tripWindow: the trip's
// start, to its end time, else the plan's end, else the rest of the trip's day (the rule Who's available has always used
// for a trip with no end; the assign check used a single point before, so the two disagreed). The status now (on duty,
// off duty, on a task, last seen) stays on every row, marked as "now"; the chip says the trip's day.
// ---------------------------------------------------------------------------

export type WindowEndSource = "end_by" | "plan" | "day_end";

/** A trip's window as one rule: `to` is never null (the day's end stands in), `end_source` says where it came from. */
export interface TripWindow extends Window {
  to: string;
  end_source: WindowEndSource;
  /** The trip's Colombo day, YYYY-MM-DD. */
  day: string;
}

/**
 * The window every availability list uses for a trip: from its start to its end time, else the plan's end, else the end
 * of the trip's day. Pure. `dayEnd` is the Colombo day's end (dayRange(day).to); it is computed when not given.
 */
export function tripWindow(i: { start: string; endBy?: string | null; plannedEnd?: string | null; dayEnd?: string }): TripWindow {
  const day = colomboDate(i.start);
  const day_end = i.dayEnd ?? dayRange(day).to;
  const startMs = new Date(i.start).getTime();
  const after = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() > startMs;
  if (after(i.endBy)) return { from: i.start, to: i.endBy!, day_end, end_source: "end_by", day };
  if (after(i.plannedEnd)) return { from: i.start, to: i.plannedEnd!, day_end, end_source: "plan", day };
  return { from: i.start, to: day_end, day_end, end_source: "day_end", day };
}

/** "today", "tomorrow", else "Thu 29 Oct": the trip's day said from today (both Colombo days, YYYY-MM-DD). */
export function tripDayWords(day: string, today: string): string {
  if (day === today) return "today";
  const next = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  if (day === next) return "tomorrow";
  return colomboDay(`${day}T12:00:00+05:30`);
}

/** "Thu 29 Oct 09:00–13:00", "today 09:00–end of day": the window in words. */
export function windowWords(w: Pick<Window, "from" | "to">, today: string): string {
  const day = tripDayWords(colomboDate(w.from), today);
  return `${day} ${colomboTime(w.from)}–${w.to ? colomboTime(w.to) : "end of day"}`;
}

/** "Free Thu 29 Oct" / "Free today" / "Free tomorrow": the chip of a driver or a vehicle free for the trip. */
export const freeText = (day: string, today: string): string => `Free ${tripDayWords(day, today)}`;

/**
 * "Busy 09:00–13:00 that day · Team drop" / "Busy from 09:00 that day · Team drop": the chip of a driver or a vehicle
 * with a task overlapping the trip's window. The pieces (busy_from, busy_to, busy_title) go with it so the app can say
 * it in Sinhala.
 */
export function busyText(t: { start_at: string; end_by: string | null; title: string }): string {
  const when = t.end_by ? `${colomboTime(t.start_at)}–${colomboTime(t.end_by)}` : `from ${colomboTime(t.start_at)}`;
  return `Busy ${when} that day · ${t.title}`;
}

/** The pieces of a busy chip, for a client that says it in its own words. */
export function busyPieces(t: { start_at: string; end_by: string | null; title: string }): { busy_from: string; busy_to?: string; busy_title: string } {
  return { busy_from: colomboTime(t.start_at), ...(t.end_by ? { busy_to: colomboTime(t.end_by) } : {}), busy_title: t.title };
}

/** A task's end for an overlap: its end time, else the plan's end, else the end of the window's day. */
export function taskEndMs(t: TaskEnd, dayEnd: string): number {
  return new Date(t.end_by ?? t.ends_planned ?? dayEnd).getTime();
}

/** How soon a trip must start for the best match to want drivers on duty NOW, near the first stop now (2 hours). */
export const SOON_MS = 2 * 60 * 60 * 1000;

/** True when the trip starts within SOON_MS of now (or has started): the ranking then asks who is on duty now and near. */
export const startsSoon = (from: string, now: Date): boolean => new Date(from).getTime() - now.getTime() <= SOON_MS;
