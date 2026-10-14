import { describe, expect, it } from "vitest";
import { defaultStops, draftsFromStops, driveText, hasDeadline, moveStop, newStop, parsePin, stopLabel, stopsInput } from "./stopsLogic";

describe("stops editor rules", () => {
  it("numbers every row within its type; adding or moving a row never changes another row's label type", () => {
    const list = [newStop("pickup"), newStop("drop"), newStop("drop"), newStop("visit")];
    expect(list.map((_, i) => stopLabel(list, i))).toEqual(["Pickup 1", "Drop-off 1", "Drop-off 2", "Visit 1"]);
    const added = [...list, newStop("pickup")];
    expect(added.map((_, i) => stopLabel(added, i))).toEqual(["Pickup 1", "Drop-off 1", "Drop-off 2", "Visit 1", "Pickup 2"]);
    expect(added.slice(0, 4).map((s) => s.type)).toEqual(list.map((s) => s.type));
    const moved = moveStop(added, 4, -1);
    expect(moved.map((_, i) => stopLabel(moved, i))).toEqual(["Pickup 1", "Drop-off 1", "Drop-off 2", "Pickup 2", "Visit 1"]);
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
