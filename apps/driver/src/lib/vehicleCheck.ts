// Round 4–7, feature 4 (docs/phase8-plan.md §33.1): the vehicle check before work, Samsara / Motive's pre-trip
// inspection and Turo's check-in. Pure: no React and no phone modules, so scripts/test-vehicle-check.ts runs it as it is.
//
//   - ONE rule (needsCheck): a vehicle the driver takes (Start work, Change vehicle, Start task, the vehicle confirmed on
//     the day) needs its check while this driver has not checked THAT vehicle today (the Colombo day), unless the office
//     switched the check off (get_driver_settings vehicle_check). Start task waits for it; Today shows the card for the
//     vehicle held while it is needed. One screen asks it: app/vehicle-check.tsx.
//   - "No, all good" is one tap: a check 'ok' (who, when, the vehicle's odometer when the phone knows it). After it, the
//     optional four photos (front, back, left, right): kind vehicle_check, each with its side, linked to the check.
//   - "Yes": a category (Damage is new), 1 to 6 photos and a note: a check 'problem' and the report it made
//     (vehicle_reports.check_id). The server sends the one notification for it by itself.
//   - Offline first, like the reports: the check, then its report, then the photos go through the queue in that order
//     (the report names the check; a photo names the report or the check: the server must have it first). Today's checks
//     stay on the phone, so the card and the rule work offline, and are read back from the server on refresh and after a
//     fresh sign-in (mergeChecks).

import type { Op } from '../sync/engine';
import type { ReportInsert, VehicleCheckInsert } from './api';
import { photoOp, type QueuedPhoto } from './photoRules';
import { colomboDate } from './time';
import type { CheckSide, ReportCategory } from './types';

/** How the driver took the vehicle the check is about (vehicle_checks.how; 'trip' is the office side's self-driver). */
export type CheckHow = 'clock_in' | 'change' | 'task_start' | 'vehicle_confirm';
export const CHECK_HOWS: readonly CheckHow[] = ['clock_in', 'change', 'task_start', 'vehicle_confirm'];
export type CheckResult = 'ok' | 'problem';

/** A check as the phone keeps it (KEYS.vehicleChecks) and sends it (the vehicle_check op's row). */
export interface VehicleCheck {
  id: string;
  vehicle_id: string;
  employee_id: string;
  task_id: string | null;
  checked_at: string;
  result: CheckResult;
  odometer_km: number | null;
  how: CheckHow | 'trip';
}

/** The optional four photos of an all-good check, in the order they are asked. */
export const CHECK_SIDES: readonly CheckSide[] = ['front', 'back', 'left', 'right'];
/** The categories of a report, everywhere the driver chooses one (Damage is the sixth, Round 4–7). */
export const REPORT_CATEGORIES: readonly ReportCategory[] = ['breakdown', 'accident', 'tyre', 'warning_light', 'damage', 'other'];
/** Photos of a report: 1 to 3 on the Report tab and during a task, 1 to 6 on a pre-trip report. */
export const REPORT_MAX_PHOTOS = 3;
export const PRE_TRIP_MAX_PHOTOS = 6;

/** What the rule reads of a check. */
type CheckOf = Pick<VehicleCheck, 'vehicle_id' | 'checked_at'> & { employee_id?: string };

/** This driver's latest check of this vehicle on `now`'s Colombo day, or null. Another day's or another vehicle's never counts. */
export function checkToday<C extends CheckOf>(
  vehicleId: string | null | undefined,
  checks: readonly C[],
  now: Date | number | string,
  employeeId?: string | null,
): C | null {
  if (!vehicleId) return null;
  const today = colomboDate(now);
  let found: C | null = null;
  for (const check of checks) {
    if (check.vehicle_id !== vehicleId || colomboDate(check.checked_at) !== today) continue;
    if (employeeId && check.employee_id && check.employee_id !== employeeId) continue;
    if (!found || check.checked_at > found.checked_at) found = check;
  }
  return found;
}

/**
 * THE rule: the vehicle needs its check before work. Never with the switch off or with no vehicle; otherwise until this
 * driver has checked that vehicle today (Colombo day). One check a day per vehicle: a second vehicle has its own.
 */
export function needsCheck(
  vehicleId: string | null | undefined,
  checks: readonly CheckOf[],
  now: Date | number | string,
  settings: { vehicle_check: boolean },
  employeeId?: string | null,
): boolean {
  if (!settings.vehicle_check || !vehicleId) return false;
  return checkToday(vehicleId, checks, now, employeeId) === null;
}

/** Only the checks of `now`'s Colombo day (the phone keeps no older ones). */
export function todaysChecks<C extends CheckOf>(checks: readonly C[], now: Date | number | string): C[] {
  const today = colomboDate(now);
  return checks.filter((check) => colomboDate(check.checked_at) === today);
}

/** A row the server answered (or the phone kept from an older version), checked field by field; null when it is not one. */
export function parseCheck(row: unknown): VehicleCheck | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const id = text(r.id);
  const vehicleId = text(r.vehicle_id);
  const employeeId = text(r.employee_id);
  const at = text(r.checked_at);
  if (!id || !vehicleId || !employeeId || !at || Number.isNaN(Date.parse(at))) return null;
  if (r.result !== 'ok' && r.result !== 'problem') return null;
  const how = CHECK_HOWS.find((h) => h === r.how) ?? (r.how === 'trip' ? 'trip' : 'clock_in');
  return {
    id,
    vehicle_id: vehicleId,
    employee_id: employeeId,
    task_id: text(r.task_id),
    checked_at: at,
    result: r.result,
    odometer_km: knownOdometer(typeof r.odometer_km === 'number' ? r.odometer_km : null),
    how,
  };
}

/**
 * The phone's checks after a read from the server: the server's of today plus the phone's own of today it does not have
 * yet (still in the queue), one per id, oldest first. A refresh never loses a check answered offline.
 */
export function mergeChecks(kept: readonly VehicleCheck[], server: readonly unknown[], now: Date | number | string): VehicleCheck[] {
  const byId = new Map<string, VehicleCheck>();
  for (const check of todaysChecks(kept, now)) byId.set(check.id, check);
  for (const row of server) {
    const check = parseCheck(row);
    if (check && colomboDate(check.checked_at) === colomboDate(now)) byId.set(check.id, check);
  }
  return [...byId.values()].sort((a, b) => a.checked_at.localeCompare(b.checked_at));
}

/** The `how` a screen was opened with (a route parameter); anything else is a clock-in. */
export function parseHow(value: unknown): CheckHow {
  return CHECK_HOWS.find((h) => h === value) ?? 'clock_in';
}

/** The odometer the phone knows for the vehicle: its last reading as a whole number of km, else null. */
export function knownOdometer(km: number | null | undefined): number | null {
  return typeof km === 'number' && Number.isFinite(km) && km >= 0 ? Math.round(km) : null;
}

/** The check the driver answered: who, which vehicle (and task), when, the result, the odometer the phone knows, how. */
export function checkRow(input: {
  id: string;
  vehicleId: string;
  employeeId: string;
  taskId?: string | null;
  at: string;
  result: CheckResult;
  odometerKm?: number | null;
  how: CheckHow;
}): VehicleCheck {
  return {
    id: input.id,
    vehicle_id: input.vehicleId,
    employee_id: input.employeeId,
    task_id: input.taskId ?? null,
    checked_at: input.at,
    result: input.result,
    odometer_km: knownOdometer(input.odometerKm),
    how: input.how,
  };
}

/** The queue op of a check: exactly the columns the driver may insert. */
export function checkOp(check: VehicleCheck): Extract<Op, { kind: 'vehicle_check' }> {
  const row: VehicleCheckInsert = {
    id: check.id,
    vehicle_id: check.vehicle_id,
    employee_id: check.employee_id,
    task_id: check.task_id,
    checked_at: check.checked_at,
    result: check.result,
    odometer_km: check.odometer_km,
    how: check.how,
  };
  return { kind: 'vehicle_check', row };
}

/** A report's row: the note trimmed (none when empty); needs_vehicle only when asked; check_id only on a pre-trip report. */
export function reportRow(input: {
  id: string;
  vehicleId: string;
  employeeId: string;
  taskId: string | null;
  category: ReportCategory;
  note: string;
  at: string;
  needsVehicle?: boolean;
  checkId?: string | null;
}): ReportInsert {
  const note = input.note.trim();
  return {
    id: input.id,
    vehicle_id: input.vehicleId,
    employee_id: input.employeeId,
    task_id: input.taskId,
    category: input.category,
    note: note === '' ? null : note,
    created_at: input.at,
    // Sent only when ticked / when it is a pre-trip report, so any other report is the same row as before.
    ...(input.needsVehicle ? { needs_vehicle: true } : {}),
    ...(input.checkId ? { check_id: input.checkId } : {}),
  };
}

/** A report in the queue: the report first, then its photos (a photo may only name a report that exists). */
export function reportOps(row: ReportInsert, photos: readonly QueuedPhoto[], employeeId: string): Op[] {
  return [{ kind: 'report', row }, ...photos.map((photo) => photoOp(photo, 'vehicle_report', employeeId, { vehicle_report_id: row.id }))];
}

/** A check that found a problem: the check, then the report it made (naming the check), then the report's photos. */
export function problemOps(check: VehicleCheck, row: ReportInsert, photos: readonly QueuedPhoto[], employeeId: string): Op[] {
  return [checkOp(check), ...reportOps({ ...row, check_id: check.id }, photos, employeeId)];
}

/** An all-good check's photos, after the check in the queue: kind vehicle_check, each with its side. */
export function sidePhotoOps(check: Pick<VehicleCheck, 'id'>, shots: readonly { side: CheckSide; photo: QueuedPhoto }[], employeeId: string): Op[] {
  return shots.map(({ side, photo }) => photoOp(photo, 'vehicle_check', employeeId, { vehicle_check_id: check.id, side }));
}

/** The next side the guided capture asks for (front, back, left, right in turn), or null when all four are taken. */
export function nextSide(taken: Partial<Record<CheckSide, unknown>>): CheckSide | null {
  return CHECK_SIDES.find((side) => !taken[side]) ?? null;
}

/** How the vehicle held was taken, as the phone noted it (KEYS.heldHow). */
export interface HeldHow {
  vehicleId: string;
  how: CheckHow;
}

/**
 * The `how` of a check answered later (Today's card): the way the phone took the vehicle held. A vehicle it did not take
 * itself came by a change (the office moved the driver, or a hand-over); with nothing noted at all, a clock-in.
 */
export function heldHowFor(held: HeldHow | null | undefined, vehicleId: string): CheckHow {
  if (!held) return 'clock_in';
  return held.vehicleId === vehicleId ? held.how : 'change';
}
