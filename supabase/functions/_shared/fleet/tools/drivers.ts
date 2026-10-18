// Drivers: list, create (with their sign-in), reset PIN, switch on/off, update.

import { z } from "zod";
import type { Db } from "../db.ts";
import { ToolError, unwrap } from "../db.ts";
import { docChip, type Employee, findDriver, loadLatest, loadRefs, sharing } from "../fleet.ts";
import { phoneDisplay, plain, telLink, waLink } from "../format.ts";
import { logChanges, seesDriverPhones, storedPhone } from "../phones.ts";
import { colomboDate, colomboTime, dayRange } from "../time.ts";
import { driverPhotoLinks } from "../media.ts";
import { realDate, tool, zDate, zPaging, zSearch, zText } from "../tool.ts";
import { pageOf, pageWindow } from "../paging.ts";

// Drivers sign in with a username and a 6-digit PIN. Supabase Auth needs an
// email, so each driver gets one that can never receive mail.
const EMAIL_DOMAIN = "drivers.fame.invalid";
const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;

const zUsername = z.string().regex(/^[A-Za-z0-9._-]{3,40}$/, "3 to 40 characters: letters, digits, dot, underscore, dash")
  .describe("Sign-in name the driver types, e.g. nuwan.p");
const zPin = z.string().regex(/^\d{6}$/, "The PIN is exactly 6 digits").describe("6-digit PIN, as a string");
const zDriverRef = zText(80).describe("The driver's username (employee code or full name also work)");

/** A driver's card; `phones` false (Hotfix 2, F: someone who only views) leaves the number and its links out. */
function driverCard(e: Employee, plate: string | null, location?: string, phones = true) {
  return {
    name: e.name,
    code: e.code,
    username: e.username,
    phone: phones ? e.phone : undefined,
    phone_display: phones ? phoneDisplay(e.phone) : undefined,
    active: e.active,
    language: e.language,
    has_login: e.auth_user_id !== null,
    current_vehicle: plate,
    location,
    // Part 3b (G): WhatsApp goes to the driver's WhatsApp number when they gave one.
    ...(phones ? { call: telLink(e.phone), whatsapp: waLink(e.whatsapp ?? e.phone) } : {}),
  };
}

/** Finds an Auth user by email. The admin API can only list, so this pages through. */
async function authUserIdByEmail(db: Db, email: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Auth: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

export const listDrivers = tool({
  name: "list_drivers",
  title: "List drivers",
  description:
    "All drivers with code, username, phone, licence expiry, current vehicle, whether they are sharing their location (on duty since HH:MM, or off duty since), and how many tasks each accepted and declined in the last 30 days.",
  readOnly: true,
  input: z.object({
    include_inactive: z.boolean().optional().describe("Also show drivers who have been switched off"),
    // Hotfix 3 (L3): the search box (name, username, code, plate) and a page at a time.
    search: zSearch,
    ...zPaging,
  }),
  async run({ include_inactive, search, limit, cursor }, { db, now, actor }) {
    const since = new Date(now.getTime() - 30 * 86400000).toISOString();
    const today = colomboDate(now);
    const [refs, latest, eventsRes, openRes, endedRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("task_assignment_events").select("employee_id, action").in("action", ["accepted", "declined"]).gte("at", since),
      db.from("duty_sessions").select("employee_id, started_at").is("ended_at", null),
      db.from("duty_sessions").select("employee_id, ended_at").gte("ended_at", dayRange(today).from).order("ended_at", { ascending: false })
        .limit(2000),
    ]);
    const onDuty = new Map(unwrap(openRes, "duty sessions").map((s) => [s.employee_id, s.started_at]));
    const offDuty = new Map<string, string>();
    for (const s of unwrap(endedRes, "duty sessions")) {
      if (s.ended_at && !offDuty.has(s.employee_id)) offDuty.set(s.employee_id, s.ended_at);
    }
    // Accepts and declines per driver in the last 30 days.
    const last30 = new Map<string, { accepted: number; declined: number }>();
    for (const e of unwrap(eventsRes, "assignment history")) {
      if (!e.employee_id) continue;
      const row = last30.get(e.employee_id) ?? { accepted: 0, declined: 0 };
      if (e.action === "accepted") row.accepted += 1;
      else row.declined += 1;
      last30.set(e.employee_id, row);
    }
    const key = search ? plain(search) : "";
    const matches = (e: Employee) =>
      !key || [e.name, e.username ?? "", e.code, e.current_vehicle_id ? refs.veh.get(e.current_vehicle_id)?.reg_no ?? "" : ""]
        .some((x) => plain(x).includes(key));
    const page = pageOf(
      refs.employees.filter((e) => e.role === "driver" && (include_inactive || e.active) && matches(e)),
      pageWindow(limit, cursor),
    );
    const shown = page.rows;
    // Phase 7 (§5): each driver's photo (a link that works for at least an hour; the same link while it lasts).
    const photos = await driverPhotoLinks(db, shown, now);
    const drivers = shown
      .map((e) => ({
        ...driverCard(
          e,
          e.current_vehicle_id ? refs.veh.get(e.current_vehicle_id)?.reg_no ?? null : null,
          sharing(latest.get(e.id), now).text,
          seesDriverPhones(actor),
        ),
        licence: e.licence_expiry ? docChip(e.licence_expiry, today) : undefined,
        last_30_days: last30.get(e.id) ?? { accepted: 0, declined: 0 },
        // Presence: on duty = sharing location (the open duty session); off duty since = when the last one ended today.
        on_duty_since: onDuty.has(e.id) ? colomboTime(onDuty.get(e.id)!) : undefined,
        off_duty_since: !onDuty.has(e.id) && offDuty.has(e.id) ? colomboTime(offDuty.get(e.id)!) : undefined,
        photo_url: photos.get(e.id),
      }));
    return { result: { count: drivers.length, total: page.total, next: page.next, drivers }, summary: `${drivers.length} drivers` };
  },
});

export const createDriver = tool({
  name: "create_driver",
  title: "Create driver",
  description:
    "Adds a driver and their Fame Driver sign-in (username + 6-digit PIN). The PIN is not stored in readable form and is not shown again: tell the driver right away. The phone number is needed (Part 3b).",
  readOnly: false,
  input: z.object({
    name: zText(120).describe("Full name"),
    code: zText(30).describe("Employee number / code, e.g. E0123"),
    username: zUsername,
    pin: zPin,
    phone: zText(30).describe("Mobile number, e.g. 0771234567 (needed)"),
  }),
  async run(args, { db }) {
    // Checked before the sign-in is made (stored +94…). Part 3b (G): a driver always has a number.
    const phone = storedPhone(args.phone);
    if (!phone) throw new ToolError("phone: the driver's mobile number is needed, e.g. 077 123 4567.");
    const username = args.username.toLowerCase();
    const code = args.code.trim();
    const email = emailFor(username);

    const [sameUsername, sameCode] = await Promise.all([
      db.from("employees").select("name").eq("username", username),
      db.from("employees").select("name").eq("code", code),
    ]);
    const usernameTaken = unwrap(sameUsername, "employees")[0];
    if (usernameTaken) throw new ToolError(`Username "${username}" is already used by ${usernameTaken.name}.`);
    const codeTaken = unwrap(sameCode, "employees")[0];
    if (codeTaken) throw new ToolError(`Employee code "${code}" is already used by ${codeTaken.name}.`);

    // The sign-in. email_confirm: these addresses cannot receive a confirmation mail.
    let authUserId: string;
    const created = await db.auth.admin.createUser({
      email,
      password: args.pin,
      email_confirm: true,
      user_metadata: { username, employee_code: code },
    });
    if (created.data?.user) {
      authUserId = created.data.user.id;
    } else {
      // A sign-in with this username is left over from an attempt that did not
      // finish. It belongs to nobody (checked above), so reuse it with the new PIN.
      const existing = await authUserIdByEmail(db, email);
      if (!existing) throw new ToolError(`Could not create the sign-in: ${created.error?.message ?? "unknown error"}`);
      const reused = await db.auth.admin.updateUserById(existing, { password: args.pin, email_confirm: true, ban_duration: "none" });
      if (reused.error) throw new ToolError(`Could not reuse the existing sign-in: ${reused.error.message}`);
      authUserId = existing;
    }

    const inserted = await db.from("employees")
      .insert({ code, name: args.name, username, phone, role: "driver", permissions: [], auth_user_id: authUserId })
      .select("*")
      .single();
    if (inserted.error) {
      throw new ToolError(
        `The sign-in was created, but the driver could not be saved: ${inserted.error.details ?? inserted.error.message} ` +
          `Fix that and run create_driver again with the same username; it will reuse the sign-in.`,
      );
    }

    return {
      result: {
        created: driverCard(inserted.data, null),
        sign_in: { username, pin: "set (not shown again)" },
        next: "Give the driver the username and PIN. They sign in to the Fame Driver app with them.",
      },
      summary: `created driver ${args.name} (${code}, ${username})`,
    };
  },
});

export const resetPin = tool({
  name: "reset_pin",
  title: "Reset driver PIN",
  description: "Sets a new 6-digit PIN for a driver. The old PIN stops working at once.",
  readOnly: false,
  input: z.object({ username: zDriverRef, pin: zPin }),
  async run({ username, pin }, { db }) {
    const driver = findDriver(await loadRefs(db), username, { demoToo: true });
    if (!driver.auth_user_id) throw new ToolError(`${driver.name} has no sign-in yet. Use create_driver.`);
    const { error } = await db.auth.admin.updateUserById(driver.auth_user_id, { password: pin });
    if (error) throw new ToolError(`Could not set the PIN: ${error.message}`);
    return {
      result: { driver: driver.name, username: driver.username, pin: "changed (not shown again)" },
      summary: `PIN reset for ${driver.name} (${driver.username})`,
    };
  },
});

export const setDriverActive = tool({
  name: "set_driver_active",
  title: "Switch a driver on or off",
  description:
    "active=false: the driver can no longer sign in or see anything, and location sharing is ended. active=true switches them back on. Nothing is deleted.",
  readOnly: false,
  input: z.object({ username: zDriverRef, active: z.boolean() }),
  async run({ username, active }, { db, now }) {
    const driver = findDriver(await loadRefs(db), username, { demoToo: true });
    unwrap(await db.from("employees").update({ active }).eq("id", driver.id).select("id"), "employee");

    const notes: string[] = [];
    if (driver.auth_user_id) {
      // Also block (or unblock) the sign-in itself, so existing sessions cannot be renewed.
      const { error } = await db.auth.admin.updateUserById(driver.auth_user_id, { ban_duration: active ? "none" : "876000h" });
      if (error) notes.push(`The sign-in could not be ${active ? "unblocked" : "blocked"}: ${error.message}`);
    }
    if (!active) {
      unwrap(
        await db.from("duty_sessions").update({ ended_at: now.toISOString(), end_reason: "admin" })
          .eq("employee_id", driver.id).is("ended_at", null).select("id"),
        "location sharing",
      );
      const open = unwrap(
        await db.from("tasks").select("id, title, status").eq("employee_id", driver.id).in("status", ["assigned", "in_progress"]),
        "tasks",
      );
      if (open.length > 0) {
        notes.push(
          `${driver.name} still has ${open.length} open task(s): ${open.map((t) => t.title).join("; ")}. Reassign or cancel them.`,
        );
      }
    }
    return {
      result: { driver: driver.name, username: driver.username, active, notes },
      summary: `${driver.name} (${driver.username}) set ${active ? "active" : "inactive"}`,
    };
  },
});

/** Part 3b (G): the profile fields a driver and the office edit, as stored (numbers +94…, words trimmed). */
export interface ProfilePatch {
  phone?: string | null;
  whatsapp?: string | null;
  emergency_name?: string | null;
  emergency_relation?: string | null;
  emergency_phone?: string | null;
  licence_no?: string | null;
  licence_expiry?: string | null;
}

const text = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim());

/** Typed values → stored ones; a bad number or date is refused in words. Undefined fields are left as they are. */
export function profilePatch(typed: ProfilePatch): ProfilePatch {
  if (typed.licence_expiry) realDate(typed.licence_expiry, "licence_expiry");
  const patch: ProfilePatch = {
    phone: storedPhone(typed.phone),
    whatsapp: storedPhone(typed.whatsapp, "whatsapp"),
    emergency_name: text(typed.emergency_name),
    emergency_relation: text(typed.emergency_relation),
    emergency_phone: storedPhone(typed.emergency_phone, "emergency_phone"),
    licence_no: text(typed.licence_no),
    licence_expiry: typed.licence_expiry === undefined ? undefined : typed.licence_expiry || null,
  };
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as ProfilePatch;
}

/** Saves a driver's profile fields and logs each one that changed. Answers the updated row. */
export async function saveProfile(
  db: Db,
  driver: Employee,
  patch: ProfilePatch,
  actor: Parameters<typeof logChanges>[3],
): Promise<Employee> {
  if (Object.keys(patch).length === 0) throw new ToolError("Nothing to change.");
  // Clearing a number the driver has is refused; a null for one who has none changes nothing (an older page sends it).
  if ("phone" in patch && patch.phone === null && driver.role === "driver" && driver.phone) {
    throw new ToolError("phone: a driver always has a mobile number (Part 3b); give the new one instead.");
  }
  const updated = unwrap(await db.from("employees").update(patch).eq("id", driver.id).select("*").single(), "employee");
  await logChanges(
    db,
    driver.id,
    (Object.keys(patch) as (keyof ProfilePatch)[]).map((field) => ({
      field,
      before: driver[field] ?? null,
      after: updated[field] ?? null,
    })),
    actor,
  );
  return updated;
}

export const updateDriver = tool({
  name: "update_driver",
  title: "Update driver",
  description: "Changes a driver's phone number, WhatsApp number, emergency contact (name, relationship, phone), driving " +
    "licence number and/or licence expiry date. Send null to clear a value (never the phone). Every change is logged.",
  readOnly: false,
  input: z.object({
    username: zDriverRef,
    phone: zText(30).nullable().optional(),
    licence_expiry: zDate.nullable().optional().describe("Driving licence expiry, YYYY-MM-DD"),
    whatsapp: zText(30).nullable().optional().describe("Part 3b: the WhatsApp number, when it is not the phone"),
    emergency_name: zText(120).nullable().optional(),
    emergency_relation: zText(60).nullable().optional().describe("e.g. wife, brother"),
    emergency_phone: zText(30).nullable().optional(),
    licence_no: zText(40).nullable().optional().describe("Driving licence number"),
  }),
  async run({ username, ...typed }, { db, actor }) {
    const patch = profilePatch(typed);
    const refs = await loadRefs(db);
    const driver = findDriver(refs, username, { demoToo: true });
    if (Object.keys(patch).length === 0) {
      throw new ToolError("Nothing to change: give phone, whatsapp, the emergency contact, licence_no or licence_expiry.");
    }
    const updated = await saveProfile(db, driver, patch, actor);
    const plate = updated.current_vehicle_id ? refs.veh.get(updated.current_vehicle_id)?.reg_no ?? null : null;
    return {
      result: { updated: { ...driverCard(updated, plate), licence_expiry: updated.licence_expiry } },
      summary: `updated ${driver.name}: ${Object.keys(patch).join(", ")}`,
    };
  },
});
