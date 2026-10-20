// Hotfix O2-H2, Part 1b: after Assign & send, the form closes, the task opens in its place with the warnings, and the toast
// says who has it (with WhatsApp the driver as its action when asked for); a refused save keeps the form.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { readFlashWarnings } from "../data/flash";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { NewTask } from "./NewTask";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks", "approve"], tools: ["get_settings", "list_drivers", "list_vehicles", "list_places", "create_task"] };

let answers: Record<string, unknown | (() => unknown)>;
const calls: string[] = [];

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  call<T>(tool: string): Promise<T> {
    calls.push(tool);
    if (!(tool in answers)) return Promise.reject({ code: "not_found", message: tool });
    const a = answers[tool];
    try {
      return Promise.resolve(structuredClone(typeof a === "function" ? (a as () => unknown)() : a) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, _a: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function TaskPage() {
  const { id } = useParams();
  const state = useLocation().state as { warnings?: string[] } | null;
  return <div data-testid="task-page">{`task ${id}`} {(state?.warnings ?? []).join("|")}</div>;
}

async function tick() {
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

function renderForm() {
  const transport = new FakeTransport();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: dispatcher, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/tasks", "/tasks/new"]} initialIndex={1}>
          <Routes>
            <Route path="/tasks" element={<div>board</div>} />
            <Route path="/tasks/new" element={<NewTask />} />
            <Route path="/tasks/:id" element={<TaskPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

async function fillAndSend() {
  await tick();
  fireEvent.change(screen.getByLabelText("Task", { exact: true }), { target: { value: "Team drop" } });
  const leave = screen.getByLabelText("Leave by", { exact: true });
  fireEvent.change(leave, { target: { value: "09:30" } });
  fireEvent.blur(leave);
  fireEvent.change(screen.getByLabelText("Stop 1", { exact: true }), { target: { value: "Head office" } });
  fireEvent.change(screen.getByLabelText("Stop 2", { exact: true }), { target: { value: "Galle" } });
  fireEvent.change(screen.getByLabelText("Driver", { exact: true }), { target: { value: "kamal.p" } });
  await tick();
  fireEvent.change(screen.getByLabelText("Vehicle", { exact: true }), { target: { value: "WP CAB-4521" } });
  await tick();
  fireEvent.click(screen.getByRole("button", { name: "Assign & send" }));
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  calls.length = 0;
  answers = {
    get_settings: { settings: { dwell_min: {} }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" },
    list_drivers: { drivers: [{ name: "Kamal Perera", username: "kamal.p", active: true }] },
    list_vehicles: { vehicles: [{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, status: "Available", active: true }] },
    list_places: { places: [] },
    create_task: { task_id: "t1", leave_by: "2026-10-21 09:30", vehicle: "WP CAB-4521", warnings: ["WP CAB-4521 is over its monthly km allowance"] },
  };
});
afterEach(() => vi.useRealTimers());

describe("Assign a task: after the save", () => {
  it("opens the task in the form's place, the warnings wait on it, the toast says who has it", async () => {
    renderForm();
    await fillAndSend();
    expect(calls.filter((c) => c === "create_task")).toHaveLength(1);
    expect(screen.getByTestId("task-page").textContent).toContain("task t1");
    expect(screen.getByTestId("task-page").textContent).toContain("WP CAB-4521 is over its monthly km allowance");
    expect(readFlashWarnings("t1")).toEqual(["WP CAB-4521 is over its monthly km allowance"]);
    expect(screen.getByRole("status").textContent).toContain("Task sent to Kamal Perera");
  });

  it("a refused save keeps the form with the reason, and sends nothing again by itself", async () => {
    answers.create_task = () => {
      throw { code: "tool_error", message: "Kamal Perera is switched off." };
    };
    renderForm();
    await fillAndSend();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByTestId("task-page")).toBeNull();
    expect(screen.getByText(/switched off/)).toBeTruthy();
    expect(calls.filter((c) => c === "create_task")).toHaveLength(1);
  });
});
