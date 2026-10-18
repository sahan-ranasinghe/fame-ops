// Part 3b (H1, H2): when a driver is not available for dispatch, how that reads, their usual start time and when they were
// last seen. Pure (the tools load, this decides; the tests run it with no database).

import { addDays, colomboDate, colomboDay, colomboTime } from "./time.ts";

export type UnavailablePart = "full_day" | "morning" | "afternoon" | "hours";
export type UnavailableReason = "leave" | "half_day" | "personal" | "other";

/** One entry of driver_unavailability as the rules need it. */
export interface Unavailable {
  id: string;
  employee_id: string;
  starts_at: string;
  ends_at: string;
  part: string;
  reason: string;
  note?: string | null;
}

export const REASON_TEXT: Record<UnavailableReason, string> = {
  leave: "leave",
  half_day: "half day",
  personal: "personal",
  other: "other",
};

/** The entries that overlap [from, to). */
export function overlapping<T extends Pick<Unavailable, "starts_at" | "ends_at">>(entries: readonly T[], from: string, to: string): T[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return entries.filter((u) => Date.parse(u.starts_at) < b && a < Date.parse(u.ends_at));
}

/**
 * The words after "Not available · ": "leave, all day", "leave until Wed 22 Oct", "half day, back 13:00",
 * "personal, from 13:00", "other, 09:30–11:00". The last day of a full-day entry is the day before it ends (it ends at
 * midnight).
 */
export function unavailableDetail(u: Pick<Unavailable, "starts_at" | "ends_at" | "part" | "reason">): string {
  const reason = REASON_TEXT[u.reason as UnavailableReason] ?? u.reason;
  switch (u.part) {
    case "full_day": {
      const first = colomboDate(u.starts_at);
      const last = addDays(colomboDate(u.ends_at), -1);
      return last > first ? `${reason} until ${colomboDay(`${last}T12:00:00+05:30`)}` : `${reason}, all day`;
    }
    case "morning":
      return `${reason}, back ${colomboTime(u.ends_at)}`;
    case "afternoon":
      return `${reason}, from ${colomboTime(u.starts_at)}`;
    default:
      return `${reason}, ${colomboTime(u.starts_at)}–${colomboTime(u.ends_at)}`;
  }
}

/** "Not available · half day, back 13:00" */
export const unavailableText = (u: Pick<Unavailable, "starts_at" | "ends_at" | "part" | "reason">): string =>
  `Not available · ${unavailableDetail(u)}`;

/**
 * The assign warning for a driver with an entry on the task's day (H1): "Kamal is not available then · half day, back 13:00"
 * when it overlaps the task, else "Kamal is not available that day · …". Null when the day has none.
 */
export function unavailableWarning(
  driverName: string,
  entries: readonly Unavailable[],
  taskFrom: string,
  taskTo: string,
  dayFrom: string,
  dayTo: string,
): { text: string; overlaps: boolean } | null {
  const first = driverName.split(" ")[0];
  const clash = overlapping(entries, taskFrom, taskTo)[0];
  if (clash) return { text: `${first} is not available then · ${unavailableDetail(clash)}`, overlaps: true };
  const sameDay = overlapping(entries, dayFrom, dayTo)[0];
  return sameDay ? { text: `${first} is not available that day · ${unavailableDetail(sameDay)}`, overlaps: false } : null;
}

/** Minutes after midnight, Colombo. */
function minuteOfDay(iso: string): number {
  const [h, m] = colomboTime(iso).split(":").map(Number);
  return h * 60 + m;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The usual start time (H2): the median of the first Start work of each of the last `days` days the driver was on duty,
 * from 3 such days on. `starts` are duty sessions' started_at (any order). "07:40" or null.
 */
export function usualStart(starts: readonly string[], days = 20, minDays = 3): string | null {
  const firstOfDay = new Map<string, string>();
  for (const s of starts) {
    const day = colomboDate(s);
    const seen = firstOfDay.get(day);
    if (!seen || s < seen) firstOfDay.set(day, s);
  }
  const recent = [...firstOfDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, days).map(([, s]) => minuteOfDay(s));
  if (recent.length < minDays) return null;
  const sorted = recent.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return hhmm(median);
}

/** "Last seen 17:42 near Kadawatha" · "Last seen Fri 16 Oct 17:42" · null when never seen. */
export function lastSeenText(at: string | null | undefined, town: string | null | undefined, now: Date): string | null {
  if (!at) return null;
  const when = colomboDate(at) === colomboDate(now) ? colomboTime(at) : `${colomboDay(at)} ${colomboTime(at)}`;
  return `Last seen ${when}${town ? ` near ${town}` : ""}`;
}

/** The board's status now (H2): on a task, not available (an entry covers now), on duty, off duty. */
export type BoardStatus = "on_task" | "not_available" | "on_duty" | "off_duty";

/** "Not available, back 13:00" for the status line (the entry covering now). */
export function notAvailableNow(u: Pick<Unavailable, "starts_at" | "ends_at" | "part" | "reason">, now: Date): string {
  const sameDay = colomboDate(u.ends_at) === colomboDate(now);
  const endsMidnight = colomboTime(u.ends_at) === "00:00";
  if (sameDay && !endsMidnight) return `Not available, back ${colomboTime(u.ends_at)}`;
  if (u.part === "full_day" || endsMidnight) {
    const last = addDays(colomboDate(u.ends_at), -1);
    return last > colomboDate(now) ? `Not available until ${colomboDay(`${last}T12:00:00+05:30`)}` : "Not available today";
  }
  return `Not available until ${colomboDay(u.ends_at)} ${colomboTime(u.ends_at)}`;
}

/** Part 3b (H4): the driver's last "Running late", for the task page, the board and Live. Undefined when none. */
export function lateReportOf(
  t: { late_report_min?: number | null; late_report_at?: string | null; status?: string },
  now: Date,
): { min: number; said: string; text: string } | undefined {
  if (!t.late_report_min || !t.late_report_at) return undefined;
  if (t.status && !["assigned", "in_progress"].includes(t.status)) return undefined;
  const said = colomboDate(t.late_report_at) === colomboDate(now) ? colomboTime(t.late_report_at) : colomboDay(t.late_report_at);
  return { min: t.late_report_min, said, text: `Running late ${t.late_report_min} min · said ${said}` };
}
