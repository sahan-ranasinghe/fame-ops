import { describe, expect, it } from "vitest";
import type { PlanPreview } from "../data/types";
import { dwellFallbacks, legText, planLine, planReasons, rowStopNumbers, shiftLabel, stopTimes } from "./planLogic";
import { newStop, type StopDraft } from "./stopsLogic";

const stop = (place: string, arriveBy = ""): StopDraft => ({ ...newStop("drop"), place, arriveBy });
const preview: PlanPreview = {
  date: "2026-10-15", leave_by: "2026-10-15 07:10", leave_by_source: "plan",
  start: { name: "Head office, Colombo 05", has_pin: true },
  stops: [
    { seq: 1, type: "drop", place: "Kalutara", planned_arrive: "07:35", planned_depart: "07:45", arrive_by: "08:00", pin: "yes" },
    { seq: 2, type: "drop", place: "Galle", planned_arrive: "08:40", planned_depart: "08:50", pin: "yes" },
    { seq: 3, type: "drop", place: "Matara", planned_arrive: "09:45", planned_depart: "09:45", pin: "yes" },
  ],
  plan: { source: "ors", source_label: "road time · OpenRouteService", total_drive_min: 155, total_km: 162, legs: [], warnings: [] },
  warnings: [],
};

describe("the plan in one line", () => {
  it("names the leave-by time, every stop with its planned time, the drive time and the source", () => {
    expect(planLine(preview)).toBe("Leave by 07:10 · Kalutara 07:35 · Galle 08:40 · Matara 09:45 · 2 h 35 min driving · road time OpenRouteService");
  });
  it("says 'estimated times' for the estimate provider and nothing without a leave-by", () => {
    const est = { ...preview, plan: { ...preview.plan!, source: "estimate", source_label: undefined } };
    expect(planLine(est)).toContain("estimated times");
    expect(planLine(null)).toBeNull();
    expect(planLine({ ...preview, leave_by: "" })).toBeNull();
  });
});

describe("why there is no plan", () => {
  const f = { date: "2026-10-15", stops: [stop("Kalutara", "08:00"), stop("Galle")], leaveBy: "", start: "", returnToBase: false };
  it("asks for the missing pieces of the form first, in words that say what to do", () => {
    expect(planReasons({ ...f, date: "" }, null, null).map((r) => r.text)).toEqual(["Add a date."]);
    expect(planReasons({ ...f, stops: [newStop("pickup")] }, null, null).map((r) => r.text)).toEqual(["Add at least one stop with a place.", "Add a leave-by time, or an arrive-by time on a stop, so it can be planned."]);
    expect(planReasons({ ...f, stops: [stop("Galle")] }, null, null).map((r) => r.text)).toEqual(["Add a leave-by time, or an arrive-by time on a stop, so it can be planned."]);
  });
  it("names the stop without a pin and the missing base place in the office's words", () => {
    const p = { ...preview, start: { name: "", has_pin: false }, stops: [{ ...preview.stops[0] }, { ...preview.stops[1], pin: "none" }], warnings: ["No base place set — add it in Settings", "Galle: no coordinates found, the leg counts as 0 km"] };
    expect(planReasons({ ...f, returnToBase: true }, p, null).map((r) => r.text)).toEqual(["Galle has no pin — add one.", "No base place set — pick it in Settings → Fleet."]);
  });
  it("passes the server's other warnings through and notes the estimate", () => {
    const p = { ...preview, warnings: ["Arrive by 08:00 cannot be met: the earliest arrival is 08:20"], plan: { ...preview.plan!, source: "estimate" } };
    const r = planReasons(f, p, null);
    expect(r[0]).toEqual({ text: "Arrive by 08:00 cannot be met: the earliest arrival is 08:20" });
    expect(r[1].note).toBe(true);
    expect(planReasons(f, null, "The server is busy").map((r) => r.text)).toEqual(["The server is busy"]);
    expect(planReasons(f, preview, null)).toEqual([]);
  });
  it("leaves the same-as-start note to the stop row (it has Tick it)", () => {
    const p = { ...preview, warnings: ['Same as the start: Stop 1 (Head office) is a pickup where the trip starts. Tick "Passengers get in here" instead.'] };
    expect(planReasons(f, p, null)).toEqual([]);
  });
});

describe("the plan as a timeline (Phase 7, §17)", () => {
  it("a stop: arrive, the time there (usual here), leave; the start stop: leave and passengers", () => {
    expect(stopTimes({ kind: "stop", n: 2, label: "Stop 2 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", dwell_min: 90, dwell_source: "place" }))
      .toBe("arrive 09:00 · 1 h 30 min (usual here) · leave 10:30");
    expect(stopTimes({ kind: "stop", n: 1, label: "Stop 1 · Pickup · Head office", place: "Head office", planned_arrive: "07:24", planned_leave: "07:29", dwell_min: 5, is_start: true }))
      .toBe("leave 07:29 · passengers get in here");
  });
  it("a leg: km, drive time and where the road time came from", () => {
    expect(legText({ kind: "leg", from_n: 1, to_n: 2, km: 94.26, minutes: 75, source: "google" })).toBe("94.3 km · 1 h 15 min · Google traffic");
    expect(legText({ kind: "leg", from_n: "start", to_n: 1, km: 3, minutes: 9, source: "ors" })).toBe("3 km · 9 min · openrouteservice");
    expect(legText({ kind: "leg", from_n: 2, to_n: "base", km: 3, minutes: 9, source: "estimate" })).toBe("3 km · 9 min · estimate");
  });
  it("numbers follow the stops before the list", () => {
    expect(shiftLabel("Stop 1 · Drop · Galle", 1, 2)).toBe("Stop 3 · Drop · Galle");
    expect(shiftLabel("Stop 1 · Drop · Galle", 1, 0)).toBe("Stop 1 · Drop · Galle");
    const rows = [{ ...newStop("drop"), place: "A" }, newStop("drop"), { ...newStop("visit"), place: "B" }];
    expect([...rowStopNumbers(rows, 1).values()]).toEqual([2, 3]);
  });
  it("each row's first time at the stop: the plan's usual time or default, else the type's default from the setting", () => {
    const rows = [{ ...newStop("pickup"), place: "Head office" }, { ...newStop("visit"), place: "Kurunegala site", dwell: "30" }, newStop("drop")];
    const planned = [
      { seq: 1, type: "pickup", place: "Head office", is_start: true, dwell_min: 5, dwell_source: "default" as const },
      { seq: 2, type: "pickup", place: "Head office", dwell_min: 12, dwell_source: "place" as const },
      { seq: 3, type: "visit", place: "Kurunegala site", dwell_min: 30, dwell_source: "chosen" as const },
    ];
    const fb = dwellFallbacks(rows, planned, { pickup: 5, drop: 5, visit: 60, default: 5 });
    expect(fb.get(rows[0].key)).toEqual({ min: 12, source: "place" });
    expect(fb.get(rows[1].key)).toEqual({ min: 60, source: "default" });
    expect(fb.get(rows[2].key)).toEqual({ min: 5, source: "default" });
  });
});
