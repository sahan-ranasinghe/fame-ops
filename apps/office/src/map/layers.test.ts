import { describe, expect, it } from "vitest";
import { readFilters, writeFilters } from "../ui/filterLogic";
import { eventsOn, isEvent, isPin, LAYERS_DEF, visibleMarks, withEvents } from "./layers";
import type { GapMarker } from "./types";

const marks: GapMarker[] = [
  { id: "start", kind: "start", lat: 6.9, lng: 79.9, text: "Start · 08:01" },
  { id: "stop:0", kind: "stop", lat: 6.95, lng: 79.9, text: "Stopped near Kelaniya · 09:00–09:20 · 20 min" },
  { id: "no_data-1", kind: "no_data", lat: 6.96, lng: 79.9, text: "App not running · 14:00–14:56 · 56 min" },
  { id: "late-2", kind: "late", lat: 6.97, lng: 79.9, text: "Offline here · 09:55 · uploaded 10:20" },
  { id: "end", kind: "end", lat: 6.98, lng: 79.9, text: "End · 16:31" },
];

describe("the map's layers (Round 48)", () => {
  it("events are off by default: the pins and the stops show, the event marks do not", () => {
    expect(eventsOn(readFilters(new URLSearchParams(""), [LAYERS_DEF]))).toBe(false);
    expect(visibleMarks(marks, false, null).map((m) => m.id)).toEqual(["start", "stop:0", "end"]);
    expect(isEvent("no_gps")).toBe(true);
    expect(isEvent("stop")).toBe(false);
    expect(isPin("end")).toBe(true);
  });
  it("?layers=events turns them on; Apply writes it and the default leaves no trace", () => {
    const on = readFilters(new URLSearchParams("layers=events"), [LAYERS_DEF]);
    expect(eventsOn(on)).toBe(true);
    expect(visibleMarks(marks, true, null)).toHaveLength(5);
    expect(writeFilters(new URLSearchParams(""), [LAYERS_DEF], withEvents({}, true)).toString()).toBe("layers=events");
    expect(writeFilters(new URLSearchParams("layers=events"), [LAYERS_DEF], withEvents(on, false)).toString()).toBe("");
  });
  it("the open mark is drawn while the layer is off (a tapped gap row still highlights its spot)", () => {
    expect(visibleMarks(marks, false, "late-2").map((m) => m.id)).toEqual(["start", "stop:0", "late-2", "end"]);
  });
});
