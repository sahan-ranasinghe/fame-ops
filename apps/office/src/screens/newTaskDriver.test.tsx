// Part 3b (H5): the Drivers board's "New task" opens Assign a task with that driver picked (/tasks/new?driver=<username>).
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { NewTask } from "./NewTask";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["get_settings", "list_drivers", "list_vehicles", "list_places"] };

const answers: Record<string, unknown> = {
  get_settings: { settings: { dwell_min: {} }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" },
  list_drivers: { drivers: [{ name: "Kamal Perera", username: "kamal.p", active: true }, { name: "Nuwan Silva", username: "nuwan.s", active: true }] },
  list_vehicles: { vehicles: [] },
  list_places: { places: [] },
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  call<T>(tool: string): Promise<T> {
    return tool in answers ? Promise.resolve(structuredClone(answers[tool]) as T) : Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(tool: string, _a: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Assign a task from the Drivers board", () => {
  it("?driver= picks that driver", async () => {
    const transport = new FakeTransport();
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me: dispatcher, noConnector: false }}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/tasks/new?driver=nuwan.s"]}><Routes><Route path="/tasks/new" element={<NewTask />} /></Routes></MemoryRouter>
        </ToastProvider>
      </FleetProvider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect((screen.getByLabelText("Driver") as HTMLSelectElement).value).toBe("nuwan.s");
  });
});
