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
