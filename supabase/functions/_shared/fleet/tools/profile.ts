// Part 3b (G): a driver's profile for the office (the Drivers page's driver): the numbers, the emergency contact, the
// licence with its photos, this month's tasks and km, the app version, the availability ahead and every change with who
// made it. The emergency contact and the licence reach only people with users or vehicles, never a requester.

import { z } from "zod";
import { ToolError, unwrap } from "../db.ts";
import { docChip, findDriver, loadRefs } from "../fleet.ts";
import { personLinks, phoneDisplay } from "../format.ts";
import { driverPhotoLinks, mediaLinks } from "../media.ts";
import { CHANGE_FIELD_TEXT, seesDriverPhones, seesDriverPrivate } from "../phones.ts";
import { colomboDate, colomboDateTime, monthRange } from "../time.ts";
import { tool, zText } from "../tool.ts";
import { entryCard } from "./unavailability.ts";

const PHOTO_FIELDS = new Set(["licence_front_photo", "licence_back_photo"]);
const PRIVATE_FIELDS = new Set(["emergency_name", "emergency_relation", "emergency_phone", "licence_no", ...PHOTO_FIELDS]);

export const driverProfile = tool({
  name: "driver_profile",
  title: "A driver's profile",
  description: "Part 3b (G): one driver's profile: photo, name, code, phone and WhatsApp with Call and WhatsApp links, " +
    "language, current vehicle, app version, this month's tasks and km, when they are not available in the next 30 days, " +
    "and what is missing; with users or vehicles also the emergency contact, the licence (number, expiry, front and back " +
    'photos as 1-hour links) and every change with who made it ("changed by the driver").',
  readOnly: true,
  input: z.object({ driver: zText(80).describe("Username, code or name") }),
  async run({ driver: typed }, { db, now, actor }) {
    const refs = await loadRefs(db);
    const d = findDriver(refs, typed);
    const full = seesDriverPrivate(actor);
    const phones = seesDriverPhones(actor);
    const month = colomboDate(now).slice(0, 7);
    const span = monthRange(month);
    const ahead = new Date(now.getTime() + 30 * 86400000).toISOString();
    const [latestRes, tasksRes, offRes, changesRes, photosRes] = await Promise.all([
      db.from("driver_latest").select("hb_app_version").eq("employee_id", d.id).maybeSingle(),
      db.from("tasks").select("status, start_odometer_km, end_odometer_km, purpose").eq("employee_id", d.id).eq("status", "completed")
        .gte("completed_at", span.from).lt("completed_at", span.to),
      db.from("driver_unavailability").select("*").eq("employee_id", d.id).is("removed_at", null).gt("ends_at", now.toISOString())
        .lt("starts_at", ahead).order("starts_at"),
      full
        ? db.from("employee_changes").select("*").eq("employee_id", d.id).order("at", { ascending: false }).limit(50)
        : Promise.resolve({ data: [], error: null }),
      full && (d.licence_front_photo_id || d.licence_back_photo_id)
        ? db.from("photos").select("id, storage_path").in(
          "id",
          [d.licence_front_photo_id, d.licence_back_photo_id].filter((x): x is string => !!x),
        )
        : Promise.resolve({ data: [], error: null }),
    ]);
    const tasks = unwrap(tasksRes, "tasks");
    const km = tasks.reduce((sum, t) => sum + Math.max(0, (t.end_odometer_km ?? 0) - (t.start_odometer_km ?? 0)), 0);
    const photoRows = unwrap(photosRes as { data: { id: string; storage_path: string }[] | null; error: null }, "photos");
    const links = await mediaLinks(db, "driver-photos", photoRows.map((p) => p.storage_path), now);
    const photoUrl = (id: string | null) => {
      const p = photoRows.find((r) => r.id === id);
      return p ? links.get(p.storage_path) : undefined;
    };
    const photo = (await driverPhotoLinks(db, [d], now)).get(d.id);
    const today = colomboDate(now);
    const missing = [
      !d.phone && "phone",
      !d.licence_expiry && "licence expiry",
      full && !d.licence_no && "licence number",
      full && !d.emergency_phone && "emergency contact",
    ].filter((x): x is string => !!x);
    const changes = unwrap(
      changesRes as {
        data:
          | { field: string; old_value: string | null; new_value: string | null; changed_by_name: string; channel: string; at: string }[]
          | null;
        error: null;
      },
      "changes",
    )
      .filter((c) => full || !PRIVATE_FIELDS.has(c.field))
      .map((c) => ({
        field: c.field,
        what: CHANGE_FIELD_TEXT[c.field] ?? c.field,
        from: PHOTO_FIELDS.has(c.field) ? (c.old_value ? "a photo" : undefined) : c.old_value ?? undefined,
        to: PHOTO_FIELDS.has(c.field) ? "a new photo" : c.new_value ?? undefined,
        by: c.channel === "driver" ? "changed by the driver" : `changed by ${c.changed_by_name}`,
        by_driver: c.channel === "driver" || undefined,
        at: colomboDateTime(c.at),
      }));
    const plate = d.current_vehicle_id ? refs.veh.get(d.current_vehicle_id)?.reg_no : undefined;
    const latest = unwrap(latestRes, "app");
    return {
      result: {
        driver: {
          name: d.name,
          code: d.code,
          username: d.username ?? undefined,
          active: d.active,
          language: d.language,
          photo_url: photo,
          phone: phones ? d.phone ?? undefined : undefined,
          phone_display: phones ? phoneDisplay(d.phone) ?? undefined : undefined,
          whatsapp: phones ? d.whatsapp ?? undefined : undefined,
          whatsapp_display: phones ? phoneDisplay(d.whatsapp) ?? undefined : undefined,
          links: phones ? personLinks(d.phone, d.whatsapp) : undefined,
          current_vehicle: plate,
          app_version: latest?.hb_app_version ?? undefined,
          licence_chip: d.licence_expiry ? docChip(d.licence_expiry, today) : undefined,
        },
        emergency: full && (d.emergency_name || d.emergency_phone)
          ? {
            name: d.emergency_name ?? undefined,
            relation: d.emergency_relation ?? undefined,
            phone: d.emergency_phone ?? undefined,
            phone_display: phoneDisplay(d.emergency_phone) ?? undefined,
            links: personLinks(d.emergency_phone, null),
          }
          : undefined,
        licence: full
          ? {
            number: d.licence_no ?? undefined,
            expiry: d.licence_expiry ?? undefined,
            chip: d.licence_expiry ? docChip(d.licence_expiry, today).chip : "not set",
            front_url: photoUrl(d.licence_front_photo_id),
            back_url: photoUrl(d.licence_back_photo_id),
          }
          : undefined,
        this_month: { month, tasks: tasks.length, km },
        not_available: unwrap(offRes, "availability").map((u) => entryCard(u, d.name)),
        missing,
        changes: full ? changes : undefined,
        private_hidden: full ? undefined : "The emergency contact and the licence are shown to people with users or vehicles.",
      },
      summary: `profile of ${d.name}`,
    };
  },
});

export const setDriverLicencePhoto = tool({
  name: "set_driver_licence_photo",
  title: "A driver's licence photo",
  description: "Part 3b (G): saves the front or back of a driver's licence uploaded with photo_upload_url (driver_licence). " +
    "The old photo is kept; the change is logged.",
  readOnly: false,
  input: z.object({
    driver: zText(80).describe("Username, code or name"),
    side: z.enum(["front", "back"]),
    path: zText(300).describe("From photo_upload_url"),
  }),
  async run({ driver: typed, side, path }, { db, now, actor }) {
    const refs = await loadRefs(db);
    const driver = findDriver(refs, typed);
    if (!path.startsWith(`${driver.id}/licence/`) || !path.endsWith(".jpg")) {
      throw new ToolError("This file is not that driver's licence upload.");
    }
    const photo = unwrap(
      await db.from("photos").insert({ employee_id: driver.id, kind: "licence", storage_path: path, taken_at: now.toISOString() })
        .select("id").single(),
      "photo",
    );
    const before = side === "front" ? driver.licence_front_photo_id : driver.licence_back_photo_id;
    const patch = side === "front" ? { licence_front_photo_id: photo.id } : { licence_back_photo_id: photo.id };
    unwrap(await db.from("employees").update(patch).eq("id", driver.id).select("id"), "employee");
    unwrap(
      await db.from("employee_changes").insert({
        employee_id: driver.id,
        field: `licence_${side}_photo`,
        old_value: before,
        new_value: photo.id,
        changed_by_name: actor.name,
        changed_by_employee_id: actor.employeeId,
        channel: actor.channel,
      }),
      "change log",
    );
    const url = (await mediaLinks(db, "driver-photos", [path], now)).get(path);
    return { result: { driver: driver.name, side, photo_url: url }, summary: `licence photo (${side}) of ${driver.name}` };
  },
});
