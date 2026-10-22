// Round 4–7, feature 4: the rules of a trip nobody drives with the app and of the checks the office reads (myTripLogic.ts).
import { describe, expect, it } from "vitest";
import type { MyTrip, VehicleCheck } from "../data/types";
import {
  byDay, checkButton, checkInput, checkReason, type CheckForm, emptyCheck, emptyFinish, finishChip, finishInput, finishReason,
  lastWeekArgs, odometerReason, parseKm, TRIP_ACTION_TEXT, tripKm, tripMode, tripTaskId, windowLine,
} from "./myTripLogic";

const trip = (over: Partial<MyTrip> = {}): MyTrip => ({
  task_id: "t1", title: "Site visit · Kandy", date: "2026-10-23", leave_at: "09:00", driven_by: "self", stops: [],
  state: "to_check", window: { opens_at: "07:00", open: true, past: false }, check_needed: true,
  can: { check: true, finish: true }, last_odometer_km: 45210, vehicle: "WP CAB-4521",
  ...over,
});
const form = (over: Partial<CheckForm> = {}): CheckForm => ({ ...emptyCheck(trip()), ...over });

describe("a no-app trip's page", () => {
  it("the mode by where the trip is: check before setting off, finish, confirm, done", () => {
    expect(tripMode(trip())).toBe("check");
    expect(tripMode(trip(), true)).toBe("finish");
    expect(tripMode(trip({ window: { opens_at: "07:00", open: false, past: true } }))).toBe("finish");
    expect(tripMode(trip({ state: "on_the_way" }))).toBe("finish");
    expect(tripMode(trip({ state: "finish" }))).toBe("finish");
    expect(tripMode(trip({ state: "not_confirmed" }))).toBe("confirm");
    expect(tripMode(trip({ state: "done" }))).toBe("done");
    expect(tripMode(trip({ state: "cancelled" }))).toBe("cancelled");
  });

  it("the row's button words and the task it opens", () => {
    expect(TRIP_ACTION_TEXT).toEqual({ check: "Vehicle check", finish: "Trip finished?", confirm: "Enter the odometer" });
    expect(tripTaskId({ id: "r1", task_id: "t9" })).toBe("t9");
    expect(tripTaskId({ id: "t7", source: "task" })).toBe("t7");
    expect(tripTaskId({ id: "r2" })).toBeUndefined();
  });

  it("the odometer: a whole number, never under the last reading, never 3,000 km over it", () => {
    expect(parseKm("45 210")).toBe(45210);
    expect(parseKm("45,210")).toBe(45210);
    expect(parseKm("45.2")).toBeNull();
    expect(odometerReason("", 45210, "last")).toBe("Enter the odometer");
    expect(odometerReason("45200", 45210, "last")).toMatch(/Under the vehicle's last reading \(45,210 km\)/);
    expect(odometerReason("49000", 45210, "last")).toMatch(/3,790 km more than the last reading/);
    expect(odometerReason("45230", 45210, "last")).toBeNull();
  });

  it("the check is ready when answered, with what a problem needs; the button says what it does", () => {
    const t = trip();
    expect(emptyCheck(t).odometer).toBe("45210");
    expect(checkReason(t, form(), "today")).toBe("Answer the question: any damage or problem?");
    expect(checkReason(t, form({ result: "ok" }), "today")).toBeNull();
    expect(checkReason(t, form({ result: "problem" }), "today")).toBe("Pick what the problem is");
    expect(checkReason(t, form({ result: "problem", category: "damage" }), "today")).toBe("Add at least one photo of the problem");
    expect(checkReason(t, form({ result: "problem", category: "damage", uploading: 1 }), "today")).toBe("Wait for the photos to go up");
    expect(checkReason(t, form({ result: "problem", category: "damage", photos: ["p1"] }), "today")).toBeNull();
    expect(checkButton(t, { result: "ok" })).toBe("Start trip");
    expect(checkButton(t, { result: "problem" })).toBe("Send and start trip");
    const early = trip({ window: { opens_at: "07:00", open: false, past: false } });
    expect(checkButton(early, { result: "ok" })).toBe("Save check");
    expect(windowLine(early, "tomorrow")).toBe("The trip starts tomorrow from 07:00: a check now is only recorded. Check again then.");
    expect(windowLine(t, "today")).toBe("Your check starts the trip (On the way).");
  });

  it("the switch vehicle_check off: only the odometer, which starts the trip from its time", () => {
    const off = trip({ check_needed: false, window: { opens_at: "07:00", open: false, past: false } });
    expect(checkReason(off, form(), "on Fri 23 Oct")).toBe("You can start the trip on Fri 23 Oct from 07:00");
    const open = trip({ check_needed: false });
    expect(checkReason(open, form(), "today")).toBeNull();
    expect(checkButton(open, { result: null })).toBe("Start trip");
    expect(checkInput("t1", "c1", open, form({ odometer: "45230" }))).toEqual({ task_id: "t1", check_id: "c1", result: "ok", odometer_km: 45230 });
  });

  it("my_trip_check's input: all good with the sides, or a problem with its category, note and photos", () => {
    const t = trip();
    expect(checkInput("t1", "c1", t, form({ result: "ok", odometer: "45 230", sides: [{ photo_id: "p1", side: "front" }] })))
      .toEqual({ task_id: "t1", check_id: "c1", result: "ok", odometer_km: 45230, sides: [{ photo_id: "p1", side: "front" }] });
    expect(checkInput("t1", "c1", t, form({ result: "problem", category: "tyre", note: "  flat rear  ", photos: ["p2", "p3"] })))
      .toEqual({ task_id: "t1", check_id: "c1", result: "problem", odometer_km: 45210, category: "tyre", note: "flat rear", photos: ["p2", "p3"] });
  });

  it("Trip finished?: the start from the trip or typed (the last reading by default), never under it; fuel optional", () => {
    const never = trip({ state: "to_check", window: { opens_at: "07:00", open: false, past: true } });
    const f = emptyFinish(never);
    expect(f.start).toBe("45210");
    expect(finishReason(never, f)).toBe("Enter the odometer");
    expect(finishReason(never, { ...f, start: "" })).toBe("Enter the odometer at the start");
    expect(finishReason(never, { ...f, odometer: "45200" })).toMatch(/Under the start \(45,210 km\)/);
    expect(finishReason(never, { ...f, odometer: "45252", litres: "abc" })).toBe("Litres: a number up to 500");
    expect(finishReason(never, { ...f, odometer: "45252", uploading: true })).toBe("Wait for the photo to go up");
    expect(finishReason(never, { ...f, odometer: "45252", litres: "12.5", amount: "4,500" })).toBeNull();
    expect(tripKm(never, { ...f, odometer: "45252" })).toBe(42);
    expect(finishInput("t1", never, { ...f, odometer: "45252", litres: "12.5", amount: "4,500", photo: "p9" }))
      .toEqual({ task_id: "t1", odometer_km: 45252, start_odometer_km: 45210, fuel: { litres: 12.5, amount_lkr: 4500 }, photo: "p9" });
    const started = trip({ state: "on_the_way", start_odometer_km: 45220 });
    expect(emptyFinish(started).start).toBe("");
    expect(finishInput("t1", started, { ...emptyFinish(started), odometer: "45300" })).toEqual({ task_id: "t1", odometer_km: 45300 });
  });
});

describe("the office's view of the checks", () => {
  it("the last 7 days of a vehicle, by day", () => {
    expect(lastWeekArgs("WP CAB-4521", "2026-10-22")).toEqual({ vehicle: "WP CAB-4521", from: "2026-10-16", to: "2026-10-22", limit: 50 });
    const c = (id: string, date: string) => ({ id, date }) as VehicleCheck;
    expect(byDay([c("a", "2026-10-22"), c("b", "2026-10-22"), c("c", "2026-10-21")]).map((d) => [d.date, d.checks.length])).toEqual([["2026-10-22", 2], ["2026-10-21", 1]]);
  });

  it("a task's finish flag: Completed · not confirmed is grey, Completed early amber", () => {
    expect(finishChip({ kind: "not_confirmed" })).toEqual({ text: "Completed · not confirmed", tone: "" });
    expect(finishChip({ kind: "completed_early" })).toEqual({ text: "Completed early", tone: "warn" });
    expect(finishChip(undefined)).toBeNull();
  });
});
