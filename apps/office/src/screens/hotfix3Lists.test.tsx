// Hotfix 3 (L3), W3's pages on one list pattern: Drivers, Vehicles (and the vehicle page), Places, Users, Maintenance,
// the Duty log, Fuel's fill page, Mileage's tables and the site import's history. Each asks a page of 25 (page numbers on
// a desktop, Load more on a phone), shows the count in the header, keeps its filters and its search in the URL (the search
// reaches the server once typing pauses) and says what an empty filter means.
import { pageOf, pageWindow } from "@fleet/paging";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFilter, removeChip } from "../test/controls";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Drivers, driversEmpty } from "./Drivers";
import { DriverManage } from "./DriverManage";
import { DutyLog } from "./DutyLog";
import { Fuel } from "./Fuel";
import { FuelDetail } from "./FuelDetail";
import { SEARCH_DEBOUNCE_MS } from "./listLocal";
import { Maintenance, reportsEmpty } from "./Maintenance";
import { Mileage } from "./Mileage";
import { Places, placesEmpty } from "./Places";
import { ImportHistory } from "./settings/ImportSites";
import { UserManage } from "./settings/UserManage";
import { Users } from "./settings/Users";
import { VehicleDetail } from "./VehicleDetail";
import { Vehicles, vehiclesEmpty } from "./Vehicles";

vi.mock("./PhotoUpload", () => ({ VehiclePhotoCard: () => null, DriverPhotoCard: () => null }));
vi.mock("./VehicleDocs", () => ({ VehicleDocumentsSection: () => null }));

type Args = Record<string, unknown>;
type Answer = (args: Args) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(private answers: Record<string, Answer>) {}
  me(): Promise<Me> {
    return Promise.resolve(admin);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    return Promise.resolve(structuredClone(a ? a(args) : { drivers: [], vehicles: [], places: [] }) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const admin: Me = {
  name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view", "vehicles", "assign_tasks", "issues", "users"],
  tools: ["list_drivers", "update_driver", "create_driver", "duty_log", "list_vehicles", "register_vehicle", "update_vehicle", "list_places",
    "restore_place", "list_office_users", "list_vehicle_reports", "update_vehicle_report", "list_fuel", "mileage_summary"],
};

/** A list tool's answer the way the server pages it (@fleet/paging): with limit, the page, total and next. */
function paged<T>(rows: T[], args: Args): { rows: T[]; total?: number; next?: string } {
  return pageOf(rows, pageWindow(args.limit as number | undefined, args.cursor as string | undefined));
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function mount(transport: FakeTransport, url: string) {
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: admin, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/drivers" element={<Drivers />} />
            <Route path="/drivers/duty" element={<DutyLog />} />
            <Route path="/drivers/:username/edit" element={<DriverManage />} />
            <Route path="/vehicles" element={<Vehicles />}><Route path=":reg" element={<VehicleDetail />} /></Route>
            <Route path="/places" element={<Places />} />
            <Route path="/settings/users" element={<Users />} />
            <Route path="/settings/users/:email/edit" element={<UserManage />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/mileage" element={<Mileage />} />
            <Route path="/fuel" element={<Fuel />}><Route path=":id" element={<FuelDetail />} /></Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
}

const realMatchMedia = window.matchMedia;
function asPhone() {
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

const driver = (i: number) => ({ name: `Driver ${String(i).padStart(2, "0")}`, username: `d${i}`, code: `D-${i}`, active: true, last_30_days: { accepted: 1, declined: 0 } });
const DRIVERS = Array.from({ length: 30 }, (_, i) => driver(i + 1));

describe("Drivers", () => {
  it("asks 25 active drivers, counts them all in the header, and pages by number on a desktop", async () => {
    const t = new FakeTransport({ list_drivers: (a) => { const p = paged(DRIVERS, a); return { count: p.rows.length, total: p.total, next: p.next, drivers: p.rows }; } });
    await mount(t, "/drivers");
    expect(t.argsOf("list_drivers")[0]).toEqual({ include_inactive: false, limit: 25 });
    expect(screen.getByTestId("list-count").textContent).toBe(" · 30");
    expect(screen.getAllByTestId("driver-row")).toHaveLength(25);
    fireEvent.click(within(screen.getByTestId("pager")).getByRole("button", { name: "2" }));
    await settle();
    expect(t.argsOf("list_drivers").at(-1)).toMatchObject({ include_inactive: false, limit: 25 });
    expect(t.argsOf("list_drivers").at(-1)?.cursor).toBeTruthy();
    expect(screen.getAllByTestId("driver-row")).toHaveLength(5);
    expect(screen.getByText("Driver 30")).toBeTruthy();
  });

  it("searches on the server once typing pauses, keeps it in the URL, and says what an empty search means", async () => {
    const t = new FakeTransport({
      list_drivers: (a) => {
        const found = DRIVERS.filter((d) => !a.search || d.name.toLowerCase().includes(String(a.search).toLowerCase()));
        const p = paged(found, a);
        return { count: p.rows.length, total: p.total, next: p.next, drivers: p.rows };
      },
    });
    await mount(t, "/drivers");
    fireEvent.change(screen.getByLabelText("Find a driver"), { target: { value: "nobody" } });
    // Nothing is asked while typing.
    expect(t.argsOf("list_drivers").some((a) => a.search)).toBe(false);
    await act(async () => { await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 50)); });
    await settle();
    expect(t.argsOf("list_drivers").at(-1)).toEqual({ include_inactive: false, search: "nobody", limit: 25 });
    expect(screen.getByTestId("where").textContent).toBe("/drivers?q=nobody");
    expect(screen.getByTestId("empty-line").textContent).toBe(driversEmpty(false, "nobody", true));
  });

  it("on a phone: Load more grows the page; the switched-off drivers are a filter in the URL", async () => {
    asPhone();
    const t = new FakeTransport({ list_drivers: (a) => { const p = paged(DRIVERS, a); return { count: p.rows.length, total: p.total, next: p.next, drivers: p.rows }; } });
    await mount(t, "/drivers?inactive=1");
    expect(t.argsOf("list_drivers")[0]).toEqual({ include_inactive: true, limit: 25 });
    expect(screen.getByTestId("load-more").textContent).toContain("Showing 25 of 30");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await settle();
    expect(t.argsOf("list_drivers").at(-1)).toEqual({ include_inactive: true, limit: 50 });
    expect(screen.getAllByTestId("driver-row")).toHaveLength(30);
    expect(screen.queryByTestId("load-more")).toBeNull();
    // The filter in use is a chip: its ✕ shows the active drivers again (docs/ui-patterns.md §1).
    removeChip("Show: All drivers, the switched-off ones too");
    await settle();
    expect(screen.getByTestId("where").textContent).toBe("/drivers");
  });

  // Round 4–7 (the list audit's proposed removal, approved by Sahan 22 October 2026): no "· 0 declined"; a declined count stays.
  it("Last 30 days: the accepted count; the declined count only when there is one", async () => {
    const t = new FakeTransport({ list_drivers: () => ({ count: 2, drivers: [driver(1), { ...driver(2), last_30_days: { accepted: 4, declined: 2 } }] }) });
    await mount(t, "/drivers");
    const [none, some] = screen.getAllByTestId("driver-row").map((r) => r.querySelector('[data-label="Last 30 days"]')!);
    expect(none.textContent).toBe("1 accepted");
    expect(none.textContent).not.toContain("declined");
    expect(some.textContent).toBe("4 accepted · 2 declined");
    expect(some.querySelector(".status.bad")?.textContent).toBe(" · 2 declined");
  });

  it("Manage finds the driver by the list's search, not the whole list", async () => {
    const t = new FakeTransport({ list_drivers: () => ({ count: 2, drivers: [driver(1), driver(11)] }) });
    await mount(t, "/drivers/d1/edit");
    expect(t.argsOf("list_drivers")[0]).toEqual({ include_inactive: true, search: "d1", limit: 25 });
    expect(await screen.findByRole("heading", { name: "Driver 01" })).toBeTruthy();
  });
});

const vehicle = (reg: string, over: Record<string, unknown> = {}) => ({ reg_no: reg, make_model: "Toyota HiAce", status: "Available", km_this_month: 120, ...over });
const COUNTS = { all: 2, on_task: 0, available: 2, in_garage: 0, documents_expiring: 0 };

describe("Vehicles", () => {
  it("says \"no km allowance set\" on the board and on the vehicle page; the counts stay the fleet's", async () => {
    const rows = [vehicle("WP CAB-4521", { km_allowance: 2500 }), vehicle("CAP-2207", { km_allowance_note: "no km allowance set" })];
    const t = new FakeTransport({ list_vehicles: (a) => { const p = paged(rows, a); return { filter: a.filter, counts: COUNTS, total: p.total, next: p.next, vehicles: p.rows }; } });
    await mount(t, "/vehicles");
    expect(t.argsOf("list_vehicles")[0]).toEqual({ filter: "all", limit: 25 });
    expect(screen.getByTestId("list-count").textContent).toBe(" · 2");
    const notes = screen.getAllByTestId("km-allowance-note");
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("tr")?.textContent).toContain("CAP-2207");
    // The counts are beside the Filter panel's choices.
    fireEvent.click(screen.getByTestId("filter-button"));
    expect(within(screen.getByTestId("filter-panel")).getByLabelText(/^All · 2/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("filter-button"));
    fireEvent.click(screen.getByText("CAP-2207"));
    await settle();
    // The vehicle page reads the board's rows: nothing more is asked.
    expect(t.argsOf("list_vehicles")).toHaveLength(1);
    expect(within(screen.getByTestId("vehicle-detail")).getByTestId("km-allowance-note").textContent).toBe("no km allowance set");
  });

  it("a vehicle not on the board's page is found by the search (active, then returned), never the whole list", async () => {
    const t = new FakeTransport({
      list_vehicles: (a) => {
        if (a.search) return { filter: a.filter, total: a.filter === "inactive" ? 1 : 0, vehicles: a.filter === "inactive" ? [vehicle("OLD-0001")] : [] };
        const p = paged(Array.from({ length: 30 }, (_, i) => vehicle(`WP V-${1000 + i}`)), a);
        return { filter: a.filter, counts: COUNTS, total: p.total, next: p.next, vehicles: p.rows };
      },
    });
    await mount(t, "/vehicles/OLD-0001");
    await settle();
    expect(t.argsOf("list_vehicles").filter((a) => a.search)).toEqual([
      { filter: "all", search: "OLD-0001", limit: 25 },
      { filter: "inactive", search: "OLD-0001", limit: 25 },
    ]);
    expect(await screen.findByTestId("vehicle-detail")).toBeTruthy();
  });

  it("an empty filter says what it means", () => {
    expect(vehiclesEmpty("in_garage", "", true)).toBe("No vehicles in the garage right now.");
    expect(vehiclesEmpty("all", "kdh", true)).toBe("No vehicles match \"kdh\" (plate, make, regular driver, custodian or holder).");
  });
});

describe("Places", () => {
  it("asks the server 25 at a time with the search, never thousands", async () => {
    const sites = Array.from({ length: 2400 }, (_, i) => ({ id: `s${i}`, name: `Site ${i}`, kind: "site", operator: "dialog", site_id: `DG${i}`, pinned: i % 2 === 0 }));
    const t = new FakeTransport({
      list_places: (a) => {
        const found = sites.filter((s) => !a.search || s.site_id.includes(String(a.search)));
        const p = paged(found, a);
        return { count: p.rows.length, total: p.total, next: p.next, places: p.rows };
      },
    });
    await mount(t, "/places?who=dialog");
    expect(t.argsOf("list_places")[0]).toEqual({ operator: "dialog", limit: 25 });
    expect(screen.getAllByTestId("place-row")).toHaveLength(25);
    expect(screen.getByTestId("list-count").textContent).toBe(" · 2400");
    fireEvent.change(screen.getByLabelText("Find a place"), { target: { value: "DG239" } });
    await act(async () => { await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 50)); });
    await settle();
    expect(t.argsOf("list_places").at(-1)).toEqual({ operator: "dialog", search: "DG239", limit: 25 });
    expect(screen.getByTestId("list-count").textContent).toBe(" · 11");
    expect(screen.getByTestId("where").textContent).toBe("/places?who=dialog&q=DG239");
  });

  it("an empty filter says what it means", () => {
    expect(placesEmpty("removed", "", false)).toBe("No place has been removed.");
    expect(placesEmpty("ours", "", true)).toBe("Every one of our places has a pin.");
    expect(placesEmpty("mobitel", "MT9", false)).toBe("No Mobitel site matches \"MT9\" (name, address, site id or other id).");
  });
});

describe("Settings → Users", () => {
  it("pages, counts and searches the office users; Manage finds one by the search", async () => {
    const users = Array.from({ length: 27 }, (_, i) => ({ name: `Person ${i}`, email: `p${i}@fame.test`, role: "office", active: i !== 3, connector_keys: [] }));
    const t = new FakeTransport({
      list_office_users: (a) => {
        const found = users.filter((u) => !a.search || u.email.includes(String(a.search)));
        const p = paged(found, a);
        return { count: p.rows.length, total: p.total, next: p.next, users: p.rows };
      },
    });
    await mount(t, "/settings/users");
    expect(t.argsOf("list_office_users")[0]).toEqual({ limit: 25 });
    expect(screen.getByTestId("list-count").textContent).toBe(" · 27");
    expect(screen.getAllByTestId("user-row")).toHaveLength(25);
    expect(screen.getByTestId("pager")).toBeTruthy();
    t.calls = [];
    fireEvent.click(screen.getAllByRole("link", { name: "Manage" })[3]);
    await settle();
    expect(t.argsOf("list_office_users")[0]).toEqual({ search: "p3@fame.test", limit: 25 });
  });
});

describe("Maintenance", () => {
  it("the reports' status is in the URL, newest first 25 at a time, the empty status in words", async () => {
    const reports = Array.from({ length: 26 }, (_, i) => ({ id: `r${i}`, reported: `2026-10-18 09:${String(59 - i).padStart(2, "0")}`, vehicle: "WP CAB-4521", category: "tyre", status: "open", photos: [] }));
    const t = new FakeTransport({
      list_vehicle_reports: (a) => {
        const found = a.status === "closed" ? [] : reports;
        const p = paged(found, a);
        return { status: a.status, count: p.rows.length, total: p.total, next: p.next, reports: p.rows };
      },
    });
    await mount(t, "/maintenance");
    expect(t.argsOf("list_vehicle_reports")[0]).toEqual({ status: "not_closed", limit: 25 });
    expect(within(screen.getByTestId("reports-list")).getByTestId("list-count").textContent).toBe(" · 26");
    expect(screen.getByTestId("pager")).toBeTruthy();
    applyFilter("Status", "Closed");
    await settle();
    expect(screen.getByTestId("where").textContent).toBe("/maintenance?status=closed");
    expect(t.argsOf("list_vehicle_reports").at(-1)).toEqual({ status: "closed", limit: 25 });
    expect(within(screen.getByTestId("reports-list")).getByTestId("empty-line").textContent).toBe(reportsEmpty("closed"));
  });
});

describe("Duty log", () => {
  it("25 periods a page with the count; the totals row is the whole range's", async () => {
    const periods = Array.from({ length: 30 }, (_, i) => ({ driver: `Driver ${i}`, username: `d${i}`, day: "2026-10-18", clock_in: `07:${String(i).padStart(2, "0")}`, clock_out: "17:00", hours: 9, vehicles: [], tasks: [], task_km: 10 }));
    const t = new FakeTransport({
      duty_log: (a) => {
        const p = paged(periods, a);
        return { from: a.date ?? a.from, to: a.date ?? a.to, total: p.total, next: p.next, periods: p.rows, totals: { periods: 30, hours: 270, task_km: 300 } };
      },
    });
    await mount(t, "/drivers/duty");
    expect(t.argsOf("duty_log")[0]).toMatchObject({ limit: 25 });
    expect(screen.getAllByTestId("duty-row")).toHaveLength(25);
    expect(screen.getByTestId("list-count").textContent).toBe(" · 30");
    expect(screen.getByTestId("duty-totals").textContent).toContain("30 periods");
    expect(screen.getByTestId("duty-totals").textContent).toContain("270 h");
  });
});

describe("Mileage's tables page in the browser", () => {
  it("30 vehicles: 25 on the first page, the rest on page 2, the count in each header; each cell carries its label for the phone's cards", async () => {
    const ym = "2026-10";
    const vehicles = Array.from({ length: 30 }, (_, i) => ({ vehicle: `WP M-${1000 + i}`, tasks: 1, task_km: 10, odometer_km: 12, km_allowance: 2500 }));
    const totals = { tasks: 30, task_km: 300, fuel_litres: 0, fuel_lkr: 0, unlogged_km_flags: 0, check_odometer: 0, between_tasks_km: 0, overnight_km: 0 };
    const t = new FakeTransport({ mileage_summary: () => ({ month: ym, totals, vehicles, biggest_gaps: [], unlogged_km: [], check_odometer: [] }) });
    await mount(t, `/mileage?range=custom&from=${ym}-01&to=${ym}-31`);
    const table = await screen.findByTestId("mileage-vehicles");
    expect(within(table).getByTestId("list-count").textContent).toBe(" · 30");
    expect(within(table).getAllByRole("row")).toHaveLength(26); // the header row and 25
    expect(within(table).getAllByText("Task km")[0].tagName).toBe("TH");
    expect(within(table).getAllByRole("cell")[0].getAttribute("data-label")).toBe("Vehicle");
    fireEvent.click(within(table).getByRole("button", { name: "2" }));
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("WP M-1029")).toBeTruthy();
    expect(within(screen.getByTestId("mileage-gaps")).getByTestId("empty-line").textContent).toContain("No gaps");
  });
});

describe("Fuel's fill page", () => {
  it("a fill on another page (a link, a reload) is found by asking for the whole range once", async () => {
    const fills = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, at: `2026-10-15 09:${String(i).padStart(2, "0")}`, vehicle: "WP CAB-4521", litres: 20 + i, lkr: 8000, video: { status: "none", note: "No video" } }));
    const t = new FakeTransport({
      list_fuel: (a) => {
        const p = paged(fills, a);
        return { month: "2026-10", from: a.from, to: a.to, total: p.total, next: p.next, entries: p.rows, totals: { entries: 30, litres: 1035, lkr: 240000, videos: 0, videos_waiting: 0, videos_missing: 30, bytes: 0 } };
      },
    });
    await mount(t, "/fuel/f29?range=week");
    await settle();
    expect(t.argsOf("list_fuel")).toEqual([
      expect.objectContaining({ limit: 25 }),
      expect.not.objectContaining({ limit: expect.anything() }),
    ]);
    expect((await screen.findByTestId("fuel-detail")).textContent).toContain("49");
  });
});

describe("the site import's history", () => {
  it("the newest 100 asked once, shown 25 at a time with the count", () => {
    const imports = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, at: `2026-10-${String(18 - (i % 9)).padStart(2, "0")} 10:00`, by: "Sahan", file: `sites-${i}.xlsx`, preset: "Dialog", rows: 10, added: 10, updated: 0 }));
    render(<MemoryRouter><ImportHistory imports={imports} busy={false} onUndo={() => {}} /></MemoryRouter>);
    expect(screen.getAllByTestId("import-row")).toHaveLength(25);
    expect(screen.getByTestId("list-count").textContent).toBe(" · 40");
    fireEvent.click(within(screen.getByTestId("pager")).getByRole("button", { name: "2" }));
    expect(screen.getAllByTestId("import-row")).toHaveLength(15);
    expect(screen.getByText("sites-39.xlsx")).toBeTruthy();
  });
});
