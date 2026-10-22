// Round 4–7, feature 4 (phase8-plan.md §33.1): the rules of a trip nobody drives with the app, on the person's own account
// (/my-trips/:task, my_trip), and of the vehicle checks the office reads (the vehicle page, a task, Issues). Pure: the page
// (MyTripPage.tsx) and the check views (VehicleChecks.tsx) render what these decide; Vitest checks them.
//
// The person's side (Samsara / Motive's pre-trip inspection; Zipcar's and Turo's return):
// - check: "Any damage or problem with <plate>?" All good (optional the four sides) or a problem (a category, 1–6 photos,
//   a note), and the odometer now (prefilled with the vehicle's last reading, never under it). On the trip's day from 2 h
//   before its planned start the check starts the trip; earlier it only records the check. The switch vehicle_check off
//   (my_trip's check_needed false): only the odometer, which starts the trip from the window.
// - finish: "Trip finished? Enter the odometer": the odometer now (never under the start), the start when there is none
//   (the vehicle's last reading by default), the fuel added and an odometer photo (both optional). Confirm = the same form
//   for a trip closed as Completed · not confirmed.
import type { CheckResult, MyTrip, ReportCategory, TripAction, VehicleCheck } from "../data/types";

/** The six kinds of problem (the driver's five and Damage), in the server's words. */
export const CATEGORIES: readonly (readonly [ReportCategory, string])[] = [
  ["damage", "Damage"],
  ["tyre", "Tyre"],
  ["warning_light", "Warning light"],
  ["breakdown", "Breakdown"],
  ["accident", "Accident"],
  ["other", "Other problem"],
];
export const categoryText = (c?: string) => CATEGORIES.find(([k]) => k === c)?.[1] ?? "Problem";

/** The four sides of an all-good check (Turo's check-in photos). */
export const SIDES = ["front", "back", "left", "right"] as const;
export type Side = (typeof SIDES)[number];
export const SIDE_TEXT: Record<Side, string> = { front: "Front", back: "Back", left: "Left", right: "Right" };

export const MIN_PROBLEM_PHOTOS = 1;
export const MAX_PROBLEM_PHOTOS = 6;
/** A typed odometer more than this over the last reading (or the start) is a typing mistake (the server's rule). */
export const MAX_TRIP_KM = 3000;
export const MAX_LITRES = 500;
export const MAX_LKR = 1_000_000;

/** The button on a My trips row, by what the trip asks of the person now. */
export const TRIP_ACTION_TEXT: Record<TripAction, string> = { check: "Vehicle check", finish: "Trip finished?", confirm: "Enter the odometer" };

/** The task a My trips card's button opens (a request's task, or the created task itself). */
export const tripTaskId = (card: { task_id?: string; id: string; source?: string }): string | undefined =>
  card.task_id ?? (card.source === "task" ? card.id : undefined);

export type TripMode = "check" | "finish" | "confirm" | "done" | "cancelled" | "other";

/**
 * What the page asks for: the check before setting off (not started, its day not over), the finish (started, asked, or a
 * day over with no check), the confirm (closed as Completed · not confirmed), else nothing to do. `finishing` = the person
 * chose "Trip already done?" on the check.
 */
export function tripMode(t: Pick<MyTrip, "state" | "window">, finishing = false): TripMode {
  switch (t.state) {
    case "to_check":
      return t.window.past || finishing ? "finish" : "check";
    case "on_the_way":
    case "finish":
      return "finish";
    case "not_confirmed":
      return "confirm";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "other";
  }
}

/** "WP CAB-4521" or the vehicle's words. */
export const plateWords = (t: Pick<MyTrip, "vehicle" | "vehicle_label">) => t.vehicle || t.vehicle_label || "the vehicle";

/** A typed number of km ("45 210", "45,210") as a whole number, or null. */
export function parseKm(text: string): number | null {
  const s = text.replace(/[\s,]/g, "");
  if (!/^\d{1,7}$/.test(s)) return null;
  return Number(s);
}

/** A typed positive amount ("12.5", "4,500"), or null; "" = not given. */
export function parseAmount(text: string): number | null | "" {
  const s = text.replace(/[\s,]/g, "");
  if (s === "") return "";
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const km = (n: number) => `${n.toLocaleString("en-US")} km`;

/** What is wrong with an odometer typed against the reading it must not be under (null = fine). */
export function odometerReason(typed: string, base: number | null | undefined, against: "last" | "start"): string | null {
  if (!typed.trim()) return "Enter the odometer";
  const n = parseKm(typed);
  if (n === null) return "The odometer is a whole number of km";
  if (base != null && n < base) {
    return against === "last" ? `Under the vehicle's last reading (${km(base)}): check the number` : `Under the start (${km(base)}): check the number`;
  }
  if (base != null && n - base > MAX_TRIP_KM) return `${km(n - base)} more than ${against === "last" ? "the last reading" : "the start"}: check the number`;
  return null;
}

export interface CheckForm {
  /** null = not answered yet (the question is asked only while the switch vehicle_check is on). */
  result: CheckResult | null;
  odometer: string;
  category: ReportCategory | "";
  note: string;
  /** The problem's photos already uploaded (their ids). */
  photos: string[];
  /** The sides already uploaded. */
  sides: { photo_id: string; side: Side }[];
  /** Photos still going up. */
  uploading: number;
}

export const emptyCheck = (t: Pick<MyTrip, "last_odometer_km">): CheckForm => ({
  result: null,
  odometer: t.last_odometer_km != null ? String(t.last_odometer_km) : "",
  category: "",
  note: "",
  photos: [],
  sides: [],
  uploading: 0,
});

/**
 * When the check starts the trip. `onDay` is the trip's day inside a sentence from the page ("today", "tomorrow", "on Thu
 * 23 Oct").
 */
export function windowLine(t: Pick<MyTrip, "window" | "check_needed">, onDay: string): string {
  if (t.window.open) return t.check_needed ? "Your check starts the trip (On the way)." : "Enter the odometer to start the trip (On the way).";
  return t.check_needed
    ? `The trip starts ${onDay} from ${t.window.opens_at}: a check now is only recorded. Check again then.`
    : `The trip starts ${onDay} from ${t.window.opens_at}.`;
}

/** Why the check's button is not ready (null = ready). */
export function checkReason(t: Pick<MyTrip, "check_needed" | "window" | "last_odometer_km">, f: CheckForm, onDay: string): string | null {
  if (!t.check_needed && !t.window.open) return `You can start the trip ${onDay} from ${t.window.opens_at}`;
  if (t.check_needed && f.result === null) return "Answer the question: any damage or problem?";
  if (t.check_needed && f.result === "problem") {
    if (!f.category) return "Pick what the problem is";
    if (f.photos.length < MIN_PROBLEM_PHOTOS && f.uploading === 0) return "Add at least one photo of the problem";
  }
  if (f.uploading > 0) return "Wait for the photos to go up";
  return odometerReason(f.odometer, t.last_odometer_km, "last");
}

/** The check's button words. */
export function checkButton(t: Pick<MyTrip, "check_needed" | "window">, f: Pick<CheckForm, "result">): string {
  if (!t.check_needed) return "Start trip";
  if (!t.window.open) return f.result === "problem" ? "Send the problem" : "Save check";
  return f.result === "problem" ? "Send and start trip" : "Start trip";
}

/** my_trip_check's input (the check's id made by the page, so a retry never doubles it). */
export function checkInput(taskId: string, checkId: string, t: Pick<MyTrip, "check_needed">, f: CheckForm): Record<string, unknown> {
  const odometer = parseKm(f.odometer) ?? 0;
  if (!t.check_needed || f.result !== "problem") {
    return {
      task_id: taskId,
      check_id: checkId,
      result: "ok",
      odometer_km: odometer,
      ...(t.check_needed && f.sides.length ? { sides: f.sides } : {}),
    };
  }
  const note = f.note.trim();
  return {
    task_id: taskId,
    check_id: checkId,
    result: "problem",
    odometer_km: odometer,
    category: f.category,
    ...(note ? { note } : {}),
    photos: f.photos,
  };
}

export interface FinishForm {
  odometer: string;
  /** Only when the trip has no start reading (never checked): the vehicle's last reading by default. */
  start: string;
  litres: string;
  amount: string;
  photo: string | null;
  uploading: boolean;
}

export const emptyFinish = (t: Pick<MyTrip, "last_odometer_km" | "start_odometer_km">): FinishForm => ({
  odometer: "",
  start: t.start_odometer_km == null && t.last_odometer_km != null ? String(t.last_odometer_km) : "",
  litres: "",
  amount: "",
  photo: null,
  uploading: false,
});

/** The trip has no start reading: the form asks it (the vehicle's last reading by default). */
export const needsStart = (t: Pick<MyTrip, "start_odometer_km">) => t.start_odometer_km == null;

/** The start the finish is measured from: the trip's, else what is typed. */
export function startOf(t: Pick<MyTrip, "start_odometer_km">, f: Pick<FinishForm, "start">): number | null {
  return t.start_odometer_km ?? parseKm(f.start);
}

/** Why the finish's button is not ready (null = ready). */
export function finishReason(t: Pick<MyTrip, "start_odometer_km">, f: FinishForm): string | null {
  if (needsStart(t)) {
    const s = odometerReason(f.start, null, "start");
    if (s) return s === "Enter the odometer" ? "Enter the odometer at the start" : s;
  }
  const end = odometerReason(f.odometer, startOf(t, f), "start");
  if (end) return end;
  const litres = parseAmount(f.litres);
  if (litres === null || (typeof litres === "number" && (litres <= 0 || litres > MAX_LITRES))) return `Litres: a number up to ${MAX_LITRES}`;
  const amount = parseAmount(f.amount);
  if (amount === null || (typeof amount === "number" && amount > MAX_LKR)) return "Amount: LKR up to 1,000,000";
  if (f.uploading) return "Wait for the photo to go up";
  return null;
}

/** The km of the trip as typed so far ("42 km"), or null. */
export function tripKm(t: Pick<MyTrip, "start_odometer_km">, f: Pick<FinishForm, "start" | "odometer">): number | null {
  const start = startOf(t, f);
  const end = parseKm(f.odometer);
  return start != null && end != null && end >= start ? end - start : null;
}

/** finish_my_trip's input. */
export function finishInput(taskId: string, t: Pick<MyTrip, "start_odometer_km">, f: FinishForm): Record<string, unknown> {
  const litres = parseAmount(f.litres);
  const amount = parseAmount(f.amount);
  const fuel = {
    ...(typeof litres === "number" ? { litres } : {}),
    ...(typeof amount === "number" ? { amount_lkr: amount } : {}),
  };
  return {
    task_id: taskId,
    odometer_km: parseKm(f.odometer) ?? 0,
    ...(needsStart(t) && parseKm(f.start) != null ? { start_odometer_km: parseKm(f.start) } : {}),
    ...(Object.keys(fuel).length ? { fuel } : {}),
    ...(f.photo ? { photo: f.photo } : {}),
  };
}

/** "Started 07:42 · 45,210 km" and the like: what the trip already has. */
export function tripFacts(t: MyTrip): string[] {
  const out: string[] = [];
  if (t.check) out.push(`Checked ${t.check.at}${t.check.result === "problem" ? " · problem reported" : " · all good"}${t.check.odometer_km != null ? ` · ${km(t.check.odometer_km)}` : ""}`);
  if (t.started && t.state !== "to_check") out.push(`Started ${t.started}${t.start_odometer_km != null ? ` · ${km(t.start_odometer_km)}` : ""}`);
  if (t.end_odometer_km != null) out.push(`Finished at ${km(t.end_odometer_km)}${t.km != null ? ` · ${km(t.km)}` : ""}`);
  return out;
}

// ---- The office's view of the checks ----

/** The chip's tone of a check: a problem warns, all good is fine. */
export const checkTone = (result: CheckResult): "ok" | "bad" => (result === "problem" ? "bad" : "ok");

/** "07:42 · All good · 45,210 km · Start work" for a check row. */
export function checkLine(c: Pick<VehicleCheck, "at" | "result_text" | "odometer_km" | "how_text">): string {
  return [c.at, c.result_text, c.odometer_km != null ? km(c.odometer_km) : "", c.how_text].filter(Boolean).join(" · ");
}

/** vehicle_checks' input for a vehicle's last 7 days (today and the 6 before). */
export function lastWeekArgs(plate: string, today: string): { vehicle: string; from: string; to: string; limit: number } {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return { vehicle: plate, from: d.toISOString().slice(0, 10), to: today, limit: 50 };
}

/** The checks grouped by day, newest first (the answer is newest first already). */
export function byDay(checks: readonly VehicleCheck[]): { date: string; checks: VehicleCheck[] }[] {
  const out: { date: string; checks: VehicleCheck[] }[] = [];
  for (const c of checks) {
    const last = out[out.length - 1];
    if (last && last.date === c.date) last.checks.push(c);
    else out.push({ date: c.date, checks: [c] });
  }
  return out;
}

/** A task's check line: "Vehicle check 07:42 · All good" / "Vehicle check 07:42 · Problem: Damage". */
export const taskCheckLine = (c: Pick<VehicleCheck, "at" | "result_text">) => `Vehicle check ${c.at} · ${c.result_text}`;

/** A task's finish flag as its chip: Completed · not confirmed (grey), Completed early (amber). */
export function finishChip(flag: { kind: string } | undefined | null): { text: string; tone: "" | "warn" } | null {
  if (!flag) return null;
  if (flag.kind === "not_confirmed") return { text: "Completed · not confirmed", tone: "" };
  if (flag.kind === "completed_early") return { text: "Completed early", tone: "warn" };
  return { text: flag.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), tone: "warn" };
}
