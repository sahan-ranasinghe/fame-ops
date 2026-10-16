// The task page's maps (Phase 7, §20, §21, §26): the plan map from task_detail asked with its lines, and the task's
// route snapped by default with its Gaps list under the map.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { DriverRoute, TaskDetail as TaskDetailData } from "../data/types";
import type { MapProps } from "../map/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TaskDetail } from "./TaskDetail";

const maps: MapProps[] = [];
vi.mock("../map/MapView", () => ({
  MapView: (p: MapProps) => {
    maps.push(p);
    return <div data-testid={p.plan ? "plan-map-view" : "route-map-view"} data-open={p.openGap ?? ""} />;
  },
}));
const last = (id: "plan" | "route") => [...maps].reverse().find((p) => (id === "plan" ? !!p.plan : !p.plan));

const day = "2026-10-16";
const iso = (hhmm: string) => `${day}T${hhmm}:00+05:30`;
const detail: TaskDetailData = {
  task: { id: "t1", title: "Team drop · Kurunegala", status: "in_progress", start: "Thu 16 Oct 07:24", started: "2026-10-16 07:30", driver: "Kamal Silva", start_place: "Head office", start_lat: 6.9271, start_lng: 79.8612 },
  plan: { source: "google", total_drive_min: 96, total_km: 94, legs: [], warnings: [] },
  timeline: {
    items: [
      { kind: "leave", at: "07:24", source: "plan" },
      { kind: "leg", from_n: "start", to_n: 1, km: 94, minutes: 96, source: "google" },
      { kind: "stop", n: 1, label: "Stop 1 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", arrive_by: "08:50", late_min: 10, dwell_min: 90 },
    ],
    totals: { drive_min: 96, km: 94, ends: "10:30" },
  },
  stops: [{ seq: 1, n: 1, label: "Stop 1 · Drop · Kurunegala site", type: "drop", place: "Kurunegala site", status: "pending", lat: 7.4863, lng: 80.3623 }],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};
const route: DriverRoute = {
  driver: "Kamal Silva", date: day, recorded_points: 3, km: 60,
  route: { columns: ["time", "lat", "lng", "km/h", "at"], points: [["07:30", 6.93, 79.86, 0, iso("07:30")], ["08:00", 7.1, 80.0, 40, iso("08:00")], ["08:30", 7.3, 80.2, 40, iso("08:30")]] },
  holes: [{ from_at: iso("08:00"), to_at: iso("08:30"), minutes: 30, kind: "no_data", text: "App not running · 30 min" }],
  snapped: { provider: "google_roads", status: "ok" },
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "driver_route"] });
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve((tool === "driver_route" ? route : detail) as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

afterEach(() => { maps.length = 0; });

describe("the task page's maps", () => {
  it("asks task_detail with the lines and puts the plan on the map beside its timeline; asks the route snapped, with its gaps", async () => {
    const transport = new FakeTransport();
    const me = await transport.me();
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/tasks/t1"]}><Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes></MemoryRouter>
        </ToastProvider>
      </FleetProvider>,
    );
    await screen.findByTestId("task-detail");
    await act(async () => { await Promise.resolve(); });
    expect(transport.calls.find((c) => c.tool === "task_detail")?.args).toEqual({ task_id: "t1", with_line: true });
    expect(last("plan")?.plan?.pins.map((p) => [p.n, p.label, !!p.late])).toEqual([
      ["S", "S · Head office · leave 07:24", false],
      [1, "1 · Kurunegala site · 09:00–10:30", true],
    ]);
    expect(screen.getByTestId("plan-with-map")).toBeTruthy();
    expect(transport.calls.find((c) => c.tool === "driver_route")?.args).toMatchObject({ task_id: "t1", snap: true, estimate_gaps: true });
    const row = screen.getByTestId("gap-row");
    expect(row.textContent).toBe("08:00–08:30App not running30 min");
    fireEvent.click(row);
    expect(screen.getByTestId("route-map-view").dataset.open).toBe(last("route")?.gaps?.[0].id);
    expect(screen.getByLabelText("Recorded points")).toBeTruthy();
  });
});
