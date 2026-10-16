// The Users page's rules (Settings → Users): the permission tick boxes, the four
// presets, what create_office_user and update_office_user are sent, and the
// one thing an admin may not do to themselves. Phase 7 (§12): any other
// permission implies view, so view is ticked with it and locked while one is.
import { IMPLIES_VIEW, normalisePermissions, type Permission, PERMISSIONS, PRESETS } from "@fleet/permissions";

export type Preset = keyof typeof PRESETS;

export interface UserFields {
  name: string;
  email: string;
  phone: string;
  permissions: Permission[];
}

export const emptyUser = (): UserFields => ({ name: "", email: "", phone: "", permissions: [...PRESETS.viewer.permissions] });

/** True while a permission that needs view is ticked: the view box is then ticked and locked. */
export const viewLocked = (list: readonly Permission[]) => list.some((p) => IMPLIES_VIEW.includes(p));

/** The hint beside the locked view box. */
export const VIEW_LOCKED_HINT = "Needed by the other permissions";

/**
 * Adds or removes one permission, keeping the table's order. Ticking one that needs view ticks
 * view too; view can't be unticked while one of them is ticked (unticking them all frees it).
 */
export function togglePermission(list: readonly Permission[], p: Permission): Permission[] {
  const set = new Set(list);
  if (p === "view" && viewLocked(list)) set.add("view");
  else if (set.has(p)) set.delete(p);
  else set.add(p);
  if (viewLocked([...set])) set.add("view");
  return PERMISSIONS.filter((x) => set.has(x));
}

/** The preset button that matches the list exactly, "admin" for everything, else null. */
export function presetOf(list: readonly Permission[]): Preset | "admin" | null {
  const sorted = normalisePermissions(list).join(",");
  if (sorted === PERMISSIONS.join(",")) return "admin";
  for (const key of Object.keys(PRESETS) as Preset[]) {
    if (PRESETS[key].permissions.join(",") === sorted) return key;
  }
  return null;
}

export const SELF_LOCKOUT = "You cannot remove your own users permission. Ask another admin to do it.";

/** True when the person is editing their own account and would drop the users permission. */
export function selfLockout(meEmail: string | undefined, userEmail: string, permissions: readonly Permission[]): boolean {
  return !!meEmail && meEmail.toLowerCase() === userEmail.toLowerCase() && !permissions.includes("users");
}

export function validateNewUser(f: UserFields): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.name) || !t(f.email)) return { error: "Add the name and the e-mail." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t(f.email))) return { error: "That e-mail does not look right." };
  if (f.permissions.length === 0) return { error: "Tick at least one permission." };
  const input: Record<string, unknown> = { name: t(f.name), email: t(f.email).toLowerCase(), permissions: normalisePermissions(f.permissions) };
  if (t(f.phone)) input.phone = t(f.phone);
  return { input };
}

/** Only what changed goes to update_office_user; nothing changed = no call. */
export function updateInput(
  before: { email: string; name: string; phone?: string | null; permissions: readonly Permission[] },
  f: UserFields,
  meEmail?: string,
): { error: string } | { input: Record<string, unknown> } | { nothing: true } {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = { email: before.email };
  if (t(f.name) && t(f.name) !== before.name) input.name = t(f.name);
  if (t(f.phone) !== (before.phone ?? "")) input.phone = t(f.phone) || null;
  const perms = normalisePermissions(f.permissions);
  if (perms.join(",") !== normalisePermissions(before.permissions).join(",")) {
    if (perms.length === 0) return { error: "Tick at least one permission, or switch the account off instead." };
    if (selfLockout(meEmail, before.email, perms)) return { error: SELF_LOCKOUT };
    input.permissions = perms;
  }
  if (Object.keys(input).length === 1) return { nothing: true };
  return { input };
}
