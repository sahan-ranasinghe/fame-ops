import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { DrawerProvider } from "../ui/Drawer";
import { ToastProvider } from "../ui/Toast";
import { Overview } from "./Overview";

const overview = {
  date: "2026-10-12",
  vehicles: { on_the_road: 2, total: 5, parked: 3, in_garage: 1 },
  tasks: { total: 4, in_progress: 1, done: 2 },
  requests: { waiting: 1, oldest: "3 h" },
  reminders: { count: 2, red: 1, window_days: 14 },
  on_the_road: [{ driver: "Nuwan Perera", vehicle: "WP CAB-4521", task: "Team drop", near: "Kurunegala", location: "Live · 2 min", links: { maps: "https://maps", call: "tel:0771" } }],
  needs_attention: [{ what: "Revenue licence expires", subject: "WP CAB-4521 · Toyota HiAce", due: "in 4 days", level: "red" }],
};
const waiting = { status: "waiting", count: 1, requests: [{ id: "r1", requested_by: "Isuru Bandara", project: "SLA", when: "Thu 8 Oct · 08:00", route: "Head office → Katunayake", need: "Car · 3 pax", status: "waiting" }] };

/** Answers from fixtures; every watch delivers its data at once. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: string[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", tools: ["fleet_overview", "list_requests", "decide_request", "create_task", "create_request"] });
  }
  call<T>(tool: string): Promise<T> {
    this.calls.push(tool);
    return Promise.resolve((tool === "fleet_overview" ? overview : waiting) as T);
  }
  watch<T>(tool: string, _args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push("watch:" + tool);
    cb({ type: "data", data: (tool === "fleet_overview" ? overview : waiting) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

describe("Overview", () => {
  it("shows the tiles, the road, the reminders and the waiting requests", async () => {
    const transport = new FakeTransport();
    const store = new FleetStore(transport);
    const me = await transport.me();
    store.watch("overview", "fleet_overview", {}, 30000);
    render(
      <FleetProvider value={{ store, transport, me, noConnector: false }}>
        <ToastProvider><DrawerProvider><MemoryRouter><Overview /></MemoryRouter></DrawerProvider></ToastProvider>
      </FleetProvider>,
    );
    expect(screen.getByText("Vehicles on the road").parentElement?.textContent).toContain("2of 5");
    expect(screen.getByText("Oldest waiting 3 h")).toBeTruthy();
    expect(screen.getByText("1 need action now")).toBeTruthy();
    expect(screen.getByText("Nuwan Perera")).toBeTruthy();
    expect(screen.getByText("Live · 2 min")).toBeTruthy();
    expect(screen.getByText("Revenue licence expires")).toBeTruthy();
    expect(await screen.findByText("Isuru Bandara")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve & assign" })).toBeTruthy();
    expect(transport.calls).toContain("watch:list_requests");
  });
});
