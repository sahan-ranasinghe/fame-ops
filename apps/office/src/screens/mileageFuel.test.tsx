// Mileage and Fuel over the date-range control (Phase 7 §8): a whole month is one set of figures with the allowance;
// shorter days show their own rows and totals and, beside them, the month that contains To; Fuel's fill page reads the
// list's answer for the same dates.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { FuelEntry, MileageSummary, MileageTotals } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { colomboDay, monthOf, rangeDates } from "../ui/dateRange";
import { Fuel } from "./Fuel";
import { FuelDetail } from "./FuelDetail";
import { Mileage } from "./Mileage";
import { monthName } from "./mileageLogic";

const today = colomboDay();
const ym = today.slice(0, 7);
const totals = (over: Partial<MileageTotals> = {}): MileageTotals => ({
  tasks: 12, task_km: 840, fuel_litres: 310, fuel_lkr: 120500, unlogged_km_flags: 0, check_odometer: 0, between_tasks_km: 20, overnight_km: 15, ...over,
});
const MONTH: MileageSummary = {
  month: ym,
  totals: totals(),
  vehicles: [{ vehicle: "WP CAB-4521", tasks: 12, task_km: 840, odometer_km: 900, km_allowance: 2500, fuel_litres: 310, fuel_lkr: 120500, fuel_entries: 9 }],
  biggest_gaps: [],
  unlogged_km: [],
  check_odometer: [],
};
const fill = (over: Partial<FuelEntry>): FuelEntry => ({ id: "f1", at: `${today} 09:12`, vehicle: "WP CAB-4521", driver: "Nuwan Perera", litres: 28.5, lkr: 10545, video: { status: "none", note: "No video" }, ...over });

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve(admin);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "mileage_summary") {
      if (args.month) return MONTH;
      return {
        ...MONTH,
        range: { from: args.from, to: args.to, totals: totals({ tasks: 1, task_km: 41, personal_km: 12, between_tasks_km: 0, overnight_km: 0 }), vehicles: [{ vehicle: "WP CAB-4521", tasks: 1, task_km: 41, personal_km: 12, odometer_km: 60, km_allowance: 2500 }], biggest_gaps: [], unlogged_km: [], check_odometer: [] },
      };
    }
    if (tool === "list_fuel") {
      const ranged = !args.month;
      return {
        month: ranged ? String(args.to).slice(0, 7) : args.month,
        ...(ranged ? { from: args.from, to: args.to, month_totals: { entries: 9, litres: 310, lkr: 120500 } } : {}),
        totals: { entries: 1, litres: 28.5, lkr: 10545, videos: 0, videos_waiting: 0, videos_missing: 1, bytes: 0 },
        entries: [fill({})],
      };
    }
    return { vehicles: [], drivers: [], places: [] };
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(structuredClone(this.answer(tool, args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const admin: Me = { name: "Sahan", role: "admin", permissions: ["view", "vehicles"], tools: ["mileage_summary", "list_fuel", "list_vehicles", "list_drivers", "list_places"] };

async function mount(url: string) {
  const transport = new FakeTransport();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: admin, noConnector: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/mileage" element={<Mileage />} />
          <Route path="/fuel" element={<Fuel />}><Route path=":id" element={<FuelDetail />} /></Route>
        </Routes>
      </MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

describe("Mileage over a range of days", () => {
  it("this month: one set of tables with the allowance column, asked as the month", async () => {
    const t = await mount("/mileage");
    expect(t.argsOf("mileage_summary")[0]).toEqual({ month: ym });
    expect(await screen.findByText("Allowance (km)")).toBeTruthy();
    expect(screen.queryByTestId("month-allowance")).toBeNull();
    expect(screen.queryByTestId("personal-km")).toBeNull();
    expect(screen.getByText("Completed tasks").parentElement?.textContent).toContain(monthName(ym));
    expect(screen.getByRole("link", { name: "Fuel entries and videos" }).getAttribute("href")).toBe("/fuel");
  }, 20_000);

  it("one day: its rows and totals (personal km apart), and the month that contains it with the allowance", async () => {
    const t = await mount("/mileage?range=today&vehicle=WP+CAB-4521");
    expect(t.argsOf("mileage_summary")[0]).toEqual({ from: today, to: today, vehicle: "WP CAB-4521" });
    const month = await screen.findByTestId("month-allowance");
    expect(within(month).getByRole("heading", { name: `${monthName(ym)} (allowance)` })).toBeTruthy();
    expect(within(month).getByText("Allowance (km)")).toBeTruthy();
    expect(within(month).getByText("12 tasks · 840 task km · 35 km outside tasks · 310 litres · LKR 120,500")).toBeTruthy();
    // The day's own table: no allowance column (the allowance is monthly), the personal km column.
    expect(screen.getAllByText("Allowance (km)")).toHaveLength(1);
    expect(screen.getByText("Task km", { selector: ".lbl" }).parentElement?.textContent).toContain("41");
    expect(screen.getByTestId("personal-km").textContent).toBe("Personal km: 12 km, never charged to a job.");
    // The fuel link carries the same days and vehicle.
    expect(screen.getByRole("link", { name: "Fuel entries and videos" }).getAttribute("href")).toBe("/fuel?range=today&vehicle=WP+CAB-4521");
  });
});

describe("Fuel over a range of days", () => {
  it("this week: the fills and their totals, the month in one line; a fill opens beside the list from the same answer", async () => {
    const week = rangeDates("week", today);
    const t = await mount("/fuel?range=week");
    expect(t.argsOf("list_fuel")[0]).toEqual({ from: week.from, to: week.to });
    const line = await screen.findByTestId("fuel-month");
    expect(line.textContent).toBe(`${monthName(week.to.slice(0, 7))}: 9 fills · 310 litres · LKR 120,500`);
    const row = within(screen.getByTestId("fuel-table")).getByText("28.5").closest("tr")!;
    fireEvent.click(row);
    expect(await screen.findByTestId("fuel-detail")).toBeTruthy();
    expect(screen.getByTestId("fuel-detail").textContent).toContain("LKR 10,545");
    // The fill page asked for nothing: it read the list's answer.
    expect(t.argsOf("list_fuel")).toHaveLength(1);
  });

  it("this month is asked as the month, with no month line", async () => {
    const t = await mount("/fuel");
    expect(t.argsOf("list_fuel")[0]).toEqual({ month: monthOf(today).from.slice(0, 7) });
    await screen.findByTestId("fuel-table");
    expect(screen.queryByTestId("fuel-month")).toBeNull();
  });
});
