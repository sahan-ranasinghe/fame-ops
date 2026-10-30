// Round 53 (b): an archived driver or vehicle is refused the moment it is named for a trip, a vehicle or a question
// ("<name> is archived: restore them first or pick another"), and never makes an active one's name ambiguous. History
// and reports still find archived ones (findDriver / findVehicle unchanged).
import { assertEquals, assertThrows } from "@std/assert";
import { type Employee, findActiveDriver, findActiveVehicle, findDriver, findVehicle, type Refs, type Vehicle } from "./fleet.ts";
import { activeDriver, activeVehicle } from "./tools/tasks.ts";

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
