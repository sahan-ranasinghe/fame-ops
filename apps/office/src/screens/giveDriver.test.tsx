// Hotfix 4 (b): Give it a driver (/tasks/:id/edit?driver=1) is one page: the task on top (the time, the stops with their
// arrive-by, who asked, the notes), Who can take it below, "Give to <driver> · <plate>"; Open task → and Change the time or
// the trip → go forward; back returns to wherever the person came from, and so does giving it (opened from a push, the task
// page takes its place).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Availability, AvailableDriver, TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TaskEdit } from "./TaskEdit";

type Args = Record<string, unknown>;

class Fake implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "task_detail") return Promise.resolve(structuredClone(detail) as T);
    if (tool === "availability") return Promise.resolve(structuredClone(available) as T);
    if (tool === "update_task") return Promise.resolve({ task_id: "t1", driver: "Kamal Perera", warnings: [] } as T);
    return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() })).catch(() => undefined);
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "update_task", "cancel_task", "availability"] };

const detail: TaskDetailData = {
  task: {
    id: "t1", title: "Trip · SLTC Research University", status: "declined", start: "Wed 21 Oct 09:00", date: "2026-10-21", time: "09:00",
    leave_by: "Wed 21 Oct 09:00", driver: "Nimal Silva", vehicle: "WP KV-7788 · Toyota HiAce", passengers: 2, plan_version: 3,
    notes: "Bring the site keys", start_place: "Head office, Kelaniya",
    declined: { at: "08:14", reason: "not_available", reason_text: "Not available" },
    needs_driver: { since: "Wed 21 Oct 08:14", reason: "declined", reason_text: "Not available" },
  },
  stops: [
    { seq: 1, n: 1, label: "Stop 1 · Visit · SLTC Research University", type: "visit", place: "SLTC Research University", status: "pending", arrive_by: "10:00", dwell_min: 120 },
  ],
  from_request: { id: "r1", requested_by: "Sahan", asked: "Sun 18 Oct 16:40" },
  projects: "Fame internal",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};

const kamal: AvailableDriver = {
  name: "Kamal Perera", username: "kamal.p", state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0,
  licence: { chip: "ok" }, free: true, vehicle: { reg_no: "WP CAB-4521", source: "on_duty" },
};

const available: Availability = {
  as_of: "21 Oct 08:20",
  window: { from: "Wed 21 Oct 09:00", until: "end of the day", day: "2026-10-21" },
  drivers: [kamal],
  counts: { free: 1, on_duty: 1, all: 1 },
  vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

async function mount(entries: string[]) {
  const t = new Fake();
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: dispatcher, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Routes>
            <Route path="/tasks/:id/edit" element={<TaskEdit />} />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  await settle(400);
  await settle();
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T08:18:00+05:30"));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Give it a driver (Hotfix 4 b)", () => {
  it("one page: the task on top, Who can take it below, forward links that say so; a row picks; Give sends it and goes back where it came from", async () => {
    const t = await mount(["/", "/tasks/t1/edit?driver=1"]);
    expect(screen.getByTestId("give-driver")).toBeTruthy();
    expect(screen.getByText(/Needs a driver · leaves in 42 min/)).toBeTruthy();
    expect(screen.getByTestId("needs-driver-reason").textContent).toContain("declined");
    const summary = screen.getByTestId("task-summary");
    expect(summary.textContent).toContain("Leave by 09:00");
    expect(summary.textContent).toContain("Head office, Kelaniya");
    expect(within(summary).getByTestId("summary-stop").textContent).toContain("arrive by 10:00 · 2 h there");
    expect(within(summary).getByTestId("summary-asker").textContent).toContain("Asked by Sahan · Sun 18 Oct 16:40");
    expect(within(summary).getByTestId("summary-notes").textContent).toBe("Notes: Bring the site keys");
    expect(screen.getByTestId("open-task").textContent).toBe("Open task →");
    expect(screen.getByTestId("open-task").getAttribute("href")).toBe("/tasks/t1");
    expect(screen.getByTestId("change-trip").getAttribute("href")).toBe("/tasks/t1/edit");
    // The change page's fields (title, passengers, notes) are not on this page.
    expect(screen.queryByLabelText("Title")).toBeNull();

    const give = screen.getByTestId("give-to") as HTMLButtonElement;
    expect(give.disabled).toBe(true);
    expect(give.textContent).toBe("Pick a driver above");
    fireEvent.click(screen.getByTestId("avail-row"));
    expect(give.disabled).toBe(false);
    expect(give.textContent).toBe("Give to Kamal · WP CAB-4521");
    fireEvent.click(give);
    await settle();
    expect(t.calls.find((c) => c.tool === "update_task")?.args).toMatchObject({ task_id: "t1", plan_version: 3, driver: "kamal.p" });
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("opened from a push: after Give the task page takes its place", async () => {
    await mount(["/tasks/t1/edit?driver=1"]);
    fireEvent.click(screen.getByTestId("avail-row"));
    fireEvent.click(screen.getByTestId("give-to"));
    await settle();
    expect(screen.getByTestId("where").textContent).toBe("/tasks/t1");
  });

  it("back from the Overview returns to the Overview, never forward to the task", async () => {
    await mount(["/", "/tasks/t1/edit?driver=1"]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("opened from a push (the first page): back goes to the Overview", async () => {
    await mount(["/tasks/t1/edit?driver=1"]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });
});
