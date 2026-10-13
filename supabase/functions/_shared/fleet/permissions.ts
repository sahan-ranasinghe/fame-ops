// Who may call which tool: the permissions a person holds (employees.permissions)
// against the permission each tool needs. One table, applied by office-mcp (Claude)
// and office-api (the web app) before a tool runs; the clients' menus only mirror
// it. No imports: the office web app imports this very file through a Vite alias
// (@fleet/permissions), so the menu and the server can never disagree.
//
//   view          see the fleet: overview, live locations, tasks, vehicles, drivers,
//                 mileage, problem reports, issues
//   request       ask for a vehicle and follow one's own requests
//   approve       decide requests, book a vehicle in one step
//   assign_tasks  create, change and cancel tasks and their stops
//   vehicles      vehicles, rental companies, places, drivers, projects
//   issues        update issues and vehicle problem reports
//   users         office users, connector keys and settings
//
// The role (employees.role) is a label only: it is derived from the permissions
// when an account is made or changed, and the backfill map below is what the
// migration gave every existing account.

export type Permission = "view" | "request" | "approve" | "assign_tasks" | "vehicles" | "issues" | "users";

export const PERMISSIONS: readonly Permission[] = ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"];

/** What each permission means, in the words the Users page shows. */
export const PERMISSION_TEXT: Record<Permission, { label: string; text: string }> = {
  view: { label: "View", text: "See the fleet: overview, live locations, tasks, vehicles, drivers, mileage, problem reports" },
  request: { label: "Request", text: "Ask for a vehicle and follow your own requests" },
  approve: { label: "Approve", text: "Approve or decline requests, book a vehicle in one step" },
  assign_tasks: { label: "Assign tasks", text: "Create, change and cancel tasks and their stops" },
  vehicles: { label: "Vehicles", text: "Vehicles, rental companies, places, drivers, projects" },
  issues: { label: "Issues", text: "Update issues and vehicle problem reports" },
  users: { label: "Users", text: "Office users, connector keys and settings" },
};

const V: readonly Permission[] = ["view"];
/** With request alone: the person's own requests, the task of an own request, places and projects. */
const VR: readonly Permission[] = ["view", "request"];
const AA: readonly Permission[] = ["approve", "assign_tasks"];
const VEH: readonly Permission[] = ["vehicles"];
const USERS: readonly Permission[] = ["users"];

/** The permission a tool needs. Holding any one of the listed permissions allows the call. */
export const TOOL_PERMISSION: Record<string, readonly Permission[]> = {
  fleet_overview: V,
  live_drivers: V,
  driver_route: V,
  task_board: V,
  list_vehicles: V,
  list_drivers: V,
  mileage_summary: V,
  list_vehicle_reports: V,
  list_requests: VR,
  task_detail: VR,
  list_places: VR,
  find_project: VR,
  create_request: ["request"],
  suggest_vehicles: AA,
  decide_request: ["approve"],
  create_task: ["assign_tasks"],
  reassign_task: ["assign_tasks"],
  cancel_task: ["assign_tasks"],
  register_vehicle: VEH,
  update_vehicle: VEH,
  add_rental_company: VEH,
  create_driver: VEH,
  reset_pin: VEH,
  set_driver_active: VEH,
  update_driver: VEH,
  import_projects: VEH,
  add_place: ["vehicles", "assign_tasks"],
  update_vehicle_report: ["issues"],
  list_office_users: USERS,
  create_office_user: USERS,
  update_office_user: USERS,
  reset_office_password: USERS,
  set_office_user_active: USERS,
  create_office_key: USERS,
  revoke_office_key: USERS,
};

/** The four buttons on the Users page. An admin is everything, so it is not a preset. */
export const PRESETS: Record<"fleet_admin" | "dispatcher" | "requester" | "viewer", { label: string; permissions: Permission[] }> = {
  fleet_admin: { label: "Fleet admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues"] },
  dispatcher: { label: "Dispatcher", permissions: ["view", "request", "assign_tasks"] },
  requester: { label: "Requester", permissions: ["request"] },
  viewer: { label: "Viewer", permissions: ["view"] },
};

/** What the migration gave each role, and what a new account gets when only a role is named. */
export function permissionsForRole(role: string): Permission[] {
  switch (role) {
    case "admin":
      return [...PERMISSIONS];
    case "fleet_admin":
      return [...PRESETS.fleet_admin.permissions];
    case "office":
      return ["view", "request", "assign_tasks"];
    case "staff":
      return ["view", "request"];
    case "viewer":
      return ["view"];
    default:
      return [];
  }
}

/** The label for a set of permissions (the role column). */
export function roleForPermissions(permissions: readonly string[]): "admin" | "fleet_admin" | "office" | "staff" | "viewer" {
  const has = (p: Permission) => permissions.includes(p);
  if (has("users")) return "admin";
  if (has("approve") || has("vehicles") || has("issues")) return "fleet_admin";
  if (has("assign_tasks")) return "office";
  if (has("request")) return "staff";
  return "viewer";
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Known permissions only, each once, in the table's order. */
export function normalisePermissions(list: readonly unknown[] | null | undefined): Permission[] {
  const set = new Set((list ?? []).filter(isPermission));
  return PERMISSIONS.filter((p) => set.has(p));
}

/** True when the permissions allow the tool. An unknown tool is allowed to nobody. */
export function allows(permissions: readonly string[], tool: string): boolean {
  const needs = TOOL_PERMISSION[tool];
  return needs !== undefined && needs.some((p) => permissions.includes(p));
}

/** Any one of the given permissions. */
export function hasAny(permissions: readonly string[], wanted: readonly Permission[]): boolean {
  return wanted.some((p) => permissions.includes(p));
}

/** The tools (of the given list, in its order) the permissions allow. */
export function toolsFor(permissions: readonly string[], tools: readonly string[]): string[] {
  return tools.filter((tool) => allows(permissions, tool));
}
