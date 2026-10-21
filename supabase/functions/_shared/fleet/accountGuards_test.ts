import { assertEquals } from "jsr:@std/assert";
import { accountChangeProblem } from "./accountGuards.ts";
import { type Permission, PRESETS } from "./permissions.ts";

const coordinator = { employeeId: "c1", permissions: PRESETS.coordinator.permissions };
const admin = {
  employeeId: "a1",
  permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users", "office_users"] as Permission[],
};
const sharedKey = { employeeId: null, permissions: admin.permissions };
const requesterTarget = { id: "r1", permissions: ["view", "request"] as Permission[] };
const fleetAdminTarget = { id: "f1", permissions: PRESETS.fleet_admin.permissions };
const adminTarget = { id: "a2", permissions: admin.permissions };

Deno.test("a Coordinator adds an office user with request only; never with approve or users", () => {
  assertEquals(accountChangeProblem(coordinator, { kind: "create", permissions: ["view", "request"] }), null);
  assertEquals(
    accountChangeProblem(coordinator, { kind: "create", permissions: ["view", "approve"] }),
    "You can only give or take away permissions you hold yourself (not: Approve).",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "create", permissions: ["view", "users"] }),
    "You can only give or take away permissions you hold yourself (not: Users).",
  );
});

Deno.test("a Coordinator cannot give approve, nor take it from a fleet admin; may change a requester within their own", () => {
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: requesterTarget, permissions: ["view", "request", "approve"] }),
    "You can only give or take away permissions you hold yourself (not: Approve).",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: fleetAdminTarget, permissions: ["view", "request", "assign_tasks"] }),
    "You can only give or take away permissions you hold yourself (not: Approve).",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: requesterTarget, permissions: ["view", "request", "assign_tasks"] }),
    null,
  );
  assertEquals(accountChangeProblem(coordinator, { kind: "update", target: fleetAdminTarget }), null); // name or phone only
});

Deno.test("nobody changes their own role or permissions or switches themselves off; an admin neither", () => {
  const self = { id: "c1", permissions: coordinator.permissions };
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: self, permissions: ["view"] }),
    "You cannot change your own role or permissions. Ask another admin.",
  );
  assertEquals(
    accountChangeProblem(admin, { kind: "update", target: { id: "a1", permissions: admin.permissions }, role: "admin" }),
    "You cannot change your own role or permissions. Ask another admin.",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "switch", target: self, active: false }),
    "You cannot switch off your own account. Ask another admin.",
  );
  assertEquals(accountChangeProblem(coordinator, { kind: "update", target: self }), null); // their own name and phone
});

Deno.test("only an admin changes an admin's account, in any way", () => {
  for (
    const change of [
      { kind: "update", target: adminTarget } as const,
      { kind: "switch", target: adminTarget, active: false } as const,
      { kind: "password_link", target: adminTarget } as const,
    ]
  ) {
    assertEquals(accountChangeProblem(coordinator, change), "Only an admin can change an admin's account.");
    assertEquals(accountChangeProblem(admin, change), null);
  }
});

Deno.test("a role by name is the admins'; the shared key passes", () => {
  assertEquals(
    accountChangeProblem(coordinator, { kind: "create", permissions: ["view"], role: "admin" }),
    "Only an admin can set a role by name. Choose the permissions instead.",
  );
  assertEquals(accountChangeProblem(sharedKey, { kind: "update", target: adminTarget, permissions: ["view"] }), null);
});

Deno.test("an admin of before Round 2b (no office_users of their own) makes a Coordinator: users covers office accounts", () => {
  const oldAdmin = { employeeId: "a9", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"] as Permission[] };
  assertEquals(accountChangeProblem(oldAdmin, { kind: "create", permissions: PRESETS.coordinator.permissions }), null);
});
