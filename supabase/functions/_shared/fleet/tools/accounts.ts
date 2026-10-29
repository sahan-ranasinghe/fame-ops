// Office accounts and personal connector keys (admin only).
//
// Nobody types a password in a chat: create_office_user creates the Auth
// user without one and returns a set-password link that the admin sends by
// WhatsApp. The person opens it on the web app's /set-password page and
// chooses their own password. reset_office_password returns a fresh link.
// Supabase's own e-mail is not used (it only reaches project team members).
// Round 49: the links are our own (passwordLinks.ts; Google Workspace's invite pattern): opened any number of times,
// used only by the password save, 7 days, ended by a newer link. Supabase's recovery links were used up by WhatsApp's
// preview.
//
// create_office_key gives a person their own connector URL for Claude, so
// the audit log carries their name and their role applies in Claude too.

import { z } from "zod";
import type { Db } from "../db.ts";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { accountChangeProblem } from "../accountGuards.ts";
import { normalisePermissions, PERMISSIONS, permissionsForRole, roleForPermissions } from "../permissions.ts";
import { isRole, OFFICE_ROLES, type Role } from "../roles.ts";
import { colomboDateTime } from "../time.ts";
import { phoneDisplay, plain } from "../format.ts";
import { logChanges, logPhoneChange, storedPhone } from "../phones.ts";
import { realDate, tool, zDate, zPaging, zSearch, zText } from "../tool.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { driverPhotoLinks } from "../media.ts";
import { issuePasswordLink, LINK_VALID_FOR, type LinkKind } from "../passwordLinks.ts";

const zEmail = z.string().trim().toLowerCase().email().max(160);
const zOfficeRole = z.enum(["admin", "fleet_admin", "office", "coordinator", "staff", "viewer"]);
const zPermissions = z.array(z.enum(PERMISSIONS as [string, ...string[]])).max(PERMISSIONS.length)
  .describe("Any of: view, request, approve, assign_tasks, vehicles, issues, users, office_users");

async function officeUser(db: Db, email: string) {
  const row = unwrapMaybe(
    await db.from("employees").select("id, code, name, email, phone, role, permissions, active, auth_user_id").eq("email", email)
      .maybeSingle(),
    "office user",
  );
  if (!row || !OFFICE_ROLES.includes(row.role as Role)) {
    throw new ToolError(`No office user has the e-mail ${email}. Use list_office_users.`);
  }
  return row;
}

/**
 * Round 2b: the least-privilege rules (accountGuards.ts), the same for office-api and office-mcp. For a change to an
 * admin's account the active admins are counted first (rule 5: the last one stays an admin and stays on).
 */
async function guard(
  db: Db,
  actor: { employeeId: string | null; permissions: readonly string[] },
  change: Parameters<typeof accountChangeProblem>[1],
) {
  const activeAdmins = change.kind !== "create" && change.target.permissions.includes("users") ? await countActiveAdmins(db) : undefined;
  const problem = accountChangeProblem(
    { employeeId: actor.employeeId, permissions: normalisePermissions(actor.permissions) },
    change,
    { activeAdmins },
  );
  if (problem) throw new ToolError(problem);
}
async function countActiveAdmins(db: Db): Promise<number> {
  const { count, error } = await db.from("employees").select("id", { count: "exact", head: true })
    .eq("active", true).contains("permissions", ["users"]).in("role", OFFICE_ROLES as unknown as string[]);
  if (error) throw new Error(`active admins: ${error.message}`);
  return count ?? 0;
}
const targetOf = (row: { id: string; permissions: unknown; role: string; active: boolean }) => ({
  id: row.id,
  permissions: normalisePermissions(row.permissions as string[]),
  role: row.role,
  active: row.active,
});

/** A set-password link for the person (Round 49: passwordLinks.ts): valid 7 days, used only by the password save. */
async function setPasswordLink(db: Db, employeeId: string, kind: LinkKind, actor: { name: string }): Promise<string> {
  return (await issuePasswordLink(db, { employeeId, kind, by: actor.name })).link;
}

function keyUrl(key: string): string {
  const base = (Deno.env.get("OFFICE_FUNCTIONS_URL") ?? `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1`).replace(/\/$/, "");
  return `${base}/office-mcp/${key}/mcp`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const listOfficeUsers = tool({
  name: "list_office_users",
  title: "Office users",
  description: "The people with an office sign-in, active or not, with their permissions (view, request, approve, assign_tasks, " +
    "vehicles, issues, users), the role label and their connector keys.",
  readOnly: true,
  // Hotfix 3 (L3): the search box (name, e-mail, role) and a page at a time.
  input: z.object({ search: zSearch, ...zPaging }),
  async run({ search, limit, cursor }, { db, actor, now }) {
    // Connector keys are the admins' (users) only; a Coordinator sees the accounts, not the keys.
    const seesKeys = actor.permissions.includes("users");
    const [users, keys] = await Promise.all([
      fetchAll(
        (a, b) =>
          db.from("employees").select(
            "id, code, name, email, phone, role, permissions, active, created_at, driver_contact, photo_id, can_drive",
          )
            .in("role", [...OFFICE_ROLES]).order("name").range(a, b),
        "office users",
      ),
      fetchAll(
        (a, b) =>
          db.from("office_keys").select("id, employee_id, label, created_at, last_used_at, revoked_at").order("created_at").range(a, b),
        "connector keys",
      ),
    ]);
    const key = search ? plain(search) : "";
    const found = key ? users.filter((u) => [u.name, u.email ?? "", u.role].some((x) => plain(x).includes(key))) : users;
    const page = pageOf(found, pageWindow(limit, cursor));
    // Round 3: each person's photo (initials until there is one), for the shown page only.
    const photos = await driverPhotoLinks(db, page.rows, now);
    return {
      result: {
        count: page.rows.length,
        total: page.total,
        next: page.next,
        users: page.rows.map((u) => ({
          name: u.name,
          email: u.email,
          photo_url: photos.get(u.id),
          phone: u.phone,
          phone_display: phoneDisplay(u.phone),
          role: u.role,
          permissions: normalisePermissions(u.permissions),
          active: u.active,
          // Round 1: shown to drivers as a contact (Me: name, Call, WhatsApp).
          driver_contact: u.driver_contact === true,
          // Round 50: drives their own self-drive trips with the app (true), taken away (false), never decided (absent).
          can_drive: u.can_drive ?? undefined,
          since: colomboDateTime(u.created_at),
          connector_keys: !seesKeys ? undefined : keys.filter((k) => k.employee_id === u.id && !k.revoked_at).map((k) => ({
            id: k.id,
            label: k.label,
            created: colomboDateTime(k.created_at),
            last_used: k.last_used_at ? colomboDateTime(k.last_used_at) : "never",
          })),
        })),
      },
      summary: `${users.length} office users`,
    };
  },
});

export const createOfficeUser = tool({
  name: "create_office_user",
  title: "Create an office user",
  description: "Creates a sign-in for the web app for an office person (not a driver) and returns a set-password link to send " +
    "by WhatsApp (valid 7 days, until the password is saved). No password is chosen here. Give the permissions (view, request, approve, assign_tasks, vehicles, issues, users) " +
    "or a role as a shorthand: admin = everything, fleet_admin = everything but users, office = view + request + assign_tasks, " +
    "staff = view + request, viewer = view.",
  readOnly: false,
  input: z.object({
    name: zText(120),
    email: zEmail,
    role: zOfficeRole.optional().describe("Shorthand for a set of permissions. Default: derived from the permissions, or viewer"),
    permissions: zPermissions.optional().describe("Default: the role's permissions"),
    phone: zText(30).optional(),
    code: zText(30).optional().describe("Employee number. Default: made from the e-mail"),
  }),
  async run({ name, email, role, permissions, phone: typedPhone, code }, { db, actor }) {
    const phone = storedPhone(typedPhone);
    const existing = unwrapMaybe(await db.from("employees").select("id").eq("email", email).maybeSingle(), "office user");
    if (existing) throw new ToolError(`${email} already has an account. Use reset_office_password or set_office_user_active.`);
    const perms = permissions ? normalisePermissions(permissions) : permissionsForRole(role ?? "viewer");
    await guard(db, actor, { kind: "create", permissions: perms, role: permissions ? role : undefined });
    const label = role ?? roleForPermissions(perms);

    const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name, role: label } });
    if (error || !created.user) throw new ToolError(`Could not create the sign-in: ${error?.message ?? "unknown error"}`);

    const employeeCode = code ?? `O-${email.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 20).toUpperCase() || "USER"}`;
    const row = unwrap(
      await db.from("employees").insert({
        code: employeeCode,
        name,
        email,
        phone: phone ?? null,
        role: label,
        permissions: perms,
        active: true,
        auth_user_id: created.user.id,
      }).select("id").single(),
      "office user",
    );
    const link = await setPasswordLink(db, row.id, "new_account", actor);
    return {
      result: {
        created: { name, email, role: label, permissions: perms, code: employeeCode, id: row.id },
        set_password_link: link,
        link_valid_for: LINK_VALID_FOR,
        next: "Send the link by WhatsApp. The person opens it, chooses a password (12+ characters) and signs in. Opening it " +
          "(or WhatsApp's preview) does not use it up: it works until the password is saved, for 7 days. They can turn on 2-step sign-in in Settings.",
      },
      summary: `created office user ${email} (${label}: ${perms.join(", ") || "no permissions"})`,
    };
  },
});

export const updateOfficeUser = tool({
  name: "update_office_user",
  title: "Change an office user",
  description: "Changes an office user's name, phone and/or permissions (view, request, approve, assign_tasks, vehicles, issues, users). " +
    "The permissions list replaces the old one and takes effect on the person's next call. Nobody changes their own role or permissions, nobody gives or takes away a permission they do not hold, and only an admin changes an admin. " +
    "The phone is a Sri Lankan number (stored +94…; null clears it); every change of a number is logged. driver_contact: shown to " +
    "drivers as a contact on the app's Me (name, Call, WhatsApp; 'Fleet admin' when they also approve, else 'Office'). " +
    "can_drive (Round 50): the person drives their own self-drive trips with the app (Driving mode, location only during the trip); " +
    "false takes it away, and a later self-drive booking does not give it back.",
  readOnly: false,
  input: z.object({
    email: zEmail,
    name: zText(120).optional(),
    phone: zText(30).nullable().optional(),
    permissions: zPermissions.optional().describe("The full new list"),
    role: zOfficeRole.optional().describe("The label. Default: derived from the permissions"),
    driver_contact: z.boolean().optional().describe("Show as a contact for drivers (the app's Me)"),
    can_drive: z.boolean().optional().describe("Drives their own self-drive trips with the app (Round 50)"),
  }),
  async run({ email, name, phone: typedPhone, permissions, role, driver_contact, can_drive }, { db, actor }) {
    const phone = storedPhone(typedPhone);
    const user = await officeUser(db, email);
    if (
      name === undefined && phone === undefined && permissions === undefined && role === undefined && driver_contact === undefined &&
      can_drive === undefined
    ) {
      throw new ToolError("Nothing to change: give a name, phone, permissions, role, driver_contact and/or can_drive.");
    }
    const perms = permissions !== undefined ? normalisePermissions(permissions) : normalisePermissions(user.permissions);
    await guard(db, actor, { kind: "update", target: targetOf(user), permissions: permissions !== undefined ? perms : undefined, role });
    const label = role ?? (permissions !== undefined ? roleForPermissions(perms) : user.role);
    const updated = unwrap(
      await db.from("employees").update({
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(permissions !== undefined && { permissions: perms }),
        ...((permissions !== undefined || role !== undefined) && { role: label }),
        ...(driver_contact !== undefined && { driver_contact }),
        ...(can_drive !== undefined && { can_drive }),
      }).eq("id", user.id).select("name, email, phone, role, permissions, driver_contact, can_drive").single(),
      "office user",
    );
    if (phone !== undefined) await logPhoneChange(db, user.id, user.phone, updated.phone, actor);
    const changed = [
      name !== undefined && "name",
      phone !== undefined && "phone",
      permissions !== undefined && "permissions",
      role !== undefined && "role",
      driver_contact !== undefined && (driver_contact ? "shown to drivers" : "not shown to drivers"),
      can_drive !== undefined && (can_drive ? "can drive with the app" : "cannot drive with the app"),
    ]
      .filter(Boolean);
    return {
      result: {
        updated: {
          ...updated,
          can_drive: updated.can_drive ?? undefined,
          phone_display: phoneDisplay(updated.phone),
          permissions: normalisePermissions(updated.permissions),
        },
      },
      summary: `updated office user ${email}: ${changed.join(", ")}${permissions !== undefined ? ` (${perms.join(", ") || "none"})` : ""}`,
    };
  },
});

export const resetOfficePassword = tool({
  name: "reset_office_password",
  title: "Set-password link for an office user",
  description:
    "Returns a fresh set-password link for an office user (forgot the password, or the old link expired). Send it by WhatsApp. " +
    "It works for 7 days until the password is saved; any older link of theirs stops working.",
  readOnly: false,
  input: z.object({ email: zEmail }),
  async run({ email }, { db, actor }) {
    const user = await officeUser(db, email);
    await guard(db, actor, { kind: "password_link", target: targetOf(user) });
    if (!user.active) throw new ToolError(`${user.name} is switched off. Use set_office_user_active first.`);
    const link = await setPasswordLink(db, user.id, "reset", actor);
    return {
      result: { name: user.name, email, set_password_link: link, link_valid_for: LINK_VALID_FOR },
      summary: `set-password link for ${email}`,
    };
  },
});

export const setOfficeUserActive = tool({
  name: "set_office_user_active",
  title: "Switch an office user on or off",
  description:
    "Off: the person cannot sign in or use the web app, their connector keys stop working, and their sessions end. On: back as before.",
  readOnly: false,
  input: z.object({ email: zEmail, active: z.boolean() }),
  async run({ email, active }, { db, now, actor }) {
    const user = await officeUser(db, email);
    await guard(db, actor, { kind: "switch", target: targetOf(user), active });
    unwrap(await db.from("employees").update({ active }).eq("id", user.id).select("id"), "office user");
    if (user.auth_user_id) {
      const { error } = await db.auth.admin.updateUserById(user.auth_user_id, { ban_duration: active ? "none" : "876000h" });
      if (error) throw new Error(`sign-in ${active ? "unban" : "ban"}: ${error.message}`);
    }
    let keysRevoked = 0;
    if (!active) {
      const revoked = unwrap(
        await db.from("office_keys").update({ revoked_at: now.toISOString() }).eq("employee_id", user.id).is("revoked_at", null).select(
          "id",
        ),
        "connector keys",
      );
      keysRevoked = revoked.length;
    }
    return {
      result: { name: user.name, email, active, connector_keys_revoked: keysRevoked },
      summary: `office user ${email} ${active ? "on" : "off"}`,
    };
  },
});

export const createOfficeKey = tool({
  name: "create_office_key",
  title: "Personal connector key",
  description: "Makes a personal Fame Fleet connector URL for an office user to add in their own Claude (Settings → Connectors). " +
    "Shown once; the audit log then carries their name and their role applies in Claude.",
  readOnly: false,
  input: z.object({ email: zEmail, label: zText(60).optional().describe('e.g. "Boss laptop"') }),
  async run({ email, label }, { db }) {
    const user = await officeUser(db, email);
    if (!user.active) throw new ToolError(`${user.name} is switched off.`);
    const key = randomKey();
    const row = unwrap(
      await db.from("office_keys").insert({ employee_id: user.id, key_hash: await sha256Hex(key), label: label ?? null }).select("id")
        .single(),
      "connector key",
    );
    return {
      result: {
        name: user.name,
        key_id: row.id,
        connector_url: keyUrl(key),
        note: "This URL is the person's key: shown once, never stored in readable form. Treat it like a password.",
      },
      summary: `connector key ${row.id} for ${email}`,
    };
  },
});

export const revokeOfficeKey = tool({
  name: "revoke_office_key",
  title: "Revoke a connector key",
  description: "Stops a personal connector URL from working (lost laptop, person leaving). list_office_users shows the key ids.",
  readOnly: false,
  input: z.object({ key_id: z.guid() }),
  async run({ key_id }, { db, now }) {
    const rows = unwrap(
      await db.from("office_keys").update({ revoked_at: now.toISOString() }).eq("id", key_id).is("revoked_at", null).select(
        "id, employee_id",
      ),
      "connector key",
    );
    if (rows.length === 0) throw new ToolError("No active connector key has that id.");
    return { result: { revoked: key_id }, summary: `revoked connector key ${key_id}` };
  },
});

export function describeRole(role: string): string {
  return isRole(role) ? role : "unknown";
}

export const updateMyProfile = tool({
  name: "update_my_profile",
  title: "My phone and licence",
  description: "The person's own phone number (Settings → My profile): drivers and the people who asked call it from their trips. " +
    "Needed by everyone who approves or assigns tasks. A Sri Lankan number (stored +94…); null clears it; every change is logged. " +
    "Round 3: also their own driving licence (number and expiry) for the trips they drive themselves; the photos go through " +
    "set_my_licence_photo. Personal: a signed-in person or a personal key.",
  readOnly: false,
  input: z.object({
    phone: zText(30).nullable().optional().describe("e.g. 077 123 4567"),
    licence_no: zText(40).nullable().optional().describe("Driving licence number; null clears it"),
    licence_expiry: zDate.nullable().optional().describe("Driving licence expiry, YYYY-MM-DD; null clears it"),
  }),
  async run({ phone: typed, licence_no, licence_expiry }, { db, actor }) {
    if (!actor.employeeId) {
      throw new ToolError("This is personal: it needs a signed-in person (the web app) or a personal connector key.");
    }
    if (typed === undefined && licence_no === undefined && licence_expiry === undefined) {
      throw new ToolError("Nothing to change: give a phone, licence_no and/or licence_expiry.");
    }
    const phone = typed === undefined ? undefined : storedPhone(typed) ?? null;
    if (licence_expiry) realDate(licence_expiry);
    const number = licence_no === undefined ? undefined : licence_no?.trim() || null;
    const before = unwrap(
      await db.from("employees").select("phone, licence_no, licence_expiry").eq("id", actor.employeeId).single(),
      "employee",
    );
    const updated = unwrap(
      await db.from("employees").update({
        ...(phone !== undefined && { phone }),
        ...(number !== undefined && { licence_no: number }),
        ...(licence_expiry !== undefined && { licence_expiry }),
      }).eq("id", actor.employeeId).select("name, phone, licence_no, licence_expiry").single(),
      "employee",
    );
    if (phone !== undefined) await logPhoneChange(db, actor.employeeId, before.phone, updated.phone, actor);
    await logChanges(db, actor.employeeId, [
      ...(number !== undefined ? [{ field: "licence_no", before: before.licence_no, after: updated.licence_no }] : []),
      ...(licence_expiry !== undefined ? [{ field: "licence_expiry", before: before.licence_expiry, after: updated.licence_expiry }] : []),
    ], actor);
    return {
      result: {
        name: updated.name,
        phone: updated.phone ?? undefined,
        phone_display: phoneDisplay(updated.phone),
        licence_no: updated.licence_no ?? undefined,
        licence_expiry: updated.licence_expiry ?? undefined,
      },
      summary: `${actor.name} changed their ${
        [phone !== undefined && "phone", number !== undefined && "licence number", licence_expiry !== undefined && "licence expiry"]
          .filter(Boolean).join(", ")
      }`,
    };
  },
});
