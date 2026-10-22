// Round 4–7, feature 5 (phase8-plan.md §33.2) and §33.6 item 3 on the site's screens: the vehicle form's fuel type
// (required, the button waits with the reason; an edit starts from the vehicle's own; the grade that fits), the vehicle
// page's fuel ("Fuel type: not set" in amber with Set it), the task page's fuel card (the driver's answer and the
// estimate), and the Fuel page (a missing amount is "–", never LKR 0; the totals say how many fills have none).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { FuelList, TaskDetail as TaskDetailData, VehicleCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Fuel } from "./Fuel";
import { TaskDetail } from "./TaskDetail";
import { VehicleDetail } from "./VehicleDetail";
import { VehicleForm } from "./VehicleForm";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));

type Answer = (args: Record<string, unknown>) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function mount(t: FakeTransport, me: Me, ui: ReactNode, url: string) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

const officer: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "vehicles", "assign_tasks"], tools: ["list_vehicles", "update_vehicle", "register_vehicle", "list_drivers", "task_detail", "list_fuel"] };
const viewer: Me = { name: "Viewer", role: "viewer", permissions: ["view"], tools: ["list_vehicles"] };

const vehicles = (v: VehicleCard[]) => ({ filter: "all", counts: { all: v.length, on_task: 0, available: v.length, in_garage: 0, documents_expiring: 0 }, vehicles: v });

describe("the vehicle form's fuel type (Round 4–7, feature 5)", () => {
  it("an edit of a vehicle with no fuel type waits for one; the grades follow the type; only the change is sent", async () => {
    const t = new FakeTransport({
      list_vehicles: () => vehicles([{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce", fuel_text: "Fuel type: not set" }]),
      list_drivers: () => ({ count: 0, drivers: [] }),
      update_vehicle: () => ({ updated: { reg_no: "WP CAB-4521" }, changed: ["fuel_type", "fuel_grade"] }),
    }, officer);
    mount(t, officer, <Routes><Route path="/vehicles/:reg/edit" element={<VehicleForm />} /><Route path="/vehicles/:reg" element={<div data-testid="vehicle-page" />} /></Routes>, "/vehicles/WP%20CAB-4521/edit");
    await waitFor(() => expect(screen.getByTestId("save-why").textContent).toBe("Pick the fuel type"));
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // No grade for an electric vehicle; a petrol one offers 92 and 95.
    fireEvent.click(screen.getByRole("button", { name: "Electric" }));
    expect(screen.queryByTestId("fuel-grade")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Petrol" }));
    const grades = within(screen.getByTestId("fuel-grade"));
    expect(grades.getAllByRole("button").map((b) => b.textContent)).toEqual(["Not set", "Petrol 92", "Petrol 95"]);
    fireEvent.click(grades.getByRole("button", { name: "Petrol 95" }));
    expect(screen.queryByTestId("save-why")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.argsOf("update_vehicle")).toEqual([{ reg_no: "WP CAB-4521", fuel_type: "petrol", fuel_grade: "petrol_95" }]));
  });

  it("an edit of a vehicle with its fuel set starts from it and sends nothing about it unless it changes", async () => {
    const t = new FakeTransport({
      list_vehicles: () => vehicles([{ reg_no: "WP CAB-4521", fuel_type: "diesel", fuel_grade: "auto_diesel", fuel_text: "Auto Diesel" }]),
      list_drivers: () => ({ count: 0, drivers: [] }),
      update_vehicle: () => ({ updated: { reg_no: "WP CAB-4521" }, changed: ["seats"] }),
    }, officer);
    mount(t, officer, <Routes><Route path="/vehicles/:reg/edit" element={<VehicleForm />} /><Route path="/vehicles/:reg" element={<div data-testid="vehicle-page" />} /></Routes>, "/vehicles/WP%20CAB-4521/edit");
    await waitFor(() => expect(screen.getByRole("button", { name: "Diesel" }).getAttribute("aria-pressed")).toBe("true"));
    expect(within(screen.getByTestId("fuel-grade")).getByRole("button", { name: "Auto Diesel" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("save-why")).toBeNull();
    fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.argsOf("update_vehicle")).toEqual([{ reg_no: "WP CAB-4521", seats: 9 }]));
  });
});

describe("the vehicle page's fuel", () => {
  it("says the fuel, or Fuel type: not set in amber with Set it for someone who may edit", async () => {
    const t = new FakeTransport({ list_vehicles: () => vehicles([{ reg_no: "WP CAB-4521", fuel_text: "Fuel type: not set" }, { reg_no: "WP KL-1234", fuel_type: "petrol", fuel_grade: "petrol_92", fuel_text: "Petrol 92" }]) }, officer);
    mount(t, officer, <Routes><Route path="/vehicles/:reg" element={<VehicleDetail />} /></Routes>, "/vehicles/WP%20CAB-4521");
    const line = await screen.findByTestId("fuel-text");
    expect(line.textContent).toBe("Fuel type: not set · Set it");
    expect(line.className).toContain("warn");
    expect(within(line).getByRole("link", { name: "Set it" }).getAttribute("href")).toBe("/vehicles/WP%20CAB-4521/edit");
  });

  it("someone who cannot edit sees the words without the link; a set fuel is plain", async () => {
    const t = new FakeTransport({ list_vehicles: () => vehicles([{ reg_no: "WP CAB-4521", fuel_text: "Fuel type: not set" }]) }, viewer);
    mount(t, viewer, <Routes><Route path="/vehicles/:reg" element={<VehicleDetail />} /></Routes>, "/vehicles/WP%20CAB-4521");
    expect((await screen.findByTestId("fuel-text")).textContent).toBe("Fuel type: not set");
    expect(screen.queryByRole("link", { name: "Set it" })).toBeNull();
  });
});

const task = (over: Partial<TaskDetailData["task"]>): TaskDetailData => ({
  task: { id: "t1", title: "Team drop · Kurunegala", status: "in_progress", start: "Fri 23 Oct 07:30", driver: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce", started: "07:40", ...over },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
});

async function mountTask(answer: TaskDetailData) {
  const t = new FakeTransport({ task_detail: () => answer }, officer);
  mount(t, officer, <Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes>, "/tasks/t1");
  await screen.findByTestId("task-detail");
}

describe("the task page's fuel card", () => {
  it("the driver's answer with its time, and the estimate under it", async () => {
    await mountTask(task({ fuel_card: { task_id: "t1", km: 180, electric: false, fuel_type: "diesel", litres_low: 13, litres_high: 17, estimate_text: "About 180 km · roughly 13–17 L diesel (approx.)", answer: "enough", answer_text: "Enough fuel", answered_at: "07:42" } }));
    const card = screen.getByTestId("fuel-card");
    expect(card.textContent).toBe("FuelEnough fuel · 07:42About 180 km · roughly 13–17 L diesel (approx.)");
  });

  it("Fills up on the way in amber; Not answered once started without an answer; nothing without a card", async () => {
    await mountTask(task({ fuel_card: { task_id: "t1", km: 40, electric: false, answer: "fill_on_way", answer_text: "Fills up on the way", answered_at: "07:42", estimate_text: "About 40 km · roughly 3–4 L petrol (approx.)" } }));
    expect(within(screen.getByTestId("fuel-card")).getByText("Fills up on the way · 07:42").className).toContain("warn");
    document.body.innerHTML = "";
    await mountTask(task({ fuel_card: { task_id: "t1", km: 40, electric: false, answer_text: "Not answered", estimate_text: "About 40 km · roughly 3–4 L petrol (approx.)" } }));
    expect(screen.getByTestId("fuel-card").textContent).toContain("Not answered");
    document.body.innerHTML = "";
    await mountTask(task({ status: "assigned", started: undefined, fuel_card: { task_id: "t1", km: 40, electric: false, answer_text: "Not answered", estimate_text: "About 40 km · roughly 3–4 L petrol (approx.)" } }));
    expect(screen.getByTestId("fuel-card").textContent).toBe("FuelAsked at Start taskAbout 40 km · roughly 3–4 L petrol (approx.)");
    document.body.innerHTML = "";
    await mountTask(task({}));
    expect(screen.queryByTestId("fuel-card")).toBeNull();
  });

  it("a fill on the task with no amount says –, never LKR 0", async () => {
    await mountTask({ ...task({}), fuel: [{ litres: 30, amount_lkr: undefined as unknown as number, at: "2026-10-23 08:10" }] });
    const page = screen.getByTestId("task-detail").textContent ?? "";
    expect(page).toContain("30 L · –");
    expect(page).not.toContain("LKR 0");
  });
});

describe("the Fuel page: a missing amount (§33.6)", () => {
  it("a fill with no amount is –, the totals add the known ones and say how many have none; the fuel each fill took", async () => {
    const list: FuelList = {
      month: "2026-10",
      totals: { entries: 3, litres: 90, lkr: 24000, without_amount: 1, videos: 0, videos_waiting: 0, videos_missing: 3, bytes: 0 },
      entries: [
        { id: "f1", at: "2026-10-22 08:10", vehicle: "WP CAB-4521", driver: "Kamal", litres: 30, lkr: 12000, fuel: "Auto Diesel", video: { status: "none" } },
        { id: "f2", at: "2026-10-21 08:10", vehicle: "WP CAB-4521", driver: "Kamal", litres: 30, lkr: null, video: { status: "none" } },
        { id: "f3", at: "2026-10-20 08:10", vehicle: "WP CAB-4521", driver: "Kamal", litres: 30, lkr: 12000, video: { status: "none" } },
      ],
    };
    const t = new FakeTransport({ list_fuel: () => list, list_vehicles: () => vehicles([]), list_drivers: () => ({ count: 0, drivers: [] }) }, officer);
    mount(t, officer, <Routes><Route path="/fuel" element={<Fuel />} /></Routes>, "/fuel?range=month");
    const rows = await screen.findAllByTestId("fuel-row");
    expect(within(rows[1]).getByText("–")).toBeTruthy();
    expect(within(rows[0]).getByText("Auto Diesel")).toBeTruthy();
    expect(screen.getByText("LKR 24,000 · 1 fill without an amount")).toBeTruthy();
    expect(document.body.textContent).not.toContain("LKR 0");
  });
});
