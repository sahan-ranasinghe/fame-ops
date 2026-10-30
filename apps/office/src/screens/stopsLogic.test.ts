import { describe, expect, it } from "vitest";
import { emptyTrip } from "./tripLogic";
import {
  defaultStops, draftsFromStops, driveText, dwellText, firstStopOf, hasDeadline, metresBetween, moveStop, newStop, parseDwell, parsePin, pickupAtStart, sameAsStart,
  startInput, stopLabel, stopNumber, stopsInput, tickStart, typeDwell,
  addStop, hasPlace, moveStopTo, openStops, removeStop, roleOf, START_ROLES, startRoleOf, STOP_ROLES, type StopDraft, type StopType, tidyStops, withPositions, withReturn, withRole, withStartRole,
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
    // Two rows as an older form had them (Fix B's form opens with To only).
    const stops = [newStop("pickup"), newStop("drop")];
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

describe("From / To / Add stop (Fix B, 29 October 2026; the stays and the empty rows, 30 October)", () => {
  const named = (list: StopDraft[]) => list.map((s) => `${s.type}:${s.place}`);
  const at = (place: string, type: StopType = "drop") => ({ ...newStop(type), place });

  it("a new trip is From (the start) and one To; it returns to the base, so To is a visit (wait there); one-way, the drop-off", () => {
    expect(defaultStops().map((s) => s.type)).toEqual(["visit"]);
    expect(defaultStops(false).map((s) => s.type)).toEqual(["drop"]);
    expect(emptyTrip("2026-10-30").returnToBase).toBe(true);
    expect(emptyTrip("2026-10-30").stops.map((s) => s.type)).toEqual(["visit"]);
    expect(emptyTrip("2026-10-30").startPax).toBe(false); // From: Leave from here (Sahan's choice)
  });

  it("\"Then back to the office\" switched: To (not chosen) becomes the drop-off and its wait goes; on again, a visit; a chosen To stays", () => {
    const wait = [at("Kalutara"), { ...at("Galle", "visit"), dwell: "45" }];
    const oneWay = withReturn(wait, false);
    expect(oneWay.map((s) => [s.type, s.dwell])).toEqual([["drop", ""], ["drop", ""]]);
    expect(withReturn(oneWay, true).map((s) => s.type)).toEqual(["drop", "visit"]);
    const chosen = [withRole({ ...at("Galle"), dwell: "30" }, "out")];
    expect(withReturn(chosen, true).map((s) => [s.type, s.dwell])).toEqual([["drop", "30"]]);
    const visitTo = [withRole({ ...at("Galle"), dwell: "30" }, "visit")];
    expect(withReturn(visitTo, false).map((s) => [s.type, s.dwell])).toEqual([["visit", "30"]]);
    // The wait typed for To is sent as its stay.
    expect(stopsInput([{ ...at("Galle", "visit"), dwell: "45" }])).toEqual({ stops: [{ type: "visit", place: "Galle", dwell_min: 45 }] });
  });

  it("+ Add stop goes between the last stop and To as a short stop (a drop-off, its short default stay); To keeps its type", () => {
    const one = [at("Galle")];
    const a = addStop(one);
    expect(named(a.list)).toEqual(["drop:", "drop:Galle"]);
    expect(roleOf(a.list[0])).toBe("short");
    expect(a.list[0].key).toBe(a.key);
    expect(named(addStop([at("Galle", "visit")], true).list)).toEqual(["drop:", "visit:Galle"]);
    const b = addStop([at("Kalutara"), at("Galle")]);
    expect(named(b.list)).toEqual(["drop:Kalutara", "drop:", "drop:Galle"]);
    expect(named(addStop([]).list)).toEqual(["drop:"]);
    expect(named(addStop([], true).list)).toEqual(["visit:"]);
    expect(typeDwell("drop")).toBe(5);
  });

  it("the server still gets pickup / visit / drop: inferred by place, chosen under Options", () => {
    const list = withPositions([at("Kalutara", "visit"), at("Galle", "drop")], true);
    expect(stopsInput(list)).toEqual({ stops: [{ type: "drop", place: "Kalutara" }, { type: "visit", place: "Galle" }] });
    expect(named(withPositions(list, false))).toEqual(["drop:Kalutara", "drop:Galle"]);
    const chosen = [withRole(list[0], "visit"), list[1]];
    expect(stopsInput(chosen)).toEqual({ stops: [{ type: "visit", place: "Kalutara" }, { type: "visit", place: "Galle" }] });
    expect([roleOf(list[0]), roleOf(chosen[0]), roleOf(list[1])]).toEqual(["short", "visit", "visit"]);
    expect(roleOf(withRole(list[0], "in"))).toBe("in");
  });

  it("Options: each role's type and what; documents or other carried stay on a short stop or a visit", () => {
    const s = at("Matara", "visit");
    expect([withRole(s, "short").type, withRole(s, "short").what]).toEqual(["drop", ""]);
    expect([withRole(s, "in").type, withRole(s, "in").what]).toEqual(["pickup", "people"]);
    expect([withRole(s, "out").type, withRole(s, "out").what]).toEqual(["drop", "people"]);
    expect([withRole(s, "goods").type, withRole(s, "goods").what]).toEqual(["drop", "goods"]);
    expect([roleOf(withRole(s, "goods")), roleOf(withRole(s, "out")), roleOf(withRole(s, "short"))]).toEqual(["goods", "out", "short"]);
    expect([withRole({ ...s, type: "pickup" }, "goods").type]).toEqual(["pickup"]); // collecting goods stays a pickup
    expect(withRole({ ...s, what: "documents" }, "visit").what).toBe("documents");
    expect(withRole({ ...s, what: "other" }, "short").what).toBe("other");
    expect(withRole({ ...s, what: "people" }, "visit").what).toBe("");
    expect(withRole({ ...s, what: "people" }, "short").what).toBe("");
    expect(withRole(s, "short").typeSet).toBe(true);
    expect(STOP_ROLES).toEqual(["short", "in", "out", "visit", "goods"]);
  });

  it("a moved row takes its new place's type unless its type was chosen", () => {
    const list = withPositions([at("A"), at("B"), at("C")], true);
    expect(named(list)).toEqual(["drop:A", "drop:B", "visit:C"]);
    expect(named(moveStopTo(list, 2, 0, true))).toEqual(["drop:C", "drop:A", "visit:B"]);
    const chosen = [withRole(list[0], "in"), list[1], list[2]];
    expect(named(moveStopTo(chosen, 0, 2, true))).toEqual(["drop:B", "drop:C", "pickup:A"]);
    expect(named(moveStopTo(list, 2, 0))).toEqual(["drop:C", "drop:A", "drop:B"]); // one-way: To is the drop-off
    expect(moveStopTo(list, 0, 0)).toBe(list);
    expect(moveStopTo(list, 0, 5)).toBe(list);
  });

  it("✕ removes a row; the row before a removed To becomes To; one row always stays", () => {
    const list = [at("A"), at("B", "visit")];
    expect(named(removeStop(list, 1, true))).toEqual(["visit:A"]);
    expect(named(removeStop(list, 1))).toEqual(["drop:A"]);
    expect(named(removeStop(list, 0, true))).toEqual(["visit:B"]);
    expect(removeStop([at("A")], 0).map((s) => s.type)).toEqual(["drop"]);
    expect(removeStop([at("A")], 0, true).map((s) => s.type)).toEqual(["visit"]);
  });

  it("Next / Save draft: only the rows with nothing in them go once To has one; a row with data but no place stays and is named", () => {
    const list = [newStop("drop"), at("Kalutara"), newStop("drop"), at("Galle")];
    expect(named(tidyStops(list))).toEqual(["drop:Kalutara", "drop:Galle"]);
    expect(named(tidyStops(list, true))).toEqual(["drop:Kalutara", "visit:Galle"]);
    // An arrive-by, a note, a stay or what is carried keeps the row (Sahan, 30 October 2026): Next and Send name it.
    for (const data of [{ arriveBy: "10:00" }, { note: "Gate 2" }, { dwell: "15" }, { what: "goods" as const }]) {
      const kept = [at("Kalutara"), { ...newStop("drop"), ...data }, at("Galle")];
      expect(tidyStops(kept)).toBe(kept);
      expect(stopsInput(tidyStops(kept))).toEqual({ error: "Stop 2: add a place name (a saved place, a town, or an address) or a pin." });
    }
    const noTo = [at("Kalutara"), newStop("drop")];
    expect(tidyStops(noTo)).toBe(noTo);
    expect(stopsInput(noTo)).toEqual({ error: "Stop 2: add a place name (a saved place, a town, or an address) or a pin." });
    expect(stopsInput([newStop("drop")])).toEqual({ error: "Add at least one stop." });
    expect([hasPlace(newStop("drop")), hasPlace({ ...newStop("drop"), pin: "6.9, 79.8" }), hasPlace({ ...newStop("drop"), googlePlaceId: "g1" })]).toEqual([false, true, true]);
    const full = [at("Galle")];
    expect(tidyStops(full)).toBe(full);
  });

  it("an old draft or request with an empty stop opens without it; a row with data stays; a loaded type is kept", () => {
    const old = [{ ...newStop("pickup"), place: "" }, at("Galle")];
    expect(named(openStops(old))).toEqual(["drop:Galle"]);
    // Rows of an older draft (no typeSet): their types were picked on the form, so they stay.
    const typed = openStops([{ ...at("Office", "pickup"), typeSet: undefined }, { ...at("Galle"), typeSet: undefined }], true);
    expect(typed.map((s) => [s.type, !!s.typeSet])).toEqual([["pickup", true], ["drop", true]]);
    // The reviewer's case: a draft left with To empty; resumed, the last stop becomes To (a visit while it goes back).
    const left = [at("A"), at("B"), newStop("drop")];
    expect(named(openStops(left))).toEqual(["drop:A", "drop:B"]);
    expect(named(openStops(left, true))).toEqual(["drop:A", "visit:B"]);
    // A row with an arrive-by or a note but no place stays (named on Next).
    expect(named(openStops([at("A"), { ...newStop("drop"), arriveBy: "10:00" }, at("B")]))).toEqual(["drop:A", "drop:", "drop:B"]);
    // A task's stops keep their types on a move (Change stops): no silent change.
    const loaded = draftsFromStops([{ type: "drop", what: "people", place: "A" }, { type: "drop", what: "people", place: "B" }]);
    expect(named(moveStopTo(loaded, 1, 0, true))).toEqual(["drop:B", "drop:A"]);
    // A lone To added in the form with an arrive-by keeps it and follows its place.
    expect(openStops([{ ...newStop("pickup"), arriveBy: "10:00" }]).map((s) => [s.type, s.arriveBy])).toEqual([["drop", "10:00"]]);
    expect(openStops([{ ...newStop("pickup"), arriveBy: "10:00" }], true).map((s) => [s.type, s.arriveBy])).toEqual([["visit", "10:00"]]);
    expect(openStops([newStop("pickup"), newStop("drop")]).map((s) => s.type)).toEqual(["drop"]);
    expect(openStops([newStop("pickup"), newStop("drop")], true).map((s) => s.type)).toEqual(["visit"]);
    expect(named(draftsFromStops([{ type: "pickup", place: "" }, { type: "visit", place: "Kandy" }]))).toEqual(["visit:Kandy"]);
    expect(draftsFromStops([{ type: "visit", place: "Kandy" }])[0].typeSet).toBe(true); // a visit as the last stop stays a visit
  });

  it("Tick it re-types the rows left: a ticked To makes the stop before it To", () => {
    const list = [at("Kandy"), withRole(at("Head office"), "in")];
    expect(named(tickStart(list, 1).list)).toEqual(["drop:Kandy"]);
    expect(named(tickStart(list, 1, true).list)).toEqual(["visit:Kandy"]);
  });

  it("From's Options: Leave from here, People get in, Goods", () => {
    expect(startRoleOf({ startPax: false, startWhat: "" })).toBe("leave");
    expect(startRoleOf({ startPax: true, startWhat: "" })).toBe("in");
    expect(startRoleOf({ startPax: true, startWhat: "goods" })).toBe("goods");
    expect(withStartRole({ startWhat: "" }, "goods")).toEqual({ startPax: true, startWhat: "goods" });
    expect(withStartRole({ startWhat: "goods" }, "in")).toEqual({ startPax: true, startWhat: "" });
    expect(withStartRole({ startWhat: "documents" }, "leave")).toEqual({ startPax: false, startWhat: "documents" });
    expect(START_ROLES).toEqual(["leave", "in", "goods"]);
  });
});
