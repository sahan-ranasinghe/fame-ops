// Drivers: list, create (with their sign-in), reset PIN, switch on/off, update.

import { z } from "zod";
import type { Db } from "../db.ts";
import { ToolError, unwrap } from "../db.ts";
import { docChip, type Employee, findDriver, loadLatest, loadRefs, sharing } from "../fleet.ts";
import { contactLinks } from "../format.ts";
import { colomboDate } from "../time.ts";
import { realDate, tool, zDate, zText } from "../tool.ts";

// Drivers sign in with a username and a 6-digit PIN. Supabase Auth needs an
// email, so each driver gets one that can never receive mail.
const EMAIL_DOMAIN = "drivers.fame.invalid";
const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;

const zUsername = z.string().regex(/^[A-Za-z0-9._-]{3,40}$/, "3 to 40 characters: letters, digits, dot, underscore, dash")
  .describe("Sign-in name the driver types, e.g. nuwan.p");
const zPin = z.string().regex(/^\d{6}$/, "The PIN is exactly 6 digits").describe("6-digit PIN, as a string");
const zDriverRef = zText(80).describe("The driver's username (employee code or full name also work)");

function driverCard(e: Employee, plate: string | null, location?: string) {
  return {
    name: e.name,
    code: e.code,
    username: e.username,
    phone: e.phone,
    active: e.active,
    language: e.language,
    has_login: e.auth_user_id !== null,
    current_vehicle: plate,
    location,
    ...contactLinks(e.phone),
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
    "All drivers with code, username, phone, licence expiry, current vehicle, whether they are sharing their location, and how many tasks each accepted and declined in the last 30 days.",
  readOnly: true,
  input: z.object({
    include_inactive: z.boolean().optional().describe("Also show drivers who have been switched off"),
  }),
  async run({ include_inactive }, { db, now }) {
    const since = new Date(now.getTime() - 30 * 86400000).toISOString();
    const [refs, latest, eventsRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("task_assignment_events").select("employee_id, action").in("action", ["accepted", "declined"]).gte("at", since),
    ]);
    const today = colomboDate(now);
    // Accepts and declines per driver in the last 30 days.
    const last30 = new Map<string, { accepted: number; declined: number }>();
    for (const e of unwrap(eventsRes, "assignment history")) {
      if (!e.employee_id) continue;
      const row = last30.get(e.employee_id) ?? { accepted: 0, declined: 0 };
      if (e.action === "accepted") row.accepted += 1;
      else row.declined += 1;
      last30.set(e.employee_id, row);
    }
    const drivers = refs.employees
      .filter((e) => e.role === "driver" && (include_inactive || e.active))
      .map((e) => ({
        ...driverCard(
          e,
          e.current_vehicle_id ? refs.veh.get(e.current_vehicle_id)?.reg_no ?? null : null,
          sharing(latest.get(e.id), now).text,
        ),
        licence: e.licence_expiry ? docChip(e.licence_expiry, today) : undefined,
        last_30_days: last30.get(e.id) ?? { accepted: 0, declined: 0 },
      }));
    return { result: { count: drivers.length, drivers }, summary: `${drivers.length} drivers` };
  },
});

export const createDriver = tool({
  name: "create_driver",
  title: "Create driver",
  description:
    "Adds a driver and their Fame Driver sign-in (username + 6-digit PIN). The PIN is not stored in readable form and is not shown again: tell the driver right away.",
  readOnly: false,
  input: z.object({
    name: zText(120).describe("Full name"),
    code: zText(30).describe("Employee number / code, e.g. E0123"),
    username: zUsername,
    pin: zPin,
    phone: zText(30).optional().describe("Mobile number, e.g. 0771234567"),
  }),
  async run(args, { db }) {
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
      .insert({ code, name: args.name, username, phone: args.phone ?? null, role: "driver", permissions: [], auth_user_id: authUserId })
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
    const driver = findDriver(await loadRefs(db), username);
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
    const driver = findDriver(await loadRefs(db), username);
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

export const updateDriver = tool({
  name: "update_driver",
  title: "Update driver",
  description: "Changes a driver's phone number and/or driving licence expiry date. Send null to clear a value.",
  readOnly: false,
  input: z.object({
    username: zDriverRef,
    phone: zText(30).nullable().optional(),
    licence_expiry: zDate.nullable().optional().describe("Driving licence expiry, YYYY-MM-DD"),
  }),
  async run({ username, phone, licence_expiry }, { db }) {
    const refs = await loadRefs(db);
    const driver = findDriver(refs, username);
    if (phone === undefined && licence_expiry === undefined) throw new ToolError("Nothing to change: give phone and/or licence_expiry.");
    if (licence_expiry) realDate(licence_expiry, "licence_expiry");

    const updated = unwrap(
      await db.from("employees")
        .update({ ...(phone !== undefined && { phone }), ...(licence_expiry !== undefined && { licence_expiry }) })
        .eq("id", driver.id).select("*").single(),
      "employee",
    );
    const plate = updated.current_vehicle_id ? refs.veh.get(updated.current_vehicle_id)?.reg_no ?? null : null;
    return {
      result: { updated: { ...driverCard(updated, plate), licence_expiry: updated.licence_expiry } },
      summary: `updated ${driver.name}: ${
        [phone !== undefined && "phone", licence_expiry !== undefined && "licence_expiry"].filter(Boolean).join(", ")
      }`,
    };
  },
});
