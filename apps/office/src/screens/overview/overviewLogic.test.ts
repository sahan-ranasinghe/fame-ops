import { describe, expect, it } from "vitest";
import type { Attention, AttentionGroup, Overview } from "../../data/types";
import { attentionOf, criticalOf, groupRow, inLines, myTripsArgs, overviewSections, requestsLine, rowsFor, tripRow, viewAll, withoutIssues } from "./overviewLogic";

const me = (permissions: string[], tools: string[] = ["my_trips"]) => ({ permissions: permissions as never, tools });
const a = (id: string, extra: Partial<Attention> = {}): Attention => ({ what: `Item ${id}`, issue_id: id, severity: "warning", kind: "odometer_flag", ...extra });
const group = (key: string, ids: string[], extra: Partial<AttentionGroup> = {}): AttentionGroup => ({
  key, kind: key, title: `${key} · ${ids.length}`, count: ids.length, severity: "warning", issue_ids: ids, items: ids.map((id) => a(id, { kind: key })), ...extra,
});
const base: Overview = {
  date: "2026-10-18",
  vehicles: { on_the_road: 0, total: 0, parked: 0 },
  tasks: { total: 0, in_progress: 0, done: 0 },
  requests: { waiting: 0 },
  reminders: { count: 4 },
  on_the_road: [],
  needs_attention: [a("o1"), a("o2"), a("l1", { kind: "late_start" }), a("c1", { severity: "critical" })],
};

describe("the sections by role", () => {
  it("action first: approver, dispatcher, requester, viewer", () => {
    expect(overviewSections(me(["view", "request", "approve", "assign_tasks", "vehicles", "issues"]))).toEqual(["requests", "needs_driver", "critical", "tiles", "road", "attention"]);
    expect(overviewSections(me(["view", "request", "assign_tasks"]))).toEqual(["needs_driver", "critical", "tiles", "road", "attention"]);
    expect(overviewSections(me(["view", "request"]))).toEqual(["my_trips", "tiles"]);
    expect(overviewSections(me(["view"]))).toEqual(["tiles", "road"]);
  });
  it("mixed: an approver without issues has no issue sections; a requester without the my_trips tool gets the viewer's", () => {
    expect(overviewSections(me(["view", "approve"]))).toEqual(["requests", "needs_driver", "tiles", "road"]);
    expect(overviewSections(me(["view", "request"], []))).toEqual(["tiles", "road"]);
    expect(overviewSections(me(["view", "issues"]))).toEqual(["critical", "tiles", "road", "attention"]);
  });
  it("lines on a desktop: pairs, a wide one alone, an odd one out alone", () => {
    expect(inLines(["requests", "needs_driver", "critical", "tiles", "road", "attention"])).toEqual([["requests", "needs_driver"], ["critical"], ["tiles"], ["road", "attention"]]);
    expect(inLines(["requests", "tiles", "road", "attention"])).toEqual([["requests"], ["tiles"], ["road", "attention"]]);
    expect(inLines(["my_trips", "tiles"])).toEqual([["my_trips"], ["tiles"]]);
    expect(inLines(["tiles", "road"])).toEqual([["tiles"], ["road"]]);
  });
  it("5 rows on a desktop, 3 on a phone; View all with the count", () => {
    expect(rowsFor(false)).toBe(5);
    expect(rowsFor(true)).toBe(3);
    expect(viewAll(12)).toBe("View all (12)");
    expect(viewAll(undefined)).toBe("View all");
  });
});

describe("the requests line (the bug '1 open · Nothing waiting')", () => {
  it("Nothing waiting only when nothing waits; the oldest when known; else waiting for a decision", () => {
    expect(requestsLine({ waiting: 0 })).toBe("Nothing waiting");
    expect(requestsLine(undefined)).toBe("Nothing waiting");
    expect(requestsLine({ waiting: 1, oldest_waiting: "5 h 11 min" })).toBe("Oldest waiting 5 h 11 min");
    expect(requestsLine({ waiting: 1 })).toBe("Waiting for a decision");
  });
});

describe("Needs attention and Critical issues", () => {
  it("the server's groups; one issue stays a plain row to its page", () => {
    const o: Overview = { ...base, attention: { count: 3, groups: [group("odometer_flag", ["o1", "o2"]), group("late_start", ["l1"], { title: "Late start · Team drop" })] } };
    const { count, rows } = attentionOf(o);
    expect(count).toBe(3);
    expect(rows.map((r) => [r.title, r.count, r.ids, r.to])).toEqual([
      ["odometer_flag · 2", 2, ["o1", "o2"], undefined],
      ["Late start · Team drop", 1, ["l1"], "/issues/l1"],
    ]);
    expect(groupRow(group("km_gap", ["k1", "k2"], { issue_ids: [] })).ids).toEqual(["k1", "k2"]);
  });
  it("an older answer: warnings without the kinds of the other sections, criticals apart", () => {
    const o: Overview = { ...base, needs_attention: [...base.needs_attention, a("q1", { kind: "request_waiting" }), a("i1", { severity: "info" })] };
    expect(attentionOf(o).rows.map((r) => r.ids[0])).toEqual(["o1", "o2", "l1"]);
    expect(criticalOf(o).items.map((x) => x.issue_id)).toEqual(["c1"]);
    expect(criticalOf({ ...o, critical: { count: 7, items: [a("z")] } })).toEqual({ count: 7, items: [a("z")] });
  });
  it("after Snooze or Dismiss: the issues leave the groups, the criticals and the reminders; the counts drop", () => {
    const o: Overview = {
      ...base,
      attention: { count: 3, groups: [group("odometer_flag", ["o1", "o2"]), group("late_start", ["l1"])] },
      critical: { count: 2, items: [a("c1", { severity: "critical" }), a("c2", { severity: "critical" })] },
    };
    const one = withoutIssues(o, ["o1"]);
    // One issue left in the group: its own words.
    expect(one.attention).toEqual({ count: 2, groups: [{ ...group("odometer_flag", ["o2"]), title: "Item o2" }, group("late_start", ["l1"])] });
    const all = withoutIssues(o, ["o1", "o2", "l1", "c1"]);
    expect(all.attention).toEqual({ count: 0, groups: [] });
    expect(all.critical).toEqual({ count: 1, items: [a("c2", { severity: "critical" })] });
    expect(all.needs_attention.map((x) => x.issue_id)).toEqual([]);
    expect(all.reminders.count).toBe(0);
    expect(o.attention?.count).toBe(3); // the old answer untouched
    expect(withoutIssues(o, [])).toBe(o);
  });
});

describe("My trips on the Overview", () => {
  it("30 days back and forward, the limit asked", () => {
    expect(myTripsArgs("2026-10-18", 5)).toEqual({ from: "2026-09-18", to: "2026-11-17", include: "all", limit: 5 });
  });
  it("a request opens under My trips, a task the person created opens the task; the live state from the server or the status", () => {
    expect(tripRow({ id: "r1", requested_by: "Me", when: "Mon 19 Oct 08:00", route: "Head office → Galle", status: "approved", need: "Car" })).toEqual({
      key: "r1", to: "/my-trips/r1", title: "Head office → Galle", sub: "Mon 19 Oct 08:00 · Car", live: { state: "approved", text: "Approved" },
    });
    expect(tripRow({ source: "task", id: "t1", task_id: "t1", title: "Site visit", when: "Tue 20 Oct 09:00", status: "assigned", live: { state: "approved", text: "Assigned" }, created: "2026-10-18 10:00" }).to).toBe("/tasks/t1");
    expect(tripRow({ id: "r2", kind: "task", title: "Team drop", requested_by: "Me", when: "Wed", status: "waiting" }).title).toBe("Team drop");
  });
});
