// A task's km per vehicle when the vehicle was swapped during the task (docs/phase7-plan.md, §2 addition).
import { assertEquals } from "@std/assert";
import { taskPieces } from "./segments.ts";

Deno.test("a task with no swap is one piece on its own vehicle", () => {
  assertEquals(taskPieces([{ id: "t1", vehicle_id: "A", km: 42 }], []), [{ task_id: "t1", vehicle_id: "A", km: 42 }]);
  assertEquals(taskPieces([{ id: "t1", vehicle_id: "A", km: null }], []), [{ task_id: "t1", vehicle_id: "A", km: 0 }]);
});

Deno.test("a swapped task gives each vehicle its own stretch, in order; the task's vehicle is the last one", () => {
  const pieces = taskPieces([{ id: "t1", vehicle_id: "B", km: 60 }], [
    { task_id: "t1", seq: 2, vehicle_id: "B", start_odometer_km: 5000, end_odometer_km: 5035 },
    { task_id: "t1", seq: 1, vehicle_id: "A", start_odometer_km: 10000, end_odometer_km: 10025 },
  ]);
  assertEquals(pieces, [
    { task_id: "t1", vehicle_id: "A", km: 25 },
    { task_id: "t1", vehicle_id: "B", km: 35 },
  ]);
  assertEquals(pieces.reduce((sum, p) => sum + p.km, 0), 60);
});

Deno.test("a stretch whose reading the driver has not entered yet counts 0 km", () => {
  assertEquals(
    taskPieces([{ id: "t1", vehicle_id: "B", km: 25 }], [
      { task_id: "t1", seq: 1, vehicle_id: "A", start_odometer_km: 10000, end_odometer_km: 10025 },
      { task_id: "t1", seq: 2, vehicle_id: "B", start_odometer_km: null, end_odometer_km: 5035 },
    ]).map((p) => p.km),
    [25, 0],
  );
});
