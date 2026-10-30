// Photos and documents the office adds from the web (Phase 7, §5, §6, §28): a driver's profile photo, a vehicle's photo
// and its documents. The browser uploads the file itself through a signed upload (a path and a one-time token: no file
// goes through chat or these tools), then saves it with the tool that names it. Every link handed out is signed (at
// least an hour). Nothing is deleted: a replaced or removed document is kept, marked, and can be restored.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { findDriver, findVehicle, loadRefs } from "../fleet.ts";
import { mediaLinks } from "../media.ts";
import type { Actor } from "../roles.ts";
import { colomboDateTime, isRealDate } from "../time.ts";
import { tool, zId, zText } from "../tool.ts";
import { DOC_EXPIRES, DOC_KINDS, DOC_NAME, type DocKind, missingText, requiredKinds } from "../docs.ts";

type VehicleDocument = Row<"vehicle_documents">;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/** The upload tools are the web app's: Claude never moves files (they are not listed on the connector either). */
export const WEB_ONLY_TOOLS = new Set([
  "photo_upload_url",
  "vehicle_document_upload_url",
  "save_vehicle_document",
  // Round 52 (Sahan): the connector keeps NO delete, on purpose: Claude archives; deleting and the bin are the web app's.
  "can_delete",
  "delete_record",
  "delete_entry",
  "list_bin",
  "restore_bin_item",
]);

function webOnly(actor: Actor) {
  if (actor.channel !== "web") throw new ToolError("Files are added in the web app (Fame Fleet), not through the connector.");
}

async function signedUpload(db: Db, bucket: string, path: string) {
  const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`upload link (${bucket}): ${error?.message ?? "no answer"}`);
  return { bucket, path, token: data.token };
}

export const photoUploadUrl = tool({
  name: "photo_upload_url",
  title: "A place to upload a photo",
  description: "Web app only. A one-time signed upload (bucket, path, token) for a driver's profile photo (512 px square JPEG), " +
    "a photo of their driving licence (driver_licence, 1600 px JPEG; Part 3b) " +
    "or a vehicle's photo and its thumbnail (1600 px and 256 px JPEG); then set_driver_photo, set_driver_licence_photo or " +
    "set_vehicle_photo saves it.",
  readOnly: false,
  input: z.object({
    kind: z.enum(["driver_profile", "driver_licence", "vehicle"]),
    target: zText(80).describe("The driver (username, code or name) or the vehicle (plate)"),
  }),
  async run({ kind, target }, { db, actor }) {
    webOnly(actor);
    // Part 3b: users may upload a driver's licence only (the profile and vehicle photos stay with vehicles).
    if (kind !== "driver_licence" && !actor.permissions.includes("vehicles")) {
      throw new ToolError("Uploading this photo needs the vehicles permission.");
    }
    const refs = await loadRefs(db);
    if (kind === "driver_profile") {
      const driver = findDriver(refs, target);
      const upload = await signedUpload(db, "driver-photos", `${driver.id}/profile/${crypto.randomUUID()}.jpg`);
      return { result: { upload }, summary: `profile photo upload for ${driver.name}` };
    }
    if (kind === "driver_licence") {
      const driver = findDriver(refs, target);
      const upload = await signedUpload(db, "driver-photos", `${driver.id}/licence/${crypto.randomUUID()}.jpg`);
      return { result: { upload }, summary: `licence photo upload for ${driver.name}` };
    }
    const vehicle = findVehicle(refs, target);
    const id = crypto.randomUUID();
    const [upload, thumb] = await Promise.all([
      signedUpload(db, "vehicle-photos", `${vehicle.id}/${id}.jpg`),
      signedUpload(db, "vehicle-photos", `${vehicle.id}/${id}-thumb.jpg`),
    ]);
    return { result: { upload, thumb }, summary: `vehicle photo upload for ${vehicle.reg_no}` };
  },
});

export const setDriverPhoto = tool({
  name: "set_driver_photo",
  title: "Replace a driver's photo",
  description: "Saves a profile photo uploaded with photo_upload_url (driver_profile) as the driver's photo. The old one is kept.",
  readOnly: false,
  input: z.object({ driver: zText(80).describe("Username, code or name"), path: zText(300).describe("From photo_upload_url") }),
  async run({ driver: typed, path }, { db, now, actor }) {
    const refs = await loadRefs(db);
    const driver = findDriver(refs, typed);
    if (!path.startsWith(`${driver.id}/profile/`) || !path.endsWith(".jpg")) {
      throw new ToolError("This file is not that driver's photo upload.");
    }
    const photo = unwrap(
      await db.from("photos").insert({ employee_id: driver.id, kind: "profile", storage_path: path, taken_at: now.toISOString() })
        .select("id").single(),
      "photo",
    );
    unwrap(
      await db.from("employees").update({ photo_id: photo.id, photo_updated_at: now.toISOString() }).eq("id", driver.id).select("id"),
      "employee",
    );
    const url = (await mediaLinks(db, "driver-photos", [path], now)).get(path);
    return { result: { driver: driver.name, photo_url: url, by: actor.name }, summary: `photo of ${driver.name} replaced` };
  },
});

export const setVehiclePhoto = tool({
  name: "set_vehicle_photo",
  title: "Set a vehicle's photo",
  description: "Saves a vehicle photo and its thumbnail uploaded with photo_upload_url (vehicle). Replaces the one shown; the old " +
    "files are kept.",
  readOnly: false,
  input: z.object({ vehicle: zText(20).describe("Plate"), path: zText(300), thumb_path: zText(300) }),
  async run({ vehicle: typed, path, thumb_path }, { db, now }) {
    const refs = await loadRefs(db);
    const vehicle = findVehicle(refs, typed);
    if (!path.startsWith(`${vehicle.id}/`) || !thumb_path.startsWith(`${vehicle.id}/`)) {
      throw new ToolError("These files are not that vehicle's photo upload.");
    }
    unwrap(
      await db.from("vehicles").update({ photo_path: path, photo_thumb_path: thumb_path, photo_updated_at: now.toISOString() })
        .eq("id", vehicle.id).select("id"),
      "vehicle",
    );
    const links = await mediaLinks(db, "vehicle-photos", [path, thumb_path], now);
    return {
      result: { vehicle: vehicle.reg_no, photo_url: links.get(path), thumb_url: links.get(thumb_path) },
      summary: `photo of ${vehicle.reg_no} set`,
    };
  },
});

export const vehicleDocumentUploadUrl = tool({
  name: "vehicle_document_upload_url",
  title: "A place to upload a vehicle document",
  description: "Web app only. A one-time signed upload for a vehicle's document: a photo (JPEG or PNG, resized in the browser to " +
    "2000 px) or a PDF, up to 10 MB; then save_vehicle_document saves it.",
  readOnly: false,
  input: z.object({
    vehicle: zText(20).describe("Plate"),
    kind: z.enum(DOC_KINDS),
    content_type: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    bytes: z.number().int().min(1).max(10 * 1024 * 1024).describe("The file's size; at most 10 MB"),
  }),
  async run({ vehicle: typed, kind, content_type }, { db, actor }) {
    webOnly(actor);
    const vehicle = findVehicle(await loadRefs(db), typed);
    const upload = await signedUpload(db, "vehicle-docs", `${vehicle.id}/${kind}/${crypto.randomUUID()}.${EXT[content_type]}`);
    return { result: { upload }, summary: `${kind} upload for ${vehicle.reg_no}` };
  },
});

/** A document as the office reads it, with its link. */
function docCard(d: VehicleDocument, url: string | undefined) {
  return {
    id: d.id,
    kind: d.kind,
    kind_name: d.kind === "other" && d.name ? d.name : DOC_NAME[d.kind as DocKind],
    name: d.name ?? undefined,
    content_type: d.content_type,
    bytes: d.bytes ?? undefined,
    expiry: d.expiry ?? undefined,
    uploaded: `${colomboDateTime(d.uploaded_at)}${d.uploaded_by_name ? ` by ${d.uploaded_by_name}` : ""}`,
    url,
    removed: d.removed_at ? `${colomboDateTime(d.removed_at)}${d.removed_by ? ` by ${d.removed_by}` : ""}` : undefined,
    removed_reason: d.removed_reason ?? undefined,
  };
}

export const saveVehicleDocument = tool({
  name: "save_vehicle_document",
  title: "Save a vehicle document",
  description:
    "Web app only. Saves a document uploaded with vehicle_document_upload_url. It becomes the current one of its kind; the one before " +
    "is kept as replaced. The expiry (revenue licence, insurance, emission test, the rent or lease agreement) is the vehicle's " +
    "date too: the chips, reminders and issues follow it.",
  readOnly: false,
  input: z.object({
    vehicle: zText(20).describe("Plate"),
    kind: z.enum(DOC_KINDS),
    path: zText(300).describe("From vehicle_document_upload_url"),
    content_type: z.enum(["image/jpeg", "image/png", "application/pdf"]),
    bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
    expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, for the kinds that expire"),
    name: zText(80).optional().describe("What it is, for Other"),
  }),
  async run(args, { db, now, actor }) {
    if (args.expiry && !isRealDate(args.expiry)) throw new ToolError(`expiry: ${args.expiry} is not a real date.`);
    if (args.kind === "other" && !args.name) throw new ToolError("Name the document (kind Other).");
    webOnly(actor);
    const vehicle = findVehicle(await loadRefs(db), args.vehicle);
    if (!args.path.startsWith(`${vehicle.id}/${args.kind}/`)) throw new ToolError("This file is not an upload for that vehicle and kind.");
    // No expiry given for a kind that has one: the vehicle's date stays the document's, so the two never disagree.
    const kept = {
      revenue_licence: vehicle.licence_expiry,
      insurance: vehicle.insurance_expiry,
      emission: vehicle.emission_expiry,
      lease: vehicle.rent_until,
    }[
      args.kind as "revenue_licence" | "insurance" | "emission" | "lease"
    ] ?? null;
    // The one before (of the same kind, not removed) is kept, marked replaced; Other may have several.
    if (args.kind !== "other") {
      unwrap(
        await db.from("vehicle_documents").update({ removed_at: now.toISOString(), removed_by: actor.name, removed_reason: "replaced" })
          .eq("vehicle_id", vehicle.id).eq("kind", args.kind).is("removed_at", null).select("id"),
        "vehicle documents",
      );
    }
    const doc = unwrap(
      await db.from("vehicle_documents").insert({
        vehicle_id: vehicle.id,
        kind: args.kind,
        name: args.name ?? null,
        path: args.path,
        content_type: args.content_type,
        bytes: args.bytes ?? null,
        expiry: DOC_EXPIRES.includes(args.kind) ? args.expiry ?? kept : null,
        uploaded_by: actor.employeeId,
        uploaded_by_name: actor.name,
        uploaded_at: now.toISOString(),
      }).select("*").single(),
      "vehicle document",
    );
    const url = (await mediaLinks(db, "vehicle-docs", [doc.path], now)).get(doc.path);
    return { result: { vehicle: vehicle.reg_no, document: docCard(doc, url) }, summary: `${args.kind} saved for ${vehicle.reg_no}` };
  },
});

export const vehicleDocuments = tool({
  name: "vehicle_documents",
  title: "A vehicle's documents",
  description: "A vehicle's documents, one current per kind (and every Other), with links that work for at least an hour, what " +
    "is missing, and with removed true the removed and replaced ones too.",
  readOnly: true,
  input: z.object({ vehicle: zText(20).describe("Plate"), removed: z.boolean().optional() }),
  async run({ vehicle: typed, removed }, { db, now }) {
    const vehicle = findVehicle(await loadRefs(db), typed);
    const rows = unwrap(
      await db.from("vehicle_documents").select("*").eq("vehicle_id", vehicle.id).order("uploaded_at", { ascending: false }).limit(500),
      "vehicle documents",
    );
    const current = rows.filter((d) => !d.removed_at);
    const old = rows.filter((d) => d.removed_at);
    const links = await mediaLinks(db, "vehicle-docs", [...current, ...(removed ? old : [])].map((d) => d.path), now);
    const missing = requiredKinds(vehicle).filter((k) => !current.some((d) => d.kind === k));
    return {
      result: {
        vehicle: vehicle.reg_no,
        documents: current.map((d) => docCard(d, links.get(d.path))),
        missing: missing.length ? missing : undefined,
        missing_text: missing.length ? missingText(missing) : undefined,
        removed: removed ? old.map((d) => docCard(d, links.get(d.path))) : undefined,
      },
      summary: `${vehicle.reg_no}: ${current.length} documents${missing.length ? `, missing ${missingText(missing)}` : ""}`,
    };
  },
});

async function getDocument(db: Db, id: string): Promise<VehicleDocument> {
  const doc = unwrapMaybe(await db.from("vehicle_documents").select("*").eq("id", id).maybeSingle(), "vehicle document");
  if (!doc) throw new ToolError(`No vehicle document has the id ${id}.`);
  return doc;
}

export const removeVehicleDocument = tool({
  name: "remove_vehicle_document",
  title: "Remove a vehicle document",
  description: "Takes a document off the vehicle (kept, with Restore). The vehicle's date stays as it was.",
  readOnly: false,
  input: z.object({ id: zId }),
  async run({ id }, { db, now, actor }) {
    const doc = await getDocument(db, id);
    if (doc.removed_at) throw new ToolError("This document is removed already.");
    const rows = unwrap(
      await db.from("vehicle_documents").update({ removed_at: now.toISOString(), removed_by: actor.name, removed_reason: "removed" })
        .eq("id", id).is("removed_at", null).select("*"),
      "vehicle document",
    );
    return { result: { document: docCard(rows[0], undefined) }, summary: `document ${id} (${doc.kind}) removed` };
  },
});

export const restoreVehicleDocument = tool({
  name: "restore_vehicle_document",
  title: "Restore a vehicle document",
  description: "Puts a removed or replaced document back. It becomes the current one of its kind again (the one after it is kept " +
    "as replaced).",
  readOnly: false,
  input: z.object({ id: zId }),
  async run({ id }, { db, now, actor }) {
    const doc = await getDocument(db, id);
    if (!doc.removed_at) throw new ToolError("This document is not removed.");
    if (doc.kind !== "other") {
      unwrap(
        await db.from("vehicle_documents").update({ removed_at: now.toISOString(), removed_by: actor.name, removed_reason: "replaced" })
          .eq("vehicle_id", doc.vehicle_id).eq("kind", doc.kind).is("removed_at", null).select("id"),
        "vehicle documents",
      );
    }
    // The only one of its kind not removed: the current one, and its expiry is the vehicle's date again (the trigger).
    const rows = unwrap(
      await db.from("vehicle_documents").update({ removed_at: null, removed_by: null, removed_reason: null }).eq("id", id).select("*"),
      "vehicle document",
    );
    const url = (await mediaLinks(db, "vehicle-docs", [doc.path], now)).get(doc.path);
    return { result: { document: docCard(rows[0], url) }, summary: `document ${id} (${doc.kind}) restored` };
  },
});

/** The documents of these vehicles, for list_vehicles and the issues (current ones only, no links). */
export async function documentsOf(db: Db, vehicleIds: string[]) {
  if (vehicleIds.length === 0) return new Map<string, VehicleDocument[]>();
  const rows = unwrap(
    await db.from("vehicle_documents").select("*").in("vehicle_id", vehicleIds).is("removed_at", null).limit(5000),
    "vehicle documents",
  );
  const out = new Map<string, VehicleDocument[]>();
  for (const d of rows) out.set(d.vehicle_id, [...(out.get(d.vehicle_id) ?? []), d]);
  return out;
}
