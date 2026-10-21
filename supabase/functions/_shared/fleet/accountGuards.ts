// Who may change which office account (Round 2b, 21 October 2026; standard least-privilege, as in Google Workspace and
// Shopify staff accounts). Pure; the account tools run it for office-api and office-mcp alike, so no screen can step
// around it. Three rules for everyone:
//   1. Nobody gives or takes away a permission they do not hold themselves (a Coordinator can never give approve or
//      users, nor take them from anyone).
//   2. Nobody changes their own role or permissions, and nobody switches off their own account.
//   3. Only an admin (the users permission) changes an admin's account in any way: name, phone, permissions, switching
//      it off, a new set-password link. More generally, nobody touches an account that holds a permission they could not
//      give (a Coordinator never acts on a Fleet admin's account: a set-password link there would hand them approve;
//      Checkpoint 2b review).
//   4. The help-desk rule (Google Workspace's help-desk admin; Sahan, 21 October 2026): someone who is not an admin manages
//      only accounts that hold none of office_users, users and approve: they never create, edit, link or switch off
//      another Coordinator, a Fleet admin or an admin, and never give those permissions. Their own name and phone stay
//      theirs to change (rule 2 still holds for their permissions).
//   5. The last active admin (GitHub's last owner, Google's last super admin) is never switched off, never loses Users,
//      never gets another role label, whoever asks, the shared key included.
// The shared connector key holds every permission and is no person: rules 1, 3 and 4 pass for it, rule 2 cannot apply.

import { type Permission, PERMISSION_TEXT } from "./permissions.ts";

export interface GuardActor {
  employeeId: string | null;
  permissions: readonly Permission[];
}

export interface GuardTarget {
  id: string;
  permissions: readonly Permission[];
  /** The role label (rule 5) and whether the account is active (rule 5: switching off an account already off is no loss). */
  role?: string;
  active?: boolean;
}

/** The context rule 5 needs: how many active accounts hold users (the admins), the target included. */
export interface GuardContext {
  activeAdmins?: number;
}

/** Rule 4: the permissions only an admin manages (an account holding any of them is the admins' to change). */
export const ADMIN_MANAGED: readonly Permission[] = ["office_users", "users", "approve"];

export type AccountChange =
  | { kind: "create"; permissions: readonly Permission[]; role?: string }
  | { kind: "update"; target: GuardTarget; permissions?: readonly Permission[]; role?: string }
  | { kind: "switch"; target: GuardTarget; active: boolean }
  | { kind: "password_link"; target: GuardTarget };

const isAdmin = (perms: readonly Permission[]) => perms.includes("users");
/** What a person may grant: their permissions, and office_users with users (an admin covers office accounts already). */
const grantable = (perms: readonly Permission[]): readonly Permission[] => (isAdmin(perms) ? [...perms, "office_users"] : perms);
const names = (list: readonly Permission[]) => list.map((p) => PERMISSION_TEXT[p].label).join(", ");

/**
 * What this person may tick on an account form (the screens offer only these; the server checks the same): an admin what
 * they hold and Office accounts; anyone else what they hold except the admin-managed ones (rule 4).
 */
export function givablePermissions(perms: readonly Permission[]): Permission[] {
  return isAdmin(perms) ? [...new Set(grantable(perms))] : perms.filter((p) => !ADMIN_MANAGED.includes(p));
}

/** The reason a change is refused, in words for the person; null when it may go ahead. */
export function accountChangeProblem(actor: GuardActor, change: AccountChange, ctx: GuardContext = {}): string | null {
  const admin = isAdmin(actor.permissions);
  // Rule 5: the last active admin stays an admin and stays on, whoever asks.
  if (change.kind !== "create" && isAdmin(change.target.permissions) && change.target.active !== false && (ctx.activeAdmins ?? 2) <= 1) {
    if (change.kind === "switch" && !change.active) return "This is the last active admin: it cannot be switched off. Make another admin first.";
    if (change.kind === "update" && change.permissions !== undefined && !change.permissions.includes("users")) {
      return "This is the last active admin: it cannot lose Users. Make another admin first.";
    }
    if (change.kind === "update" && change.role !== undefined && change.role !== "admin") {
      return "This is the last active admin: its role stays Admin. Make another admin first.";
    }
  }
  if (change.kind !== "create") {
    const self = actor.employeeId !== null && actor.employeeId === change.target.id;
    const sameList = (a: readonly Permission[], b: readonly Permission[]) => a.length === b.length && a.every((p) => b.includes(p));
    const permsChange = change.kind === "update" && change.permissions !== undefined &&
      !sameList(change.permissions, change.target.permissions);
    if (change.kind === "update" && self && (permsChange || change.role !== undefined)) {
      return "You cannot change your own role or permissions. Ask another admin.";
    }
    if (change.kind === "switch" && self && !change.active) return "You cannot switch off your own account. Ask another admin.";
    if (isAdmin(change.target.permissions) && !admin) return "Only an admin can change an admin's account.";
    // Rule 4: a non-admin never acts on another account that manages accounts or approves (their own name and phone excepted).
    const managed = change.target.permissions.filter((p) => ADMIN_MANAGED.includes(p));
    if (!admin && managed.length > 0 && !(self && change.kind === "update")) {
      return `Only an admin can change this account: it holds ${names(managed)}.`;
    }
    const beyond = change.target.permissions.filter((p) => !grantable(actor.permissions).includes(p));
    if (beyond.length > 0 && !self) {
      return `Only someone who holds every permission of this account can change it (not yours: ${names(beyond)}). Ask an admin.`;
    }
  }
  if (change.kind === "create" || change.kind === "update") {
    // An explicit role is a label for admins to set; anyone else gets the one the permissions make.
    if (change.role !== undefined && !admin) return "Only an admin can set a role by name. Choose the permissions instead.";
    if (change.permissions !== undefined) {
      const before = change.kind === "update" ? change.target.permissions : [];
      const after = change.permissions;
      // Rule 4: only an admin gives Office accounts, Users or Approve to anyone.
      const giving = after.filter((p) => ADMIN_MANAGED.includes(p) && !before.includes(p));
      if (!admin && giving.length > 0) return `Only an admin can give ${names(giving)}.`;
      const changed = [...after.filter((p) => !before.includes(p)), ...before.filter((p) => !after.includes(p))];
      const held = grantable(actor.permissions);
      const notHeld = [...new Set(changed.filter((p) => !held.includes(p)))];
      if (notHeld.length > 0) return `You can only give or take away permissions you hold yourself (not: ${names(notHeld)}).`;
    }
  }
  return null;
}
