import { type Permission, PRESETS } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { allowed, MORE_KEYS, NAV, navState, ROUTES_NEED, TABS } from "./nav";

const locks = (me: { permissions: readonly Permission[] }) => Object.fromEntries(navState(NAV, { permissions: [...me.permissions] }).map((n) => [n.key, n.locked]));

describe("menu from permissions", () => {
  it("a requester-only person sees Requests, Projects and Settings open and the rest locked; the tab bar keeps only More", () => {
    const me = { permissions: PRESETS.requester.permissions };
    expect(locks(me)).toEqual({ overview: true, live: true, tasks: true, issues: true, requests: false, vehicles: true, projects: false, maintenance: true, mileage: true, drivers: true, settings: false });
    expect(allowed(TABS, me).map((t) => t.key)).toEqual(["more"]);
  });
  it("a viewer opens the counts, live locations, drivers, vehicles and own requests; tasks, maintenance and mileage are locked", () => {
    const me = { permissions: PRESETS.viewer.permissions };
    expect(locks(me)).toEqual({ overview: false, live: false, tasks: true, issues: true, requests: false, vehicles: false, projects: false, maintenance: true, mileage: true, drivers: false, settings: false });
    expect(allowed(TABS, me).map((t) => t.key)).toEqual(["overview", "live", "vehicles", "more"]);
  });
  it("a dispatcher opens the tasks board and the driver page, not maintenance or mileage; a fleet admin everything", () => {
    const dispatcher = { permissions: PRESETS.dispatcher.permissions };
    expect(locks(dispatcher).tasks).toBe(false);
    expect(locks(dispatcher).maintenance).toBe(true);
    expect(ROUTES_NEED.some((p) => dispatcher.permissions.includes(p))).toBe(true);
    expect(ROUTES_NEED.some((p) => PRESETS.viewer.permissions.includes(p))).toBe(false);
    expect(navState(NAV, { permissions: PRESETS.fleet_admin.permissions }).filter((n) => n.locked)).toEqual([]);
  });
  it("the More page lists what is not on the tab bar", () => {
    expect(MORE_KEYS).toEqual(["issues", "requests", "projects", "maintenance", "mileage", "drivers", "settings"]);
    expect(NAV.map((n) => n.key)).toContain("settings");
  });
});
