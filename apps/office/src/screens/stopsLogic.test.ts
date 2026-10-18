import { describe, expect, it } from "vitest";
import {
  defaultStops, draftsFromStops, driveText, dwellText, firstStopOf, hasDeadline, metresBetween, moveStop, newStop, parseDwell, parsePin, pickupAtStart, sameAsStart,
  startInput, stopLabel, stopNumber, stopsInput, tickStart, typeDwell,
} from "./stopsLogic";

describe("stops editor rules", () => {
  it("names every row by its place in the order (Phase 7, §11); adding or moving a row renumbers, never changes a type", () => {
    const list = [newStop("pickup"), newStop("drop"), newStop("drop"), newStop("visit")];
    list[0].place = "Head office";
    list[1].place = "Kurunegala site";
    expect(list.map((_, i) => stopLabel(list, i))).toEqual(["Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kurunegala site", "Stop 3 · Drop", "Stop 4 · Visit"]);
    const added = [...list, newStop("pickup")];
    expect(added.map((_, i) => stopLabel(added, i))).toEqual(["Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kurunegala site", "Stop 3 · Drop", "Stop 4 · Visit", "Stop 5 · Pickup"]);
    expect(added.slice(0, 4).map((s) => s.type)).toEqual(list.map((s) => s.type));
    const moved = moveStop(added, 4, -1);
    expect(moved.map((_, i) => stopLabel(moved, i))).toEqual(["Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kurunegala site", "Stop 3 · Drop", "Stop 4 · Pickup", "Stop 5 · Visit"]);
  });
  it("counts the stops before the rows: the start stop, or stops already reached", () => {
    const list = [newStop("drop")];
    list[0].place = "Kurunegala site";
    expect(stopLabel(list, 0, 1)).toBe("Stop 2 · Drop · Kurunegala site");
    expect([stopNumber(0), stopNumber(2, 1)]).toEqual(["Stop 1", "Stop 4"]);
  });
  it("reorders and parses pins", () => {
    const [a, b, c] = [newStop("pickup"), newStop("visit"), newStop("drop")];
    expect(moveStop([a, b, c], 1, 1).map((s) => s.key)).toEqual([a.key, c.key, b.key]);
    expect(moveStop([a, b, c], 0, -1).map((s) => s.key)).toEqual([a.key, b.key, c.key]);
    expect(parsePin(" 6.9344, 79.8428 ")).toEqual({ lat: 6.9344, lng: 79.8428 });
    expect(parsePin("6.9344 79.8428")).toEqual({ lat: 6.9344, lng: 79.8428 });
    expect(parsePin("")).toBeNull();
    expect(parsePin("Colombo")).toBe("bad");
    expect(parsePin("99, 79")).toBe("bad");
  });
  it("builds the stops[] argument and names what is wrong", () => {
    expect(stopsInput(defaultStops())).toEqual({ error: "Add at least one stop." });
    const stops = defaultStops();
    stops[0].place = "Head office";
    stops[1].place = "Galle";
    stops[1].what = "people";
    stops[1].arriveBy = "10:00";
    stops[1].dwell = "20";
    stops[1].note = "Gate 2";
    expect(stopsInput(stops)).toEqual({
      stops: [{ type: "pickup", place: "Head office" }, { type: "drop", what: "people", place: "Galle", dwell_min: 20, arrive_by: "10:00", note: "Gate 2" }],
    });
    expect(hasDeadline(stops)).toBe(true);
    stops[1].arriveBy = "25:00";
    expect(stopsInput(stops)).toEqual({ error: "Stop 2: the arrive-by time must be HH:MM." });
    // With the start as Stop 1 (passengers get in there), the same row is Stop 3, as its label says.
    expect(stopsInput(stops, 1)).toEqual({ error: "Stop 3: the arrive-by time must be HH:MM." });
    stops[1].arriveBy = "";
    stops[1].pin = "6.03, 80.22";
    stops[1].place = "";
    expect(stopsInput(stops)).toEqual({ stops: [{ type: "pickup", place: "Head office" }, { type: "drop", what: "people", lat: 6.03, lng: 80.22, dwell_min: 20, note: "Gate 2" }] });
    stops[1].pin = "nowhere";
    expect(stopsInput(stops)).toEqual({ error: 'Stop 2: the pin must be "lat, lng", e.g. 6.9344, 79.8428.' });
  });
  it("makes drafts from a task's stops and prints drive times", () => {
    const d = draftsFromStops([{ type: "drop", what: "goods", place: "Matara", lat: 5.95, lng: 80.55, pin: "given", dwell_min: 15, arrive_by: "11:00", note: "" }]);
    expect(d[0]).toMatchObject({ type: "drop", what: "goods", place: "Matara", pin: "5.95, 80.55", dwell: "15", arriveBy: "11:00" });
    expect(driveText(155)).toBe("2 h 35 min");
    expect(driveText(45)).toBe("45 min");
    expect(driveText(120)).toBe("2 h");
    expect(driveText(undefined)).toBe("—");
  });
});

describe("a stop picked in the search box (Part 4)", () => {
  it("sends the place's id with the name; a picked site needs no pin; the id comes back for editing", async () => {
    const { newStop, stopsInput, draftsFromStops } = await import("./stopsLogic");
    const s = { ...newStop("pickup"), place: "Inamaluwa Town_Hutch", placeId: "p1", placePinned: false };
    expect(stopsInput([s])).toEqual({ stops: [{ type: "pickup", place_id: "p1", place: "Inamaluwa Town_Hutch" }] });
    expect(stopsInput([{ ...newStop("drop"), placeId: "p2" }])).toEqual({ stops: [{ type: "drop", place_id: "p2" }] });
    const back = draftsFromStops([{ type: "pickup", place: "Inamaluwa Town_Hutch", place_id: "p1" }]);
    expect([back[0].placeId, back[0].placePinned]).toEqual(["p1", false]);
  });
});

describe("a Google place picked in the search box (Part 5)", () => {
  it("sends google_place_id with the name and never the pin (the server keeps Google's); the id comes back for editing", () => {
    const s = { ...newStop("drop"), place: "Kandy City Centre", googlePlaceId: "ChIJ-kcc", pin: "7.2931, 80.635" };
    expect(stopsInput([s])).toEqual({ stops: [{ type: "drop", google_place_id: "ChIJ-kcc", place: "Kandy City Centre" }] });
    const ours = { ...newStop("pickup"), place: "Head office", placeId: "p-1", googlePlaceId: "ChIJ-old" };
    expect(stopsInput([ours])).toEqual({ stops: [{ type: "pickup", place_id: "p-1", place: "Head office" }] });
    const [d] = draftsFromStops([{ type: "drop", place: "Kandy City Centre", google_place_id: "ChIJ-kcc", lat: 7.2931, lng: 80.635, pin: "google" }]);
    expect([d.googlePlaceId, d.pin, d.placeId]).toEqual(["ChIJ-kcc", "", undefined]);
    expect(stopsInput([d])).toEqual({ stops: [{ type: "drop", google_place_id: "ChIJ-kcc", place: "Kandy City Centre" }] });
  });
});

describe("the time at each stop (Phase 7, §17)", () => {
  it("reads minutes or h:mm up to 12 h, and says it back", () => {
    expect([parseDwell(""), parseDwell("45"), parseDwell("1:30"), parseDwell("2.15"), parseDwell("12:00")]).toEqual([null, 45, 90, 135, 720]);
    expect([parseDwell("12:01"), parseDwell("800"), parseDwell("1h"), parseDwell("1:75")]).toEqual(["bad", "bad", "bad", "bad"]);
    expect([dwellText(5), dwellText(60), dwellText(90), dwellText(135)]).toEqual(["5 min", "1 h", "1 h 30 min", "2 h 15 min"]);
  });
  it("sends dwell_min only when chosen, and refuses what is not a time", () => {
    const a = { ...newStop("drop"), place: "Galle", dwell: "1:30" };
    expect(stopsInput([a])).toEqual({ stops: [{ type: "drop", place: "Galle", dwell_min: 90 }] });
    expect(stopsInput([{ ...a, dwell: "" }])).toEqual({ stops: [{ type: "drop", place: "Galle" }] });
    expect(stopsInput([{ ...a, dwell: "13:00" }])).toEqual({ error: "Stop 1: the time at the stop must be minutes or h:mm, up to 12 h." });
  });
  it("the default by type comes from the fleet setting, else pickup 5, drop 5, visit 60", () => {
    expect([typeDwell("pickup"), typeDwell("drop"), typeDwell("visit")]).toEqual([5, 5, 60]);
    expect(typeDwell("visit", { pickup: 10, drop: 5, visit: 45, default: 5 })).toBe(45);
    expect(typeDwell("drop", { default: 7 })).toBe(7);
  });
  it("a time the server chose (usual or default) stays unchosen when a task's stops are edited", () => {
    const d = draftsFromStops([
      { type: "drop", place: "A", dwell_min: 30, dwell_source: "chosen" },
      { type: "drop", place: "B", dwell_min: 45, dwell_source: "place" },
      { type: "drop", place: "C", dwell_min: 5, dwell_source: "default" },
    ]);
    expect(d.map((s) => s.dwell)).toEqual(["30", "", ""]);
  });
});

describe("Start from and Passengers get in here (Phase 7, §11)", () => {
  const head = { ...newStop("pickup"), place: "Head office", placeId: "p-head" };
  it("a pickup at the start: the same saved place, pins within 50 m, or one of our places under the start's name", () => {
    expect(sameAsStart({ placeId: "p-head" }, head)).toBe(true);
    expect(sameAsStart({ placeId: "p-other" }, head)).toBe(false);
    const pinned = { ...newStop("pickup"), place: "Basement", lat: 6.9001, lng: 79.8601 };
    expect(sameAsStart({ lat: 6.9002, lng: 79.8602 }, pinned)).toBe(true);
    expect(sameAsStart({ lat: 6.9012, lng: 79.8602 }, pinned)).toBe(false);
    expect(sameAsStart({ name: "head office" }, head)).toBe(true);
    expect(Math.round(metresBetween({ lat: 6.9, lng: 79.86 }, { lat: 6.901, lng: 79.86 }))).toBe(111);
  });
  it("only a first pickup is flagged, and not once the start is a stop", () => {
    const drop = { ...newStop("drop"), place: "Galle" };
    expect(pickupAtStart([head, drop], { placeId: "p-head" }, false)).toBe(0);
    expect(pickupAtStart([head, drop], { placeId: "p-head" }, true)).toBe(-1);
    expect(pickupAtStart([drop, head], { placeId: "p-head" }, false)).toBe(-1);
    expect(pickupAtStart([newStop("drop"), head, drop], { placeId: "p-head" }, false)).toBe(1); // an empty row first does not count
  });
  it("Tick it removes the pickup and moves what it carried to the start; a task keeps one row", () => {
    const withNote = { ...head, what: "goods" as const, note: "Gate 2", dwell: "15" };
    const drop = { ...newStop("drop"), place: "Galle" };
    expect(tickStart([withNote, drop], 0)).toEqual({ list: [drop], carried: { startWhat: "goods", startNote: "Gate 2", startDwell: "15" } });
    expect(startInput({ start: "", startPax: true, startWhat: "goods", startNote: "Gate 2", startDwell: "15" }, { id: "p-base", name: "Head office" }))
      .toEqual({ place_id: "p-base", place: "Head office", passengers: true, what: "goods", note: "Gate 2", dwell_min: 15 });
    const only = tickStart([head], 0);
    expect(only.list).toHaveLength(1);
    expect(only.list[0].type).toBe("drop");
  });
  it("sends the start as picked, with passengers when ticked; the base place only when passengers get in there", () => {
    const base = { id: "p-base", name: "Head office" };
    expect(startInput({ start: "", startPax: false }, base)).toBeUndefined();
    expect(startInput({ start: "", startPax: true }, base)).toEqual({ place_id: "p-base", place: "Head office", passengers: true });
    expect(startInput({ start: "Depot", startPlaceId: "p-d", startPax: true }, base)).toEqual({ place_id: "p-d", place: "Depot", passengers: true });
    expect(startInput({ start: "Kandy City", startGooglePlaceId: "ChIJ-k", startPax: false }, base)).toEqual({ google_place_id: "ChIJ-k", place: "Kandy City" });
  });
  it("the first stop for the best match: the start when passengers get in there, else the first row's pin or our place", () => {
    const pinned = { ...newStop("pickup"), place: "Galle", pin: "6.03, 80.22" };
    expect(firstStopOf([pinned])).toEqual({ lat: 6.03, lng: 80.22 });
    expect(firstStopOf([head])).toEqual({ place: "Head office" });
    expect(firstStopOf([{ ...newStop("drop"), place: "somewhere typed" }])).toBeNull();
    expect(firstStopOf([pinned], { name: "Head office" })).toEqual({ place: "Head office" });
  });
});
