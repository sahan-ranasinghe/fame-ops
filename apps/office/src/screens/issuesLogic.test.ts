import { describe, expect, it } from "vitest";
import type { Issue } from "../data/types";
import { bellCount, eventText, filterIssues, filterOptions, kindText, severityTone, tabCounts, tabOf } from "./issuesLogic";

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

describe("issues centre rules", () => {
  it("puts resolved and dismissed on one tab", () => {
    expect(tabOf("open")).toBe("open");
    expect(tabOf("in_progress")).toBe("in_progress");
    expect(tabOf("resolved")).toBe("resolved");
    expect(tabOf("dismissed")).toBe("resolved");
  });

  it("filters by tab, kind and vehicle, closed ones newest first", () => {
    const rows = [
      issue({ id: "a", vehicle: "WP CAB-4521" }),
      issue({ id: "b", kind: "service_due", vehicle: "WP CAB-4521", status: "in_progress" }),
      issue({ id: "c", status: "resolved", resolved: "2026-10-13 10:00" }),
      issue({ id: "d", status: "dismissed", resolved: "2026-10-14 09:00" }),
      issue({ id: "e", kind: "declined", vehicle: "WP PH-2087" }),
    ];
    expect(filterIssues(rows, { tab: "open" }).map((i) => i.id)).toEqual(["a", "e"]);
    expect(filterIssues(rows, { tab: "open", kind: "declined" }).map((i) => i.id)).toEqual(["e"]);
    expect(filterIssues(rows, { tab: "open", vehicle: "WP CAB-4521" }).map((i) => i.id)).toEqual(["a"]);
    expect(filterIssues(rows, { tab: "in_progress" }).map((i) => i.id)).toEqual(["b"]);
    expect(filterIssues(rows, { tab: "resolved" }).map((i) => i.id)).toEqual(["d", "c"]);
    expect(tabCounts(rows)).toEqual({ open: 2, in_progress: 1, resolved: 2 });
    expect(filterOptions(rows)).toEqual({
      kinds: [["declined", "Declined"], ["service_due", "Service"], ["document", "Vehicle document"]],
      vehicles: ["WP CAB-4521", "WP PH-2087"],
    });
  });

  it("counts the bell and names kinds", () => {
    expect(bellCount({ open: 3, in_progress: 2 })).toBe(5);
    expect(bellCount(undefined)).toBe(0);
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
