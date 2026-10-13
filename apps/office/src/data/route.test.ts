import { describe, expect, it } from "vitest";
import { appendLive, focusOf, mapRouteOf, minutesText, routeOf } from "./route";
import type { DriverRoute } from "./types";

const day = "2026-10-12";
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const ms = (hhmm: string) => Date.parse(iso(hhmm));

const answer: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 830, usable_points: 820, first_point: "08:01", last_point: "16:31", km: 41.2,
  driving_minutes: 95, stopped_minutes: 343, stops_count: 1,
  stops_over_10_min: [{ from: "09:55", to: "15:38", minutes: 343, near: "Peliyagoda", lat: 6.96, lng: 79.89 }],
  gaps: [{ from: "14:00", to: "14:56", minutes: 56 }],
  timeline: [
    { kind: "driving", from: "08:01", to: "09:55", from_at: iso("08:01"), to_at: iso("09:55"), minutes: 114, km: 31.1, text: "08:01–09:55 Driving · 31.1 km" },
    { kind: "stopped", from: "09:55", to: "14:00", from_at: iso("09:55"), to_at: iso("14:00"), minutes: 245, near: "Peliyagoda", lat: 6.96, lng: 79.89, text: "09:55–14:00 Stopped near Peliyagoda" },
    { kind: "no_data", from: "14:00", to: "14:56", from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, text: "14:00–14:56 No data" },
    { kind: "stopped", from: "14:56", to: "15:38", from_at: iso("14:56"), to_at: iso("15:38"), minutes: 42, near: "Peliyagoda", lat: 6.96, lng: 79.89, text: "14:56–15:38 Stopped near Peliyagoda" },
    { kind: "driving", from: "15:38", to: "16:31", from_at: iso("15:38"), to_at: iso("16:31"), minutes: 53, km: 10.1, text: "15:38–16:31 Driving · 10.1 km" },
  ],
  route: {
    columns: ["time", "lat", "lng", "km/h", "at"],
    points: [
      ["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")],
      ["14:56", 6.96, 79.89, 0, iso("14:56")], ["15:38", 6.96, 79.89, 0, iso("15:38")], ["16:31", 6.93, 79.86, 25, iso("16:31")],
    ],
  },
};

describe("routeOf", () => {
  it("reads the points with their times and speeds, the stops, the gaps and the timeline", () => {
    const r = routeOf("nuwan.p", answer);
    expect(r.points).toHaveLength(6);
    expect(r.points[1]).toEqual({ at: ms("09:55"), lat: 6.96, lng: 79.89, kmh: 38 });
    expect(r.stops[0].text).toBe("09:55–15:38 · near Peliyagoda · 343 min");
    expect(r.timeline.map((t) => t.kind)).toEqual(["driving", "stopped", "no_data", "stopped", "driving"]);
    expect(r.timeline[2].fromAt).toBe(ms("14:00"));
    expect(r).toMatchObject({ km: 41.2, count: 830, drivingMinutes: 95, stoppedMinutes: 343, stopsCount: 1, first: "08:01", last: "16:31" });
  });
  it("still reads an older answer with four columns and no timeline", () => {
    const r = routeOf("nuwan.p", { driver: "N", date: day, recorded_points: 2, route: { columns: ["time", "lat", "lng", "km/h"], points: [["08:01", 6.88, 79.86, 0], ["09:40", 7.33, 80.3, 54]] } });
    expect(r.points.map((p) => [p.lat, p.lng, p.kmh])).toEqual([[6.88, 79.86, 0], [7.33, 80.3, 54]]);
    expect(r.points[1].at).toBe(ms("09:40"));
    expect(r.timeline).toEqual([]);
    expect(r.stops).toEqual([]);
  });
});

describe("appendLive: today's line grows from the Realtime rows", () => {
  const base = routeOf("nuwan.p", answer);
  const row = (at: string, lat: number, lng: number, accuracy = 8) => ({ employee_id: "e1", lat, lng, speed_mps: 10, accuracy_m: accuracy, battery_pct: 80, recorded_at: iso(at), sharing: true });
  it("a precise position that moved becomes a new point with the speed of the step", () => {
    const r = appendLive(base, row("16:36", 6.94, 79.85));
    expect(r.points).toHaveLength(7);
    const p = r.points[6];
    expect(p.at).toBe(ms("16:36"));
    expect(p.kmh).toBe(19); // 1.6 km in 5 minutes
    expect(r.count).toBe(831);
    expect(r.km!).toBeGreaterThan(41.2);
    expect(r.last).toBe("16:36");
  });
  it("standing still only extends the wait at the last place", () => {
    const r1 = appendLive(base, row("16:36", 6.93001, 79.86001));
    expect(r1.points).toHaveLength(7);
    expect(r1.points[6]).toMatchObject({ lat: 6.93, lng: 79.86, kmh: 0, at: ms("16:36") });
    const r2 = appendLive(r1, row("16:40", 6.93002, 79.86));
    expect(r2.points).toHaveLength(7);
    expect(r2.points[6].at).toBe(ms("16:40"));
    expect(r2.km).toBe(base.km);
  });
  it("ignores a row older than the line, a coarse fix, and a row without a position", () => {
    expect(appendLive(base, row("16:00", 6.95, 79.87))).toBe(base);
    expect(appendLive(base, row("16:50", 6.95, 79.87, 120))).toBe(base);
    expect(appendLive(base, { ...row("16:50", 0, 0), lat: null, lng: null })).toBe(base);
  });
});

describe("the map and the timeline rows", () => {
  const r = routeOf("nuwan.p", answer);
  it("zooms a stop to its place, a driving leg to its points, a gap to the positions around it", () => {
    expect(focusOf(r, r.timeline[1])).toEqual([{ lat: 6.96, lng: 79.89 }]);
    expect(focusOf(r, r.timeline[0]).map((p) => p.lat)).toEqual([6.88, 6.96]);
    expect(focusOf(r, r.timeline[2]).map((p) => p.lat)).toEqual([6.96, 6.96]);
  });
  it("draws the line by speed, the stops with their times, the gaps dashed, and the playback marker", () => {
    const m = mapRouteOf(r, { lat: 6.9, lng: 79.9, label: "12:00 · 0 km/h" })!;
    expect(m.bySpeed).toBe(true);
    expect(m.stops).toEqual([{ lat: 6.96, lng: 79.89, label: "09:55–15:38" }]);
    expect(m.gaps).toHaveLength(1);
    expect(m.cursor?.label).toBe("12:00 · 0 km/h");
    expect(mapRouteOf(null)).toBeNull();
  });
  it("writes minutes the way the office reads them", () => {
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(95)).toBe("1 h 35 min");
    expect(minutesText(undefined)).toBe("—");
  });
});
