import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { Employee, Vehicle } from "./fleet.ts";
import { requestDiff, snapshot } from "./requests_rules.ts";
import { askedOf, checkAsked, decideWhoDrives, noAppLine, shownDriver } from "./whoDrives.ts";

const emp = (id: string, role: string, active = true) => ({ id, name: `Person ${id}`, role, active }) as unknown as Employee;
const people = new Map([
  ["d1", emp("d1", "driver")],
  ["a1", emp("a1", "staff")],
  ["c1", emp("c1", "office")],
  ["x1", emp("x1", "staff", false)],
  ["boss", emp("boss", "admin")],
]);
const van = { id: "v1", reg_no: "WP CAB-4521", custodian_employee_id: "c1" } as unknown as Vehicle;
const pool = { id: "v2", reg_no: "WP CAR-1000", custodian_employee_id: null } as unknown as Vehicle;
const base = {
  driverTyped: null,
  askerId: "a1",
  approverId: "boss",
  driverName: null,
  driverPhone: null,
  vehicle: van,
  selfDriveAllowed: true,
};

Deno.test("what was asked: driven_by wins; driver_required false alone is the old custodian path", () => {
  assertEquals(askedOf({}), "driver");
  assertEquals(askedOf({ driven_by: "self" }), "self");
  assertEquals(askedOf({ driver_required: false }), "custodian");
  assertEquals(askedOf({ driver_required: true }, "other"), "driver");
  assertEquals(askedOf({}, "other"), "other");
});

Deno.test("checking the choice: the setting, a person for 'myself', a name and a phone for someone else", () => {
  assertEquals(checkAsked("driver", {}, false, { employeeId: null }), {
    driven_by: "driver",
    driver_required: true,
    driver_name: null,
    driver_phone: null,
  });
  assertThrows(() => checkAsked("self", {}, false, { employeeId: "a1" }), Error, "every trip needs a driver");
  assertThrows(() => checkAsked("self", {}, true, { employeeId: null }), Error, "needs a person's own sign-in");
  assertEquals(checkAsked("self", { driver_name: "ignored" }, true, { employeeId: "a1" }).driver_name, null);
  assertThrows(() => checkAsked("other", { driver_phone: "0771234567" }, true, { employeeId: "a1" }), Error, "give their name");
  assertThrows(() => checkAsked("other", { driver_name: "Nimal" }, true, { employeeId: "a1" }), Error, "give their phone");
  assertEquals(checkAsked("other", { driver_name: " Nimal ", driver_phone: "077 123 4567" }, true, { employeeId: "a1" }), {
    driven_by: "other",
    driver_required: false,
    driver_name: "Nimal",
    driver_phone: "+94771234567",
  });
  assertThrows(() => checkAsked("other", { driver_name: "Nimal", driver_phone: "12" }, true, { employeeId: "a1" }), Error, "Sri Lankan");
});

Deno.test("at approval: a driver named wins; else the request's choice, each needing a vehicle", () => {
  const d1 = people.get("d1")!;
  assertEquals(decideWhoDrives({ ...base, asked: "self", driverTyped: d1 }, people).drivenBy, "driver");
  assertThrows(() => decideWhoDrives({ ...base, asked: "driver" }, people), Error, "Give a driver");
  // I'll drive myself: the asker.
  const self = decideWhoDrives({ ...base, asked: "self" }, people);
  assertEquals([self.employee.id, self.drivenBy], ["a1", "self"]);
  assertThrows(() => decideWhoDrives({ ...base, asked: "self", vehicle: null }, people), Error, "name the vehicle");
  assertThrows(() => decideWhoDrives({ ...base, asked: "self", askerId: "x1" }, people), Error, "not an active office user");
  // Someone else: on the asker's account (else the approver's), with the name and phone asked.
  const other = decideWhoDrives({ ...base, asked: "other", driverName: "Nimal", driverPhone: "+94771234567" }, people);
  assertEquals([other.employee.id, other.drivenBy, other.driverName, other.driverPhone], ["a1", "other", "Nimal", "+94771234567"]);
  assertEquals(decideWhoDrives({ ...base, asked: "other", askerId: null, driverName: "Nimal" }, people).employee.id, "boss");
  assertThrows(() => decideWhoDrives({ ...base, asked: "other", driverName: "Nimal", vehicle: null }, people), Error, "name the vehicle");
  // The old path: the vehicle's custodian drives (a self-driven trip).
  const custodian = decideWhoDrives({ ...base, asked: "custodian" }, people);
  assertEquals([custodian.employee.id, custodian.drivenBy], ["c1", "self"]);
  assertThrows(() => decideWhoDrives({ ...base, asked: "custodian", vehicle: pool }, people), Error, "has no custodian");
  assertThrows(() => decideWhoDrives({ ...base, asked: "self", selfDriveAllowed: false }, people), Error, "self_drive_allowed");
});

Deno.test("the words: the shown driver and the no-app status line", () => {
  assertEquals(shownDriver({ driven_by: "other", driver_name: "Nimal" }, { name: "Asha" }), "Nimal");
  assertEquals(shownDriver({ driven_by: "self", driver_name: null }, { name: "Asha" }), "Asha");
  assertEquals(noAppLine("self"), "Drives themselves · no app");
  assertEquals(noAppLine("other"), "Someone else drives · no app");
  assertEquals(noAppLine("driver"), null);
});

Deno.test("a request's change of who drives reads as one change, in words", () => {
  const before = {
    needed_at: "2026-10-22T03:30:00Z",
    back_by: null,
    route_from: "Office",
    route_to: "Galle",
    need_type: null,
    pax: 2,
    tools: false,
    note: null,
    driver_required: true,
    driven_by: "driver",
    driver_name: null,
  };
  assertEquals(requestDiff(snapshot(before), snapshot({ ...before, driver_required: false, driven_by: "self" })), {
    driver: { from: "a driver", to: "drives themselves" },
  });
  assertEquals(
    requestDiff(
      snapshot({ ...before, driver_required: false, driven_by: "self" }),
      snapshot({ ...before, driver_required: false, driven_by: "other", driver_name: "Nimal" }),
    ),
    { driver: { from: "drives themselves", to: "someone else (Nimal)" } },
  );
  // An old snapshot (before Round 3) still reads.
  assertEquals(requestDiff({ ...before, driven_by: undefined, driver_required: false }, before), {
    driver: { from: "the custodian drives", to: "a driver" },
  });
});
