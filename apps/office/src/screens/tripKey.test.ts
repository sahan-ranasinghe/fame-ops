// An approved request's trip with its road lines (asked once) is shown only while it matches the card's trip: an office
// edit to the task moves the card's trip on without a new request version (Sahan, 17 October: never an old plan).
import { describe, expect, it } from "vitest";
import type { RequestTrip } from "../data/types";
import { tripKey } from "./requestLogic";

const trip: RequestTrip = {
  source: "task",
  start: { name: "Yard", has_pin: true },
  leave_by: "07:15",
  stops: [
    { seq: 1, n: 1, type: "pickup", place: "Head office", planned_arrive: "07:25", planned_depart: "07:30", status: "pending" },
    { seq: 2, n: 2, type: "drop", place: "Kandy site", planned_arrive: "10:40", arrive_by: "11:00", status: "pending" },
  ],
  timeline: { items: [{ kind: "leave", at: "07:15", source: "manual" }], totals: { drive_min: 180, km: 150, ends: "10:45" } },
};

describe("tripKey", () => {
  it("is the same for the same trip, whatever the road lines", () => {
    const lined = { ...trip, timeline: { ...trip.timeline!, lines: [[[6.9, 79.8]]] } } as unknown as RequestTrip;
    expect(tripKey(lined)).toBe(tripKey(trip));
    expect(tripKey(undefined)).toBe("");
  });

  it("moves with the leave time, a stop, a stop's times or state, the start and the office's change", () => {
    const k = tripKey(trip);
    expect(tripKey({ ...trip, leave_by: "07:40" })).not.toBe(k);
    expect(tripKey({ ...trip, stops: [...trip.stops, { seq: 3, n: 3, type: "visit", place: "Kurunegala site" }] })).not.toBe(k);
    expect(tripKey({ ...trip, stops: [{ ...trip.stops[0], planned_arrive: "07:50" }, trip.stops[1]] })).not.toBe(k);
    expect(tripKey({ ...trip, stops: [{ ...trip.stops[0], status: "arrived" }, trip.stops[1]] })).not.toBe(k);
    expect(tripKey({ ...trip, start: { name: "Head office", has_pin: true } })).not.toBe(k);
    expect(tripKey({ ...trip, changed: { by: "the office", was: "08:00 Sat 18 Oct", text: "Changed by the office · was 08:00 Sat 18 Oct" } })).not.toBe(k);
  });
});
