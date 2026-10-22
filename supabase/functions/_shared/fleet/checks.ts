// Round 4–7, feature 4 (Sahan, 22 October 2026): the vehicle check before work and the close of a trip nobody drives with
// the app. Pure rules, shared by the tools (tools/checks.ts) and their tests; the database keeps the data
// (migrations 20261022120100_round4_vehicle_check, 20261022120200_round4_trip_close).

import { colomboDate, colomboTime } from "./time.ts";

export const CHECK_RESULTS = ["ok", "problem"] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

/** A problem's category: the five of a driver's report and Damage (Round 4–7). */
export const REPORT_CATEGORIES = ["breakdown", "accident", "tyre", "warning_light", "damage", "other"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_TEXT: Record<ReportCategory, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  tyre: "Tyre",
  warning_light: "Warning light",
  damage: "Damage",
  other: "Other problem",
};

export const CHECK_HOW_TEXT: Record<string, string> = {
  clock_in: "Start work",
  change: "Change vehicle",
  task_start: "Start task",
  vehicle_confirm: "Vehicle confirmed",
  trip: "Before the trip",
};

export const SIDES = ["front", "back", "left", "right"] as const;
export type Side = (typeof SIDES)[number];

/** A problem's photos: at least one, at most six (one notification per check, never per photo). */
export const MIN_PROBLEM_PHOTOS = 1;
export const MAX_PROBLEM_PHOTOS = 6;

export const resultText = (result: string, category?: string | null): string =>
  result === "ok" ? "All good" : `Problem: ${CATEGORY_TEXT[category as ReportCategory] ?? "reported"}`;

/** How long before its planned start a no-app trip's check starts it (On the way): 2 hours, on the trip's day. */
export const START_WINDOW_MIN = 120;

export interface TripWindow {
  /** The check now starts the trip. */
  open: boolean;
  /** When it opens (HH:MM Colombo), on the trip's day. */
  opens_at: string;
  /** The trip's day is over (Colombo). */
  past: boolean;
}

/** Whether a check now starts a no-app trip planned to leave at `startAt`: the trip's day and from 2 h before. Pure. */
export function tripWindow(startAt: string, now: Date): TripWindow {
  const start = new Date(startAt);
  const opens = new Date(start.getTime() - START_WINDOW_MIN * 60_000);
  const day = colomboDate(start);
  const today = colomboDate(now);
  // The window never opens on the day before (a 01:00 trip opens at 00:00 its own day).
  const opensAt = colomboDate(opens) === day ? opens : new Date(`${day}T00:00:00+05:30`);
  return {
    open: today === day && now.getTime() >= opensAt.getTime(),
    opens_at: colomboTime(opensAt),
    past: today > day,
  };
}

/** Where a no-app trip is, for the person it is on. */
export type NoAppState =
  | "to_check" // not started: the check of the day starts it (or records it, before the window)
  | "on_the_way" // started by its check
  | "finish" // started and its end has come: "Trip finished? Enter the odometer"
  | "done" // completed with its readings
  | "not_confirmed" // closed at 09:00 without them: the odometer still confirms it
  | "cancelled"
  | "other"; // declined, missed: nothing to do here

export interface NoAppTask {
  status: string;
  started_at: string | null;
  finish_flag: unknown;
  finish_ask_sent_at: string | null;
}

export function noAppState(t: NoAppTask): NoAppState {
  const flag = (t.finish_flag as { kind?: string } | null)?.kind;
  if (t.status === "completed") return flag === "not_confirmed" ? "not_confirmed" : "done";
  if (t.status === "cancelled") return "cancelled";
  if (t.status === "in_progress") return t.finish_ask_sent_at ? "finish" : "on_the_way";
  if (t.status === "assigned") return "to_check";
  return "other";
}

/** An odometer typed by the person: a whole number, never under the vehicle's last reading, never a jump of over 3,000 km. */
export const MAX_TRIP_KM = 3000;
export function odometerProblem(reading: number, last: number | null, name = "The odometer"): string | null {
  if (!Number.isInteger(reading) || reading < 0) return `${name} is a whole number of km.`;
  if (last != null && reading < last) return `${name} (${reading} km) is under the vehicle's last reading (${last} km). Check the number.`;
  if (last != null && reading - last > MAX_TRIP_KM) {
    return `${name} (${reading} km) is ${reading - last} km over the vehicle's last reading (${last} km). Check the number.`;
  }
  return null;
}
