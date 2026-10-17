// Tasks go to the fleet admin first (Phase 7, §33) and requests carry their trip (§34), on the pages: the trip decide page
// (the stops and plan as asked, the proposal filled in, Send as proposed, only what changed sent, a refresh resets nothing),
// "Leave-by passed", the requester's request with its plan and Withdraw (no driver, vehicle or conflict), the proposal on
// the Requests list, the board's "Waiting for approval" column, and the setting.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Availability, AvailableDriver, Board, PlanTimeline, RequestCard } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { RequestDecide } from "./RequestDecide";
import { RequestDetail } from "./RequestDetail";
import { Requests } from "./Requests";
import { FleetSettings } from "./settings/FleetSettings";
import { Tasks } from "./Tasks";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Answer = (args: Record<string, unknown>, n: number) => unknown;

/** Answers each tool from a function of its arguments and how many times it was called; a watch answers once. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  count(tool: string) {
    return this.calls.filter((c) => c.tool === tool).length;
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args, this.count(tool))) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};
/** The request loads, then the page's queries (Who's available waits 400 ms for its arguments to settle). */
const opened = async () => {
  await settle();
  await settle(400);
  await settle();
};

async function mount(transport: FakeTransport, url: string, routes: React.ReactNode) {
  const me = await transport.me();
  const store = new FleetStore(transport);
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}><Routes>{routes}</Routes></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

const approver: Me = {
  name: "Palitha", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles"],
  tools: ["suggest_vehicles", "availability", "decide_request", "cancel_request", "list_requests", "list_drivers", "list_vehicles", "list_places", "task_board", "task_detail"],
};
const requester: Me = { name: "Dilini Jayasinghe", role: "staff", permissions: ["view", "request"], tools: ["list_requests", "create_request", "update_request", "cancel_request", "task_detail"] };

const timeline: PlanTimeline = {
  items: [
    { kind: "leave", at: "08:00", source: "manual" },
    { kind: "leg", from_n: "start", to_n: 1, km: 3, minutes: 10, source: "estimate" },
    { kind: "stop", n: 1, label: "Stop 1 · Pickup · Head office", place: "Head office", planned_arrive: "08:10", planned_leave: "08:15", dwell_min: 5 },
    { kind: "leg", from_n: 1, to_n: 2, km: 110, minutes: 150, source: "estimate" },
    { kind: "stop", n: 2, label: "Stop 2 · Drop · Kandy site", place: "Kandy site", planned_arrive: "10:45", planned_leave: "10:50", arrive_by: "11:00", dwell_min: 5 },
  ],
  totals: { drive_min: 160, km: 113, ends: "10:50" },
};
const trip = {
  start: { name: "Yard", has_pin: true, lat: 6.9, lng: 79.86 }, leave_by: "08:00", leave_by_source: "manual", timeline,
  stops: [
    { seq: 1, n: 1, label: "Stop 1 · Pickup · Head office", type: "pickup", place: "Head office", lat: 6.91, lng: 79.85, planned_arrive: "08:10" },
    { seq: 2, n: 2, label: "Stop 2 · Drop · Kandy site", type: "drop", place: "Kandy site", lat: 7.29, lng: 80.63, planned_arrive: "10:45", arrive_by: "11:00" },
  ],
};
const proposal: RequestCard = {
  id: "r9", kind: "task", title: "Team drop · Kandy", requested_by: "Nimal Fernando", when: "Sat 18 Oct 08:00", back_by: "17:00", route: "Head office → Kandy site",
  status: "waiting", version: 1, stops_count: 2, asked: "5 min ago",
  proposed: {
    driver: "Kamal Perera", username: "kamal.p", vehicle: "WP CAB-4521", vehicle_why: "Kamal's vehicle today", passengers: 4,
    conflicts: [{ kind: "driver", text: "Kamal is on Team drop 07:00–09:00 for Dilini" }],
  },
  fields: { date: "2026-10-18", time: "08:00", back_by: "17:00", pax: 4 },
  trip,
};

const driver = (name: string, username: string, extra: Partial<AvailableDriver> = {}): AvailableDriver => ({
  name, username, state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true, ...extra,
});
/** Who's available: Nuwan the best match, Kamal (the proposed driver) second; from the second answer on, Nuwan's words change. */
const availability = (_a: Record<string, unknown>, n: number): Availability => ({
  as_of: "18 Oct 07:00",
  window: { from: "Sat 18 Oct 08:00", until: "17:00", day: "2026-10-18" },
  drivers: [
    driver("Nuwan Silva", "nuwan.s", { rank: 1, vehicle: { reg_no: "WP KL-1234", source: "regular" }, status_text: n > 1 ? "On duty since 07:40" : "On duty since 07:12" }),
    driver("Kamal Perera", "kamal.p", { rank: 2, vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } }),
  ],
  best: { name: "Nuwan Silva", username: "nuwan.s", vehicle: { reg_no: "WP KL-1234", source: "regular" }, why: "On duty · free all day" },
  counts: { free: 2, on_duty: 2, all: 2 },
  vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
});

function decideTransport(card: RequestCard) {
  return new FakeTransport({
    list_requests: () => ({ status: "all", count: 1, requests: [card] }),
    suggest_vehicles: () => ({ request: card, vehicles: [{ reg_no: "WP CAB-4521", availability: "Free", pick: "good" }, { reg_no: "WP KL-1234", availability: "Free", pick: "good" }, { reg_no: "WP PH-2087", availability: "Free", pick: "good" }], drivers: [] }),
    availability,
    decide_request: (a) => ({ request: "approved", task_id: "t9", as_proposed: !a.driver && !a.vehicle && !a.leave_by, vehicle_used: { reg_no: "WP CAB-4521", why: "chosen" } }),
    list_drivers: () => ({ drivers: [{ name: "Kamal Perera", username: "kamal.p" }, { name: "Nuwan Silva", username: "nuwan.s" }] }),
    list_vehicles: () => ({ vehicles: [{ reg_no: "WP CAB-4521" }, { reg_no: "WP KL-1234" }] }),
    list_places: () => ({ places: [] }),
  }, approver);
}
const decideRoutes = <Route path="/requests/:id/decide" element={<RequestDecide />} />;

describe("the trip decide page (§33, §34)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  // The first test pays for importing the decide page (slow while the full suite runs): 20 s.
  it("shows the plan as asked with its road lines, the proposal filled in and its conflicts; Send as proposed sends nothing else", async () => {
    const transport = decideTransport(proposal);
    await mount(transport, "/requests/r9/decide", decideRoutes);
    await opened();
    expect(screen.getByTestId("request-decide-trip")).toBeTruthy();
    expect(transport.argsOf("list_requests")).toContainEqual({ status: "all", id: "r9", with_line: true });
    expect(screen.getByTestId("plan-timeline").textContent).toContain("Leave by 08:00");
    expect(screen.getAllByTestId("plan-stop").map((s) => s.querySelector("b")?.textContent)).toEqual(["Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kandy site"]);
    expect(screen.getByTestId("proposal-line").textContent).toBe("Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando");
    expect(screen.getByTestId("conflicts").textContent).toContain("Kamal is on Team drop 07:00–09:00");
    // The proposed driver, not the best match; the proposed vehicle.
    expect((screen.getByLabelText("Driver") as HTMLSelectElement).value).toBe("kamal.p");
    expect((screen.getByLabelText("Vehicle") as HTMLSelectElement).selectedOptions[0].textContent).toBe("WP CAB-4521 · the proposed vehicle");
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("08:00");
    expect(screen.queryByTestId("late-notice")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send as proposed" }));
    await settle();
    expect(transport.argsOf("decide_request")).toEqual([{ request_id: "r9", decision: "approve", decided_by: "Palitha" }]);
    expect(screen.getByTestId("request-decided").textContent).toContain("Sent as proposed.");
    expect(screen.getByRole("link", { name: "Open task" }).getAttribute("href")).toBe("/tasks/t9");
  }, 20_000);

  it("a moved leave-by and another driver from Who's available: Approve and send, only those sent; a refresh resets neither", async () => {
    const transport = decideTransport(proposal);
    await mount(transport, "/requests/r9/decide", decideRoutes);
    await opened();
    fireEvent.change(screen.getByLabelText("Leave by"), { target: { value: "08:30" } });
    expect(screen.getByRole("button", { name: "Approve and send" })).toBeTruthy();
    // Leaving 30 min later misses Stop 2's 11:00: said at once, from the plan as asked.
    expect(screen.getByTestId("departure-check")).toBeTruthy();
    const nuwan = screen.getAllByTestId("avail-row").find((r) => r.textContent?.includes("Nuwan Silva"))!;
    fireEvent.click(nuwan);
    const select = screen.getByLabelText("Driver") as HTMLSelectElement;
    expect(select.value).toBe("nuwan.s");
    expect((screen.getByLabelText("Vehicle") as HTMLSelectElement).selectedOptions[0].textContent).toBe("WP KL-1234 · Nuwan's regular vehicle");

    await settle(60_000); // the quiet refreshes
    await settle(400);
    expect(transport.count("availability")).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Driver")).toBe(select);
    expect(select.value).toBe("nuwan.s");
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("08:30");

    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
    await settle();
    expect(transport.argsOf("decide_request")).toEqual([{ request_id: "r9", decision: "approve", decided_by: "Palitha", driver: "nuwan.s", leave_by: "08:30" }]);
    expect(screen.getByTestId("request-decided").textContent).toContain("Approved and sent.");
  });

  it("a late proposal says so first; Decline needs a reason", async () => {
    const transport = decideTransport({ ...proposal, late: true });
    await mount(transport, "/requests/r9/decide", <>{decideRoutes}<Route path="/requests" element={<p>The list</p>} /></>);
    await opened();
    expect(screen.getByTestId("late-notice").textContent).toContain("Leave-by passed · not decided.");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await settle();
    expect(transport.count("decide_request")).toBe(0);
    expect(screen.getByText("Write the reason first. The person who asked will see it.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Decline with a reason"), { target: { value: "Too late now" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await settle();
    expect(transport.argsOf("decide_request")).toEqual([{ request_id: "r9", decision: "decline", decided_by: "Palitha", reason: "Too late now" }]);
    expect(screen.getByText("The list")).toBeTruthy();
  });

  it("a request planned with its stops takes the best match (no proposal) and names the driver", async () => {
    const card: RequestCard = { ...proposal, id: "r5", kind: "request", title: undefined, proposed: undefined, requested_by: "Dilini Jayasinghe" };
    const transport = decideTransport(card);
    await mount(transport, "/requests/r5/decide", decideRoutes);
    await opened();
    expect(screen.getByTestId("request-decide-trip")).toBeTruthy();
    expect(screen.queryByTestId("proposal-line")).toBeNull();
    expect((screen.getByLabelText("Driver") as HTMLSelectElement).value).toBe("nuwan.s");
    expect(screen.getByTestId("driver-default").textContent).toContain("The best match");
    fireEvent.click(screen.getByRole("button", { name: "Approve and send" }));
    await settle();
    expect(transport.argsOf("decide_request")).toEqual([{ request_id: "r5", decision: "approve", decided_by: "Palitha", driver: "nuwan.s" }]);
  });
});

describe("the request page for the person who asked (§35 17, 19)", () => {
  it("shows the plan but no driver, vehicle or conflict; Withdraw takes a reason in a second step", async () => {
    const card: RequestCard = { ...proposal, id: "r1", kind: "request", title: undefined, proposed: undefined, requested_by: "Dilini Jayasinghe", late: true };
    const transport = new FakeTransport({
      list_requests: () => ({ status: "all", count: 1, requests: [card] }),
      cancel_request: () => ({ request: { ...card, status: "cancelled" }, was: "waiting" }),
    }, requester);
    await mount(transport, "/requests/r1", <><Route path="/requests/:id" element={<RequestDetail />} /><Route path="/requests" element={<p>My requests</p>} /></>);
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByTestId("request-trip")).toBeTruthy();
    expect(screen.getByTestId("plan-timeline").textContent).toContain("Leave by 08:00");
    expect(screen.getByTestId("late-notice").textContent).toContain("the fleet admin decides it, or you withdraw it");
    expect(screen.queryByTestId("proposal-line")).toBeNull();
    expect(screen.queryByTestId("conflicts")).toBeNull();
    expect(screen.queryByTestId("availability")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the request" }));
    expect(screen.getByText("Write why you withdraw it. It stays on the request.")).toBeTruthy();
    expect(transport.count("cancel_request")).toBe(0);
    fireEvent.change(screen.getByLabelText("Withdraw this request with a reason"), { target: { value: "The trip is off" } });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the request" }));
    expect(await screen.findByText("My requests")).toBeTruthy();
    expect(transport.argsOf("cancel_request")).toEqual([{ request_id: "r1", reason: "The trip is off" }]);
  });

  it("once approved, the page shows the task's stops and times with what the office changed; never the plan as asked", async () => {
    // Sahan, 17 October: the task is the single source of the trip; here the office moved it to 07:15 and added a stop.
    const nowTimeline: PlanTimeline = {
      items: [
        { kind: "leave", at: "07:15", source: "manual" },
        { kind: "stop", n: 1, label: "Stop 1 · Pickup · Head office", place: "Head office", planned_arrive: "07:25", planned_leave: "07:30", dwell_min: 5 },
        { kind: "stop", n: 2, label: "Stop 2 · Visit · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:00", dwell_min: 60 },
        { kind: "stop", n: 3, label: "Stop 3 · Drop · Kandy site", place: "Kandy site", planned_arrive: "10:40", planned_leave: "10:45", arrive_by: "11:00", dwell_min: 5 },
      ],
      totals: { drive_min: 180, km: 150, ends: "10:45" },
    };
    const card: RequestCard = {
      ...proposal, id: "r1", kind: "request", title: undefined, proposed: undefined, requested_by: "Dilini Jayasinghe", status: "approved",
      when: "Sat 18 Oct 07:15", task_id: "t1",
      trip: {
        ...trip, source: "task", leave_by: "07:15", timeline: nowTimeline,
        stops: [...trip.stops.slice(0, 1), { seq: 3, n: 2, label: "Stop 2 · Visit · Kurunegala site", type: "visit", place: "Kurunegala site", status: "pending" }, { ...trip.stops[1], n: 3 }],
        changed: { by: "the office", was: "08:00 Sat 18 Oct", stops: true, text: "Changed by the office · was 08:00 Sat 18 Oct · stops changed" },
      },
      assigned: { driver: "Kamal Perera", phone: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", vehicle: "WP CAB-4521" },
    };
    const transport = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [card] }) }, requester);
    await mount(transport, "/requests/r1", <Route path="/requests/:id" element={<RequestDetail />} />);
    await act(async () => { await Promise.resolve(); });
    expect((await screen.findByTestId("trip-changed")).textContent).toBe("Changed by the office · was 08:00 Sat 18 Oct · stops changed");
    const plan = screen.getByTestId("plan-timeline").textContent ?? "";
    expect(plan).toContain("Leave by 07:15");
    expect(plan).toContain("Kurunegala site");
    expect(plan).not.toContain("08:00");
  });

  it("the office changes the task while the page is open: the next card's trip shows at once and its road lines are asked again", async () => {
    // A task edit does not bump the request's version: the trip asked once with its lines must not hide the newer plan.
    let leave = "07:15";
    const cardNow = (): RequestCard => ({
      ...proposal, id: "r1", kind: "request", title: undefined, proposed: undefined, requested_by: "Dilini Jayasinghe", status: "approved",
      when: `Sat 18 Oct ${leave}`, task_id: "t1", version: 3,
      trip: { ...trip, source: "task", leave_by: leave, timeline: { ...timeline, items: [{ kind: "leave", at: leave, source: "manual" }, ...timeline.items.slice(1)] } },
    });
    let push: ((ev: WatchEvent<unknown>) => void) | undefined;
    class Pushing extends FakeTransport {
      watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
        if (tool === "list_requests" && !args.with_line) push = cb as (ev: WatchEvent<unknown>) => void;
        return super.watch(tool, args, cb);
      }
    }
    const transport = new Pushing({ list_requests: () => ({ status: "all", count: 1, requests: [cardNow()] }) }, requester);
    // As in the app: the request beside its list, which the list's watch keeps current.
    await mount(transport, "/requests/r1", <Route path="/requests" element={<Requests />}><Route path=":id" element={<RequestDetail />} /></Route>);
    await act(async () => { await Promise.resolve(); });
    expect((await screen.findByTestId("plan-timeline")).textContent).toContain("Leave by 07:15");
    const lineAsks = () => transport.argsOf("list_requests").filter((a) => a.with_line).length;
    const asked = lineAsks();
    expect(asked).toBeGreaterThan(0);

    leave = "07:40";
    await act(async () => { push?.({ type: "data", data: { status: "all", count: 1, requests: [cardNow()] }, at: Date.now() }); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("plan-timeline").textContent).toContain("Leave by 07:40");
    expect(screen.getByTestId("plan-timeline").textContent).not.toContain("07:15");
    expect(lineAsks()).toBe(asked + 1);
  });

  it("the proposer sees their proposal's driver and vehicle", async () => {
    const dispatcher: Me = { name: "Nimal Fernando", role: "office", permissions: ["view", "assign_tasks"], tools: ["list_requests", "cancel_request", "task_board"] };
    const transport = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [proposal] }) }, dispatcher);
    await mount(transport, "/requests/r9", <Route path="/requests/:id" element={<RequestDetail />} />);
    expect((await screen.findByTestId("proposal-line")).textContent).toBe("Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando");
    expect(screen.getByRole("heading", { name: "Proposed task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy();
  });
});

describe("the queue and the board", () => {
  it("Requests marks a proposal and a late one", async () => {
    const other: RequestCard = { id: "r1", kind: "request", requested_by: "Dilini Jayasinghe", when: "Sat 18 Oct 09:00", status: "waiting", route: "Head office → Galle" };
    const transport = new FakeTransport({ list_requests: () => ({ status: "waiting", count: 2, requests: [{ ...proposal, late: true }, other] }) }, approver);
    await mount(transport, "/requests", <Route path="/requests" element={<Requests />} />);
    const rows = await screen.findAllByRole("row");
    const task = rows.find((r) => r.getAttribute("data-kind") === "task")!;
    expect(task.textContent).toContain("Team drop · Kandy");
    expect(task.querySelector("[data-testid=proposal-line]")?.textContent).toBe("Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando");
    expect(task.textContent).toContain("Leave-by passed");
    const plain = rows.find((r) => r.getAttribute("data-kind") === "request")!;
    expect(plain.textContent).toContain("Dilini Jayasinghe");
    expect(plain.textContent).not.toContain("Leave-by passed");
  });

  it("the board's first column holds the proposed tasks; a card opens the decide page", async () => {
    const board: Board = {
      date: today(), counts: { assigned: 1, in_progress: 0, completed: 0, cancelled: 0, waiting_approval: 1 },
      assigned: [{ id: "t3", time: "11:00", title: "Documents to Kandy", driver: "Ruwan", status: "Accepted 10:50" }], in_progress: [], completed: [],
      waiting_approval: [{
        request_id: "r9", time: "08:00", leave_by: "08:00", title: "Team drop · Kandy", from: "Head office", to: "Kandy site", stops_count: 3,
        driver: "Kamal Perera", vehicle: "WP CAB-4521", proposed_by: "Nimal Fernando", status: "Leave-by passed · not decided", late: true,
      }],
    };
    const transport = new FakeTransport({ task_board: () => board }, approver);
    await mount(transport, "/tasks", <><Route path="/tasks" element={<Tasks />} /><Route path="/requests/:id/decide" element={<p>Decide page</p>} /></>);
    const col = await screen.findByTestId("waiting-approval");
    expect(col.parentElement?.querySelector(".col")).toBe(col); // the first column
    expect(col.textContent).toContain("Waiting for approval");
    expect(col.textContent).toContain("3 stops");
    expect(col.textContent).toContain("proposed by Nimal Fernando");
    expect(col.textContent).toContain("Leave-by passed");
    fireEvent.click(screen.getByTestId("waiting-card"));
    expect(await screen.findByText("Decide page")).toBeTruthy();
  });

  it("no proposal: no column", async () => {
    const board: Board = { date: today(), counts: { assigned: 0, in_progress: 0, completed: 0, cancelled: 0 }, assigned: [], in_progress: [], completed: [], waiting_approval: [] };
    const transport = new FakeTransport({ task_board: () => board }, approver);
    await mount(transport, "/tasks", <Route path="/tasks" element={<Tasks />} />);
    await screen.findAllByText("No tasks");
    expect(screen.queryByTestId("waiting-approval")).toBeNull();
  });
});

describe("Settings → Fleet", () => {
  it("New tasks need the fleet admin's OK: on by default, saved when switched", async () => {
    const settings = { dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5 }, rush_hour: { factor: 1.3, centre: { lat: 6.92, lng: 79.86 }, radius_km: 15, bands: [] } };
    const transport = new FakeTransport({
      get_settings: (_a, n) => ({ settings: n > 1 ? { ...settings, tasks_need_approval: false } : settings, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
      update_settings: () => ({ ok: true }),
      routing_usage: () => ({ provider: "estimate", daily_budget: { ors: 2000 }, days: [] }),
      list_places: () => ({ places: [] }),
    }, { name: "Sahan", role: "admin", permissions: ["view", "users"], tools: ["get_settings", "update_settings", "routing_usage"] });
    await mount(transport, "/settings/fleet", <Route path="/settings/fleet" element={<FleetSettings />} />);
    const box = (await screen.findByRole("checkbox", { name: /New tasks need the fleet admin's OK/ })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(await screen.findByText("Setting saved")).toBeTruthy();
    expect(transport.argsOf("update_settings")).toEqual([{ key: "tasks_need_approval", value: false }]);
    expect(box.checked).toBe(false);
  });
});
