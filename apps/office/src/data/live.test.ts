import { driverStatus, needsAttention, statusText } from "@fleet/status";
import { describe, expect, it } from "vitest";
import {
  applyLatest,
  canClockOut,
  canMoveVehicle,
  clockOutLine,
  dutyLine,
  dutyOf,
  filterCounts,
  hasProblem,
  inFilter,
  liveTone,
  onMap,
  positionOf,
  recordedAtOf,
  refreshStates,
  statusFields,
  statusLine,
  statusTone,
} from "./live";
import type { LiveDriver } from "./types";
import { projection } from "../map/DrawnMap";
import { routeOf } from "./route";

const now = new Date("2026-10-12T06:30:00Z"); // 12:00 in Colombo
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();
const base = { sharing: true, pointAt: null, heartbeatAt: null, locationOn: null, permission: null, locationOffSince: null };

describe("the one status rule (shared with the connector)", () => {
  it("live under 3 minutes, location off from a fresh heartbeat, no signal otherwise, not sharing (off duty) when off", () => {
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
  it("turns a driver who switched off into off duty", () => {
    const out = applyLatest([card], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0), sharing: false }, now);
    expect(out[0]).toMatchObject({ status: "not_sharing", status_text: "Off duty", state: "not_sharing", location: "Off duty" });
    expect(statusLine(out[0])).toBe("Off duty");
  });
});

const onDuty: LiveDriver = { ...card, duty: "on_duty", duty_text: "On duty", duty_since: "08:02", on_duty_since: "08:02", vehicle_since: "08:40" };
const offDuty: LiveDriver = {
  ...card, username: "kamal", employee_id: "emp-3", duty: "off_duty", duty_text: "Off duty", duty_since: "17:40", off_duty_how: "auto at the cut-off",
  state: "not_sharing", status: "not_sharing", status_text: "Off duty", vehicle: undefined,
  signal: { sharing: false, point_at: ago(120), heartbeat_at: ago(120), location_on: true, permission: "always", location_off_since: null },
};
const onTask: LiveDriver = { ...card, username: "sunil", employee_id: "emp-4", duty: "on_task", duty_text: "On a task", duty_since: "09:10", task: "Team drop", task_id: "t-1" };
const noSignal: LiveDriver = { ...onDuty, username: "ruwan", employee_id: "emp-5", status: "no_signal", status_text: "No signal since 11:51" };
const locationOff: LiveDriver = { ...onTask, username: "saman", employee_id: "emp-6", status: "location_off", status_text: "Location off since 11:56" };

describe("duty (Phase 7)", () => {
  it("a Realtime row with sharing off: off duty at once, the old since times and the vehicle dropped until the next answer", () => {
    const out = applyLatest([onDuty], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0), sharing: false }, now);
    expect(out[0]).toMatchObject({ duty: "off_duty", duty_text: "Off duty", status_text: "Off duty", duty_since: undefined, on_duty_since: undefined, vehicle: undefined, vehicle_since: undefined });
    expect(dutyLine(out[0])).toBe("Off duty");
  });
  it("a card on a task stays on a task when sharing goes off", () => {
    const out = applyLatest([onTask], { employee_id: "emp-4", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0), sharing: false }, now);
    expect(out[0]).toMatchObject({ duty: "on_task", duty_since: "09:10", vehicle: onTask.vehicle, status_text: "Off duty" });
  });
  it("an off-duty driver who starts work is on duty at once; since when comes with the next answer", () => {
    const out = applyLatest([offDuty], { employee_id: "emp-3", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0.5), sharing: true }, now);
    expect(out[0]).toMatchObject({ duty: "on_duty", duty_text: "On duty", duty_since: undefined, off_duty_how: undefined, status: "live" });
  });
  it("a row for a driver already on duty leaves the duty alone", () => {
    const out = applyLatest([onDuty], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 5, battery_pct: 50, recorded_at: ago(0.5), sharing: true }, now);
    expect(out[0]).toMatchObject({ duty: "on_duty", duty_since: "08:02", vehicle_since: "08:40", vehicle: card.vehicle });
  });
  it("an answer from before Phase 7 (no duty) keeps its fields; the duty is read from the task and sharing", () => {
    const out = applyLatest([card], { employee_id: "emp-1", lat: 7, lng: 80, speed_mps: 0, battery_pct: 50, recorded_at: ago(0), sharing: false }, now);
    expect(out[0].duty).toBeUndefined();
    expect(dutyOf(out[0])).toBe("off_duty");
    expect(dutyOf(card)).toBe("on_duty");
    expect(dutyOf({ ...card, task: "Team drop" })).toBe("on_task");
    expect(dutyOf({ ...card, signal: undefined, state: "not_sharing" })).toBe("off_duty");
  });
  it("the duty chip's words: since when, and how an off duty began", () => {
    expect(dutyLine(onTask)).toBe("On a task · since 09:10");
    expect(dutyLine(onDuty)).toBe("On duty · since 08:02");
    expect(dutyLine(offDuty)).toBe("Off duty · since 17:40 · auto at the cut-off");
    expect(dutyLine({ ...card, signal: undefined, state: "not_sharing" })).toBe("Off duty");
  });
  it("colours: off duty grey, on duty the signal's colour", () => {
    expect(liveTone(offDuty)).toBe("muted");
    expect(liveTone(onDuty)).toBe("live");
    expect(liveTone(noSignal)).toBe("warn");
    expect(liveTone(locationOff)).toBe("bad");
  });
  it("the chips: each duty on its own (they add up to All), Problems = no signal or location off while on duty", () => {
    const list = [onDuty, offDuty, onTask, noSignal, locationOff];
    expect(filterCounts(list)).toEqual({ all: 5, on_task: 2, on_duty: 2, off_duty: 1, problems: 2 });
    expect(list.filter((d) => inFilter(d, "problems")).map((d) => d.username)).toEqual(["ruwan", "saman"]);
    expect(list.filter((d) => inFilter(d, "on_duty")).map((d) => d.username)).toEqual(["nuwan.p", "ruwan"]);
    expect(hasProblem({ ...offDuty, status: "no_signal" })).toBe(false);
    expect(hasProblem({ ...card, status: undefined, state: "stale" })).toBe(true);
  });
  it("the map draws drivers on duty or on a task, never off duty", () => {
    expect([onDuty, offDuty, onTask].filter(onMap).map((d) => d.username)).toEqual(["nuwan.p", "sunil"]);
  });
  it("Clock out only for a driver on duty without a task; Move to vehicle on duty, or on a task as a swap", () => {
    expect(canClockOut(onDuty)).toBe(true);
    expect(canClockOut(onTask)).toBe(false);
    expect(canClockOut(offDuty)).toBe(false);
    expect(canMoveVehicle(onDuty)).toBe(true);
    expect(canMoveVehicle(onTask)).toBe(true);
    expect(canMoveVehicle(offDuty)).toBe(false);
  });
  it("the line after Clock out", () => {
    expect(clockOutLine({ clocked_out: "Kamal Perera", at: "2026-10-15 17:40", note: "The driver's phone gets a push and stops recording location." }))
      .toBe("Kamal Perera is off duty since 17:40. The driver's phone gets a push and stops recording location.");
    expect(clockOutLine({ clocked_out: false, note: "Kamal Perera is already off duty." })).toBe("Kamal Perera is already off duty.");
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
    const fields = statusFields({ sharing: true, point_at: ago(1), heartbeat_at: null, location_on: null, permission: null, location_off_since: null }, now);
    expect(fields).toMatchObject({ status: "live", status_text: "Live · 1 min", status_since: "2026-10-12 11:59", last_position_at: "11:59" });
    expect(fields.last_position_time).toMatch(/^11:59:\d\d$/);
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
    expect(r.points).toMatchObject([{ lat: 6.88, lng: 79.86 }, { lat: 7.33, lng: 80.3, kmh: 54 }]);
    expect(r.stops.map((s) => s.text)).toEqual(["08:21–08:33 · near Gampaha · 12 min"]);
  });
  it("projects the island onto the drawn map the way the artifact did", () => {
    const { pr } = projection([], 1);
    const [x, y] = pr(80.7, 7.8);
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1000);
    expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(640);
  });
});
