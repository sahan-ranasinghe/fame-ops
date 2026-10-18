import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Overview } from "./Overview";

const overview = {
  date: "2026-10-12",
  vehicles: { on_the_road: 2, total: 5, parked: 3, in_garage: 1 },
  tasks: { total: 4, in_progress: 1, done: 2 },
  requests: { waiting: 1, oldest: "3 h" },
  reminders: { count: 2, red: 1, window_days: 14 },
  on_the_road: [{ driver: "Nuwan Perera", vehicle: "WP CAB-4521", task: "Team drop", near: "Kurunegala", location: "Live · 2 min", links: { maps: "https://maps", call: "tel:0771" } }],
  needs_attention: [{ what: "Revenue licence expires", subject: "WP CAB-4521 · Toyota HiAce", due: "in 4 days", level: "red" }],
};
const waiting = { status: "waiting", count: 1, requests: [{ id: "r1", requested_by: "Isuru Bandara", project: "SLA", when: "Thu 8 Oct · 08:00", route: "Head office → Katunayake", need: "Car · 3 pax", status: "waiting" }] };

/** Answers from fixtures; every watch delivers its data at once. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: string[] = [];
  constructor(
    private ov: object = overview,
    private who: Me = { name: "Sahan", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"], tools: ["fleet_overview", "list_requests", "decide_request", "create_task", "create_request"] },
  ) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  call<T>(tool: string): Promise<T> {
    this.calls.push(tool);
    return Promise.resolve((tool === "fleet_overview" ? this.ov : waiting) as T);
  }
  watch<T>(tool: string, _args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push("watch:" + tool);
    cb({ type: "data", data: (tool === "fleet_overview" ? this.ov : waiting) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const needsDriver = {
  ...overview,
  needs_driver: {
    count: 2,
    tasks: [
      {
        task_id: "t2", start: "Sat 17 Oct 09:00", title: "Site visit · Galle", driver: "Sunil Fernando", kind: "not_accepted", reason_text: "Not accepted in time",
        line: "Sunil hasn't accepted · needs a driver", minutes_to_start: 1500, when: "in 1500 min",
      },
      {
        task_id: "t1", start: "09:00", title: "Team drop · Kurunegala", driver: "Kamal Silva", kind: "declined", reason_text: "Vehicle problem", note: "Brakes",
        line: "Kamal declined · Vehicle problem", minutes_to_start: -18, when: "18 min late",
        best: { name: "Nuwan Perera", username: "nuwan", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" }, why: "On duty · free" },
      },
    ],
  },
};

async function mount(transport: FakeTransport) {
  const store = new FleetStore(transport);
  const me = await transport.me();
  store.watch("overview", "fleet_overview", {}, 30000);
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false }}>
      <ToastProvider><MemoryRouter><Overview /></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

describe("Overview", () => {
  it("puts the red Needs a driver block first: the soonest first, each row to the task's change page, the header to the filtered board", async () => {
    await mount(new FakeTransport(needsDriver));
    const block = screen.getByTestId("needs-driver");
    expect(block.compareDocumentPosition(screen.getByText("Vehicles on the road")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Needs a driver · 2" }).getAttribute("href")).toBe("/tasks?filter=needs_driver");
    const rows = screen.getAllByTestId("needs-driver-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/tasks/t1/edit?driver=1", "/tasks/t2/edit?driver=1"]);
    expect(rows[0].textContent).toContain("09:00");
    expect(rows[0].textContent).toContain("Kamal declined · Vehicle problem · “Brakes”");
    expect(rows[0].textContent).toContain("18 min late");
    expect(rows[0].textContent).toContain("Best match: Nuwan Perera · WP CAB-4521");
    expect(rows[1].textContent).toContain("Sunil hasn't accepted · needs a driver");
  });

  it("an approver without assign_tasks sees the rows as text; the block is gone when nothing needs a driver", async () => {
    await mount(new FakeTransport(needsDriver, { name: "Boss", role: "office", permissions: ["view", "approve"], tools: ["fleet_overview", "list_requests"] }));
    expect(screen.getByText("Needs a driver · 2")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Needs a driver · 2" })).toBeNull();
    expect(screen.getAllByTestId("needs-driver-row").every((r) => r.tagName === "DIV")).toBe(true);
  });

  it("no block without approve or assign_tasks, or with a count of 0", async () => {
    await mount(new FakeTransport(needsDriver, { name: "Viewer", role: "viewer", permissions: ["view"], tools: ["fleet_overview"] }));
    expect(screen.queryByTestId("needs-driver")).toBeNull();
  });

  it("shows the tiles, the road, the reminders and the waiting requests", async () => {
    const transport = new FakeTransport();
    const store = new FleetStore(transport);
    const me = await transport.me();
    store.watch("overview", "fleet_overview", {}, 30000);
    render(
      <FleetProvider value={{ store, transport, me, noConnector: false }}>
        <ToastProvider><MemoryRouter><Overview /></MemoryRouter></ToastProvider>
      </FleetProvider>,
    );
    expect(screen.getByText("Vehicles on the road").parentElement?.textContent).toContain("2of 5");
    expect(screen.getByText("Free now").parentElement?.textContent).toContain("2vehicles"); // 3 parked, 1 in garage
    expect(screen.getByText("Oldest waiting 3 h")).toBeTruthy();
    expect(screen.getByText("1 need action now")).toBeTruthy();
    expect(screen.getByText("Nuwan Perera")).toBeTruthy();
    expect(screen.getByText("Live · 2 min")).toBeTruthy();
    expect(screen.getByText("Revenue licence expires")).toBeTruthy();
    expect(await screen.findByText("Isuru Bandara")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Approve & assign" }).getAttribute("href")).toMatch(/\/requests\/.+\/decide$/);
    expect(transport.calls).toContain("watch:list_requests");
    expect(screen.queryByTestId("needs-driver")).toBeNull();
  });
});
