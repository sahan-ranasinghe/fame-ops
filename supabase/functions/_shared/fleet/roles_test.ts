import { assertEquals } from "@std/assert";
import { permissionsForRole } from "./permissions.ts";
import { type Actor, canCall, mfaRequiredRoles, type Role } from "./roles.ts";

const actorOf = (role: Role): Actor => ({ employeeId: "x", name: "x", role, permissions: permissionsForRole(role), channel: "web" });

Deno.test("REQUIRE_MFA_ROLES: empty means nobody, names are trimmed, unknown words ignored", () => {
  assertEquals(mfaRequiredRoles(undefined), []);
  assertEquals(mfaRequiredRoles(""), []);
  assertEquals(mfaRequiredRoles("admin"), ["admin"]);
  assertEquals(mfaRequiredRoles(" admin, Fleet_Admin ,office"), ["admin", "fleet_admin", "office"]);
  assertEquals(mfaRequiredRoles("boss,admin,"), ["admin"]);
});

Deno.test("an actor with a role's default permissions: staff reach the request tools and the fleet, viewer only reads", () => {
  assertEquals(canCall(actorOf("staff"), "create_request"), true);
  assertEquals(canCall(actorOf("staff"), "task_board"), true);
  assertEquals(canCall(actorOf("staff"), "create_task"), false);
  assertEquals(canCall(actorOf("viewer"), "fleet_overview"), true);
  assertEquals(canCall(actorOf("viewer"), "create_task"), false);
  assertEquals(canCall(actorOf("office"), "create_task"), true);
  assertEquals(canCall(actorOf("office"), "cancel_task"), true);
  assertEquals(canCall(actorOf("office"), "decide_request"), false);
  assertEquals(canCall(actorOf("admin"), "create_office_key"), true);
  assertEquals(canCall({ permissions: ["request"] }, "task_board"), false);
});
