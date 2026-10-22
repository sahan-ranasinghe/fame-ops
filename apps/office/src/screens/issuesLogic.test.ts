import { describe, expect, it } from "vitest";
import type { Issue, IssuesList } from "../data/types";
import {
  bellCount,
  bulkCalls,
  bulkDoneText,
  groupArgs,
  groupText,
  groupTick,
  kindIcon,
  rowMeta,
  rowTitle,
  showsGroups,
  tabOf,
  toggled,
  defaultSort,
  emptyText,
  eventText,
  filterOptions,
  issueFacts,
  issuesArgs,
  KIND_TEXT,
  kindText,
  listRows,
  mergeIssue,
  outsideNote,
  patchIssues,
  readSeverity,
  readSort,
  readStatus,
  severityTone,
  snoozeLine,
  whoLine,
} from "./issuesLogic";

const issue = (over: Partial<Issue>): Issue => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  kind: "document",
  severity: "warning",
  title: "Revenue licence expires",
  status: "open",
  opened: "2026-10-14 08:00",
  updated: "2026-10-14 08:00",
  ...over,
});

const list = (issues: Issue[], over: Partial<IssuesList> = {}): IssuesList => ({
  status: "open", from: "2026-10-01", to: "2026-10-31", sort: "newest", count: issues.length, open: 0, in_progress: 0, issues, ...over,
});

describe("the issues list's filters (§9, Hotfix 3)", () => {
  it("reads the status from the URL; the old tab= links still land; anything else is Active", () => {
    expect(readStatus(new URLSearchParams(""))).toBe("active");
    expect(readStatus(new URLSearchParams("status=dismissed"))).toBe("dismissed");
    expect(readStatus(new URLSearchParams("status=snoozed"))).toBe("snoozed");
    expect(readStatus(new URLSearchParams("status=all"))).toBe("all");
    expect(readStatus(new URLSearchParams("tab=resolved"))).toBe("resolved");
    expect(readStatus(new URLSearchParams("tab=in_progress"))).toBe("in_progress");
    expect(readStatus(new URLSearchParams("status=closed"))).toBe("active");
  });

  it("the order: the most urgent first for what is still to do, the newest first for the closed ones; ?sort= wins", () => {
    expect(["active", "open", "in_progress", "snoozed"].map((s) => defaultSort(s as never))).toEqual(["urgent", "urgent", "urgent", "urgent"]);
    expect(["resolved", "dismissed", "all"].map((s) => defaultSort(s as never))).toEqual(["newest", "newest", "newest"]);
    expect(readSort(new URLSearchParams(""), "active")).toBe("urgent");
    expect(readSort(new URLSearchParams("sort=newest"), "active")).toBe("newest");
    expect(readSort(new URLSearchParams("sort=oldest"), "resolved")).toBe("newest");
    expect(readSeverity(new URLSearchParams("severity=critical"))).toBe("critical");
    expect(readSeverity(new URLSearchParams("severity=loud"))).toBe("");
  });

  it("asks list_issues for the status, the opened days, the order and only the filters chosen; snoozed ones on their own tab", () => {
    const days = { from: "2026-10-01", to: "2026-10-31" };
    expect(issuesArgs({ status: "active", ...days, sort: "urgent" })).toEqual({ status: "active", ...days, sort: "urgent", snoozed: false });
    expect(issuesArgs({ status: "snoozed", ...days, sort: "urgent" })).toEqual({ status: "active", ...days, sort: "urgent", snoozed: true });
    expect(issuesArgs({ status: "resolved", ...days, sort: "newest", kind: "km_gap", vehicle: "WP CAB-4521", severity: "warning", search: "gap" }))
      .toEqual({ status: "resolved", ...days, sort: "newest", kind: "km_gap", vehicle: "WP CAB-4521", severity: "warning", search: "gap" });
    expect(issuesArgs({ status: "all", ...days, sort: "newest", kind: "", severity: "" })).toEqual({ status: "all", ...days, sort: "newest" });
  });

  it("narrows by status (a patched row leaves at once), kind and vehicle, in the server's order", () => {
    const rows = [
      issue({ id: "a", vehicle: "WP CAB-4521" }),
      issue({ id: "b", kind: "service_due", vehicle: "WP CAB-4521", status: "in_progress" }),
      issue({ id: "c", status: "resolved" }),
      issue({ id: "d", status: "dismissed" }),
      issue({ id: "e", kind: "declined", vehicle: "WP PH-2087" }),
    ];
    expect(listRows(rows, { status: "active" }).map((i) => i.id)).toEqual(["a", "b", "e"]);
    expect(listRows(rows, { status: "snoozed" }).map((i) => i.id)).toEqual(["a", "b", "e"]);
    expect(listRows(rows, { status: "open" }).map((i) => i.id)).toEqual(["a", "e"]);
    expect(listRows(rows, { status: "all" }).map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(listRows(rows, { status: "dismissed" }).map((i) => i.id)).toEqual(["d"]);
    expect(listRows(rows, { status: "open", kind: "declined" }).map((i) => i.id)).toEqual(["e"]);
    expect(listRows(rows, { status: "all", vehicle: "WP CAB-4521" }).map((i) => i.id)).toEqual(["a", "b"]);
    // Every kind the centre knows, by name; the vehicles on screen when the fleet's are not known.
    const o = filterOptions(rows);
    expect(o.kinds.length).toBe(Object.keys(KIND_TEXT).length);
    expect(o.kinds.find(([k]) => k === "km_gap")).toEqual(["km_gap", "Km outside tasks"]);
    expect(o.vehicles).toEqual(["WP CAB-4521", "WP PH-2087"]);
    // The fleet's vehicles when known; a kind or vehicle chosen that nothing has stays in its select.
    expect(filterOptions(rows, {}, ["WP KL-1234", "WP CAB-4521"]).vehicles).toEqual(["WP CAB-4521", "WP KL-1234"]);
    const chosen = filterOptions([], { kind: "a_future_kind", vehicle: "WP XX-0001" });
    expect(chosen.kinds.find(([k]) => k === "a_future_kind")).toEqual(["a_future_kind", "a_future_kind"]);
    expect(filterOptions([]).kinds.find(([k]) => k === "missed_task")).toEqual(["missed_task", "Missed task"]);
    expect(chosen.vehicles).toEqual(["WP XX-0001"]);
  });

  it("says how many active issues were opened outside the days (from the list's total)", () => {
    const rows = [issue({ id: "a" }), issue({ id: "b", status: "in_progress" })];
    expect(outsideNote(list(rows, { open: 4, in_progress: 1, count: 1 }), "open")).toBe("3 more open issues were opened outside these dates.");
    expect(outsideNote(list(rows, { open: 1, in_progress: 2, count: 1 }), "in_progress")).toBe("1 more in progress issue was opened outside these dates.");
    // A paged answer: its total, not the page's rows.
    expect(outsideNote(list(rows, { open: 30, in_progress: 2, count: 25, total: 30 }), "active")).toBe("2 more active issues were opened outside these dates.");
    expect(outsideNote(list(rows, { open: 1, in_progress: 1 }), "active")).toBeUndefined();
    expect(outsideNote(list(rows, { open: 9 }), "resolved")).toBeUndefined();
    expect(outsideNote(list(rows, { open: 9 }), "all")).toBeUndefined();
    // Narrowed by kind, vehicle or severity: the counts do not compare.
    expect(outsideNote(list(rows, { open: 9 }), "open", true)).toBeUndefined();
  });

  it("says nothing was found in words that fit; a snoozed row says until when", () => {
    expect(emptyText("active", "2026-10-01", "2026-10-31", false)).toBe("Nothing needs attention (Thu 1 Oct – Sat 31 Oct 2026). The fleet is in order.");
    expect(emptyText("open", "2026-10-01", "2026-10-31", false)).toBe("Nothing open (Thu 1 Oct – Sat 31 Oct 2026). The fleet is in order.");
    expect(emptyText("snoozed", "2026-10-18", "2026-10-18", false)).toBe("Nothing is snoozed (Sun 18 Oct 2026).");
    expect(emptyText("dismissed", "2026-10-18", "2026-10-18", false)).toBe("Nothing dismissed (Sun 18 Oct 2026).");
    expect(emptyText("all", "2026-10-12", "2026-10-18", true)).toBe("No issue matches the filters chosen (Mon 12 Oct – Sun 18 Oct 2026).");
    expect(emptyText("active", "2026-10-18", "2026-10-18", false, "CAB")).toBe('No issue matches "CAB" (Sun 18 Oct 2026).');
    expect(snoozeLine(issue({ snoozed_until: "2026-10-19 07:00", snoozed_by: "Sahan" }))).toBe("Snoozed until 2026-10-19 07:00 · by Sahan");
    expect(snoozeLine(issue({}))).toBeUndefined();
  });
});

describe("what each issue shows (§9)", () => {
  it("opened, opened by, taken by, and resolved or dismissed at and by", () => {
    const open = issue({ opened_by: "System · Vehicle problem" });
    expect(issueFacts(open)).toEqual([["Opened", "2026-10-14 08:00"], ["Opened by", "System · Vehicle problem"], ["Taken by", "Nobody yet"]]);
    const taken = issue({ status: "in_progress", opened_by: "Sahan", taken_by: { name: "Charuka W.", at: "2026-10-14 09:10" }, assigned_to: { name: "Charuka W." } });
    expect(issueFacts(taken)[2]).toEqual(["Taken by", "Charuka W. · 2026-10-14 09:10"]);
    const resolved = issue({ status: "resolved", resolved_at: "2026-10-14 11:00", resolved: "2026-10-14 11:00", resolved_by: "Charuka W." });
    expect(issueFacts(resolved)[3]).toEqual(["Resolved", "2026-10-14 11:00 by Charuka W."]);
    const dismissed = issue({ status: "dismissed", resolved_at: "2026-10-14 11:05", resolved_by: "Sahan" });
    expect(issueFacts(dismissed)[3]).toEqual(["Dismissed", "2026-10-14 11:05 by Sahan"]);
    // An issue from before Phase 7's fields: who it is assigned to, "System" as the opener.
    expect(issueFacts(issue({ assigned_to: { name: "Nimal" } }))).toEqual([["Opened", "2026-10-14 08:00"], ["Opened by", "System"], ["Taken by", "Nimal"]]);
  });

  it("the list row's second line", () => {
    expect(whoLine(issue({ opened_by: "System · Service" }))).toBe("Opened 2026-10-14 08:00 · System · Service");
    expect(whoLine(issue({ status: "in_progress", opened_by: "System · Service", taken_by: { name: "Sahan", at: "2026-10-14 09:10" } })))
      .toBe("Opened 2026-10-14 08:00 · System · Service · taken by Sahan 09:10");
    expect(whoLine(issue({ status: "dismissed", resolved_at: "2026-10-15 10:00" }))).toBe("Opened 2026-10-14 08:00 · dismissed 2026-10-15 10:00");
  });
});

describe("the in-place patch after Take, Resolve or Dismiss (§9)", () => {
  const before = issue({ id: "x", opened_by: "System · Vehicle problem", vehicle: "WP CAB-4521" });

  it("keeps who opened it, names the taker, and drops fields the fresh card no longer has", () => {
    const fresh = issue({ id: "x", status: "in_progress", assigned_to: { name: "Sahan" }, vehicle: "WP CAB-4521" });
    expect(mergeIssue(before, fresh, "2026-10-18 10:05")).toEqual({ ...fresh, opened_by: "System · Vehicle problem", taken_by: { name: "Sahan", at: "2026-10-18 10:05" } });
    // The same taker keeps the server's time.
    const taken = { ...before, taken_by: { name: "Sahan", at: "2026-10-18 10:01" } };
    expect(mergeIssue(taken, fresh, "2026-10-18 10:05").taken_by).toEqual({ name: "Sahan", at: "2026-10-18 10:01" });
    // Reopened: the resolution goes (the tool's answer leaves the fields out).
    const closed = { ...before, status: "resolved", resolved: "2026-10-18 11:00", resolved_at: "2026-10-18 11:00", resolved_by: "Sahan", resolution_note: "Fixed" };
    const reopened = mergeIssue(closed, issue({ id: "x", status: "open", vehicle: "WP CAB-4521" }));
    expect(reopened.resolved_at).toBeUndefined();
    expect(reopened.resolution_note).toBeUndefined();
    expect("resolved_by" in reopened).toBe(false);
  });

  it("replaces the row in the page's list and moves the counts; the bell drops a closed one", () => {
    const other = issue({ id: "y" });
    const page = list([before, other], { status: "all", open: 2, in_progress: 0 });
    const fresh = issue({ id: "x", status: "resolved", resolved_at: "2026-10-18 11:00", resolved_by: "Sahan" });
    const after = patchIssues(page, fresh, "open");
    expect(after.issues.map((i) => [i.id, i.status])).toEqual([["x", "resolved"], ["y", "open"]]);
    expect(after.issues[0].opened_by).toBe("System · Vehicle problem");
    expect(after.issues[1]).toBe(other); // the untouched row keeps its object
    expect([after.open, after.in_progress, after.count]).toEqual([1, 0, 2]);

    const bell = list([before, other], { status: "active", open: 5, in_progress: 1 });
    const rung = patchIssues(bell, fresh, "open", { activeOnly: true });
    expect(rung.issues.map((i) => i.id)).toEqual(["y"]);
    expect([rung.open, rung.in_progress, rung.count]).toEqual([4, 1, 1]);
    expect(bellCount(rung)).toBe(5);

    // Take: open → in progress.
    const took = patchIssues(bell, issue({ id: "x", status: "in_progress", assigned_to: { name: "Sahan" } }), "open", { activeOnly: true, takenAt: "2026-10-18 10:05" });
    expect([took.open, took.in_progress]).toEqual([4, 2]);
    expect(took.issues[0].taken_by).toEqual({ name: "Sahan", at: "2026-10-18 10:05" });
    // Round 4–7 (item 8): the badge's needs_action drops when a warning or critical one closes; an info one never counted.
    const counted = list([before, other], { status: "active", open: 5, in_progress: 1, needs_action: 4, critical: 1 });
    const closedCrit = patchIssues(counted, { ...fresh, severity: "critical" }, "open", { activeOnly: true });
    expect([closedCrit.needs_action, closedCrit.critical, bellCount(closedCrit)]).toEqual([3, 0, 3]);
    expect(patchIssues(counted, { ...fresh, severity: "info" }, "open", { activeOnly: true }).needs_action).toBe(4);
    expect(patchIssues(counted, issue({ id: "x", status: "open", severity: "warning" }), "resolved").needs_action).toBe(5);
    // An issue not in the list still moves the counts (the bell lists only ten).
    expect(patchIssues(list([], { open: 3 }), fresh, "open").open).toBe(2);
  });
});

describe("words", () => {
  it("counts the bell and names kinds", () => {
    expect(bellCount({ open: 3, in_progress: 2 })).toBe(5);
    expect(bellCount(undefined)).toBe(0);
    // Round 4–7 (item 8): the badge counts what needs action (critical and warning), not everything open.
    expect(bellCount({ open: 24, in_progress: 0, needs_action: 4 })).toBe(4);
    expect(bellCount({ open: 24, in_progress: 0, needs_action: 0 })).toBe(0);
    expect(kindText({ kind: "km_gap" })).toBe("Km outside tasks");
    expect(kindText({ kind: "something_new" })).toBe("something_new");
    expect(kindText({ kind: "vehicle_conflict" })).toBe("Vehicle taken");
    expect(kindText({ kind: "app_stopped" })).toBe("App stopped");
    expect(kindText({ kind: "arrival_override" })).toBe("Arrived away from the stop");
    expect(kindText({ kind: "completed_early" })).toBe("Completed early");
    expect(kindText({ kind: "x", kind_text: "From the server" })).toBe("From the server");
    expect(severityTone("critical")).toBe("bad");
    expect(severityTone("info")).toBe("");
  });

  it("describes events", () => {
    expect(eventText({ action: "opened", actor: "system" })).toBe("Opened by system");
    expect(eventText({ action: "assigned", actor: "Charuka W.", note: "Sahan R." })).toBe("Charuka W. assigned it to Sahan R.");
    expect(eventText({ action: "status", actor: "Charuka W.", from: "open", to: "in_progress" })).toBe("Charuka W. set it from open to in progress");
    expect(eventText({ action: "status", actor: "Charuka W.", from: "in_progress", to: "resolved", note: "Fixed" })).toBe("Charuka W. set it from in progress to resolved · Fixed");
    expect(eventText({ action: "auto_resolved", actor: "system" })).toBe("Resolved by itself: the condition cleared");
  });
});

describe("the tabs and the groups (Round 4–7, item 8)", () => {
  it("three tabs over the statuses: Open (active, open, in progress), Snoozed, Resolved (resolved, dismissed, all)", () => {
    expect(["active", "open", "in_progress", "snoozed", "resolved", "dismissed", "all"].map((s) => tabOf(s as never)))
      .toEqual(["open", "open", "open", "snoozed", "resolved", "resolved", "resolved"]);
  });

  it("the Open tab shows groups until a kind is chosen or words are searched for; the groups ask with group: true and no order", () => {
    const days = { from: "2026-10-01", to: "2026-10-31" };
    expect(showsGroups({ status: "active" })).toBe(true);
    expect(showsGroups({ status: "in_progress" })).toBe(true);
    expect(showsGroups({ status: "active", kind: "missed_task" })).toBe(false);
    expect(showsGroups({ status: "active", search: "CAB" })).toBe(false);
    expect(showsGroups({ status: "snoozed" })).toBe(false);
    expect(showsGroups({ status: "resolved" })).toBe(false);
    expect(groupArgs({ status: "active", ...days, sort: "urgent", severity: "critical" })).toEqual({ status: "active", ...days, snoozed: false, severity: "critical", group: true });
    expect(groupText({ kind: "missed_task", kind_text: "Missed task" })).toBe("Missed tasks");
    expect(groupText({ kind: "brand_new", kind_text: "Brand new" })).toBe("Brand new");
  });
});

describe("Gmail's rows (Round 4–7, item 8)", () => {
  it("one title (the server's headline, never the kind again) and one grey line (plate · driver · when)", () => {
    const i = issue({ kind: "missed_task", title: "Missed task: Trip · Head office", headline: "Test Driver missed 'Trip · Head office'", meta: "CAP-2207 · Test Driver · 2 h ago", vehicle: "CAP-2207", driver: "Test Driver" });
    expect(rowTitle(i)).toBe("Test Driver missed 'Trip · Head office'");
    expect(rowMeta(i)).toBe("CAP-2207 · Test Driver · 2 h ago");
    expect(rowTitle(i)).not.toMatch(/^Missed task/);
    expect(rowMeta(i)).not.toMatch(/System|Missed task/);
    // An older server: the title, and the grey line made from the card.
    const old = issue({ title: "Revenue licence expires", vehicle: "WP CAB-4521", driver: "Kamal", due: "in 5 days" });
    expect(rowTitle(old)).toBe("Revenue licence expires");
    expect(rowMeta(old)).toBe("WP CAB-4521 · Kamal · in 5 days");
    expect(rowMeta(issue({}))).toBe("2026-10-14 08:00");
  });

  it("an icon per kind (a kind the page does not know: the alert)", () => {
    expect(kindIcon("missed_task")).toBe("calendar");
    expect(kindIcon("odometer_flag")).toBe("gauge");
    expect(kindIcon("service_due")).toBe("wrench");
    expect(kindIcon("brand_new")).toBe("alert");
    for (const k of Object.keys(KIND_TEXT)) expect(kindIcon(k)).not.toBe("");
  });
});

describe("bulk Resolve / Dismiss (update_issues, Gmail's bulk)", () => {
  it("one reason, required; the ids once each, 100 a call", () => {
    expect(bulkCalls(["a", "b", "a"], "resolved", "  Test data ")).toEqual([{ ids: ["a", "b"], status: "resolved", note: "Test data" }]);
    expect(bulkCalls(["a"], "dismissed", "   ")).toEqual([]);
    expect(bulkCalls([], "dismissed", "Test data")).toEqual([]);
    const many = Array.from({ length: 230 }, (_, n) => `i${n}`);
    const calls = bulkCalls(many, "dismissed", "Test data");
    expect(calls.map((c) => c.ids.length)).toEqual([100, 100, 30]);
    expect(calls.every((c) => c.status === "dismissed" && c.note === "Test data")).toBe(true);
    expect(bulkDoneText(3, "resolved")).toBe("3 issues resolved");
    expect(bulkDoneText(1, "dismissed")).toBe("1 issue dismissed");
  });

  it("the ticks: a row, a group's rows, and the group's state", () => {
    const one = toggled(new Set(), ["a"], true);
    expect([...one]).toEqual(["a"]);
    const group = toggled(one, ["a", "b", "c"], true);
    expect([...group].sort()).toEqual(["a", "b", "c"]);
    expect([...toggled(group, ["b"], false)].sort()).toEqual(["a", "c"]);
    expect(groupTick(group, ["a", "b", "c"])).toBe("on");
    expect(groupTick(one, ["a", "b", "c"])).toBe("mixed");
    expect(groupTick(new Set(), ["a", "b"])).toBe("off");
  });
});
