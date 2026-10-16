import { describe, expect, it } from "vitest";
import { drawnLine, estimatedLegend, focusOf, insertPoint, mapRouteOf, mergeRoute, minutesText, routeOf, snapControl } from "./route";
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

describe("insertPoint: today's line grows point by point, each in its place by time", () => {
  const base = routeOf("nuwan.p", answer);
  const row = (at: string, lat: number, lng: number, accuracy: number | null = 8) => ({ employee_id: "e1", lat, lng, accuracy_m: accuracy, speed_mps: 10, heading: 90, recorded_at: iso(at) });
  it("appends a new point after the line with the speed of the step, and reads the accuracy", () => {
    const r = insertPoint(base, row("16:36", 6.94, 79.85));
    expect(r.points).toHaveLength(7);
    expect(r.points[6]).toMatchObject({ at: ms("16:36"), lat: 6.94, lng: 79.85, kmh: 19, acc: 8 });
    expect(r.count).toBe(831);
    expect(r.last).toBe("16:36");
    expect(r.km).toBe(base.km); // the km follow at the next refresh
  });
  it("puts a late point (a backlog) in the middle, where its time says", () => {
    const r = insertPoint(base, row("12:00", 6.961, 79.891));
    expect(r.points.map((p) => p.at)).toEqual([ms("08:01"), ms("09:55"), ms("12:00"), ms("14:00"), ms("14:56"), ms("15:38"), ms("16:31")]);
    expect(r.last).toBe("16:31");
  });
  it("ignores a point at a time the line already has, a fix worse than 150 m, and a jump", () => {
    expect(insertPoint(base, row("14:00", 7.0, 80.0))).toBe(base);
    expect(insertPoint(base, row("16:36", 6.94, 79.85, 200))).toBe(base);
    expect(insertPoint(base, row("16:32", 7.5, 80.8))).toBe(base); // 100 km in a minute
    const parked = insertPoint(insertPoint(base, row("14:10", 6.96, 79.89)), row("14:12", 6.96, 79.89));
    expect(parked.points).toHaveLength(8);
    expect(insertPoint(parked, row("14:10", 6.9606, 79.89)).points).toHaveLength(8); // 14:10 is taken: same time, ignored
    expect(insertPoint(parked, row("14:11", 6.9606, 79.89)).points).toHaveLength(8); // 66 m out and back within two minutes: a spike
    expect(insertPoint(parked, row("14:11", 6.9602, 79.89)).points).toHaveLength(9); // 22 m is under the spike size: kept
    expect(insertPoint(base, row("16:36", 6.94, 79.85, 120)).points).toHaveLength(7); // 120 m is drawn (lighter)
  });
});

describe("the map and the timeline rows", () => {
  const r = routeOf("nuwan.p", answer);
  it("zooms a stop to its place, a driving leg to its points, a gap to the positions around it", () => {
    expect(focusOf(r, r.timeline[1])).toEqual([{ lat: 6.96, lng: 79.89 }]);
    expect(focusOf(r, r.timeline[0]).map((p) => p.lat)).toEqual([6.88, 6.96]);
    expect(focusOf(r, r.timeline[2]).map((p) => p.lat)).toEqual([6.96, 6.96]);
  });
  it("draws the line by speed, the stops with their times, the tool's holes dashed with a label, and the playback marker", () => {
    const withHole = routeOf("nuwan.p", { ...answer, holes: [{ from_at: iso("15:38"), to_at: iso("16:31"), minutes: 53, kind: "no_gps", text: "Stopped · no GPS signal · 53 min" }] });
    const m = mapRouteOf(withHole, { lat: 6.9, lng: 79.9, label: "12:00 · 0 km/h" })!;
    expect(m.bySpeed).toBe(true);
    expect(m.stops).toEqual([{ lat: 6.96, lng: 79.89, label: "09:55–15:38" }]);
    expect(m.holes).toHaveLength(1);
    expect(m.holes![0].label).toBe("No GPS signal · 53 min");
    expect(m.holes![0].from).toMatchObject({ lat: 6.96, lng: 79.89 });
    expect(m.cursor?.label).toBe("12:00 · 0 km/h");
    // A thinned straight run (two line points far apart in time) is never a hole: only the tool's holes count.
    expect(mapRouteOf(r)!.holes).toHaveLength(0);
    expect(mapRouteOf(null)).toBeNull();
  });
  it("prefers the snapped line when asked and the tool gave one", () => {
    const snapped = routeOf("nuwan.p", {
      ...answer,
      route_snapped: { columns: ["time", "lat", "lng", "km/h", "at", "acc", "snapped"], points: [["08:01", 6.88, 79.86, 0, iso("08:01"), 8, 0], ["08:30", 6.9, 79.87, 30, iso("08:30"), null, 1], ["09:55", 6.96, 79.89, 38, iso("09:55"), 8, 0]] },
      snapped: { provider: "osrm", status: "ok", legs: 1, matched: 1 },
    });
    // The snapped line (to 09:55), then the recorded points after it (drawn raw until the next answer snaps them).
    expect(mapRouteOf(snapped, null, true)!.points).toHaveLength(3 + 4);
    expect(mapRouteOf(snapped, null, true)!.points[1].snapped).toBe(true);
    expect(drawnLine(snapped, true).slice(3).map((p) => p.at)).toEqual([ms("14:00"), ms("14:56"), ms("15:38"), ms("16:31")]);
    expect(mapRouteOf(snapped, null, false)!.points).toHaveLength(6);
    // A point Realtime adds today after the snapped line is drawn at once, raw.
    const grown = insertPoint(snapped, { employee_id: "e1", recorded_at: iso("16:36"), lat: 6.94, lng: 79.85, accuracy_m: 8, speed_mps: 10, heading: null });
    expect(drawnLine(grown, true).at(-1)).toMatchObject({ at: ms("16:36"), lat: 6.94 });
    expect(drawnLine(grown, false)).toBe(grown.points);
  });
  it("snap to roads: the toggle where a provider is set, and the legend's words (§26)", () => {
    const withProvider = (status: "off" | "ok" | "partial" | "failed", line = true) => routeOf("nuwan.p", {
      ...answer,
      snapped: { provider: "google_roads", status },
      ...(line ? { route_snapped: { columns: ["time", "lat", "lng", "km/h", "at", "acc", "snapped"], points: [["08:01", 6.88, 79.86, 0, iso("08:01"), 8, 0], ["09:55", 6.96, 79.89, 38, iso("09:55"), 8, 1]] } } : {}),
    });
    expect(snapControl(withProvider("ok"), true)).toEqual({ toggle: true, note: "Snapped to roads · km from odometer" });
    expect(snapControl(withProvider("partial"), true).note).toBe("Snapped to roads · km from odometer · some legs raw GPS");
    expect(snapControl(withProvider("failed"), true).note).toBe("Raw GPS (snapping to roads failed)");
    // Asked without snap the server answers status off with the provider: the toggle stays so it can be unticked.
    expect(snapControl(withProvider("off", false), false)).toEqual({ toggle: true, note: "Recorded points: the raw GPS line" });
    // No provider (the open package, the roads cap at 0): no toggle, no note.
    expect(snapControl(routeOf("nuwan.p", { ...answer, snapped: { provider: "none", status: "off" } }), true)).toEqual({ toggle: false, note: null });
    expect(snapControl(routeOf("nuwan.p", answer), true)).toEqual({ toggle: false, note: null });
    expect(snapControl(null, true)).toEqual({ toggle: false, note: null });
  });
  it("reads the stretches uploaded late", () => {
    const r = routeOf("nuwan.p", { ...answer, uploaded_later: [{ from: "15:38", to: "16:31", uploaded: "16:40", from_at: iso("15:38"), to_at: iso("16:31") }] });
    expect(r.late).toEqual([{ fromAt: ms("15:38"), toAt: ms("16:31"), from: "15:38", to: "16:31", uploaded: "16:40" }]);
    expect(routeOf("nuwan.p", answer).late).toEqual([]);
  });
  it("writes minutes the way the office reads them", () => {
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(60)).toBe("1 h");
    expect(minutesText(95)).toBe("1 h 35 min");
    expect(minutesText(undefined)).toBe("—");
  });
});

describe("the 60-second refetch merges into the line already drawn", () => {
  it("keeps the Realtime points the thinned answer does not carry, takes the numbers from the fresh answer", () => {
    const base = routeOf("nuwan.p", answer);
    // The live line: the tool's points plus three Realtime rows between and after them.
    let live = base;
    const rows: [string, number, number][] = [["08:02:30", 6.885, 79.862], ["08:03:10", 6.887, 79.863], ["16:31:40", 6.931, 79.861]];
    for (const [t, lat, lng] of rows) {
      live = insertPoint(live, { employee_id: "e1", recorded_at: `${day}T${t}+05:30`, lat, lng, accuracy_m: 5, speed_mps: 8, heading: null });
    }
    expect(live.points.length).toBe(base.points.length + 3);
    // The fresh answer: the same thinned line, a new km figure, and one point it already has at a Realtime time (its own position wins).
    const [first, ...rest] = answer.route!.points;
    const fresh = routeOf("nuwan.p", { ...answer, km: 43.9, recorded_points: 900, route: { columns: answer.route!.columns, points: [first, ["08:02", 6.886, 79.862, 12, `${day}T08:02:30+05:30`], ...rest] } });
    const merged = mergeRoute(live, fresh);
    expect(merged.points.length).toBe(fresh.points.length + 2);
    expect(merged.km).toBe(43.9);
    expect(merged.count).toBe(900);
    expect(merged.points.map((p) => p.at)).toEqual([...merged.points.map((p) => p.at)].sort((a, b) => a - b));
    const at0802 = merged.points.find((p) => p.at === Date.parse(`${day}T08:02:30+05:30`));
    expect(at0802?.lat).toBe(6.886);
    expect(merged.lineEndAt).toBe(Date.parse(`${day}T16:31:40+05:30`));
    // Another driver's answer is never merged in.
    expect(mergeRoute(live, routeOf("other", answer)).username).toBe("other");
  });
});

describe("estimated lines over gaps (Part 5b)", () => {
  const withGaps: DriverRoute = {
    ...answer,
    holes: [{ from_at: iso("15:38"), to_at: iso("16:31"), minutes: 53, kind: "no_gps", text: "Stopped · no GPS signal · 53 min" }],
    estimated: [
      { from_at: iso("08:01"), to_at: iso("09:55"), from: "08:01", to: "09:55", km_road: 12.4, points: [[6.88, 79.86], [6.92, 79.875], [6.96, 79.89]] },
      { from_at: iso("15:38"), to_at: iso("16:31"), from: "15:38", to: "16:31", points: [[6.96, 79.89], [6.95, 79.87], [6.93, 79.86]] },
    ],
  };
  it("a gap with an estimated road line is drawn along it, dashed: its straight step and its straight hole go, the hole's words stay", () => {
    const m = mapRouteOf(routeOf("nuwan.p", withGaps))!;
    expect(m.points.map((p) => !!p.gapBefore)).toEqual([false, true, false, false, false, true]);
    expect(m.holes).toEqual([]);
    expect(m.estimated!.map((e) => e.label)).toEqual(["estimated · 12.4 km road", "No GPS signal · 53 min · estimated"]);
    expect(m.estimated![0].points).toEqual([{ lat: 6.88, lng: 79.86 }, { lat: 6.92, lng: 79.875 }, { lat: 6.96, lng: 79.89 }]);
  });
  it("the legend says what the dashed slate lines are, and why some gaps stay straight", () => {
    expect(estimatedLegend(routeOf("nuwan.p", withGaps))).toBe("Dashed slate: 2 gaps in the GPS drawn along the likely road (estimated, not counted in km)");
    expect(estimatedLegend(routeOf("nuwan.p", { ...answer, estimated_note: "Estimated line limit reached for today: the other gaps are straight" })))
      .toBe("Estimated line limit reached for today: the other gaps are straight");
    expect(estimatedLegend(routeOf("nuwan.p", answer))).toBeNull();
  });
});
