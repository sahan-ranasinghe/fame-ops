import { assertEquals } from "jsr:@std/assert";
import { accountChangeProblem } from "./accountGuards.ts";
import { type Permission, PERMISSION_TEXT, PRESETS } from "./permissions.ts";

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
    "Only an admin can give Approve.",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "create", permissions: ["view", "users"] }),
    "Only an admin can give Users.",
  );
  // Rule 4: not even another Coordinator (office_users is the admins' to give).
  assertEquals(
    accountChangeProblem(coordinator, { kind: "create", permissions: PRESETS.coordinator.permissions }),
    `Only an admin can give ${PERMISSION_TEXT.office_users.label}.`,
  );
});

Deno.test("a Coordinator cannot give approve, nor take it from a fleet admin; may change a requester within their own", () => {
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: requesterTarget, permissions: ["view", "request", "approve"] }),
    "Only an admin can give Approve.",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: fleetAdminTarget, permissions: ["view", "request", "assign_tasks"] }),
    "Only an admin can change this account: it holds Approve.",
  );
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: requesterTarget, permissions: ["view", "request", "assign_tasks"] }),
    null,
  );
  // Checkpoint 2b review: not even a name or a phone on a Fleet admin's account (it holds approve).
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
  const oldAdmin = {
    employeeId: "a9",
    permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"] as Permission[],
  };
  assertEquals(accountChangeProblem(oldAdmin, { kind: "create", permissions: PRESETS.coordinator.permissions }), null);
});

Deno.test("Checkpoint 2b review: a Coordinator never acts on a Fleet admin's account (no password link, no switch, no edit)", () => {
  const why = "Only an admin can change this account: it holds Approve.";
  assertEquals(accountChangeProblem(coordinator, { kind: "password_link", target: fleetAdminTarget }), why);
  assertEquals(accountChangeProblem(coordinator, { kind: "switch", target: fleetAdminTarget, active: true }), why);
  assertEquals(accountChangeProblem(coordinator, { kind: "update", target: fleetAdminTarget }), why);
  assertEquals(accountChangeProblem(coordinator, { kind: "password_link", target: requesterTarget }), null);
});

Deno.test("help-desk rule: Coordinator A cannot reset, edit or switch off Coordinator B; can for a Requester", () => {
  const coordinatorB = { id: "c2", permissions: coordinator.permissions };
  const why = `Only an admin can change this account: it holds ${PERMISSION_TEXT.office_users.label}.`;
  for (
    const change of [
      { kind: "password_link", target: coordinatorB } as const,
      { kind: "update", target: coordinatorB } as const, // a name or a phone
      { kind: "update", target: coordinatorB, permissions: ["view", "request"] } as const,
      { kind: "switch", target: coordinatorB, active: false } as const,
      { kind: "switch", target: coordinatorB, active: true } as const,
    ]
  ) {
    assertEquals(accountChangeProblem(coordinator, change), why);
    assertEquals(accountChangeProblem(admin, change), null);
  }
  for (
    const change of [
      { kind: "password_link", target: requesterTarget } as const,
      { kind: "update", target: requesterTarget, permissions: ["view", "request", "issues"] } as const,
      { kind: "switch", target: requesterTarget, active: false } as const,
    ]
  ) {
    assertEquals(accountChangeProblem(coordinator, change), null);
  }
});

Deno.test("last active admin: never switched off, never loses Users, never another role, whoever asks", () => {
  const lastAdmin = { id: "a2", permissions: admin.permissions, role: "admin", active: true };
  const one = { activeAdmins: 1 };
  for (const actor of [admin, sharedKey]) {
    assertEquals(
      accountChangeProblem(actor, { kind: "switch", target: lastAdmin, active: false }, one),
      "This is the last active admin: it cannot be switched off. Make another admin first.",
    );
    assertEquals(
      accountChangeProblem(actor, { kind: "update", target: lastAdmin, permissions: PRESETS.fleet_admin.permissions }, one),
      "This is the last active admin: it cannot lose Users. Make another admin first.",
    );
    assertEquals(
      accountChangeProblem(actor, { kind: "update", target: lastAdmin, role: "fleet_admin" }, one),
      "This is the last active admin: its role stays Admin. Make another admin first.",
    );
    // A name, a phone, a link, switching on: fine.
    assertEquals(accountChangeProblem(actor, { kind: "update", target: lastAdmin }, one), null);
    assertEquals(accountChangeProblem(actor, { kind: "password_link", target: lastAdmin }, one), null);
    // With a second active admin, the admin may be switched off or demoted.
    const two = { activeAdmins: 2 };
    assertEquals(accountChangeProblem(actor, { kind: "switch", target: lastAdmin, active: false }, two), null);
    assertEquals(
      accountChangeProblem(actor, { kind: "update", target: lastAdmin, permissions: PRESETS.fleet_admin.permissions }, two),
      null,
    );
  }
  // The last admin on themselves: the last-admin reason comes first, the self rules still hold with two.
  const selfAdmin = { ...lastAdmin, id: "a1" };
  assertEquals(
    accountChangeProblem(admin, { kind: "switch", target: selfAdmin, active: false }, one),
    "This is the last active admin: it cannot be switched off. Make another admin first.",
  );
  assertEquals(
    accountChangeProblem(admin, { kind: "update", target: selfAdmin, permissions: ["view"] }, { activeAdmins: 2 }),
    "You cannot change your own role or permissions. Ask another admin.",
  );
  // An admin already switched off is no loss.
  assertEquals(
    accountChangeProblem(admin, { kind: "switch", target: { ...lastAdmin, active: false }, active: false }, { activeAdmins: 0 }),
    null,
  );
});

Deno.test("Checkpoint 2b review: one's own account with the same permission list sent back is not a change", () => {
  const self = { id: "c1", permissions: coordinator.permissions };
  assertEquals(
    accountChangeProblem(coordinator, { kind: "update", target: self, permissions: [...coordinator.permissions].reverse() }),
    null,
  );
});
