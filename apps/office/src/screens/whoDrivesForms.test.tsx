// Round 3 on the forms: "Who drives?" on Assign a task (I'll drive myself / Someone else: no driver field, no Who's
// available, Save waits for a plate with the reason under it, create_task gets driven_by and no driver) and on a new
// request (create_request gets driven_by), hidden while the fleet setting self_drive_allowed is off.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { NewRequest } from "./NewRequest";
import { NewTask } from "./NewTask";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks", "approve"], tools: ["get_settings", "list_drivers", "list_vehicles", "list_places", "create_task", "availability"] };
const requester: Me = { name: "Dilini Jayasinghe", role: "staff", permissions: ["view", "request"], tools: ["get_settings", "create_request", "list_requests"] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, unknown>, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (!(tool in this.answers)) return Promise.reject({ code: "not_found", message: tool });
    return Promise.resolve(structuredClone(this.answers[tool]) as T);
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
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

const settings = (selfDrive: boolean) => ({ settings: { dwell_min: {}, self_drive_allowed: selfDrive }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" });

function mount(t: FakeTransport, me: Me, url: string) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/tasks/new" element={<NewTask />} />
            <Route path="/tasks/:id" element={<p data-testid="task-page">task</p>} />
            <Route path="/requests/new" element={<NewRequest />} />
            <Route path="/requests" element={<p data-testid="requests">requests</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

async function fillTrip(title?: string) {
  if (title) fireEvent.change(screen.getByLabelText("Task", { exact: true }), { target: { value: title } });
  const leave = screen.getByLabelText("Leave by", { exact: true });
  fireEvent.change(leave, { target: { value: "09:30" } });
  fireEvent.blur(leave);
  // Fix B: the form opens with From and one To; + Add stop puts Stop 1 before To (two stops, as before).
  fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
  fireEvent.change(screen.getByLabelText("Stop 1", { exact: true }), { target: { value: "Head office" } });
  fireEvent.change(screen.getByLabelText("To", { exact: true }), { target: { value: "Galle" } });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T08:00:00+05:30"));
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

const taskAnswers = (selfDrive = true) => ({
  get_settings: settings(selfDrive),
  list_drivers: { drivers: [{ name: "Kamal Perera", username: "kamal.p", active: true }] },
  list_vehicles: { vehicles: [{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, status: "Available", active: true }] },
  list_places: { places: [] },
  create_task: { task_id: "t1", leave_by: "2026-10-21 09:30", vehicle: "WP CAB-4521" },
});

describe("Assign a task: who drives (Round 3)", () => {
  it("Someone else: no driver field and no Who's available; Save waits for a plate with the reason; create_task names them and no driver", async () => {
    const t = new FakeTransport(taskAnswers(), dispatcher);
    mount(t, dispatcher, "/tasks/new");
    await settle();
    expect(screen.getByLabelText("Driver", { exact: true })).toBeTruthy();
    await fillTrip("Team drop");
    fireEvent.click(screen.getByRole("button", { name: "Someone else" }));
    expect(screen.queryByLabelText("Driver", { exact: true })).toBeNull();
    expect(screen.queryByTestId("availability")).toBeNull();
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Nimal Silva" } });
    fireEvent.change(screen.getByLabelText("Their phone"), { target: { value: "077 123 4567" } });
    const save = screen.getByRole("button", { name: "Save the task" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByTestId("save-why").textContent).toBe("Nimal Silva drives it: pick the vehicle (nobody confirms one on the day).");
    expect(screen.getByTestId("no-app").textContent).toBe("Nimal Silva drives it: no app, so nothing is sent.");
    fireEvent.change(screen.getByLabelText("Vehicle", { exact: true }), { target: { value: "WP CAB-4521" } });
    expect(save.disabled).toBe(false);
    expect(screen.queryByTestId("save-why")).toBeNull();
    fireEvent.click(save);
    await settle();
    const args = t.argsOf("create_task")[0];
    expect(args).toMatchObject({ title: "Team drop", vehicle: "WP CAB-4521", driven_by: "other", driver_name: "Nimal Silva", driver_phone: "077 123 4567" });
    expect(args).not.toHaveProperty("driver");
    expect(screen.getByTestId("task-page")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Task saved · Nimal Silva drives it");
  });

  it("with self-drive off the question is not there and the driver field stays", async () => {
    const t = new FakeTransport(taskAnswers(false), dispatcher);
    mount(t, dispatcher, "/tasks/new");
    await settle();
    expect(screen.queryByTestId("who-drives")).toBeNull();
    expect(screen.getByLabelText("Driver", { exact: true })).toBeTruthy();
  });
});

describe("A new request: who drives (Round 3)", () => {
  it("I'll drive myself is sent as driven_by self; the hint says the office picks the vehicle", async () => {
    const t = new FakeTransport({ get_settings: settings(true), create_request: { request: { id: "r1" }, next: "Sent to the fleet admin · you'll be notified." } }, requester);
    mount(t, requester, "/requests/new");
    await settle();
    expect(screen.queryByText("A driver is needed")).toBeNull();
    await fillTrip();
    fireEvent.click(screen.getByRole("button", { name: "I'll drive myself" }));
    expect(screen.getByTestId("who-hint").textContent).toBe("You drive it yourself: no app and nothing is sent. The office picks the vehicle.");
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await settle();
    expect(t.argsOf("create_request")[0]).toMatchObject({ driven_by: "self" });
    expect(screen.getByTestId("requests")).toBeTruthy();
  });
});
