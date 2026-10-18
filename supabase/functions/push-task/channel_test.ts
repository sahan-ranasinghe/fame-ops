import { assertEquals } from "jsr:@std/assert@1";
import { channelFor } from "./channels.ts";

Deno.test("each push goes on its 1.3.0 channel once the phone has it, else as before", () => {
  const p13 = ["new-tasks", "driver-asks", "task-ring", "task-updates", "office-asks"];
  const p12 = ["new-tasks", "driver-asks"];
  // A new task rings on task-ring; a change, a cancellation and "no longer yours" have their own tone.
  assertEquals(["new", "changed", "cancelled", "removed", "ask"].map((k) => channelFor(k as never, p13)), [
    "task-ring",
    "task-updates",
    "task-updates",
    "task-updates",
    "office-asks",
  ]);
  // The 1.2.0 app's channels, as before Part 6.
  assertEquals(["new", "changed", "cancelled", "removed", "ask"].map((k) => channelFor(k as never, p12)), [
    "new-tasks",
    "new-tasks",
    "new-tasks",
    "new-tasks",
    "driver-asks",
  ]);
  // A 1.3.0 phone registers only its three (the app removes new-tasks and driver-asks there); the other kinds keep the
  // original channels, which every phone has.
  const only13 = ["task-ring", "task-updates", "office-asks"];
  const all = [
    "new",
    "changed",
    "cancelled",
    "removed",
    "leave_30",
    "leave_now",
    "accept_reminder",
    "reopened",
    "vehicle_taken",
    "vehicle_moved",
    "duty_auto_out",
    "duty_office_out",
    "ask",
  ];
  assertEquals(all.map((k) => channelFor(k as never, only13)), [
    "task-ring",
    "task-updates",
    "task-updates",
    "task-updates",
    "tasks-changed",
    "tasks-new",
    "tasks-new",
    "tasks-changed",
    "general",
    "general",
    "general",
    "general",
    "office-asks",
  ]);
  // A Hotfix 2 phone (new-tasks only): the task pushes on it, a question on the loud original channel.
  assertEquals(["new", "changed", "cancelled", "removed", "ask", "leave_now"].map((k) => channelFor(k as never, ["new-tasks"])), [
    "new-tasks",
    "new-tasks",
    "new-tasks",
    "new-tasks",
    "tasks-new",
    "tasks-new",
  ]);
  // No channel registered: the original channels.
  assertEquals(["new", "changed", "removed", "ask", "leave_30", "duty_auto_out"].map((k) => channelFor(k as never, [])), [
    "tasks-new",
    "tasks-changed",
    "general",
    "tasks-new",
    "tasks-changed",
    "general",
  ]);
});
