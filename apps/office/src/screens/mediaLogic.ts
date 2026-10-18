// Photos and documents (Phase 7, §5, §6, §28), the pure part: the sizes the
// browser's canvas makes (a driver's 512 px square, a vehicle's 1600 px photo
// and 256 px thumbnail, a document photo at 2000 px so the text stays
// readable), the centred square crop, which files a document takes, a
// vehicle's documents as one row per kind, save_vehicle_document's arguments,
// "Uploaded by Palitha 14 Oct 10:05" and which buttons a person sees.
import type { DocKind, VehicleDocument, VehicleDocuments } from "../data/types";

export const JPEG_QUALITY = 0.85;
/** A driver's profile photo: a centred square, this many pixels a side. */
export const PROFILE_PX = 512;
/** A vehicle's photo and its thumbnail, on the long side. */
export const VEHICLE_PX = 1600;
export const THUMB_PX = 256;
/** A photo of a driving licence (Part 3b), on the long side. */
export const LICENCE_PX = 1600;
/** A document photo, on the long side. */
export const DOC_PX = 2000;
/** A document file (vehicle-docs bucket): 10 MB. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

/** What drawImage takes: the source rectangle, and the size it is drawn at. */
export interface DrawBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  w: number;
  h: number;
}

/** The centred square of a w × h picture (the short side), drawn at size × size. */
export function squareCrop(w: number, h: number, size = PROFILE_PX): DrawBox {
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side, w: size, h: size };
}

/** The whole picture with its long side at most `max`; a smaller one keeps its size (never blown up). */
export function fitLongSide(w: number, h: number, max: number): DrawBox {
  const scale = Math.min(1, max / Math.max(w, h));
  return { sx: 0, sy: 0, sw: w, sh: h, w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** A document's file: a PDF goes as it is (up to 10 MB), a photo is made a JPEG at 2000 px first. */
export function docFileKind(file: { type: string; name: string; size: number }): { kind: "pdf" | "photo" } | { error: string } {
  const pdf = file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name));
  if (pdf) return file.size > MAX_DOC_BYTES ? { error: `This PDF is ${megabytes(file.size)}: a document can be up to 10 MB.` } : { kind: "pdf" };
  if (file.type.startsWith("image/")) return { kind: "photo" };
  return { error: "Choose a photo or a PDF." };
}

/** "1.2 MB", "640 KB". */
export function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const fileTypeText = (contentType: string) => (contentType === "application/pdf" ? "PDF" : "Photo");

export const DOC_LABEL: Record<DocKind, string> = {
  revenue_licence: "Revenue licence",
  insurance: "Insurance",
  emission: "Emission test",
  registration: "Registration (CR)",
  lease: "Rent or lease agreement",
  other: "Other",
};

/** The kinds in a sentence ("Remove the insurance?"), as the server's missing text says them. */
export const DOC_WORDS: Record<DocKind, string> = {
  revenue_licence: "revenue licence",
  insurance: "insurance",
  emission: "emission test",
  registration: "CR",
  lease: "rent or lease agreement",
  other: "document",
};

/** The kinds that carry an expiry date, and the vehicle's own date each one is (update_vehicle sets it; the document follows). */
export const EXPIRY_FIELD: Partial<Record<DocKind, "licence_expiry" | "insurance_expiry" | "emission_expiry" | "rent_until">> = {
  revenue_licence: "licence_expiry",
  insurance: "insurance_expiry",
  emission: "emission_expiry",
  lease: "rent_until",
};

export interface DocRow {
  /** The kind; an Other document `other:<id>`; the row that adds one `other:new`. */
  key: string;
  kind: DocKind;
  label: string;
  /** The current document of the kind (none = nothing uploaded). */
  doc?: VehicleDocument;
  expires: boolean;
  /** One the vehicle should have and has not (the server's list). */
  missing: boolean;
}

/**
 * The Documents section's rows from vehicle_documents: the four papers every vehicle has, the rent or lease agreement
 * when it is rented (or one was kept anyway), each Other document, and a last row to add another Other.
 */
export function documentRows(answer: Pick<VehicleDocuments, "documents" | "missing"> | undefined, opts: { rented: boolean }): DocRow[] {
  const docs = answer?.documents ?? [];
  const missing = new Set(answer?.missing ?? []);
  const current = (k: DocKind) => docs.find((d) => d.kind === k);
  const kinds: DocKind[] = ["revenue_licence", "insurance", "emission", "registration"];
  if (opts.rented || current("lease") || missing.has("lease")) kinds.push("lease");
  const rows: DocRow[] = kinds.map((k) => ({ key: k, kind: k, label: DOC_LABEL[k], doc: current(k), expires: !!EXPIRY_FIELD[k], missing: missing.has(k) && !current(k) }));
  for (const d of docs.filter((x) => x.kind === "other")) {
    rows.push({ key: `other:${d.id}`, kind: "other", label: d.kind_name || d.name || DOC_LABEL.other, doc: d, expires: false, missing: false });
  }
  rows.push({ key: "other:new", kind: "other", label: "Another document", expires: false, missing: false });
  return rows;
}

/** save_vehicle_document's arguments: the expiry only for a kind that has one (and a real date), the name only for Other. */
export function saveDocInput(a: { vehicle: string; kind: DocKind; path: string; contentType: string; bytes: number; expiry?: string; name?: string }): Record<string, unknown> {
  const input: Record<string, unknown> = { vehicle: a.vehicle, kind: a.kind, path: a.path, content_type: a.contentType, bytes: a.bytes };
  const expiry = (a.expiry ?? "").trim();
  if (EXPIRY_FIELD[a.kind] && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) input.expiry = expiry;
  if (a.kind === "other" && a.name?.trim()) input.name = a.name.trim().slice(0, 80);
  return input;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The server's "2026-10-14 10:05 by Palitha" as "Uploaded by Palitha 14 Oct 10:05" (the year only when it is not this
 * year's); anything else as it came, after the verb.
 */
export function byWhenText(verb: string, at: string | undefined, thisYear: string): string {
  if (!at) return verb;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})(?: by (.+))?$/.exec(at.trim());
  if (!m) return `${verb} ${at}`;
  const [, y, mo, d, time, who] = m;
  const day = `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}${y === thisYear ? "" : ` ${y}`}`;
  return `${verb}${who ? ` by ${who}` : ""} ${day} ${time}`;
}

/** "Expires 12 Mar 2027" from YYYY-MM-DD. */
export function expiryText(expiry?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry ?? "");
  return m ? `Expires ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "No expiry date";
}

/** Which buttons the Documents section shows: the section needs vehicle_documents; files go up only from the web app. */
export interface DocActions {
  upload: boolean;
  remove: boolean;
  restore: boolean;
  /** The expiry date of an expiring kind saved on its own (update_vehicle; the document follows). */
  saveDate: boolean;
}

export function docActions(tools: readonly string[], uploads: boolean): DocActions {
  return {
    upload: uploads && tools.includes("vehicle_document_upload_url") && tools.includes("save_vehicle_document"),
    remove: tools.includes("remove_vehicle_document"),
    restore: tools.includes("restore_vehicle_document"),
    saveDate: tools.includes("update_vehicle"),
  };
}

/** Replace a driver's photo (Drivers → driver): the web app only, with both tools. */
export const canSetDriverPhoto = (tools: readonly string[], uploads: boolean) =>
  uploads && tools.includes("photo_upload_url") && tools.includes("set_driver_photo");

/** Upload or replace a vehicle's photo (the vehicle's page): the web app only, with both tools. */
export const canSetVehiclePhoto = (tools: readonly string[], uploads: boolean) =>
  uploads && tools.includes("photo_upload_url") && tools.includes("set_vehicle_photo");

/** Part 3b (G): replace the front or back of a driver's licence (the driver's page): the web app only, with both tools. */
export const canSetLicencePhoto = (tools: readonly string[], uploads: boolean) =>
  uploads && tools.includes("photo_upload_url") && tools.includes("set_driver_licence_photo");

/** What Tell requester's message is about, as a heading. */
export const TELL_MOMENT: Record<"approved" | "driver_changed" | "on_the_way" | "arrived" | "cancelled", string> = {
  approved: "Approved",
  driver_changed: "Driver changed",
  on_the_way: "On the way",
  arrived: "Arrived",
  cancelled: "Cancelled",
};

/** The requester's phone as update_request takes it: changed, or null to clear; null when nothing changed. */
export function phoneChange(typed: string, was: string | undefined): { requester_phone: string | null } | null {
  const t = typed.trim();
  if (t === (was ?? "").trim()) return null;
  return { requester_phone: t || null };
}
