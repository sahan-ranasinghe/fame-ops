import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { DriverRoute } from "../data/types";
import { addDays, today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { DriverPage } from "./DriverPage";

// The map is not under test here (the drawn map is covered by live.test.ts, the real one needs a browser).
vi.mock("../map/MapView", () => ({ MapView: (p: { route: { points: unknown[] } | null }) => <div data-testid="map">{p.route ? `${p.route.points.length} points` : "no route"}</div> }));

const day = today();
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const route: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 830, first_point: "08:01", last_point: "16:31", km: 41.2, driving_minutes: 95, stopped_minutes: 343, stops_count: 1,
  stops_over_10_min: [{ from: "09:55", to: "15:38", minutes: 343, near: "Peliyagoda", lat: 6.96, lng: 79.89 }],
  gaps: [{ from: "14:00", to: "14:56", minutes: 56 }],
  timeline: [
    { kind: "driving", from: "08:01", to: "09:55", from_at: iso("08:01"), to_at: iso("09:55"), minutes: 114, km: 31.1, text: "08:01–09:55 Driving · 31.1 km" },
    { kind: "stopped", from: "09:55", to: "14:00", from_at: iso("09:55"), to_at: iso("14:00"), minutes: 245, near: "Peliyagoda", lat: 6.96, lng: 79.89, text: "09:55–14:00 Stopped near Peliyagoda" },
    { kind: "no_data", from: "14:00", to: "14:56", from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, text: "14:00–14:56 App not running" },
  ],
  route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")]] },
};
const live = {
  as_of: `${day} 16:40`, counts: { all: 1, sharing: 1, stale: 0, not_sharing: 0 },
  drivers: [{ driver: "Nuwan Perera", username: "nuwan.p", employee_id: "e1", state: "sharing" as const, location: "Live · 1 min", status: "live" as const, status_text: "Live · 1 min", last_position_at: "16:39", vehicle: "WP CAB-4521 · Toyota HiAce", task: "Team drop", near: "Kelaniya", lat: 6.96, lng: 79.89, links: { call: "tel:0771234567", whatsapp: "https://wa.me/94771234567", maps: "https://maps" } }],
};
const drivers = { drivers: [{ name: "Nuwan Perera", username: "nuwan.p", code: "D-001", phone: "0771234567", current_vehicle: "WP CAB-4521" }] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"], tools: ["live_drivers", "driver_route", "list_drivers", "list_vehicles", "list_places"] });
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "driver_route") return args.date === day ? route : { driver: "Nuwan Perera", date: String(args.date), recorded_points: 0, note: "No location was shared on this day." };
    if (tool === "live_drivers") return live;
    if (tool === "list_drivers") return drivers;
    return { vehicles: [], places: [] };
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(this.answer(tool, args) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push({ tool, args });
    cb({ type: "data", data: this.answer(tool, args) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount() {
  const transport = new FakeTransport();
  const store = new FleetStore(transport);
  const me = await transport.me();
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false }}>
      <MemoryRouter initialEntries={["/drivers/nuwan.p"]}><Routes><Route path="/drivers/:username" element={<DriverPage />} /></Routes></MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

describe("DriverPage", () => {
  it("shows who, the status, today's numbers, the timeline and the playback", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Nuwan Perera" })).toBeTruthy();
    expect(screen.getByText("Live · 1 min")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:0771234567");
    expect(screen.getByText("Km (GPS)").parentElement?.textContent).toContain("41.2");
    expect(screen.getByText("Driving time").parentElement?.textContent).toContain("1 h 35 min");
    expect(screen.getByText("Stopped time").parentElement?.textContent).toContain("1 gap with no position");
    const rows = screen.getByTestId("timeline").querySelectorAll(".tl-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Driving · 31.1 km");
    expect(rows[1].textContent).toContain("near Peliyagoda");
    expect(rows[2].textContent).toContain("App not running");
    expect(screen.getByTestId("map").textContent).toBe("3 points");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    fireEvent.click(rows[1]);
    expect(rows[1].className).toContain("sel");
  });
  it("Yesterday asks the tool for that day and says when nothing was shared", async () => {
    const transport = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    await act(async () => { await Promise.resolve(); });
    expect(transport.calls.some((c) => c.tool === "driver_route" && c.args.date === addDays(day, -1))).toBe(true);
    expect(await screen.findByText("No location was shared on this day.")).toBeTruthy();
    expect(screen.getByTestId("map").textContent).toBe("no route");
  });
});
