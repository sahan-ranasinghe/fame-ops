// Office mode (Stage 1, O3 item 5): photos and documents by camera, the rules only (pure: no react-native). The same as
// the website's (apps/office/src/screens/mediaLogic.ts, Phase 7 §5, §6, §28, Part 3b G): the sizes (a driver's 512 px
// square, a vehicle's 1600 px photo and 256 px thumbnail, a licence at 1600 px, a document photo at 2000 px so the text
// stays readable), a vehicle's documents as one row per kind, save_vehicle_document's input, and who sees which button
// (both tools of each pair; the server is the guard). The file goes from the phone straight to Storage through the
// one-time signed upload a tool handed out (office-api: photo_upload_url, vehicle_document_upload_url); nothing goes
// through office-api itself. Office-api runs these tools as channel "web", so no server change was needed.

import type { DocKind, VehicleDocument, VehicleDocuments } from './types';

export const JPEG_QUALITY = 0.85;
export const PROFILE_PX = 512;
export const VEHICLE_PX = 1600;
export const THUMB_PX = 256;
export const LICENCE_PX = 1600;
export const DOC_PX = 2000;
/** A document file (vehicle-docs bucket): 10 MB. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** What is photographed: the size it is made at follows. */
/** Round 4–7 (4): 'check' = a photo of a no-app trip (a problem, a side of the vehicle, the odometer) at the driver app's 1600 px. */
export type PhotoUse = 'driver_profile' | 'vehicle' | 'driver_licence' | 'document' | 'check';

export const LONG_SIDE: Record<Exclude<PhotoUse, 'driver_profile'>, number> = { vehicle: VEHICLE_PX, driver_licence: LICENCE_PX, document: DOC_PX, check: VEHICLE_PX };

/** The resize for a picture so its long side is at most `max` (null when it is small enough already). */
export function fitLongSide(width: number, height: number, max: number): { width: number } | { height: number } | null {
  if (!width || !height || Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** The centred square of a picture, or null when it is square already. */
export function centredSquare(width: number, height: number): { originX: number; originY: number; width: number; height: number } | null {
  if (width === height) return null;
  const side = Math.min(width, height);
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
}

/** A one-time signed upload a tool handed out. */
export interface UploadTicket {
  bucket: 'driver-photos' | 'vehicle-photos' | 'vehicle-docs';
  path: string;
  token: string;
}

/** Storage's address for a signed upload (PUT the file's bytes there; the token is the permission). */
export function signedUploadUrl(base: string, ticket: UploadTicket): string {
  const path = ticket.path.split('/').map(encodeURIComponent).join('/');
  return `${base.replace(/\/+$/, '')}/storage/v1/object/upload/sign/${ticket.bucket}/${path}?token=${encodeURIComponent(ticket.token)}`;
}

/** A ticket as the server sent it, or null (never a guess). */
export function ticketOf(x: unknown): UploadTicket | null {
  const t = x as Partial<UploadTicket> | null | undefined;
  return t && (t.bucket === 'driver-photos' || t.bucket === 'vehicle-photos' || t.bucket === 'vehicle-docs') && typeof t.path === 'string' && t.path && typeof t.token === 'string' && t.token
    ? { bucket: t.bucket, path: t.path, token: t.token }
    : null;
}

// ---- Who sees which button (both tools of each pair) ----

export const canSetDriverPhoto = (tools: readonly string[]) => tools.includes('photo_upload_url') && tools.includes('set_driver_photo');
export const canSetVehiclePhoto = (tools: readonly string[]) => tools.includes('photo_upload_url') && tools.includes('set_vehicle_photo');
export const canSetLicencePhoto = (tools: readonly string[]) => tools.includes('photo_upload_url') && tools.includes('set_driver_licence_photo');
export const canUploadDocs = (tools: readonly string[]) => tools.includes('vehicle_document_upload_url') && tools.includes('save_vehicle_document');

// ---- A vehicle's documents ----

/** The kinds with an expiry date (written both ways with the vehicle's date). */
export const EXPIRES: Record<DocKind, boolean> = { revenue_licence: true, insurance: true, emission: true, registration: false, lease: false, other: false };

export interface DocRow {
  key: string;
  kind: DocKind;
  /** The current file of this kind (an Other: its own). */
  doc?: VehicleDocument;
  missing: boolean;
  /** The last row: another Other document. */
  adding: boolean;
}

/**
 * One row per kind: the four every vehicle has, the lease when it is rented (or one was kept anyway), each Other document,
 * and a last row to add another Other.
 */
export function documentRows(answer: Pick<VehicleDocuments, 'documents' | 'missing'> | null | undefined, opts: { rented: boolean }): DocRow[] {
  const docs = answer?.documents ?? [];
  const missing = new Set(answer?.missing ?? []);
  const current = (k: DocKind) => docs.find((d) => d.kind === k);
  const kinds: DocKind[] = ['revenue_licence', 'insurance', 'emission', 'registration'];
  if (opts.rented || current('lease') || missing.has('lease')) kinds.push('lease');
  const rows: DocRow[] = kinds.map((k) => ({ key: k, kind: k, doc: current(k), missing: missing.has(k) && !current(k), adding: false }));
  for (const d of docs.filter((x) => x.kind === 'other')) rows.push({ key: `other:${d.id}`, kind: 'other', doc: d, missing: false, adding: false });
  rows.push({ key: 'other:new', kind: 'other', missing: false, adding: true });
  return rows;
}

/** save_vehicle_document's input: the expiry only for a kind that has one (and a real date), the name only for Other. */
export function saveDocInput(a: { vehicle: string; kind: DocKind; path: string; contentType: string; bytes: number; expiry?: string; name?: string }): Record<string, unknown> {
  const input: Record<string, unknown> = { vehicle: a.vehicle, kind: a.kind, path: a.path, content_type: a.contentType, bytes: a.bytes };
  const expiry = (a.expiry ?? '').trim();
  if (EXPIRES[a.kind] && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) input.expiry = expiry;
  if (a.kind === 'other' && a.name?.trim()) input.name = a.name.trim().slice(0, 80);
  return input;
}

/** Why Save is not ready on the document screen (the key of the reason), or null. */
export function docSaveBlock(a: { kind: DocKind; hasPhoto: boolean; name: string; bytes: number }): 'photo' | 'name' | 'tooBig' | null {
  if (!a.hasPhoto) return 'photo';
  if (a.kind === 'other' && !a.name.trim()) return 'name';
  if (a.bytes > MAX_DOC_BYTES) return 'tooBig';
  return null;
}

/** The document route's kind from its parameter (a broken link opens Other's form, never a crash). */
export function docKindOf(x: string | undefined): DocKind {
  return x === 'revenue_licence' || x === 'insurance' || x === 'emission' || x === 'registration' || x === 'lease' ? x : 'other';
}
