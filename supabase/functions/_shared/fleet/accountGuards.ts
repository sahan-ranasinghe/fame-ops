// Who may change which office account (Round 2b, 21 October 2026; standard least-privilege, as in Google Workspace and
// Shopify staff accounts). Pure; the account tools run it for office-api and office-mcp alike, so no screen can step
// around it. Three rules for everyone:
//   1. Nobody gives or takes away a permission they do not hold themselves (a Coordinator can never give approve or
//      users, nor take them from anyone).
//   2. Nobody changes their own role or permissions, and nobody switches off their own account.
//   3. Only an admin (the users permission) changes an admin's account in any way: name, phone, permissions, switching
//      it off, a new set-password link.
// The shared connector key holds every permission and is no person: rules 1 and 3 pass for it, rule 2 cannot apply.

import { type Permission, PERMISSION_TEXT } from "./permissions.ts";

export interface GuardActor {
  employeeId: string | null;
  permissions: readonly Permission[];
}

export interface GuardTarget {
  id: string;
  permissions: readonly Permission[];
}

export type AccountChange =
  | { kind: "create"; permissions: readonly Permission[]; role?: string }
  | { kind: "update"; target: GuardTarget; permissions?: readonly Permission[]; role?: string }
  | { kind: "switch"; target: GuardTarget; active: boolean }
  | { kind: "password_link"; target: GuardTarget };

const isAdmin = (perms: readonly Permission[]) => perms.includes("users");
/** What a person may grant: their permissions, and office_users with users (an admin covers office accounts already). */
const grantable = (perms: readonly Permission[]): readonly Permission[] => (isAdmin(perms) ? [...perms, "office_users"] : perms);
const names = (list: readonly Permission[]) => list.map((p) => PERMISSION_TEXT[p].label).join(", ");

/** The reason a change is refused, in words for the person; null when it may go ahead. */
export function accountChangeProblem(actor: GuardActor, change: AccountChange): string | null {
  const admin = isAdmin(actor.permissions);
  if (change.kind !== "create") {
    const self = actor.employeeId !== null && actor.employeeId === change.target.id;
    if (change.kind === "update" && self && (change.permissions !== undefined || change.role !== undefined)) {
      return "You cannot change your own role or permissions. Ask another admin.";
    }
    if (change.kind === "switch" && self && !change.active) return "You cannot switch off your own account. Ask another admin.";
    if (isAdmin(change.target.permissions) && !admin) return "Only an admin can change an admin's account.";
  }
  if (change.kind === "create" || change.kind === "update") {
    // An explicit role is a label for admins to set; anyone else gets the one the permissions make.
    if (change.role !== undefined && !admin) return "Only an admin can set a role by name. Choose the permissions instead.";
    if (change.permissions !== undefined) {
      const before = change.kind === "update" ? change.target.permissions : [];
      const after = change.permissions;
      const changed = [...after.filter((p) => !before.includes(p)), ...before.filter((p) => !after.includes(p))];
      const held = grantable(actor.permissions);
      const notHeld = [...new Set(changed.filter((p) => !held.includes(p)))];
      if (notHeld.length > 0) return `You can only give or take away permissions you hold yourself (not: ${names(notHeld)}).`;
    }
  }
  return null;
}
