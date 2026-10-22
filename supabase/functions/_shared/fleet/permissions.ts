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
//   office_users  office accounts that hold none of office_users, users, approve (Round 2b, the Coordinator), granting only what the granter holds
//
// The role (employees.role) is a label only: it is derived from the permissions
// when an account is made or changed, and the backfill map below is what the
// migration gave every existing account.

export type Permission = "view" | "request" | "approve" | "assign_tasks" | "vehicles" | "issues" | "users" | "office_users";

export const PERMISSIONS: readonly Permission[] = [
  "view",
  "request",
  "approve",
  "assign_tasks",
  "vehicles",
  "issues",
  "users",
  "office_users",
];

/** What each permission means, in the words the Users page shows. */
export const PERMISSION_TEXT: Record<Permission, { label: string; text: string }> = {
  view: {
    label: "View",
    text: "Overview counts and who is on the road, live locations, the drivers list, the vehicles board, your own requests",
  },
  request: { label: "Request", text: "Ask for a vehicle and follow your own requests" },
  approve: { label: "Approve", text: "The requests queue: approve or decline, book a vehicle directly, cancel a booking" },
  assign_tasks: {
    label: "Assign tasks",
    text: "The tasks board: assign, reassign and cancel tasks and their stops; task details, routes and task attention items",
  },
  vehicles: { label: "Vehicles", text: "Register and edit vehicles, rental companies, places, driver accounts; mileage and maintenance" },
  issues: { label: "Issues", text: "The issues centre, vehicle problem reports and every attention item" },
  users: { label: "Users", text: "Settings: office users, connector keys, fleet settings" },
  office_users: {
    label: "Office accounts",
    text: "Add and edit office accounts that neither approve nor manage accounts, giving only permissions you hold yourself",
  },
};

const V: readonly Permission[] = ["view"];
/** Reference data the request form needs too: places and projects, own requests. */
const VR: readonly Permission[] = ["view", "request"];
const AA: readonly Permission[] = ["approve", "assign_tasks"];
const VEH: readonly Permission[] = ["vehicles"];
const USERS: readonly Permission[] = ["users"];
/** Office accounts: admins (users) and, for accounts holding none of office_users, users, approve, the Coordinator (office_users). */
const ACCOUNTS: readonly Permission[] = ["users", "office_users"];
/** Personal: a person's own notification settings and devices (any office permission). */
const ANY: readonly Permission[] = PERMISSIONS;

/**
 * The permission a tool needs. Holding any one of the listed permissions allows the call.
 * Some tools answer less to some holders (the "own rows" rules in the tools themselves):
 *   list_requests   every request with approve; otherwise the person's own
 *   update_request  any request with approve; otherwise the person's own
 *   cancel_request  any request with approve; otherwise the person's own while it waits
 *   task_detail     any task with assign_tasks; a request's task with approve; an own request's task with request
 *   fleet_overview  needs_attention: every item with issues, the task items with assign_tasks, otherwise none
 */
export const TOOL_PERMISSION: Record<string, readonly Permission[]> = {
  // Phase 7, Part 3 (§5, §6, §28): photos and documents are the vehicles permission's (reading the files too, §32 14).
  photo_upload_url: ["vehicles", "users"],
  set_driver_photo: VEH,
  set_vehicle_photo: VEH,
  vehicle_document_upload_url: VEH,
  save_vehicle_document: VEH,
  vehicle_documents: VEH,
  remove_vehicle_document: VEH,
  restore_vehicle_document: VEH,
  // Phase 7 (§15): places are the vehicles permission's (§32 8: restored by the same people).
  remove_place: VEH,
  restore_place: VEH,
  fleet_overview: V,
  live_drivers: V,
  watch_drivers: V,
  list_vehicles: V,
  list_drivers: V,
  list_requests: VR,
  list_places: VR,
  find_project: VR,
  create_request: ["request"],
  suggest_vehicles: AA,
  decide_request: ["approve"],
  book_vehicle: ["approve"],
  // The person who asked may cancel their own waiting request or proposal (§35 17); approvers any.
  cancel_request: ["approve", "request", "assign_tasks"],
  update_request: ["request", "approve"],
  redecide_request: ["approve"],
  availability: AA,
  task_board: ["assign_tasks"],
  // Phase 7 (§8, §13): task history, and a driver-started trip switched between company and personal.
  list_tasks: ["assign_tasks"],
  set_trip_purpose: ["assign_tasks"],
  task_detail: ["assign_tasks", "approve", "request"],
  driver_route: ["assign_tasks", "vehicles"],
  create_task: ["assign_tasks"],
  reassign_task: ["assign_tasks"],
  cancel_task: ["assign_tasks"],
  // Phase 7 (§34): requesters plan their trip too (no conflicts without a driver).
  plan_task: ["approve", "assign_tasks", "request"],
  update_task_stops: ["assign_tasks"],
  update_task: ["assign_tasks"],
  // Phase 7, Part 1: a driver's day. The duty log and the office's clock-out / move belong to who runs the
  // drivers (dispatch, the fleet); reopening a task to dispatch.
  duty_log: ["assign_tasks", "vehicles"],
  clock_out_driver: ["assign_tasks", "vehicles"],
  move_driver_vehicle: ["assign_tasks", "vehicles"],
  swap_reading: ["assign_tasks", "vehicles"],
  reopen_task: ["assign_tasks"],
  get_settings: ANY,
  update_settings: USERS,
  routing_usage: USERS,
  list_app_errors: USERS,
  // Round 2b: the Activity log (office_audit's changes) is the account keepers' (Admins).
  activity_log: USERS,
  register_vehicle: VEH,
  update_vehicle: VEH,
  add_rental_company: VEH,
  create_driver: VEH,
  reset_pin: VEH,
  set_driver_active: VEH,
  update_driver: ["vehicles", "users"],
  // Round 2b: project import is the approvers' (Admins and Fleet admins keep it; a Coordinator does not).
  import_projects: ["approve"],
  mileage_summary: VEH,
  list_fuel: VEH,
  add_place: ["vehicles", "assign_tasks"],
  // Part 4: the location search box (every place field) and the sites.
  search_places: VR,
  save_place: ["request", "approve", "assign_tasks", "vehicles"],
  place_detail: VR,
  import_places: ["vehicles"],
  update_place: ["vehicles"],
  // Part 4b: the custom import's saved mappings, the record of every import, the undo.
  list_import_presets: ["vehicles"],
  save_import_preset: ["vehicles"],
  list_place_imports: ["vehicles"],
  undo_place_import: ["vehicles"],
  // Part 5: the Google package. A Google pick for a stop or a start (the forms that place stops: a task's,
  // a booking's); the map load the web records before Google's map loads (anyone who sees a map or a pin).
  google_place: ["approve", "assign_tasks", "request"],
  register_map_load: ANY,
  // Part 5b: a reached Google stop saved as one of our places at the driver's arrival point.
  save_arrival_place: ["vehicles", "assign_tasks"],
  list_vehicle_reports: ["issues"],
  update_vehicle_report: ["issues"],
  list_issues: ["issues", "assign_tasks"],
  issue_history: ["issues", "assign_tasks"],
  update_issue: ["issues"],
  update_issues: ["issues"],
  // Round 4–7 (4): the vehicle checks (anyone who sees the fleet; photo links for vehicles or issues, in the tool); a
  // no-app trip's own page, check and close (personal: the tool checks the trip is the person's).
  vehicle_checks: ["view"],
  my_trip: ANY,
  my_trip_check: ANY,
  finish_my_trip: ANY,
  // Round 4–7 (6): the Passengers field's people search (no phone or e-mail); My trips for everyone (a passenger may hold
  // only view).
  find_people: ANY,
  // Round 4–7 (7): ask for a busy driver or vehicle (whoever plans a trip), the holder's answer and the asks (personal,
  // checked in the tools), the day's timeline (anyone who sees the fleet).
  ask_for_it: ["request", "approve", "assign_tasks"],
  answer_holder_ask: ANY,
  holder_asks: ANY,
  day_timeline: ["view"],
  // Round 2b: office_users runs these for accounts holding none of office_users, users, approve (the guards: accountGuards.ts).
  list_office_users: ACCOUNTS,
  create_office_user: ACCOUNTS,
  update_office_user: ACCOUNTS,
  reset_office_password: ACCOUNTS,
  set_office_user_active: ACCOUNTS,
  create_office_key: USERS,
  revoke_office_key: USERS,
  my_notification_settings: ANY,
  set_my_notification_settings: ANY,
  register_web_push: ANY,
  remove_web_push: ANY,
  // Hotfix 2 (A, F, K): the person's own trips, notification centre and number; "Palitha is reviewing" on the decide page.
  my_trips: ANY,
  my_inbox: ANY,
  mark_inbox_read: ANY,
  update_my_profile: ANY,
  reviewing: ["approve"],
  // Hotfix 3 (L1, L5): the person's own page preferences.
  my_prefs: ANY,
  set_my_prefs: ANY,
  // Part 3b: the profile (its private part needs users or vehicles, checked in the tool), availability, the board, asks.
  driver_profile: ["approve", "assign_tasks", "vehicles", "users"],
  set_driver_licence_photo: ["vehicles", "users"],
  unavailability: AA,
  set_unavailability: AA,
  remove_unavailability: AA,
  drivers_board: AA,
  ask_drivers: AA,
  ask_answers: AA,
};

/** The buttons on the Users page. An admin is everything, so it is not a preset. */
export const PRESETS: Record<
  "fleet_admin" | "coordinator" | "dispatcher" | "requester" | "viewer",
  { label: string; permissions: Permission[] }
> = {
  fleet_admin: { label: "Fleet admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues"] },
  // Round 2b (Sahan, 21 October 2026): the records and the trips, never approve or users; a task they assign waits for
  // a fleet admin's OK while tasks_need_approval is on.
  coordinator: { label: "Coordinator", permissions: ["view", "request", "assign_tasks", "vehicles", "issues", "office_users"] },
  dispatcher: { label: "Dispatcher", permissions: ["view", "request", "assign_tasks"] },
  // Phase 7 (§12): any permission implies view, so the Requester preset carries it (view = what a viewer sees).
  requester: { label: "Requester", permissions: ["view", "request"] },
  viewer: { label: "Viewer", permissions: ["view"] },
};

/** What the migration gave each role, and what a new account gets when only a role is named. */
export function permissionsForRole(role: string): Permission[] {
  switch (role) {
    case "admin":
      return [...PERMISSIONS];
    case "fleet_admin":
      return [...PRESETS.fleet_admin.permissions];
    case "coordinator":
      return [...PRESETS.coordinator.permissions];
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
export function roleForPermissions(
  permissions: readonly string[],
): "admin" | "fleet_admin" | "office" | "coordinator" | "staff" | "viewer" {
  const has = (p: Permission) => permissions.includes(p);
  if (has("users")) return "admin";
  if (has("approve")) return "fleet_admin";
  // Round 2b: office accounts without approve = the Coordinator (no account held office_users before it).
  if (has("office_users")) return "coordinator";
  if (has("vehicles") || has("issues")) return "fleet_admin";
  if (has("assign_tasks")) return "office";
  if (has("request")) return "staff";
  return "viewer";
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Known permissions only, each once, in the table's order. Any permission implies view (Phase 7, §12): view is
 * exactly what a viewer sees, and every other permission works on top of it.
 */
export function normalisePermissions(list: readonly unknown[] | null | undefined): Permission[] {
  const set = new Set((list ?? []).filter(isPermission));
  if (set.size > 0) set.add("view");
  return PERMISSIONS.filter((p) => set.has(p));
}

/** The permissions that bring view with them: the form locks the view box while any of these is ticked. */
export const IMPLIES_VIEW: readonly Permission[] = ["request", "approve", "assign_tasks", "vehicles", "issues", "users", "office_users"];

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
