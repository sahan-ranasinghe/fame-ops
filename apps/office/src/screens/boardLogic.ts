// Part 3b (H5): the Drivers board's pure part: the filters (the server's own rules: free now = free and on duty; on a task,
// off duty and not available by the status now) with their counts, the search (name and username, as the server's plain
// text), the week's days (Monday first), and the week grid from a drivers_board answer: drivers × 7 days, each cell its
// tasks and its not-available entries, a past day marked (nothing is added to a day that has passed). Pure.
import type { BoardDriver, BoardFilter, DriversBoard, UnavailableEntry } from "../data/types";
import { addDays } from "../lib/format";

export const BOARD_FILTERS: [BoardFilter, string][] = [
  ["all", "All"],
  ["free_now", "Free now"],
  ["on_task", "On a task"],
  ["off_duty", "Off duty"],
  ["not_available", "Not available"],
];
export const BOARD_FILTER_KEYS: readonly BoardFilter[] = BOARD_FILTERS.map(([k]) => k);

export type BoardView = "now" | "week";
export const BOARD_VIEWS: readonly BoardView[] = ["now", "week"];

/** The server's matching rule for a filter (tools/board.ts). */
export function matchesFilter(d: Pick<BoardDriver, "free_now" | "status">, f: BoardFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "free_now":
      return d.free_now;
    default:
      return d.status?.kind === f;
  }
}

/** The server's search text: lower case, letters and digits only. */
export const plainText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The driver matches what is typed (name or username); an empty search matches everyone. */
export function matchesSearch(d: Pick<BoardDriver, "name" | "username">, q: string): boolean {
  const key = plainText(q);
  return !key || plainText(`${d.name} ${d.username ?? ""}`).includes(key);
}

/** How many drivers each filter holds, among those the search finds. */
export function boardCounts(drivers: BoardDriver[], q = ""): Record<BoardFilter, number> {
  const found = drivers.filter((d) => matchesSearch(d, q));
  return Object.fromEntries(BOARD_FILTER_KEYS.map((f) => [f, found.filter((d) => matchesFilter(d, f)).length])) as Record<BoardFilter, number>;
}

/** The rows shown: the filter and the search, in the server's order. */
export function filterBoard(drivers: BoardDriver[], f: BoardFilter, q = ""): BoardDriver[] {
  return drivers.filter((d) => matchesFilter(d, f) && matchesSearch(d, q));
}

/** What an empty list means, in words. */
export function boardEmpty(f: BoardFilter, q: string): string {
  if (q) {
    const group = f === "all" ? "" : ` among "${BOARD_FILTERS.find(([k]) => k === f)?.[1]}"`;
    return `No driver matches "${q}" (name or username)${group}.`;
  }
  return {
    all: "No active drivers.",
    free_now: "Nobody is free right now.",
    on_task: "Nobody is on a task right now.",
    off_duty: "Nobody is off duty right now.",
    not_available: "Everyone is available right now.",
  }[f];
}

/** A driver's key on the board (the username, else the name). */
export const driverKey = (d: { username?: string | null; name: string }) => d.username ?? d.name;

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** The Monday of the week holding `date` (YYYY-MM-DD). */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The week view's first day from the URL (?from=): any date moves to its Monday; none = this week's Monday. */
export function weekStart(fromParam: string | null | undefined, today: string): string {
  return mondayOf(isDate(fromParam) ? fromParam : today);
}

/** "Mon 20" and "Oct" for a column head; `today` marks the column. */
export function dayHead(date: string): { day: string; month: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    day: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }),
    month: d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
}

/** "20 – 26 Oct 2026", "27 Oct – 2 Nov 2026" for the week's heading. */
export function weekLabel(from: string): string {
  const to = addDays(from, 6);
  const f = new Date(`${from}T12:00:00Z`), t = new Date(`${to}T12:00:00Z`);
  const opt = (o: Intl.DateTimeFormatOptions) => ({ ...o, timeZone: "UTC" });
  const left = f.getUTCMonth() === t.getUTCMonth()
    ? f.toLocaleDateString("en-GB", opt({ day: "numeric" }))
    : f.toLocaleDateString("en-GB", opt({ day: "numeric", month: "short" }));
  return `${left} – ${t.toLocaleDateString("en-GB", opt({ day: "numeric", month: "short", year: "numeric" }))}`;
}

export interface WeekTask {
  id: string;
  title: string;
  time: string;
  end?: string;
  status: string;
}

export interface WeekCell {
  date: string;
  tasks: WeekTask[];
  off: UnavailableEntry[];
  /** The day has passed: nothing is added to it. */
  past: boolean;
  today: boolean;
}

export interface WeekRow {
  key: string;
  name: string;
  username?: string;
  photo_url?: string;
  cells: WeekCell[];
}

export interface WeekGrid {
  from: string;
  to: string;
  days: string[];
  rows: WeekRow[];
}

/**
 * The week grid from a drivers_board answer with week_from: one row per driver shown (`shown`, in its order; a driver the
 * week lacks gets empty days), 7 cells each. Null when the answer has no week.
 */
export function weekGrid(board: Pick<DriversBoard, "week"> | undefined, shown: Pick<BoardDriver, "name" | "username" | "photo_url">[], today: string): WeekGrid | null {
  const week = board?.week;
  if (!week) return null;
  const byKey = new Map(week.drivers.map((d) => [driverKey(d), d]));
  const rows = shown.map((s) => {
    const w = byKey.get(driverKey(s));
    return {
      key: driverKey(s),
      name: s.name,
      username: s.username,
      photo_url: s.photo_url,
      cells: week.days.map((date) => {
        const day = w?.days.find((x) => x.date === date);
        return {
          date,
          tasks: [...(day?.tasks ?? [])].sort((a, b) => a.time.localeCompare(b.time)),
          off: day?.not_available ?? [],
          past: date < today,
          today: date === today,
        };
      }),
    };
  });
  return { from: week.from, to: week.to, days: week.days, rows };
}

/** "09:00–11:30 Team drop", or "09:00 Team drop" with no end. */
export const weekTaskText = (t: WeekTask) => `${t.time}${t.end ? `–${t.end}` : ""} ${t.title}`;
