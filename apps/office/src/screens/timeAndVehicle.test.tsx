// Hotfix 2 on Assign a task (/tasks/new): the time fields commit, then plan (C): the browser's time field fires
// "02:00" then "14:00" as the hours, the minutes and AM/PM are set, and the page plans once, for 14:00, with no
// departure warning in between. And the vehicle field (J): with vehicle_on_the_day on, "Driver's vehicle on the day" is
// the default for a later day and for today when the driver brings no vehicle, else the driver's vehicle as before; with
// the setting off nothing changes.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { draftKey, writeDraft } from "../data/drafts";
import { FleetStore } from "../data/store";
import type { PlanPreview } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TIME_SETTLE_MS } from "../ui/TimeInput";
import { emptyAssign } from "./assignLogic";
import { PLAN_DEBOUNCE_MS } from "./dispatchParts";
import { NewTask } from "./NewTask";
import { newStop } from "./stopsLogic";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Answer = (args: Record<string, unknown>, n: number) => unknown;

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
    return Promise.resolve(structuredClone(a(args, this.argsOf(tool).length)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

const dispatcher: Me = {
  name: "Palitha", role: "fleet_admin", permissions: ["view", "approve", "assign_tasks"],
  tools: ["get_settings", "plan_task", "list_drivers", "list_vehicles", "list_places", "create_task"],
};

/** The plan for one drop at Galle by 10:00: leaving 07:00 arrives 09:50 (10 min to spare: nothing to say). */
const plan = (leave: string): PlanPreview => ({
  date: "2026-10-20",
  leave_by: `Tue 20 Oct ${leave}`,
  leave_by_source: "manual",
  start: { name: "Head office", has_pin: true, lat: 6.9271, lng: 79.8612 },
  stops: [{ seq: 1, n: 1, type: "drop", place: "Galle", arrive_by: "10:00", planned_arrive: "09:50", dwell_min: 5, dwell_source: "default", lat: 6.03, lng: 80.22 }],
  warnings: [],
  plan: { buffer_min: 0 } as PlanPreview["plan"],
  timeline: {
    items: [
      { kind: "leave", at: "07:00", source: "manual" },
      { kind: "leg", from_n: "start", to_n: 1, km: 120, minutes: 170, source: "estimate" },
      { kind: "stop", n: 1, label: "Stop 1 · Drop · Galle", place: "Galle", planned_arrive: "09:50", planned_leave: "09:55", arrive_by: "10:00", dwell_min: 5 },
    ],
    totals: { drive_min: 170, km: 120, ends: "09:55" },
  },
});

function transportFor(onTheDay: boolean) {
  return new FakeTransport({
    get_settings: () => ({ settings: { dwell_min: {}, vehicle_on_the_day: onTheDay }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    plan_task: (a) => plan(String(a.leave_by ?? "07:00")),
    list_drivers: () => ({
      drivers: [
        { name: "Kamal Perera", username: "kamal", current_vehicle: "WP CAB-4521", active: true },
        { name: "Nuwan Silva", username: "nuwan", active: true },
      ],
    }),
    list_vehicles: () => ({ vehicles: [{ reg_no: "WP CAB-4521" }, { reg_no: "WP KL-1234" }] }),
    list_places: () => ({ places: [] }),
    create_task: () => ({ task_id: "t1", title: "Drop", leave_by: "Sun 25 Oct 07:00", warnings: [] }),
  }, dispatcher);
}

/** Assign a task with a draft resumed: a drop at Galle by 10:00, leaving 07:00, on `date`, with `driver`. */
async function openAssign(transport: FakeTransport, date: string, driver = "kamal") {
  writeDraft(draftKey("artifact", "task-new", null), {
    f: { ...emptyAssign(date), title: "Drop at Galle", leaveBy: "07:00", driver, stops: [{ ...newStop("drop"), place: "Galle", arriveBy: "10:00" }] },
    rows: [],
  });
  const store = new FleetStore(transport);
  render(
    <FleetProvider value={{ store, transport, me: dispatcher, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/tasks/new"]}><Routes><Route path="/tasks/new" element={<NewTask />} /></Routes></MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await settle();
  await settle(PLAN_DEBOUNCE_MS);
  await settle();
}

const leaveField = () => screen.getByLabelText("Leave by") as HTMLInputElement;
const noWarning = () => {
  expect(screen.queryByTestId("departure-check")).toBeNull();
  expect(screen.queryByTestId("departure-check-stop")).toBeNull();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T09:00:00+05:30"));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Assign a task: a time field counts when it is done (C)", () => {
  it("hours, then minutes, then AM/PM: one plan, for 14:00, and no warning in between", async () => {
    const transport = transportFor(false);
    await openAssign(transport, "2026-10-20");
    expect(transport.argsOf("plan_task").map((a) => a.leave_by)).toEqual(["07:00"]);
    noWarning();

    // The browser fires a whole time for each part: the hours (02, the minutes kept), the minutes, then PM.
    fireEvent.change(leaveField(), { target: { value: "02:00" } });
    await settle(300);
    noWarning();
    await settle(300); // the minutes typed: "02:00" again, no change event
    noWarning();
    fireEvent.change(leaveField(), { target: { value: "14:00" } });
    expect(leaveField().value).toBe("14:00");
    await settle(300);
    noWarning();
    expect(transport.argsOf("plan_task")).toHaveLength(1);

    // 1 s after the last change the time counts: the departure check says it at once, then one plan for 14:00.
    await settle(TIME_SETTLE_MS);
    expect(screen.getByTestId("departure-check").textContent).toContain("Leaving 14:00 you reach Galle at 16:50");
    await settle(PLAN_DEBOUNCE_MS);
    await settle();
    expect(transport.argsOf("plan_task").map((a) => a.leave_by)).toEqual(["07:00", "14:00"]);
  });

  it("leaving the field counts the time at once; a half-typed time counts nothing", async () => {
    const transport = transportFor(false);
    await openAssign(transport, "2026-10-20");
    fireEvent.change(leaveField(), { target: { value: "" } }); // the browser while only the hours are typed
    await settle(TIME_SETTLE_MS * 2);
    noWarning();
    expect(transport.argsOf("plan_task")).toHaveLength(1);
    fireEvent.change(leaveField(), { target: { value: "07:30" } });
    fireEvent.blur(leaveField());
    await settle(PLAN_DEBOUNCE_MS);
    await settle();
    expect(transport.argsOf("plan_task").map((a) => a.leave_by)).toEqual(["07:00", "07:30"]);
  });
});

describe("Assign a task: the vehicle field with vehicle_on_the_day (J)", () => {
  const vehicleSelect = () => screen.getByLabelText("Vehicle") as HTMLSelectElement;
  const firstOption = () => vehicleSelect().options[0].textContent;
  const optionTexts = () => [...vehicleSelect().options].map((o) => o.textContent);

  it("a later day: the driver's vehicle on the day by default, sent as such; Any van is offered", async () => {
    const transport = transportFor(true);
    await openAssign(transport, "2026-10-25");
    expect(firstOption()).toBe("Driver's vehicle on the day");
    expect(optionTexts()).toEqual(expect.arrayContaining(["Any car", "Any van", "Any double cab", "Any lorry"]));
    expect(screen.getByTestId("vehicle-day-default")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign & send" }));
    await settle();
    expect(transport.argsOf("create_task")[0]).toMatchObject({ driver: "kamal", vehicle: "on the day", date: "2026-10-25" });
  });

  it("today: the driver's vehicle today as before; a driver who brings none gets the vehicle on the day, never a block", async () => {
    const transport = transportFor(true);
    await openAssign(transport, "2026-10-18");
    expect(firstOption()).toBe("WP CAB-4521 · Kamal's vehicle today");
    expect(optionTexts()).toContain("Driver's vehicle on the day");

    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "nuwan" } });
    await settle();
    expect(firstOption()).toBe("Driver's vehicle on the day");
    fireEvent.click(screen.getByRole("button", { name: "Assign & send" }));
    await settle();
    expect(transport.argsOf("create_task")[0]).toMatchObject({ driver: "nuwan", vehicle: "on the day" });
  });

  it("a type picked is sent as its words", async () => {
    const transport = transportFor(true);
    await openAssign(transport, "2026-10-25");
    fireEvent.change(vehicleSelect(), { target: { value: "any van" } });
    expect(screen.getByTestId("vehicle-changed").textContent).toContain("Instead of the driver's vehicle on the day");
    fireEvent.click(screen.getByRole("button", { name: "Assign & send" }));
    await settle();
    expect(transport.argsOf("create_task")[0]).toMatchObject({ vehicle: "any van" });
  });

  it("with the setting off the field is as before: the driver's vehicle on a later day too, no choices, and a driver with none needs one", async () => {
    const transport = transportFor(false);
    await openAssign(transport, "2026-10-25");
    expect(firstOption()).toBe("WP CAB-4521 · Kamal's vehicle today");
    expect(optionTexts()).not.toContain("Driver's vehicle on the day");
    expect(optionTexts()).not.toContain("Any van");
    fireEvent.click(screen.getByRole("button", { name: "Assign & send" }));
    await settle();
    expect(transport.argsOf("create_task")[0]).not.toHaveProperty("vehicle");
  });
});
