// Round 50 (29 October 2026, phase8-plan.md §37.3, §37.5): the office's view of a self trip on the site, as rules: Self-drive
// for an app or web trip, Live's "Web trip · last seen at …" (never Live), the web trip's straight dashed line and its
// marks on the route views (never a GPS line, never km), the legend and the ⓘ sheet, Can drive's line.
import { describe, expect, it } from "vitest";
import { canDriveHint } from "../screens/settings/usersLogic";
import { dayIsEmpty } from "../screens/dayLogic";
import { infoSections, legendItems } from "../screens/routeInfo";
import { routeMarks } from "../screens/routeMarks";
import { drivenByWord } from "../ui/driverRowLogic";
import { liveStatusText, liveToneOf } from "./live";
import { mapRouteOf, routeOf } from "./route";
import type { DriverRoute, LiveDriver, WebPoint } from "./types";
import { isSelfDriveTrip, selfDriveLine, WEB_LINE_TEXT, webLinePoints, webMarkText, webTripSeen } from "./webTrip";

const points: WebPoint[] = [
  { at: "2026-10-29T03:10:00Z", time: "08:40", lat: 6.91, lng: 79.86, action: "arrive", stop: "Head office" },
  { at: "2026-10-29T02:42:00Z", time: "08:12", lat: 6.9, lng: 79.85, action: "start" },
  { at: "2026-10-29T03:15:00Z", time: "08:45", lat: 6.91, lng: 79.86, action: "leave", stop: "Head office" },
  { at: "2026-10-29T05:42:00Z", time: "11:12", lat: 7.49, lng: 80.36, action: "finish" },
];
const answer: DriverRoute = { driver: "nimali", date: "2026-10-29", recorded_points: 0, web_trip: true, web_points: points } as DriverRoute;

describe("Self-drive (§37.3)", () => {
  it("an app or web trip says Self-drive; the office path and a trip with no app do not", () => {
    expect(isSelfDriveTrip({ driven_in: "app" })).toBe(true);
    expect(isSelfDriveTrip({ driven_in: "web" })).toBe(true);
    expect(isSelfDriveTrip({ self_drive: true })).toBe(true);
    expect(isSelfDriveTrip({ self_drive: true, driven_in: "office" })).toBe(false);
    expect(isSelfDriveTrip({ driven_by: "self" })).toBe(false);
    expect(drivenByWord("self", true)).toBe("Self-drive");
    expect(drivenByWord("self")).toBe("Drives themselves");
    expect(drivenByWord("other", true)).toBe("Someone else");
  });

  it("the board's line: \"Drives themselves · no app\" reads Self-drive on such a trip, anything else as it came", () => {
    expect(selfDriveLine("Drives themselves · no app", { driven_by: "self", driven_in: "web" })).toBe("Self-drive");
    expect(selfDriveLine("Drives themselves · no app", { driven_by: "self" })).toBe("Drives themselves · no app");
    expect(selfDriveLine("Seen by driver 08:10", { driven_by: "self", driven_in: "app" })).toBe("Seen by driver 08:10");
  });
});

describe("Live: a web trip (§37.3)", () => {
  const card = { driver: "Nimali", username: "nimali", state: "not_sharing", duty: "on_task", task: "Site visit", status: "not_sharing", status_text: "Not sharing", self_drive: true, web_trip: true, last_seen: { at: "10:42", stop: "Kurunegala site" } } as LiveDriver;
  it("never the Live state: \"Web trip · last seen at <stop> HH:MM\", grey", () => {
    expect(webTripSeen(card)).toBe("Web trip · last seen at Kurunegala site 10:42");
    expect(liveStatusText(card)).toBe("Web trip · last seen at Kurunegala site 10:42");
    expect(liveToneOf(card)).toBe("muted");
    expect(webTripSeen({ web_trip: true, last_seen: { at: "10:42" } })).toBe("Web trip · last seen 10:42");
    expect(webTripSeen({ web_trip: true })).toBe("Web trip · no position yet");
  });
  it("any other card as before", () => {
    const other = { ...card, web_trip: undefined, last_seen: undefined, status: "live", status_text: "Live · 1 min", state: "sharing" } as LiveDriver;
    expect(webTripSeen(other)).toBeNull();
    expect(liveStatusText(other)).toBe("Live · 1 min");
  });
});

describe("the web trip on the route views (§37.5)", () => {
  it("one straight line in time order, a repeated place once; one point is no line", () => {
    expect(webLinePoints(points)).toEqual([{ lat: 6.9, lng: 79.85 }, { lat: 6.91, lng: 79.86 }, { lat: 7.49, lng: 80.36 }]);
    expect(webLinePoints(points.slice(0, 1))).toEqual([]);
  });

  it("a day with only a web trip: the map route is that line alone (no GPS points, no km), labelled", () => {
    const route = routeOf("nimali", answer);
    const map = mapRouteOf(route);
    expect(map?.points).toEqual([]);
    expect(map?.web).toEqual({ points: webLinePoints(points), label: WEB_LINE_TEXT });
    expect(WEB_LINE_TEXT).toBe("No live route · web trip");
    expect(dayIsEmpty(route)).toBe(false);
    expect(mapRouteOf(routeOf("nimali", { ...answer, web_points: [] }))).toBeNull();
  });

  it("the actions are dots with their words, the same card as a stop's", () => {
    const marks = routeMarks(routeOf("nimali", answer)).all;
    expect(marks.map((m) => [m.id, m.kind, m.text])).toEqual([
      ["web:0", "stop", "Started · 08:12"],
      ["web:1", "stop", "Arrived · Head office · 08:40"],
      ["web:2", "stop", "Left · Head office · 08:45"],
      ["web:3", "stop", "Finished · 11:12"],
    ]);
    expect(webMarkText({ action: "finish", time: "16:31" })).toBe("Finished · 16:31");
  });

  it("the legend row and the ⓘ sheet say what the line is", () => {
    const route = routeOf("nimali", answer);
    expect(legendItems(route).at(-1)).toEqual({ key: "web", text: "No live route · web trip" });
    const sheet = infoSections(route, false);
    expect(sheet.find((s) => s.title === "No live route · web trip")?.lines[0]).toMatch(/straight dashed lines\. Not the road, and no km from them\./);
    const gpsOnly = routeOf("kamal", { ...answer, web_points: undefined, web_trip: undefined });
    expect(legendItems(gpsOnly).some((x) => x.key === "web")).toBe(false);
  });
});

describe("Can drive's line (§37.1)", () => {
  it("on, taken away, never decided; and when Driving mode is off for everyone", () => {
    expect(canDriveHint({ name: "Nimali", can_drive: true })).toBe("Nimali drives their own trips with the driver screens, sharing location only during the trip.");
    expect(canDriveHint({ name: "Nimali", can_drive: false })).toBe("Nimali's own trips use My trip's vehicle check and odometer, with no tracking.");
    expect(canDriveHint({ name: "Nimali" })).toBe("Not decided yet: it is switched on when a self-drive trip is made for Nimali.");
    expect(canDriveHint({ name: "Nimali", can_drive: true }, false)).toMatch(/Driving mode is off for everyone/);
  });
});
