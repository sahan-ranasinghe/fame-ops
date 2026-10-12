import { assertEquals } from "@std/assert";
import { canCall, mfaRequiredRoles } from "./roles.ts";

Deno.test("REQUIRE_MFA_ROLES: empty means nobody, names are trimmed, unknown words ignored", () => {
  assertEquals(mfaRequiredRoles(undefined), []);
  assertEquals(mfaRequiredRoles(""), []);
  assertEquals(mfaRequiredRoles("admin"), ["admin"]);
  assertEquals(mfaRequiredRoles(" admin, Fleet_Admin ,office"), ["admin", "fleet_admin", "office"]);
  assertEquals(mfaRequiredRoles("boss,admin,"), ["admin"]);
});

Deno.test("the role table: staff only reach the request tools, viewer only reads", () => {
  assertEquals(canCall("staff", "create_request"), true);
  assertEquals(canCall("staff", "task_board"), false);
  assertEquals(canCall("viewer", "fleet_overview"), true);
  assertEquals(canCall("viewer", "create_task"), false);
  assertEquals(canCall("office", "create_task"), true);
  assertEquals(canCall("office", "cancel_task"), false);
  assertEquals(canCall("admin", "create_office_key"), true);
});
