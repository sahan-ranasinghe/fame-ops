// Tasks → History (Phase 7 §8): this week by default, the filters into list_tasks, the rows with their tags, the totals
// and the "more" sentence; the previous rows stay (marked Updating…) while other filters load; a row opens the task.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { HistoryTask, TaskHistory as TaskHistoryData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { colomboDay, rangeDates } from "../ui/dateRange";
import { TaskHistory } from "./TaskHistory";

const week = rangeDates("week", colomboDay());
const task = (over: Partial<HistoryTask>): HistoryTask => ({
  id: "t1", date: week.from, time: "08:30", title: "Team drop · Kurunegala site", label: "Mobitel MS", kind: "dispatch", purpose: "company", status: "completed",
  driver: "Nuwan Perera", driver_username: "nuwan.p", vehicle: "WP CAB-4521", from: "Head office", to: "Kurunegala site", stops_count: 2,
  started: `${week.from} 08:41`, completed: `${week.from} 11:02`, km: 96, ...over,
});
const ANSWER: TaskHistoryData = {
  from: week.from, to: week.to, count: 2, more: "Over 500 tasks: narrow the days or the filters to see the rest.",
  totals: { completed: 2, cancelled: 0, km: 108, driver_started: 1, personal: 1 },
  tasks: [task({}), task({ id: "t2", title: "Trip · Kandy", label: undefined, kind: "self", purpose: "personal", km: 12, from: "Kandy", to: undefined, stops_count: 1 })],
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  /** Answers held back until release() (to see the previous rows stay while the next load runs). */
  held: (() => void)[] = [];
  hold = false;
  constructor(private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const data = tool === "list_tasks"
      ? (args.kind === "self" ? { ...ANSWER, count: 1, more: undefined, totals: { ...ANSWER.totals, completed: 1, km: 12 }, tasks: [ANSWER.tasks[1]] } : ANSWER)
      : tool === "list_drivers" ? { drivers: [{ name: "Nuwan Perera", username: "nuwan.p" }] }
      : { vehicles: [], places: [] };
    if (tool === "list_tasks" && this.hold) return new Promise((resolve) => this.held.push(() => resolve(structuredClone(data) as T)));
    return Promise.resolve(structuredClone(data) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const dispatcher: Me = { name: "Nimal", role: "office", permissions: ["view", "assign_tasks"], tools: ["list_tasks", "list_drivers", "list_vehicles", "list_places", "task_detail"] };

async function mount(person: Me = dispatcher, url = "/tasks/history") {
  const transport = new FakeTransport(person);
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: person, noConnector: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/tasks/history" element={<TaskHistory />} />
          <Route path="/tasks/:id" element={<div>The task page</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

describe("Tasks → History", () => {
  it("asks for this week; shows each task with its tags, the totals and the more sentence; a row opens the task", async () => {
    const t = await mount();
    expect(t.argsOf("list_tasks")[0]).toEqual({ from: week.from, to: week.to, limit: 25 });
    const rows = await screen.findAllByTestId("history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Team drop · Kurunegala site");
    expect(rows[0].textContent).toContain("Head office → Kurunegala site");
    expect(rows[0].textContent).toContain("08:41–11:02");
    expect(rows[0].textContent).not.toContain("Driver-started");
    expect(within(rows[1]).getByText("Driver-started")).toBeTruthy();
    expect(within(rows[1]).getByText("Personal")).toBeTruthy();
    expect(screen.getByTestId("history-totals").textContent).toBe("2 tasks · 2 completed · 108 km · 1 driver-started · 1 personal");
    expect(screen.getByText("Over 500 tasks: narrow the days or the filters to see the rest.")).toBeTruthy();

    fireEvent.click(rows[0]);
    const today = colomboDay();
    expect(screen.getByTestId("where").textContent).toBe(`/tasks/t1${week.from !== today ? `?date=${week.from}` : ""}`);
  }, 20_000);

  it("a filter goes into the URL and the tool; the previous rows stay, marked Updating…, until the answer lands", async () => {
    const t = await mount();
    await screen.findAllByTestId("history-row");
    t.hold = true;
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "self" } });
    await act(async () => { await Promise.resolve(); });
    expect(t.argsOf("list_tasks").at(-1)).toEqual({ from: week.from, to: week.to, kind: "self", limit: 25 });
    expect(screen.getByTestId("where").textContent).toBe("/tasks/history?kind=self");
    expect(screen.getAllByTestId("history-row")).toHaveLength(2);
    expect(screen.getByTestId("history-totals").textContent).toContain("Updating…");
    await act(async () => { t.held.forEach((r) => r()); await Promise.resolve(); });
    expect(await screen.findByText("1 task · 1 completed · 12 km · 1 driver-started · 1 personal")).toBeTruthy();
    expect(screen.getAllByTestId("history-row")).toHaveLength(1);
  });

  it("the dates and filters of a link are used as they are", async () => {
    const t = await mount(dispatcher, "/tasks/history?range=custom&from=2026-09-01&to=2026-09-30&driver=nuwan.p&status=completed");
    expect(t.argsOf("list_tasks")[0]).toEqual({ from: "2026-09-01", to: "2026-09-30", driver: "nuwan.p", status: "completed", limit: 25 });
  });

  it("someone without list_tasks is told, and nothing is asked", async () => {
    const t = await mount({ ...dispatcher, tools: ["list_drivers"] });
    expect(screen.getByText(/Task history needs the list_tasks tool/)).toBeTruthy();
    expect(t.argsOf("list_tasks")).toEqual([]);
  });

  it("Hotfix 3: the count in the header, the search into the URL and the tool, Missed among the statuses", async () => {
    const t = await mount(dispatcher, "/tasks/history?status=missed");
    expect(t.argsOf("list_tasks")[0]).toEqual({ from: week.from, to: week.to, status: "missed", limit: 25 });
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("missed");
    await screen.findAllByTestId("history-row");
    expect(screen.getByTestId("list-count").textContent).toBe(" · 2");
    const box = screen.getByLabelText("Search");
    fireEvent.change(box, { target: { value: "Kandy" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("where").textContent).toBe("/tasks/history?status=missed&q=Kandy");
    expect(t.argsOf("list_tasks").at(-1)).toEqual({ from: week.from, to: week.to, status: "missed", search: "Kandy", limit: 25 });
  });
});
