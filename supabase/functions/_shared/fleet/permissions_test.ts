import { assert, assertEquals } from "@std/assert";
import { TOOLS } from "./index.ts";
import {
  allows,
  hasAny,
  normalisePermissions,
  PERMISSIONS,
  permissionsForRole,
  PRESETS,
  roleForPermissions,
  TOOL_PERMISSION,
  toolsFor,
} from "./permissions.ts";
import { OFFICE_ROLES, TOOL_ROLES } from "./roles.ts";

Deno.test("every tool has a permission, and every permission in the table is a known one", () => {
  for (const tool of TOOLS) {
    const needs = TOOL_PERMISSION[tool.name];
    assert(needs && needs.length > 0, `${tool.name} has no permission`);
    for (const p of needs) assert(PERMISSIONS.includes(p), `${tool.name}: ${p}`);
  }
  for (const tool of Object.keys(TOOL_PERMISSION)) {
    assert(TOOLS.some((t) => t.name === tool), `${tool} is in the table but not a tool`);
  }
});

Deno.test("the backfill map: what each role became, and the labels round-trip", () => {
  assertEquals(permissionsForRole("admin"), [...PERMISSIONS]);
  assertEquals(permissionsForRole("fleet_admin"), ["view", "request", "approve", "assign_tasks", "vehicles", "issues"]);
  assertEquals(permissionsForRole("office"), ["view", "request", "assign_tasks"]);
  assertEquals(permissionsForRole("staff"), ["view", "request"]);
  assertEquals(permissionsForRole("viewer"), ["view"]);
  assertEquals(permissionsForRole("driver"), []);
  for (const role of OFFICE_ROLES) assertEquals(roleForPermissions(permissionsForRole(role)), role);
  assertEquals(roleForPermissions(PRESETS.requester.permissions), "staff");
  assertEquals(roleForPermissions(PRESETS.dispatcher.permissions), "office");
  assertEquals(roleForPermissions([]), "viewer");
});

Deno.test("the presets", () => {
  assertEquals(PRESETS.fleet_admin.permissions, PERMISSIONS.filter((p) => p !== "users"));
  assertEquals(PRESETS.dispatcher.permissions, ["view", "request", "assign_tasks"]);
  assertEquals(PRESETS.requester.permissions, ["request"]);
  assertEquals(PRESETS.viewer.permissions, ["view"]);
});

Deno.test("who may call what", () => {
  const requester = PRESETS.requester.permissions;
  assertEquals(allows(requester, "create_request"), true);
  assertEquals(allows(requester, "list_requests"), true);
  assertEquals(allows(requester, "task_detail"), true);
  assertEquals(allows(requester, "list_places"), true);
  assertEquals(allows(requester, "task_board"), false);
  assertEquals(allows(requester, "fleet_overview"), false);
  const viewer = PRESETS.viewer.permissions;
  assertEquals(allows(viewer, "fleet_overview"), true);
  assertEquals(allows(viewer, "live_drivers"), true);
  assertEquals(allows(viewer, "list_drivers"), true);
  assertEquals(allows(viewer, "list_vehicles"), true);
  assertEquals(allows(viewer, "list_requests"), true);
  assertEquals(allows(viewer, "task_board"), false);
  assertEquals(allows(viewer, "task_detail"), false);
  assertEquals(allows(viewer, "driver_route"), false);
  assertEquals(allows(viewer, "mileage_summary"), false);
  assertEquals(allows(viewer, "list_vehicle_reports"), false);
  assertEquals(allows(viewer, "create_request"), false);
  assertEquals(allows(viewer, "create_task"), false);
  const dispatcher = PRESETS.dispatcher.permissions;
  assertEquals(allows(dispatcher, "task_board"), true);
  assertEquals(allows(dispatcher, "task_detail"), true);
  assertEquals(allows(dispatcher, "driver_route"), true);
  assertEquals(allows(dispatcher, "create_task"), true);
  assertEquals(allows(dispatcher, "add_place"), true);
  assertEquals(allows(dispatcher, "suggest_vehicles"), true);
  assertEquals(allows(dispatcher, "decide_request"), false);
  assertEquals(allows(dispatcher, "update_vehicle"), false);
  assertEquals(allows(dispatcher, "mileage_summary"), false);
  assertEquals(allows(["approve"], "task_detail"), true);
  assertEquals(allows(["vehicles"], "mileage_summary"), true);
  assertEquals(allows(["vehicles"], "driver_route"), true);
  assertEquals(allows(["users"], "list_office_users"), true);
  assertEquals(allows(["users"], "fleet_overview"), false);
  assertEquals(allows(["issues"], "list_vehicle_reports"), true);
  assertEquals(allows(["issues"], "update_vehicle_report"), true);
  assertEquals(allows([...PERMISSIONS], "no_such_tool"), false);
  assertEquals(hasAny(["view"], ["approve", "assign_tasks"]), false);
  assertEquals(hasAny(["view", "approve"], ["approve", "assign_tasks"]), true);
});

Deno.test("toolsFor keeps the connector's order; normalise drops unknown words and duplicates", () => {
  const names = TOOLS.map((t) => t.name);
  assertEquals(toolsFor(PRESETS.requester.permissions, names), [
    "list_places",
    "task_detail",
    "create_request",
    "list_requests",
    "find_project",
    "get_settings",
    "my_notification_settings",
    "set_my_notification_settings",
    "register_web_push",
    "remove_web_push",
    "update_request",
  ]);
  assertEquals(toolsFor(PRESETS.viewer.permissions, names), [
    "fleet_overview",
    "live_drivers",
    "watch_drivers",
    "list_drivers",
    "list_vehicles",
    "list_places",
    "list_requests",
    "find_project",
    "get_settings",
    "my_notification_settings",
    "set_my_notification_settings",
    "register_web_push",
    "remove_web_push",
  ]);
  assertEquals(allows(PRESETS.dispatcher.permissions, "plan_task"), true);
  assertEquals(allows(PRESETS.dispatcher.permissions, "update_task_stops"), true);
  assertEquals(allows(["approve"], "plan_task"), true);
  assertEquals(allows(["approve"], "update_task_stops"), false);
  assertEquals(allows(["users"], "update_settings"), true);
  // Phase 6: the requester edits, the approver decides again, the dispatcher changes a task, both see who is available.
  assertEquals(allows(["request"], "update_request"), true);
  assertEquals(allows(["request"], "redecide_request"), false);
  assertEquals(allows(["approve"], "redecide_request"), true);
  assertEquals(allows(["approve"], "availability"), true);
  assertEquals(allows(PRESETS.dispatcher.permissions, "availability"), true);
  assertEquals(allows(PRESETS.dispatcher.permissions, "update_task"), true);
  assertEquals(allows(PRESETS.viewer.permissions, "availability"), false);
  assertEquals(toolsFor([...PERMISSIONS], names), names);
  assertEquals(normalisePermissions(["users", "view", "boss", "view", 3]), ["view", "users"]);
  assertEquals(normalisePermissions(undefined), []);
});

Deno.test("the derived role table matches the old one where it mattered", () => {
  assertEquals(TOOL_ROLES.create_request, ["admin", "fleet_admin", "office", "staff"]);
  assertEquals(TOOL_ROLES.fleet_overview, ["admin", "fleet_admin", "office", "staff", "viewer"]);
  assertEquals(TOOL_ROLES.task_board, ["admin", "fleet_admin", "office"]);
  assertEquals(TOOL_ROLES.cancel_task, ["admin", "fleet_admin", "office"]);
  assertEquals(TOOL_ROLES.mileage_summary, ["admin", "fleet_admin"]);
  assertEquals(TOOL_ROLES.create_office_key, ["admin"]);
});
