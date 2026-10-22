// Round 4–7, feature 7 (22 October 2026): someone else has that driver or vehicle, on the screens. The conflict card keeps
// everything it had (Open that task, Pick another vehicle / driver, Call / WhatsApp the driver) and gains the holder (photo,
// name, label, how and when, Call, WhatsApp, Ask for it → the sheet → ask_for_it → the toast with `next`; a dropped write
// says so with Try again, never sent again by itself); no holder (holder_contact off) = no Ask. Who's available and the
// vehicle groups: picking still works, a busy row has the holder's strip with Ask. The Asks page (tabs, Yes / No), the
// task page's line, and the Timeline (bars on a desktop, cards on a phone).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Availability, AvailableDriver, Conflict, DayTimeline, Holder, HolderAsks as HolderAsksData, Suggestions } from "../data/types";
import type { FleetError, Me, Transport, WatchEvent } from "../transport/types";
import { forgetAsked, requesterOnHolderLine } from "../ui/holderLogic";
import { ToastProvider } from "../ui/Toast";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { ConflictCards } from "./ConflictCards";
import { HolderAsks, TaskAsksLine } from "./HolderAsks";
import { VehicleGroups } from "./requestParts";
import { Schedule } from "./Schedule";

type Args = Record<string, unknown>;
type Answer = unknown | ((args: Args, n: number) => unknown);

/** Each tool answers what the test gives it (a function gets the arguments and the call's number); else it refuses. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(public answers: Record<string, Answer> = {}) {}
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string): Args[] {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (a === undefined) return Promise.reject({ code: "tool_error", message: `No ${tool} here` });
    try {
      const v = typeof a === "function" ? (a as (x: Args, n: number) => unknown)(args, this.argsOf(tool).length) : a;
      return v instanceof Promise ? (v as Promise<T>) : Promise.resolve(structuredClone(v) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["availability", "ask_for_it", "holder_asks", "day_timeline"] };

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

function mount(ui: ReactNode, t: FakeTransport, opts: { me?: Me; url?: string; path?: string } = {}) {
  const fleet = { store: new FleetStore(t), transport: t, me: opts.me ?? dispatcher, noConnector: false };
  return render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.url ?? "/"]}>
          <Routes>
            <Route path={opts.path ?? "/"} element={ui} />
            <Route path="*" element={<div>Elsewhere</div>} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const holder = (over: Partial<Holder> = {}): Holder => ({
  task_id: "t-other", employee_id: "e-anoja", name: "Anoja Perera", label: "Staff", by: "asked", window: "08:00–11:00", from: "08:00", to: "11:00",
  phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567", ...over,
});

const vehicleCard = (over: Partial<Conflict> = {}): Conflict => ({
  kind: "vehicle",
  text: "WP CAB-4521 is on task Team drop 08:00–11:00 for Anoja (driver Kamal)",
  task: { id: "t-other", title: "Team drop", window: "08:00–11:00" },
  requester: { name: "Anoja Perera", phone: "+94771234567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" },
  driver: { name: "Kamal Silva", phone: "+94772222222", call: "tel:+94772222222", whatsapp: "https://wa.me/94772222222" },
  holder: holder(),
  ...over,
});
const driverCard = (over: Partial<Conflict> = {}): Conflict => ({
  kind: "driver",
  text: "Kamal is on task Site visit 09:00",
  task: { id: "t-two", title: "Site visit", window: "from 09:00" },
  holder: holder({ task_id: "t-two", name: "Nimal Fernando", label: "Fleet admin", by: "assigned", from: "09:00", to: undefined, window: "from 09:00", phone: undefined, call: undefined, whatsapp: undefined }),
  ...over,
});

afterEach(() => {
  forgetAsked();
  vi.unstubAllGlobals();
});

describe("the conflict card with its holder", () => {
  it("keeps Open that task, Pick another vehicle / driver and the driver's Call / WhatsApp; adds the holder with Call, WhatsApp and Ask for it", () => {
    const pickVehicle = vi.fn();
    const pickDriver = vi.fn();
    mount(<ConflictCards conflicts={[vehicleCard(), driverCard()]} onPickVehicle={pickVehicle} onPickDriver={pickDriver} />, new FakeTransport());
    const [first, second] = screen.getAllByTestId("conflict-card");
    // As before.
    expect(within(first).getByRole("link", { name: "Open that task" }).getAttribute("href")).toBe("/tasks/t-other");
    expect(within(second).getByRole("link", { name: "Open that task" }).getAttribute("href")).toBe("/tasks/t-two");
    fireEvent.click(within(first).getByRole("button", { name: "Pick another vehicle" }));
    fireEvent.click(within(second).getByRole("button", { name: "Pick another driver" }));
    expect(pickVehicle).toHaveBeenCalledTimes(1);
    expect(pickDriver).toHaveBeenCalledTimes(1);
    expect(within(first).getByRole("link", { name: "Call Kamal Silva (driver of that task)" }).getAttribute("href")).toBe("tel:+94772222222");
    expect(within(first).getByRole("link", { name: "WhatsApp Kamal Silva (driver of that task)" })).toBeTruthy();
    // The holder (here the requester too: Sahan's OK, 22 October 2026, their Call / WhatsApp once, on the holder line).
    const line = within(first).getByTestId("holder-line");
    expect(within(line).getByTestId("holder-name").textContent).toBe("Anoja Perera · Staff");
    expect(within(line).getByTestId("holder-when").textContent).toBe("Asked for it · 08:00–11:00");
    expect(within(line).getByText("077 123 4567")).toBeTruthy();
    expect(within(line).getByRole("link", { name: /WhatsApp/ }).getAttribute("href")).toContain("94771234567");
    expect(within(line).getByRole("button", { name: "Ask for it: ask Anoja Perera" })).toBeTruthy();
    expect(within(first).queryByRole("link", { name: "Call Anoja Perera (asked for that task)" })).toBeNull();
    expect(within(first).queryByRole("link", { name: "WhatsApp Anoja Perera (asked for that task)" })).toBeNull();
    // Anoja's WhatsApp once (the holder line's), Kamal's once (the driver's).
    const wa = within(first).getAllByRole("link", { name: /WhatsApp/ }).map((a) => a.getAttribute("href") ?? "");
    expect(wa).toHaveLength(2);
    expect(wa[0]).toContain("94771234567");
    expect(wa[1]).toBe("https://wa.me/94772222222");
    // Assigned, no end, no number: no Call / WhatsApp, Ask still.
    const two = within(second).getByTestId("holder-line");
    expect(within(two).getByTestId("holder-name").textContent).toBe("Nimal Fernando · Fleet admin");
    expect(within(two).getByTestId("holder-when").textContent).toBe("Assigned it · from 09:00");
    expect(within(two).queryByTestId("holder-contact")).toBeNull();
    expect(within(two).getByTestId("holder-ask")).toBeTruthy();
  });

  // Round 4–7 (approved by Sahan 22 October 2026): the requester's own pair only when the holder line does not carry it.
  it("the requester's Call / WhatsApp: gone when they are the holder with a number; kept for anyone else, or a holder line without one", () => {
    const other = mount(<ConflictCards conflicts={[vehicleCard({ holder: holder({ name: "Nimal Fernando", by: "assigned" }) })]} />, new FakeTransport());
    expect(screen.getByRole("link", { name: "Call Anoja Perera (asked for that task)" }).getAttribute("href")).toBe("tel:+94771234567");
    expect(screen.getByRole("link", { name: "WhatsApp Anoja Perera (asked for that task)" })).toBeTruthy();
    other.unmount();
    const noNumber = mount(<ConflictCards conflicts={[vehicleCard({ holder: holder({ phone: undefined, call: undefined, whatsapp: undefined }) })]} />, new FakeTransport());
    expect(screen.queryByTestId("holder-contact")).toBeNull();
    expect(screen.getByRole("link", { name: "Call Anoja Perera (asked for that task)" })).toBeTruthy();
    noNumber.unmount();
    // The rule itself.
    expect(requesterOnHolderLine(vehicleCard())).toBe(true);
    expect(requesterOnHolderLine(vehicleCard(), "Anoja Perera")).toBe(false);
    expect(requesterOnHolderLine(vehicleCard({ holder: undefined }))).toBe(false);
    expect(requesterOnHolderLine(vehicleCard({ kind: "garage" }))).toBe(false);
    expect(requesterOnHolderLine(vehicleCard({ requester: undefined }))).toBe(false);
    expect(requesterOnHolderLine(vehicleCard({ holder: holder({ name: " anoja perera " }) }))).toBe(true);
  });

  it("Ask for it: the sheet, an optional note, Send → ask_for_it with the trip's window, the toast says what happens next", async () => {
    const t = new FakeTransport({ ask_for_it: { ask_id: "a1", asked: "Anoja Perera", what: "WP CAB-4521", wanted: "Fri 24 Oct 09:00–12:00", next: "Asked Anoja Perera. You'll hear their answer; the fleet admin can reassign." } });
    mount(<ConflictCards conflicts={[vehicleCard()]} wanted={{ date: "2026-10-24", from: "09:00", until: "12:00" }} />, t);
    fireEvent.click(screen.getByTestId("holder-ask"));
    const sheet = screen.getByTestId("ask-for-it");
    expect(within(sheet).getByTestId("ask-for-it-text").textContent).toBe("Anoja has WP CAB-4521 08:00–11:00. They get Yes / No in one tap; nothing changes until the fleet admin reassigns.");
    fireEvent.change(within(sheet).getByLabelText("A note (optional)"), { target: { value: "  site visit, can't move it " } });
    fireEvent.click(within(sheet).getByTestId("ask-for-it-send"));
    await flush();
    expect(t.argsOf("ask_for_it")).toEqual([{ task_id: "t-other", resource: "vehicle", note: "site visit, can't move it", date: "2026-10-24", from: "09:00", until: "12:00" }]);
    expect(screen.queryByTestId("ask-for-it")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Asked Anoja Perera. You'll hear their answer");
    // Asked once from this page: the button says so.
    expect(screen.getByTestId("holder-ask").textContent).toBe("Asked");
    expect((screen.getByTestId("holder-ask") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a dropped ask is never sent again by itself: it may not have been saved, Try again sends it once more", async () => {
    const dropped: FleetError = { code: "network", message: "Failed to fetch", write: true };
    const t = new FakeTransport({ ask_for_it: (_a: Args, n: number) => (n === 1 ? Promise.reject(dropped) : { ask_id: "a1", what: "Kamal", wanted: "", next: "Asked Nimal." }) });
    mount(<ConflictCards conflicts={[driverCard()]} />, t);
    fireEvent.click(screen.getByTestId("holder-ask"));
    fireEvent.click(screen.getByTestId("ask-for-it-send"));
    await flush();
    const sheet = screen.getByTestId("ask-for-it");
    expect(sheet.textContent).toContain("Fame Fleet didn’t answer, so this may not have been saved. Try again.");
    expect(t.argsOf("ask_for_it")).toHaveLength(1);
    await flush();
    expect(t.argsOf("ask_for_it")).toHaveLength(1);
    fireEvent.click(within(sheet).getByRole("button", { name: "Try again" }));
    await flush();
    expect(t.argsOf("ask_for_it")).toEqual([{ task_id: "t-two", resource: "driver" }, { task_id: "t-two", resource: "driver" }]);
    expect(screen.queryByTestId("ask-for-it")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Asked Nimal.");
  });

  it("holder_contact off (no holder): the card as before, no holder and no Ask; no ask_for_it = no Ask; my own trip = You; the garage never asks", () => {
    const { unmount } = mount(<ConflictCards conflicts={[vehicleCard({ holder: undefined })]} onPickVehicle={() => {}} />, new FakeTransport());
    expect(screen.queryByTestId("holder-line")).toBeNull();
    expect(screen.queryByText(/Ask/)).toBeNull();
    expect(screen.getByRole("link", { name: "Call Anoja Perera (asked for that task)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pick another vehicle" })).toBeTruthy();
    unmount();
    const noTool = mount(<ConflictCards conflicts={[vehicleCard()]} />, new FakeTransport(), { me: { ...dispatcher, tools: ["availability"] } });
    expect(screen.getByTestId("holder-line")).toBeTruthy();
    expect(screen.queryByTestId("holder-ask")).toBeNull();
    noTool.unmount();
    const mine = mount(<ConflictCards conflicts={[vehicleCard()]} />, new FakeTransport(), { me: { ...dispatcher, name: "Anoja Perera" } });
    expect(screen.getByTestId("holder-name").textContent).toBe("You");
    expect(screen.queryByTestId("holder-ask")).toBeNull();
    expect(screen.queryByTestId("holder-contact")).toBeNull();
    mine.unmount();
    mount(<ConflictCards conflicts={[vehicleCard({ kind: "garage", text: "WP CAB-4521 is in the garage" })]} />, new FakeTransport());
    expect(screen.queryByTestId("holder-line")).toBeNull();
  });
});

const availRow = (name: string, username: string, over: Partial<AvailableDriver> & { holder?: Holder } = {}): AvailableDriver =>
  ({ name, username, state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true, ...over }) as AvailableDriver;

describe("Who's available and the vehicle groups", () => {
  it("picking still works; a busy driver's row has the holder's strip with Ask (the panel's window sent)", async () => {
    const answer: Availability = {
      as_of: "24 Oct 08:00",
      window: { from: "Fri 24 Oct 09:00", until: "12:00", day: "2026-10-24" },
      drivers: [
        availRow("Sunil Jayasena", "sunil.j"),
        availRow("Kamal Perera", "kamal.p", { free: false, state: "on_task", status_text: "On a task until ~11:00", busy_with: "Team drop", holder: holder() }),
      ],
      counts: { free: 1, on_duty: 2, all: 2 },
      vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
    };
    const t = new FakeTransport({ availability: answer, ask_for_it: { ask_id: "a1", what: "Kamal Perera", wanted: "", next: "Asked Anoja Perera." } });
    const onPick = vi.fn();
    mount(<AvailabilityPanel args={{ at: "2026-10-24 09:00", until: "12:00" }} onPick={onPick} />, t);
    await waitFor(() => expect(screen.getAllByTestId("avail-row")).toHaveLength(2));
    const strips = screen.getAllByTestId("holder-strip");
    expect(strips).toHaveLength(1);
    expect(strips[0].textContent).toContain("Anoja's · 08:00–11:00");
    // Picking: the busy row too (a click on the row, never on the strip).
    fireEvent.click(screen.getAllByTestId("avail-row")[1]);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].username).toBe("kamal.p");
    fireEvent.click(within(strips[0]).getByTestId("holder-strip-ask"));
    expect(screen.getByTestId("ask-for-it-text").textContent).toContain("Anoja has Kamal Perera 08:00–11:00.");
    fireEvent.click(screen.getByTestId("ask-for-it-send"));
    await flush();
    expect(t.argsOf("ask_for_it")).toEqual([{ task_id: "t-other", resource: "driver", date: "2026-10-24", from: "09:00", until: "12:00" }]);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("the vehicle groups: picking still works; a busy vehicle has its holder's strip with Ask", async () => {
    const sug: Suggestions = {
      vehicles: [],
      drivers: [],
      groups: {
        free_pool: [{ reg_no: "WP KL-1234", availability: "free all day", pick: "good" }],
        free_assigned: [],
        busy: [{ reg_no: "WP CAB-4521", availability: "booked 08:00–11:00 · Team drop", pick: "no", back: "back ~11:00", holder: holder() } as Suggestions["vehicles"][number]],
        in_garage: [],
      },
    };
    const t = new FakeTransport({ ask_for_it: { ask_id: "a1", what: "WP CAB-4521", wanted: "", next: "Asked Anoja Perera." } });
    const onPick = vi.fn();
    mount(<VehicleGroups sug={sug} name="v" vehicle="" onPick={onPick} wanted={{ date: "2026-10-24", from: "09:00" }} />, t);
    fireEvent.click(screen.getByRole("radio", { name: /WP KL-1234/ }));
    fireEvent.click(screen.getByRole("radio", { name: /WP CAB-4521/ }));
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(["WP KL-1234", "WP CAB-4521"]);
    const strip = within(screen.getByTestId("group-busy")).getByTestId("holder-strip");
    expect(strip.textContent).toContain("Anoja's · 08:00–11:00");
    expect(within(screen.getByTestId("group-free_pool")).queryByTestId("holder-strip")).toBeNull();
    fireEvent.click(within(strip).getByTestId("holder-strip-ask"));
    fireEvent.click(screen.getByTestId("ask-for-it-send"));
    await flush();
    expect(t.argsOf("ask_for_it")).toEqual([{ task_id: "t-other", resource: "vehicle", date: "2026-10-24", from: "09:00" }]);
    expect(onPick).toHaveBeenCalledTimes(2);
  });
});

const asks = (which: HolderAsksData["which"], list: Partial<HolderAsksData["asks"][number]>[]): HolderAsksData => ({
  which,
  count: list.length,
  asks: list.map((a, i) => ({ id: `a${i + 1}`, task_id: "t-other", trip: "Team drop", resource: "vehicle", what: "WP CAB-4521", wanted: "Fri 24 Oct 09:00–12:00", asked_by: "Nimal", holder: "Anoja", asked_at: "Thu 23 Oct 10:00", ...a })),
});

describe("the Asks page", () => {
  it("To me with Yes / No (answer_holder_ask, then the chip and a toast); By me; no All without approve; a row opens its trip", async () => {
    const t = new FakeTransport({
      holder_asks: (a: Args) => (a.which === "to_me" ? asks("to_me", [{ note: "site visit" }, { id: "x", answer: "no" }]) : asks("by_me", [{ answer: "yes", holder: "Kamal" }])),
      answer_holder_ask: { ask_id: "a1", answer: "yes", said: "Yes · WP CAB-4521", next: "The asker and the fleet admin are told." },
    });
    mount(<HolderAsks />, t, { url: "/tasks/asks", path: "/tasks/asks" });
    await waitFor(() => expect(screen.getAllByTestId("holder-ask-row")).toHaveLength(2));
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["To me", "By me"]);
    const [first, second] = screen.getAllByTestId("holder-ask-row");
    expect(first.textContent).toContain("WP CAB-4521 · Team drop");
    expect(first.textContent).toContain("Fri 24 Oct 09:00–12:00 · asked by Nimal · “site visit”");
    expect(within(first).getByRole("link").getAttribute("href")).toBe("/tasks/t-other");
    expect(within(second).queryByTestId("holder-ask-yes")).toBeNull();
    expect(within(second).getByText("No")).toBeTruthy();
    fireEvent.click(within(first).getByTestId("holder-ask-yes"));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "a1", answer: "yes" }]);
    expect(within(first).queryByTestId("holder-ask-yes")).toBeNull();
    expect(within(first).getByText("Yes")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("You said Yes");
    fireEvent.click(screen.getByRole("tab", { name: "By me" }));
    await waitFor(() => expect(screen.getByTestId("holder-ask-row").textContent).toContain("asked Kamal"));
    expect(screen.getByTestId("where").textContent).toBe("/tasks/asks?which=by_me");
  });

  it("an answer that failed says so with Try again (never sent again by itself); All for approve; one trip's asks with Show all", async () => {
    const dropped: FleetError = { code: "timeout", message: "timeout", write: true };
    const t = new FakeTransport({
      holder_asks: (a: Args) => asks(a.which as HolderAsksData["which"], [{ task_id: "t1" }, { id: "b", task_id: "t2", trip: "Airport run" }]),
      answer_holder_ask: (_a: Args, n: number) => (n === 1 ? Promise.reject(dropped) : { ask_id: "a1", answer: "no" }),
    });
    const approver: Me = { ...dispatcher, permissions: ["view", "approve", "assign_tasks"] };
    mount(<HolderAsks />, t, { url: "/tasks/asks?task=t1", path: "/tasks/asks", me: approver });
    await waitFor(() => expect(screen.getAllByTestId("holder-ask-row")).toHaveLength(1));
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["To me", "By me", "All"]);
    fireEvent.click(screen.getByTestId("holder-ask-no"));
    await flush();
    expect(screen.getByTestId("holder-ask-row").textContent).toContain("may not have been saved");
    expect(t.argsOf("answer_holder_ask")).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId("holder-ask-row")).getByRole("button", { name: "Try again" }));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "a1", answer: "no" }, { ask_id: "a1", answer: "no" }]);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(screen.getAllByTestId("holder-ask-row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(t.argsOf("holder_asks").some((a) => a.which === "all")).toBe(true));
  });

  it("the empty line, the error with Try again; the task page's line counts this trip's asks", async () => {
    let fail = true;
    const t = new FakeTransport({ holder_asks: () => (fail ? Promise.reject({ code: "tool_error", message: "Fame Fleet refused." }) : asks("to_me", [])) });
    const { unmount } = mount(<HolderAsks />, t, { url: "/tasks/asks", path: "/tasks/asks" });
    await waitFor(() => expect(screen.getByText("Fame Fleet refused.")).toBeTruthy());
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("No asks to you in the last 14 days.")).toBeTruthy());
    unmount();
    const t2 = new FakeTransport({ holder_asks: (a: Args) => asks(a.which as HolderAsksData["which"], a.which === "to_me" ? [{ task_id: "t1" }] : [{ id: "z", task_id: "t1" }, { id: "y", task_id: "t9" }]) });
    mount(<TaskAsksLine taskId="t1" />, t2);
    await waitFor(() => expect(screen.getByTestId("task-asks").textContent).toBe("Asks about this trip · 2"));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/tasks/asks?task=t1");
  });
});

const timeline = (kind: DayTimeline["kind"]): DayTimeline => ({
  date: "2026-10-24",
  kind,
  count: 2,
  busy: 1,
  rows: kind === "drivers"
    ? [
      {
        id: "e1", name: "Kamal Perera", username: "kamal.p",
        bookings: [
          { task_id: "t1", title: "Team drop", from: "08:00", to: "11:00", status: "assigned", vehicle: "WP CAB-4521", holder: { name: "Anoja Perera", label: "Staff", by: "asked" } },
          { task_id: "t2", title: "Site visit", from: "10:00", status: "in_progress" },
        ],
        not_available: [{ from: "13:00", to: "22:00", part: "afternoon", reason: "half_day" }],
      },
      { id: "e2", name: "Sunil Jayasena", username: "sunil.j", bookings: [] },
    ]
    : [{ id: "v1", name: "WP CAB-4521", label: "Toyota HiAce", in_garage: true, bookings: [{ task_id: "t1", title: "Team drop", from: "08:00", to: "11:00", status: "completed", driver: "Kamal" }] }],
});

describe("the Timeline", () => {
  it("a desktop: a row per driver, the bookings as bars with the holder and a link, overlaps on lanes, not available hatched, free rows; Vehicles", async () => {
    const t = new FakeTransport({ day_timeline: (a: Args) => timeline(a.kind as DayTimeline["kind"]) });
    mount(<Schedule />, t, { url: "/schedule?date=2026-10-24", path: "/schedule" });
    await waitFor(() => expect(screen.getAllByTestId("sched-row")).toHaveLength(2));
    expect(t.argsOf("day_timeline")[0]).toEqual({ date: "2026-10-24", kind: "drivers" });
    expect(screen.getByTestId("sched-count").textContent).toBe("1 of 2 busy");
    const bars = screen.getAllByTestId("sched-bar");
    expect(bars.map((b) => b.getAttribute("href"))).toEqual(["/tasks/t1", "/tasks/t2"]);
    expect(bars[0].getAttribute("aria-label")).toBe("Team drop · 08:00–11:00 · Planned · WP CAB-4521 · Anoja Perera asked for it");
    expect((bars[0] as HTMLElement).style.left).toBe("12.5%");
    expect((bars[0] as HTMLElement).style.width).toBe("18.75%");
    expect((bars[1] as HTMLElement).style.top).toBe("37px");
    expect(screen.getByTestId("sched-off").getAttribute("aria-label")).toBe("Not available 13:00–22:00 · afternoon · half day");
    expect(screen.getByText("Free all day")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Asks" }).getAttribute("href")).toBe("/tasks/asks");
    fireEvent.click(screen.getByRole("tab", { name: "Vehicles" }));
    await waitFor(() => expect(t.argsOf("day_timeline").some((a) => a.kind === "vehicles")).toBe(true));
    await waitFor(() => expect(screen.getByText("In garage")).toBeTruthy());
    expect(screen.getByTestId("where").textContent).toBe("/schedule?date=2026-10-24&kind=vehicles");
  });

  it("someone who cannot open tasks sees the bars without links; a phone shows one card per row", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const t = new FakeTransport({ day_timeline: timeline("drivers") });
    mount(<Schedule />, t, { url: "/schedule?date=2026-10-24", path: "/schedule", me: { name: "Viewer", role: "viewer", permissions: ["view"], tools: ["day_timeline"] } });
    await waitFor(() => expect(screen.getByTestId("sched-cards")).toBeTruthy());
    const rows = screen.getAllByTestId("sched-booking");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tagName !== "A")).toBe(true);
    expect(rows[0].textContent).toContain("08:00–11:00 · Planned · WP CAB-4521");
    expect(rows[0].textContent).toContain("Anoja");
    expect(screen.getByText("Free all day")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Asks" })).toBeNull();
  });
});
