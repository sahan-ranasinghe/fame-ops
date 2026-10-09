// Tests of the km-outside-tasks pairing (fleet.ts pairGaps).
//   deno test gaps_test.ts     (the README runs it in Docker)

import { assertEquals } from "@std/assert";
import { pairGaps, type Reading } from "./fleet.ts";

const V = "20000000-0000-0000-0000-000000000001";
const A = "10000000-0000-0000-0000-0000000000a1";
const B = "10000000-0000-0000-0000-0000000000b1";
const T1 = "50000000-0000-0000-0000-000000000001";
const T2 = "50000000-0000-0000-0000-000000000002";

let n = 0;
function reading(at: string, km: number, kind: Reading["kind"], task: string | null, driver = A, vehicle = V): Reading {
  n += 1;
  return {
    id: `r${String(n).padStart(3, "0")}`,
    vehicle_id: vehicle,
    employee_id: driver,
    task_id: task,
    kind,
    reading_km: km,
    logged_at: at,
    photo_id: null,
  };
}

Deno.test("task km is not a gap; between tasks and overnight are, by Colombo day", () => {
  const gaps = pairGaps([
    reading("2026-10-07T12:30:00Z", 84500, "manual", null), //      Wed 18:00 Colombo: driver A parks at home
    reading("2026-10-08T01:30:00Z", 84512, "task_start", T1), //    Thu 07:00: 12 km overnight (home -> office)
    reading("2026-10-08T03:30:00Z", 84563, "task_end", T1), //      Thu 09:00: the task's own 51 km
    reading("2026-10-08T07:30:00Z", 84570, "task_start", T2, B), // Thu 13:00: 7 km between tasks, driver A had the vehicle
    reading("2026-10-08T09:30:00Z", 84600, "task_end", T2, B), //   Thu 15:00
    reading("2026-10-08T13:30:00Z", 84650, "manual", null, B), //   Thu 19:00: 50 km between tasks, driver B
    reading("2026-10-09T02:30:00Z", 84651, "manual", null, B), //   Fri 08:00: 1 km overnight
    reading("2026-10-09T03:30:00Z", 84640, "manual", null, B), //   Fri 09:00: a correction downwards: not a gap
  ]);
  assertEquals(gaps.map((g) => [g.type, g.km, g.from.employee_id === A ? "A" : "B"]), [
    ["overnight", 12, "A"],
    ["between_tasks", 7, "A"],
    ["between_tasks", 50, "B"],
    ["overnight", 1, "B"],
  ]);
});

Deno.test("readings inside one task are never a gap, whatever their kind", () => {
  const gaps = pairGaps([
    reading("2026-10-08T01:30:00Z", 100, "task_start", T1),
    reading("2026-10-08T02:00:00Z", 120, "manual", T1),
    reading("2026-10-08T03:30:00Z", 150, "task_end", T1),
  ]);
  assertEquals(gaps, []);
});

Deno.test("vehicles are paired separately and out-of-order input is sorted", () => {
  const V2 = "20000000-0000-0000-0000-000000000002";
  const gaps = pairGaps([
    reading("2026-10-08T03:30:00Z", 210, "manual", null, A, V2),
    reading("2026-10-08T01:30:00Z", 200, "manual", null, A, V2),
    reading("2026-10-08T01:30:00Z", 500, "manual", null, B, V),
    reading("2026-10-08T02:30:00Z", 530, "manual", null, B, V),
  ]);
  assertEquals(gaps.map((g) => [g.vehicle_id === V ? "V1" : "V2", g.km]).sort(), [["V1", 30], ["V2", 10]]);
});
