import { describe, expect, it } from "vitest";
import { ORS_CREDIT, routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import { estimatedSentence, infoSections, KM_SENTENCE, legendItems, visibleCredits } from "./routeInfo";

const day = "2026-10-16";
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const answer: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 830, km: 41.2, points_shown: 300,
  route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")]] },
  snapped: { provider: "google_roads", status: "ok" },
  route_snapped: { columns: ["time", "lat", "lng", "km/h", "at", "acc", "snapped"], points: [["08:01", 6.88, 79.86, 0, iso("08:01"), 5, 0], ["09:55", 6.96, 79.89, 38, iso("09:55"), 5, 0]] },
};
const withEstimated: DriverRoute = { ...answer, estimated: [{ from_at: iso("08:01"), to_at: iso("09:55"), from: "08:01", to: "09:55", km_road: 9.1, points: [[6.88, 79.86], [6.96, 79.89]] }] };

describe("the route map's words (Round 48: a compact legend row and the ⓘ sheet)", () => {
  it("the compact row: the speed colours, poor fix, gap, the pins and the dot; estimated only when drawn", () => {
    expect(legendItems(routeOf("n", answer)).map((i) => i.text)).toEqual(["Standing", "<20 km/h", "20–60", ">60", "Poor fix", "Gap", "Stop"]);
    expect(legendItems(routeOf("n", withEstimated)).map((i) => i.key)).toContain("estimated");
    expect(legendItems(null)).toHaveLength(7);
  });
  it("openrouteservice's credit stays visible with the row whenever one of its lines is drawn", () => {
    expect(visibleCredits(routeOf("n", answer))).toEqual([]);
    expect(visibleCredits(routeOf("n", withEstimated))).toEqual([ORS_CREDIT]);
    expect(estimatedSentence(routeOf("n", withEstimated))).toBe("Dashed slate: 1 gap in the GPS drawn along the likely road (estimated, not counted in km)");
  });
  it("the sheet keeps every sentence that was under the map: the colours, the marks and the layer, the gaps, the line, the km, the credits", () => {
    const s = infoSections(routeOf("n", withEstimated), true, { map: "free", events: false });
    expect(s.map((x) => x.title)).toEqual(["Line colours", "Marks", "Gaps", "The line and the km", "Credits"]);
    const all = s.flatMap((x) => x.lines).join("\n");
    expect(all).toContain("Thin and lighter: a poor fix (worse than 30 m)");
    expect(all).toContain("Events (no GPS signal, the app not running, recorded offline and uploaded later) are off: Filter → Layers → Events");
    expect(all).toContain("one numbered circle until you zoom in");
    expect(all).toContain("Dashed slate: 1 gap in the GPS drawn along the likely road (estimated, not counted in km).");
    expect(all).toContain("Snapped to roads · km from odometer.");
    // Sahan (Checkpoint 48): no "Line: N of M points" sentence; the pins need no legend row.
    expect(all).not.toContain("points.");
    expect(all).toContain(KM_SENTENCE);
    expect(all).toContain("© OpenStreetMap contributors · OpenFreeMap");
    expect(all).toContain(ORS_CREDIT);
    // Google's map names its own logo and terms; the events line says "on" when the layer is on.
    const g = infoSections(routeOf("n", answer), false, { map: "google", events: true }).flatMap((x) => x.lines).join("\n");
    expect(g).toContain("Map: Google Maps (its logo and terms are on the map).");
    expect(g).toContain("are on: Filter → Layers → Events");
    expect(g).toContain("Recorded points: the raw GPS line.");
    expect(g).not.toContain(ORS_CREDIT);
  });
  it("no route yet: the general sections only", () => {
    const s = infoSections(null, true, {});
    expect(s.map((x) => x.title)).toEqual(["Line colours", "Marks", "Gaps", "Credits"]);
  });
});
