// Phase 7 (§13), the office's side of a driver-started trip: the board's tags, the task page's tags and its Company work ↔
// Personal switch with "Attach a project" (set_trip_purpose), the page loaded again in place (no flash), and the
// setting driver_personal_trips on Settings → Fleet.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { TaskDetail as TaskDetailData } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { TaskDetail } from "./TaskDetail";
import { Tasks } from "./Tasks";

const trip = (purpose: "company" | "personal", kind: "self" | "dispatch" = "self"): TaskDetailData => ({
  task: { id: "t1", title: "Kadawatha", kind, purpose, status: "in_progress", start: "Sun 18 Oct 13:05", driver: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce" },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
});

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  invalidated = 0;
  constructor(public detail: TaskDetailData, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "set_trip_purpose") {
      const was = this.detail.task.purpose;
      const purpose = args.purpose as "company" | "personal";
      this.detail = { ...this.detail, task: { ...this.detail.task, purpose }, projects: args.project ? `${String(args.project)} 100%` : this.detail.projects };
      return Promise.resolve({ task_id: "t1", purpose, project: args.project, was: was !== purpose ? was : undefined } as T);
    }
    if (tool === "task_board") {
      return Promise.resolve({
        date: today(), counts: { assigned: 1, in_progress: 1, completed: 0, cancelled: 0 },
        assigned: [{ id: "t2", time: "14:00", title: "Site visit · Galle", kind: "dispatch", purpose: "company", driver: "Sunil Fernando", vehicle: "WP KL-1234", status: "Accepted" }],
        in_progress: [{ id: "t1", time: "13:05", title: "Kadawatha", kind: "self", purpose: "personal", driver: "Kamal Silva", vehicle: "WP CAB-4521", status: "Started 13:05" }],
        completed: [],
      } as T);
    }
    return Promise.resolve(structuredClone(this.detail) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    this.invalidated++;
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "task_board", "set_trip_purpose"] };
const viewerOfTasks: Me = { name: "Nimal", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "task_board"] };

async function mount(transport: FakeTransport, url = "/tasks/t1") {
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/tasks" element={<Tasks />}><Route path=":id" element={<TaskDetail />} /></Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
}

describe("the board", () => {
  it("tags a driver-started trip and a personal one; the office's tasks carry no tag", async () => {
    await mount(new FakeTransport(trip("personal"), dispatcher), "/tasks");
    const cards = document.querySelectorAll(".tcard");
    const byTitle = (t: string) => [...cards].find((c) => c.textContent?.includes(t)) as HTMLElement;
    expect(within(byTitle("Kadawatha")).getByTestId("trip-tags").textContent).toBe("Driver-startedPersonal");
    expect(within(byTitle("Site visit · Galle")).queryByTestId("trip-tags")).toBeNull();
  });
});

describe("the task page of a driver-started trip", () => {
  it("switches it to personal: set_trip_purpose, then the page and the board load again in place", async () => {
    const transport = new FakeTransport(trip("company"), dispatcher);
    await mount(transport);
    const page = screen.getByTestId("task-detail");
    expect(within(page).getAllByTestId("trip-tags")[0].textContent).toBe("Driver-started");
    const card = within(screen.getByTestId("trip-purpose"));
    expect(card.getByText(/Kamal started this trip in the app as/).textContent).toContain("company work · charged to Fame internal (no project)");
    expect(card.getByRole("button", { name: "Company work" }).getAttribute("aria-pressed")).toBe("true");
    expect(card.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);

    fireEvent.click(card.getByRole("button", { name: "Personal" }));
    expect(card.queryByLabelText("Attach a project")).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "Save" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(transport.argsOf("set_trip_purpose")).toEqual([{ task_id: "t1", purpose: "personal" }]);
    expect(transport.argsOf("task_detail").length).toBeGreaterThanOrEqual(2);
    expect(transport.invalidated).toBe(1);
    // The same page, never replaced by a Loading block: now tagged Personal.
    expect(screen.getByTestId("task-detail")).toBe(page);
    expect(within(page).getAllByTestId("trip-tags")[0].textContent).toBe("Driver-startedPersonal");
    expect(screen.getByTestId("trip-purpose").textContent).toContain("as personal");
  });

  it("attaches a project to company work", async () => {
    const transport = new FakeTransport(trip("company"), dispatcher);
    await mount(transport);
    const card = within(screen.getByTestId("trip-purpose"));
    fireEvent.change(card.getByLabelText("Attach a project"), { target: { value: " TRKAN1 " } });
    fireEvent.click(card.getByRole("button", { name: "Save" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(transport.argsOf("set_trip_purpose")).toEqual([{ task_id: "t1", purpose: "company", project: "TRKAN1" }]);
    expect(card.getByText("Company work · charged to TRKAN1")).toBeTruthy();
    expect(card.getByLabelText<HTMLInputElement>("Attach a project").value).toBe("");
  });

  it("someone without set_trip_purpose sees the tags and what the trip is, with no switch", async () => {
    await mount(new FakeTransport(trip("personal"), viewerOfTasks));
    expect(screen.getAllByTestId("trip-tags")[0].textContent).toBe("Driver-startedPersonal");
    const card = within(screen.getByTestId("trip-purpose"));
    expect(card.getByText(/started this trip in the app as/).textContent).toContain("as personal");
    expect(card.queryByRole("button", { name: "Save" })).toBeNull();
    expect(card.queryByRole("button", { name: "Personal" })).toBeNull();
  });

  it("the office's own task: no tags, no card", async () => {
    await mount(new FakeTransport(trip("company", "dispatch"), dispatcher));
    expect(screen.queryByTestId("trip-purpose")).toBeNull();
    expect(within(screen.getByTestId("task-detail")).queryByTestId("trip-tags")).toBeNull();
  });
});
