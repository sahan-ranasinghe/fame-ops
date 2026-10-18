// Phase 7 (§16): where the Overview's tiles go, the list screens' filters in the URL, and the reminders the tile counts.
import { describe, expect, it } from "vitest";
import type { Attention } from "../data/types";
import type { Me } from "../transport/types";
import {
  canOpen,
  filterFromWord,
  FULL_PATH,
  LIVE_FILTER_WORDS,
  openFrom,
  OVERVIEW_OPENS,
  reminderGroups,
  tileTarget,
  VEHICLE_FILTER_WORDS,
  withParam,
} from "./overviewLinks";

const admin: Pick<Me, "permissions" | "tools"> = {
  permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"],
  tools: ["fleet_overview", "live_drivers", "list_vehicles", "task_board", "list_requests", "list_issues"],
};
const viewer: Pick<Me, "permissions" | "tools"> = { permissions: ["view"], tools: ["fleet_overview", "live_drivers", "list_vehicles"] };
const dispatcher: Pick<Me, "permissions" | "tools"> = { permissions: ["view", "assign_tasks"], tools: ["fleet_overview", "live_drivers", "list_vehicles", "task_board"] };

describe("the Overview's tiles", () => {
  it("open the side panel on a desktop and the full page on a phone", () => {
    expect(tileTarget("road", false)).toBe("/?open=road");
    expect(OVERVIEW_OPENS.map((k) => tileTarget(k, true))).toEqual([
      "/live?filter=road", "/vehicles?filter=free", "/vehicles?filter=garage", "/tasks", "/requests", "/reminders",
    ]);
    expect(FULL_PATH.reminders).toBe("/reminders");
  });

  it("link only where the person has the list: tasks need assign_tasks, requests approve, reminders issues or assign_tasks", () => {
    expect(OVERVIEW_OPENS.filter((k) => canOpen(admin, k))).toEqual([...OVERVIEW_OPENS]);
    expect(OVERVIEW_OPENS.filter((k) => canOpen(viewer, k))).toEqual(["road", "free", "garage"]);
    expect(OVERVIEW_OPENS.filter((k) => canOpen(dispatcher, k))).toEqual(["road", "free", "garage", "tasks", "reminders"]);
    // The permission without the tool (an older key): no link.
    expect(canOpen({ permissions: ["view"], tools: ["fleet_overview"] }, "free")).toBe(false);
  });

  it("the URL's open is read only when it is one of the six and the person may open it", () => {
    expect(openFrom(new URLSearchParams("open=garage"), viewer)).toBe("garage");
    expect(openFrom(new URLSearchParams("open=requests"), viewer)).toBeNull();
    expect(openFrom(new URLSearchParams("open=everything"), admin)).toBeNull();
    expect(openFrom(new URLSearchParams(""), admin)).toBeNull();
  });
});

describe("the list screens' filters in the URL", () => {
  it("Live: road is the chip On a task; the chip's own key and the other words work too; anything else is All", () => {
    expect(filterFromWord(LIVE_FILTER_WORDS, "road", "all")).toBe("on_task");
    expect(filterFromWord(LIVE_FILTER_WORDS, "on_task", "all")).toBe("on_task");
    expect(filterFromWord(LIVE_FILTER_WORDS, "problems", "all")).toBe("problems");
    expect(filterFromWord(LIVE_FILTER_WORDS, "nonsense", "all")).toBe("all");
    expect(filterFromWord(LIVE_FILTER_WORDS, null, "all")).toBe("all");
    expect(LIVE_FILTER_WORDS.all).toBeNull();
  });

  it("Vehicles: free is Available, garage In garage", () => {
    expect(filterFromWord(VEHICLE_FILTER_WORDS, "free", "all")).toBe("available");
    expect(filterFromWord(VEHICLE_FILTER_WORDS, "garage", "all")).toBe("in_garage");
    expect(filterFromWord(VEHICLE_FILTER_WORDS, "available", "all")).toBe("available");
    expect(filterFromWord(VEHICLE_FILTER_WORDS, "returned", "all")).toBe("inactive");
  });

  it("a changed filter keeps every other parameter; All removes it; the old object is not touched", () => {
    const p = new URLSearchParams("filter=free&date=2026-10-18");
    const next = withParam(p, "filter", "garage");
    expect(next.toString()).toBe("filter=garage&date=2026-10-18");
    expect(withParam(next, "filter", null).toString()).toBe("date=2026-10-18");
    expect(p.toString()).toBe("filter=free&date=2026-10-18");
  });
});

describe("the reminders", () => {
  const items: Attention[] = [
    { what: "Service overdue", subject: "WP CAB-4521 · 1,200 km over", due: "now", level: "red", kind: "service_due", issue_id: "i1" },
    { what: "Late start", subject: "Team drop · Kamal", due: "leave by 09:00 · 20 min ago", level: "red", kind: "late_start", issue_id: "i2" },
    { what: "Revenue licence expires", subject: "WP KL-1234 · Toyota HiAce", due: "in 4 days", level: "amber", kind: "document", issue_id: "i3" },
    { what: "Driver licence expires", subject: "Sunil Fernando", due: "Fri 30 Oct", level: "amber", kind: "licence", issue_id: "i4" },
    { what: "Insurance expires", subject: "PH-0001", due: "in 9 days", level: "amber", kind: "document", issue_id: "i5" },
  ];

  it("documents and services first, in the server's order, each with its plate and the vehicle's page", () => {
    const g = reminderGroups(items);
    expect(g.due.map((r) => [r.what, r.plate, r.subject, r.due, r.to])).toEqual([
      ["Service overdue", "WP CAB-4521", "1,200 km over", "now", "/vehicles/WP%20CAB-4521"],
      ["Revenue licence expires", "WP KL-1234", "Toyota HiAce", "in 4 days", "/vehicles/WP%20KL-1234"],
      ["Driver licence expires", undefined, "Sunil Fernando", "Fri 30 Oct", "/issues/i4"],
      ["Insurance expires", "PH-0001", undefined, "in 9 days", "/vehicles/PH-0001"],
    ]);
  });

  it("everything else the tile counts opens its issue; nothing is lost", () => {
    const g = reminderGroups(items);
    expect(g.other.map((r) => [r.what, r.to])).toEqual([["Late start", "/issues/i2"]]);
    expect(g.due.length + g.other.length).toBe(items.length);
    // An older answer without kinds: every row is kept, to its issue when it has one.
    expect(reminderGroups([{ what: "Something", subject: "x" }]).other).toEqual([{ what: "Something", subject: "x", key: "0", due: undefined, level: undefined, plate: undefined, to: undefined }]);
    expect(reminderGroups(undefined)).toEqual({ due: [], other: [] });
  });
});
