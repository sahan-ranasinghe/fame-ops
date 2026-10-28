import { describe, expect, it } from "vitest";
import { routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import { endPins, markFocus, routeMarks } from "./routeMarks";

const day = "2026-10-16";
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const answer: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 4, km: 20,
  stops_over_10_min: [{ from: "09:55", to: "14:00", minutes: 245, near: "Peliyagoda", lat: 6.96, lng: 79.89 }],
  route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")], ["14:56", 6.93, 79.86, 0, iso("14:56")]] },
  holes: [{ from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, kind: "no_data", text: "App not running · 56 min" }],
};

describe("a route's marks (Round 48: pins, dots, events)", () => {
  it("the first and last point are pins with their times; 'Latest' while today's line grows", () => {
    const r = routeOf("nuwan.p", answer);
    expect(endPins(r)).toEqual([
      { id: "start", kind: "start", lat: 6.88, lng: 79.86, text: "Start · 08:01" },
      { id: "end", kind: "end", lat: 6.93, lng: 79.86, text: "End · 14:56" },
    ]);
    expect(endPins(r, false, true)[1].text).toBe("Latest · 14:56");
    expect(endPins(null)).toEqual([]);
    // One point: the start pin alone.
    expect(endPins(routeOf("nuwan.p", { ...answer, route: { columns: answer.route!.columns, points: [answer.route!.points[0]] } }))).toHaveLength(1);
  });
  it("all the marks: the pins, the stop's dot, the gap's event; a tap's focus is the gap's positions or the mark's point", () => {
    const m = routeMarks(routeOf("nuwan.p", answer));
    expect(m.all.map((x) => x.kind)).toEqual(["start", "end", "stop", "no_data"]);
    expect(m.all[2].text).toBe("Stopped near Peliyagoda · 09:55–14:00 · 4 h 5 min");
    expect(m.rows).toHaveLength(1);
    expect(markFocus(m.rows[0].id, m)).toEqual([{ lat: 6.96, lng: 79.89 }, { lat: 6.93, lng: 79.86 }]);
    expect(markFocus("start", m)).toEqual([{ lat: 6.88, lng: 79.86 }]);
    expect(markFocus("nope", m)).toBeNull();
  });
});
