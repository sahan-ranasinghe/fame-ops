// My trips (Hotfix 2, A), on the page: this month and All by default, the rows (the live pill, who decided it, the
// driver and vehicle with Call driver, "Not assigned yet"), the status filter in the URL and into my_trips (the old
// rows dimmed until the new come), the minute's refresh re-rendering nothing when nothing changed, a row opening the
// request page beside the list from the list's own card (no second call), and back to the same list.
// Hotfix 3: All · Requests · Tasks I created (into my_trips' include and the URL); a task the person created is a row
// with its title, when, route, live state and the driver with Call, and opens the task; the count in the header.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { CreatedTaskCard, MyTrips as MyTripsData, RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { colomboDay, rangeDates } from "../ui/dateRange";
import { ToastProvider } from "../ui/Toast";
import { MyTrips } from "./MyTrips";
import { RequestDetail } from "./RequestDetail";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const month = rangeDates("month", colomboDay());
const OFFICE = { phone: "+94112345678", phone_display: "011 234 5678", call: "tel:+94112345678", whatsapp: "https://wa.me/94112345678" };
const TRIPS: RequestCard[] = [
  {
    id: "r3", requested_by: "Dilini", when: "Sun 18 Oct 09:00", back_by: "17:00", route: "Head office → Kandy site", status: "approved", version: 2,
    live: { state: "on_the_way", text: "On the way · 09:30" },
    approved_by: { name: "Palitha", at: "08:42", phone: "+94770000001", phone_display: "077 000 0001", call: "tel:+94770000001", whatsapp: "https://wa.me/94770000001" },
    assigned: { driver: "Kamal Perera", phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", vehicle: "WP CAB-4521", make_model: "Toyota HiAce", photo_url: "https://x/kamal.jpg" },
    office_phone: OFFICE,
  },
  {
    id: "r2", requested_by: "Dilini", when: "Sat 17 Oct 10:00", route: "Head office → Galle", status: "declined",
    live: { state: "declined", text: "Declined · no vehicle that day" },
    declined_by: { name: "Palitha", at: "Sat 17 Oct 08:10", reason: "no vehicle that day" },
  },
  { id: "r1", requested_by: "Dilini", when: "Mon 19 Oct 08:00", route: "Head office → Negombo", status: "waiting", live: { state: "waiting", text: "Waiting" } },
];
/** A task the person created directly (Hotfix 3): it opens the task. */
const CREATED: CreatedTaskCard = {
  source: "task", id: "t7", task_id: "t7", title: "Team drop · Kandy", when: "Mon 19 Oct 08:00", route: "Head office → Kandy site", stops_count: 3,
  status: "in_progress", live: { state: "on_the_way", text: "On the way · 08:10" }, created: "2026-10-18 10:42",
  assigned: { driver: "Ruwan Silva", phone: "+94771112223", call: "tel:+94771112223", whatsapp: "https://wa.me/94771112223", vehicle: "WP CAB-4521" },
};
const answer = (args: Record<string, unknown>, created: CreatedTaskCard[]): MyTripsData => {
  const requests = args.status === "declined" ? TRIPS.filter((t) => t.status === "declined") : TRIPS;
  const trips = args.include === "tasks" ? created : args.include === "requests" ? requests : [...created, ...requests];
  return { from: String(args.from), to: String(args.to), count: trips.length, total: trips.length, trips };
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  held: (() => void)[] = [];
  hold = false;
  created: CreatedTaskCard[] = [];
  constructor(private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_trips") {
      const data = structuredClone(answer(args, this.created)) as T;
      if (this.hold) return new Promise((resolve) => this.held.push(() => resolve(data)));
      return Promise.resolve(data);
    }
    if (tool === "list_requests") return Promise.resolve({ status: "all", count: 1, requests: [TRIPS[0]] } as T);
    return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
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

const requester: Me = { name: "Dilini", role: "staff", permissions: ["view", "request"], tools: ["my_trips", "list_requests", "create_request", "update_request", "cancel_request"] };

async function mount(person: Me = requester, url = "/my-trips", created: CreatedTaskCard[] = []) {
  const transport = new FakeTransport(person);
  transport.created = created;
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: person, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/my-trips" element={<MyTrips />}><Route path=":id" element={<RequestDetail />} /></Route>
            <Route path="/tasks/:id" element={<div>The task page</div>} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

afterEach(() => vi.useRealTimers());

describe("My trips", () => {
  it("this month and All by default: every trip with its live state, who decided it, the driver with Call driver", async () => {
    const t = await mount();
    expect(t.argsOf("my_trips")).toEqual([{ from: month.from, to: month.to, include: "all", limit: 25 }]);
    expect(screen.getByRole("heading", { name: "My trips" })).toBeTruthy();
    const rows = screen.getAllByTestId("trip-row");
    expect(rows).toHaveLength(3);
    expect(screen.getAllByTestId("trip-live").map((e) => e.textContent)).toEqual(["On the way · 09:30", "Declined · no vehicle that day", "Waiting"]);
    expect(screen.getAllByTestId("trip-decision").map((e) => e.textContent)).toEqual(["Approved by Palitha · 08:42", "Declined by Palitha · Sat 17 Oct 08:10 · no vehicle that day"]);
    // The approved trip: the driver, the plate, Call driver (on a computer: the number, Copy, WhatsApp web) and the approver.
    const first = within(rows[0]);
    expect(first.getByText("Kamal Perera")).toBeTruthy();
    expect(first.getByText("WP CAB-4521")).toBeTruthy();
    expect(within(first.getByTestId("call-driver")).getByText("077 123 4567")).toBeTruthy();
    expect(within(first.getByTestId("call-approver")).getByText("077 000 0001")).toBeTruthy();
    // The waiting one has no driver yet; the declined one offers no call.
    expect(within(rows[2]).getByText("Not assigned yet")).toBeTruthy();
    expect(within(rows[1]).queryByTestId("call-driver")).toBeNull();
    expect(within(rows[1]).queryByTestId("call-approver")).toBeNull();
    // Call office from the trips' office number; New request for someone who may ask.
    expect(within(screen.getByTestId("call-office-card")).getByText("011 234 5678")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /New request/ }).length).toBeGreaterThan(0);
    expect(screen.getByTestId("trips-totals").textContent).toMatch(/^3 trips · /);
  });

  it("the status filter goes into the URL and my_trips; the old rows stay dimmed until the new come", async () => {
    const t = await mount();
    t.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "Declined" }));
    expect(screen.getByTestId("where").textContent).toBe("/my-trips?status=declined");
    await act(async () => { await Promise.resolve(); });
    expect(t.argsOf("my_trips").at(-1)).toEqual({ from: month.from, to: month.to, status: "declined", include: "all", limit: 25 });
    // Still the three rows, dimmed, "Updating…".
    expect(screen.getAllByTestId("trip-row")).toHaveLength(3);
    expect(screen.getByTestId("trips-totals").textContent).toContain("Updating…");
    await act(async () => { t.held.forEach((r) => r()); await Promise.resolve(); });
    expect(screen.getAllByTestId("trip-row")).toHaveLength(1);
    expect(screen.getByTestId("trips-totals").textContent).not.toContain("Updating…");
    // All again: nothing in the URL.
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByTestId("where").textContent).toBe("/my-trips");
  });

  it("refreshes every minute; the same answer re-renders nothing (no flicker)", async () => {
    vi.useFakeTimers();
    const t = await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const row = screen.getAllByTestId("trip-row")[0];
    const pill = screen.getAllByTestId("trip-live")[0];
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(t.argsOf("my_trips")).toHaveLength(2);
    expect(screen.getAllByTestId("trip-row")[0]).toBe(row);
    expect(screen.getAllByTestId("trip-live")[0]).toBe(pill);
    expect(screen.queryByText(/Updating/)).toBeNull();
  });

  it("a row opens the request page beside the list from the list's card (no second call); back returns to the same list", async () => {
    const t = await mount(requester, "/my-trips?status=all&range=week");
    fireEvent.click(screen.getAllByTestId("trip-row")[0]);
    expect(screen.getByTestId("where").textContent).toBe("/my-trips/r3?status=all&range=week");
    expect(screen.getByTestId("request-detail")).toBeTruthy();
    expect(t.argsOf("list_requests")).toEqual([]);
    // The list stays beside it on a desktop.
    expect(screen.getAllByTestId("trip-row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/my-trips?status=all&range=week");
  });

  it("opened by its link alone: the page waits for My trips' list and takes the trip from it (no list_requests)", async () => {
    const t = await mount(requester, "/my-trips/r3");
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("request-detail")).toBeTruthy();
    expect(t.argsOf("list_requests")).toEqual([]);
  });

  it("a trip outside the list's dates (an old link): asked for with list_requests", async () => {
    const t = await mount(requester, "/my-trips/r9");
    await act(async () => { await Promise.resolve(); });
    expect(t.argsOf("list_requests")).toEqual([{ status: "all", id: "r9" }]);
  });

  it("without the my_trips tool: says so, asks nothing", async () => {
    const t = await mount({ ...requester, tools: ["list_requests"] });
    expect(screen.getByText(/needs the my_trips tool/)).toBeTruthy();
    expect(t.argsOf("my_trips")).toEqual([]);
  });
});

describe("My trips: the tasks I created (Hotfix 3, Hotfix 2's decision 2)", () => {
  it("a created task's row: title, when, route, live state, the driver with Call; it opens the task", async () => {
    await mount(requester, "/my-trips", [CREATED]);
    const rows = screen.getAllByTestId("trip-row");
    expect(rows).toHaveLength(4);
    expect(screen.getByTestId("list-count").textContent).toBe(" · 4");
    const row = rows.find((r) => r.getAttribute("data-source") === "task")!;
    expect(row.textContent).toContain("Task I created");
    expect(row.textContent).toContain("Team drop · Kandy");
    expect(row.textContent).toContain("Mon 19 Oct 08:00");
    expect(row.textContent).toContain("Head office → Kandy site");
    expect(row.textContent).toContain("3 stops");
    expect(within(row).getByTestId("trip-live").textContent).toBe("On the way · 08:10");
    expect(within(row).getByTestId("trip-driver").textContent).toContain("Ruwan Silva");
    expect(within(within(row).getByTestId("call-driver")).getByText("077 111 2223")).toBeTruthy();
    // The Call button does its own thing; the row opens the task (not the request page).
    fireEvent.click(row);
    expect(screen.getByTestId("where").textContent).toBe("/tasks/t7");
    expect(screen.getByText("The task page")).toBeTruthy();
  });

  it("All · Requests · Tasks I created: into my_trips' include and the URL; the empty line says what it means", async () => {
    const t = await mount(requester, "/my-trips", [CREATED]);
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Tasks I created" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("where").textContent).toBe("/my-trips?show=tasks");
    expect(t.argsOf("my_trips").at(-1)).toEqual({ from: month.from, to: month.to, include: "tasks", limit: 25 });
    expect(screen.getAllByTestId("trip-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "Requests" }));
    await act(async () => { await Promise.resolve(); });
    expect(t.argsOf("my_trips").at(-1)).toMatchObject({ include: "requests" });
    expect(screen.getAllByTestId("trip-row").every((r) => r.getAttribute("data-source") === "request")).toBe(true);
    // No created task in the days: the line says so.
    t.created = [];
    fireEvent.click(screen.getByRole("tab", { name: "Tasks I created" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("empty-line").textContent).toBe("You created no task in these dates.");
  });

  it("a request opened beside the list is found among the rows shown (the paged list hands them over)", async () => {
    const t = await mount(requester, "/my-trips/r1", [CREATED]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("request-detail")).toBeTruthy();
    expect(t.argsOf("list_requests")).toEqual([]);
  });
});
