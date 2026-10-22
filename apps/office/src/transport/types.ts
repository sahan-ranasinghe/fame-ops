// One interface, two ways to reach the Fame Fleet rules (docs/office-web-plan.md, section 4):
//   ClaudeTransport  the artifact, through the viewer's "Fame Fleet" connector (window.claude)
//   ApiTransport     the web app, through office-api with the person's Supabase session
// Both give the same JSON for the same tool and arguments.

import type { Permission } from "@fleet/permissions";

export type { Permission };

export type Role = "admin" | "fleet_admin" | "office" | "coordinator" | "staff" | "viewer";

export interface Me {
  name: string;
  email?: string;
  /** A label; the permissions decide. */
  role: Role;
  /** What this person may do (employees.permissions); the artifact and the shared key hold every permission. */
  permissions: Permission[];
  /** The tools this person may call; menus mirror it, the server enforces it. */
  tools: string[];
  /** The session has done the second step (web only). */
  mfa?: boolean;
  /** office-api requires the second step for this role (secret REQUIRE_MFA_ROLES). */
  mfa_required?: boolean;
  /** Which map the web shows (Part 5): google = Google's map after register_map_load; places = Google's place search for stops. */
  map?: { package: "google" | "open"; places: boolean };
  /** Hotfix 2 (F): the person's own number, E.164 (+94…), and "07X XXX XXXX" to show; web only (GET /me). */
  phone?: string;
  phone_display?: string;
  /** Approve or assign_tasks and no number yet: the banner "Add your phone number so drivers can call you". */
  phone_required?: boolean;
  /** Round 3: the person's own photo (a link that works for at least an hour); web only (GET /me). */
  photo_url?: string;
  /**
   * Round 3 (A5): the person's own driving licence, for the trips they drive themselves (Zipcar for Business: the
   * member's licence on file); web only (GET /me). state: on_file (a number or a photo, not expired), none, expired.
   */
  licence?: MyLicence;
}

export interface MyLicence {
  number?: string;
  /** YYYY-MM-DD. */
  expiry?: string;
  state?: "on_file" | "none" | "expired";
  /** 1-hour links to the photos of the front and the back. */
  front_url?: string;
  back_url?: string;
}

/** True when the person holds any one of the permissions (none asked = everyone). */
export function can(me: Pick<Me, "permissions">, ...any: Permission[]): boolean {
  return any.length === 0 || any.some((p) => me.permissions.includes(p));
}

/** Hotfix 4: a link to a task's page only for people who may open it (/tasks/:id is assign_tasks), never one to No access. */
export const canOpenTask = (me: Pick<Me, "permissions">): boolean => can(me, "assign_tasks");

export interface FleetError {
  code: string;
  message: string;
  status?: number;
  /** The call was a write (transport/retryRule.ts): never repeated on its own; the person may try again. */
  write?: boolean;
}

export type WatchEvent<T> = { type: "data"; data: T; at: number } | { type: "error"; error: FleetError };

export interface Transport {
  readonly kind: "claude" | "api";
  me(): Promise<Me>;
  call<T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T>;
  /** Calls now and again every intervalMs until the returned function is called. */
  watch<T = unknown>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, intervalMs: number): () => void;
  /** After a write: every watched tool fetches again now. */
  invalidate(): Promise<void>;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  fleet_admin: "Fleet admin",
  office: "Office",
  coordinator: "Coordinator",
  staff: "Staff",
  viewer: "Viewer",
};

/** Every connector tool (supabase/functions/_shared/fleet/index.ts), in the connector's order. The artifact build lists them all; the connector's key decides. */
export const ALL_TOOLS = [
  "fleet_overview", "live_drivers", "driver_route",
  "watch_drivers",
  "list_drivers", "create_driver", "reset_pin", "set_driver_active", "update_driver",
  "list_vehicles", "register_vehicle", "update_vehicle", "add_rental_company",
  "list_places", "add_place", "search_places", "save_place", "place_detail", "import_places", "update_place", "list_import_presets", "save_import_preset", "list_place_imports", "undo_place_import",
  "google_place", "register_map_load", "save_arrival_place",
  "create_task", "task_board", "task_detail", "cancel_task", "reassign_task",
  "create_request", "list_requests", "suggest_vehicles", "decide_request", "book_vehicle", "cancel_request",
  "mileage_summary", "list_vehicle_reports", "update_vehicle_report",
  "import_projects", "find_project",
  "list_office_users", "create_office_user", "reset_office_password", "set_office_user_active", "create_office_key", "revoke_office_key",
  "update_office_user",
  "plan_task", "update_task_stops", "get_settings", "update_settings", "routing_usage", "list_issues", "update_issue", "issue_history",
  "my_notification_settings", "set_my_notification_settings", "register_web_push", "remove_web_push",
  "availability", "update_request", "redecide_request", "update_task", "list_fuel",
  "duty_log", "clock_out_driver", "move_driver_vehicle", "swap_reading", "reopen_task",
  // Phase 7, Part 3: photos and documents (the uploads photo_upload_url, vehicle_document_upload_url and
  // save_vehicle_document are the web app's only, so neither the connector nor the artifact has them).
  "set_driver_photo", "set_vehicle_photo", "vehicle_documents", "remove_vehicle_document", "restore_vehicle_document",
  "remove_place", "restore_place", "list_tasks", "set_trip_purpose", "my_trips", "my_inbox", "mark_inbox_read", "update_my_profile", "reviewing",
  // Hotfix 3: the person's page preferences (the Overview's collapsed sections, the menu's).
  "my_prefs", "set_my_prefs",
  // Part 3b: the driver's profile, availability, the Drivers board, asking drivers.
  "driver_profile", "set_driver_licence_photo", "unavailability", "set_unavailability", "remove_unavailability",
  "drivers_board", "ask_drivers", "ask_answers",
  // Hotfix O2-H2, Part 1c: the app's crash reports (Settings → App errors).
  "list_app_errors",
  // Round 2b: who changed what and when (Settings → Activity log).
  "activity_log",
  // Round 4–7 (4): the vehicle checks; a no-app trip's own page, check and close.
  "vehicle_checks", "my_trip", "my_trip_check", "finish_my_trip",
  // Round 4–7 (6): people for the Passengers field.
  "find_people",
  // Round 4–7 (7): someone else has that driver or vehicle.
  "ask_for_it", "answer_holder_ask", "holder_asks", "day_timeline",
  // Round 4–7 (item 8): resolve or dismiss many issues at once.
  "update_issues",
];
