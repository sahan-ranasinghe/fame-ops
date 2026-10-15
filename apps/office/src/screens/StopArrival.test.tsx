import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Stop } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { StopArrival } from "./StopArrival";

class Saves implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private tools = ["save_arrival_place"]) {}
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["assign_tasks"], tools: this.tools });
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve({ place: { id: "p-9", name: String(args.name) }, existing: false } as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const reached: Stop = {
  id: "s-1", seq: 2, type: "drop", status: "done", place: "Kandy City Centre", google: true, google_place_id: "ChIJ-kcc",
  arrival: { at: "10:42", lat: 7.2932, lng: 80.6352, accuracy_m: 8, near: "Kandy", maps: "https://www.google.com/maps/search/?api=1&query=7.2932,80.6352" },
};

async function mount(stop: Stop, transport = new Saves()) {
  const me = await transport.me();
  let saved = 0;
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><StopArrival stop={stop} onSaved={() => { saved += 1; }} /></MemoryRouter>
    </FleetProvider>,
  );
  return { transport, saved: () => saved };
}

describe("StopArrival (Part 5b)", () => {
  it("shows where the driver arrived, and saves a reached Google stop as our place under the office's own name", async () => {
    const { transport, saved } = await mount(reached);
    expect(screen.getByTestId("stop-arrival").textContent).toContain("the driver arrived 10:42 near Kandy · phone ±8 m");
    fireEvent.click(screen.getByRole("button", { name: "Save as our place" }));
    fireEvent.change(screen.getByLabelText("Our name for this place"), { target: { value: "Kandy client office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved()).toBe(1));
    expect(transport.calls).toEqual([{ tool: "save_arrival_place", args: { stop_id: "s-1", name: "Kandy client office" } }]);
  });

  it("no button for our own stop, for a stop already saved, or without the permission", async () => {
    await mount({ ...reached, google: false, google_place_id: undefined });
    expect(screen.queryByRole("button", { name: "Save as our place" })).toBeNull();
  });

  it("a saved stop links to its place", async () => {
    await mount({ ...reached, saved_place: { id: "p-9", name: "Kandy client office" } });
    expect(screen.getByRole("link", { name: "Kandy client office" }).getAttribute("href")).toBe("/places/p-9");
    expect(screen.queryByRole("button", { name: "Save as our place" })).toBeNull();
  });

  it("without save_arrival_place the arrival shows, the button does not", async () => {
    await mount(reached, new Saves([]));
    expect(screen.getByTestId("stop-arrival")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save as our place" })).toBeNull();
  });
});
