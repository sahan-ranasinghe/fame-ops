import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TaskDetail } from "./TaskDetail";

class Detail implements Transport {
  readonly kind = "api" as const;
  constructor(private answer: TaskDetailData, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  call<T>(): Promise<T> {
    return Promise.resolve(this.answer as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "update_task", "reassign_task", "cancel_task"] };
const approver: Me = { name: "Boss", role: "office", permissions: ["view", "approve"], tools: ["task_detail"] };

const base: TaskDetailData = {
  task: { id: "t1", title: "Team drop · Kurunegala", status: "declined", start: "Fri 16 Oct 09:00", driver: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce" },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};

async function mount(answer: TaskDetailData, who: Me) {
  const transport = new Detail(answer, who);
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: who, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/tasks/t1"]}><Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes></MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await screen.findByTestId("task-detail");
}

describe("the task page (Part 2)", () => {
  it("needs a driver at the top with Find a driver, the vehicle chosen and the warnings saved past", async () => {
    await mount({
      ...base,
      task: {
        ...base.task,
        declined: { at: "08:40", reason: "vehicle_problem", reason_text: "Vehicle problem" },
        needs_driver: { since: "Fri 16 Oct 08:40", reason: "declined", reason_text: "Vehicle problem" },
        vehicle_changed: "Vehicle changed by Palitha: WP CAB-4521 instead of Kamal's regular vehicle WP KL-1234",
        warnings_saved: ["Leaving 08:00 you reach Kurunegala site at 09:36 (saved by Palitha)"],
      },
      stops: [
        { seq: 1, n: 1, label: "Stop 1 · Pickup · Head office", type: "pickup", what: "people", place: "Head office", status: "pending", is_start: true, planned_stay: { arrive: "07:24", leave: "07:29", minutes: 5 } },
        { seq: 2, n: 2, label: "Stop 2 · Drop · Kurunegala site", type: "drop", place: "Kurunegala site", status: "pending", dwell_source: "place", planned_stay: { arrive: "09:00", leave: "10:30", minutes: 90 } },
      ],
    }, dispatcher);
    expect(screen.getByTestId("needs-driver-line").textContent).toBe("Needs a driver since Fri 16 Oct 08:40 · Kamal declined: Vehicle problem");
    expect(screen.getByRole("link", { name: "Find a driver" }).getAttribute("href")).toBe("/tasks/t1/edit?driver=1");
    expect(screen.queryByRole("link", { name: "Give it to another driver" })).toBeNull();
    expect(screen.getByTestId("vehicle-changed").textContent).toContain("instead of Kamal's regular vehicle");
    expect(screen.getByTestId("warnings-saved").textContent).toContain("Saved past these warnings:");
    expect(screen.getByTestId("warnings-saved").textContent).toContain("(saved by Palitha)");
    const stops = screen.getAllByTestId("task-stop");
    expect(stops[0].textContent).toContain("Stop 1 · Pickup · Head office");
    expect(stops[0].textContent).toContain("Start · passengers get in here");
    expect(stops[0].textContent).toContain("People");
    expect(stops[1].textContent).toContain("Stop 2 · Drop · Kurunegala site");
    expect(stops[1].textContent).toContain("planned 09:00–10:30 (1 h 30 min)");
    expect(stops[1].textContent).toContain("usual here");
  });

  it("no Find a driver for an approver (the change page needs assign_tasks)", async () => {
    await mount({ ...base, task: { ...base.task, needs_driver: { since: "Fri 16 Oct 08:40", reason: "not_accepted", reason_text: "Not accepted in time" } } }, approver);
    expect(screen.getByTestId("needs-driver-line").textContent).toBe("Needs a driver since Fri 16 Oct 08:40 · Kamal hasn't accepted in time");
    expect(screen.queryByRole("link", { name: "Find a driver" })).toBeNull();
  });

  it("the vehicle swap: one row per stretch and the total next to the task km", async () => {
    await mount({
      ...base,
      task: { ...base.task, status: "completed", vehicle: "WP KL-1234 · Toyota Axio", km: 83, start_odometer_km: 45210, end_odometer_km: 80131 },
      segments: [
        { vehicle: "WP CAB-4521", from: "08:10", to: "10:42", start_km: 45210, end_km: 45262, km: 52, reason: "Breakdown near Kurunegala", by: "Palitha" },
        { vehicle: "WP KL-1234", from: "10:42", to: "12:30", start_km: 80100, readings_waiting: true },
      ],
    }, approver);
    const rows = screen.getAllByTestId("segment");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("08:10–10:42");
    expect(rows[0].textContent).toContain("45,210 km → 45,262 km");
    expect(rows[0].textContent).toContain("52 km");
    expect(rows[0].textContent).toContain("Breakdown near Kurunegala · by Palitha");
    expect(rows[1].textContent).toContain("Reading to come from the driver");
    expect(screen.getByTestId("segments-total").textContent).toBe("52 km so far · a reading is still to come from the driver");
    expect(screen.getByText("Swapped during the task: WP CAB-4521 → WP KL-1234")).toBeTruthy();
  });
});
