import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { useLists } from "./hooks";
import { FleetStore } from "./store";

/** list_vehicles fails the first `failures` times with the given code, then answers. */
class FlakyTransport implements Transport {
  readonly kind = "api" as const;
  calls: string[] = [];
  constructor(private failures: number, private code = "network") {}
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", tools: ["list_drivers", "list_vehicles", "list_places"] });
  }
  call<T>(tool: string): Promise<T> {
    this.calls.push(tool);
    if (tool === "list_vehicles" && this.failures-- > 0) return Promise.reject({ code: this.code, message: "No connection to Fame Fleet." });
    const data = tool === "list_drivers" ? { drivers: [{ username: "nuwan.p", name: "Nuwan Perera" }] }
      : tool === "list_vehicles" ? { vehicles: [{ reg_no: "WP CAB-4521" }] }
      : { places: [] };
    return Promise.resolve(data as T);
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Lists() {
  const lists = useLists();
  return <div>drivers {lists.drivers?.length ?? "-"} · vehicles {lists.vehicles?.length ?? "-"} · error {lists.error ?? "-"}</div>;
}

async function mount(transport: FlakyTransport) {
  const store = new FleetStore(transport);
  const me = await transport.me();
  render(<FleetProvider value={{ store, transport, me, noConnector: false }}><Lists /></FleetProvider>);
  await act(async () => { await Promise.resolve(); });
}

const vehiclesCalls = (t: FlakyTransport) => t.calls.filter((c) => c === "list_vehicles").length;

describe("useLists", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tries a dropped list again by itself after 1.5 s, and the form never shows an error for it", async () => {
    const transport = new FlakyTransport(1);
    await mount(transport);
    expect(screen.getByText(/drivers 1 · vehicles - · error No connection/)).toBeTruthy();
    expect(vehiclesCalls(transport)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText("drivers 1 · vehicles 1 · error -")).toBeTruthy();
    expect(vehiclesCalls(transport)).toBe(2);
  });

  it("gives up after two retries and leaves the error for the person", async () => {
    const transport = new FlakyTransport(5);
    await mount(transport);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(vehiclesCalls(transport)).toBe(3);
    expect(screen.getByText(/vehicles - · error No connection/)).toBeTruthy();
  });

  it("does not retry an answer that was a refusal", async () => {
    const transport = new FlakyTransport(1, "forbidden");
    await mount(transport);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(vehiclesCalls(transport)).toBe(1);
  });
});
