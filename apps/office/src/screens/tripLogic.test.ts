import { describe, expect, it } from "vitest";
import { newStop } from "./stopsLogic";
import { emptyTrip, type TripFields, tripChanges, tripFromRequest, tripPlanInput, tripRequestInput, tripTitle } from "./tripLogic";

const base = { id: "p-base", name: "Head office" };

/** A trip with its rows' places ("" leaves a row empty) and the other fields. */
function trip(places: string[], patch: Partial<TripFields> = {}): TripFields {
  const types = ["pickup", "drop", "drop", "visit"] as const;
  // Return to base off unless a test turns it on (a new trip has it on since Fix B: tested below).
  return { ...emptyTrip("2026-10-20"), returnToBase: false, stops: places.map((p, i) => ({ ...newStop(types[i] ?? "drop"), place: p })), ...patch };
}

describe("the trip editor's calls (Phase 7, §34)", () => {
  it("plans with the trip alone: the date, the stops, a typed leave time, the start and the switches", () => {
    expect(tripPlanInput(trip(["Head office", "Galle"]))).toBeNull(); // no leave time and no arrive-by
    const t = trip(["Head office", "Galle"], { leaveBy: "08:00", returnToBase: true, avoidExpressway: true, start: "Depot", end: "17:00" });
    expect(tripPlanInput(t)).toEqual({
      date: "2026-10-20", stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Galle" }], leave_by: "08:00",
      start: { place: "Depot" }, return_to_base: true, avoid_expressway: true,
    });
    const planned = trip(["", "Galle"]);
    planned.stops[1].arriveBy = "10:00";
    expect(tripPlanInput(planned)).toEqual({ date: "2026-10-20", stops: [{ type: "drop", place: "Galle", arrive_by: "10:00" }] });
  });
  it("create_request gets `time` only when the leave time was typed; else the server plans it from the arrive-by times", () => {
    const planned = trip(["", "Galle"], { end: "15:00", startPax: true });
    planned.stops[1].arriveBy = "10:00";
    expect(tripRequestInput(planned, base)).toEqual({
      input: { date: "2026-10-20", back_by: "15:00", stops: [{ type: "drop", place: "Galle", arrive_by: "10:00" }], start: { place_id: "p-base", place: "Head office", passengers: true } },
    });
    expect(tripRequestInput(trip(["", "Galle"], { leaveBy: "07:30" }))).toEqual({ input: { date: "2026-10-20", time: "07:30", stops: [{ type: "drop", place: "Galle" }] } });
    expect(tripRequestInput(trip(["", "Galle"]))).toEqual({ error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." });
    expect(tripRequestInput(trip(["", ""], { leaveBy: "07:30" }))).toEqual({ error: "Add at least one stop." });
    // With the start as Stop 1, a row's error names it as its label does.
    const bad = trip(["", "Galle"], { leaveBy: "07:30", startPax: true });
    bad.stops[1].pin = "nowhere";
    expect(tripRequestInput(bad)).toEqual({ error: 'Stop 3: the pin must be "lat, lng", e.g. 6.9344, 79.8428.' });
  });
  it("names a booked task after its last stop", () => {
    expect(tripTitle(trip(["Head office", "Galle", ""]))).toBe("Trip · Galle");
    expect(tripTitle(trip(["", ""]))).toBeUndefined();
  });
});

describe("a request's trip in the edit form (§34)", () => {
  it("reads a planned request back: the stops (a Google place, a pin given by hand, our place), the start with passengers, the switches", () => {
    const t = tripFromRequest({
      date: "2026-10-20", time: "07:40", back_by: "16:00", leave_by: undefined, return_to_base: true,
      stops: [
        { type: "drop", place: "Kandy City Centre", google_place_id: "ChIJ-kcc", lat: 7.29, lng: 80.63, arrive_by: "10:00" },
        { type: "visit", place: "Site 12", lat: 7.1, lng: 80.2, dwell_min: 45, what: "goods", note: "Gate 2" },
        { type: "drop", place: "Kurunegala site", place_id: "p-kur", lat: 7.48, lng: 80.36 },
      ],
      start: { place: "Head office", place_id: "p-base", lat: 6.9, lng: 79.86, passengers: true },
    }, { what: "goods", note: "Boxes", dwell_min: 20, dwell_source: "chosen" });
    expect(t).toMatchObject({
      date: "2026-10-20", leaveBy: "", end: "16:00", returnToBase: true, avoidExpressway: false,
      start: "Head office", startPlaceId: "p-base", startLat: 6.9, startPax: true, startWhat: "goods", startNote: "Boxes", startDwell: "20",
    });
    expect(t.stops.map((s) => [s.type, s.place, s.googlePlaceId ?? "", s.placeId ?? "", s.pin, s.dwell, s.arriveBy])).toEqual([
      ["drop", "Kandy City Centre", "ChIJ-kcc", "", "", "", "10:00"],
      ["visit", "Site 12", "", "", "7.1, 80.2", "45", ""],
      ["drop", "Kurunegala site", "", "p-kur", "", "", ""],
    ]);
    // A leave time typed by hand comes back typed.
    expect(tripFromRequest({ date: "2026-10-20", time: "07:40", leave_by: "07:40", stops: [{ type: "drop", place: "Galle" }] }).leaveBy).toBe("07:40");
    // The start stop's own fields only while passengers get in there; a time the server chose stays unchosen.
    const plain = tripFromRequest({ date: "2026-10-20", time: "08:00", stops: [{ type: "drop", place: "Galle" }], start: { place: "Depot" } }, { what: "goods", dwell_min: 5, dwell_source: "place" });
    expect([plain.startPax, plain.startWhat, plain.startDwell]).toEqual([false, "", ""]);
  });
  it("an older request (From and To only) opens as a pickup at From and a drop at To, with the times there and the time as typed", () => {
    const t = tripFromRequest({ date: "2026-10-20", time: "09:00", route_from: "Head office", route_to: "Galle", from_dwell_min: 15, to_dwell_min: 30 });
    expect(t.leaveBy).toBe("09:00");
    expect(t.stops.map((s) => [s.type, s.place, s.dwell])).toEqual([["pickup", "Head office", "15"], ["drop", "Galle", "30"]]);
    expect(t.start).toBe("");
    // Only To: the From row stays empty (and is not sent).
    const onlyTo = tripFromRequest({ date: "2026-10-20", time: "09:00", route_to: "Galle" });
    expect(tripRequestInput(onlyTo)).toMatchObject({ input: { stops: [{ type: "drop", place: "Galle" }] } });
  });
});

describe("update_request's trip: only what changed (§34)", () => {
  const was = tripFromRequest({ date: "2026-10-20", time: "09:00", route_from: "Head office", route_to: "Galle", back_by: "13:00" });
  it("nothing changed, or only the day, the time or the back-by: no stops", () => {
    expect(tripChanges(was, was, base)).toEqual({ input: {} });
    expect(tripChanges({ ...was, date: "2026-10-21", leaveBy: "09:30", end: "" }, was, base)).toEqual({ input: { date: "2026-10-21", time: "09:30", back_by: null } });
    expect(tripChanges({ ...was, date: "" }, was, base)).toEqual({ error: "Add the day." });
  });
  it("a changed route sends the stops with the start (the base place when Start from is empty); an older request becomes planned", () => {
    const stops = [...was.stops, { ...newStop("visit"), place: "Matara" }];
    expect(tripChanges({ ...was, stops }, was, base)).toEqual({
      input: { stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Galle" }, { type: "visit", place: "Matara" }], start: { place_id: "p-base", place: "Head office" } },
    });
    expect(tripChanges({ ...was, returnToBase: true }, was, null)).toEqual({
      input: { stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Galle" }], return_to_base: true },
    });
    expect(tripChanges({ ...was, start: "Depot", startPlaceId: "p-dep" }, was, base)).toMatchObject({ input: { start: { place_id: "p-dep", place: "Depot" } } });
  });
  it("an emptied leave time is planned from the arrive-by times (null), and needs one", () => {
    expect(tripChanges({ ...was, leaveBy: "" }, was, base)).toEqual({ error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." });
    const stops = was.stops.map((s, i) => (i === 1 ? { ...s, arriveBy: "11:00" } : s));
    expect(tripChanges({ ...was, leaveBy: "", stops }, was, base)).toEqual({
      input: { time: null, stops: [{ type: "pickup", place: "Head office" }, { type: "drop", place: "Galle", arrive_by: "11:00" }], start: { place_id: "p-base", place: "Head office" } },
    });
  });
});
