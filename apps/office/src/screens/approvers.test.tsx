// Hotfix 2 (K, F) on the pages: two approvers at once (the decide page says it is open every 20 s and names the other
// one; a decision carries the card's version and the second approver gets the server's refusal and the card as it is
// now, never a second decision), "Approved by Palitha · 10:42" with Call or Call office on the request page, and the
// phone banner with My profile.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../app/FleetContext";
import { PhoneBanner } from "../app/Shell";
import { FleetStore } from "../data/store";
import type { RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { REVIEWING_EVERY_MS } from "./approversLogic";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { RequestDecide } from "./RequestDecide";
import { RequestDetail } from "./RequestDetail";
import { Requests } from "./Requests";
import { MyProfile } from "./settings/MyProfile";
import { TaskDetail } from "./TaskDetail";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

type Answer = (args: Record<string, unknown>, n: number) => unknown;
/** An answer that is a refusal (409 from office-api). */
const refusal = (message: string) => ({ __refuse: { code: "tool_error", message, status: 409 } });

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: () => Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person());
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    const out = a(args, this.argsOf(tool).length) as { __refuse?: unknown };
    if (out && typeof out === "object" && "__refuse" in out) return Promise.reject(out.__refuse);
    return Promise.resolve(structuredClone(out) as T);
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

function mount(transport: FakeTransport, me: Me, url: string, routes: React.ReactNode, extra: Partial<Fleet> = {}) {
  const store = new FleetStore(transport);
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false, ...extra }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}><Routes>{routes}</Routes></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

const sahan: Me = {
  name: "Sahan", role: "admin", permissions: ["view", "request", "approve", "assign_tasks"],
  tools: ["suggest_vehicles", "decide_request", "list_requests", "list_drivers", "list_vehicles", "reviewing"],
};

const waiting: RequestCard = {
  id: "r7", requested_by: "Dilini Jayasinghe", when: "Tue 20 Oct 09:00", route: "Head office → Galle", status: "waiting", version: 3, asked: "5 min ago",
  fields: { date: "2026-10-20", time: "09:00", route_from: "Head office", route_to: "Galle" },
};
const approvedByNimal: RequestCard = {
  ...waiting, status: "approved", version: 4,
  approved_by: { name: "Nimal Fernando", at: "10:42", phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" },
};

function decideTransport(opts: { refuse?: boolean } = {}) {
  return new FakeTransport({
    // The card waits until the other approver's decision lands; then it is approved by Nimal.
    list_requests: (_a, n) => ({ status: "all", count: 1, requests: [n > 1 && opts.refuse ? approvedByNimal : waiting] }),
    suggest_vehicles: () => ({
      request: waiting,
      vehicles: [{ reg_no: "WP CAB-4521", availability: "Free", pick: "good" }],
      drivers: [{ name: "Kamal Perera", username: "kamal", availability: "free" }],
      drivers_free: [{ name: "Kamal Perera", username: "kamal" }],
    }),
    list_drivers: () => ({ drivers: [{ name: "Kamal Perera", username: "kamal", current_vehicle: "WP CAB-4521", active: true }] }),
    list_vehicles: () => ({ vehicles: [{ reg_no: "WP CAB-4521" }] }),
    reviewing: () => ({ reviewing: [{ name: "Nimal Fernando", since: "10:41" }] }),
    decide_request: () => (opts.refuse ? refusal("Already approved by Nimal Fernando at 10:42") : { request: "approved", task_id: "t7" }),
  }, () => sahan);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("two approvers at once (K)", () => {
  it("the decide page says it is open every 20 s and names the other approver on it", async () => {
    const transport = decideTransport();
    mount(transport, sahan, "/requests/r7/decide", <Route path="/requests/:id/decide" element={<RequestDecide />} />);
    await settle();
    await settle();
    expect(screen.getByTestId("request-decide")).toBeTruthy();
    expect(transport.argsOf("reviewing")).toEqual([{ request_id: "r7" }]);
    expect(screen.getByTestId("reviewing").textContent).toBe("Nimal Fernando is reviewing");
    await settle(REVIEWING_EVERY_MS);
    expect(transport.argsOf("reviewing")).toHaveLength(2);
  });

  it("the decision carries the card's version; the second approver sees the refusal and the card as it is now, with no second decision", async () => {
    const transport = decideTransport({ refuse: true });
    mount(transport, sahan, "/requests/r7/decide", <Route path="/requests/:id/decide" element={<RequestDecide />} />);
    await settle();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Approve & send to driver" }));
    await settle();
    await settle();
    expect(transport.argsOf("decide_request")).toEqual([{ request_id: "r7", decision: "approve", version: 3, decided_by: "Sahan", driver: "kamal" }]);
    expect(screen.getByTestId("decide-message").textContent).toContain("Already approved by Nimal Fernando at 10:42");
    // The card asked again: approved by Nimal, nothing left to decide here.
    expect(transport.argsOf("list_requests")).toContainEqual({ status: "all", id: "r7" });
    expect(screen.getByText(/This request is approved; there is nothing to decide/)).toBeTruthy();
    expect(screen.getByTestId("approved-by").textContent).toContain("Approved by Nimal Fernando · 10:42");
    expect(screen.queryByRole("button", { name: "Approve & send to driver" })).toBeNull();
    expect(transport.argsOf("decide_request")).toHaveLength(1);
  });

  it("the queue shows who is reviewing a waiting request", async () => {
    const transport = new FakeTransport({
      list_requests: () => ({ status: "waiting", count: 1, requests: [{ ...waiting, reviewing: [{ name: "Nimal Fernando", since: "10:41" }] }] }),
    }, () => sahan);
    mount(transport, sahan, "/requests", <Route path="/requests" element={<Requests />} />);
    await settle();
    expect(screen.getByTestId("reviewing").textContent).toBe("Nimal Fernando is reviewing");
  });
});

describe("the request page: who decided, and whom to call (K, F)", () => {
  const requester: Me = { name: "Dilini Jayasinghe", role: "staff", permissions: ["view", "request"], tools: ["list_requests"] };
  const office = { phone: "+94112345678", phone_display: "011 234 5678", call: "tel:+94112345678", whatsapp: "https://wa.me/94112345678" };

  it("Approved by Nimal · 10:42 with his number", async () => {
    const transport = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [{ ...approvedByNimal, office_phone: office }] }) }, () => requester);
    mount(transport, requester, "/requests/r7", <Route path="/requests/:id" element={<RequestDetail />} />);
    await settle();
    await settle();
    const row = screen.getByTestId("approved-by");
    expect(row.textContent).toContain("Approved by Nimal Fernando · 10:42");
    expect(within(row).getByTestId("call-approver").textContent).toContain("077 123 4567");
    expect(screen.queryByTestId("call-office")).toBeNull();
  });

  it("Call office when the approver has no number; declined and cancelled say by whom and why", async () => {
    const card: RequestCard = {
      ...waiting, status: "declined", office_phone: office,
      approved_by: { name: "Nimal Fernando", at: "10:42" },
      declined_by: { name: "Palitha", at: "11:05", reason: "no van that day" },
    };
    const transport = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [card] }) }, () => requester);
    mount(transport, requester, "/requests/r7", <Route path="/requests/:id" element={<RequestDetail />} />);
    await settle();
    await settle();
    expect(within(screen.getByTestId("approved-by")).getByTestId("call-office").textContent).toContain("011 234 5678");
    expect(screen.getByTestId("declined-by").textContent).toContain("Declined by Palitha · 11:05 · no van that day");
  });

  it("a waiting request: Call office for the person who asked", async () => {
    const transport = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [{ ...waiting, office_phone: office }] }) }, () => requester);
    mount(transport, requester, "/requests/r7", <Route path="/requests/:id" element={<RequestDetail />} />);
    await settle();
    await settle();
    expect(screen.getByTestId("office-contact").textContent).toContain("011 234 5678");
  });
});

describe("the phone banner and My profile (F)", () => {
  const palitha: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "approve"], tools: ["update_my_profile"], phone_required: true };

  /** The web app's own shape: `me` asked again after a save, the page and the store kept. */
  function App({ transport }: { transport: FakeTransport }) {
    const [me, setMe] = useState<Me>(palitha);
    const [store] = useState(() => new FleetStore(transport));
    return (
      <FleetProvider value={{ store, transport, me, noConnector: false, refreshMe: async () => setMe(await transport.me()) }}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/requests"]}>
            <PhoneBanner />
            <Routes>
              <Route path="/settings/profile" element={<MyProfile />} />
              <Route path="*" element={<Link to="/requests">The requests</Link>} />
            </Routes>
            <Link to="/requests">Back to requests</Link>
          </MemoryRouter>
        </ToastProvider>
      </FleetProvider>
    );
  }

  it("asks for the number on every page until it is saved on My profile, then goes", async () => {
    let saved = false;
    const transport = new FakeTransport({
      update_my_profile: (a) => {
        saved = true;
        expect(a).toEqual({ phone: "0771234567" });
        return { phone: "+94771234567", phone_display: "077 123 4567" };
      },
    }, () => (saved ? { ...palitha, phone: "+94771234567", phone_display: "077 123 4567", phone_required: false } : palitha));
    render(<App transport={transport} />);
    const banner = screen.getByTestId("phone-banner");
    expect(banner.textContent).toContain("Add your phone number so drivers can call you");
    fireEvent.click(within(banner).getByRole("link", { name: "Add my number" }));
    // Not on My profile itself.
    expect(screen.getByTestId("my-profile")).toBeTruthy();
    expect(screen.queryByTestId("phone-banner")).toBeNull();
    fireEvent.change(screen.getByLabelText("My phone number"), { target: { value: "0771234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    await settle();
    expect(transport.argsOf("update_my_profile")).toHaveLength(1);
    expect((screen.getByLabelText("My phone number") as HTMLInputElement).value).toBe("077 123 4567");
    expect(screen.getByText("Saved: 077 123 4567.")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Back to requests" }));
    expect(screen.queryByTestId("phone-banner")).toBeNull();
  });

  it("the same number again is not sent", async () => {
    const me: Me = { ...palitha, phone: "+94771234567", phone_display: "077 123 4567", phone_required: false };
    const transport = new FakeTransport({ update_my_profile: () => ({}) }, () => me);
    mount(transport, me, "/settings/profile", <Route path="/settings/profile" element={<MyProfile />} />);
    expect((screen.getByLabelText("My phone number") as HTMLInputElement).value).toBe("077 123 4567");
    fireEvent.change(screen.getByLabelText("My phone number"), { target: { value: "+94 77 123 4567" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(transport.argsOf("update_my_profile")).toHaveLength(0);
    expect(screen.getByText("That is the number saved.")).toBeTruthy();
  });
});

describe("the task page and Who's available: Call driver, who sent it, the vehicle on the day (F, J, K)", () => {
  const dispatcher: Me = { name: "Sahan", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "get_settings", "availability"] };

  it("the task: Call driver, Approved by with Call office when the approver has no number, and Vehicle: on the day", async () => {
    const transport = new FakeTransport({
      task_detail: () => ({
        task: {
          id: "t1", title: "Team drop · Galle", status: "assigned", start: "Tue 20 Oct 09:00", driver: "Kamal Perera", vehicle_mode: "driver_day", vehicle_text: "Vehicle: on the day",
          driver_phone: { phone: "+94779876543", phone_display: "077 987 6543", call: "tel:+94779876543", whatsapp: "https://wa.me/94779876543" },
          approved_by: { name: "Nimal Fernando", at: "10:42" },
        },
        stops: [], projects: "Fame internal", odometer: [], fuel: [], vehicle_reports: [],
      }),
      get_settings: () => ({ settings: { dwell_min: {}, office_phone: "+94112345678" }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    }, () => dispatcher);
    mount(transport, dispatcher, "/tasks/t1", <Route path="/tasks/:id" element={<TaskDetail />} />);
    await settle();
    await settle();
    expect(screen.getByTestId("call-driver").textContent).toContain("077 987 6543");
    expect(screen.getByTestId("vehicle-text").textContent).toBe("Vehicle: on the day");
    const row = screen.getByTestId("approved-by");
    expect(row.textContent).toContain("Approved by Nimal Fernando · 10:42");
    expect(within(row).getByTestId("call-office").textContent).toContain("011 234 5678");
  });

  it("Who's available: the driver's number beside the row (outside its button) and the vehicle note as plain words", async () => {
    const transport = new FakeTransport({
      availability: () => ({
        as_of: "18 Oct 09:00", window: { from: "Tue 20 Oct 09:00", until: "end of the day", day: "2026-10-20" },
        drivers: [{
          name: "Nuwan Silva", username: "nuwan", state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true,
          vehicle: { reg_no: "WP KL-1234", source: "regular" }, vehicle_note: "no vehicle yet · regular: WP KL-1234",
          phone: { phone: "+94771112222", phone_display: "077 111 2222", call: "tel:+94771112222", whatsapp: "https://wa.me/94771112222" },
        }],
        counts: { free: 1, on_duty: 1, all: 1 },
        vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
      }),
    }, () => dispatcher);
    const onPick = vi.fn();
    mount(transport, dispatcher, "/", <Route path="/" element={<AvailabilityPanel args={{ at: "2026-10-20 09:00" }} onPick={onPick} />} />);
    await settle(400);
    await settle();
    const row = screen.getByTestId("avail-row");
    expect(row.tagName).toBe("BUTTON");
    expect(within(row).getByTestId("avail-vehicle-note").textContent).toBe("no vehicle yet · regular: WP KL-1234");
    const contact = screen.getByTestId("avail-contact");
    expect(row.contains(contact)).toBe(false);
    expect(contact.textContent).toContain("077 111 2222");
    fireEvent.click(within(contact).getByRole("button", { name: "Copy" }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
