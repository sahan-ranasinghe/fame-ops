import { describe, expect, it } from "vitest";
import { applyLatest, positionOf, recordedAtOf, refreshStates, shareOf } from "./live";
import type { LiveDriver } from "./types";
import { projection } from "../map/DrawnMap";
import { routeOf } from "../screens/Live";

const now = new Date("2026-10-12T06:30:00Z"); // 12:00 in Colombo

describe("sharing state on the client (the server's rule)", () => {
  it("is live under 15 minutes, stale after, not sharing when off", () => {
    expect(shareOf(true, "2026-10-12T06:28:00Z", now)).toEqual({ state: "sharing", text: "Live · 2 min" });
    expect(shareOf(true, "2026-10-12T06:15:00Z", now)).toEqual({ state: "sharing", text: "Live · 15 min" }.state === "sharing" ? { state: "stale", text: "Last seen 15 min" } : { state: "stale", text: "Last seen 15 min" });
    expect(shareOf(true, "2026-10-12T04:00:00Z", now)).toEqual({ state: "stale", text: "Last seen 2 h" });
    expect(shareOf(true, null, now)).toEqual({ state: "stale", text: "Sharing · no location yet" });
    expect(shareOf(false, "2026-10-12T06:29:00Z", now)).toEqual({ state: "not_sharing", text: "Not sharing" });
  });
});

const card: LiveDriver = {
  driver: "Nuwan Perera", username: "nuwan.p", employee_id: "emp-1", state: "sharing", location: "Live · 2 min",
  updated: "2026-10-12 11:58", vehicle: "WP CAB-4521 · Toyota HiAce", speed_kmh: 36, battery_pct: 80,
  links: { maps: "https://www.google.com/maps/search/?api=1&query=6.9,79.9", call: "tel:0771" },
};

describe("a Realtime row from driver_latest", () => {
  it("moves the matching driver and recomputes their state", () => {
    const out = applyLatest([card, { ...card, username: "other", employee_id: "emp-2" }], {
      employee_id: "emp-1", lat: 7.0, lng: 80.0, speed_mps: 20, battery_pct: 79, recorded_at: "2026-10-12T06:29:30Z", sharing: true,
    }, now);
    expect(out[0]).toMatchObject({ state: "sharing", location: "Live · 0 min", lat: 7.0, lng: 80.0, speed_kmh: 72, battery_pct: 79, updated: "2026-10-12 11:59" });
    expect(out[0].links?.maps).toContain("query=7,80");
    expect(out[1]).toBe(out[1]); // untouched
    expect(out[1].lat).toBeUndefined();
  });
  it("ignores a driver who is not on the list yet", () => {
    const list = [card];
    expect(applyLatest(list, { employee_id: "emp-9", lat: 7, lng: 80, speed_mps: 0, battery_pct: null, recorded_at: null, sharing: true }, now)).toBe(list);
  });
  it("turns a driver who switched off into not sharing", () => {
    const out = applyLatest([card], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: "2026-10-12T06:29:30Z", sharing: false }, now);
    expect(out[0]).toMatchObject({ state: "not_sharing", location: "Not sharing", speed_kmh: undefined });
  });
});

describe("the states age with the clock", () => {
  it("reads the tool's Colombo time and goes stale after 15 minutes", () => {
    expect(recordedAtOf(card)).toBe("2026-10-12T11:58:00+05:30");
    const later = new Date("2026-10-12T06:45:00Z");
    const out = refreshStates([card], later);
    expect(out[0]).toMatchObject({ state: "stale", location: "Last seen 17 min", speed_kmh: undefined });
    expect(refreshStates([card], now)[0]).toBe(card); // same minute text: untouched
  });
});

describe("positions and routes", () => {
  it("takes lat/lng from the card, else from the maps link", () => {
    expect(positionOf({ ...card, lat: 6.95, lng: 79.95 })).toEqual({ lat: 6.95, lng: 79.95 });
    expect(positionOf(card)).toEqual({ lat: 6.9, lng: 79.9 });
    expect(positionOf({ ...card, links: {} })).toBeNull();
  });
  it("reads the route rows by column name", () => {
    const r = routeOf("nuwan.p", {
      driver: "Nuwan", date: "2026-10-12", recorded_points: 83, km: 41.2, first_point: "08:01", last_point: "09:40",
      stops_over_10_min: [{ from: "08:21", to: "08:33", minutes: 12, near: "Gampaha" }],
      route: { columns: ["time", "lat", "lng", "km/h"], points: [["08:01", 6.88, 79.86, 0], ["09:40", 7.33, 80.3, 54]] },
    });
    expect(r.points).toEqual([{ lat: 6.88, lng: 79.86 }, { lat: 7.33, lng: 80.3 }]);
    expect(r.stops).toEqual(["08:21–08:33 · Gampaha · 12 min"]);
    expect(r).toMatchObject({ km: 41.2, count: 83, first: "08:01", last: "09:40" });
  });
  it("projects the island onto the drawn map the way the artifact did", () => {
    const { pr } = projection([], 1);
    const [x, y] = pr(80.7, 7.8);
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1000);
    expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(640);
    const [x2] = pr(81.0, 7.8);
    expect(x2).toBeGreaterThan(x); // east is right
  });
});
