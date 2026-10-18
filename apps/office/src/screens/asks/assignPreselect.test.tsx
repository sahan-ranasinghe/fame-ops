// Part 3b (H3, H4) on the dispatch pages: Assign on a driver's Yes opens New task (?driver=&date=&time=), the task's
// change page (?driver=) or the request's decide page (?driver=) with the driver (and the day and time) filled in; a
// saved draft is still offered and wins when resumed; TaskEdit's own ?driver=1 picks nobody. And the driver's "Running
// late" as an amber line on the task page and the board's card.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../../app/FleetContext";
import { draftKey, writeDraft } from "../../data/drafts";
import { FleetStore } from "../../data/store";
import type { Board, RequestCard, TaskDetail as TaskDetailData } from "../../data/types";
import { today } from "../../lib/format";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import { emptyAssign } from "../assignLogic";
import { NewTask } from "../NewTask";
import { RequestDecide } from "../RequestDecide";
import { TaskDetail } from "../TaskDetail";
import { TaskEdit } from "../TaskEdit";
import { Tasks } from "../Tasks";

vi.mock("../../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Answer = (args: Record<string, unknown>) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = {
  name: "Palitha", role: "fleet_admin", permissions: ["view", "approve", "assign_tasks"],
  tools: ["get_settings", "list_drivers", "list_vehicles", "list_places", "create_task", "task_detail", "update_task", "cancel_task", "task_board",
    "list_requests", "suggest_vehicles", "decide_request"],
};

const DRIVERS = [
  { name: "Kamal Perera", username: "kamal", current_vehicle: "WP CAB-4521", active: true },
  { name: "Nuwan Silva", username: "nuwan", active: true },
];
const DAY = "2026-10-20";
const LATE = { min: 15, said: "08:52", text: "Running late 15 min · said 08:52" };
const TASK: TaskDetailData = {
  task: { id: "t1", title: "Team drop · Kurunegala", status: "assigned", start: "Tue 20 Oct 09:00", date: DAY, time: "09:00", driver: "Kamal Perera", vehicle: "WP CAB-4521 · Toyota HiAce", plan_version: 3 },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};
const CLASSIC: RequestCard = {
  id: "r5", kind: "request", requested_by: "Dilini Jayasinghe", when: "Tue 20 Oct 09:00", route: "Head office → Kandy", status: "waiting", version: 1,
  fields: { date: DAY, time: "09:00", route_from: "Head office", route_to: "Kandy", pax: 3 },
};
const PROPOSAL: RequestCard = {
  id: "r9", kind: "task", title: "Team drop · Kandy", requested_by: "Nimal Fernando", when: "Tue 20 Oct 08:00", status: "waiting", version: 1, stops_count: 1,
  proposed: { driver: "Kamal Perera", username: "kamal", vehicle: "WP CAB-4521", passengers: 4 },
  fields: { date: DAY, time: "08:00" },
  trip: { leave_by: "08:00", stops: [{ seq: 1, n: 1, type: "drop", place: "Kandy site", status: "pending" }] },
};

function transport(over: Record<string, Answer> = {}) {
  return new FakeTransport({
    get_settings: () => ({ settings: { dwell_min: {} }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    list_drivers: () => ({ drivers: DRIVERS }),
    list_vehicles: () => ({ vehicles: [{ reg_no: "WP CAB-4521" }, { reg_no: "WP KL-1234" }] }),
    list_places: () => ({ places: [] }),
    task_detail: () => TASK,
    suggest_vehicles: () => ({ vehicles: [], drivers: [] }),
    ...over,
  }, dispatcher);
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

async function mount(t: FakeTransport, url: string, routes: React.ReactNode) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: dispatcher, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}><Routes>{routes}</Routes></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
  await settle();
  await settle();
}

const driverField = () => screen.getByLabelText("Driver") as HTMLSelectElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T09:00:00+05:30"));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Assign on a Yes fills the driver in", () => {
  const newTask = <Route path="/tasks/new" element={<NewTask />} />;

  // The first test pays for importing the dispatch pages (slow while the full suite runs): 20 s.
  it("New task: the driver, the trip's day and its time as the leave-by", async () => {
    await mount(transport(), `/tasks/new?driver=nuwan&date=${DAY}&time=09%3A30`, newTask);
    expect(driverField().value).toBe("nuwan");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe(DAY);
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("09:30");
  }, 20_000);

  it("New task with a saved draft: the link fills the fresh form, the draft is offered and wins when resumed", async () => {
    writeDraft(draftKey("artifact", "task-new", null), { f: { ...emptyAssign(DAY), title: "Drop at Galle", driver: "kamal", leaveBy: "07:00" }, rows: [] });
    await mount(transport(), `/tasks/new?driver=nuwan&date=${DAY}&time=09%3A30`, newTask);
    expect(driverField().value).toBe("nuwan");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await settle();
    expect(driverField().value).toBe("kamal");
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("07:00");
  });

  it("New task without a link: nobody picked, no leave-by", async () => {
    await mount(transport(), "/tasks/new", newTask);
    expect(driverField().value).toBe("");
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("");
  });

  it("the task's change page: the linked driver once the task loads; ?driver=1 (needs a driver) picks nobody", async () => {
    const edit = <Route path="/tasks/:id/edit" element={<TaskEdit />} />;
    await mount(transport(), "/tasks/t1/edit?driver=nuwan", edit);
    expect(driverField().value).toBe("nuwan");
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("09:00");
  });

  it("?driver=1 is Give it a driver, never a driver called \"1\" (Hotfix 4: a task that has its driver says so)", async () => {
    await mount(transport({ task_detail: () => ({ ...TASK, task: { ...TASK.task, status: "declined", needs_driver: { since: "08:14", reason: "declined" } } }) }),
      "/tasks/t1/edit?driver=1", <Route path="/tasks/:id/edit" element={<TaskEdit />} />);
    expect(screen.getByTestId("give-driver")).toBeTruthy();
    expect(driverField().value).toBe("");
  });

  it("?driver=1 for a task that has its driver again: the page says so", async () => {
    await mount(transport(), "/tasks/t1/edit?driver=1", <Route path="/tasks/:id/edit" element={<TaskEdit />} />);
    expect(screen.getByTestId("give-driver-done").textContent).toContain("Nothing to do here");
  });

  it("a task already under way takes only the words: the linked driver is never sent with them", async () => {
    const t = transport({
      task_detail: () => ({ ...TASK, task: { ...TASK.task, status: "in_progress" } }),
      update_task: () => ({ task_id: "t1", plan_version: 4, changed: ["notes"] }),
    });
    await mount(t, "/tasks/t1/edit?driver=nuwan", <><Route path="/tasks/:id/edit" element={<TaskEdit />} /><Route path="/tasks/:id" element={<p>The task</p>} /></>);
    expect(screen.queryByLabelText("Driver")).toBeNull();
    fireEvent.change(screen.getByLabelText("Notes for the driver"), { target: { value: "Gate 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(t.calls.filter((c) => c.tool === "update_task").map((c) => c.args)).toEqual([{ task_id: "t1", plan_version: 3, notes: "Gate 2" }]);
  });

  it("the request's decide page (a request with From and To): the linked driver instead of the first free one", async () => {
    await mount(transport({ list_requests: () => ({ status: "all", count: 1, requests: [CLASSIC] }) }), "/requests/r5/decide?driver=nuwan",
      <Route path="/requests/:id/decide" element={<RequestDecide />} />);
    expect(screen.getByTestId("decide-pick")).toBeTruthy();
    expect(driverField().value).toBe("nuwan");
  });

  it("a proposed task's decide page: the linked driver instead of the proposed one", async () => {
    await mount(transport({ list_requests: () => ({ status: "all", count: 1, requests: [PROPOSAL] }) }), "/requests/r9/decide?driver=nuwan",
      <Route path="/requests/:id/decide" element={<RequestDecide />} />);
    expect(screen.getByTestId("request-decide-trip")).toBeTruthy();
    expect(driverField().value).toBe("nuwan");
  });
});

describe("Running late (H4)", () => {
  it("the task page: an amber line with the driver's words", async () => {
    await mount(transport({ task_detail: () => ({ ...TASK, task: { ...TASK.task, status: "in_progress", late_report: LATE } }) }), "/tasks/t1",
      <Route path="/tasks/:id" element={<TaskDetail />} />);
    const line = screen.getByTestId("late-report");
    expect(line.textContent).toBe("Running late 15 min · said 08:52");
    expect(line.className).toBe("late-line");
  });

  it("the board's card: the same line; none when the driver said nothing", async () => {
    const board: Board = {
      date: today(), counts: { assigned: 1, in_progress: 1, completed: 0, cancelled: 0 },
      assigned: [{ id: "t2", time: "11:00", title: "Drop · Galle", driver: "Nuwan Silva", status: "Accepted 08:50" }],
      in_progress: [{ id: "t1", time: "09:00", title: "Team drop · Kurunegala", driver: "Kamal Perera", status: "On the way", late_report: LATE }],
      completed: [],
    };
    await mount(transport({ task_board: () => board }), "/tasks", <Route path="/tasks" element={<Tasks />} />);
    const lines = screen.getAllByTestId("card-late-report");
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe("Running late 15 min · said 08:52");
    expect(lines[0].closest(".tcard")?.textContent).toContain("Team drop · Kurunegala");
  });
});
