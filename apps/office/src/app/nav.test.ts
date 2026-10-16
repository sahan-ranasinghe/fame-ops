import { type Permission, PRESETS } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { allowed, homeAction, moreFor, NAV, ROUTES_NEED, tabsFor } from "./nav";

const me = (permissions: readonly Permission[]) => ({ permissions: [...permissions] });
const keys = (items: { key: string }[]) => items.map((n) => n.key);
const labels = (items: { label: string }[]) => items.map((n) => n.label);

describe("menu from permissions", () => {
  it("a requester-only person opens Requests, Projects and Settings and sees nothing else", () => {
    expect(keys(allowed(NAV, me(PRESETS.requester.permissions)))).toEqual(["requests", "projects", "settings"]);
  });
  it("a viewer opens the counts, live locations, drivers, vehicles and own requests; a fleet admin everything", () => {
    expect(keys(allowed(NAV, me(PRESETS.viewer.permissions)))).toEqual(["overview", "live", "requests", "vehicles", "projects", "drivers", "settings"]);
    expect(keys(allowed(NAV, me(PRESETS.fleet_admin.permissions)))).toEqual(keys(NAV));
    expect(ROUTES_NEED.some((p) => PRESETS.dispatcher.permissions.includes(p))).toBe(true);
    expect(ROUTES_NEED.some((p) => PRESETS.viewer.permissions.includes(p))).toBe(false);
  });
});

describe("the phone tab bar: at most five, chosen from the permissions, More always last", () => {
  it("gives each role its tabs", () => {
    expect(labels(tabsFor(me(["view", "request"])))).toEqual(["Home", "My requests", "Map", "Vehicles", "More"]);
    expect(labels(tabsFor(me(PRESETS.fleet_admin.permissions)))).toEqual(["Home", "Requests", "Tasks", "Map", "More"]);
    expect(labels(tabsFor(me(PRESETS.dispatcher.permissions)))).toEqual(["Home", "Tasks", "My requests", "Map", "More"]);
    expect(labels(tabsFor(me(PRESETS.viewer.permissions)))).toEqual(["Home", "Map", "Vehicles", "Drivers", "More"]);
    expect(labels(tabsFor(me(PRESETS.requester.permissions)))).toEqual(["Home", "My requests", "More"]);
  });
  it("never shows a screen twice: More lists only what is not on the bar", () => {
    for (const preset of Object.values(PRESETS)) {
      const bar = keys(tabsFor(me(preset.permissions)));
      const more = keys(moreFor(me(preset.permissions)));
      expect(bar.filter((k) => more.includes(k))).toEqual([]);
      expect(new Set(bar).size).toBe(bar.length);
      expect(bar.length).toBeLessThanOrEqual(5);
      expect(bar[bar.length - 1]).toBe("more");
    }
    expect(keys(moreFor(me(PRESETS.fleet_admin.permissions)))).toEqual(["issues", "vehicles", "projects", "maintenance", "mileage", "fuel", "places", "drivers", "duty", "settings"]);
    expect(keys(moreFor(me(PRESETS.requester.permissions)))).toEqual(["projects", "settings"]);
  });
  it("the big Home action is the one thing the person does most", () => {
    expect(homeAction(me(PRESETS.requester.permissions))).toEqual({ label: "New request", path: "/requests/new" });
    expect(homeAction(me(["view", "request", "approve"]), 3)).toEqual({ label: "Requests to approve (3)", path: "/requests" });
    expect(homeAction(me(PRESETS.dispatcher.permissions))).toEqual({ label: "Assign a task", path: "/tasks/new" });
    expect(homeAction(me(PRESETS.fleet_admin.permissions), 0)).toEqual({ label: "Assign a task", path: "/tasks/new" });
    expect(homeAction(me(PRESETS.fleet_admin.permissions), 2)).toEqual({ label: "Requests to approve (2)", path: "/requests" });
    expect(homeAction(me(PRESETS.viewer.permissions))).toEqual({ label: "Live locations", path: "/live" });
    expect(homeAction(me([]))).toBeNull();
  });
});
