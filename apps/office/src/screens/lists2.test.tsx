// Round 4–7, item 8 (the lists cleaned up, second part; docs/phase8-parity.md "the list audit"): every reworked list of
// the site keeps its key actions (open a row, the filter, the search, the date range, the paging, the row's own buttons)
// and says each fact once: Fuel's "Video", the Vehicles' one status and quiet valid documents, My trips' status and
// "Task I created", the Requests' status pill, the Drivers board's chip under its Show filter, the Tasks board's
// "Not confirmed", the Places' Kind column. The rules themselves: lists2Logic.ts (the first block).
import { pageOf, pageWindow } from "@fleet/paging";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Board, BoardCard, CreatedTaskCard, FuelEntry, RequestCard, VehicleCard } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { applyFilter } from "../test/controls";
import { ToastProvider } from "../ui/Toast";
import { boardAnswer } from "./__fixtures__/driversBoard";
import { DriversBoard } from "./DriversBoard";
import { Fuel } from "./Fuel";
import {
  boardFinishText, boardStatusShown, createdTagShown, docsAllValid, liveRest, placeKindShown, requestPillShown, requestStepWords, tripStatusShown, validDocsWords, vehicleStatusShown, videoCellWords,
} from "./lists2Logic";
import { MyTrips } from "./MyTrips";
import { Places } from "./Places";
import { Requests } from "./Requests";
import { Tasks } from "./Tasks";
import { Vehicles } from "./Vehicles";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Args = Record<string, unknown>;
type Answer = (args: Args) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(private person: Me, private answers: Record<string, Answer>) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const paged = <T,>(rows: T[], args: Args) => pageOf(rows, pageWindow(args.limit as number | undefined, args.cursor as string | undefined));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

async function mount(person: Me, answers: Record<string, Answer>, url: string) {
  const t = new FakeTransport(person, answers);
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: person, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/fuel" element={<Fuel />}><Route path=":id" element={<div data-testid="fuel-page" />} /></Route>
            <Route path="/vehicles" element={<Vehicles />}><Route path=":reg" element={<div data-testid="vehicle-page" />} /></Route>
            <Route path="/requests" element={<Requests />}><Route path=":id" element={<div data-testid="request-page" />} /></Route>
            <Route path="/requests/:id/decide" element={<div data-testid="decide-page" />} />
            <Route path="/my-trips" element={<MyTrips />}><Route path=":id" element={<div data-testid="trip-page" />} /></Route>
            <Route path="/drivers/board" element={<DriversBoard />} />
            <Route path="/tasks" element={<Tasks />}><Route path=":id" element={<div data-testid="task-page" />} /></Route>
            <Route path="/places" element={<Places />}><Route path=":id" element={<div data-testid="place-page" />} /></Route>
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  await settle();
  return t;
}

const where = () => screen.getByTestId("where").textContent;
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

/** What a cell shows: its parts' words with a space between, the screen reader's own words left out. */
function shown(e: Element): string {
  const copy = e.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only").forEach((x) => x.remove());
  const parts = Array.from(copy.childNodes).map((c) => c.textContent ?? "");
  return parts.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

// ---- The rules -----------------------------------------------------------------------------------------------------

describe("lists2Logic (the rules)", () => {
  it("Fuel: an uploaded video without the word Video; a fill without one keeps its pill", () => {
    expect(videoCellWords({ duration_s: 47, bytes: 16 * 1024 * 1024 })).toBe("0:47 · 16 MB");
    expect(videoCellWords({ duration_s: 312, bytes: 38 * 1024 * 1024, interrupted: true, segments: [{}, {}] })).toBe("5:12 · 38 MB · interrupted, 2 pieces");
    expect(videoCellWords({})).toBe("Uploaded");
  });

  it("Vehicles: one status (the line; the pill only for In garage; an older answer keeps the pill)", () => {
    expect(vehicleStatusShown({ status: "Available", availability: "Free" })).toEqual({ pill: null, line: "Free" });
    expect(vehicleStatusShown({ status: "On a task", availability: "On a task · back ~14:30 (live)" })).toEqual({ pill: null, line: "On a task · back ~14:30 (live)" });
    expect(vehicleStatusShown({ status: "In garage", availability: "In garage" })).toEqual({ pill: "In garage", line: null });
    expect(vehicleStatusShown({ status: "Available" })).toEqual({ pill: "Available", line: null });
  });

  it("My trips: the live text's rest, the decision with the pill's verb merged, the reason never twice", () => {
    expect(liveRest({ state: "waiting", text: "Waiting" })).toBe("");
    expect(liveRest({ state: "completed", text: "Completed · 14:20" })).toBe("14:20");
    expect(liveRest({ state: "accepted", text: "Driver accepted · 10:42" })).toBe("10:42");
    expect(liveRest({ state: "waiting", text: "Waiting · its leave time has passed" })).toBe("Its leave time has passed");
    expect(liveRest({ state: "waiting", text: "Changed · waiting for the office" })).toBe("Changed · waiting for the office");
    expect(liveRest({ state: "approved", text: "Sent to the driver" })).toBe("Sent to the driver");
    expect(tripStatusShown("Approved", { state: "approved", text: "Approved" }, ["Approved by Palitha · 10:42"]))
      .toEqual({ rest: "", merged: [{ verb: "Approved", text: " by Palitha · 10:42" }], lines: [] });
    expect(tripStatusShown("Declined", { state: "declined", text: "Declined · no vehicle" }, ["Declined by Palitha · 10:42 · no vehicle"]).rest).toBe("");
    expect(tripStatusShown("On the way", { state: "on_the_way", text: "On the way · 09:30" }, ["Approved by Palitha · 08:42"]))
      .toEqual({ rest: "09:30", merged: [], lines: ["Approved by Palitha · 08:42"] });
    expect(createdTagShown("all")).toBe(true);
    expect(createdTagShown("tasks")).toBe(false);
  });

  it("Requests: the pill only when the filter does not say it", () => {
    expect(requestPillShown("all", "waiting")).toBe(true);
    expect(requestPillShown("waiting", "waiting")).toBe(false);
    expect(requestPillShown("waiting", "changed")).toBe(true);
    expect(requestPillShown("approved", "approved")).toBe(false);
  });

  it("Drivers board: under a Show filter the chip says only what it adds", () => {
    expect(boardStatusShown({ kind: "on_task", text: "On a task until ~15:40" }, "on_task")).toEqual({ kind: "on_task", text: "Until ~15:40" });
    expect(boardStatusShown({ kind: "off_duty", text: "Off duty" }, "off_duty")).toBeUndefined();
    expect(boardStatusShown({ kind: "off_duty", text: "Off duty since 07:40" }, "off_duty")).toEqual({ kind: "off_duty", text: "Since 07:40" });
    expect(boardStatusShown({ kind: "not_available", text: "Not available, back 13:00" }, "not_available")).toEqual({ kind: "not_available", text: "Back 13:00" });
    expect(boardStatusShown({ kind: "on_duty", text: "On duty since 07:12" }, "free_now")).toEqual({ kind: "on_duty", text: "On duty since 07:12" });
    expect(boardStatusShown({ kind: "on_task", text: "On a task until ~15:40" }, "all")).toEqual({ kind: "on_task", text: "On a task until ~15:40" });
  });

  it("Tasks board and Places", () => {
    expect(boardFinishText("Completed · not confirmed", "completed")).toBe("Not confirmed");
    expect(boardFinishText("Completed early", "completed")).toBe("Completed early");
    expect(boardFinishText("Completed · not confirmed", "assigned")).toBe("Completed · not confirmed");
    expect(placeKindShown("ours")).toBe(true);
    expect(placeKindShown("dialog")).toBe(false);
    expect(placeKindShown("removed")).toBe(true);
  });

  it("Requests: the step under the status without the status word", () => {
    expect(requestStepWords({ label: "Approved", at: "x" }, "10:42 by Palitha", "approved")).toBe("10:42 by Palitha");
    expect(requestStepWords({ label: "Approved" }, "", "approved")).toBe("");
    expect(requestStepWords({ label: "Changed · needs re-approval" }, "11:05", "changed")).toBe("Needs re-approval · 11:05");
    expect(requestStepWords({ label: "Seen by the office" }, "10:42", "waiting")).toBe("Seen by the office · 10:42");
    expect(requestStepWords({ label: "Sent" }, "2 h ago", "waiting")).toBe("sent 2 h ago");
    expect(requestStepWords({ label: "Approved" }, "10:42", "approved", true)).toBe("booked directly");
  });
});

// ---- Fuel ----------------------------------------------------------------------------------------------------------

const fuelAdmin: Me = { name: "Sahan", role: "admin", permissions: ["view", "vehicles"], tools: ["list_fuel", "list_vehicles", "list_drivers"] };
const fill = (i: number, video: FuelEntry["video"]): FuelEntry => ({ id: `f${i}`, at: "2026-10-20 09:00", vehicle: "WP CAB-4521", driver: "Kamal", litres: 30, lkr: 9000, video } as FuelEntry);
const FILLS = [
  fill(1, { status: "uploaded", duration_s: 47, bytes: 16 * 1024 * 1024 }),
  fill(2, { status: "none", note: "No video" }),
  ...Array.from({ length: 28 }, (_, i) => fill(i + 3, { status: "recorded", note: "On the phone" })),
];
const fuelAnswers: Record<string, Answer> = {
  list_fuel: (a) => {
    const p = paged(FILLS, a);
    return { month: "2026-10", from: a.from, to: a.to, total: p.total, next: p.next, entries: p.rows, totals: { entries: 30, litres: 900, lkr: 270000, videos: 1, videos_waiting: 28, videos_missing: 1, bytes: 16 * 1024 * 1024 } };
  },
  list_vehicles: () => ({ filter: "all", counts: {}, vehicles: [] }),
  list_drivers: () => ({ drivers: [] }),
};

describe("Fuel (item 8): Video said once", () => {
  it("an uploaded video is its icon with the length and size; the pills of the others stay; every control kept", async () => {
    const t = await mount(fuelAdmin, fuelAnswers, "/fuel?range=week");
    const rows = screen.getAllByTestId("fuel-row");
    expect(rows).toHaveLength(25);
    const video = within(rows[0]).getByTestId("fuel-video-ok");
    expect(shown(video)).toBe("0:47 · 16 MB");
    // The screen reader still hears it; no "Video" pill and no "Video 0:47" line.
    expect(video.textContent).toContain("Video uploaded");
    expect(rows[0].querySelector(".pill")).toBeNull();
    expect(within(rows[1]).getByText("No video")).toBeTruthy();
    expect(within(rows[2]).getByText("On the phone")).toBeTruthy();
    // The date range, the Vehicle / Driver filter, the pages (desktop) and a row opening its fill.
    expect(screen.getByTestId("date-range-button")).toBeTruthy();
    expect(screen.getByTestId("filter-button")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("pager")).getByRole("button", { name: "2" }));
    await settle();
    expect(t.argsOf("list_fuel").at(-1)?.cursor).toBeTruthy();
    expect(screen.getAllByTestId("fuel-row")).toHaveLength(5);
    fireEvent.click(screen.getAllByTestId("fuel-row")[0]);
    expect(where()).toMatch(/^\/fuel\/f26/);
  });
});

// ---- Vehicles ------------------------------------------------------------------------------------------------------

const vehicle = (reg: string, over: Partial<VehicleCard> = {}): VehicleCard => ({
  reg_no: reg, make_model: "Toyota HiAce", seats: 14, status: "Available", availability: "Free", km_this_month: 100, km_allowance: 2500,
  documents: { lic: { chip: "ok", expiry: "2027-03-01" }, ins: { chip: "orange", expiry: "2026-11-05" }, emi: { chip: "red", expiry: "2026-10-01" } },
  ...over,
} as VehicleCard);
const VEHICLES = [
  vehicle("WP CAB-4521", { assigned_to: "Nimal", assigned_to_links: { call: "tel:+94770000001", whatsapp: "https://wa.me/94770000001" } }),
  vehicle("WP KL-1234", { status: "On a task", availability: "On a task · back ~14:30 (live)" }),
  vehicle("WP GA-1111", { status: "In garage", availability: "In garage", in_garage: true }),
  ...Array.from({ length: 27 }, (_, i) => vehicle(`WP V-${1000 + i}`)),
];
const vehicleAdmin: Me = { name: "Sahan", role: "admin", permissions: ["view", "vehicles"], tools: ["list_vehicles", "register_vehicle", "update_vehicle"] };
const vehicleAnswers: Record<string, Answer> = {
  list_vehicles: (a) => {
    const rows = a.search ? VEHICLES.filter((v) => v.reg_no.includes(String(a.search))) : VEHICLES;
    const p = paged(rows, a);
    return { filter: a.filter, counts: { all: 30, on_task: 1, available: 28, in_garage: 1, documents_expiring: 30, inactive: 0 }, total: p.total, next: p.next, vehicles: p.rows };
  },
};

describe("Vehicles (item 8): one status, quiet valid documents", () => {
  it("the availability line is the status; the pill only for In garage; a valid document is quiet; every control kept", async () => {
    const t = await mount(vehicleAdmin, vehicleAnswers, "/vehicles");
    const rows = screen.getAllByTestId("vehicle-row");
    expect(rows).toHaveLength(25);
    // One status.
    expect(within(rows[0]).getByTestId("vehicle-availability").textContent).toBe("Free");
    expect(within(rows[0]).queryByText("Available")).toBeNull();
    expect(within(rows[1]).getByTestId("vehicle-availability").textContent).toBe("On a task · back ~14:30 (live)");
    expect(within(rows[1]).queryByText("On a task", { selector: ".pill" })).toBeNull();
    expect(within(rows[2]).getByText("In garage", { selector: ".pill" })).toBeTruthy();
    expect(within(rows[2]).queryByTestId("vehicle-availability")).toBeNull();
    // The documents: Lic valid and quiet (still said), Ins expiring and Emi expired in colour.
    const ok = within(rows[0]).getByTestId("doc-ok");
    expect(shown(ok)).toBe("Lic");
    expect(ok.textContent).toContain("valid");
    expect(within(rows[0]).getByText("Ins").className).toContain("warn");
    expect(within(rows[0]).getByText("Emi").className).toContain("bad");
    // The row's own links (Call / WhatsApp the custodian) stay and do not open the row.
    expect(within(rows[0]).getByRole("link", { name: "Call" }).getAttribute("href")).toBe("tel:+94770000001");
    expect(within(rows[0]).getByRole("link", { name: "WhatsApp" })).toBeTruthy();
    // Register vehicle, the search, the Filter, the pages, a row opens its vehicle.
    expect(screen.getByRole("link", { name: "Register vehicle" }).getAttribute("href")).toBe("/vehicles/new");
    expect(screen.getByLabelText("Find a vehicle")).toBeTruthy();
    applyFilter("Show", /^In garage/);
    await settle();
    expect(t.argsOf("list_vehicles").at(-1)).toMatchObject({ filter: "in_garage" });
    fireEvent.click(screen.getAllByTestId("vehicle-row")[0]);
    expect(where()).toMatch(/^\/vehicles\/WP%20CAB-4521/);
  });
});

// Round 4–7 (the list audit's proposed removal, approved by Sahan 22 October 2026): three valid documents = one line.
describe("Vehicles: \"Documents valid\" when all three are", () => {
  const valid = { lic: { chip: "ok", expiry: "2027-03-12" }, ins: { chip: "ok", expiry: "2027-04-01" }, emi: { chip: "ok", expiry: "2027-07-05" } };
  const rows = [
    vehicle("WP OK-1", { documents: valid }),
    vehicle("WP OK-2", { documents: valid, documents_missing: ["registration"], documents_missing_text: "1 document missing: CR" }),
    vehicle("WP OK-3", { documents: { lic: valid.lic, ins: valid.ins } }),
    vehicle("WP OK-4"),
  ];
  const answers: Record<string, Answer> = {
    list_vehicles: (a) => ({ filter: a.filter, counts: { all: 4, on_task: 0, available: 4, in_garage: 0, documents_expiring: 1, inactive: 0 }, total: rows.length, vehicles: rows }),
  };

  it("one quiet line with each expiry for the screen reader; expiring, expired, not set or missing keep the chips", async () => {
    await mount(vehicleAdmin, answers, "/vehicles");
    const r = screen.getAllByTestId("vehicle-row");
    const line = within(r[0]).getByTestId("docs-valid");
    expect(shown(line)).toBe("Documents valid");
    expect(line.textContent).toBe(`Documents valid: ${validDocsWords(valid)}`);
    expect(validDocsWords(valid, new Date("2026-10-22T10:00:00+05:30"))).toBe("licence to Fri 12 Mar 2027, insurance to Thu 1 Apr 2027, emission test to Mon 5 Jul 2027");
    expect(line.getAttribute("title")).toBe(`Valid: ${validDocsWords(valid)}`);
    expect(within(r[0]).queryByTestId("doc-ok")).toBeNull();
    expect(within(r[0]).queryByText("Lic")).toBeNull();
    // A missing document: the three chips (quiet ticks) and "no document", as before.
    expect(within(r[1]).queryByTestId("docs-valid")).toBeNull();
    expect(within(r[1]).getAllByTestId("doc-ok").map(shown)).toEqual(["Lic", "Ins", "Emi"]);
    expect(within(r[1]).getByText("no document")).toBeTruthy();
    // One not set: the chips; Emi dashed (not set).
    expect(within(r[2]).queryByTestId("docs-valid")).toBeNull();
    expect(within(r[2]).getByText("Emi").className).toContain("unset");
    // Expiring and expired: the chips in colour.
    expect(within(r[3]).queryByTestId("docs-valid")).toBeNull();
    expect(within(r[3]).getByText("Ins").className).toContain("warn");
    expect(within(r[3]).getByText("Emi").className).toContain("bad");
    // The rule itself.
    expect(docsAllValid({ documents: valid })).toBe(true);
    expect(docsAllValid({ documents: valid, documents_missing: ["lease"] })).toBe(false);
    expect(docsAllValid({ documents: { ...valid, ins: { chip: "orange", expiry: "2026-11-05" } } })).toBe(false);
    expect(docsAllValid({})).toBe(false);
  });
});

// ---- Requests ------------------------------------------------------------------------------------------------------

const req = (n: number, status: RequestCard["status"], over: Partial<RequestCard> = {}): RequestCard => ({
  id: `r${n}`, kind: "request", requested_by: `Asker ${n}`, when: "Mon 19 Oct 08:00", route: "Head office → Kandy", status, version: 1, ...over,
});
const REQUESTS = [req(1, "waiting"), req(2, "changed"), req(3, "approved", { task_id: "t3" }), ...Array.from({ length: 27 }, (_, i) => req(i + 4, "waiting"))];
const approver: Me = { name: "Palitha", role: "admin", permissions: ["view", "request", "approve", "assign_tasks"], tools: ["list_requests", "decide_request", "create_request"] };
const requestAnswers: Record<string, Answer> = {
  list_requests: (a) => {
    const status = String(a.status ?? "waiting");
    const rows = REQUESTS.filter((r) => status === "all" || (status === "waiting" ? r.status === "waiting" || r.status === "changed" : r.status === status))
      .filter((r) => !a.search || r.requested_by.includes(String(a.search)));
    const p = paged(rows, a);
    return { status, count: p.rows.length, total: p.total, next: p.next, requests: p.rows };
  },
};

describe("Requests (item 8): the status pill only when the filter does not say it", () => {
  it("Waiting: no Waiting pill, a Changed one keeps its pill; Review on each; All shows every pill; every control kept", async () => {
    const t = await mount(approver, requestAnswers, "/requests");
    const rows = screen.getAllByTestId("request-row");
    expect(rows).toHaveLength(25);
    expect(within(rows[0]).queryByText("Waiting")).toBeNull();
    expect(within(rows[1]).getByText("Changed")).toBeTruthy();
    expect(within(rows[0]).getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/requests/r1/decide");
    expect(within(rows[1]).getByRole("link", { name: "Review" })).toBeTruthy();
    // New request, the search, the pages.
    expect(screen.getAllByRole("link", { name: "New request" }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Name, project or place")).toBeTruthy();
    expect(within(screen.getByTestId("pager")).getByRole("button", { name: "2" })).toBeTruthy();
    // All: every row's status.
    applyFilter("Status", "All");
    await settle();
    expect(t.argsOf("list_requests").at(-1)).toMatchObject({ status: "all" });
    const all = screen.getAllByTestId("request-row");
    expect(within(all[0]).getByText("Waiting")).toBeTruthy();
    // Approved once: the pill, and the step under it without the word again.
    expect(within(all[2]).getByText("Approved", { selector: ".pill" })).toBeTruthy();
    expect(within(all[2]).queryByTestId("request-step")?.textContent ?? "").not.toMatch(/Approved/);
    // An approved one: Task → (no Review); the row opens the request beside the list.
    expect(within(all[2]).getByRole("link", { name: "Task →" }).getAttribute("href")).toBe("/tasks/t3");
    fireEvent.click(all[0]);
    expect(where()).toMatch(/^\/requests\/r1\?/);
  });
});

// ---- My trips ------------------------------------------------------------------------------------------------------

const CREATED: CreatedTaskCard = {
  source: "task", id: "t7", task_id: "t7", title: "Team drop · Kandy", when: "Mon 19 Oct 08:00", route: "Head office → Kandy site", status: "assigned",
  live: { state: "approved", text: "Sent to the driver" }, created: "2026-10-18 10:42", approved_by: { name: "Palitha", at: "10:40" },
  assigned: { driver: "Ruwan Silva", phone: "+94771112223", call: "tel:+94771112223", whatsapp: "https://wa.me/94771112223", vehicle: "WP CAB-4521" },
};
const RIDING: CreatedTaskCard = { ...CREATED, id: "t8", task_id: "t8", title: "Site visit", role: "passenger", approved_by: undefined };
const APPROVED: RequestCard = {
  id: "r9", requested_by: "Dilini", when: "Sun 18 Oct 09:00", route: "Head office → Galle", status: "approved", version: 1,
  live: { state: "approved", text: "Approved" }, approved_by: { name: "Palitha", at: "08:42", phone: "+94770000001", call: "tel:+94770000001", whatsapp: "https://wa.me/94770000001" },
};
const requester: Me = { name: "Dilini", role: "staff", permissions: ["view", "request", "assign_tasks"], tools: ["my_trips", "list_requests", "create_request"] };
const tripAnswers: Record<string, Answer> = {
  my_trips: (a) => {
    const trips = a.include === "tasks" ? [CREATED, RIDING] : [CREATED, RIDING, APPROVED];
    return { from: a.from, to: a.to, count: trips.length, total: trips.length, trips };
  },
  list_requests: () => ({ status: "all", count: 0, requests: [] }),
};

describe("My trips (item 8): Approved once, the created tag only where it tells apart", () => {
  it("All: [Approved] by Palitha (the verb to the screen reader); Task I created and Passenger tags; Call and the row kept", async () => {
    await mount(requester, tripAnswers, "/my-trips");
    const rows = screen.getAllByTestId("trip-row");
    expect(rows).toHaveLength(3);
    const approved = rows.find((r) => r.textContent?.includes("Galle"))!;
    expect(shown(within(approved).getByTestId("trip-live"))).toBe("Approved by Palitha · 08:42");
    expect(within(approved).getByTestId("trip-decision").textContent).toBe("Approved by Palitha · 08:42");
    expect(within(approved).getByTestId("call-approver")).toBeTruthy();
    const mine = rows.find((r) => r.textContent?.includes("Team drop"))!;
    expect(mine.textContent).toContain("Task I created");
    expect(shown(within(mine).getByTestId("trip-live"))).toBe("Approved by Palitha · 10:40 Sent to the driver");
    expect(within(mine).getByTestId("call-driver")).toBeTruthy();
    const riding = rows.find((r) => r.getAttribute("data-role") === "passenger")!;
    expect(riding.textContent).toContain("Passenger");
    // New request, the Show switch, the date range, the Filter, the search.
    expect(screen.getAllByRole("link", { name: /New request/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Tasks I created" })).toBeTruthy();
    expect(screen.getByTestId("date-range-button")).toBeTruthy();
    expect(screen.getByTestId("filter-button")).toBeTruthy();
    expect(screen.getByPlaceholderText("Place, title, driver or plate")).toBeTruthy();
    // A request opens its page beside the list; a created task its task.
    fireEvent.click(approved);
    expect(where()).toMatch(/^\/my-trips\/r9/);
  });

  it("Tasks I created: no \"Task I created\" on every row (the filter says it); Passenger stays", async () => {
    await mount(requester, tripAnswers, "/my-trips?show=tasks");
    const rows = screen.getAllByTestId("trip-row");
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.textContent?.includes("Task I created"))).toBe(false);
    expect(rows.find((r) => r.getAttribute("data-role") === "passenger")?.textContent).toContain("Passenger");
    fireEvent.click(rows.find((r) => r.getAttribute("data-role") !== "passenger")!);
    expect(where()).toBe("/tasks/t7");
  });
});

// ---- Drivers board -------------------------------------------------------------------------------------------------

const dispatcher: Me = { name: "Palitha", email: "palitha@fame.test", role: "office", permissions: ["view", "approve", "assign_tasks"], tools: ["drivers_board", "ask_drivers", "ask_answers", "create_task", "get_settings"] };
const boardAnswers: Record<string, Answer> = {
  drivers_board: (a) => boardAnswer(!!a.week_from),
  get_settings: () => ({ settings: {}, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
};

describe("Drivers board (item 8): the chip says only what the Show filter does not", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-20T03:00:00Z"), toFake: ["Date"] }));

  it("All: every status whole; On a task: \"Until ~15:40\"; Off duty with no time: no chip; New task, Call, Ask drivers kept", async () => {
    await mount(dispatcher, boardAnswers, "/drivers/board");
    const rows = () => screen.getAllByTestId("board-row");
    expect(rows().map((r) => within(r).queryByTestId("drow-status")?.querySelector(".pill")?.textContent)).toEqual(["On duty since 07:12", "On a task until ~15:40", "Off duty", "Not available, back 13:00"]);
    expect(screen.getAllByRole("link", { name: "New task" })[0].getAttribute("href")).toBe("/tasks/new?driver=kamal.p");
    expect(screen.getByTestId("board-contact").textContent).toContain("077 111 2222");
    expect(screen.getByTestId("board-ask")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Questions" })).toBeTruthy();
    expect(screen.getByLabelText("Find a driver")).toBeTruthy();
    applyFilter("Show", /^On a task/);
    await settle();
    expect(where()).toBe("/drivers/board?filter=on_task");
    expect(rows()).toHaveLength(1);
    const pill = within(rows()[0]).getByTestId("drow-status").querySelector(".pill");
    expect(pill?.textContent).toBe("Until ~15:40");
    expect(pill?.className).toContain("live");
    applyFilter("Show", /^Off duty/);
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector(".drow-status .pill")).toBeNull();
    applyFilter("Show", /^Not available/);
    await settle();
    expect(within(rows()[0]).getByTestId("drow-status").querySelector(".pill")?.textContent).toBe("Back 13:00");
  });
});

// ---- Tasks board ---------------------------------------------------------------------------------------------------

const taskCard = (id: string, over: Partial<BoardCard> = {}): BoardCard => ({ id, time: "09:00", title: `Trip ${id}`, driver: "Kamal", status: "Accepted 08:50", ...over } as BoardCard);
const taskBoard = (args: Args): Board => ({
  date: String(args.date), counts: { assigned: 1, in_progress: 0, completed: 1, cancelled: 0 }, totals: { assigned: 1, in_progress: 0, completed: 1 },
  assigned: [taskCard("t1")], in_progress: [], completed: [taskCard("t2", { status: "Done 11:40 · 42 km logged", finish_flag: { kind: "not_confirmed", text: "Closed at 09:00 the next day without the odometer" } })],
} as Board);
const taskPerson: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_board", "create_task", "list_tasks"] };

describe("Tasks board (item 8): Completed is not said again on its cards", () => {
  it("\"Not confirmed\" in the Completed column; the sentence keeps its time; Assign a task, History and a card opening kept", async () => {
    await mount(taskPerson, { task_board: taskBoard }, "/tasks");
    const done = screen.getByTestId("board-col-completed");
    expect(within(done).getByTestId("card-finish-flag").textContent).toBe("Not confirmed");
    expect(within(done).getByTestId("card-finish-flag").getAttribute("title")).toBe("Closed at 09:00 the next day without the odometer");
    expect(within(done).getByText("Done 11:40 · 42 km logged")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Assign a task/ }).getAttribute("href")).toBe("/tasks/new");
    expect(screen.getByRole("link", { name: "History" }).getAttribute("href")).toBe("/tasks/history");
    expect(screen.getByTestId("board-day")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("board-col-assigned")).getByText("Trip t1"));
    expect(where()).toBe("/tasks/t1");
    expect(today()).toBeTruthy();
  });
});

// ---- Places --------------------------------------------------------------------------------------------------------

const placeAdmin: Me = { name: "Sahan", role: "admin", permissions: ["view", "vehicles"], tools: ["list_places", "restore_place", "update_place"] };
const placeAnswers: Record<string, Answer> = {
  list_places: (a) => {
    const rows: Record<string, unknown>[] = a.removed
      ? [{ id: "p9", name: "Old store", kind: "store", removed: "2026-10-01 10:00 by Sahan" }]
      : a.operator === "dialog"
        ? [{ id: "p2", name: "Dialog Kandy", kind: "site", operator: "dialog", site_id: "DK001", district: "Kandy", pinned: true }]
        : [{ id: "p1", name: "Head office", kind: "office", district: "Colombo", pinned: true }, { id: "p3", name: "Store", kind: "store", pinned: false }];
    const p = paged(rows, a);
    return { count: p.rows.length, total: p.total, next: p.next, places: p.rows };
  },
  restore_place: () => ({ restored: true }),
};

describe("Places (item 8): no Kind column where every row says the filter", () => {
  it("Our places: the Kind column; Dialog sites: none; Removed: Restore; the search, the Filter and a row opening kept", async () => {
    const t = await mount(placeAdmin, placeAnswers, "/places");
    const table = () => screen.getByTestId("places-table");
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Place", "Kind", "Site id", "District", "Pin"]);
    expect(within(table()).getByText("Office")).toBeTruthy();
    expect(within(table()).getByText("no pin")).toBeTruthy();
    expect(screen.getByLabelText("Find a place")).toBeTruthy();
    applyFilter("Places", "Dialog sites");
    await settle();
    expect(t.argsOf("list_places").at(-1)).toMatchObject({ operator: "dialog" });
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Place", "Site id", "District", "Pin"]);
    expect(within(table()).queryByText("Site · Dialog")).toBeNull();
    fireEvent.click(screen.getAllByTestId("place-row")[0]);
    expect(where()).toMatch(/^\/places\/p2/);
    applyFilter("Places", "Removed places");
    await settle();
    expect(within(table()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Place", "Kind", "Site id", "Removed", ""]);
    fireEvent.click(within(table()).getByRole("button", { name: "Restore" }));
    await settle();
    expect(t.argsOf("restore_place")).toEqual([{ id: "p9" }]);
  });
});
