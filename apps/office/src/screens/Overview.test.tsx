// The Overview (Hotfix 3, L1 and L2): the sections by role and in order, at most 5 rows each (3 on a phone) with
// "View all (N)", collapsing remembered per person (my_prefs / set_my_prefs on the web, this browser in the artifact),
// Needs attention as the server's groups expanding in place, Snooze and Dismiss on rows and groups, and the requests
// tile's line ("1 open · Nothing waiting" never again).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { resetPrefsMemory, storageKey } from "../app/prefs";
import { FleetStore } from "../data/store";
import type { Attention, AttentionGroup, Overview as OverviewData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Overview } from "./Overview";

const overview: OverviewData = {
  date: "2026-10-12",
  vehicles: { on_the_road: 2, total: 5, parked: 3, in_garage: 1 },
  tasks: { total: 4, in_progress: 1, done: 2 },
  requests: { waiting: 1, oldest_waiting: "3 h" },
  reminders: { count: 2, red: 1, window_days: 14 },
  on_the_road: [{ driver: "Nuwan Perera", vehicle: "WP CAB-4521", task: "Team drop", near: "Kurunegala", location: "Live · 2 min", links: { maps: "https://maps", call: "tel:0771" } }],
  needs_attention: [{ what: "Revenue licence expires", subject: "WP CAB-4521 · Toyota HiAce", due: "in 4 days", level: "red", severity: "critical", issue_id: "c1", kind: "document" }],
};
const request = (i: number) => ({ id: `r${i}`, requested_by: `Asker ${i}`, project: "SLA", when: "Thu 8 Oct · 08:00", route: "Head office → Katunayake", need: "Car · 3 pax", status: "waiting" });
const waiting = { status: "waiting", count: 1, total: 1, requests: [{ ...request(1), requested_by: "Isuru Bandara" }] };

const ndTask = (i: number, extra: object = {}) => ({
  task_id: `t${i}`, start: "09:00", title: `Team drop ${i}`, driver: "Kamal Silva", kind: "declined", reason_text: "Vehicle problem",
  line: "Kamal declined · Vehicle problem", minutes_to_start: i * 10, when: `in ${i * 10} min`, ...extra,
});
const needsDriver: OverviewData = {
  ...overview,
  needs_driver: {
    count: 2,
    tasks: [
      { ...ndTask(2), start: "Sat 17 Oct 09:00", title: "Site visit · Galle", driver: "Sunil Fernando", kind: "not_accepted", reason_text: "Not accepted in time", line: "Sunil hasn't accepted · needs a driver", minutes_to_start: 1500, when: "in 1500 min" },
      {
        ...ndTask(1), title: "Team drop · Kurunegala", note: "Brakes", minutes_to_start: -18, when: "18 min late",
        best: { name: "Nuwan Perera", username: "nuwan", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" }, why: "On duty · free" },
      },
    ] as never,
  },
};

const item = (id: string, what: string, extra: Partial<Attention> = {}): Attention => ({ what, subject: "WP CAB-4521", due: "today", level: "amber", severity: "warning", issue_id: id, kind: "odometer_flag", ...extra });
const odoGroup: AttentionGroup = {
  key: "odometer_flag", kind: "odometer_flag", title: "Odometer typed by hand · 3 this week", count: 3, severity: "warning",
  issue_ids: ["o1", "o2", "o3"], items: [item("o1", "Odometer check: typed"), item("o2", "Odometer check: typed"), item("o3", "Odometer check: typed")],
};
const lateGroup: AttentionGroup = { key: "late_start:t9", kind: "late_start", title: "Late start · Team drop", count: 1, severity: "warning", issue_ids: ["l1"], items: [item("l1", "Late start · Team drop", { kind: "late_start" })] };
const grouped: OverviewData = {
  ...overview,
  attention: { count: 4, groups: [odoGroup, lateGroup] },
  critical: { count: 1, items: [item("c1", "Vehicle problem: breakdown", { severity: "critical", level: "red", kind: "vehicle_report" })] },
};

const admin: Me = {
  name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"],
  tools: ["fleet_overview", "list_requests", "decide_request", "create_task", "create_request", "live_drivers", "update_issue", "my_prefs", "set_my_prefs", "list_issues"],
};
const dispatcher: Me = { name: "Dispatch", email: "d@fame.test", role: "office", permissions: ["view", "request", "assign_tasks"], tools: ["fleet_overview", "my_trips", "create_task", "live_drivers", "list_issues", "update_issue"] };
const requester: Me = { name: "Dilini", email: "dilini@fame.test", role: "staff", permissions: ["view", "request"], tools: ["fleet_overview", "my_trips", "create_request", "live_drivers"] };
const viewer: Me = { name: "Viewer", role: "viewer", permissions: ["view"], tools: ["fleet_overview", "live_drivers"] };

/** Answers from fixtures; every watch delivers its data at once. */
class FakeTransport implements Transport {
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  prefs: Record<string, unknown> = {};
  reqs: object = waiting;
  trips: object = { from: "2026-09-12", to: "2026-11-11", count: 0, total: 0, trips: [] };
  failIds = new Set<string>();
  constructor(public ov: object = overview, public who: Me = admin, readonly kind: "api" | "claude" = "api") {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    switch (tool) {
      case "fleet_overview":
        return this.ov;
      case "list_requests":
        return this.reqs;
      case "my_trips":
        return this.trips;
      case "my_prefs":
        return { prefs: this.prefs };
      case "set_my_prefs":
        this.prefs = { ...this.prefs, ...(args.prefs as object) };
        return { prefs: this.prefs };
      case "update_issue":
        if (this.failIds.has(String(args.id))) throw { code: "tool_error", message: "That issue is closed already." };
        return { issue: { id: args.id, status: args.status ?? "open" } };
      default:
        return {};
    }
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    try {
      return Promise.resolve(structuredClone(this.answer(tool, args)) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    this.calls.push({ tool: "watch:" + tool, args });
    cb({ type: "data", data: structuredClone(this.answer(tool, args)) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };

async function mount(transport: FakeTransport) {
  const store = new FleetStore(transport);
  const me = await transport.me();
  store.watch("overview", "fleet_overview", {}, 30000);
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false }}>
      <ToastProvider><MemoryRouter><Overview /></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
  await flush();
  return store;
}

const order = () => [...document.querySelectorAll("[data-section]")].map((e) => (e as HTMLElement).dataset.section);
const sectionEl = (id: string) => document.querySelector(`[data-section="${id}"]`) as HTMLElement;

function asPhone() {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  resetPrefsMemory();
});

describe("Overview: the sections by role (L1)", () => {
  it("an approver: Requests to approve, Needs a driver, Critical issues, the tiles, On the road, Needs attention", async () => {
    await mount(new FakeTransport({ ...grouped, needs_driver: needsDriver.needs_driver }));
    expect(order()).toEqual(["requests", "needs_driver", "critical", "tiles", "road", "attention"]);
    const req = sectionEl("requests");
    expect(within(req).getByRole("heading").textContent).toBe("Requests to approve1");
    expect(within(req).getByTestId("request-row").textContent).toContain("Isuru Bandara");
    expect(within(req).getByRole("link", { name: "Decide" }).getAttribute("href")).toBe("/requests/r1/decide");
    expect(within(req).getByTestId("view-all").getAttribute("href")).toBe("/requests");
    expect(within(sectionEl("critical")).getByTestId("view-all").getAttribute("href")).toBe("/issues?severity=critical");
    expect(within(sectionEl("road")).getByTestId("view-all").textContent).toBe("View all (1)");
    expect(within(sectionEl("road")).getByTestId("view-all").getAttribute("href")).toBe("/live");
    expect(within(sectionEl("attention")).getByTestId("view-all").textContent).toBe("View all (4)");
    expect(within(sectionEl("attention")).getByTestId("view-all").getAttribute("href")).toBe("/issues");
  });

  it("asks the waiting queue a page at a time (limit 5) and counts by its total", async () => {
    const t = new FakeTransport();
    t.reqs = { status: "waiting", count: 5, total: 50, next: "c5", requests: [1, 2, 3, 4, 5].map(request) };
    await mount(t);
    expect(t.argsOf("watch:list_requests")).toEqual([{ status: "waiting", limit: 5 }]);
    expect(within(sectionEl("requests")).getAllByTestId("request-row")).toHaveLength(5);
    expect(within(sectionEl("requests")).getByTestId("view-all").textContent).toBe("View all (50)");
  });

  it("a dispatcher: Needs a driver first, no requests queue; Critical issues only while any", async () => {
    await mount(new FakeTransport({ ...grouped, critical: { count: 0, items: [] }, needs_driver: needsDriver.needs_driver }, dispatcher));
    expect(order()).toEqual(["needs_driver", "tiles", "road", "attention"]);
    expect(screen.queryByText("Requests to approve")).toBeNull();
  });

  it("a requester: My trips (the last 30 days and the next 30, the newest 5, each with its live state) and the tiles", async () => {
    const t = new FakeTransport(overview, requester);
    t.trips = {
      from: "2026-09-12", to: "2026-11-11", count: 2, total: 7,
      trips: [
        { ...request(4), route: "Head office → Galle", live: { state: "on_the_way", text: "On the way · 09:30" } },
        { source: "task", id: "t8", task_id: "t8", title: "Site visit · Matara", when: "Fri 16 Oct 08:00", status: "completed", live: { state: "completed", text: "Completed · 11:40" }, created: "2026-10-15 10:00" },
      ],
    };
    await mount(t);
    expect(order()).toEqual(["my_trips", "tiles"]);
    const args = t.argsOf("my_trips")[0];
    expect(args.limit).toBe(5);
    expect(String(args.from) < String(args.to)).toBe(true);
    const rows = within(sectionEl("my_trips")).getAllByTestId("trip-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/my-trips/r4", "/tasks/t8"]);
    expect(rows[0].textContent).toContain("On the way · 09:30");
    expect(rows[1].textContent).toContain("Completed · 11:40");
    expect(within(sectionEl("my_trips")).getByTestId("view-all").textContent).toBe("View all (7)");
    expect(within(sectionEl("my_trips")).getByTestId("view-all").getAttribute("href")).toBe("/my-trips");
  });

  it("a viewer: the tiles and On the road", async () => {
    await mount(new FakeTransport(grouped, viewer));
    expect(order()).toEqual(["tiles", "road"]);
  });
});

// Round 51b (30 October 2026): a row opens its item, not only its link or button: the row's main link covers the row (the
// stretched link, styles.css .row-card .row-open::after); Decide and ⋯ stay their own (.row-own, above it).
describe("Overview: a row opens its item", () => {
  it("a request row is one link to the request with Decide on top; an issue row (and a group) covers its row, ⋯ on top", async () => {
    await mount(new FakeTransport({ ...grouped, needs_driver: needsDriver.needs_driver }));
    const req = within(sectionEl("requests")).getByTestId("request-row");
    expect(req.classList.contains("row-card")).toBe(true);
    const open = req.querySelector("a.row-open");
    expect(open?.getAttribute("href")).toBe("/requests/r1");
    expect(within(req).getByRole("link", { name: "Decide" }).classList.contains("row-own")).toBe(true);
    const rows = within(sectionEl("attention")).getAllByTestId("attention-row");
    for (const row of rows) expect(row.querySelector(".row-card .row-open")).not.toBeNull();
    expect(rows[1].querySelector(".row-card a.row-open")?.getAttribute("href")).toBe("/issues/l1");
    for (const more of within(sectionEl("attention")).getAllByRole("button", { name: /^Snooze or dismiss/ })) expect(more.classList.contains("row-own")).toBe(true);
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Odometer typed by hand · 3 this week" }));
    for (const item of within(rows[0]).getAllByTestId("attention-item")) expect(item.classList.contains("row-card") && !!item.querySelector("a.row-open")).toBe(true);
  });
});

describe("Overview: never more than 5 rows a section (3 on a phone)", () => {
  const big = (): OverviewData => ({
    ...overview,
    on_the_road: Array.from({ length: 12 }, (_, i) => ({ ...overview.on_the_road[0], driver: `Driver ${i}`, username: `d${i}` })),
    needs_driver: { count: 7, tasks: Array.from({ length: 7 }, (_, i) => ndTask(i + 1)) as never },
    critical: { count: 9, items: Array.from({ length: 5 }, (_, i) => item(`c${i}`, `Critical ${i}`, { severity: "critical" })) },
    attention: {
      count: 100,
      groups: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, kind: `kind${i}`, title: `Group ${i}`, count: 3, severity: "warning" as const, issue_ids: [`a${i}`], items: [item(`a${i}`, `A ${i}`), item(`b${i}`, `B ${i}`), item(`x${i}`, `X ${i}`)] })),
    },
  });

  it("a desktop: 5 rows each, the counts in View all", async () => {
    const t = new FakeTransport(big());
    t.reqs = { status: "waiting", count: 5, total: 50, requests: [1, 2, 3, 4, 5, 6, 7].map(request) };
    await mount(t);
    expect(within(sectionEl("requests")).getAllByTestId("request-row")).toHaveLength(5);
    expect(within(sectionEl("needs_driver")).getAllByTestId("needs-driver-row")).toHaveLength(5);
    expect(within(sectionEl("needs_driver")).getByTestId("view-all").textContent).toBe("View all (7)");
    expect(within(sectionEl("needs_driver")).getByTestId("view-all").getAttribute("href")).toBe("/tasks?filter=needs_driver");
    expect(within(sectionEl("critical")).getAllByTestId("critical-row")).toHaveLength(5);
    expect(within(sectionEl("critical")).getByTestId("view-all").textContent).toBe("View all (9)");
    expect(within(sectionEl("road")).getAllByTestId("road-row")).toHaveLength(5);
    expect(within(sectionEl("road")).getByTestId("view-all").textContent).toBe("View all (12)");
    expect(within(sectionEl("attention")).getAllByTestId("attention-row")).toHaveLength(5);
    expect(within(sectionEl("attention")).getByTestId("view-all").textContent).toBe("View all (100)");
    // Nothing else on the page lists rows.
    expect(document.querySelectorAll("[data-testid$='-row']").length).toBe(5 * 5);
  });

  it("a phone: 3 rows each", async () => {
    asPhone();
    const t = new FakeTransport(big());
    t.reqs = { status: "waiting", count: 5, total: 50, requests: [1, 2, 3, 4, 5].map(request) };
    await mount(t);
    for (const [id, row] of [["requests", "request-row"], ["needs_driver", "needs-driver-row"], ["critical", "critical-row"], ["road", "road-row"], ["attention", "attention-row"]]) {
      expect(within(sectionEl(id)).getAllByTestId(row)).toHaveLength(3);
    }
  });
});

describe("Overview: collapsing a section, remembered per person", () => {
  it("web: the title collapses it (the count stays), set_my_prefs keeps it; the next page opens collapsed from my_prefs", async () => {
    const t = new FakeTransport();
    await mount(t);
    expect(t.argsOf("my_prefs")).toEqual([{}]);
    const road = sectionEl("road");
    fireEvent.click(within(road).getByRole("button", { name: /On the road/ }));
    expect(road.dataset.collapsed).toBe("true");
    expect(within(road).getByRole("button", { name: /On the road/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(road).getByTestId("ov-count").textContent).toBe("1");
    expect(road.querySelector(".ov-body")?.hasAttribute("hidden")).toBe(true);
    await flush();
    expect(t.argsOf("set_my_prefs")).toEqual([{ prefs: { overview_collapsed: ["road"] } }]);

    // Another page (the same person on another device): the server's copy decides.
    resetPrefsMemory();
    localStorage.clear();
    const again = new FakeTransport();
    again.prefs = { overview_collapsed: ["requests"] };
    cleanup();
    await mount(again);
    expect(sectionEl("requests").dataset.collapsed).toBe("true");
    expect(sectionEl("road").dataset.collapsed).toBeUndefined();
    // Opened again: the list without it.
    fireEvent.click(within(sectionEl("requests")).getByRole("button", { name: /Requests to approve/ }));
    await flush();
    expect(again.argsOf("set_my_prefs")).toEqual([{ prefs: { overview_collapsed: [] } }]);
  });

  it("the artifact (no person): kept in this browser, never asked of the server", async () => {
    const t = new FakeTransport(overview, admin, "claude");
    await mount(t);
    fireEvent.click(within(sectionEl("attention")).getByRole("button", { name: /Needs attention/ }));
    await flush();
    expect(t.argsOf("my_prefs")).toEqual([]);
    expect(t.argsOf("set_my_prefs")).toEqual([]);
    expect(JSON.parse(localStorage.getItem(storageKey(admin)) ?? "{}")).toEqual({ overview_collapsed: ["attention"] });
  });
});

describe("Needs attention and Critical issues (L2)", () => {
  it("a group shows its title and count and expands in place to its issues, each to its page; one issue is a plain row", async () => {
    await mount(new FakeTransport(grouped));
    const rows = within(sectionEl("attention")).getAllByTestId("attention-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Odometer typed by hand · 3 this week");
    expect(within(rows[0]).getByTestId("group-count").textContent).toBe("3");
    expect(within(rows[0]).queryByTestId("group-items")).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Odometer typed by hand · 3 this week" }));
    expect(within(rows[0]).getByRole("button", { name: "Odometer typed by hand · 3 this week" }).getAttribute("aria-expanded")).toBe("true");
    const items = within(rows[0]).getAllByTestId("attention-item");
    expect(items.map((i) => within(i).getByRole("link").getAttribute("href"))).toEqual(["/issues/o1", "/issues/o2", "/issues/o3"]);
    expect(within(rows[1]).getByRole("link", { name: "Late start · Team drop" }).getAttribute("href")).toBe("/issues/l1");
    // Nothing the other sections show: the critical one is under Critical issues only.
    expect(within(sectionEl("attention")).queryByText(/Vehicle problem: breakdown/)).toBeNull();
    expect(within(sectionEl("critical")).getByRole("link", { name: "Vehicle problem: breakdown" }).getAttribute("href")).toBe("/issues/c1");
  });

  it("Snooze until tomorrow on a group: every issue of it, the row goes at once", async () => {
    const t = new FakeTransport(grouped);
    await mount(t);
    const row = within(sectionEl("attention")).getAllByTestId("attention-row")[0];
    fireEvent.click(within(row).getByRole("button", { name: "Snooze or dismiss: Odometer typed by hand · 3 this week" }));
    fireEvent.click(within(row).getByRole("button", { name: "Until tomorrow" }));
    await flush();
    expect(t.argsOf("update_issue")).toEqual([{ id: "o1", snooze: "tomorrow" }, { id: "o2", snooze: "tomorrow" }, { id: "o3", snooze: "tomorrow" }]);
    expect(within(sectionEl("attention")).getAllByTestId("attention-row")).toHaveLength(1);
    // The toast says it, with Undo (docs/ui-patterns.md §10).
    expect(screen.getByRole("status").textContent).toBe("Snoozed 3 issues until tomorrow 07:00Undo");
    expect(screen.getByTestId("toast-action").textContent).toBe("Undo");
  });

  it("Dismiss asks once more in the same strip; Keep goes back; a week's snooze on a critical row", async () => {
    const t = new FakeTransport(grouped);
    await mount(t);
    const late = within(sectionEl("attention")).getAllByTestId("attention-row")[1];
    fireEvent.click(within(late).getByRole("button", { name: /^Snooze or dismiss/ }));
    fireEvent.click(within(late).getByRole("button", { name: "Dismiss" }));
    expect(t.argsOf("update_issue")).toEqual([]);
    expect(within(late).getByText("Dismiss this issue?")).toBeTruthy();
    fireEvent.click(within(late).getByRole("button", { name: "Keep" }));
    fireEvent.click(within(late).getByRole("button", { name: "Dismiss" }));
    fireEvent.click(within(late).getByRole("button", { name: "Yes, dismiss" }));
    await flush();
    expect(t.argsOf("update_issue")).toEqual([{ id: "l1", status: "dismissed" }]);
    expect(within(sectionEl("attention")).getAllByTestId("attention-row")).toHaveLength(1);

    const crit = within(sectionEl("critical")).getByTestId("critical-row");
    fireEvent.click(within(crit).getByRole("button", { name: /^Snooze or dismiss/ }));
    fireEvent.click(within(crit).getByRole("button", { name: "1 week" }));
    await flush();
    expect(t.argsOf("update_issue").at(-1)).toEqual({ id: "c1", snooze: "week" });
    // The last critical one gone: the section goes with it.
    expect(sectionEl("critical")).toBeNull();
  });

  it("a refused issue: the row stays with the reason; without update_issue no actions at all", async () => {
    const t = new FakeTransport(grouped);
    t.failIds.add("l1");
    await mount(t);
    const late = within(sectionEl("attention")).getAllByTestId("attention-row")[1];
    fireEvent.click(within(late).getByRole("button", { name: /^Snooze or dismiss/ }));
    fireEvent.click(within(late).getByRole("button", { name: "Until tomorrow" }));
    await flush();
    expect(within(late).getByRole("alert").textContent).toBe("That issue is closed already.");
    expect(within(sectionEl("attention")).getAllByTestId("attention-row")).toHaveLength(2);
    cleanup();
    await mount(new FakeTransport(grouped, { ...admin, tools: admin.tools.filter((x) => x !== "update_issue") }));
    expect(screen.queryAllByRole("button", { name: /^Snooze or dismiss/ })).toEqual([]);
  });

  it("an older answer (no groups): its warning items, not the kinds another section shows, not the info ones", async () => {
    await mount(new FakeTransport({
      ...overview,
      needs_attention: [
        item("w1", "Service due", { kind: "service_due" }),
        item("q1", "Request waiting", { kind: "request_waiting" }),
        item("n1", "Not accepted", { kind: "not_accepted" }),
        item("i1", "Documents missing", { kind: "documents_missing", severity: "info" }),
        item("c1", "Vehicle problem", { kind: "vehicle_report", severity: "critical", level: "red" }),
      ],
    }));
    expect(within(sectionEl("attention")).getAllByTestId("attention-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Service due")]);
    expect(within(sectionEl("critical")).getAllByTestId("critical-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Vehicle problem")]);
  });
});

describe("Needs a driver", () => {
  it("the soonest first, each row to the task's change page, View all to the filtered board", async () => {
    await mount(new FakeTransport(needsDriver));
    const block = screen.getByTestId("needs-driver");
    expect(block.compareDocumentPosition(screen.getByText("Vehicles on the road")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getByTestId("view-all").getAttribute("href")).toBe("/tasks?filter=needs_driver");
    const rows = screen.getAllByTestId("needs-driver-row");
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/tasks/t1/edit?driver=1", "/tasks/t2/edit?driver=1"]);
    expect(rows[0].textContent).toContain("09:00");
    expect(rows[0].textContent).toContain("Kamal declined · Vehicle problem · “Brakes”");
    expect(rows[0].textContent).toContain("18 min late");
    expect(rows[0].textContent).toContain("Best match: Nuwan Perera · WP CAB-4521");
    expect(rows[1].textContent).toContain("Sunil hasn't accepted · needs a driver");
  });

  it("an approver without assign_tasks sees the rows as text and no View all; nothing when the count is 0", async () => {
    await mount(new FakeTransport(needsDriver, { name: "Boss", role: "office", permissions: ["view", "approve"], tools: ["fleet_overview", "list_requests"] }));
    expect(within(screen.getByTestId("needs-driver")).queryByTestId("view-all")).toBeNull();
    expect(screen.getAllByTestId("needs-driver-row").every((r) => r.tagName === "DIV")).toBe(true);
    cleanup();
    await mount(new FakeTransport({ ...needsDriver, needs_driver: { count: 0, tasks: [] } }));
    expect(screen.queryByTestId("needs-driver")).toBeNull();
  });
});

describe("the tiles", () => {
  it("show the counts; the requests tile never says Nothing waiting while something waits", async () => {
    await mount(new FakeTransport());
    expect(screen.getByText("Vehicles on the road").parentElement?.textContent).toContain("2of 5");
    expect(screen.getByText("Free now").parentElement?.textContent).toContain("2vehicles"); // 3 parked, 1 in garage
    expect(screen.getByText("Oldest waiting 3 h")).toBeTruthy();
    expect(screen.getByText("1 need action now")).toBeTruthy();
    cleanup();
    // A proposed task waiting, the age not given (the Teams copy's old field): never "1 open · Nothing waiting".
    await mount(new FakeTransport({ ...overview, requests: { waiting: 1 } }));
    const tile = screen.getByText("Requests to approve", { selector: ".lbl" }).parentElement as HTMLElement;
    expect(tile.textContent).toContain("1open");
    expect(tile.textContent).toContain("Waiting for a decision");
    expect(tile.textContent).not.toContain("Nothing waiting");
    cleanup();
    await mount(new FakeTransport({ ...overview, requests: { waiting: 0 } }));
    expect((screen.getByText("Requests to approve", { selector: ".lbl" }).parentElement as HTMLElement).textContent).toContain("Nothing waiting");
  });
});
