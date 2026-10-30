// Fix B (29 October 2026): From / To / Add stop, Uber's and Google Maps' route form, on the site's trip forms. A new trip
// opens with From (the base place) and one To and no type picker; + Add stop puts a short stop before To; the types follow
// the rows' places (short stops between; To a visit with "Wait there" on the row while the trip goes back to the office, the
// drop-off one-way; 30 October 2026) until ⋯ Options chooses one; the rows with nothing in them go on Send, a row with data
// but no place and an empty To are named; rows move by Move up / Move down and by the drag handle; Then back to the office
// is on until switched off; and every field and option of the inventory (docs/phase8-plan.md §38.2) is still on the form.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { NewRequest } from "./NewRequest";
import { NewTask } from "./NewTask";
import { draftKey, writeDraft } from "../data/drafts";
import { emptyRequest } from "./requestLogic";
import { newStop, type StopDraft } from "./stopsLogic";
import { TripEditor, useTrip } from "./TripEditor";
import { emptyTrip, type TripFields, tripPlanInput } from "./tripLogic";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const requester: Me = { name: "Dilini Jayasinghe", role: "staff", permissions: ["view", "request"], tools: ["get_settings", "create_request", "list_requests", "plan_task"] };
const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks", "approve"], tools: ["get_settings", "list_drivers", "list_vehicles", "list_places", "create_task", "plan_task", "update_place"] };
const BASE = { id: "p-base", name: "Head office" };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, unknown>, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (!(tool in this.answers)) return Promise.reject({ code: "not_found", message: tool });
    return Promise.resolve(structuredClone(this.answers[tool]) as T);
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
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

const settings = { settings: { dwell_min: {}, self_drive_allowed: true }, defaults: {}, about: {}, base_place: { ...BASE, has_pin: true }, routing_provider: "estimate" };

function mount(t: FakeTransport, me: Me, url: string) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/tasks/new" element={<NewTask />} />
            <Route path="/tasks/:id" element={<p data-testid="task-page">task</p>} />
            <Route path="/requests/new" element={<NewRequest />} />
            <Route path="/requests" element={<p data-testid="requests">requests</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

async function newRequest() {
  const t = new FakeTransport({ get_settings: settings, create_request: { request: { id: "r1" }, next: "Sent to the fleet admin · you'll be notified." } }, requester);
  mount(t, requester, "/requests/new");
  await settle();
  return t;
}

const rows = () => screen.getAllByTestId("stop-row");
const captions = () => screen.getAllByTestId("stop-label").map((c) => c.textContent);
/** Each row's place, in the order of the rows (the place box is the row's first field). */
const places = () => rows().map((r) => (r.querySelector("input") as HTMLInputElement).value);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const addStop = () => fireEvent.click(screen.getByRole("button", { name: "Add stop" }));
function leaveBy(time: string) {
  const leave = screen.getByLabelText("Leave by", { exact: true });
  fireEvent.change(leave, { target: { value: time } });
  fireEvent.blur(leave);
}
const options = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Options for ${name}` }));
const sheet = () => screen.getByRole("dialog");
const done = () => fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
async function send() {
  fireEvent.click(screen.getByRole("button", { name: "Save request" }));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T08:00:00+05:30"));
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("the route card: From / To / Add stop (Fix B)", () => {
  it("a new trip shows From (the base place) and one To, with no type picker on the form", async () => {
    await newRequest();
    expect((screen.getByLabelText("From", { exact: true }) as HTMLInputElement).placeholder).toBe("Head office · the base place");
    expect(rows()).toHaveLength(1);
    expect(screen.getByLabelText("To", { exact: true })).toBeTruthy();
    expect(captions()).toEqual(["Stop 1 · Visit · wait"]);
    expect(screen.getByTestId("stops-editor").querySelectorAll("select")).toHaveLength(0);
    // One row: nothing to remove or drag.
    expect(screen.queryByRole("button", { name: "Remove To" })).toBeNull();
    expect(screen.queryByTestId("stop-grip")).toBeNull();
  });

  it("+ Add stop puts a row between From and To and opens its search box", async () => {
    await newRequest();
    addStop();
    expect(rows()).toHaveLength(2);
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Visit · wait"]);
    expect(document.activeElement).toBe(screen.getByLabelText("Stop 1", { exact: true }));
    expect(within(rows()[1]).getByLabelText("To", { exact: true })).toBeTruthy();
    addStop();
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Short stop · 5 min", "Stop 3 · Visit · wait"]);
    expect(document.activeElement).toBe(screen.getByLabelText("Stop 2", { exact: true }));
  });

  it("the types follow the rows' places to the server: short stops (drop-offs) in the middle, a visit at To going back (plan_task and create_request)", async () => {
    const t = await newRequest();
    addStop();
    type("Stop 1", "Kalutara");
    type("To", "Galle");
    leaveBy("09:30");
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Visit · wait"]);
    await settle(1600);
    expect(t.argsOf("plan_task").at(-1)).toMatchObject({ stops: [{ type: "drop", place: "Kalutara" }, { type: "visit", place: "Galle" }], return_to_base: true });
    await send();
    expect(t.argsOf("create_request")[0]).toMatchObject({ stops: [{ type: "drop", place: "Kalutara" }, { type: "visit", place: "Galle" }], return_to_base: true });
  });

  it("To shows Wait there while the trip goes back to the office: its stay is sent; one-way, To is the drop-off with no wait field", async () => {
    const t = await newRequest();
    type("To", "Galle");
    leaveBy("09:30");
    const wait = screen.getByTestId("to-wait");
    expect(within(wait).getByText("Wait there")).toBeTruthy();
    fireEvent.click(within(wait).getByRole("button", { name: "Wait there" }));
    fireEvent.click(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: "30 min" }));
    expect(within(screen.getByTestId("to-wait")).getByRole("button", { name: "Wait there" }).textContent).toBe("30 min");
    await settle(1600);
    expect(t.argsOf("plan_task").at(-1)).toMatchObject({ stops: [{ type: "visit", place: "Galle", dwell_min: 30 }], return_to_base: true });
    // One-way: To is the drop-off, the wait field and its stay go.
    fireEvent.click(screen.getByRole("switch", { name: "Then back to the office" }));
    expect(screen.queryByTestId("to-wait")).toBeNull();
    expect(captions()).toEqual(["Stop 1 · Drop-off"]);
    await send();
    expect(t.argsOf("create_request")[0].stops).toEqual([{ type: "drop", place: "Galle" }]);
    expect(t.argsOf("create_request")[0]).not.toHaveProperty("return_to_base");
  });

  it("the inferred types reach create_task too (Assign a task)", async () => {
    const t = new FakeTransport({
      get_settings: settings,
      list_drivers: { drivers: [] },
      list_vehicles: { vehicles: [{ reg_no: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_type: "van", seats: 12, status: "Available", active: true }] },
      list_places: { places: [] },
      create_task: { task_id: "t1", leave_by: "2026-10-29 09:30", vehicle: "WP CAB-4521" },
    }, dispatcher);
    mount(t, dispatcher, "/tasks/new");
    await settle();
    type("Task", "Team drop");
    leaveBy("09:30");
    addStop();
    type("Stop 1", "Kalutara");
    type("To", "Galle");
    fireEvent.click(screen.getByRole("button", { name: "Someone else" }));
    type("Their name", "Nimal Silva");
    type("Their phone", "077 123 4567");
    fireEvent.change(screen.getByLabelText("Vehicle", { exact: true }), { target: { value: "WP CAB-4521" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the task" }));
    await settle();
    expect(t.argsOf("create_task")[0]).toMatchObject({ stops: [{ type: "drop", place: "Kalutara" }, { type: "visit", place: "Galle" }], return_to_base: true });
  });

  it("⋯ Options changes what happens there: People get in = a pickup of people, shown on the row and sent", async () => {
    const t = await newRequest();
    addStop();
    type("Stop 1", "Kalutara");
    type("To", "Galle");
    leaveBy("09:30");
    options("Stop 1");
    const chips = within(sheet()).getByRole("group", { name: "What happens there" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Short stop", "People get in", "People get out", "Visit · wait", "Goods"]);
    expect(within(chips).getByRole("button", { name: "Short stop" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(chips).getByRole("button", { name: "People get in" }));
    done();
    expect(captions()).toEqual(["Stop 1 · People get in", "Stop 2 · Visit · wait"]);
    expect(screen.queryByTestId("stop-summary")).toBeNull();
    // To's own words: its short stop is the drop-off.
    options("To");
    expect(within(within(sheet()).getByRole("group", { name: "What happens there" })).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Drop-off", "People get in", "People get out", "Visit · wait", "Goods"]);
    done();
    await send();
    expect(t.argsOf("create_request")[0]).toMatchObject({ stops: [{ type: "pickup", what: "people", place: "Kalutara" }, { type: "visit", place: "Galle" }] });
  });

  it("⋯ Options makes a short stop a longer visit with its stay", async () => {
    const t = await newRequest();
    addStop();
    type("Stop 1", "Kalutara");
    type("To", "Galle");
    leaveBy("09:30");
    options("Stop 1");
    fireEvent.click(within(within(sheet()).getByRole("group", { name: "What happens there" })).getByRole("button", { name: "Visit · wait" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: "Stay" }));
    fireEvent.click(within(screen.getByTestId("stay-sheet")).getByRole("button", { name: "2 h" }));
    done();
    expect(captions()).toEqual(["Stop 1 · Visit · wait", "Stop 2 · Visit · wait"]);
    expect(screen.getByTestId("stop-summary").textContent).toBe("Stay 2 h");
    await send();
    expect(t.argsOf("create_request")[0]).toMatchObject({ stops: [{ type: "visit", place: "Kalutara", dwell_min: 120 }, { type: "visit", place: "Galle" }] });
  });

  it("the rows with no place go on Send once To has one", async () => {
    const t = await newRequest();
    addStop();
    addStop();
    type("To", "Galle");
    leaveBy("09:30");
    await send();
    expect(t.argsOf("create_request")[0].stops).toEqual([{ type: "visit", place: "Galle" }]);
  });

  it("a row with an arrive-by but no place stays on Send and is named; nothing is sent", async () => {
    const t = await newRequest();
    addStop();
    type("To", "Galle");
    leaveBy("09:00");
    options("Stop 1");
    const by = within(sheet()).getByLabelText("Arrive by");
    fireEvent.change(by, { target: { value: "10:00" } });
    fireEvent.blur(by);
    done();
    await send();
    const said = screen.getAllByText("Stop 1: add a place name (a saved place, a town, or an address) or a pin.");
    expect(said.some((el) => el.closest(".notice.bad"))).toBe(true);
    expect(t.argsOf("create_request")).toHaveLength(0);
    expect(rows()).toHaveLength(2);
  });

  it("an empty To is named on Send and nothing is sent", async () => {
    const t = await newRequest();
    addStop();
    type("Stop 1", "Kalutara");
    leaveBy("09:30");
    await send();
    // Said by the form (and by the plan's line, which says what is missing too).
    const said = screen.getAllByText("Stop 2: add a place name (a saved place, a town, or an address) or a pin.");
    expect(said.some((el) => el.closest(".notice.bad"))).toBe(true);
    expect(t.argsOf("create_request")).toHaveLength(0);
    expect(rows()).toHaveLength(2);
  });

  it("rows move with Move up / Move down in ⋯ Options and by the drag handle; a row without a chosen type takes its new place's", async () => {
    await newRequest();
    addStop();
    addStop();
    type("Stop 1", "A");
    type("Stop 2", "B");
    type("To", "C");
    options("Stop 2");
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move up" }));
    expect(places()).toEqual(["B", "A", "C"]);
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Short stop · 5 min", "Stop 3 · Visit · wait"]);
    done();
    options("To");
    expect((within(sheet()).getByRole("button", { name: "Move down" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet()).getByRole("button", { name: "Move up" }));
    expect(places()).toEqual(["B", "C", "A"]);
    // C, To before, is a short stop now; A, the new To, waits there.
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Short stop · 5 min", "Stop 3 · Visit · wait"]);
    done();
    // Drag the first row's handle onto the last row.
    const grips = screen.getAllByTestId("stop-grip");
    fireEvent.dragStart(grips[0]);
    fireEvent.dragOver(rows()[2]);
    fireEvent.drop(rows()[2]);
    expect(places()).toEqual(["C", "A", "B"]);
    expect(captions()).toEqual(["Stop 1 · Short stop · 5 min", "Stop 2 · Short stop · 5 min", "Stop 3 · Visit · wait"]);
  });

  it("✕ on To makes the row before it To", async () => {
    await newRequest();
    addStop();
    type("Stop 1", "Kalutara");
    type("To", "Galle");
    fireEvent.click(screen.getByRole("button", { name: "Remove To" }));
    expect(captions()).toEqual(["Stop 1 · Visit · wait"]);
    expect((screen.getByLabelText("To", { exact: true }) as HTMLInputElement).value).toBe("Kalutara");
  });

  it("an older draft (an empty pickup, then the drop-off) opens without its empty row, the drop-off as To", async () => {
    // Saved before Fix B: its rows carry no typeSet (their types were picked on the form), so the drop-off stays one.
    const old = { ...emptyRequest("2026-10-29"), stops: [{ ...newStop("pickup"), typeSet: undefined }, { ...newStop("drop"), place: "Galle", typeSet: undefined }], vehicle: "", pickedDriver: "" };
    writeDraft(draftKey("artifact", "request-trip-new", null), old);
    await newRequest();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(captions()).toEqual(["Stop 1 · Drop-off"]);
    expect(screen.queryByTestId("to-wait")).toBeNull();
    expect((screen.getByLabelText("To", { exact: true }) as HTMLInputElement).value).toBe("Galle");
  });

  it("Then back to the office is on for a new trip; its switch turns it off", async () => {
    const t = await newRequest();
    type("To", "Galle");
    leaveBy("09:30");
    const back = screen.getByRole("switch", { name: "Then back to the office" }) as HTMLInputElement;
    expect(back.checked).toBe(true);
    fireEvent.click(back);
    expect(back.checked).toBe(false);
    await send();
    expect(t.argsOf("create_request")[0]).not.toHaveProperty("return_to_base");
  });
});

// The trip editor alone, with rows given (a draft, a request): what sits under the rows.
function Harness({ initial }: { initial: TripFields }) {
  const [f, setF] = useState(initial);
  const trip = useTrip(f, setF, { base: BASE, planInput: tripPlanInput(f, BASE) });
  return <TripEditor trip={trip} prefix="t" />;
}
async function harness(stops: StopDraft[]) {
  const t = new FakeTransport({}, dispatcher);
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: dispatcher, noConnector: false }}>
      <MemoryRouter><Harness initial={{ ...emptyTrip("2026-10-29"), stops }} /></MemoryRouter>
    </FleetProvider>,
  );
  await settle();
}

describe("the route card keeps every field and option (the inventory, §38.2)", () => {
  it("From's ⋯ Options: Leave from here / People get in / Goods, and with people the note at the start, what gets in and the stay", async () => {
    await newRequest();
    options("From");
    const chips = within(sheet()).getByRole("group", { name: "What happens there" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Leave from here", "People get in", "Goods"]);
    expect(within(chips).getByRole("button", { name: "Leave from here" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sheet()).queryByLabelText("Note at the start")).toBeNull();
    fireEvent.click(within(chips).getByRole("button", { name: "People get in" }));
    for (const label of ["What gets in", "Note at the start"]) expect(within(sheet()).getByLabelText(label)).toBeTruthy();
    expect(within(sheet()).getByTestId("dwell-picker")).toBeTruthy();
    done();
    expect(screen.getByTestId("start-stop").textContent).toContain("Stop 1 · Pickup · Head office");
    expect(captions()).toEqual(["Stop 2 · Visit · wait"]);
  });

  it("a stop's ⋯ Options: what happens there, Stay, Arrive by, More details (what carried, pin, note), Move up / down; the row says what is set", async () => {
    await newRequest();
    addStop();
    options("Stop 1");
    expect(within(sheet()).getByTestId("dwell-picker")).toBeTruthy();
    const by = within(sheet()).getByLabelText("Arrive by");
    fireEvent.change(by, { target: { value: "09:30" } });
    fireEvent.blur(by);
    fireEvent.click(within(sheet()).getByRole("button", { name: "More details: what carried, pin, note" }));
    for (const label of ["What carried", "Pin (lat, lng)", "Note for the driver"]) expect(within(sheet()).getByLabelText(label)).toBeTruthy();
    expect(within(within(sheet()).getByLabelText("What carried")).getAllByRole("option").map((o) => o.textContent)).toEqual(["—", "People", "Goods", "Documents", "Other"]);
    fireEvent.change(within(sheet()).getByLabelText("Note for the driver"), { target: { value: "Gate 2" } });
    for (const name of ["Move up", "Move down"]) expect(within(sheet()).getByRole("button", { name })).toBeTruthy();
    done();
    expect(screen.getByTestId("stop-summary").textContent).toBe("Arrive by 09:30 · Note for the driver");
    // The rest of the form: the row's ✕ and handle, + Add stop, the two switches, the day and the times.
    for (const name of ["Remove Stop 1", "Remove To", "Add stop", "Options for From", "Options for Stop 1", "Options for To"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getAllByTestId("stop-grip")).toHaveLength(2);
    for (const label of ["Day", "Leave by", "Back by", "From", "Then back to the office", "No expressway", "Wait there"]) expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("under the rows: the Google note, the no-pin warning with the place page, Same as the start · Tick it", async () => {
    await harness([
      { ...newStop("pickup"), typeSet: true, place: "Head office", placeId: BASE.id, picked: true },
      { ...newStop("visit"), place: "Unpinned site", placeId: "p-site", placePinned: false, picked: true },
      { ...newStop("drop"), place: "Galle Fort", googlePlaceId: "g1", picked: true },
    ]);
    expect(screen.getByTestId("google-stop").textContent).toBe("Google place: its pin is Google's, kept 30 days");
    expect(within(screen.getByTestId("no-pin-warning")).getByRole("link", { name: "set it on the place page" }).getAttribute("href")).toBe("/places/p-site");
    expect(screen.getByTestId("same-as-start")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tick it" }));
    // The pickup at the start goes; From becomes Stop 1 (people get in there).
    expect(screen.getByTestId("start-stop").textContent).toContain("Stop 1 · Pickup · Head office");
    expect(captions()).toEqual(["Stop 2 · Short stop · 5 min", "Stop 3 · Visit · wait"]);
  });
});
