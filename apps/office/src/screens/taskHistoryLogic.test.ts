import { describe, expect, it } from "vitest";
import type { HistoryTask } from "../data/types";
import { emptyText, historyArgs, readFilters, routeText, statusOf, tagsOf, taskLink, totalsLine } from "./taskHistoryLogic";

const row = (over: Partial<HistoryTask> = {}): HistoryTask => ({
  id: "t1", date: "2026-10-16", time: "08:30", title: "Team drop · Kurunegala site", kind: "dispatch", purpose: "company", status: "completed", stops_count: 2, ...over,
});

describe("task history (§8)", () => {
  it("reads the filters from the URL and asks only for those chosen", () => {
    expect(readFilters(new URLSearchParams(""))).toEqual({ driver: "", vehicle: "", status: "", kind: "" });
    const f = readFilters(new URLSearchParams("driver=nuwan.p&vehicle=WP+CAB-4521&status=cancelled&kind=self"));
    expect(f).toEqual({ driver: "nuwan.p", vehicle: "WP CAB-4521", status: "cancelled", kind: "self" });
    expect(readFilters(new URLSearchParams("status=lost&kind=other"))).toEqual({ driver: "", vehicle: "", status: "", kind: "" });
    expect(historyArgs("2026-10-12", "2026-10-18", { driver: "", vehicle: "", status: "", kind: "" })).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(historyArgs("2026-10-12", "2026-10-18", f)).toEqual({ from: "2026-10-12", to: "2026-10-18", driver: "nuwan.p", vehicle: "WP CAB-4521", status: "cancelled", kind: "self" });
  });

  it("the totals in one line, the parts that are not zero", () => {
    expect(totalsLine({ count: 14, totals: { completed: 9, cancelled: 2, km: 184.5, driver_started: 3, personal: 1 } }))
      .toBe("14 tasks · 9 completed · 2 cancelled · 184.5 km · 3 driver-started · 1 personal");
    expect(totalsLine({ count: 1, totals: { completed: 0, cancelled: 0, km: 0, driver_started: 0, personal: 0 } })).toBe("1 task");
    expect(totalsLine({ count: 0, totals: { completed: 0, cancelled: 0, km: 0, driver_started: 0, personal: 0 } })).toBe("0 tasks");
  });

  it("tags a driver-started trip and a personal one", () => {
    expect(tagsOf(row())).toEqual([]);
    expect(tagsOf(row({ kind: "self" }))).toEqual([{ text: "Driver-started", tone: "live" }]);
    expect(tagsOf(row({ kind: "self", purpose: "personal" }))).toEqual([{ text: "Driver-started", tone: "live" }, { text: "Personal", tone: "warn" }]);
  });

  it("the route, the status line and the link to the task", () => {
    expect(routeText(row({ from: "Head office", to: "Kurunegala site" }))).toBe("Head office → Kurunegala site");
    expect(routeText(row({ from: "Head office", to: "Galle", stops_count: 4 }))).toBe("Head office → Galle · 4 stops");
    expect(routeText(row({ from: "Head office", stops_count: 1 }))).toBe("Head office");
    expect(routeText(row({ stops_count: 0 }))).toBe("—");
    expect(statusOf(row({ started: "2026-10-16 08:41", completed: "2026-10-16 11:02" }))).toEqual({ text: "Completed", tone: "ok", sub: "08:41–11:02" });
    expect(statusOf(row({ status: "in_progress", started: "2026-10-16 08:41" }))).toEqual({ text: "In progress", tone: "live", sub: "08:41–now" });
    expect(statusOf(row({ status: "cancelled", cancelled_reason: "Request cancelled: not needed" }))).toEqual({ text: "Cancelled", tone: "bad", sub: "Request cancelled: not needed" });
    expect(statusOf(row({ status: "assigned" }))).toEqual({ text: "Assigned", tone: "warn" });
    expect(taskLink(row(), "2026-10-18")).toBe("/tasks/t1?date=2026-10-16");
    expect(taskLink(row({ date: "2026-10-18" }), "2026-10-18")).toBe("/tasks/t1");
    expect(emptyText("2026-10-12", "2026-10-18", false)).toBe("No tasks (Mon 12 Oct – Sun 18 Oct 2026).");
    expect(emptyText("2026-10-18", "2026-10-18", true)).toBe("No task matches these filters (Sun 18 Oct 2026).");
  });
});
