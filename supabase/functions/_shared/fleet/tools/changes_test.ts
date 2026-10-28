// Round 48 (item 1): the approval gate for changes to a task, and the words of a proposed change.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { changeCardOf, changeSummary, needsApproval, pendingChangeCard } from "./changes.ts";

const settingsOn = { tasks_need_approval: true };
const settingsOff = { tasks_need_approval: false };
const dispatcher = { permissions: ["view", "request", "assign_tasks"] as never[] };
const admin = { permissions: ["view", "request", "approve", "assign_tasks"] as never[] };

Deno.test("needsApproval: the setting on and no approve permission", () => {
  assertEquals(needsApproval(settingsOn, dispatcher), true);
  assertEquals(needsApproval(settingsOn, admin), false);
  assertEquals(needsApproval(settingsOff, dispatcher), false);
  assertEquals(needsApproval(settingsOff, admin), false);
});

Deno.test("changeSummary: one line per field, in words", () => {
  assertEquals(
    changeSummary({
      driver: { from: "Nuwan Perera", to: "Kamal Silva" },
      time: { from: "Thu 29 Oct 09:00", to: "Thu 29 Oct 10:00" },
      stops: { from: null, to: "Stop 2 added: Galle" },
      "end by": { from: "13:00", to: null },
    }),
    "driver Kamal Silva instead of Nuwan Perera · time Thu 29 Oct 10:00 instead of Thu 29 Oct 09:00 · stops: Stop 2 added: Galle · end by cleared",
  );
});

const row = {
  id: "r1",
  kind: "change",
  change_task_id: "t1",
  title: "Team drop · Galle",
  requested_by_name: "Sashen",
  created_at: "2026-10-28T03:30:00.000Z",
  proposal_json: {
    tool: "reassign_task",
    args: { task_id: "t1", driver: "kamal" },
    changes: { driver: { from: "Nuwan Perera", to: "Kamal Silva" } },
    summary: "driver Kamal Silva instead of Nuwan Perera",
    plan_version: 3,
    task_status: "declined",
  },
} as unknown as Parameters<typeof pendingChangeCard>[0];

Deno.test("pendingChangeCard: what a task card says while the change waits", () => {
  const c = pendingChangeCard(row, new Date("2026-10-28T04:00:00.000Z"));
  assertEquals(c.request_id, "r1");
  assertEquals(c.by, "Sashen");
  assertEquals(c.tool, "reassign_task");
  assertEquals(c.summary, "driver Kamal Silva instead of Nuwan Perera");
  assertStringIncludes(c.text, "Change waiting for approval · Sashen · driver Kamal Silva instead of Nuwan Perera");
  assertEquals(c.changes, { driver: { from: "Nuwan Perera", to: "Kamal Silva" } });
});

Deno.test("changeCardOf: only a request of kind change has one", () => {
  const c = changeCardOf(row)!;
  assertEquals(c.task_id, "t1");
  assertEquals(c.task_title, "Team drop · Galle");
  assertEquals(c.task_was, "declined");
  assertEquals(changeCardOf({ ...row, kind: "task" } as never), undefined);
});
