// Who the tools run for. Since Phase 5 the check is per person: the permissions
// on their employees row (permissions.ts) against the permission each tool
// needs. The role is a label: admin runs everything including accounts;
// fleet_admin runs the fleet; office sees everything and assigns tasks and
// requests; staff ask for vehicles; viewer reads; driver is the app.
//
// The same check is applied by office-mcp (Claude) and office-api (the web
// app) before a tool runs; menus in the clients only mirror it.

import {
  allows,
  type Permission,
  permissionsForRole,
  TOOL_PERMISSION,
} from "./permissions.ts";

export type Role =
  | "admin"
  | "fleet_admin"
  | "office"
  | "staff"
  | "viewer"
  | "driver";
export type Channel = "claude" | "web" | "driver";

/** The person a tool runs for. employeeId is null only for the shared connector key (which holds every permission). */
export interface Actor {
  employeeId: string | null;
  name: string;
  role: Role;
  permissions: Permission[];
  /** The Auth user behind a web session, when there is one. */
  authUserId?: string;
  channel: Channel;
}

export const OFFICE_ROLES: readonly Role[] = [
  "admin",
  "fleet_admin",
  "office",
  "staff",
  "viewer",
];

/**
 * 2-step sign-in (TOTP) is optional for every role: a person turns it on in
 * the web app's Settings, and from then on their sign-in asks for the code.
 * The office can make it compulsory for some roles with the Edge Function
 * secret REQUIRE_MFA_ROLES (for example "admin,fleet_admin,office"); office-api
 * then refuses those roles until the session has done the second step (aal2).
 * STRONG_ROLES is the set the plan recommends when that day comes.
 */
export const STRONG_ROLES: readonly Role[] = ["admin", "fleet_admin", "office"];

/** The roles REQUIRE_MFA_ROLES names; unknown words are ignored, empty = nobody. */
export function mfaRequiredRoles(setting: string | undefined | null): Role[] {
  return (setting ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(
    isRole,
  );
}

/** The roles whose default permissions allow each tool (for reference and the docs; the check itself is canCall). */
export const TOOL_ROLES: Record<string, Role[]> = Object.fromEntries(
  Object.keys(TOOL_PERMISSION).map((
    tool,
  ) => [
    tool,
    OFFICE_ROLES.filter((role) => allows(permissionsForRole(role), tool)),
  ]),
);

export function canCall(
  actor: Pick<Actor, "permissions">,
  tool: string,
): boolean {
  return allows(actor.permissions, tool);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" &&
    ["admin", "fleet_admin", "office", "staff", "viewer", "driver"].includes(
      value,
    );
}
