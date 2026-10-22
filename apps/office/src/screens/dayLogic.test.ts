// §33.6 item 1 (Round 4–7): a driver's day as one summary card; the stops as pins whose card says where and how long.
import { describe, expect, it } from "vitest";
import { routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import { dayIsEmpty, daySummary, noGpsLine, stopPins, stopText } from "./dayLogic";

const day = "2026-10-21";
const answer: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 830, first_point: "06:12", last_point: "18:40", km: 141.6, driving_minutes: 200, stopped_minutes: 65, stops_count: 2,
  stops_over_10_min: [
    { from: "06:56", to: "07:15", minutes: 19, near: "Kurunegala", lat: 7.48, lng: 80.36 },
    { from: "12:00", to: "12:40", minutes: 40, lat: 7.3, lng: 80.6 },
    { from: "15:00", to: "15:20", minutes: 20, near: "Kandy" },
  ],
  gaps: [{ from: "09:00", to: "10:30", minutes: 90, kind: "no_gps" }, { from: "16:00", to: "16:40", minutes: 40, kind: "no_data" }],
};

describe("the day's summary card", () => {
  it("km, points, driving and stopped time, stops, first–last, and one line for the gaps", () => {
    expect(daySummary(routeOf("nuwan.p", answer))).toEqual({
      km: 141.6, points: 830, drivingMinutes: 200, stoppedMinutes: 65, stops: 2, first: "06:12", last: "18:40", noGps: "No GPS for 2 h 10 min", gaps: 2,
    });
  });
  it("no route yet: nothing; no gaps: no line", () => {
    expect(daySummary(null)).toBeNull();
    expect(daySummary(routeOf("nuwan.p", { ...answer, gaps: [] }))?.noGps).toBeNull();
    expect(noGpsLine([])).toBeNull();
    expect(noGpsLine([{ minutes: 0 }])).toBeNull();
    expect(noGpsLine([{ minutes: 25 }])).toBe("No GPS for 25 min");
  });
});

describe("a day with nothing recorded (the card's empty state)", () => {
  it("no point and no kept summary: empty; a day with points, or kept as a summary only, is not", () => {
    expect(dayIsEmpty(null)).toBe(false);
    expect(dayIsEmpty(routeOf("nuwan.p", { driver: "Nuwan Perera", date: day, recorded_points: 0, note: "No location was shared in this time." }))).toBe(true);
    expect(dayIsEmpty(routeOf("nuwan.p", answer))).toBe(false);
    expect(dayIsEmpty(routeOf("nuwan.p", { driver: "Nuwan Perera", date: day, km: 41.2, first_point: "06:12", last_point: "18:40", note: "Older than the location points are kept: the day's summary only (no line, no stops on a map)." } as DriverRoute))).toBe(false);
  });
});

describe("the stops as pins (Google Maps' visits)", () => {
  it("each stop with a position is a pin; its card says where, when and how long", () => {
    const pins = stopPins(routeOf("nuwan.p", answer));
    expect(pins.map((p) => [p.kind, p.text])).toEqual([
      ["stop", "Stopped near Kurunegala · 06:56–07:15 · 19 min"],
      ["stop", "Stopped · 12:00–12:40 · 40 min"],
    ]);
    expect(pins[0]).toMatchObject({ lat: 7.48, lng: 80.36 });
    expect(new Set(pins.map((p) => p.id)).size).toBe(2);
  });
  it("the words", () => {
    expect(stopText({ from: "06:56", to: "07:15", minutes: 19, near: "Kurunegala" })).toBe("Stopped near Kurunegala · 06:56–07:15 · 19 min");
    expect(stopText({ from: "06:56", to: "06:56", minutes: 0, near: null })).toBe("Stopped · 06:56 · 0 min");
    expect(stopText({ from: "08:00", to: "10:15", minutes: 135 })).toBe("Stopped · 08:00–10:15 · 2 h 15 min");
  });
  it("no route: no pins", () => {
    expect(stopPins(null)).toEqual([]);
  });
});
