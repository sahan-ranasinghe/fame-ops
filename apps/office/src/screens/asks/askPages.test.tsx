// Part 3b (H3) on the pages: Ask drivers from a link (the chips with the board's names, Add drivers, All free ones, Send →
// ask_drivers → the answers page, a refusal in words), the answers page (the chips, the shared point, Assign, live through
// Realtime on the web and every 10 s in the artifact), the questions list, and the routes the ask.answered notification
// opens on both builds.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, matchRoutes, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../../app/FleetContext";
import { routes } from "../../app/routes";
import { linkOf } from "../../data/inboxLogic";
import { FleetStore } from "../../data/store";
import type { Ask, AskDriverRow, DriversBoard } from "../../data/types";
import { addDays, today } from "../../lib/format";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import { AskAnswers } from "./AskAnswers";
import { AskDrivers } from "./AskDrivers";
import { AskList } from "./AskList";

type Answer = (args: Record<string, unknown>, n: number) => unknown;

class FakeTransport implements Transport {
  readonly kind: "api" | "claude";
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  watches: { tool: string; args: Record<string, unknown>; every: number }[] = [];
  constructor(public answers: Record<string, Answer>, private person: Me, kind: "api" | "claude" = "api") {
    this.kind = kind;
  }
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
    try {
      return Promise.resolve(structuredClone(a(args, this.argsOf(tool).length)) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  /** Now and every `every` ms, as both transports do. */
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, every: number): () => void {
    this.watches.push({ tool, args, every });
    const once = () => void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    once();
    const timer = setInterval(once, every);
    return () => clearInterval(timer);
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = {
  name: "Palitha", role: "fleet_admin", permissions: ["view", "approve", "assign_tasks"],
  tools: ["drivers_board", "ask_drivers", "ask_answers", "update_task", "decide_request", "create_task"],
};

const board: DriversBoard = {
  as_of: "10:00", filter: "all", count: 3,
  counts: { all: 3, free_now: 1, on_task: 1, off_duty: 1, not_available: 0 },
  drivers: [
    { name: "Nuwan Perera", username: "nuwan.p", status: { kind: "on_task", text: "On a task until 15:40" }, free_now: false, licence: { chip: "ok" } },
    { name: "Kamal Silva", username: "kamal", status: { kind: "on_duty", text: "On duty since 07:12" }, free_now: true, licence: { chip: "ok" } },
    { name: "Sunil Fernando", username: "sunil", status: { kind: "off_duty", text: "Off duty" }, free_now: false, licence: { chip: "ok" } },
  ],
};

const row = (over: Partial<AskDriverRow>): AskDriverRow => ({ name: "Kamal Silva", username: "kamal", sent: "10:02", state: "sent", ...over });
const links = { phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" };
const tripDay = addDays(today(), 2);
const ask = (over: Partial<Ask> = {}): Ask => ({
  id: "a1", kind: "free_for_trip", question: "Free for a trip Tue 20 Oct 09:00–12:00?", note: "Six people to Kurunegala",
  trip: { date: tripDay, from: "09:00", to: "12:00" }, task_id: "t1", asked_by: "Palitha", asked: "10:02", asked_day: "Sun 18 Oct",
  expires: "Tue 20 Oct 09:00", counts: { asked: 5, seen: 4, answered: 4, yes: 1 },
  drivers: [
    row({ answer: "yes", answer_text: "Yes", seen: "10:03", answered: "10:05", state: "answered", assignable: true, links }),
    row({ name: "Nuwan Perera", username: "nuwan.p", answer: "no", answer_text: "No", seen: "10:03", answered: "10:04", state: "answered" }),
    row({ name: "Sunil Fernando", username: "sunil", answer: "call_me", answer_text: "Call me", seen: "10:04", answered: "10:06", state: "answered", links }),
    row({
      name: "Ruwan Jayasena", username: "ruwan", answer: "location", answer_text: "Shared where they are", seen: "10:04", answered: "10:07", state: "answered",
      location: { lat: 7.0, lng: 79.95, accuracy_m: 12, near: "Kadawatha", map: "https://www.google.com/maps/search/?api=1&query=7,79.95" },
    }),
    row({ name: "Saman Kumara", username: "saman" }),
  ],
  ...over,
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

function mount(transport: FakeTransport, url: string, extra: Partial<Fleet> = {}, me: Me = dispatcher) {
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false, ...extra }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/drivers/ask" element={<AskDrivers />} />
            <Route path="/drivers/asks" element={<AskList />} />
            <Route path="/drivers/asks/:id" element={<AskAnswers />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Ask drivers (/drivers/ask)", () => {
  const transport = () => new FakeTransport({
    drivers_board: () => board,
    ask_drivers: (a) => ({ ask: ask({ id: "a7", drivers: ((a.drivers as string[]) ?? []).map((u) => row({ username: u, name: u })) }), next: "The drivers get a push." }),
    ask_answers: () => ({ ask: ask({ id: "a7" }) }),
  }, dispatcher);

  // The first test pays for importing the pages (slow while the full suite runs): 20 s.
  it("opens from the link: the trip and the drivers as chips with their names; Add drivers ticks one in; Send asks and opens the answers", async () => {
    const t = transport();
    mount(t, `/drivers/ask?kind=free_for_trip&drivers=kamal&date=${tripDay}&from=09:00&to=12:00&task=t1`);
    // Round 48: the board is asked for the trip's window, 400 ms after the last edit.
    await settle(400);
    expect(screen.getByTestId("ask-kind-free_for_trip").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("group", { name: "Day" }).getAttribute("data-value")).toBe(tripDay);
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("09:00");
    expect(screen.getByTestId("ask-picked").textContent).toContain("Kamal Silva");
    expect(screen.getByRole("link", { name: "this task" }).getAttribute("href")).toBe("/tasks/t1");

    fireEvent.click(screen.getByTestId("add-drivers"));
    const rows = screen.getAllByTestId("picker-row");
    // The free ones first, each with the status now.
    expect(rows.map((r) => r.querySelector(".name")?.textContent)).toEqual(["Kamal SilvaFree now", "Nuwan Perera", "Sunil Fernando"]);
    expect(rows.map((r) => r.querySelector(".sub")?.textContent)).toEqual(["On duty since 07:12", "On a task until 15:40", "Off duty"]);
    expect((within(rows[0]).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Find a driver"), { target: { value: "sun" } });
    expect(screen.getAllByTestId("picker-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Kamal Silva" }));
    expect(screen.getByTestId("ask-picked").textContent).toBe("Nuwan Perera");
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: "Six people to Kurunegala" } });

    fireEvent.click(screen.getByTestId("ask-send"));
    await settle();
    expect(t.argsOf("ask_drivers")).toEqual([{ kind: "free_for_trip", date: tripDay, from: "09:00", to: "12:00", note: "Six people to Kurunegala", drivers: ["nuwan.p"], task_id: "t1" }]);
    expect(screen.getByTestId("where").textContent).toBe("/drivers/asks/a7");
    expect(screen.getByTestId("ask-answers")).toBeTruthy();
  }, 20_000);

  it("All free ones: no drivers named; another question takes no trip; a refusal is said in words", async () => {
    const t = transport();
    t.answers.ask_drivers = () => { throw { code: "tool_error", message: "No driver is on duty and free now." }; };
    mount(t, "/drivers/ask?drivers=kamal&request=r4");
    // Round 48: the board is asked for the trip's window, 400 ms after the last edit.
    await settle(400);
    fireEvent.click(screen.getByTestId("ask-kind-where_now"));
    expect(screen.queryByLabelText("Day")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All free ones" }));
    expect(screen.getByTestId("all-free-line").textContent).toBe("Every driver on duty and not on a task now (1 now).");
    fireEvent.click(screen.getByTestId("ask-send"));
    await settle();
    expect(t.argsOf("ask_drivers")).toEqual([{ kind: "where_now", all_free: true, request_id: "r4" }]);
    expect(screen.getByText("No driver is on duty and free now.")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/drivers/ask?drivers=kamal&request=r4");
  });

  it("nothing is sent while the form is not complete: no From for a trip, no drivers", async () => {
    const t = transport();
    mount(t, `/drivers/ask?date=${tripDay}`);
    // Round 48: the board is asked for the trip's window, 400 ms after the last edit.
    await settle(400);
    fireEvent.click(screen.getByTestId("ask-send"));
    expect(screen.getByText("Add the time the trip starts (From).")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ask-kind-office_time"));
    fireEvent.click(screen.getByTestId("ask-send"));
    expect(screen.getByText("Add the drivers to ask, or choose All free ones.")).toBeTruthy();
    expect(t.argsOf("ask_drivers")).toEqual([]);
  });
});

describe("the answers (/drivers/asks/:id)", () => {
  it("the question, who asked, open until, the counts; each driver's answer as a chip with Call, the shared point and Assign on a Yes", async () => {
    const t = new FakeTransport({ ask_answers: () => ({ ask: ask() }) }, dispatcher);
    mount(t, "/drivers/asks/a1");
    await settle();
    expect(t.argsOf("ask_answers")[0]).toEqual({ ask_id: "a1" });
    expect(screen.getByRole("heading", { name: "Free for a trip Tue 20 Oct 09:00–12:00?" })).toBeTruthy();
    expect(screen.getByTestId("ask-asked").textContent).toBe("Asked by Palitha · Sun 18 Oct 10:02");
    expect(screen.getByText("Open until Tue 20 Oct 09:00")).toBeTruthy();
    expect(screen.getByTestId("ask-counts").getAttribute("aria-label")).toBe("5 asked · 4 seen · 4 answered · 1 yes");
    const rows = screen.getAllByTestId("ask-row");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("Yes").className).toBe("pill ok");
    expect(rows[0].textContent).toContain("Sent 10:02 · Seen 10:03 · Answered 10:05");
    expect(within(rows[0]).getByTestId("ask-assign").getAttribute("href")).toBe("/tasks/t1/edit?driver=kamal");
    expect(within(rows[0]).getByRole("link", { name: "WhatsApp" })).toBeTruthy();
    expect(within(rows[1]).getByText("No").className).toBe("pill ");
    expect(within(rows[1]).queryByTestId("ask-assign")).toBeNull();
    expect(within(rows[2]).getByText("Call me").className).toBe("pill warn");
    expect(within(rows[3]).getByTestId("ask-location").textContent).toBe("near Kadawatha · ±12 m · Map");
    expect(within(rows[3]).getByRole("link", { name: "Map" }).getAttribute("href")).toContain("google.com/maps");
    expect(rows[4].textContent).toContain("No answer yet");
    expect(rows[4].textContent).toContain("Sent 10:02");
  });

  it("closed: no Assign; a question with no task or request assigns as a new task on the trip's day and time", async () => {
    const t = new FakeTransport({ ask_answers: () => ({ ask: ask({ task_id: undefined }) }) }, dispatcher);
    mount(t, "/drivers/asks/a1");
    await settle();
    expect(screen.getAllByTestId("ask-assign")[0].getAttribute("href")).toBe(`/tasks/new?driver=kamal&date=${tripDay}&time=09%3A00`);
    t.answers.ask_answers = () => ({ ask: ask({ expired: true, drivers: [row({ answer: "yes", answer_text: "Yes", state: "answered" })] }) });
    await settle(10_000);
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.queryByTestId("ask-assign")).toBeNull();
  });

  it("the web: a Realtime change on the question's rows asks again at once (a slow poll behind it)", async () => {
    const hook: { changed?: () => void } = {};
    const subscribed: string[] = [];
    const askAnswers = (id: string, cb: () => void) => {
      subscribed.push(id);
      hook.changed = cb;
      return () => {};
    };
    const t = new FakeTransport({ ask_answers: () => ({ ask: ask() }) }, dispatcher);
    mount(t, "/drivers/asks/a1", { realtime: { driverLatest: () => () => {}, askAnswers } });
    await settle();
    expect(subscribed).toEqual(["a1"]);
    expect(t.watches).toEqual([{ tool: "ask_answers", args: { ask_id: "a1" }, every: 60_000 }]);
    expect(screen.getAllByTestId("ask-row")[4].textContent).toContain("No answer yet");
    t.answers.ask_answers = () => ({ ask: ask({ drivers: [...ask().drivers.slice(0, 4), row({ name: "Saman Kumara", username: "saman", answer: "yes", answer_text: "Yes", seen: "10:08", answered: "10:09", state: "answered", assignable: true })] }) });
    act(() => { hook.changed?.(); hook.changed?.(); });
    await settle(500);
    expect(t.argsOf("ask_answers")).toHaveLength(2);
    expect(screen.getAllByTestId("ask-row")[4].textContent).toContain("Answered 10:09");
    expect(within(screen.getAllByTestId("ask-row")[4]).getByTestId("ask-assign").getAttribute("href")).toBe("/tasks/t1/edit?driver=saman");
  });

  it("the artifact (no Realtime): asked again every 10 seconds", async () => {
    const t = new FakeTransport({ ask_answers: () => ({ ask: ask() }) }, dispatcher, "claude");
    mount(t, "/drivers/asks/a1");
    await settle();
    expect(t.watches).toEqual([{ tool: "ask_answers", args: { ask_id: "a1" }, every: 10_000 }]);
  });

  it("a question that is gone says so", async () => {
    const t = new FakeTransport({ ask_answers: () => { throw { code: "tool_error", message: "This question is not there (questions are kept 30 days)." }; } }, dispatcher);
    mount(t, "/drivers/asks/a9");
    await settle();
    expect(screen.getByText("This question is not there (questions are kept 30 days).")).toBeTruthy();
  });
});

describe("the questions list (/drivers/asks)", () => {
  it("the last 7 days, 25 a page, the count, each row opening its answers; Ask drivers", async () => {
    const t = new FakeTransport({ ask_answers: () => ({ count: 2, total: 2, asks: [ask(), ask({ id: "a2", kind: "where_now", question: "Where are you now?", note: undefined, expired: true })] }) }, dispatcher);
    mount(t, "/drivers/asks");
    await settle();
    expect(t.argsOf("ask_answers")[0]).toEqual({ limit: 25 });
    expect(screen.getByTestId("list-count").textContent).toBe(" · 2");
    const rows = screen.getAllByTestId("ask-list-row");
    expect(rows[0].getAttribute("href")).toBe("/drivers/asks/a1");
    expect(rows[0].textContent).toContain("Sun 18 Oct 10:02 · by Palitha · 5 asked · 4 seen · 4 answered · 1 yes");
    expect(rows[0].textContent).toContain("Open until Tue 20 Oct 09:00");
    expect(rows[1].textContent).toContain("Closed");
    expect(screen.getByRole("link", { name: "Ask drivers" }).getAttribute("href")).toBe("/drivers/ask");
  });

  it("none: the empty line", async () => {
    const t = new FakeTransport({ ask_answers: () => ({ count: 0, total: 0, asks: [] }) }, dispatcher);
    mount(t, "/drivers/asks");
    await settle();
    expect(screen.getByTestId("empty-line").textContent).toBe("No questions to drivers in the last 7 days.");
  });
});

describe("the questions list: Mine · Everyone's (Round 4–7, item 10)", () => {
  const mine = ask();
  const theirs = ask({ id: "a9", question: "When can you be at the office?", asked_by: "Anoja" });
  const answers = (a: Record<string, unknown>) => (a.all ? { count: 2, total: 2, asks: [mine, theirs] } : { count: 1, total: 1, mine: true, asks: [mine] });

  it("an approver: Mine by default (the person's own), Everyone's asks all: true, and back; each row still opens its answers", async () => {
    const t = new FakeTransport({ ask_answers: answers }, dispatcher);
    mount(t, "/drivers/asks");
    await settle();
    expect(t.argsOf("ask_answers")[0]).toEqual({ limit: 25 });
    const tabs = screen.getByRole("tablist", { name: "Whose questions" });
    expect(within(tabs).getByRole("tab", { name: "Mine" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId("ask-list-row")).toHaveLength(1);
    fireEvent.click(within(tabs).getByRole("tab", { name: "Everyone's" }));
    await settle();
    expect(t.argsOf("ask_answers").at(-1)).toEqual({ all: true, limit: 25 });
    expect(screen.getByTestId("where").textContent).toBe("/drivers/asks?whose=all");
    expect(screen.getAllByTestId("ask-list-row")).toHaveLength(2);
    expect(screen.getAllByTestId("ask-list-row")[1].getAttribute("href")).toBe("/drivers/asks/a9");
    expect(screen.getByRole("link", { name: "Ask drivers" }).getAttribute("href")).toBe("/drivers/ask");
    fireEvent.click(within(tabs).getByRole("tab", { name: "Mine" }));
    await settle();
    expect(t.argsOf("ask_answers").at(-1)).toEqual({ limit: 25 });
    expect(screen.getByTestId("where").textContent).toBe("/drivers/asks");
  });

  it("without approve: no switch, and never all (even from the address)", async () => {
    const assigner: Me = { ...dispatcher, permissions: ["view", "assign_tasks"] };
    const t = new FakeTransport({ ask_answers: answers }, assigner);
    mount(t, "/drivers/asks?whose=all", {}, assigner);
    await settle();
    expect(screen.queryByRole("tablist", { name: "Whose questions" })).toBeNull();
    expect(t.argsOf("ask_answers").every((a) => !("all" in a))).toBe(true);
    expect(screen.getAllByTestId("ask-list-row")).toHaveLength(1);
  });
});

describe("the routes (both builds use the same list)", () => {
  const leaf = (path: string) => matchRoutes(routes, path)?.at(-1)?.route.path;
  it("ask, asks and a question's answers are never read as a driver; the ask.answered notification's link opens the answers", () => {
    expect(leaf("/drivers/ask")).toBe("drivers/ask");
    expect(leaf("/drivers/asks")).toBe("drivers/asks");
    expect(leaf("/drivers/asks/6f1c2b9e-1d1a-4c3e-9a55-0c7f3d2b8a11")).toBe("drivers/asks/:id");
    expect(leaf("/drivers/kamal")).toBe("drivers/:username");
    const link = linkOf("/drivers/asks/6f1c2b9e-1d1a-4c3e-9a55-0c7f3d2b8a11", "https://fame-fleet.pages.dev");
    expect(link).toEqual({ to: "/drivers/asks/6f1c2b9e-1d1a-4c3e-9a55-0c7f3d2b8a11" });
    expect(leaf((link as { to: string }).to)).toBe("drivers/asks/:id");
  });
});
