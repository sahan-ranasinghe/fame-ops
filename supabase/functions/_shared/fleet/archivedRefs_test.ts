// Round 53 (b): an archived driver or vehicle is refused the moment it is named for a trip, a vehicle or a question
// ("<name> is archived: restore them first or pick another"), and never makes an active one's name ambiguous. History
// and reports still find archived ones (findDriver / findVehicle unchanged).
import { assertEquals, assertThrows } from "@std/assert";
import { type Employee, findActiveDriver, findActiveVehicle, findDriver, findVehicle, type Refs, type Vehicle } from "./fleet.ts";
import { activeDriver, activeVehicle, refuseArchivedKept } from "./tools/tasks.ts";
import { moveDriverVehicle } from "./tools/duty.ts";
import type { Db } from "./db.ts";

const emp = (
  id: string,
  name: string,
  username: string,
  active: boolean,
): Employee => ({ id, name, username, code: id.toUpperCase(), role: "driver", active, demo: false } as unknown as Employee);
const veh = (id: string, reg_no: string, active: boolean): Vehicle => ({ id, reg_no, active, demo: false } as unknown as Vehicle);

const employees = [
  emp("e1", "Kamal Perera", "kamal.p", false),
  emp("e2", "Kamal Silva", "kamal.s", true),
  emp("e3", "Nimal Fernando", "nimal", false),
  emp("e4", "Sunil Old", "sunil.a", false),
  emp("e5", "Sunil Older", "sunil.b", false),
];
const vehicles = [veh("v1", "WP CAB-4521", false), veh("v2", "WP CAB-4522", true), veh("v3", "WP KL-1001", false)];
const refs = {
  employees,
  vehicles,
  emp: new Map(employees.map((e) => [e.id, e])),
  veh: new Map(vehicles.map((v) => [v.id, v])),
  company: new Map(),
} as unknown as Refs;

const message = (f: () => unknown) => (assertThrows(f) as Error).message;

Deno.test("an archived driver named for a trip: refused at once, in words", () => {
  assertEquals(message(() => findActiveDriver(refs, "Nimal Fernando")), "Nimal Fernando is archived: restore them first or pick another.");
  assertEquals(message(() => findActiveDriver(refs, "nimal")), "Nimal Fernando is archived: restore them first or pick another.");
  assertEquals(message(() => activeDriver(refs, "Nimal")), "Nimal Fernando is archived: restore them first or pick another.");
  assertEquals(
    message(() => findActiveDriver(refs, "Sunil")),
    '"Sunil" matches only archived drivers: Sunil Old (sunil.a); Sunil Older (sunil.b). Restore one first or pick another.',
  );
});

Deno.test("an archived driver never makes an active one's name ambiguous", () => {
  assertEquals(findActiveDriver(refs, "Kamal").id, "e2");
  assertEquals(activeDriver(refs, "kamal").name, "Kamal Silva");
  // The exact name of the archived one is still refused, not swapped for the active Kamal.
  assertEquals(message(() => findActiveDriver(refs, "Kamal Perera")), "Kamal Perera is archived: restore them first or pick another.");
  assertEquals(message(() => findActiveDriver(refs, "Ruwan")), 'No driver matches "Ruwan". Use list_drivers to see the drivers.');
});

Deno.test("an archived vehicle named for a trip: refused at once; it never makes a plate ambiguous", () => {
  assertEquals(message(() => findActiveVehicle(refs, "wp cab 4521")), "WP CAB-4521 is archived: restore it first or pick another.");
  assertEquals(message(() => activeVehicle(refs, "KL1001")), "WP KL-1001 is archived: restore it first or pick another.");
  assertEquals(findActiveVehicle(refs, "cab452").reg_no, "WP CAB-4522");
});

Deno.test("history and reports still find archived ones", () => {
  assertEquals(findDriver(refs, "Nimal").id, "e3");
  assertEquals(findVehicle(refs, "WP CAB-4521").id, "v1");
});

// The review (2 November): the driver and vehicle a trip keeps are checked too, and a trip already running keeps its swap.

Deno.test("a kept archived driver or vehicle is refused with the same words; active ones and none pass", () => {
  const r = refs;
  assertThrows(() => refuseArchivedKept(r, { driverId: "e1" }), Error, "Kamal Perera is archived: restore them first or pick another.");
  assertThrows(() => refuseArchivedKept(r, { vehicleId: "v1" }), Error, "is archived: restore it first or pick another.");
  refuseArchivedKept(r, { driverId: "e2", vehicleId: null });
  refuseArchivedKept(r, {});
});

/** A database that answers every read of a table with its rows (enough for loadRefs and Move's running-trip read). */
function tablesDb(tables: Record<string, unknown[]>): Db {
  const chain = (table: string): unknown => {
    const result = { data: tables[table] ?? [], error: null };
    const self: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        return () => self;
      },
    });
    return self;
  };
  return { from: chain, rpc: () => Promise.resolve({ data: null, error: { message: "not in this test" } }) } as unknown as Db;
}

Deno.test("Move: an archived driver with no trip running gets no vehicle; with a trip running the swap goes on", async () => {
  const r = refs;
  const active = r.vehicles.find((v) => v.active)!;
  const ctx = (tasks: unknown[]) =>
    ({ db: tablesDb({ employees: r.employees, vehicles: r.vehicles, rental_companies: [], tasks }), actor: { name: "Office" } }) as never;
  const idle = await moveDriverVehicle.run({ driver: "kamal.p", vehicle: active.reg_no } as never, ctx([])).then(
    () => "",
    (e) => String(e),
  );
  assertEquals(idle.includes("Kamal Perera is archived: restore them first or pick another."), true, idle);
  const running = await moveDriverVehicle.run(
    { driver: "kamal.p", vehicle: active.reg_no } as never,
    ctx([{ id: "t1", title: "Trip", vehicle_id: "v9" }]),
  )
    .then(() => "", (e) => String(e));
  assertEquals(running.includes("is archived"), false, `the swap was not refused for the archive: ${running}`);
});
