// One interface, two ways to reach the Fame Fleet rules (docs/office-web-plan.md, section 4):
//   ClaudeTransport  the artifact, through the viewer's "Fame Fleet" connector (window.claude)
//   ApiTransport     the web app, through office-api with the person's Supabase session
// Both give the same JSON for the same tool and arguments.

import type { Permission } from "@fleet/permissions";

export type { Permission };

export type Role = "admin" | "fleet_admin" | "office" | "staff" | "viewer";

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
}

/** True when the person holds any one of the permissions (none asked = everyone). */
export function can(me: Pick<Me, "permissions">, ...any: Permission[]): boolean {
  return any.length === 0 || any.some((p) => me.permissions.includes(p));
}

export interface FleetError {
  code: string;
  message: string;
  status?: number;
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
  "create_task", "task_board", "task_detail", "cancel_task", "reassign_task",
  "create_request", "list_requests", "suggest_vehicles", "decide_request", "book_vehicle", "cancel_request",
  "mileage_summary", "list_vehicle_reports", "update_vehicle_report",
  "import_projects", "find_project",
  "list_office_users", "create_office_user", "reset_office_password", "set_office_user_active", "create_office_key", "revoke_office_key",
  "update_office_user",
  "plan_task", "update_task_stops", "get_settings", "update_settings", "routing_usage", "list_issues", "update_issue", "issue_history",
  "my_notification_settings", "set_my_notification_settings", "register_web_push", "remove_web_push",
  "availability", "update_request", "redecide_request", "update_task", "list_fuel",
];
