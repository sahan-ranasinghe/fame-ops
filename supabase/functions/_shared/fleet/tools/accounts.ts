// Office accounts and personal connector keys (admin only).
//
// Nobody types a password in a chat: create_office_user creates the Auth
// user without one and returns a one-time set-password link
// (auth.admin.generateLink, type "recovery") that the admin sends by
// WhatsApp. The person opens it on the web app's /set-password page and
// chooses their own password. reset_office_password returns a fresh link.
// Supabase's own e-mail is not used (it only reaches project team members).
//
// create_office_key gives a person their own connector URL for Claude, so
// the audit log carries their name and their role applies in Claude too.

import { z } from "zod";
import type { Db } from "../db.ts";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { normalisePermissions, PERMISSIONS, permissionsForRole, roleForPermissions } from "../permissions.ts";
import { isRole, OFFICE_ROLES, type Role } from "../roles.ts";
import { colomboDateTime } from "../time.ts";
import { tool, zText } from "../tool.ts";

const zEmail = z.string().trim().toLowerCase().email().max(160);
const zOfficeRole = z.enum(["admin", "fleet_admin", "office", "staff", "viewer"]);
const zPermissions = z.array(z.enum(PERMISSIONS as [string, ...string[]])).max(PERMISSIONS.length)
  .describe("Any of: view, request, approve, assign_tasks, vehicles, issues, users");
const LINK_HOURS = 1;

/** The web app's address for set-password links: the first origin of OFFICE_WEB_URL (office-api allows every listed origin for CORS). */
function webUrl(): string {
  return (Deno.env.get("OFFICE_WEB_URL") ?? "").split(",")[0].trim().replace(/\/$/, "");
}

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

/** A one-time link that lets the person set their password (valid about an hour). */
async function setPasswordLink(db: Db, email: string): Promise<string> {
  const base = webUrl();
  const { data, error } = await db.auth.admin.generateLink({
    type: "recovery",
    email,
    ...(base ? { options: { redirectTo: `${base}/set-password` } } : {}),
  });
  if (error || !data.properties?.action_link) throw new Error(`set-password link: ${error?.message ?? "no link"}`);
  return data.properties.action_link;
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
  input: z.object({}),
  async run(_args, { db }) {
    const [users, keys] = await Promise.all([
      fetchAll(
        (a, b) =>
          db.from("employees").select("id, code, name, email, phone, role, permissions, active, created_at")
            .in("role", [...OFFICE_ROLES]).order("name").range(a, b),
        "office users",
      ),
      fetchAll(
        (a, b) =>
          db.from("office_keys").select("id, employee_id, label, created_at, last_used_at, revoked_at").order("created_at").range(a, b),
        "connector keys",
      ),
    ]);
    return {
      result: {
        count: users.length,
        users: users.map((u) => ({
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          permissions: normalisePermissions(u.permissions),
          active: u.active,
          since: colomboDateTime(u.created_at),
          connector_keys: keys.filter((k) => k.employee_id === u.id && !k.revoked_at).map((k) => ({
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
  description: "Creates a sign-in for the web app for an office person (not a driver) and returns a one-time set-password link to send " +
    "by WhatsApp. No password is chosen here. Give the permissions (view, request, approve, assign_tasks, vehicles, issues, users) " +
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
  async run({ name, email, role, permissions, phone, code }, { db }) {
    const existing = unwrapMaybe(await db.from("employees").select("id").eq("email", email).maybeSingle(), "office user");
    if (existing) throw new ToolError(`${email} already has an account. Use reset_office_password or set_office_user_active.`);
    const perms = permissions ? normalisePermissions(permissions) : permissionsForRole(role ?? "viewer");
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
    const link = await setPasswordLink(db, email);
    return {
      result: {
        created: { name, email, role: label, permissions: perms, code: employeeCode, id: row.id },
        set_password_link: link,
        link_valid_for: `${LINK_HOURS} hour`,
        next:
          "Send the link by WhatsApp. The person opens it, chooses a password (12+ characters) and signs in. They can turn on 2-step sign-in in Settings.",
      },
      summary: `created office user ${email} (${label}: ${perms.join(", ") || "no permissions"})`,
    };
  },
});

export const updateOfficeUser = tool({
  name: "update_office_user",
  title: "Change an office user",
  description: "Changes an office user's name, phone and/or permissions (view, request, approve, assign_tasks, vehicles, issues, users). " +
    "The permissions list replaces the old one and takes effect on the person's next call. You cannot remove your own users permission.",
  readOnly: false,
  input: z.object({
    email: zEmail,
    name: zText(120).optional(),
    phone: zText(30).nullable().optional(),
    permissions: zPermissions.optional().describe("The full new list"),
    role: zOfficeRole.optional().describe("The label. Default: derived from the permissions"),
  }),
  async run({ email, name, phone, permissions, role }, { db, actor }) {
    const user = await officeUser(db, email);
    if (name === undefined && phone === undefined && permissions === undefined && role === undefined) {
      throw new ToolError("Nothing to change: give a name, phone, permissions and/or role.");
    }
    const perms = permissions !== undefined ? normalisePermissions(permissions) : normalisePermissions(user.permissions);
    if (permissions !== undefined && actor.employeeId === user.id && !perms.includes("users")) {
      throw new ToolError("You cannot remove your own users permission. Ask another admin to do it.");
    }
    const label = role ?? (permissions !== undefined ? roleForPermissions(perms) : user.role);
    const updated = unwrap(
      await db.from("employees").update({
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(permissions !== undefined && { permissions: perms }),
        ...((permissions !== undefined || role !== undefined) && { role: label }),
      }).eq("id", user.id).select("name, email, phone, role, permissions").single(),
      "office user",
    );
    const changed = [
      name !== undefined && "name",
      phone !== undefined && "phone",
      permissions !== undefined && "permissions",
      role !== undefined && "role",
    ]
      .filter(Boolean);
    return {
      result: { updated: { ...updated, permissions: normalisePermissions(updated.permissions) } },
      summary: `updated office user ${email}: ${changed.join(", ")}${permissions !== undefined ? ` (${perms.join(", ") || "none"})` : ""}`,
    };
  },
});

export const resetOfficePassword = tool({
  name: "reset_office_password",
  title: "Set-password link for an office user",
  description:
    "Returns a fresh one-time set-password link for an office user (forgot the password, or the old link expired). Send it by WhatsApp.",
  readOnly: false,
  input: z.object({ email: zEmail }),
  async run({ email }, { db }) {
    const user = await officeUser(db, email);
    if (!user.active) throw new ToolError(`${user.name} is switched off. Use set_office_user_active first.`);
    const link = await setPasswordLink(db, email);
    return {
      result: { name: user.name, email, set_password_link: link, link_valid_for: `${LINK_HOURS} hour` },
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
  async run({ email, active }, { db, now }) {
    const user = await officeUser(db, email);
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
