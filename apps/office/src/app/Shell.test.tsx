// The Shell (Hotfix 3, L4 and L5): one notification icon (the tray; no issues bell), the issues count as a badge on the
// Issues menu item (and on the phone's Issues tab, or on More when Issues is listed there), the desktop menu in sections
// that collapse (remembered per person), and the phone's bar for the role.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { FleetProvider } from "./FleetContext";
import { resetPrefsMemory } from "./prefs";
import { Shell } from "./Shell";

const overview = {
  date: "2026-10-18",
  vehicles: { on_the_road: 0, total: 3, parked: 3, in_garage: 0 },
  tasks: { total: 0, in_progress: 0, done: 0 },
  requests: { waiting: 3, oldest_waiting: "2 h" },
  reminders: { count: 0 },
  on_the_road: [],
  needs_attention: [],
};
const issues = { status: "active", count: 5, open: 4, in_progress: 1, issues: [] };

const admin: Me = {
  name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"],
  tools: ["fleet_overview", "list_issues", "my_prefs", "set_my_prefs"],
};
const dispatcher: Me = { name: "D", email: "d@fame.test", role: "office", permissions: ["view", "request", "assign_tasks"], tools: ["fleet_overview", "list_issues"] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  prefs: Record<string, unknown> = {};
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "fleet_overview") return overview;
    if (tool === "list_issues") return issues;
    if (tool === "my_prefs") return { prefs: this.prefs };
    if (tool === "set_my_prefs") return { prefs: { ...this.prefs, ...(args.prefs as object) } };
    throw { code: "no_such_tool", message: tool };
  }
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    try {
      return Promise.resolve(this.answer(tool, args) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push({ tool: "watch:" + tool, args });
    cb({ type: "data", data: this.answer(tool, args) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(me: Me, url = "/", t = new FakeTransport()) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="*" element={<div>Page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return t;
}

const rail = () => screen.getByRole("navigation", { name: "Menu" });
const tabs = () => within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");

beforeEach(() => {
  // jsdom has no scrolling: the Shell scrolls to the top on every page.
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetPrefsMemory();
});

describe("one notification icon (L4)", () => {
  it("no issues bell: the open issues are a badge on the Issues menu item, the waiting requests on Requests", async () => {
    const t = await mount(admin);
    expect(t.argsOf("watch:list_issues")).toEqual([{ status: "active", limit: 10 }]);
    expect(screen.queryByTestId("bell-count")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Issues: / })).toBeNull();
    expect(within(rail()).getByRole("link", { name: /^Issues/ }).textContent).toBe("Issues5");
    expect(within(rail()).getByTestId("nav-badge-issues").textContent).toBe("5");
    expect(within(rail()).getByRole("link", { name: /^Requests/ }).textContent).toBe("Requests3");
  });

  it("on the phone's bar: Requests carries its count; Issues is under More, so More carries the issues count", async () => {
    await mount(admin);
    expect(tabs().map((a) => a.textContent)).toEqual(["Home", "Requests3", "Tasks", "Live", "More5"]);
    expect(screen.getByTestId("tab-badge-more").getAttribute("aria-label")).toBe("5 open issues");
  });

  it("a dispatcher's bar has Issues with its count, and More carries none", async () => {
    await mount(dispatcher);
    expect(tabs().map((a) => a.textContent)).toEqual(["Home", "Tasks", "Live", "Issues5", "More"]);
  });
});

describe("the menu in sections (L5)", () => {
  it("Today · Fleet · Reports · Admin; a section collapses (remembered with set_my_prefs), its counts summed beside its name", async () => {
    const t = await mount(admin, "/vehicles");
    expect(within(rail()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Today", "Fleet", "Reports", "Admin"]);
    expect(t.argsOf("my_prefs")).toEqual([{}]);
    fireEvent.click(within(rail()).getByRole("button", { name: "Today" }));
    await act(async () => { await Promise.resolve(); });
    expect(t.argsOf("set_my_prefs")).toEqual([{ prefs: { menu_collapsed: ["today"] } }]);
    const today = screen.getByTestId("nav-today");
    expect(within(today).getByRole("button", { name: /Today/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(today).queryByRole("link")).toBeNull();
    // 3 waiting + 5 issues inside.
    expect(within(today).getByRole("button").textContent).toBe("Today8");
    // The section of the page you are on still shows that page.
    fireEvent.click(within(rail()).getByRole("button", { name: "Fleet" }));
    expect(within(screen.getByTestId("nav-fleet")).getAllByRole("link").map((a) => a.textContent)).toEqual(["Vehicles"]);
  });

  it("the server's copy closes the sections it lists", async () => {
    const t = new FakeTransport();
    t.prefs = { menu_collapsed: ["reports", "admin"] };
    await mount(admin, "/", t);
    expect(within(screen.getByTestId("nav-reports")).queryAllByRole("link")).toEqual([]);
    expect(within(screen.getByTestId("nav-admin")).queryAllByRole("link")).toEqual([]);
    // Part 3b (H5): Today holds the Drivers board too; Round 4–7 (7): and the Timeline.
    expect(within(screen.getByTestId("nav-today")).getAllByRole("link").length).toBe(8);
  });

  it("Round 2b: no More in the rail; the name opens the profile menu (My profile, Settings; Esc closes it)", async () => {
    await mount(dispatcher);
    expect(within(rail()).queryByRole("link", { name: "More" })).toBeNull();
    fireEvent.click(screen.getByTestId("viewer-profile"));
    const menu = screen.getByRole("menu", { name: "Your account" });
    expect(within(menu).getAllByRole("menuitem").map((a) => a.textContent)).toEqual(expect.arrayContaining(["My profile", "Settings"]));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Your account" })).toBeNull();
  });

  it("a dispatcher sees only what the permissions allow", async () => {
    await mount(dispatcher);
    expect(within(rail()).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview", "Live locations", "Tasks", "Requests", "My trips", "Issues5", "Drivers board", "Timeline", "Vehicles", "Drivers", "Duty log", "Projects",
    ]);
  });
});
