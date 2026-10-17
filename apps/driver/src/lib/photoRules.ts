// Phase 7 Part 3 (docs/phase7-plan.md §5, §6, §28): the rules behind the driver's photo, the vehicle photos and the
// vehicle's documents on the phone. Pure code with no phone modules, so scripts/test-rules.ts runs it as it is.

import type { Employee } from './types';

// --- "Add your photo" (§5) -------------------------------------------------------------------------------------------

/** The profile photo the phone makes: 512 × 512 JPEG. */
export const PROFILE_SIDE = 512;
export const PROFILE_QUALITY = 0.8;

/**
 * Whether the "Add your photo" step shows. Only when the server said, in this run of the app, that the driver has no
 * photo (a row cached by an older version has no photo_id at all, and the step cannot be done without a connection),
 * and never over a task in progress (the step has no skip: it must not stand between the driver and the task).
 */
export function needsProfilePhoto(
  me: Pick<Employee, 'photo_id'> | null,
  state: { fresh: boolean; taskRunning: boolean; deferred?: boolean },
): boolean {
  if (!me || !state.fresh || state.taskRunning || state.deferred) return false;
  return me.photo_id === null;
}

/**
 * After the camera or the gallery itself failed to open this many times in a row, the step offers "Not now" for this
 * run of the app: a phone whose picker is broken must not keep its driver from work (the step comes back at the next
 * start). A cancelled pick or a failed upload does not count.
 */
export const PICKER_FAILS_BEFORE_LATER = 2;

let deferredThisRun = false;
/** "Not now": the step stays away until the app starts again. */
export function deferProfilePhoto(): void {
  deferredThisRun = true;
}
export function profilePhotoDeferred(): boolean {
  return deferredThisRun;
}

/** The driver's photo in their own folder: <employee_id>/profile/<uuid>.jpg (set_my_photo checks the folder). */
export function profilePhotoPath(employeeId: string, id: string): string {
  return `${employeeId}/profile/${id}.jpg`;
}

/** The centred square of a picture (the crop screen's square can be a pixel off), or null when it is square already. */
export function squareCrop(width: number, height: number): { originX: number; originY: number; width: number; height: number } | null {
  if (width === height) return null;
  const side = Math.min(width, height);
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}

// --- Vehicle photos (§6) ---------------------------------------------------------------------------------------------

/** The phone makes two JPEGs of a vehicle: the photo (1600 px on the long side) and its thumbnail (256 px). */
export const VEHICLE_PHOTO_SIDE = 1600;
export const VEHICLE_THUMB_SIDE = 256;

/** Where a vehicle's photo and thumbnail go in the vehicle-photos bucket: <vehicle_id>/<uuid>.jpg and -thumb.jpg. */
export function vehiclePhotoPaths(vehicleId: string, id: string): { path: string; thumbPath: string } {
  return { path: `${vehicleId}/${id}.jpg`, thumbPath: `${vehicleId}/${id}-thumb.jpg` };
}

/** The resize that brings the long side down to `max` (null when it is that small already). */
export function fitWithin(width: number, height: number, max: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/**
 * The server's answer to a vehicle photo from the phone (set_vehicle_photo_from_driver): 'ok' = it is the vehicle's
 * photo now; 'has_photo' = someone was first (or the vehicle is gone): nothing to do, so the queue counts it as done.
 * Anything else is a refusal.
 */
export type VehiclePhotoAnswer = 'ok' | 'has_photo' | 'not_this_vehicle';
export function vehiclePhotoDone(answer: string | null | undefined): boolean {
  return answer === 'ok' || answer === 'has_photo';
}

// --- Documents (§28) -------------------------------------------------------------------------------------------------

/** What a driver shows at a roadside check, in this order. */
export const ROADSIDE_KINDS = ['revenue_licence', 'insurance', 'emission'] as const;
export type RoadsideKind = (typeof ROADSIDE_KINDS)[number];

export interface DocumentRow {
  id: string;
  vehicle_id: string;
  kind: string;
  name: string | null;
  path: string;
  content_type: string;
  expiry: string | null;
  uploaded_at: string;
}

/** One line per roadside kind: the current document (the newest not removed), or null when there is none. */
export function currentDocuments(rows: DocumentRow[]): { kind: RoadsideKind; doc: DocumentRow | null }[] {
  return ROADSIDE_KINDS.map((kind) => ({
    kind,
    doc: rows.filter((row) => row.kind === kind).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0] ?? null,
  }));
}

/** Whole days from one date to another ("2026-10-17" → "2026-10-24" = 7). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type DocTone = 'ok' | 'amber' | 'red' | 'none';

/**
 * The expiry as the office's chips show it (docChip in _shared/fleet/fleet.ts): amber within 30 days, red within 7 days
 * or expired. `key` is the line under the document: valid until, expired, or no expiry date.
 */
export function expiryLine(expiry: string | null, today: string): { tone: DocTone; key: 'docs.validUntil' | 'docs.expired' | 'docs.noExpiry'; days: number | null } {
  if (!expiry) return { tone: 'none', key: 'docs.noExpiry', days: null };
  const days = daysBetween(today, expiry);
  return { tone: days <= 7 ? 'red' : days <= 30 ? 'amber' : 'ok', key: days < 0 ? 'docs.expired' : 'docs.validUntil', days };
}

/** "12 Mar 2027" from a date, with the month names of the language (digits stay Latin). */
export function dateLabel(date: string, months: string[]): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${months[(month ?? 1) - 1] ?? ''} ${year}`.replace(/\s+/g, ' ').trim();
}

/** A photo opens in the app; anything else (a PDF) in the phone's browser. */
export function opensInApp(contentType: string): boolean {
  return contentType.startsWith('image/');
}
