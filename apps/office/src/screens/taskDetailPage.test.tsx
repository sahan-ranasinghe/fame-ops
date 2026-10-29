import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TaskDetail } from "./TaskDetail";
import { locationWords } from "./taskDetailLogic";

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

describe("the task page (Round 3: who drives, a missed task)", () => {
  it("someone else drives: their name in the driver card with \"Someone else\", no photo, Call on their own number", async () => {
    await mount({
      ...base,
      task: {
        ...base.task, status: "assigned", driven_by: "other", driver: "Nimal Silva", driver_photo_url: undefined, status_line: "Someone else drives · no app",
        driver_phone: { phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" },
      },
    }, dispatcher);
    const card = screen.getByTestId("driver-line");
    expect(card.textContent).toContain("Nimal Silva");
    expect(card.querySelector("[data-testid=driven-by]")?.textContent).toBe("Someone else");
    expect(card.querySelector("[data-testid=vehicle-chip]")?.textContent).toBe("WP CAB-4521");
    expect(card.querySelector("img")).toBeNull();
    expect(screen.getByText("Who drives")).toBeTruthy();
    // Round 4–7 (Sahan's OK, 22 October 2026): no Status row repeating it; the card's "Someone else" says it.
    expect(screen.queryByText("Someone else drives · no app")).toBeNull();
    expect(screen.getByTestId("call-driver").textContent).toContain("077 123 4567");
  });

  it("drives themselves: the small word in the duty state's place", async () => {
    await mount({ ...base, task: { ...base.task, status: "assigned", driven_by: "self", driver: "Sahan Ranasinghe", status_line: "Drives themselves · no app" } }, dispatcher);
    expect(screen.getByTestId("driver-line").querySelector("[data-testid=driven-by]")?.textContent).toBe("Drives themselves");
  });

  it("Round 50: a self trip driven with the app or on the web says Self-drive, not Drives themselves", async () => {
    await mount({ ...base, task: { ...base.task, status: "in_progress", driven_by: "self", self_drive: true, driven_in: "web", driver: "Sahan Ranasinghe", status_line: "Drives themselves · no app" } }, dispatcher);
    expect(screen.getByTestId("driver-line").querySelector("[data-testid=driven-by]")?.textContent).toBe("Self-drive");
  });

  it("a missed task: the pill in red; its leave-by in its own row (the Status row that repeated the pill is gone)", async () => {
    await mount({ ...base, task: { ...base.task, status: "missed", status_line: "Missed · not started (leave by 08:00)", leave_by: "2026-10-16 08:00", leave_by_source: "plan" } }, approver);
    const pill = screen.getByText("Missed");
    expect(pill.className).toContain("bad");
    expect(screen.queryByText("Missed · not started (leave by 08:00)")).toBeNull();
    expect(screen.getByText("Leave by").nextElementSibling?.textContent).toBe("08:00 (planned)");
  });
});

// Round 4–7 (approved by Sahan 22 October 2026): the Status row repeated the top's pill and banner, so it is gone in every
// state; the one thing only it said, a running task's location when it is not live, is on the "On the way" banner.
describe("the task page without its Status row", () => {
  const states: [string, Partial<TaskDetailData["task"]>][] = [
    ["assigned", { status: "assigned", status_line: "Accepted 08:12", accepted: "2026-10-16 08:12" }],
    ["in_progress", { status: "in_progress", status_line: "Started 08:20 · sharing location", started: "2026-10-16 08:20" }],
    ["completed", { status: "completed", status_line: "Done 11:05 · 52 km logged", started: "2026-10-16 08:20", completed: "2026-10-16 11:05", km: 52 }],
    ["cancelled", { status: "cancelled", status_line: "Cancelled: Client postponed", cancelled_reason: "Client postponed" }],
  ];
  it.each(states)("%s: no Status row; the facts it repeated are in their own rows", async (_name, over) => {
    await mount({ ...base, task: { ...base.task, ...over } }, dispatcher);
    const facts = [...screen.getByTestId("task-detail").querySelectorAll("dt")].map((d) => d.textContent);
    expect(facts).not.toContain("Status");
    expect(screen.queryByText(over.status_line!)).toBeNull();
    if (over.accepted) expect(screen.getByText("Accepted").nextElementSibling?.textContent).toContain("08:12");
    if (over.completed) expect(screen.getByText("Started · done").nextElementSibling?.textContent).toBe("08:20 · 11:05");
    if (over.cancelled_reason) expect(screen.getByText("Cancelled because").nextElementSibling?.textContent).toBe("Client postponed");
  });

  it("a running task whose location is not live says so on the banner; shared live, nothing more", async () => {
    await mount({ ...base, task: { ...base.task, status: "in_progress", status_line: "Started 08:20 · not sharing location", eta: { next_stop: "Kurunegala site", next: "09:40", final: "11:00", as_of: "09:00" } } }, dispatcher);
    expect(screen.getByTestId("task-banner-line").textContent).toBe("Arrives about 09:40 · back about 11:00 · not sharing location");
  });

  it("the location words: only a running task's, only when not live", () => {
    expect(locationWords({ status: "in_progress", status_line: "Started 08:20 · location 12 min old" })).toBe("location 12 min old");
    expect(locationWords({ status: "in_progress", status_line: "Started 08:20 · not sharing location" })).toBe("not sharing location");
    expect(locationWords({ status: "in_progress", status_line: "Started 08:20 · sharing location" })).toBeNull();
    expect(locationWords({ status: "in_progress", status_line: "Started ? · sharing location" })).toBeNull();
    expect(locationWords({ status: "in_progress" })).toBeNull();
    expect(locationWords({ status: "assigned", status_line: "Accepted 08:12" })).toBeNull();
  });
});
