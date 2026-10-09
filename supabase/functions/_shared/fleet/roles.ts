// Who may call which tool. The same table is applied by office-mcp (Claude)
// and office-api (the web app) before a tool runs; menus in the clients
// only mirror it. Changing a row here changes both channels.
//
// Roles (employees.role): admin runs everything including accounts;
// fleet_admin runs the fleet; office sees everything and assigns tasks and
// requests; staff only ask for vehicles; viewer reads; driver is the app.

export type Role = "admin" | "fleet_admin" | "office" | "staff" | "viewer" | "driver";
export type Channel = "claude" | "web" | "driver";

/** The person a tool runs for. employeeId is null only for the shared connector key. */
export interface Actor {
  employeeId: string | null;
  name: string;
  role: Role;
  channel: Channel;
}

export const OFFICE_ROLES: readonly Role[] = ["admin", "fleet_admin", "office", "staff", "viewer"];
/** These roles must have done the second sign-in step (TOTP, aal2) on the web. */
export const STRONG_ROLES: readonly Role[] = ["admin", "fleet_admin", "office"];

const ADMIN: Role[] = ["admin"];
const FLEET: Role[] = ["admin", "fleet_admin"];
const OFFICE: Role[] = ["admin", "fleet_admin", "office"];
const READ: Role[] = ["admin", "fleet_admin", "office", "viewer"];
const READ_AND_STAFF: Role[] = [...READ, "staff"];

export const TOOL_ROLES: Record<string, Role[]> = {
  fleet_overview: READ,
  live_drivers: READ,
  driver_route: READ,
  task_board: READ,
  task_detail: READ_AND_STAFF, // staff: only the task of their own request
  create_task: OFFICE,
  reassign_task: FLEET,
  cancel_task: FLEET,
  create_request: [...OFFICE, "staff"], // staff: in their own name
  list_requests: READ_AND_STAFF, // staff: their own
  suggest_vehicles: OFFICE,
  decide_request: FLEET,
  list_vehicles: READ,
  register_vehicle: FLEET,
  update_vehicle: FLEET,
  add_rental_company: FLEET,
  list_drivers: READ,
  create_driver: FLEET,
  reset_pin: FLEET,
  set_driver_active: FLEET,
  update_driver: FLEET,
  list_places: READ_AND_STAFF,
  add_place: OFFICE,
  find_project: READ_AND_STAFF,
  import_projects: FLEET,
  mileage_summary: READ,
  list_vehicle_reports: READ,
  update_vehicle_report: FLEET,
  list_office_users: ADMIN,
  create_office_user: ADMIN,
  reset_office_password: ADMIN,
  set_office_user_active: ADMIN,
  create_office_key: ADMIN,
  revoke_office_key: ADMIN,
};

export function canCall(role: Role, tool: string): boolean {
  return (TOOL_ROLES[tool] ?? []).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ["admin", "fleet_admin", "office", "staff", "viewer", "driver"].includes(value);
}
