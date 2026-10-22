// Round 4–7, feature 6 (phase8-plan.md §33.3) on the site: the rules (passengersLogic: passenger_list, the names on an
// edit, "Asha, Kamal +3"), the Passengers field (find_people with the photo and label, chips with ✕, someone without an
// account with a Sri Lankan phone), Change the task sending the names alone, the switch off hiding the field, the task page's
// passengers (Share trip for someone without an account), and My trips' trips the person rides in (the Passenger tag, the
// view-only page: the time, the stops, the driver with Call, the plate).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { CreatedTaskCard, FoundPeople, MyTrips as MyTripsData, PassengerTrip, TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { PassengersField } from "../ui/PassengersField";
import { ToastProvider } from "../ui/Toast";
import { validateAssign, emptyAssign } from "./assignLogic";
import { MyTripOrRequest } from "./MyTripPage";
import { MyTrips } from "./MyTrips";
import {
  addRider, countWithNames, passengerList, passengersOn, type Rider, riderKey, ridersEdit, ridersFrom, ridersLine, sameRiders, typedRider,
} from "./passengersLogic";
import { emptyRequest, updateRequestInput, validateNewRequest } from "./requestLogic";
import { newStop } from "./stopsLogic";
import { TaskDetail } from "./TaskDetail";
import { TaskEdit, updateTaskInput } from "./TaskEdit";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Answer = (args: Record<string, unknown>) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
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

function mount(t: FakeTransport, me: Me, ui: ReactNode, url = "/") {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks", "request"], tools: ["task_detail", "update_task", "find_people", "my_trips", "my_trip", "create_request"] };
const asha: Rider = { person: "e1", name: "Asha Fernando", label: "Office", photo_url: "https://x/asha.jpg" };

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("the rules (passengersLogic)", () => {
  it("someone without an account: a name, an optional Sri Lankan phone kept as +94…", () => {
    expect(typedRider("  ", "")).toEqual({ error: "name" });
    expect(typedRider("Ruwan", "12")).toEqual({ error: "phone" });
    expect(typedRider(" Ruwan  Silva ", "077 123 4567")).toEqual({ rider: { name: "Ruwan Silva", phone: "+94771234567" } });
    expect(typedRider("Ruwan", "")).toEqual({ rider: { name: "Ruwan" } });
  });
  it("never the same person twice; passenger_list as the tools take it; back from an answer", () => {
    const list = addRider(addRider([asha], asha), { name: "Ruwan", phone: "+94771234567" });
    expect(list).toHaveLength(2);
    expect(addRider(list, { name: "ruwan", phone: "0771234567" })).toHaveLength(2);
    expect(passengerList(list)).toEqual([{ person: "e1" }, { name: "Ruwan", phone: "+94771234567" }]);
    const back = ridersFrom([{ name: "Asha Fernando", registered: true, employee_id: "e1" }, { name: "Ruwan", registered: false, phone: "+94771234567" }]);
    expect(sameRiders(back, list)).toBe(true);
    expect(riderKey(back[0])).toBe("p:e1");
  });
  it("an edit: the names alone go with the ids only; with other changes the count as it was goes too", () => {
    const ids = ["task_id", "plan_version"];
    const base = { task_id: "t1", plan_version: 3 };
    expect(ridersEdit(base, [asha], [], { key: "passengers", was: 5 }, ids)).toEqual({ ...base, passenger_list: [{ person: "e1" }] });
    expect(ridersEdit({ ...base, title: "New" }, [asha], [], { key: "passengers", was: 5 }, ids)).toEqual({ ...base, title: "New", passenger_list: [{ person: "e1" }], passengers: 5 });
    expect(ridersEdit(base, [asha], [asha], { key: "passengers", was: 5 }, ids)).toEqual(base);
    expect(ridersEdit(base, undefined, [asha], { key: "passengers", was: 5 }, ids)).toEqual(base);
    expect(ridersEdit(base, [], [asha], { key: "passengers", was: 5 }, ids)).toEqual({ ...base, passenger_list: [] });
  });
  it("the count never under the names; Asha, Kamal +3", () => {
    expect(countWithNames(5, 2)).toBe(5);
    expect(countWithNames(1, 3)).toBe(3);
    expect(countWithNames(null, 0)).toBeNull();
    expect(ridersLine(["Asha", "Kamal"], 5)).toBe("Asha, Kamal +3");
    expect(ridersLine(["Asha", "Kamal", "Nimal"], 2)).toBe("Asha, Kamal +1");
    expect(ridersLine(["Asha"], null)).toBe("Asha");
    expect(ridersLine([], 4)).toBe("");
  });
  it("the forms' calls carry passenger_list; an edit of the names alone sends nothing else", () => {
    expect(passengersOn(undefined)).toBe(true);
    expect(passengersOn({ settings: { passengers: false } as never })).toBe(false);
    const req = { ...emptyRequest("2026-10-23"), leaveBy: "08:00", stops: [{ ...newStop("drop"), place: "Kandy" }], pax: "5", riders: [asha] };
    const v = validateNewRequest(req as never);
    expect("input" in v && v.input.passenger_list).toEqual([{ person: "e1" }]);
    expect("input" in v && v.input.pax).toBe(5);
    const was = { ...req, riders: [] };
    expect(updateRequestInput("r1", 4, req as never, was as never)).toEqual({ input: { request_id: "r1", version: 4, passenger_list: [{ person: "e1" }] } });
    const task = { ...emptyAssign("2026-10-23"), title: "Team drop", driver: "kamal", vehicle: "WP CAB-4521", leaveBy: "08:00", stops: [{ ...newStop("drop"), place: "Kandy" }], riders: [{ name: "Ruwan", phone: "+94771234567" }] };
    const a = validateAssign(task as never, []);
    expect("input" in a && a.input.passenger_list).toEqual([{ name: "Ruwan", phone: "+94771234567" }]);
    const t = { title: "Team drop", passengers: 5, passengers_list: [{ name: "Asha Fernando", registered: true, employee_id: "e1" }] };
    expect(updateTaskInput("t1", 3, { driver: "", vehicle: "", date: "", time: "", end: "", title: "Team drop", passengers: "5", contactName: "", contactPhone: "", notes: "", reason: "", riders: [] }, t)).toEqual({ input: { task_id: "t1", plan_version: 3, passenger_list: [] } });
  });
});

function Harness({ initial = [] as Rider[] }) {
  const [riders, setRiders] = useState<Rider[]>(initial);
  return <><PassengersField id="t" value={riders} onChange={setRiders} count="5" /><output data-testid="riders" data-value={JSON.stringify(riders)} /></>;
}

const PEOPLE: FoundPeople = { count: 2, people: [{ id: "e1", name: "Asha Fernando", label: "Office", photo_url: "https://x/asha.jpg" }, { id: "e2", name: "Ashan Perera", label: "Fleet admin" }] };

describe("the Passengers field", () => {
  it("searches the office people, picks one as a chip with its photo, takes it off with ✕", async () => {
    const t = new FakeTransport({ find_people: () => PEOPLE }, dispatcher);
    mount(t, dispatcher, <Harness />);
    fireEvent.change(screen.getByLabelText("Search people by name"), { target: { value: "Ash" } });
    const rows = await screen.findAllByTestId("people-row");
    expect(t.argsOf("find_people")).toEqual([{ text: "Ash" }]);
    expect(rows[0].textContent).toContain("Asha FernandoOffice");
    expect(rows[1].textContent).toContain("Ashan PereraFleet admin");
    expect(rows[0].querySelector("img")?.getAttribute("src")).toBe("https://x/asha.jpg");
    fireEvent.click(rows[0]);
    const chip = screen.getByTestId("passenger-chip");
    expect(chip.textContent).toContain("Asha Fernando");
    expect(JSON.parse(screen.getByTestId("riders").getAttribute("data-value")!)).toEqual([{ person: "e1", name: "Asha Fernando", label: "Office", photo_url: "https://x/asha.jpg" }]);
    expect(screen.getByTestId("passengers-line").textContent).toBe("Asha Fernando +4");
    fireEvent.click(screen.getByRole("button", { name: "Remove Asha Fernando" }));
    expect(screen.queryByTestId("passenger-chip")).toBeNull();
  });

  it("adds someone without an account: the name needed, a Sri Lankan phone or none", () => {
    const t = new FakeTransport({}, dispatcher);
    mount(t, dispatcher, <Harness />);
    fireEvent.click(screen.getByTestId("add-typed"));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Type the name.");
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Ruwan" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Type a Sri Lankan number, e.g. 077 123 4567.");
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "077 123 4567" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("passenger-chip").textContent).toContain("Ruwan 077 123 4567");
    expect(JSON.parse(screen.getByTestId("riders").getAttribute("data-value")!)).toEqual([{ name: "Ruwan", phone: "+94771234567" }]);
  });
});

const editTask: TaskDetailData = {
  task: { id: "t1", title: "Team drop · Kandy", status: "assigned", start: "Fri 23 Oct 08:00", date: "2026-10-23", time: "08:00", driver: "Kamal Perera", vehicle: "WP CAB-4521 · Toyota HiAce", passengers: 5, plan_version: 3, passengers_list: [{ name: "Asha Fernando", registered: true, employee_id: "e1", photo_url: "https://x/asha.jpg" }] },
  stops: [],
  projects: "Fame internal",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};

describe("Change the task: Who rides", () => {
  it("starts from the task's names; the names alone go as task_id, plan_version and passenger_list", async () => {
    const t = new FakeTransport({ task_detail: () => editTask, find_people: () => PEOPLE, update_task: () => ({ task_id: "t1" }) }, dispatcher);
    mount(t, dispatcher, <Routes><Route path="/tasks/:id/edit" element={<TaskEdit />} /><Route path="*" element={null} /></Routes>, "/tasks/t1/edit");
    const chip = await screen.findByTestId("passenger-chip");
    expect(chip.textContent).toContain("Asha Fernando");
    fireEvent.click(screen.getByTestId("add-typed"));
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Ruwan" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "0771234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.argsOf("update_task")).toEqual([{ task_id: "t1", plan_version: 3, passenger_list: [{ person: "e1" }, { name: "Ruwan", phone: "+94771234567" }] }]));
  });

  it("with the passengers switch off the field is not there", async () => {
    const t = new FakeTransport({
      task_detail: () => editTask,
      get_settings: () => ({ settings: { dwell_min: {}, passengers: false }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    }, { ...dispatcher, tools: [...dispatcher.tools, "get_settings"] });
    mount(t, { ...dispatcher, tools: [...dispatcher.tools, "get_settings"] }, <Routes><Route path="/tasks/:id/edit" element={<TaskEdit />} /></Routes>, "/tasks/t1/edit");
    await screen.findByLabelText("Title");
    await waitFor(() => expect(t.argsOf("get_settings").length).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("passengers-field")).toBeNull();
  });
});

describe("the task page: who rides", () => {
  it("the count with the names, a registered person's photo row, someone without an account with Call and Share trip", async () => {
    const detail: TaskDetailData = {
      ...editTask,
      task: {
        ...editTask.task,
        passengers_list: [
          { name: "Asha Fernando", registered: true, employee_id: "e1", photo_url: "https://x/asha.jpg" },
          { name: "Ruwan", registered: false, phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", share: "https://wa.me/94771234567?text=Hi%20Ruwan" },
        ],
      },
    };
    const t = new FakeTransport({ task_detail: () => detail }, dispatcher);
    mount(t, dispatcher, <Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes>, "/tasks/t1");
    const box = await screen.findByTestId("task-passengers");
    expect(box.textContent).toContain("5 · Asha Fernando, Ruwan +3");
    const rows = within(box).getAllByTestId("passenger-row");
    expect(rows[0].getAttribute("data-registered")).toBe("yes");
    expect(within(rows[0]).queryByTestId("share-trip")).toBeNull();
    expect(rows[1].getAttribute("data-registered")).toBe("no");
    expect(within(rows[1]).getByTestId("share-trip").getAttribute("href")).toBe("https://wa.me/94771234567?text=Hi%20Ruwan");
    expect(within(rows[1]).getByTestId("call-passenger")).toBeTruthy();
  });
});

describe("My trips: a trip the person rides in", () => {
  const RIDE: CreatedTaskCard = {
    source: "task", role: "passenger", id: "t9", task_id: "t9", title: "Site visit · Kandy", when: "Fri 23 Oct 08:00", route: "Head office → Kandy site",
    status: "in_progress", live: { state: "on_the_way", text: "On the way · 08:10" }, created: "2026-10-22 10:00",
    assigned: { driver: "Kamal Perera", phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", vehicle: "WP CAB-4521" },
  };
  const VIEW: PassengerTrip = {
    viewer: "passenger", task_id: "t9", title: "Site visit · Kandy", date: "2026-10-23", leave_at: "08:00", back_by: "17:00", status: "in_progress",
    live_text: "On the way · 08:10", driver: "Kamal Perera", driver_phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567",
    vehicle: "WP CAB-4521",
    stops: [{ n: 1, type: "pickup", place: "Head office", status: "done", arrived: "08:05" }, { n: 2, type: "drop", place: "Kandy site", status: "pending", planned: "10:30" }],
    seen_at: "09:12",
  };

  it("is tagged Passenger and opens its view-only page: the time, where it is, the driver with Call, the plate, the stops", async () => {
    const t = new FakeTransport({
      my_trips: (a) => ({ from: String(a.from), to: String(a.to), count: 1, total: 1, trips: [RIDE] } satisfies MyTripsData),
      my_trip: () => VIEW,
    }, dispatcher);
    mount(t, dispatcher, <Routes><Route path="/my-trips" element={<MyTrips />}><Route path=":id" element={<MyTripOrRequest />} /></Route></Routes>, "/my-trips");
    const row = await screen.findByTestId("trip-row");
    expect(row.getAttribute("data-role")).toBe("passenger");
    expect(within(row).getByText("Passenger")).toBeTruthy();
    expect(within(row).queryByText("Task I created")).toBeNull();
    expect(within(row).getByRole("link", { name: "Site visit · Kandy" }).getAttribute("href")).toMatch(/^\/my-trips\/t9/);
    fireEvent.click(row);
    const page = await screen.findByTestId("passenger-trip");
    expect(t.argsOf("my_trip")).toEqual([{ task_id: "t9" }]);
    expect(within(page).getByTestId("passenger-live").textContent).toBe("On the way · 08:10");
    expect(within(page).getByTestId("call-trip-driver")).toBeTruthy();
    expect(page.textContent).toContain("WP CAB-4521");
    expect(within(page).getAllByTestId("passenger-stop").map((s) => s.textContent)).toEqual(["1. Pickup · Head office · Done 08:05", "2. Drop · Kandy site · Planned 10:30"]);
    // View only: no check, no finish, no edit.
    expect(within(page).queryAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Back" && !/Copy/.test(b.textContent ?? "")).map((b) => b.textContent)).toEqual([]);
  });
});
