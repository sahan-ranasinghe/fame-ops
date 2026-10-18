import { type Permission, PRESETS } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { allowed, homeAction, menuFor, moreFor, NAV, NAV_SECTIONS, ROUTES_NEED, tabRole, tabsFor } from "./nav";

const me = (permissions: readonly Permission[]) => ({ permissions: [...permissions] });
const keys = (items: { key: string }[]) => items.map((n) => n.key);
const labels = (items: { label: string }[]) => items.map((n) => n.label);

describe("menu from permissions", () => {
  it("a requester sees what a viewer sees (any permission implies view, Phase 7 §12), plus My trips (Hotfix 2, A)", () => {
    const viewer = keys(allowed(NAV, me(PRESETS.viewer.permissions)));
    expect(keys(allowed(NAV, me(PRESETS.requester.permissions)))).toEqual([...viewer.slice(0, 3), "my_trips", ...viewer.slice(3)]);
    expect(keys(allowed(NAV, me(["request"])))).toEqual(["requests", "my_trips", "projects", "settings"]);
    // assign_tasks alone brings My trips too (the tasks the person proposed or made).
    expect(keys(allowed(NAV, me(["assign_tasks"])))).toContain("my_trips");
  });
  it("a viewer opens the counts, live locations, drivers, vehicles and own requests; a fleet admin everything", () => {
    expect(keys(allowed(NAV, me(PRESETS.viewer.permissions)))).toEqual(["overview", "live", "requests", "vehicles", "drivers", "projects", "settings"]);
    expect(keys(allowed(NAV, me(PRESETS.fleet_admin.permissions)))).toEqual(keys(NAV));
    expect(ROUTES_NEED.some((p) => PRESETS.dispatcher.permissions.includes(p))).toBe(true);
    expect(ROUTES_NEED.some((p) => PRESETS.viewer.permissions.includes(p))).toBe(false);
  });
});

describe("the desktop menu in sections (Hotfix 3, L5)", () => {
  it("Today · Fleet · Reports · Admin, every screen in exactly one section", () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(["Today", "Fleet", "Reports", "Admin"]);
    const inSections = NAV_SECTIONS.flatMap((s) => s.keys);
    expect([...inSections].sort()).toEqual(keys(NAV).sort());
    expect(new Set(inSections).size).toBe(inSections.length);
    const admin = menuFor(me(PRESETS.fleet_admin.permissions));
    expect(admin.map((s) => [s.key, keys(s.items)])).toEqual([
      ["today", ["overview", "live", "tasks", "requests", "my_trips", "issues"]],
      ["fleet", ["vehicles", "drivers", "places", "maintenance"]],
      ["reports", ["mileage", "fuel", "duty"]],
      ["admin", ["projects", "settings"]],
    ]);
  });
  it("each person sees only what their permissions allow; an empty section is left out", () => {
    expect(menuFor(me(PRESETS.viewer.permissions)).map((s) => [s.key, keys(s.items)])).toEqual([
      ["today", ["overview", "live", "requests"]],
      ["fleet", ["vehicles", "drivers"]],
      ["admin", ["projects", "settings"]],
    ]);
    expect(menuFor(me(PRESETS.dispatcher.permissions)).map((s) => [s.key, keys(s.items)])).toEqual([
      ["today", ["overview", "live", "tasks", "requests", "my_trips", "issues"]],
      ["fleet", ["vehicles", "drivers"]],
      ["reports", ["duty"]],
      ["admin", ["projects", "settings"]],
    ]);
    expect(menuFor(me(["request"])).map((s) => [s.key, keys(s.items)])).toEqual([["today", ["requests", "my_trips"]], ["admin", ["projects", "settings"]]]);
  });
});

describe("the phone tab bar: Home, the four most used for the role, More", () => {
  it("gives each role its tabs (Hotfix 3 question 6)", () => {
    expect(labels(tabsFor(me(PRESETS.fleet_admin.permissions)))).toEqual(["Home", "Requests", "Tasks", "Live", "More"]);
    expect(labels(tabsFor(me(PRESETS.dispatcher.permissions)))).toEqual(["Home", "Tasks", "Live", "Issues", "More"]);
    expect(labels(tabsFor(me(PRESETS.requester.permissions)))).toEqual(["Home", "My trips", "Vehicles", "Live", "More"]);
    expect(labels(tabsFor(me(PRESETS.viewer.permissions)))).toEqual(["Home", "Live", "Vehicles", "Drivers", "More"]);
    // Every permission (an admin) is an approver.
    expect(labels(tabsFor(me(["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"])))).toEqual(["Home", "Requests", "Tasks", "Live", "More"]);
    expect(tabsFor(me(PRESETS.requester.permissions)).find((t) => t.key === "my_trips")).toEqual({ key: "my_trips", label: "My trips", need: ["request"], path: "/my-trips" });
  });
  it("mixed permissions: a role's tab the person cannot open is replaced from the fill order", () => {
    expect(tabRole(me(["view", "request", "approve"]))).toBe("approver");
    // An approver without assign_tasks: no Tasks; My trips shares the Requests slot; Vehicles fills.
    expect(labels(tabsFor(me(["view", "request", "approve"])))).toEqual(["Home", "Requests", "Live", "Vehicles", "More"]);
    // A dispatcher who cannot ask (no request): the same three.
    expect(labels(tabsFor(me(["view", "assign_tasks"])))).toEqual(["Home", "Tasks", "Live", "Issues", "More"]);
    // Request without view: only My trips.
    expect(labels(tabsFor(me(["request"])))).toEqual(["Home", "My trips", "More"]);
    // Issues and view (no tasks, no requests): the viewer's bar; Issues is under More.
    expect(labels(tabsFor(me(["view", "issues"])))).toEqual(["Home", "Live", "Vehicles", "Drivers", "More"]);
    expect(keys(moreFor(me(["view", "issues"])))).toContain("issues");
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
    // In the menu's order; Task history sits where Tasks is. An approver finds My trips under More.
    expect(keys(moreFor(me(PRESETS.fleet_admin.permissions)))).toEqual(["task_history", "my_trips", "issues", "vehicles", "drivers", "places", "maintenance", "mileage", "fuel", "duty", "projects", "settings"]);
    expect(keys(moreFor(me(PRESETS.dispatcher.permissions)))).toEqual(["task_history", "requests", "my_trips", "vehicles", "drivers", "duty", "projects", "settings"]);
    expect(moreFor(me(PRESETS.dispatcher.permissions)).find((n) => n.key === "task_history")).toEqual({ key: "task_history", label: "Task history", need: ["assign_tasks"], path: "/tasks/history" });
    // Not in the rail: the desktop opens it from the Tasks page.
    expect(keys(NAV)).not.toContain("task_history");
    // The Requests list stays reachable for a requester, under More (no task history without assign_tasks).
    expect(keys(moreFor(me(PRESETS.requester.permissions)))).toEqual(["requests", "drivers", "projects", "settings"]);
    expect(keys(moreFor(me(PRESETS.viewer.permissions)))).toEqual(["requests", "projects", "settings"]);
    expect(keys(moreFor(me(["request"])))).toEqual(["requests", "projects", "settings"]);
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
