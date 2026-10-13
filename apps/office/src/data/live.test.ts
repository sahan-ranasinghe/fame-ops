import { driverStatus, needsAttention, statusText } from "@fleet/status";
import { describe, expect, it } from "vitest";
import { applyLatest, positionOf, recordedAtOf, refreshStates, statusFields, statusTone } from "./live";
import type { LiveDriver } from "./types";
import { projection } from "../map/DrawnMap";
import { routeOf } from "../screens/Live";

const now = new Date("2026-10-12T06:30:00Z"); // 12:00 in Colombo
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();
const base = { sharing: true, pointAt: null, heartbeatAt: null, locationOn: null, permission: null, locationOffSince: null };

describe("the one status rule (shared with the connector)", () => {
  it("live under 3 minutes, location off from a fresh heartbeat, no signal otherwise, not sharing when off", () => {
    expect(driverStatus({ ...base, pointAt: ago(2) }, now).status).toBe("live");
    expect(driverStatus({ ...base, pointAt: ago(5), heartbeatAt: ago(1), locationOn: false, permission: "always", locationOffSince: ago(4) }, now)).toMatchObject({ status: "location_off", since: ago(4) });
    expect(driverStatus({ ...base, pointAt: ago(20), heartbeatAt: ago(4), locationOn: true, permission: "always" }, now)).toMatchObject({ status: "no_signal", since: ago(4) });
    expect(driverStatus({ ...base, sharing: false, pointAt: ago(1) }, now).status).toBe("not_sharing");
  });
  it("writes the same sentences as the server", () => {
    expect(statusText(driverStatus({ ...base, pointAt: ago(2) }, now), now)).toBe("Live · 2 min");
    expect(statusText(driverStatus({ ...base, pointAt: ago(5), heartbeatAt: ago(1), locationOn: false, permission: "always", locationOffSince: ago(4) }, now), now)).toBe("Location off since 11:56");
    expect(statusText(driverStatus({ ...base, heartbeatAt: ago(1), locationOn: true, permission: "foreground", locationOffSince: ago(2) }, now), now)).toBe("Location permission removed since 11:58");
    expect(statusText(driverStatus({ ...base, pointAt: ago(9), heartbeatAt: ago(9) }, now), now)).toBe("No signal since 11:51");
  });
  it("flags a running task after 10 minutes without location", () => {
    const off = driverStatus({ ...base, pointAt: ago(15), heartbeatAt: ago(1), locationOn: false, permission: "always", locationOffSince: ago(12) }, now);
    expect(needsAttention(off, ago(60), now)).toBe(true);
    expect(needsAttention(driverStatus({ ...base, pointAt: ago(1) }, now), ago(60), now)).toBe(false);
  });
  it("colours: live blue, no signal amber, location off and not sharing red", () => {
    expect(statusTone("live")).toBe("live");
    expect(statusTone("no_signal")).toBe("warn");
    expect(statusTone("location_off")).toBe("bad");
    expect(statusTone("not_sharing")).toBe("bad");
    expect(statusTone(undefined, "sharing")).toBe("live");
  });
});

const card: LiveDriver = {
  driver: "Nuwan Perera", username: "nuwan.p", employee_id: "emp-1", state: "sharing", location: "Live · 2 min",
  status: "live", status_text: "Live · 2 min", last_position_at: "11:58",
  signal: { sharing: true, point_at: ago(2), heartbeat_at: ago(1), location_on: true, permission: "always", location_off_since: null },
  updated: "2026-10-12 11:58", vehicle: "WP CAB-4521 · Toyota HiAce", speed_kmh: 36, battery_pct: 80,
  links: { maps: "https://www.google.com/maps/search/?api=1&query=6.9,79.9", call: "tel:0771" },
};

describe("a Realtime row from driver_latest", () => {
  it("moves the matching driver and recomputes the status from the point", () => {
    const out = applyLatest([card, { ...card, username: "other", employee_id: "emp-2" }], {
      employee_id: "emp-1", lat: 7.0, lng: 80.0, speed_mps: 20, battery_pct: 79, recorded_at: ago(0.5), sharing: true,
    }, now);
    expect(out[0]).toMatchObject({ status: "live", status_text: "Live · 0 min", lat: 7.0, lng: 80.0, speed_kmh: 72, battery_pct: 79, last_position_at: "11:59" });
    expect(out[0].links?.maps).toContain("query=7,80");
    expect(out[1].lat).toBeUndefined();
  });
  it("a heartbeat saying Location off turns the card red at once, with since when", () => {
    const out = applyLatest([card], {
      employee_id: "emp-1", lat: 6.9, lng: 79.9, speed_mps: 0, battery_pct: 80, recorded_at: ago(5), sharing: true,
      hb_at: ago(0), hb_location_on: false, hb_permission: "always", hb_location_off_since: ago(3), hb_queued_points: 7, hb_app_version: "1.1.0",
    }, now);
    expect(out[0]).toMatchObject({ status: "location_off", status_text: "Location off since 11:57", queued_points: 7, app_version: "1.1.0", location_on: false, speed_kmh: undefined });
  });
  it("ignores a driver who is not on the list yet", () => {
    const list = [card];
    expect(applyLatest(list, { employee_id: "emp-9", lat: 7, lng: 80, speed_mps: 0, battery_pct: null, recorded_at: null, sharing: true }, now)).toBe(list);
  });
  it("turns a driver who switched off into not sharing", () => {
    const out = applyLatest([card], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0), sharing: false }, now);
    expect(out[0]).toMatchObject({ status: "not_sharing", status_text: "Not sharing", state: "not_sharing" });
  });
});

describe("the cards age with the clock", () => {
  it("live becomes no signal after 3 minutes without a point", () => {
    expect(recordedAtOf(card)).toBe(ago(2));
    const later = new Date(now.getTime() + 2 * 60000);
    const out = refreshStates([card], later);
    expect(out[0]).toMatchObject({ status: "no_signal", status_text: "No signal since 11:59", speed_kmh: undefined });
    expect(refreshStates([card], now)[0]).toBe(card); // nothing changed: same object
  });
  it("computes the fields of a card from its signal", () => {
    expect(statusFields({ sharing: true, point_at: ago(1), heartbeat_at: null, location_on: null, permission: null, location_off_since: null }, now))
      .toEqual({ status: "live", status_text: "Live · 1 min", status_since: "2026-10-12 11:59", last_position_at: "11:59" });
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
  });
  it("projects the island onto the drawn map the way the artifact did", () => {
    const { pr } = projection([], 1);
    const [x, y] = pr(80.7, 7.8);
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1000);
    expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(640);
  });
});
