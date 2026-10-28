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

import { taskMovedSince, withoutGoogleContent } from "./changes.ts";

Deno.test("withoutGoogleContent: a Google pick keeps only its place id (rule 10, review L3)", () => {
  const args = {
    task_id: "t1",
    stops: [
      { type: "pickup", place: "Head office", lat: 6.9, lng: 79.8, address: "Colombo 05" },
      { type: "drop", place: "Galle Fort Hotel", google_place_id: "ChIJabc", lat: 6.03, lng: 80.2, address: "Church St, Galle" },
    ],
    start: { place: "Nice Cafe", google_place_id: "ChIJxyz", lat: 6.9, lng: 79.9, address: "Galle Rd" },
  };
  assertEquals(withoutGoogleContent(args), {
    task_id: "t1",
    stops: [
      { type: "pickup", place: "Head office", lat: 6.9, lng: 79.8, address: "Colombo 05" },
      { type: "drop", place: "Google place", google_place_id: "ChIJabc" },
    ],
    start: { place: "Google place", google_place_id: "ChIJxyz" },
  });
  assertEquals(withoutGoogleContent({ task_id: "t1", driver: "kamal" }), { task_id: "t1", driver: "kamal" });
});

Deno.test("taskMovedSince: the time, end, driver or vehicle moved since the proposal (review L1)", () => {
  const state = { start_at: "2026-10-29T03:30:00.000Z", end_by: null, employee_id: "e1", vehicle_id: "v1" };
  const p = { tool: "update_task", args: {}, changes: {}, summary: "", plan_version: 1, task_status: "assigned", task_state: state } as never;
  const task = { start_at: state.start_at, end_by: null, employee_id: "e1", vehicle_id: "v1" } as never;
  assertEquals(taskMovedSince(task, p), null);
  assertEquals(taskMovedSince({ ...(task as object), start_at: "2026-10-29T04:30:00.000Z" } as never, p), "its time");
  assertEquals(taskMovedSince({ ...(task as object), end_by: "2026-10-29T08:00:00.000Z" } as never, p), "its end time");
  assertEquals(taskMovedSince({ ...(task as object), employee_id: "e2" } as never, p), "its driver");
  assertEquals(taskMovedSince({ ...(task as object), vehicle_id: null } as never, p), "its vehicle");
  // An older proposal without the state (none exist before this round) is applied as before.
  assertEquals(taskMovedSince(task, { ...(p as object), task_state: undefined } as never), null);
});
