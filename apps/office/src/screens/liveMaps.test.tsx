// Live's map (Phase 7, §21, §25, §26): today's trails are the map's own toggle (no big control on the page) and are never
// snapped; the shown route is snapped by default with "Recorded points", and its gaps are markers with the list in the card.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { applyFilter } from "../test/controls";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { DriverRoute } from "../data/types";
import { today } from "../lib/format";
import type { MapProps } from "../map/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { Live, ROUTE_ARGS, shownArgs } from "./Live";

const seen: { props: MapProps | null } = { props: null };
vi.mock("../map/MapView", () => ({
  MapView: (p: MapProps) => {
    seen.props = p;
    return (
      <div data-testid="map" data-open={p.openGap ?? ""}>
        {p.trailsToggle ? <button type="button" aria-pressed={p.trailsToggle.on} onClick={p.trailsToggle.toggle}>Today’s trails</button> : null}
        <button type="button" data-testid="map-close" onClick={() => p.onGap?.(null)} />
      </div>
    );
  },
}));

const day = today();
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const route: DriverRoute = {
  driver: "Nuwan Perera", date: day, recorded_points: 4, km: 12.5, first_point: "08:01", last_point: "14:56",
  timeline: [],
  route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")], ["14:56", 6.93, 79.86, 0, iso("14:56")]] },
  holes: [{ from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, kind: "no_gps", text: "Stopped · no GPS signal · 56 min" }],
  snapped: { provider: "google_roads", status: "ok" },
  route_snapped: { columns: ["time", "lat", "lng", "km/h", "at", "acc", "snapped"], points: [["08:01", 6.88, 79.86, 0, iso("08:01"), 5, 0], ["09:00", 6.92, 79.87, 30, iso("09:00"), null, 1], ["09:55", 6.96, 79.89, 38, iso("09:55"), 5, 0], ["14:00", 6.96, 79.89, 0, iso("14:00"), 5, 0], ["14:56", 6.93, 79.86, 0, iso("14:56"), 5, 0]] },
};
const live = {
  as_of: `${day} 16:40`, counts: { all: 1, sharing: 1, stale: 0, not_sharing: 0 },
  drivers: [{ driver: "Nuwan Perera", username: "nuwan.p", employee_id: "e1", state: "sharing" as const, duty: "on_duty" as const, location: "Live · 1 min", status: "live" as const, status_text: "Live · 1 min", last_position_at: "16:39", vehicle: "WP CAB-4521 · Toyota HiAce", near: "Kelaniya", lat: 6.96, lng: 79.89, links: {} }],
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Palitha", role: "office", permissions: ["view", "assign_tasks", "vehicles"], tools: ["live_drivers", "driver_route", "watch_drivers"] });
  }
  answer(tool: string): unknown {
    if (tool === "driver_route") return route;
    if (tool === "live_drivers") return live;
    return {};
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(this.answer(tool) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push({ tool, args });
    cb({ type: "data", data: this.answer(tool) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount() {
  const transport = new FakeTransport();
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><Live /></MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}
const routeCalls = (t: FakeTransport) => t.calls.filter((c) => c.tool === "driver_route");

afterEach(() => { seen.props = null; });

describe("Live's map", () => {
  it("the trails never ask for snap to roads; the shown route asks for it by default", () => {
    expect(ROUTE_ARGS).not.toHaveProperty("snap");
    expect(shownArgs(true)).toMatchObject({ snap: true, estimate_gaps: true, line_tolerance_m: 0 });
    expect(shownArgs(false).snap).toBe(false);
  });

  it("today's trails are the map's toggle: no big control on the page, and the trails are asked without snap", async () => {
    const transport = await mount();
    expect(screen.queryByText("Show today’s trails")).toBeNull();
    expect(seen.props?.trailsToggle?.on).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Today’s trails" }));
    await act(async () => { await Promise.resolve(); });
    expect(seen.props?.trailsToggle?.on).toBe(true);
    const trails = routeCalls(transport);
    expect(trails.length).toBeGreaterThan(0);
    expect(trails.every((c) => !("snap" in c.args))).toBe(true);
  });

  it("the shown route: snapped by default, Recorded points for the raw line, the gaps as markers and a list in the card", async () => {
    const transport = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Today’s route" }));
    await act(async () => { await Promise.resolve(); });
    expect(routeCalls(transport).at(-1)?.args).toMatchObject({ driver: "nuwan.p", snap: true, estimate_gaps: true });
    expect(seen.props?.route?.points).toHaveLength(5); // the snapped line
    expect(screen.getByTestId("snap-legend").textContent).toContain("Snapped to roads · km from odometer");
    // Round 48 (item 3): the route's first and last point are pins; the gap's event mark is a layer, off by default, but a
    // Gaps list row still shows its own mark (the open one is always drawn).
    expect(seen.props?.gaps?.map((g) => g.kind)).toEqual(["start", "end"]);
    const row = screen.getByTestId("gap-row");
    expect(row.textContent).toBe("14:00–14:56Stopped · no GPS signal56 min");
    fireEvent.click(row);
    const event = seen.props?.gaps?.find((g) => g.kind === "no_gps");
    expect(event).toBeTruthy();
    expect(screen.getByTestId("map").dataset.open).toBe(event!.id);
    expect(seen.props?.focus).toHaveLength(2);
    // The page's Filter has the Layers section: Events on draws the marks without a row.
    fireEvent.click(screen.getByTestId("map-close"));
    expect(seen.props?.gaps?.map((g) => g.kind)).toEqual(["start", "end"]);
    applyFilter("Layers", /Events/);
    expect(seen.props?.gaps?.map((g) => g.kind)).toEqual(["start", "end", "no_gps"]);
    expect(screen.getByTestId("filter-chips").textContent).toContain("Layers: Events");
    fireEvent.click(screen.getByLabelText("Recorded points"));
    await act(async () => { await Promise.resolve(); });
    expect(routeCalls(transport).at(-1)?.args).toMatchObject({ snap: false });
    expect(seen.props?.route?.points).toHaveLength(4); // the recorded points
    expect(screen.getByTestId("snap-legend").textContent).toContain("Recorded points: the raw GPS line");
  });
});
