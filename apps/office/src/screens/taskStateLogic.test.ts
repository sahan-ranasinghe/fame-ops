// One vocabulary for a task's state (docs/design-pass.md §3): every row of the table that a task has, its words and tone.
import { describe, expect, it } from "vitest";
import type { BoardCard } from "../data/types";
import { boardCardChips, finishFlagChip, lateChip, seenFromLine, taskChips, taskStateChip, waitingChip } from "./taskStateLogic";

describe("a task's state chip (§3)", () => {
  it("assigned, not opened: Sent, grey", () => {
    expect(taskStateChip({ status: "assigned" })).toEqual({ label: "Sent", tone: "" });
  });
  it("seen: Seen, grey; accepted: Accepted, blue (the chip says the latest)", () => {
    expect(taskStateChip({ status: "assigned", seen: true })).toEqual({ label: "Seen", tone: "" });
    expect(taskStateChip({ status: "assigned", accepted: "10:50" })).toEqual({ label: "Accepted", tone: "live" });
    expect(taskStateChip({ status: "assigned", seen: true, accepted: "10:50" })).toEqual({ label: "Accepted", tone: "live" });
  });
  it("in progress: On the way, blue (never In progress or Under way); at a stop: At the stop, blue", () => {
    expect(taskStateChip({ status: "in_progress" })).toEqual({ label: "On the way", tone: "live" });
    expect(taskStateChip({ status: "in_progress", at_stop: true })).toEqual({ label: "At the stop", tone: "live" });
  });
  it("late: a chip of its own beside the state, amber, with how late", () => {
    expect(lateChip(12)).toEqual({ label: "Late · 12 min", tone: "warn" });
    expect(lateChip(75)).toEqual({ label: "Late · 1 h 15 min", tone: "warn" });
    expect(lateChip(0)).toBeNull();
    expect(lateChip(undefined)).toBeNull();
    expect(taskChips({ status: "in_progress", late_min: 12 })).toEqual([{ label: "On the way", tone: "live" }, { label: "Late · 12 min", tone: "warn" }]);
    // Only while it runs: a done task is never late.
    expect(taskChips({ status: "completed", late_min: 12 })).toEqual([{ label: "Done", tone: "ok" }]);
  });
  it("completed: Done, green (never Completed)", () => {
    expect(taskStateChip({ status: "completed" })).toEqual({ label: "Done", tone: "ok" });
  });
  it("declined or not accepted in time: Needs a driver, red, before accepted or seen", () => {
    expect(taskStateChip({ status: "declined" })).toEqual({ label: "Needs a driver", tone: "bad" });
    expect(taskStateChip({ status: "assigned", seen: true, needs_driver: true })).toEqual({ label: "Needs a driver", tone: "bad" });
    // A task under way never needs a driver, whatever an older list said.
    expect(taskStateChip({ status: "in_progress", needs_driver: true })).toEqual({ label: "On the way", tone: "live" });
  });
  it("missed: Missed, red; cancelled: Cancelled, grey", () => {
    expect(taskStateChip({ status: "missed" })).toEqual({ label: "Missed", tone: "bad" });
    expect(taskStateChip({ status: "cancelled" })).toEqual({ label: "Cancelled", tone: "" });
  });
  it("a status it does not know reads Sent, never the server's word", () => {
    expect(taskStateChip({ status: "something_new" })).toEqual({ label: "Sent", tone: "" });
  });
  it("a finish flag: its name as an amber chip after the state, its reason on hover", () => {
    expect(finishFlagChip({ kind: "completed_early", text: "12 km of 60 planned" })).toEqual({ label: "Completed early", tone: "warn", title: "12 km of 60 planned" });
    expect(finishFlagChip({ kind: "odometer_short", text: "x" })?.label).toBe("Odometer short");
    expect(finishFlagChip(null)).toBeNull();
    expect(taskChips({ status: "completed", finish_flag: { kind: "completed_early", text: "t" } }).map((c) => c.label)).toEqual(["Done", "Completed early"]);
  });
});

describe("a board card's chips", () => {
  const card = (extra: Partial<BoardCard> = {}): BoardCard => ({ id: "t1", time: "09:00", title: "Team drop", ...extra });
  it("reads seen from the server's sentence only when it says so", () => {
    expect(seenFromLine("Seen by driver 10:42")).toBe(true);
    expect(seenFromLine("Sent · not opened yet")).toBe(false);
    expect(seenFromLine("Accepted 10:50")).toBe(false);
    expect(seenFromLine(undefined)).toBe(false);
  });
  it("the column is the status; the needs-a-driver list wins on an unaccepted card", () => {
    expect(boardCardChips("assigned", card({ status: "Sent · not opened yet" }), false)).toEqual([{ label: "Sent", tone: "" }]);
    expect(boardCardChips("assigned", card({ status: "Seen by driver 10:42" }), false)).toEqual([{ label: "Seen", tone: "" }]);
    expect(boardCardChips("assigned", card({ status: "Accepted 10:50", accepted: "10:50" }), false)).toEqual([{ label: "Accepted", tone: "live" }]);
    expect(boardCardChips("assigned", card({ status: "Seen by driver 10:42" }), true)).toEqual([{ label: "Needs a driver", tone: "bad" }]);
    expect(boardCardChips("in_progress", card({ status: "Started 07:06 · sharing location", late_min: 20 }), false).map((c) => c.label)).toEqual(["On the way", "Late · 20 min"]);
    expect(boardCardChips("completed", card({ status: "Done 07:55 · 62 km logged" }), false)).toEqual([{ label: "Done", tone: "ok" }]);
    expect(boardCardChips("declined", card({ status: "Declined (Vehicle problem)" }), false)).toEqual([{ label: "Needs a driver", tone: "bad" }]);
  });
});

describe("a proposed task waiting for an approver", () => {
  it("Waiting, amber; past its leave-by: Waiting · late, amber", () => {
    expect(waitingChip(false)).toEqual({ label: "Waiting", tone: "warn" });
    expect(waitingChip(true)).toEqual({ label: "Waiting · late", tone: "warn" });
  });
});
