// Phase 7 (§13): the office's side of a driver-started trip, pure.
import { describe, expect, it } from "vitest";
import { PERSONAL_TRIPS_OPTIONS, personalTripsValue, purposeDoneText, purposeInput, tripTags } from "./tripPurposeLogic";

describe("trip tags", () => {
  it("Driver-started for kind self, Personal for a personal one, nothing for the office's tasks", () => {
    expect(tripTags({ kind: "self", purpose: "personal" }).map((t) => t.label)).toEqual(["Driver-started", "Personal"]);
    expect(tripTags({ kind: "self", purpose: "company" }).map((t) => t.label)).toEqual(["Driver-started"]);
    expect(tripTags({ kind: "dispatch", purpose: "company" })).toEqual([]);
    expect(tripTags({})).toEqual([]);
  });
});

describe("set_trip_purpose's input", () => {
  it("switches company ↔ personal; a project goes with company work only; nothing changed is not sent", () => {
    expect(purposeInput("t1", "company", "personal", "")).toEqual({ input: { task_id: "t1", purpose: "personal" } });
    expect(purposeInput("t1", "personal", "company", "")).toEqual({ input: { task_id: "t1", purpose: "company" } });
    expect(purposeInput("t1", "company", "company", "  TRKAN1 ")).toEqual({ input: { task_id: "t1", purpose: "company", project: "TRKAN1" } });
    expect(purposeInput("t1", "company", "company", "internal")).toEqual({ input: { task_id: "t1", purpose: "company", project: "internal" } });
    expect(purposeInput("t1", "company", "personal", "TRKAN1")).toEqual({ error: "A personal trip has no project: choose Company work to attach one." });
    expect(purposeInput("t1", "company", "company", " ")).toEqual({ error: "Nothing to change yet." });
    expect(purposeInput("t1", undefined, "company", "")).toEqual({ error: "Nothing to change yet." });
  });

  it("the line after a save", () => {
    expect(purposeDoneText({ task_id: "t1", purpose: "personal", was: "company", note: "Its km are counted as personal, apart from the jobs." }))
      .toBe("Now personal: its km are counted as personal, apart from the jobs.");
    expect(purposeDoneText({ task_id: "t1", purpose: "company", was: "personal", project: "TRKAN1" })).toBe("Now company work · charged to TRKAN1");
    expect(purposeDoneText({ task_id: "t1", purpose: "company", project: "Fame internal" })).toBe("Company work · charged to Fame internal");
  });
});

describe("driver_personal_trips", () => {
  it("four values in plain words, in order", () => {
    expect(PERSONAL_TRIPS_OPTIONS).toEqual([
      ["allowed", "Allowed: Company work preselected, Personal offered"],
      ["default", "Personal preselected"],
      ["off", "Off: no Personal choice"],
      ["ask_first", "Ask first (not built yet: works as Allowed)"],
    ]);
  });

  it("the saved value, else the server's default, else allowed", () => {
    expect(personalTripsValue("off", "allowed")).toBe("off");
    expect(personalTripsValue(undefined, "default")).toBe("default");
    expect(personalTripsValue("something", null)).toBe("allowed");
  });
});
