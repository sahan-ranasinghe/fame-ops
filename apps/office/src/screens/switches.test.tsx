// Round 4–7 (docs/phase8-plan.md §33), the fresh reviewer's finding 1: a feature switched off in Settings → Fleet hides its
// part on the website too, read as the site reads the settings (get_settings through useFleetSettings), and a switch saved
// in Settings is followed in the same tab without a reload.
//   - fuel_card: the task page's fuel card (an answer that still carries one, and one without);
//   - passengers: who rides by name with Share trip on a task and a request (the count stays);
//   - vehicle_check: a vehicle's check section;
//   - holder_contact: More's Asks, the Timeline's Asks button, a task's asks line and its 60-second poll (no holder_asks call);
//   - a save of update_settings asks get_settings again for every page showing it (store.refetchTool).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { moreFor } from "../app/nav";
import { FleetStore } from "../data/store";
import type { FleetSettings as Values, RequestCard, TaskDetail as TaskDetailData, VehicleCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { useSwitch } from "./dispatchParts";
import { More } from "./More";
import { RequestDetailCard } from "./RequestDetailCard";
import { Schedule } from "./Schedule";
import { FleetSettings } from "./settings/FleetSettings";
import { featureOn, pageSwitchedOn, switchesOff } from "./switchLogic";
import { TaskDetail } from "./TaskDetail";
import { VehicleDetail } from "./VehicleDetail";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));

type Args = Record<string, unknown>;

/** Each tool answers what the test gives it (a function gets the arguments); else it refuses. get_settings answers `stored`. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(public stored: Partial<Values>, private answers: Record<string, (args: Args) => unknown> = {}) {}
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string): Args[] {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "get_settings") return Promise.resolve({ settings: structuredClone(this.stored), defaults: {}, about: {}, base_place: null, routing_provider: "estimate" } as T);
    if (tool === "update_settings") {
      Object.assign(this.stored, { [String(args.key)]: args.value });
      return Promise.resolve({ ok: true } as T);
    }
    if (tool === "routing_usage") return Promise.resolve({ provider: "estimate", daily_budget: { ors: 2000 }, days: [] } as T);
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "tool_error", message: `No ${tool} here` });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = {
  name: "Palitha", role: "office", permissions: ["view", "request", "assign_tasks"],
  tools: ["get_settings", "task_detail", "holder_asks", "day_timeline", "list_vehicles", "vehicle_checks"],
};

function mount(t: FakeTransport, ui: ReactNode, url = "/", me: Me = dispatcher) {
  const store = new FleetStore(t);
  render(
    <FleetProvider value={{ store, transport: t, me, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
  return store;
}

const settled = (t: FakeTransport) => waitFor(() => expect(t.argsOf("get_settings").length).toBeGreaterThan(0));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const RIDERS = [
  { name: "Asha Fernando", registered: true, employee_id: "e1" },
  { name: "Ruwan", registered: false, phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", share: "https://wa.me/94771234567?text=Hi%20Ruwan" },
];

const detail: TaskDetailData = {
  task: {
    id: "t1", title: "Team drop · Kurunegala", status: "assigned", start: "Fri 23 Oct 07:30", driver: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce", passengers: 5,
    passengers_list: RIDERS,
    fuel_card: { task_id: "t1", km: 180, electric: false, fuel_type: "diesel", litres_low: 13, litres_high: 17, estimate_text: "About 180 km · roughly 13–17 L diesel (approx.)" },
  },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
} as unknown as TaskDetailData;

const asks = (which: string) => ({ which, count: 1, asks: [{ id: "a1", task_id: "t1", resource: "driver", wanted: "Fri 23 Oct 08:00–11:00", asked_at: "2026-10-22 09:00" }] });

const taskPage = <Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes>;

describe("the switches' rule (switchLogic)", () => {
  it("on unless saved off; the pages a switch hides", () => {
    expect(featureOn(undefined, "fuel_card")).toBe(true);
    expect(featureOn({ fuel_card: true }, "fuel_card")).toBe(true);
    expect(featureOn({ fuel_card: false }, "fuel_card")).toBe(false);
    expect(switchesOff({ passengers: false, holder_contact: false, vehicle_check: true })).toEqual(["passengers", "holder_contact"]);
    expect(pageSwitchedOn("holder_asks", ["holder_contact"])).toBe(false);
    expect(pageSwitchedOn("holder_asks", ["passengers"])).toBe(true);
    expect(pageSwitchedOn("issues", ["holder_contact"])).toBe(true);
    const keys = (off: Parameters<typeof moreFor>[1]) => moreFor({ permissions: ["request"] }, off).map((n) => n.key);
    expect(keys([])).toContain("holder_asks");
    expect(keys(["holder_contact"])).not.toContain("holder_asks");
  });
});

describe("the task page follows the switches", () => {
  it("all on: the fuel card, who rides by name with Share trip, the asks line (holder_asks asked)", async () => {
    const t = new FakeTransport({}, { task_detail: () => detail, holder_asks: (a) => asks(String(a.which)) });
    mount(t, taskPage, "/tasks/t1");
    await screen.findByTestId("task-detail");
    expect(screen.getByTestId("fuel-card").textContent).toContain("About 180 km");
    const box = screen.getByTestId("task-passengers");
    expect(box.textContent).toContain("5 · Asha Fernando, Ruwan +3");
    expect(within(box).getByTestId("share-trip")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("task-asks").textContent).toBe("Asks about this trip · 1"));
    expect(t.argsOf("holder_asks").length).toBeGreaterThan(0);
  });

  it("fuel_card, passengers and holder_contact off: no fuel card, the count without names or Share trip, no asks line and no holder_asks call", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const t = new FakeTransport({ fuel_card: false, passengers: false, holder_contact: false }, { task_detail: () => detail, holder_asks: (a) => asks(String(a.which)) });
      mount(t, taskPage, "/tasks/t1");
      await screen.findByTestId("task-detail");
      await settled(t);
      await flush();
      expect(screen.queryByTestId("fuel-card")).toBeNull();
      const box = screen.getByTestId("task-passengers");
      expect(box.textContent).toBe("Passengers5");
      expect(within(box).queryByTestId("passenger-row")).toBeNull();
      expect(within(box).queryByTestId("share-trip")).toBeNull();
      // The 60-second poll never starts.
      await act(async () => { await vi.advanceTimersByTimeAsync(130_000); });
      expect(t.argsOf("holder_asks")).toEqual([]);
      expect(screen.queryByTestId("task-asks")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an answer with no fuel card shows none (the switch on)", async () => {
    const t = new FakeTransport({}, { task_detail: () => ({ ...detail, task: { ...detail.task, fuel_card: undefined } }) });
    mount(t, taskPage, "/tasks/t1");
    await screen.findByTestId("task-detail");
    await settled(t);
    await flush();
    expect(screen.queryByTestId("fuel-card")).toBeNull();
  });
});

describe("a request's riders follow the passengers switch", () => {
  const q = { id: "r1", requested_by: "Anoja Perera", when: "Fri 23 Oct 09:00", status: "waiting", fields: { pax: 4 }, passengers_list: RIDERS } as unknown as RequestCard;
  it("on: Who rides with the names; off: nothing named", async () => {
    const on = new FakeTransport({});
    mount(on, <RequestDetailCard q={q} />);
    await settled(on);
    await flush();
    expect(screen.getByTestId("request-passengers").textContent).toContain("Asha Fernando, Ruwan +2");
    document.body.innerHTML = "";
    const off = new FakeTransport({ passengers: false });
    mount(off, <RequestDetailCard q={q} />);
    await settled(off);
    await flush();
    expect(screen.queryByTestId("request-passengers")).toBeNull();
    expect(screen.queryByTestId("share-trip")).toBeNull();
  });
});

describe("a vehicle's check section follows vehicle_check", () => {
  const vehicles = { filter: "all", counts: {}, vehicles: [{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce" } as VehicleCard] };
  const page = <Routes><Route path="/vehicles/:reg" element={<VehicleDetail />} /></Routes>;
  it("on: the section; off: none (and no vehicle_checks call)", async () => {
    const on = new FakeTransport({}, { list_vehicles: () => vehicles, vehicle_checks: () => ({ count: 0, checks: [] }) });
    mount(on, page, "/vehicles/WP%20CAB-4521");
    await screen.findByTestId("vehicle-detail");
    await waitFor(() => expect(screen.getByTestId("vehicle-checks")).toBeTruthy());
    document.body.innerHTML = "";
    const off = new FakeTransport({ vehicle_check: false }, { list_vehicles: () => vehicles, vehicle_checks: () => ({ count: 0, checks: [] }) });
    mount(off, page, "/vehicles/WP%20CAB-4521");
    await screen.findByTestId("vehicle-detail");
    await settled(off);
    await flush();
    expect(screen.queryByTestId("vehicle-checks")).toBeNull();
    expect(off.argsOf("vehicle_checks")).toEqual([]);
  });
});

describe("holder_contact off hides Asks from More and the Timeline", () => {
  it("More lists Asks only while the switch is on", async () => {
    const on = new FakeTransport({});
    mount(on, <More />, "/more");
    await settled(on);
    await waitFor(() => expect(screen.getByRole("link", { name: "Asks" }).getAttribute("href")).toBe("/tasks/asks"));
    document.body.innerHTML = "";
    const off = new FakeTransport({ holder_contact: false });
    mount(off, <More />, "/more");
    await settled(off);
    await flush();
    expect(screen.queryByRole("link", { name: "Asks" })).toBeNull();
    expect(screen.getByRole("link", { name: "Timeline" })).toBeTruthy();
  });

  it("the Timeline's Asks button only while the switch is on", async () => {
    const on = new FakeTransport({}, { day_timeline: () => ({ date: "2026-10-24", kind: "drivers", count: 0, busy: 0, rows: [] }) });
    mount(on, <Schedule />, "/schedule");
    await settled(on);
    await waitFor(() => expect(screen.getByRole("link", { name: "Asks" })).toBeTruthy());
    document.body.innerHTML = "";
    const off = new FakeTransport({ holder_contact: false }, { day_timeline: () => ({ date: "2026-10-24", kind: "drivers", count: 0, busy: 0, rows: [] }) });
    mount(off, <Schedule />, "/schedule");
    await settled(off);
    await flush();
    expect(screen.queryByRole("link", { name: "Asks" })).toBeNull();
  });
});

/** What a page on screen reads of a switch (useSwitch), beside Settings in the same tab. */
function Probe() {
  const s = useSwitch("holder_contact");
  return <output data-testid="probe">{s.settled ? (s.on ? "on" : "off") : "…"}</output>;
}

describe("a switch saved in Settings is followed in the same tab", () => {
  it("update_settings asks get_settings again for the pages showing it (no reload)", async () => {
    const admin: Me = { name: "Sahan", role: "admin", permissions: ["view", "users"], tools: ["get_settings", "update_settings", "routing_usage"] };
    const t = new FakeTransport({
      dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5 }, buffer_min: 15, base_place_id: null, avg_speed_kmh: 35, road_factor: 1.3,
      accept_within_min: 15, accept_before_leave_min: 30, accept_reminder_min: 5,
      rush_hour: { factor: 1.3, centre: { lat: 6.92, lng: 79.86 }, radius_km: 15, bands: [] },
    } as Partial<Values>);
    mount(t, <><Probe /><FleetSettings section="dispatch" /></>, "/settings/fleet/dispatch", admin);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("on"));
    const card = within(await screen.findByTestId("feature-settings"));
    fireEvent.click(card.getByLabelText("Who holds a busy driver or vehicle"));
    await waitFor(() => expect(t.argsOf("update_settings")).toEqual([{ key: "holder_contact", value: false }]));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("off"));
  });

  it("store.refetchTool: every query on screen asking the tool, whatever its onWrite", async () => {
    const t = new FakeTransport({});
    const store = new FleetStore(t);
    store.retain("q:settings:{}", "get_settings", {}, false);
    store.retain("q:other:{}", "holder_asks", {}, false);
    store.refetchTool("get_settings");
    await flush();
    expect(t.argsOf("get_settings")).toHaveLength(1);
    expect(t.argsOf("holder_asks")).toHaveLength(0);
    expect(store.get("q:settings:{}").data).toBeTruthy();
  });
});
