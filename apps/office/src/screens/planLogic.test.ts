import { describe, expect, it } from "vitest";
import type { PlanPreview } from "../data/types";
import { planLine, planReasons } from "./planLogic";
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
});
