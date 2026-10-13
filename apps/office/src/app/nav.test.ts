import { PRESETS } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { allowed, MORE_KEYS, NAV, navState, TABS } from "./nav";

describe("menu from permissions", () => {
  it("a requester-only person sees Requests, Projects and Settings open and the rest locked; the tab bar keeps only More", () => {
    const me = { permissions: PRESETS.requester.permissions };
    const state = Object.fromEntries(navState(NAV, me).map((n) => [n.key, n.locked]));
    expect(state).toEqual({ overview: true, live: true, tasks: true, requests: false, vehicles: true, projects: false, maintenance: true, mileage: true, drivers: true, settings: false });
    expect(allowed(TABS, me).map((t) => t.key)).toEqual(["more"]);
  });
  it("a viewer opens every fleet screen and Settings; Users inside Settings needs the users permission", () => {
    const me = { permissions: PRESETS.viewer.permissions };
    expect(navState(NAV, me).filter((n) => n.locked)).toEqual([]);
    expect(allowed(TABS, me).map((t) => t.key)).toEqual(["overview", "live", "tasks", "vehicles", "more"]);
  });
  it("the More page lists what is not on the tab bar", () => {
    expect(MORE_KEYS).toEqual(["requests", "projects", "maintenance", "mileage", "drivers", "settings"]);
    expect(NAV.map((n) => n.key)).toContain("settings");
  });
});
