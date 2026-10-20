// Office mode (Phase 8, O2, item 5): the rules of Task detail's extras: Change time (update_task with the plan version:
// the day, the leave-by, the end time, only what differs; the site's TaskEdit), Change stops (the editor's Where and When
// in mode stops, then update_task_stops; the site's TaskStops), Swap vehicle during a task (move_driver_vehicle with the
// readings at the swap; the site's MoveVehicle swap) and Reopen (reopen_task, a task completed today). Pure: no
// react-native, no i18n; the screens turn the keys into words.

import type { TaskDetail, VehicleCard } from './types';

type Task = TaskDetail['task'];

const over = (t: Pick<Task, 'status'>) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'missed';

/**
 * Which extras a task allows, before the tools are checked: the time and the stops while it is not over (the time of a
 * running task only its end), the swap while it runs with a driver, Reopen when the server says so (completed today).
 */
export function extraActions(t: Pick<Task, 'status' | 'driver' | 'can_reopen'>): { time: boolean; stops: boolean; swap: boolean; reopen: boolean } {
  return {
    time: !over(t),
    stops: !over(t),
    swap: t.status === 'in_progress' && !!t.driver,
    reopen: !!t.can_reopen,
  };
}

/** The extras shown: what the task allows and what the person's tools allow. */
export function extrasFor(t: Pick<Task, 'status' | 'driver' | 'can_reopen'>, tools: readonly string[]) {
  const a = extraActions(t);
  return {
    time: a.time && tools.includes('update_task'),
    stops: a.stops && tools.includes('update_task_stops'),
    swap: a.swap && tools.includes('move_driver_vehicle'),
    reopen: a.reopen && tools.includes('reopen_task'),
  };
}

// ---------------------------------------------------------------------------
// Change time
// ---------------------------------------------------------------------------

export interface TimeFields {
  date: string;
  /** The leave-by (HH:MM); empty = not changed. */
  time: string;
  /** The end time (HH:MM); empty = none. */
  end: string;
}

/** The form as the task is now. */
export const timeFieldsOf = (t: Pick<Task, 'date' | 'time' | 'leave_by' | 'end_by'>): TimeFields => ({
  date: t.date ?? '',
  time: t.time ?? t.leave_by ?? '',
  end: t.end_by ?? '',
});

/** A running task's leave-by and day are gone: only its end time can move. */
export const timeLocked = (t: Pick<Task, 'status'>) => t.status === 'in_progress';

/**
 * update_task's input for a time change: only what differs from the task (the site's updateTaskInput); `nothing` when
 * nothing does, `endBeforeStart` when the end is not after the leave-by on the same day.
 */
export function changeTimeInput(id: string, version: number, f: TimeFields, t: Pick<Task, 'date' | 'time' | 'leave_by' | 'end_by'>): { error: 'nothing' | 'endBeforeStart' } | { input: Record<string, unknown> } {
  const s = (x: string) => x.trim();
  const was = timeFieldsOf(t);
  const input: Record<string, unknown> = { task_id: id, plan_version: version };
  if (s(f.date) && s(f.date) !== was.date) input.date = s(f.date);
  if (s(f.time) && s(f.time) !== was.time) input.time = s(f.time);
  if (s(f.end) !== was.end) input.end_time = s(f.end) || null;
  const leave = s(f.time) || was.time;
  if (s(f.end) && leave && s(f.end) <= leave) return { error: 'endBeforeStart' };
  if (Object.keys(input).length === 2) return { error: 'nothing' };
  return { input };
}

// ---------------------------------------------------------------------------
// Change the task (Hotfix O2-H1 Part B: the site's TaskEdit, update_task with the plan version)
// ---------------------------------------------------------------------------

export interface ChangeFields extends TimeFields {
  /** The driver's username; '' = keep. */
  driver: string;
  /** The plate, "on the day", "any van"…; '' = keep (or the new driver's own vehicle). */
  vehicle: string;
  title: string;
  passengers: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

/** The form as the task is now (the driver and vehicle empty: a pick changes them). */
export const changeFieldsOf = (t: Pick<Task, 'date' | 'time' | 'leave_by' | 'end_by' | 'title' | 'passengers' | 'contact' | 'notes'>): ChangeFields => ({
  ...timeFieldsOf(t),
  driver: '',
  vehicle: '',
  title: t.title ?? '',
  passengers: t.passengers == null ? '' : String(t.passengers),
  contactName: t.contact?.name ?? '',
  contactPhone: t.contact?.phone ?? '',
  notes: t.notes ?? '',
});

/**
 * update_task's input: only what differs from the task (the site's updateTaskInput); `nothing` when nothing does,
 * `endBeforeStart` as for the time alone. A running task takes the words only (the server refuses its day, leave-by,
 * end, driver and vehicle while it runs; the vehicle swap is its own screen).
 */
export function changeTaskInput(id: string, version: number, f: ChangeFields, t: Pick<Task, 'date' | 'time' | 'leave_by' | 'end_by' | 'title' | 'passengers' | 'contact' | 'notes' | 'status'>): { error: 'nothing' | 'endBeforeStart' } | { input: Record<string, unknown> } {
  const s = (x: string) => x.trim();
  const was = changeFieldsOf(t);
  const input: Record<string, unknown> = { task_id: id, plan_version: version };
  const running = t.status === 'in_progress';
  if (!running && s(f.driver)) input.driver = s(f.driver);
  if (!running && s(f.vehicle)) input.vehicle = s(f.vehicle);
  if (!running && s(f.date) && s(f.date) !== was.date) input.date = s(f.date);
  if (!running && s(f.time) && s(f.time) !== was.time) input.time = s(f.time);
  if (!running && s(f.end) !== was.end) input.end_time = s(f.end) || null;
  if (s(f.title) && s(f.title) !== was.title) input.title = s(f.title);
  const pax = s(f.passengers);
  if (pax !== was.passengers) input.passengers = pax === '' ? null : Math.max(0, Math.min(80, parseInt(pax, 10) || 0));
  if (s(f.contactName) !== was.contactName) input.contact_name = s(f.contactName);
  if (s(f.contactPhone) !== was.contactPhone) input.contact_phone = s(f.contactPhone);
  if (s(f.notes) !== was.notes) input.notes = s(f.notes);
  const leave = s(f.time) || was.time;
  if (s(f.end) && leave && s(f.end) <= leave) return { error: 'endBeforeStart' };
  if (Object.keys(input).length === 2) return { error: 'nothing' };
  return { input };
}

// ---------------------------------------------------------------------------
// Swap vehicle (the site's moveLogic, the swap part)
// ---------------------------------------------------------------------------

const plateKey = (v: string) => (v ?? '').split(' · ')[0].replace(/[\s-]/g, '').toUpperCase();
/** Two plates (or "plate · make" labels) are the same vehicle: spaces and dashes do not matter. */
export const samePlate = (a?: string | null, b?: string | null) => !!a && !!b && plateKey(a) === plateKey(b);

export interface SwapRow {
  reg_no: string;
  /** "Toyota HiAce · 14 seats" */
  what: string;
  /** The row's state: the task's vehicle now, free, with someone else, in the garage, on another running task. */
  state: 'current' | 'free' | 'held' | 'garage' | 'on_task';
  /** Who holds it now, when that is someone else (they are told when it is taken). */
  held_by?: string;
  held_since?: string;
  /** "back ~HH:MM" for a vehicle on a task; "Booked later today · HH:MM" when booked. */
  back_at?: string;
  booked?: string;
  /** On another driver's running task, or the task's own vehicle: shown, not selectable. */
  disabled: boolean;
}

/**
 * The rows of the swap list: every active vehicle, the task's vehicle first (shown, not offered), then the free ones,
 * the ones someone else holds, the ones in the garage, and last the ones on another running task (not selectable).
 */
export function swapRows(vehicles: readonly VehicleCard[], who: { name: string; vehicle?: string }): SwapRow[] {
  const ranked = vehicles.filter((v) => v.active !== false).map((v, i) => {
    const current = samePlate(who.vehicle, v.reg_no) || (!!v.held_by && v.held_by === who.name);
    const onTask = !current && v.status === 'On a task';
    const garage = v.status === 'In garage' || v.in_garage === true;
    const heldBy = !current && v.held_by && v.held_by !== who.name ? v.held_by : undefined;
    const state: SwapRow['state'] = current ? 'current' : onTask ? 'on_task' : garage ? 'garage' : heldBy ? 'held' : 'free';
    const rank = { current: 0, free: 1, held: 2, garage: 3, on_task: 4 }[state];
    const row: SwapRow = {
      reg_no: v.reg_no,
      what: [v.make_model, v.seats ? `${v.seats}` : ''].filter(Boolean).join(' · '),
      state,
      held_by: heldBy,
      held_since: v.held_since,
      back_at: onTask ? v.back_at : undefined,
      booked: !onTask && v.availability?.startsWith('Booked') ? v.availability : undefined,
      disabled: current || onTask,
    };
    return { row, rank, i };
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.row);
}

/** Swap is offered for another vehicle that is not on someone else's running task; never "no vehicle". */
export function canSwap(rows: readonly SwapRow[], choice: string | null): boolean {
  if (!choice) return false;
  const r = rows.find((x) => x.reg_no === choice);
  return !!r && !r.disabled;
}

/** The highest odometer reading the server takes. */
export const MAX_KM = 9_999_999;

/** An odometer field: empty = the driver enters it on the phone; else whole km, not negative. Spaces and commas are ignored. */
export function parseKm(text: string): { km?: number } | { error: 'negative' | 'whole' | 'number' | 'tooBig' } {
  const t = text.replace(/[\s,]/g, '');
  if (t === '') return {};
  if (t.startsWith('-')) return { error: 'negative' };
  if (/^\d+\.\d*$/.test(t)) return { error: 'whole' };
  if (!/^\d+$/.test(t)) return { error: 'number' };
  const km = Number(t);
  if (km > MAX_KM) return { error: 'tooBig' };
  return { km };
}

export interface SwapFields {
  oldKm: string;
  newKm: string;
  reason: string;
}

/** move_driver_vehicle's input for a swap: the driver, the plate, the readings typed, the reason; or what is wrong. */
export function swapInput(driver: string, choice: string | null, f: SwapFields): { error: 'pick' | 'oldKm' | 'newKm'; detail?: string } | { input: Record<string, unknown> } {
  if (!choice) return { error: 'pick' };
  const oldKm = parseKm(f.oldKm);
  if ('error' in oldKm) return { error: 'oldKm', detail: oldKm.error };
  const newKm = parseKm(f.newKm);
  if ('error' in newKm) return { error: 'newKm', detail: newKm.error };
  const input: Record<string, unknown> = { driver, vehicle: choice };
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

/** A reading as the server words it: the km typed, or null for "the driver enters it on the phone". */
export function typedKm(r?: string): number | null {
  const m = /^typed: (\d+) km$/.exec(r ?? '');
  return m ? Number(m[1]) : null;
}

/** The plates of the swap: from the old vehicle to the new one. */
export function swapPlates(r: SwapResult): { from?: string; to: string } {
  const plate = (v?: string) => (v ?? '').split(' · ')[0];
  return { from: r.swapped?.from ? plate(r.swapped.from) : undefined, to: r.swapped?.to ? plate(r.swapped.to) : plate(r.vehicle) };
}

// ---------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------

export type ReopenReasonKey = 'finished_early' | 'wrong_reading' | 'other';
/** The reasons as the history keeps them (English, like the site's free text). */
export const REOPEN_TEXT: Record<ReopenReasonKey, string> = { finished_early: 'Finished too soon', wrong_reading: 'Wrong end reading', other: 'Other' };

/** reopen_task's input: the reason, with the note after it. */
export function reopenInput(taskId: string, label: string, note: string): { task_id: string; reason: string } {
  const n = note.trim();
  return { task_id: taskId, reason: n ? `${label}: ${n}` : label };
}
