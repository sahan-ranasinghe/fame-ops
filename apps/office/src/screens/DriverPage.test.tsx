import { pickStripDay } from "../test/controls";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { DriverRoute } from "../data/types";
import { addDays, today } from "../lib/format";
import type { MapProps } from "../map/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { DriverPage } from "./DriverPage";

// The map is not under test here (the drawn map is covered by live.test.ts, the real one needs a browser): the mock shows
// what the page gives it (the line's points, the gap markers, the open one, the playback marker) and closes a card like a tap.
const seen: { props: MapProps | null } = { props: null };
vi.mock("../map/MapView", () => ({
  MapView: (p: MapProps) => {
    seen.props = p;
    return (
      <div data-testid="map" data-gaps={p.gaps?.length ?? 0} data-open={p.openGap ?? ""} data-cursor={p.route?.cursor?.label ?? ""}>
        {p.route ? `${p.route.points.length} points` : "no route"}
        <button type="button" data-testid="map-close" onClick={() => p.onGap?.(null)} />
      </div>
    );
  },
}));

const day = today();
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const base: DriverRoute = {
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
let route: DriverRoute = base;
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

function Where() {
  const { search } = useLocation();
  return <div data-testid="where">{search}</div>;
}

async function mount(url = "/drivers/nuwan.p") {
  const transport = new FakeTransport();
  const store = new FleetStore(transport);
  const me = await transport.me();
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false }}>
      <MemoryRouter initialEntries={[url]}><Routes><Route path="/drivers/:username" element={<DriverPage />} /></Routes><Where /></MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

afterEach(() => {
  route = base;
  seen.props = null;
  vi.useRealTimers();
});

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
    // Round 3 (A1): one icon per row (Google Maps Timeline), no coloured bar.
    expect([...rows].map((r) => r.querySelector("[data-testid=tl-icon]")?.getAttribute("data-icon"))).toEqual(["car", "pin", "alert"]);
    expect(screen.getByTestId("timeline").querySelectorAll(".bar")).toHaveLength(0);
    expect(screen.getByTestId("map").textContent).toBe("3 points");
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    fireEvent.click(rows[1]);
    expect(rows[1].className).toContain("sel");
  }, 20_000); // the file's first test pays for importing the page (over 5 s while every test file runs at once)
  it("Yesterday asks the tool for that day and says when nothing was shared", async () => {
    const transport = await mount();
    // The week strip (docs/ui-patterns.md §3): yesterday's cell (or the calendar when yesterday is last week).
    pickStripDay(addDays(day, -1));
    await act(async () => { await Promise.resolve(); });
    expect(transport.calls.some((c) => c.tool === "driver_route" && c.args.date === addDays(day, -1))).toBe(true);
    expect(await screen.findByText("No location was shared on this day.")).toBeTruthy();
    expect(screen.getByTestId("map").textContent).toBe("no route");
    // The day is in the URL (Phase 7 §8: the date-range control in one-day mode).
    expect(screen.getByTestId("where").textContent).toBe("?range=yesterday");
  });
  it("opens on the day in the URL; the week strip picks one day (no From–To); no day after today", async () => {
    const past = addDays(day, -3);
    const transport = await mount(`/drivers/nuwan.p?range=custom&from=${past}`);
    expect(transport.calls.find((c) => c.tool === "driver_route")?.args.date).toBe(past);
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull();
    const strip = screen.getByTestId("day-strip");
    expect(strip.querySelector(`[data-day="${past}"]`)?.getAttribute("aria-pressed")).toBe("true");
    const tomorrow = strip.querySelector<HTMLButtonElement>(`[data-day="${addDays(day, 1)}"]`);
    if (tomorrow) expect(tomorrow.disabled).toBe(true);
    pickStripDay(addDays(day, -5));
    await act(async () => { await Promise.resolve(); });
    expect(transport.calls.some((c) => c.tool === "driver_route" && c.args.date === addDays(day, -5))).toBe(true);
    expect(screen.getByTestId("where").textContent).toBe(`?range=custom&from=${addDays(day, -5)}`);
  });
});

describe("the gaps on the driver page (§21)", () => {
  it("a marker per gap on the map and a row per gap beside it; a row opens its card and zooms to it, the map closes it", async () => {
    route = {
      ...base,
      route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")], ["14:56", 6.93, 79.86, 0, iso("14:56")]] },
      holes: [{ from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, kind: "no_data", text: "App not running · 56 min" }],
      uploaded_later: [{ from: "09:55", to: "09:55", uploaded: "10:20", from_at: iso("09:55"), to_at: iso("09:55") }],
    };
    await mount();
    const map = screen.getByTestId("map");
    expect(map.dataset.gaps).toBe("2");
    const rows = screen.getAllByTestId("gap-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "09:55Offline here · uploaded 10:20under 1 min",
      "14:00–14:56App not running56 min",
    ]);
    // The rows are not part of the timeline.
    expect(screen.getByTestId("timeline").querySelectorAll(".tl-row")).toHaveLength(3);
    fireEvent.click(rows[1]);
    expect(screen.getByTestId("map").dataset.open).toMatch(/^no_data-/);
    expect(rows[1].className).toContain("sel");
    expect(seen.props?.focus).toEqual([{ lat: 6.96, lng: 79.89 }, { lat: 6.93, lng: 79.86 }]);
    expect(seen.props?.gaps?.[1].text).toBe("App not running · 14:00–14:56 · 56 min");
    fireEvent.click(screen.getByTestId("map-close"));
    expect(screen.getByTestId("map").dataset.open).toBe("");
    expect(rows[1].className).not.toContain("sel");
  });
  it("no gaps: no list", async () => {
    await mount();
    expect(screen.queryByTestId("gaps-list")).toBeNull();
  });
});

describe("snap to roads on the driver page (§26)", () => {
  it("asks snapped by default; Recorded points asks for the raw line, and the legend says which", async () => {
    route = { ...base, snapped: { provider: "google_roads", status: "failed" } };
    const transport = await mount();
    expect(transport.calls.filter((c) => c.tool === "driver_route").every((c) => c.args.snap === true)).toBe(true);
    expect(screen.getByTestId("snap-legend").textContent).toContain("Raw GPS (snapping to roads failed)");
    const box = screen.getByLabelText("Recorded points") as HTMLInputElement;
    expect(box.checked).toBe(false);
    route = { ...base, snapped: { provider: "google_roads", status: "off" } };
    fireEvent.click(box);
    await act(async () => { await Promise.resolve(); });
    expect(transport.calls.some((c) => c.tool === "driver_route" && c.args.snap === false)).toBe(true);
    expect((screen.getByLabelText("Recorded points") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId("snap-legend").textContent).toContain("Recorded points: the raw GPS line");
  });
  it("no snapping provider: no toggle", async () => {
    route = { ...base, snapped: { provider: "none", status: "off" } };
    await mount();
    expect(screen.queryByLabelText("Recorded points")).toBeNull();
  });
});

describe("playback on the driver page (§22)", () => {
  it("1×, 5×, 20×, 60×; the clock runs in recorded time on animation frames; the scrubber goes to any moment", async () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    await mount();
    const chips = screen.getByTestId("playback").querySelectorAll(".chip");
    expect([...chips].map((c) => c.textContent)).toEqual(["1×", "5×", "20×", "60×"]);
    expect(screen.getByTestId("playback-clock").textContent).toBe("08:01:00");
    expect(screen.getByTestId("map").dataset.cursor).toBe(""); // no marker before playing
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    const slider = screen.getByLabelText("Time") as HTMLInputElement;
    const moved = Number(slider.value) - Date.parse(iso("08:01"));
    expect(moved).toBeGreaterThan(55000); // about a minute of the day in a second at 60×
    expect(moved).toBeLessThanOrEqual(61000);
    expect(screen.getByTestId("map").dataset.cursor).toMatch(/^08:0[12]:\d\d$/);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    // The scrubber: to any moment; at a stop the marker is real and still.
    fireEvent.change(slider, { target: { value: String(Date.parse(iso("12:00"))) } });
    expect(screen.getByTestId("playback-clock").textContent).toBe("12:00:00");
    expect(seen.props?.route?.cursor).toMatchObject({ lat: 6.96, lng: 79.89, estimated: false, label: "12:00:00" });
  });
  it("across a gap the marker is estimated (hollow) and the clock says so", async () => {
    route = {
      ...base,
      route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["08:01", 6.88, 79.86, 0, iso("08:01")], ["09:55", 6.96, 79.89, 38, iso("09:55")], ["14:00", 6.96, 79.89, 0, iso("14:00")], ["14:56", 6.93, 79.86, 0, iso("14:56")]] },
      holes: [{ from_at: iso("14:00"), to_at: iso("14:56"), minutes: 56, kind: "no_data", text: "App not running · 56 min" }],
    };
    await mount();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: String(Date.parse(iso("14:28"))) } });
    expect(screen.getByTestId("playback-clock").textContent).toBe("14:28:00 · estimated");
    const c = seen.props?.route?.cursor;
    expect(c).toMatchObject({ estimated: true, label: "14:28:00 · estimated" });
    // Halfway through the gap, halfway along its dashed line.
    expect(c?.lat).toBeCloseTo(6.945, 6);
    expect(c?.lng).toBeCloseTo(79.875, 6);
    expect(c?.heading).not.toBeNull();
  });
});

describe("Part 6: no Roads call for a line the free map draws", () => {
  it("Google's map refused (the cap): every route request is unsnapped, the raw line drawn", async () => {
    class GoogleRefused extends FakeTransport {
      override me(): Promise<Me> {
        return super.me().then((m) => ({ ...m, tools: [...m.tools, "register_map_load"], map: { package: "google" as const, places: true } }));
      }
      override answer(tool: string, args: Record<string, unknown>): unknown {
        if (tool === "register_map_load") return { allowed: false, note: "Google map limit reached for today: back tomorrow" };
        return super.answer(tool, args);
      }
    }
    const transport = new GoogleRefused();
    const store = new FleetStore(transport);
    const me = await transport.me();
    render(
      <FleetProvider value={{ store, transport, me, noConnector: false }}>
        <MemoryRouter initialEntries={["/drivers/nuwan.p"]}><Routes><Route path="/drivers/:username" element={<DriverPage />} /></Routes></MemoryRouter>
      </FleetProvider>,
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const routes = transport.calls.filter((c) => c.tool === "driver_route");
    expect(transport.calls.some((c) => c.tool === "register_map_load")).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((c) => c.args.snap === false)).toBe(true);
  });
});

