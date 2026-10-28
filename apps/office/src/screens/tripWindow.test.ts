// Round 48 (item 4): free or busy by the trip's date on the site (Google Calendar's room picker: availability for the
// meeting's time, never now). The arguments the forms send (the plan's end), the trip's chip words, the vehicle select's
// words for the trip, the approver's edited window on suggest_vehicles, and Ask drivers' board arguments.
import { describe, expect, it } from "vitest";
import type { AvailableDriver, Suggestions } from "../data/types";
import { suggestForDecision } from "./approvalLogic";
import { availabilityArgs, planEndOf, tripChip, vehicleWindowWords } from "./availabilityLogic";
import { withPlannedEnd } from "./requestLogic";
import { tripBoardArgs } from "./asks/askLogic";
import { driverOptions, fitOf } from "../ui/driverPickerLogic";

const base: AvailableDriver = { name: "Nuwan", username: "nuwan.p", state: "off_duty", status_text: "Off duty", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true };

describe("the window the forms ask for", () => {
  it("the plan's end goes as planned_end when no end time is typed, never beside an until", () => {
    expect(availabilityArgs("2026-10-29", "09:00", "", undefined, undefined, null, "13:10")).toEqual({ at: "2026-10-29 09:00", planned_end: "13:10" });
    expect(availabilityArgs("2026-10-29", "09:00", "12:00", undefined, undefined, null, "13:10")).toEqual({ at: "2026-10-29 09:00", until: "12:00" });
    expect(availabilityArgs("2026-10-29", "09:00", "", undefined, undefined, null, "08:00")).toEqual({ at: "2026-10-29 09:00" });
    expect(availabilityArgs("2026-10-29", "09:00", "", undefined, undefined, null, "")).toEqual({ at: "2026-10-29 09:00" });
  });
  it("planEndOf: the timeline's ends, else the plan's ends_at, as HH:MM", () => {
    expect(planEndOf({ timeline: { items: [], totals: { drive_min: 60, km: 40, ends: "13:10" } } })).toBe("13:10");
    expect(planEndOf({ plan: { source: "estimate", ends_at: "2026-10-29 13:10", total_drive_min: 60, total_km: 40, legs: [], warnings: [] } })).toBe("13:10");
    expect(planEndOf(null)).toBe("");
  });
  it("withPlannedEnd: suggest_vehicles gets the plan's end only without a back-by and after the time", () => {
    expect(withPlannedEnd({ date: "2026-10-29", time: "09:00" }, "13:10")).toEqual({ date: "2026-10-29", time: "09:00", planned_end: "13:10" });
    expect(withPlannedEnd({ date: "2026-10-29", time: "09:00", back_by: "12:00" }, "13:10")).toEqual({ date: "2026-10-29", time: "09:00", back_by: "12:00" });
    expect(withPlannedEnd({ date: "2026-10-29", time: "09:00" }, "08:00")).toEqual({ date: "2026-10-29", time: "09:00" });
    expect(withPlannedEnd(null, "13:10")).toBeNull();
  });
  it("suggestForDecision: the request's own window until the approver types a day or a time", () => {
    expect(suggestForDecision("r1", { date: "", time: "", back: "" })).toEqual({ request_id: "r1" });
    expect(suggestForDecision("r1", { date: "2026-10-30", time: "", back: "" })).toEqual({ request_id: "r1", date: "2026-10-30" });
    expect(suggestForDecision("r1", { date: "", time: "10:00", back: "12:00" })).toEqual({ request_id: "r1", time: "10:00", back_by: "12:00" });
    expect(suggestForDecision("r1", { date: "", time: "10:00", back: "09:00" })).toEqual({ request_id: "r1", time: "10:00" });
  });
  it("tripBoardArgs: the Ask drivers page asks the board about the trip once its day and start are typed", () => {
    expect(tripBoardArgs({ kind: "free_for_trip", date: "2026-10-29", from: "09:00", to: "13:00" })).toEqual({ trip_date: "2026-10-29", trip_from: "09:00", trip_to: "13:00" });
    expect(tripBoardArgs({ kind: "free_for_trip", date: "2026-10-29", from: "09:00", to: "08:00" })).toEqual({ trip_date: "2026-10-29", trip_from: "09:00" });
    expect(tripBoardArgs({ kind: "free_for_trip", date: "", from: "09:00", to: "" })).toEqual({});
    expect(tripBoardArgs({ kind: "where_now", date: "2026-10-29", from: "09:00", to: "" })).toEqual({});
  });
});

describe("the chip says the trip's day", () => {
  it("tripChip and fitOf: the server's words first, the old chip when an answer has none", () => {
    expect(tripChip({ ...base, free_text: "Free Thu 29 Oct" })).toEqual({ text: "Free Thu 29 Oct", free: true });
    expect(tripChip({ ...base, free: false, busy_text: "Busy 09:00–13:00 that day · Team drop" })).toEqual({ text: "Busy 09:00–13:00 that day · Team drop", free: false });
    expect(tripChip(base)).toEqual({ text: "Free · off duty", free: true });
    expect(tripChip({ ...base, state: "on_duty" })).toEqual({ text: "Free", free: true });
    expect(tripChip({ ...base, free: false })).toEqual({ text: "Busy", free: false });
    expect(fitOf({ ...base, free_text: "Free tomorrow" })).toEqual({ text: "Free tomorrow", free: true });
    expect(fitOf({ ...base, free: false })).toEqual({ text: "Busy", free: false });
  });
  it("the driver picker: suggest_vehicles' free drivers and the others carry the trip's words", () => {
    const opts = driverOptions({
      free: [{ name: "Kamal", username: "kamal", free_text: "Free Thu 29 Oct" }],
      other: [{ name: "Ruwan", username: "ruwan", availability: "task 09:00–13:00 · Team drop", busy_text: "Busy 09:00–13:00 that day · Team drop" }, { name: "Sunil", username: "sunil", availability: "free all day" }],
    });
    expect(opts.map((o) => o.fit)).toEqual([{ text: "Free Thu 29 Oct", free: true }, { text: "Busy 09:00–13:00 that day · Team drop", free: false }, { text: "free all day", free: true }]);
  });
  it("vehicleWindowWords: every plate's words for the trip from the groups (the garage says NOW)", () => {
    const groups: NonNullable<Suggestions["groups"]> = {
      free_pool: [{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce", availability: "free all day", pick: "good", free_text: "Free Thu 29 Oct" } as never],
      free_assigned: [],
      busy: [{ reg_no: "WP KL-1234", availability: "booked 09:00–13:00 · Team drop", pick: "no", busy_text: "Busy 09:00–13:00 that day · Team drop" } as never],
      in_garage: [{ reg_no: "WP CAR-1182", availability: "in garage", pick: "no", garage_now: true, garage_text: "In the garage now · not known for Thu 29 Oct" } as never],
    };
    const m = vehicleWindowWords(groups);
    expect([...m.entries()]).toEqual([["WP CAB-4521", "Free Thu 29 Oct"], ["WP KL-1234", "Busy 09:00–13:00 that day · Team drop"], ["WP CAR-1182", "In the garage now · not known for Thu 29 Oct"]]);
    expect(vehicleWindowWords(undefined).size).toBe(0);
  });
});
