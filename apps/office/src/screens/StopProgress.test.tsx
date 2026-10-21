import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Stop, TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { StopProgress } from "./StopProgress";
import { TaskDetail } from "./TaskDetail";

const stops: Stop[] = [
  {
    seq: 1, n: 1, label: "Stop 1 · Pickup · Head office", type: "pickup", place: "Head office", status: "done", arrived: "10:52", done: "11:40",
    progress: { planned_arrive: "10:30", planned_leave: "11:00", arrived: "10:52", left: "11:40", arrive_delta_min: 22, leave_delta_min: 40 },
  },
  {
    seq: 2, n: 2, label: "Stop 2 · Drop · Kurunegala site", type: "drop", place: "Kurunegala site", status: "arrived", arrived: "12:22",
    progress: { planned_arrive: "12:30", planned_leave: "13:00", arrived: "12:22", arrive_delta_min: -8, current: true },
  },
  {
    seq: 3, n: 3, label: "Stop 3 · Visit · Kandy depot", type: "visit", place: "Kandy depot", status: "pending",
    progress: { planned_arrive: "14:00", planned_leave: "14:15", estimate: { arrive: "14:10", leave: "14:25", updated: "12:22" } },
  },
  {
    seq: 4, n: 4, label: "Stop 4 · Drop · Matale", type: "drop", place: "Matale", status: "skipped", skip_reason: "nobody_there",
    // A skip time as an older server sent it: never shown as "Left" (Checkpoint 2 review).
    progress: { planned_arrive: "15:00", planned_leave: "15:10", left: "14:40", leave_delta_min: -30 },
  },
];

describe("the stop progress timeline (Round 2)", () => {
  it("shows planned against what happened, the deltas in words and colours, the estimate and the current stop", () => {
    render(<StopProgress stops={stops} />);
    const rows = screen.getAllByTestId("task-stop");
    expect(rows[0].textContent).toContain("Planned 10:30–11:00 · Arrived 10:52 · Left 11:40");
    const late = rows[0].querySelector("[data-testid=stop-delta]")!;
    expect(late.textContent).toBe("22 min late");
    expect(late.className).toContain("late");

    const early = rows[1].querySelector("[data-testid=stop-delta]")!;
    expect(early.textContent).toBe("8 min early");
    expect(early.className).toContain("ok");
    expect(rows[1].getAttribute("aria-current")).toBe("step");
    expect(rows[1].textContent).toContain("Here now");
    expect(rows[0].getAttribute("aria-current")).toBeNull();

    expect(rows[2].querySelector("[data-testid=stop-estimate]")!.textContent).toBe("about 14:10 (updated 12:22)");
    expect(rows[2].querySelector("[data-testid=stop-delta]")).toBeNull();

    // The reason in words, never the code.
    expect(rows[3].querySelector("[data-testid=stop-skipped]")!.textContent).toBe("Skipped · Nobody there");
    // Checkpoint 2 review: a skipped stop has no times or difference of its own, even if the answer carried a skip time.
    expect(rows[3].querySelector("[data-testid=stop-times]")).toBeNull();
  });

  it("says On time within 2 minutes (green) and Next for a stop still to reach", () => {
    render(<StopProgress stops={[{ seq: 1, type: "drop", place: "Site", status: "pending", progress: { planned_arrive: "09:00", arrived: "09:02", arrive_delta_min: 2, current: true } }]} />);
    const d = screen.getByTestId("stop-delta");
    expect(d.textContent).toBe("On time");
    expect(d.className).toContain("ok");
    expect(screen.getByTestId("task-stop").textContent).toContain("Next");
  });

  it("an answer without progress keeps the planned and actual stay line", () => {
    render(<StopProgress stops={[{ seq: 1, type: "drop", place: "Site", status: "pending", planned_stay: { arrive: "09:00", leave: "10:30", minutes: 90 } }]} />);
    expect(screen.getByTestId("stop-stay").textContent).toContain("planned 09:00–10:30");
    expect(screen.queryByTestId("stop-times")).toBeNull();
  });
});

// The task page live: a change on the task's stops (Realtime) asks task_detail again once, about a second later.
class Detail implements Transport {
  readonly kind = "api" as const;
  calls = 0;
  constructor(private answers: TaskDetailData[], private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  call<T>(): Promise<T> {
    const a = this.answers[Math.min(this.calls, this.answers.length - 1)];
    this.calls++;
    return Promise.resolve(a as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const who: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail"] };
const ID = "11111111-2222-3333-4444-555555555555";
const before: TaskDetailData = {
  task: { id: ID, title: "Team drop", status: "in_progress", start: "Wed 21 Oct 10:00", driver: "Kamal Silva", vehicle: "WP CAB-4521" },
  stops: [{ seq: 1, type: "drop", place: "Kurunegala site", status: "pending", progress: { planned_arrive: "10:30", current: true } }],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};
const after: TaskDetailData = {
  ...before,
  stops: [{ seq: 1, type: "drop", place: "Kurunegala site", status: "arrived", arrived: "10:52", progress: { planned_arrive: "10:30", arrived: "10:52", arrive_delta_min: 22, current: true } }],
};

describe("the task page live (Round 2)", () => {
  it("one burst of Realtime changes refetches task_detail once and the page updates in place", async () => {
    const transport = new Detail([before, after], who);
    let fire: () => void = () => {};
    const stop = vi.fn();
    const taskProgress = vi.fn((_id: string, cb: () => void) => {
      fire = cb;
      return stop;
    });
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me: who, noConnector: false, realtime: { driverLatest: () => () => {}, taskProgress } }}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/tasks/${ID}`]}><Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes></MemoryRouter>
        </ToastProvider>
      </FleetProvider>,
    );
    const page = await screen.findByTestId("task-detail");
    expect(taskProgress).toHaveBeenCalledWith(ID, expect.any(Function));
    const first = transport.calls;
    vi.useFakeTimers();
    try {
      act(() => {
        fire();
        fire();
        fire();
      });
      expect(transport.calls).toBe(first);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(screen.getByTestId("stop-delta").textContent).toBe("22 min late"));
    expect(transport.calls).toBe(first + 1);
    // The same page element: updated in place, not loaded again.
    expect(screen.getByTestId("task-detail")).toBe(page);
    expect(screen.getByTestId("stop-times").textContent).toContain("Arrived 10:52");
  });
});

describe("a stop confirmed later (Round 2b: driven past without Arrived)", () => {
  it("with no location points: Visited · time not recorded, no difference, marked Confirmed later", () => {
    render(<StopProgress stops={[{
      seq: 1, n: 1, label: "Stop 1 · Drop · Wariyapola", type: "drop", place: "Wariyapola", status: "done",
      progress: { planned_arrive: "10:30", planned_leave: "10:40", confirmed_later: true, time_not_recorded: true },
    }]} />);
    expect(screen.getByTestId("stop-times").textContent).toBe("Planned 10:30–10:40 · Visited · time not recorded");
    expect(screen.queryByTestId("stop-delta")).toBeNull();
    expect(screen.getByTestId("stop-confirmed-later").textContent).toBe("Confirmed later");
  });

  it("with the points' times: Arrived and Left with the difference, marked Confirmed later", () => {
    render(<StopProgress stops={[{
      seq: 1, n: 1, label: "Stop 1 · Drop · Wariyapola", type: "drop", place: "Wariyapola", status: "done", arrived: "10:38", done: "10:41",
      progress: { planned_arrive: "10:30", planned_leave: "10:40", arrived: "10:38", left: "10:41", arrive_delta_min: 8, leave_delta_min: 1, confirmed_later: true },
    }]} />);
    expect(screen.getByTestId("stop-times").textContent).toContain("Arrived 10:38 · Left 10:41");
    expect(screen.getByTestId("stop-delta").textContent).toBe("8 min late");
    expect(screen.getByTestId("stop-confirmed-later")).toBeTruthy();
  });
});
