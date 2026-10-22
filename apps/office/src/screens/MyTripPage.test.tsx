// Round 4–7, feature 4: a trip nobody drives with the app, on the person's own page (/my-trips/:task): the vehicle check
// (all good starts the trip, early only records it, a problem with photos; the switch off = the odometer alone), Trip
// finished? (the start when there is none, the fuel under More details), the confirm of one closed without the odometer,
// a request's id still opening the request, and My trips' row buttons opening the page.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { CreatedTaskCard, MyTrip, MyTrips as MyTripsData, RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { MyTripOrRequest } from "./MyTripPage";
import { MyTrips } from "./MyTrips";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));
vi.mock("./imageCanvas", () => ({ tripPhoto: (f: Blob) => Promise.resolve(f) }));

const TASK = "5f0c1a2b-0000-4000-8000-000000000001";
const base: MyTrip = {
  task_id: TASK, title: "Site visit · Kandy", date: "2030-01-10", leave_at: "09:00", back_by: "17:00", back_by_date: "2030-01-10",
  vehicle: "WP CAB-4521", vehicle_label: "WP CAB-4521 · Toyota HiAce", driven_by: "self",
  stops: [{ n: 1, type: "visit", place: "Kandy site" }], planned_km: 230, state: "to_check",
  window: { opens_at: "07:00", open: true, past: false }, check_needed: true, can: { check: true, finish: true }, last_odometer_km: 45210,
};

const REQUEST: RequestCard = {
  id: "r3", requested_by: "Nimali", when: "Fri 10 Jan 09:00", route: "Head office → Kandy site", status: "approved", task_id: TASK,
  live: { state: "approved", text: "Approved" }, trip_action: "check",
  assigned: { driver: "Nimali Perera", driven_by: "self", vehicle: "WP CAB-4521" },
};
const CREATED: CreatedTaskCard = {
  source: "task", id: "t7", task_id: "t7", title: "Bank run", when: "Fri 10 Jan 11:00", status: "completed",
  live: { state: "completed", text: "Completed" }, trip_action: "confirm", created: "2030-01-09 10:00",
};

class FakeTransport implements Transport {
  readonly kind: "api" | "claude";
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  trip: MyTrip;
  answer: Partial<MyTrip> = {};
  refuse = false;
  constructor(trip: MyTrip, kind: "api" | "claude" = "api") {
    this.trip = trip;
    this.kind = kind;
  }
  me(): Promise<Me> {
    return Promise.resolve(me);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_trip") {
      if (this.refuse || args.task_id !== this.trip.task_id) return Promise.reject({ code: "tool_error", message: "Not one of your trips.", status: 409 });
      return Promise.resolve(structuredClone(this.trip) as T);
    }
    if (tool === "my_trip_check" || tool === "finish_my_trip") return Promise.resolve({ ...structuredClone(this.trip), ...this.answer } as T);
    if (tool === "my_trips") {
      const data: MyTripsData = { from: String(args.from), to: String(args.to), count: 2, total: 2, trips: [REQUEST, CREATED] };
      return Promise.resolve(structuredClone(data) as T);
    }
    if (tool === "list_requests") return Promise.resolve({ status: "all", count: 0, requests: [] } as T);
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

const me: Me = { name: "Nimali", role: "staff", permissions: ["view", "request"], tools: ["my_trips", "my_trip", "my_trip_check", "finish_my_trip", "list_requests", "create_request"] };

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

async function mount(trip: MyTrip, opts: { url?: string; kind?: "api" | "claude"; photos?: boolean } = {}) {
  const transport = new FakeTransport(trip, opts.kind);
  const saved: string[] = [];
  const tripPhoto = opts.photos === false ? undefined : {
    save: (kind: string) => {
      saved.push(kind);
      return Promise.resolve({ id: `9a8b7c6d-0000-4000-8000-00000000000${saved.length}` });
    },
  };
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false, tripPhoto }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/my-trips", opts.url ?? `/my-trips/${TASK}`]} initialIndex={1}>
          <Routes>
            <Route path="/my-trips" element={<MyTrips />}><Route path=":id" element={<MyTripOrRequest />} /></Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return { transport, saved };
}

const page = async () => within(await screen.findByTestId("my-trip"));
const pick = (label: string) => {
  const input = screen.getByLabelText(label, { selector: "input[type=file]" });
  fireEvent.change(input, { target: { files: [new File(["x"], "photo.jpg", { type: "image/jpeg" })] } });
};

describe("My trip (a trip nobody drives with the app)", () => {
  it("the check before setting off: All good starts the trip with the odometer prefilled; back to My trips with the outcome", async () => {
    const { transport } = await mount(base);
    const p = await page();
    expect(p.getByText("Vehicle check before you set off")).toBeTruthy();
    expect(p.getByTestId("my-trip-window").textContent).toBe("Your check starts the trip (On the way).");
    const send = p.getByTestId("check-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(p.getByTestId("check-why").textContent).toBe("Answer the question: any damage or problem?");
    fireEvent.click(p.getByTestId("check-ok"));
    expect((p.getByLabelText("Odometer now (km)") as HTMLInputElement).value).toBe("45210");
    fireEvent.change(p.getByLabelText("Odometer now (km)"), { target: { value: "45200" } });
    expect(p.getByTestId("check-why").textContent).toMatch(/Under the vehicle's last reading \(45,210 km\)/);
    fireEvent.change(p.getByLabelText("Odometer now (km)"), { target: { value: "45215" } });
    expect(send.disabled).toBe(false);
    expect(send.textContent).toBe("Start trip");
    transport.answer = { state: "on_the_way", started: "07:42", started_now: true };
    await act(async () => { fireEvent.click(send); });
    const [input] = transport.argsOf("my_trip_check");
    expect(input).toMatchObject({ task_id: TASK, result: "ok", odometer_km: 45215 });
    expect(String(input.check_id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("On the way · left 07:42")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/my-trips");
  });

  it("an early check is only recorded, and the page says so; the four sides go up under More details", async () => {
    const early = { ...base, window: { opens_at: "07:00", open: false, past: false } };
    const { transport, saved } = await mount(early);
    const p = await page();
    expect(p.getByTestId("my-trip-window").textContent).toMatch(/^The trip starts on .+ from 07:00: a check now is only recorded\. Check again then\.$/);
    fireEvent.click(p.getByTestId("check-ok"));
    fireEvent.click(p.getByTestId("more-details"));
    expect(p.getByText("Add 4 photos (front, back, left, right)")).toBeTruthy();
    await act(async () => { pick("Add front"); });
    expect(saved).toEqual(["vehicle_check"]);
    expect((p.getByTestId("check-send") as HTMLButtonElement).textContent).toBe("Save check");
    await act(async () => { fireEvent.click(p.getByTestId("check-send")); });
    expect(transport.argsOf("my_trip_check")[0]).toMatchObject({ result: "ok", sides: [{ side: "front" }] });
    expect(await screen.findByText(/^Check recorded\. The trip starts on .+ from 07:00: check again then\.$/)).toBeTruthy();
  });

  it("a problem: what it is, at least one photo (kind vehicle_report) and a note; sent with the check", async () => {
    const { transport, saved } = await mount(base);
    const p = await page();
    fireEvent.click(p.getByTestId("check-problem"));
    expect(p.getByTestId("check-why").textContent).toBe("Pick what the problem is");
    fireEvent.click(p.getByTestId("cat-damage"));
    expect(p.getByTestId("check-why").textContent).toBe("Add at least one photo of the problem");
    await act(async () => { pick("Add photo"); });
    expect(saved).toEqual(["vehicle_report"]);
    fireEvent.change(p.getByLabelText("Note (optional)"), { target: { value: "Dent on the back door" } });
    expect(p.getByTestId("check-send").textContent).toBe("Send and start trip");
    await act(async () => { fireEvent.click(p.getByTestId("check-send")); });
    const [input] = transport.argsOf("my_trip_check");
    expect(input).toMatchObject({ result: "problem", category: "damage", note: "Dent on the back door", odometer_km: 45210 });
    expect((input.photos as string[]).length).toBe(1);
  });

  it("without the web app's uploads (the artifact) a problem cannot be sent and the page says why", async () => {
    await mount(base, { kind: "claude", photos: false });
    const p = await page();
    fireEvent.click(p.getByTestId("check-problem"));
    expect(p.getByText("A problem needs photos: open the Fame Fleet web app to report it.")).toBeTruthy();
    expect((p.getByTestId("check-send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the switch vehicle_check off: no question, only the odometer, which starts the trip from its time", async () => {
    await mount({ ...base, check_needed: false, window: { opens_at: "07:00", open: false, past: false } });
    const p = await page();
    expect(p.queryByTestId("check-ok")).toBeNull();
    expect(p.getByText("Start the trip")).toBeTruthy();
    expect((p.getByTestId("check-send") as HTMLButtonElement).disabled).toBe(true);
    expect(p.getByTestId("check-why").textContent).toMatch(/^You can start the trip on .+ from 07:00$/);
  });

  it("Trip finished? with no start reading: the start is the vehicle's last reading, the fuel under More details", async () => {
    const { transport } = await mount({ ...base, window: { opens_at: "07:00", open: false, past: true }, can: { check: true, finish: true } });
    const p = await page();
    expect(p.getByText("Trip finished? Enter the odometer")).toBeTruthy();
    expect((p.getByLabelText("Odometer at the start (km)") as HTMLInputElement).value).toBe("45210");
    expect(p.getByTestId("finish-why").textContent).toBe("Enter the odometer");
    fireEvent.change(p.getByLabelText("Odometer now (km)"), { target: { value: "45252" } });
    expect(p.getByTestId("my-trip-km").textContent).toBe("42 km this trip");
    fireEvent.click(p.getByTestId("more-details"));
    fireEvent.change(p.getByLabelText("Fuel added (litres)"), { target: { value: "12.5" } });
    fireEvent.change(p.getByLabelText("Amount (LKR)"), { target: { value: "4500" } });
    transport.answer = { state: "done", km: 42 };
    await act(async () => { fireEvent.click(p.getByTestId("finish-send")); });
    expect(transport.argsOf("finish_my_trip")).toEqual([{ task_id: TASK, odometer_km: 45252, start_odometer_km: 45210, fuel: { litres: 12.5, amount_lkr: 4500 } }]);
    expect(await screen.findByText("Trip finished · 42 km")).toBeTruthy();
  });

  it("a trip closed at 09:00 without the odometer is confirmed with the same form", async () => {
    const { transport } = await mount({ ...base, state: "not_confirmed", not_confirmed: true, start_odometer_km: 45210, can: { check: false, finish: true } });
    const p = await page();
    expect(p.getByText(/closed at 09:00 the next day without the odometer/)).toBeTruthy();
    expect(p.queryByLabelText("Odometer at the start (km)")).toBeNull();
    fireEvent.change(p.getByLabelText("Odometer now (km)"), { target: { value: "45300" } });
    expect(p.getByTestId("finish-send").textContent).toBe("Confirm trip");
    transport.answer = { state: "done", km: 90 };
    await act(async () => { fireEvent.click(p.getByTestId("finish-send")); });
    expect(await screen.findByText("Trip finished · 90 km · confirmed")).toBeTruthy();
  });

  it("a request of the list opens its own page (no my_trip call)", async () => {
    const { transport } = await mount(base, { url: "/my-trips/r3" });
    const detail = within(await screen.findByTestId("detail"));
    expect((await detail.findAllByText("Head office → Kandy site")).length).toBeGreaterThan(0);
    expect(detail.queryByTestId("my-trip")).toBeNull();
    expect(transport.argsOf("my_trip")).toEqual([]);
  });

  it("an id my_trip does not know (a request outside the list) falls back to the request page", async () => {
    const { transport } = await mount(base, { url: "/my-trips/9a8b7c6d-0000-4000-8000-0000000000ff" });
    expect(await screen.findByText(/This request is not in your list/)).toBeTruthy();
    expect(transport.argsOf("my_trip")).toHaveLength(1);
    expect(transport.argsOf("list_requests")).toHaveLength(1);
  });

  it("My trips: a row's button says what the trip asks and opens its page", async () => {
    await mount(base, { url: "/my-trips" });
    await act(async () => { await Promise.resolve(); });
    const buttons = await screen.findAllByTestId("trip-action");
    expect(buttons.map((b) => b.textContent)).toEqual(["Vehicle check", "Enter the odometer"]);
    expect(buttons[0].getAttribute("href")).toMatch(new RegExp(`^/my-trips/${TASK}`));
    expect(buttons[1].getAttribute("href")).toMatch(/^\/my-trips\/t7/);
    await act(async () => { fireEvent.click(buttons[0]); });
    expect(screen.getByTestId("where").textContent).toBe(`/my-trips/${TASK}`);
    expect(await screen.findByText("Vehicle check before you set off")).toBeTruthy();
  });
});
