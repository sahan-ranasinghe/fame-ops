// Phase 7 (§16), on the pages: the Overview's tiles open their lists (the side panel on a desktop, in the URL, with an X
// and Esc; the full page on a phone), the list screens read and write their filter in the URL, and the Reminders page.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFilter, removeChip } from "../test/controls";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { MapProps } from "../map/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Live } from "./Live";
import { Overview } from "./Overview";
import { Reminders } from "./Reminders";
import { Vehicles } from "./Vehicles";

vi.mock("../map/MapView", () => ({ MapView: (_p: MapProps) => <div data-testid="map" /> }));

const overview = {
  date: "2026-10-18",
  vehicles: { on_the_road: 1, total: 4, parked: 3, in_garage: 1 },
  tasks: { total: 2, in_progress: 1, done: 0 },
  requests: { waiting: 1, oldest_waiting: "2 h" },
  reminders: { count: 2, red: 1, window_days: 14 },
  on_the_road: [{ driver: "Nuwan Perera", username: "nuwan", vehicle: "WP CAB-4521", task: "Team drop", near: "Kurunegala", location: "Live · 2 min" }],
  needs_attention: [
    { what: "Service overdue", subject: "WP CAB-4521 · 1,200 km over", due: "now", level: "red", kind: "service_due", issue_id: "i1" },
    { what: "Late start", subject: "Team drop · Kamal", due: "leave by 09:00", level: "amber", kind: "late_start", issue_id: "i2" },
  ],
};
const vehicle = (reg_no: string, status: string, extra: object = {}) => ({ reg_no, make_model: "Toyota HiAce", seats: 14, status, availability: status === "Available" ? "Free" : status, ...extra });
const vehiclesFor = (filter: string) => ({
  filter,
  counts: { all: 4, on_task: 1, available: 2, in_garage: 1, documents_expiring: 0, inactive: 0 },
  vehicles: filter === "in_garage" ? [vehicle("WP KL-1234", "In garage")] : filter === "available" ? [vehicle("WP CAB-4521", "Available"), vehicle("PH-0001", "Available")] : [vehicle("WP CAB-4521", "Available")],
});
const board = {
  date: "2026-10-18",
  counts: { assigned: 1, in_progress: 1, completed: 0, cancelled: 0 },
  assigned: [{ id: "t2", time: "14:00", title: "Site visit · Galle", driver: "Sunil Fernando", vehicle: "WP KL-1234", status: "Accepted 08:10" }],
  in_progress: [{ id: "t1", time: "13:05", title: "Kadawatha", kind: "self", purpose: "personal", driver: "Kamal Silva", vehicle: "WP CAB-4521", status: "Started 13:05" }],
  completed: [],
};
const live = {
  as_of: "2026-10-18 13:40", counts: { all: 2, sharing: 2, stale: 0, not_sharing: 0 },
  drivers: [
    { driver: "Nuwan Perera", username: "nuwan", duty: "on_task", task: "Team drop", state: "sharing", status: "live", location: "Live · 1 min", links: {} },
    { driver: "Sunil Fernando", username: "sunil", duty: "on_duty", state: "sharing", status: "live", location: "Live · 1 min", links: {} },
  ],
};
const waiting = { status: "waiting", count: 1, requests: [{ id: "r1", requested_by: "Isuru Bandara", when: "Mon 19 Oct · 08:00", route: "Head office → Katunayake", need: "Car · 3 pax", status: "waiting" }] };

const admin: Me = {
  name: "Sahan", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"],
  tools: ["fleet_overview", "live_drivers", "list_vehicles", "task_board", "list_requests", "list_issues", "decide_request"],
};
const viewer: Me = { name: "Viewer", role: "viewer", permissions: ["view"], tools: ["fleet_overview", "live_drivers", "list_vehicles"] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private who: Me = admin) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "fleet_overview") return overview;
    if (tool === "list_vehicles") return vehiclesFor(String(args.filter ?? "all"));
    if (tool === "task_board") return board;
    if (tool === "list_requests") return waiting;
    if (tool === "live_drivers") return live;
    return {};
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(structuredClone(this.answer(tool, args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push({ tool, args });
    cb({ type: "data", data: structuredClone(this.answer(tool, args)) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

/** Where the router is now (path and query). */
function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const where = () => screen.getByTestId("where").textContent;

async function mount(url: string, who: Me = admin) {
  const transport = new FakeTransport(who);
  const store = new FleetStore(transport);
  // The shell watches the overview while the app is open.
  store.watch("overview", "fleet_overview", {}, 30000);
  render(
    <FleetProvider value={{ store, transport, me: who, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/live" element={<Live />} />
            <Route path="/vehicles" element={<Vehicles />}><Route path=":reg" element={<div data-testid="vehicle-page" />} /></Route>
            <Route path="/reminders" element={<Reminders />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

const tile = (label: string) => within(document.querySelector(".tiles") as HTMLElement).getByText(label).closest(".tile") as HTMLElement;

/** A phone (the one breakpoint, 768 px) for one test. */
function asPhone() {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the Overview's tiles (desktop)", () => {
  it("each tile opens its panel in the URL; Free now lists the free vehicles, each to the board with the same filter; X closes it", async () => {
    const transport = await mount("/");
    expect(tile("Vehicles on the road").getAttribute("href")).toBe("/?open=road");
    expect(tile("Free now").getAttribute("href")).toBe("/?open=free");
    expect(tile("In garage").getAttribute("href")).toBe("/?open=garage");
    expect(tile("Tasks today").getAttribute("href")).toBe("/?open=tasks");
    expect(tile("Requests to approve").getAttribute("href")).toBe("/?open=requests");
    expect(tile("Reminders due").getAttribute("href")).toBe("/?open=reminders");
    expect(screen.queryByTestId("overview-panel")).toBeNull();

    fireEvent.click(tile("Free now"));
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/?open=free");
    const panel = screen.getByTestId("overview-panel");
    expect(panel.dataset.open).toBe("free");
    expect(tile("Free now").getAttribute("aria-current")).toBe("true");
    expect(transport.argsOf("list_vehicles")).toContainEqual({ filter: "available" });
    const rows = within(panel).getAllByTestId("panel-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/vehicles/WP%20CAB-4521?filter=free", "/vehicles/PH-0001?filter=free"]);
    expect(within(panel).getByRole("link", { name: "Open Vehicles" }).getAttribute("href")).toBe("/vehicles?filter=free");

    // Another tile replaces the panel (the Overview stays on screen).
    fireEvent.click(tile("Reminders due"));
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/?open=reminders");
    expect(screen.getByTestId("overview-panel").dataset.open).toBe("reminders");
    // Round 4–7 (item 8): the reminders are service and documents (each to its vehicle); the late start is counted in the line to Issues.
    expect(within(screen.getByTestId("overview-panel")).getAllByTestId("reminder-row").map((r) => r.getAttribute("href"))).toEqual(["/vehicles/WP%20CAB-4521"]);
    expect(within(screen.getByTestId("overview-panel")).getByTestId("reminders-issues").getAttribute("href")).toBe("/issues");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("overview-panel")).toBeNull();
    expect(where()).toBe("/");
    expect(screen.getByText("On the road")).toBeTruthy();
  });

  it("a shared link opens its panel; Esc closes it", async () => {
    await mount("/?open=road");
    const panel = screen.getByTestId("overview-panel");
    expect(panel.dataset.open).toBe("road");
    expect(within(panel).getByTestId("road-row").textContent).toContain("Nuwan Perera");
    expect(within(panel).getByRole("link", { name: "Open Live locations" }).getAttribute("href")).toBe("/live?filter=road");
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("overview-panel")).toBeNull();
    expect(where()).toBe("/");
  });

  it("Tasks today: the day's board by status, the driver-started personal trip tagged, each task to its page", async () => {
    const transport = await mount("/?open=tasks");
    const panel = screen.getByTestId("overview-panel");
    expect(transport.argsOf("task_board").length).toBe(1);
    const rows = within(panel).getAllByTestId("panel-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/tasks/t1", "/tasks/t2"]);
    expect(within(rows[0]).getByTestId("trip-tags").textContent).toBe("Driver-startedPersonal");
    expect(within(rows[1]).queryByTestId("trip-tags")).toBeNull();
  });

  it("Requests to approve: the waiting queue, each to its request", async () => {
    await mount("/?open=requests");
    const rows = within(screen.getByTestId("overview-panel")).getAllByTestId("panel-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/requests/r1"]);
    expect(rows[0].textContent).toContain("Isuru Bandara");
  });

  it("a viewer: the vehicle tiles link, the rest stay plain numbers; a link to a list they lack opens nothing", async () => {
    await mount("/?open=tasks", viewer);
    expect(tile("Vehicles on the road").tagName).toBe("A");
    expect(tile("Free now").tagName).toBe("A");
    expect(tile("Tasks today").tagName).toBe("DIV");
    expect(screen.queryByText("Requests to approve")).toBeNull();
    expect(screen.queryByTestId("overview-panel")).toBeNull();
  });
});

describe("the Overview's tiles (phone)", () => {
  it("go to the full pages", async () => {
    asPhone();
    await mount("/");
    expect(tile("Vehicles on the road").getAttribute("href")).toBe("/live?filter=road");
    expect(tile("Free now").getAttribute("href")).toBe("/vehicles?filter=free");
    expect(tile("In garage").getAttribute("href")).toBe("/vehicles?filter=garage");
    expect(tile("Tasks today").getAttribute("href")).toBe("/tasks");
    expect(tile("Requests to approve").getAttribute("href")).toBe("/requests");
    expect(tile("Reminders due").getAttribute("href")).toBe("/reminders");
  });

  it("a panel's link opened on a phone shows the full page instead", async () => {
    asPhone();
    const transport = await mount("/?open=garage");
    expect(where()).toBe("/vehicles?filter=garage");
    expect(within(screen.getByTestId("filter-chips")).getByText("Show: In garage")).toBeTruthy();
    expect(transport.argsOf("list_vehicles").at(-1)).toEqual({ filter: "in_garage", limit: 25 });
  });
});

describe("the list screens' filter in the URL", () => {
  it("Vehicles reads it on load and writes it when a chip changes, keeping the other parameters", async () => {
    const transport = await mount("/vehicles?filter=free&x=1");
    expect(within(screen.getByTestId("filter-chips")).getByText("Show: Available")).toBeTruthy();
    expect(transport.argsOf("list_vehicles").at(-1)).toEqual({ filter: "available", limit: 25 });
    applyFilter("Show", /^In garage/);
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/vehicles?filter=garage&x=1");
    expect(transport.argsOf("list_vehicles").at(-1)).toEqual({ filter: "in_garage", limit: 25 });
    // A vehicle opened from the filtered board keeps the filter (the list beside it, and Back).
    fireEvent.click(screen.getByText("WP KL-1234"));
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/vehicles/WP%20KL-1234?filter=garage&x=1");
    expect(within(screen.getByTestId("filter-chips")).getByText("Show: In garage")).toBeTruthy();
  });

  it("All removes the parameter (the chip's ✕)", async () => {
    await mount("/vehicles?filter=garage");
    removeChip("Show: In garage");
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/vehicles");
  });

  it("Live: ?filter=road is On a task, the list shows only them, and a chip writes its word", async () => {
    await mount("/live?filter=road");
    expect(within(screen.getByTestId("filter-chips")).getByText("Show: On a task")).toBeTruthy();
    expect(screen.getAllByText("Nuwan Perera").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sunil Fernando")).toBeNull();
    applyFilter("Show", /^On duty/);
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/live?filter=on_duty");
    removeChip("Show: On duty");
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/live");
  });
});

describe("the Reminders page", () => {
  it("documents and services due first, each to its vehicle; the rest to its issue; back to the Overview", async () => {
    await mount("/reminders");
    const page = screen.getByTestId("reminders-page");
    // Round 4–7 (item 8, §33.7): one card per vehicle (the plate on the card), the rest of the overview's list in one line to Issues.
    expect(within(page).getByText("Vehicles: service and documents due")).toBeTruthy();
    expect(within(page).getByTestId("reminders-issues").textContent).toContain("1 more needs attention");
    const rows = within(page).getAllByTestId("reminder-row");
    expect(rows[0].textContent).toContain("Service overdue");
    expect(within(page).getByTestId("reminder-card").textContent).toContain("WP CAB-4521");
    expect(rows[0].textContent).toContain("now");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/vehicles/WP%20CAB-4521"]);
    expect(within(page).getByTestId("reminders-issues").getAttribute("href")).toBe("/issues");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => { await Promise.resolve(); });
    expect(where()).toBe("/");
  });
});
