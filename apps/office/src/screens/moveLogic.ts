// Move to vehicle (Phase 7 §2), the rules of the page: which vehicles a driver
// on duty can be moved to and what each row says (one vehicle, one driver:
// taking a held vehicle takes it from its holder, who is told), the input of
// move_driver_vehicle and the sentence after it. Pure; the page is MoveVehicle.tsx.
// Part 2 (§2 addition): for a driver on a running task the page is a swap (a
// breakdown): the task goes on in the new vehicle, the odometer readings at the
// swap typed here or asked on the driver's phone.
import { dutyOf } from "../data/live";
import type { LiveDriver, VehicleCard } from "../data/types";
import { joinDots, plateOf } from "../lib/format";

/** "" in the radio list = No vehicle. */
export const NO_VEHICLE = "";

const plateKey = (v: string) => plateOf(v).replace(/[\s-]/g, "").toUpperCase();
/** Two plates (or "plate · make" labels) are the same vehicle: spaces and dashes do not matter. */
export const samePlate = (a?: string | null, b?: string | null) => !!a && !!b && plateKey(a) === plateKey(b);

export interface MoveRow {
  reg_no: string;
  /** "Toyota HiAce · 14 seats" */
  what: string;
  /** "Current vehicle · since 08:40", "With Nuwan Perera now · since 07:55", "Free", "In garage", "On a task with Nuwan Perera · back ~14:30". */
  note: string;
  tone: "" | "warn" | "bad";
  current: boolean;
  /** On another driver's running task: shown, not selectable (the server refuses it too). */
  disabled: boolean;
  /** Who holds it now, when that is someone else (they are told when it is taken). */
  held_by?: string;
}

/**
 * The rows of the radio list: every active vehicle, the driver's current one first, then the
 * free ones, the ones someone else holds, the ones in the garage, and last the ones on another
 * driver's running task (disabled, with the reason). `who.vehicle` is the live card's vehicle.
 */
export function moveRows(vehicles: VehicleCard[], who: { name: string; vehicle?: string }, live: LiveDriver[] = []): MoveRow[] {
  const ranked = vehicles.filter((v) => v.active !== false).map((v, i) => {
    const current = samePlate(who.vehicle, v.reg_no) || (!!v.held_by && v.held_by === who.name);
    const onTask = !current && v.status === "On a task";
    const garage = v.status === "In garage" || v.in_garage === true;
    const heldBy = !current && v.held_by && v.held_by !== who.name ? v.held_by : undefined;
    const booked = !onTask && v.availability?.startsWith("Booked") ? v.availability : undefined;
    let note: string, tone: MoveRow["tone"] = "", rank: number;
    if (current) {
      note = joinDots(["Current vehicle", v.held_since && `since ${v.held_since}`]);
      rank = 0;
    } else if (onTask) {
      const driver = live.find((d) => dutyOf(d) === "on_task" && samePlate(d.vehicle, v.reg_no))?.driver;
      note = joinDots([driver ? `On a task with ${driver}` : "On a task", v.back_at && `back ~${v.back_at}`]);
      tone = "bad";
      rank = 4;
    } else if (garage) {
      note = joinDots(["In garage", heldBy && `with ${heldBy}`]);
      tone = "warn";
      rank = 3;
    } else if (heldBy) {
      note = joinDots([`With ${heldBy} now`, v.held_since && `since ${v.held_since}`]);
      tone = "warn";
      rank = 2;
    } else {
      note = "Free";
      rank = 1;
    }
    const row: MoveRow = { reg_no: v.reg_no, what: joinDots([v.make_model, v.seats ? `${v.seats} seats` : ""]), note: joinDots([note, booked]), tone, current, disabled: onTask, held_by: heldBy };
    return { row, rank, i };
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.row);
}

/** What is chosen before the person picks: the driver's current vehicle, or No vehicle. */
export const currentChoice = (rows: MoveRow[]) => rows.find((r) => r.current)?.reg_no ?? NO_VEHICLE;

/** Move is offered for a change only, and never onto a vehicle on someone's running task. */
export function canMove(rows: MoveRow[], choice: string): boolean {
  if (choice === currentChoice(rows)) return false;
  if (choice === NO_VEHICLE) return true;
  const r = rows.find((x) => x.reg_no === choice);
  return !!r && !r.disabled;
}

/** The line under the list: what Move will do, or why it is not offered. `first` is the driver's first name. */
export function moveHint(rows: MoveRow[], choice: string, first: string): string {
  const current = currentChoice(rows);
  if (choice === current) return current ? `${first} is on ${current} now: pick another vehicle, or No vehicle.` : `${first} has no vehicle now: pick one.`;
  if (choice === NO_VEHICLE) return `${first} stays on duty without a vehicle.`;
  const r = rows.find((x) => x.reg_no === choice);
  if (!r) return "Pick a vehicle.";
  if (r.disabled) return `${r.reg_no} is on another driver's running task.`;
  return r.held_by ? `${r.held_by} no longer holds ${r.reg_no} and is told.` : `${first} takes ${r.reg_no}.`;
}

/** move_driver_vehicle's input: the driver's username and the plate, or null for no vehicle. */
export const moveInput = (username: string, choice: string) => ({ driver: username, vehicle: choice === NO_VEHICLE ? null : choice });

/** move_driver_vehicle's answer: vehicle is the label ("WP CAB-4521 · Toyota HiAce") or "none". */
export interface MoveResult {
  driver: string;
  vehicle: string;
  taken_from?: string;
  note?: string;
}

/** "Kamal Perera is now on WP CAB-4521. Nuwan Perera was told." */
export function moveSentence(r: MoveResult): string {
  const s = r.vehicle && r.vehicle !== "none" ? `${r.driver} is now on ${plateOf(r.vehicle)}.` : `${r.driver} now has no vehicle.`;
  return r.taken_from ? `${s} ${r.taken_from} was told.` : s;
}

/** Why the form is not shown (off duty); undefined = the driver can be moved (on duty) or the vehicle swapped (on a task). */
export function notMovable(d: LiveDriver): string | undefined {
  if (dutyOf(d) === "off_duty") return `${d.driver} is off duty. The vehicle is chosen on the phone at Start work.`;
  return undefined;
}

/** What the page does: move a driver on duty, swap the vehicle of a running task, or nothing (off duty). */
export type MoveMode = "move" | "swap" | "none";
export function moveMode(d: Pick<LiveDriver, "duty" | "task" | "state" | "signal">): MoveMode {
  const duty = dutyOf(d);
  return duty === "on_task" ? "swap" : duty === "on_duty" ? "move" : "none";
}

// ---------------------------------------------------------------------------
// The swap during a task (Part 2, §2 addition)
// ---------------------------------------------------------------------------

/** The swap's rows: the task's vehicle now is shown, not offered; the rest as for a move. */
export function swapRows(rows: MoveRow[]): MoveRow[] {
  return rows.map((r) => (r.current ? { ...r, note: "The task's vehicle now", tone: "", disabled: true } : r));
}

/** Swap is offered for another vehicle that is not on someone else's running task; never "no vehicle". */
export function canSwap(rows: MoveRow[], choice: string | null): boolean {
  if (!choice) return false;
  const r = rows.find((x) => x.reg_no === choice);
  return !!r && !r.disabled && !r.current;
}

/** The line under the list: what Swap will do, or what is missing. */
export function swapHint(rows: MoveRow[], choice: string | null): string {
  const r = choice ? rows.find((x) => x.reg_no === choice) : undefined;
  if (!r || r.current) return "Pick the vehicle the task goes on in.";
  if (r.disabled) return `${r.reg_no} is on another driver's running task.`;
  return `The task goes on in ${r.reg_no}${r.held_by ? `; ${r.held_by} no longer holds it and is told` : ""}. The old vehicle is free.`;
}

/** The highest odometer reading the server takes. */
export const MAX_KM = 9_999_999;

/** An odometer field: empty = the driver enters it on the phone; else whole km, not negative. Spaces and commas are ignored. */
export function parseKm(text: string): { km?: number } | { error: string } {
  const t = text.replace(/[\s,]/g, "");
  if (t === "") return {};
  if (t.startsWith("-")) return { error: "can't be negative" };
  if (/^\d+\.\d*$/.test(t)) return { error: "whole km only" };
  if (!/^\d+$/.test(t)) return { error: "a number of km" };
  const km = Number(t);
  if (km > MAX_KM) return { error: "too big for an odometer" };
  return { km };
}

export interface SwapFields {
  oldKm: string;
  newKm: string;
  reason: string;
}

/** move_driver_vehicle's input for a swap: the plate, the readings typed, the reason; or what is wrong. */
export function swapInput(username: string, choice: string | null, f: SwapFields): { error: string } | { input: Record<string, unknown> } {
  if (!choice) return { error: "Pick the vehicle the task goes on in." };
  const oldKm = parseKm(f.oldKm);
  if ("error" in oldKm) return { error: `Old vehicle's odometer: ${oldKm.error}.` };
  const newKm = parseKm(f.newKm);
  if ("error" in newKm) return { error: `New vehicle's odometer: ${newKm.error}.` };
  const input: Record<string, unknown> = { driver: username, vehicle: choice };
  if (oldKm.km !== undefined) input.old_end_km = oldKm.km;
  if (newKm.km !== undefined) input.new_start_km = newKm.km;
  const reason = f.reason.trim().slice(0, 200);
  if (reason) input.reason = reason;
  return { input };
}

/** move_driver_vehicle's answer for a swap. */
export interface SwapResult {
  driver: string;
  task?: string;
  task_id?: string;
  swapped?: { from?: string; to?: string; segment?: number };
  vehicle: string;
  /** "typed: 45262 km" or "the driver enters it on the phone". */
  readings?: { old_end?: string; new_start?: string };
  note?: string;
}

const readingText = (r?: string) => {
  const m = /^typed: (\d+) km$/.exec(r ?? "");
  return m ? `${Number(m[1]).toLocaleString("en-US")} km (typed)` : r || "the driver enters it on the phone";
};

/** The two readings after a swap: "End of WP CAB-4521: 45,262 km (typed)", "Start of WP KL-1234: the driver enters it on the phone". */
export function swapReadings(r: SwapResult): string[] {
  const from = r.swapped?.from ? plateOf(r.swapped.from) : "the old vehicle";
  const to = r.swapped?.to ? plateOf(r.swapped.to) : plateOf(r.vehicle) || "the new vehicle";
  return [`End of ${from}: ${readingText(r.readings?.old_end)}`, `Start of ${to}: ${readingText(r.readings?.new_start)}`];
}
