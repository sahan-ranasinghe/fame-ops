// Part 3b (H1, H2, H5): the Drivers board. Every driver as the one row (status now, last seen, usual start, next task, Call
// and WhatsApp), the filter chips with counts in the URL, the search, the ticks and Ask drivers, New task on each row, the
// board watched every 30 s; the week view (drivers × 7 days, ‹ ›, "+" and a chip open the editor in the page, Save and
// Remove in two clicks), one driver at a time on a phone.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { boardAnswer, LEAVE } from "./__fixtures__/driversBoard";
import { BOARD_REFRESH_MS, DriversBoard } from "./DriversBoard";

type Args = Record<string, unknown>;
type Answer = (args: Args) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(private answers: Record<string, Answer>) {}
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  count(tool: string) {
    return this.calls.filter((c) => c.tool === tool).length;
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const TOOLS = ["drivers_board", "ask_drivers", "set_unavailability", "remove_unavailability", "get_settings", "create_task"];
const dispatcher: Me = { name: "Palitha", email: "palitha@fame.test", role: "office", permissions: ["view", "approve", "assign_tasks"], tools: TOOLS };

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

function transport() {
  return new FakeTransport({
    drivers_board: (a) => boardAnswer(!!a.week_from),
    get_settings: () => ({ settings: { half_day_split: "12:30" }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    set_unavailability: (a) => ({ saved: a.id ? "changed" : "added", entry: { ...LEAVE, id: (a.id as string) ?? "u9", text: "Not available · leave" } }),
    remove_unavailability: () => ({ removed: LEAVE }),
  });
}

async function mount(t: FakeTransport, url: string, me: Me = dispatcher) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes><Route path="/drivers/board" element={<DriversBoard />} /></Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  await settle();
}

const where = () => screen.getByTestId("where").textContent;
const rows = () => screen.getAllByTestId("board-row");
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  // Tuesday 20 October 2026, 08:30 in Colombo.
  vi.useFakeTimers({ now: new Date("2026-10-20T03:00:00Z") });
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
});

describe("the Drivers board: now", () => {
  it("every driver as the one row; the filter chips count and filter (?filter=), the search narrows (?q=)", async () => {
    const t = transport();
    await mount(t, "/drivers/board");
    expect(t.argsOf("drivers_board")).toEqual([{}]);
    expect(rows().map((r) => r.querySelector(".name")?.textContent)).toEqual(["Kamal Perera", "Nuwan Silva", "Sunil Fernando licence expired or due", "Ruwan Jaya"]);
    const kamal = rows()[0];
    expect(within(kamal).getByTestId("drow-status").textContent).toBe("On duty since 07:12");
    expect(kamal.querySelector(".pill")?.className).toContain("ok");
    expect(within(kamal).getByTestId("drow-facts").textContent).toBe("Last seen 17:42 near Kadawatha · usually starts 07:40");
    expect(within(kamal).getByTestId("drow-next").textContent).toBe("Next: Team drop · 14:30");
    expect(kamal.textContent).toContain("WP CAB-4521 today");
    expect(rows()[3].querySelector(".pill")?.className).toContain("warn");
    // Call and WhatsApp beside Kamal's row (he has a number), none for the others.
    expect(screen.getAllByTestId("board-contact")).toHaveLength(1);
    expect(screen.getByTestId("board-contact").textContent).toContain("077 111 2222");
    // New task with the driver picked.
    expect(screen.getAllByRole("link", { name: "New task" })[0].getAttribute("href")).toBe("/tasks/new?driver=kamal.p");

    const filters = within(screen.getByRole("group", { name: "Filter" }));
    expect(filters.getAllByRole("button").map((b) => b.textContent)).toEqual(["All · 4", "Free now · 1", "On a task · 1", "Off duty · 1", "Not available · 1"]);
    fireEvent.click(filters.getByRole("button", { name: "Free now · 1" }));
    await settle();
    expect(where()).toBe("/drivers/board?filter=free_now");
    expect(rows().map((r) => r.querySelector(".name")?.textContent)).toEqual(["Kamal Perera"]);
    // Filters are local: no new call.
    expect(t.count("drivers_board")).toBe(1);

    fireEvent.click(filters.getByRole("button", { name: "All · 4" }));
    fireEvent.change(screen.getByLabelText("Find a driver"), { target: { value: "silva" } });
    await settle(400);
    expect(where()).toBe("/drivers/board?q=silva");
    expect(rows().map((r) => r.querySelector(".name")?.textContent)).toEqual(["Nuwan Silva"]);
    expect(filters.getAllByRole("button").map((b) => b.textContent)).toEqual(["All · 1", "Free now · 0", "On a task · 1", "Off duty · 0", "Not available · 0"]);
  });

  it("Ask drivers: all the free ones until some are ticked, then the ticked ones", async () => {
    await mount(transport(), "/drivers/board");
    const ask = screen.getByTestId("board-ask");
    expect(ask.getAttribute("href")).toBe("/drivers/ask?all_free=1");
    expect(ask.textContent).toBe("Ask drivers · all free");
    fireEvent.click(screen.getByLabelText("Ask Kamal Perera"));
    fireEvent.click(screen.getByLabelText("Ask Ruwan Jaya"));
    expect(screen.getByTestId("board-ask").getAttribute("href")).toBe("/drivers/ask?drivers=kamal.p%2Cruwan.j");
    expect(screen.getByTestId("board-ask").textContent).toBe("Ask drivers · 2 ticked");
    fireEvent.click(screen.getByLabelText("Ask Kamal Perera"));
    expect(screen.getByTestId("board-ask").getAttribute("href")).toBe("/drivers/ask?drivers=ruwan.j");
  });

  it("is fetched again every 30 s while open", async () => {
    const t = transport();
    await mount(t, "/drivers/board");
    expect(t.count("drivers_board")).toBe(1);
    await settle(BOARD_REFRESH_MS);
    expect(t.count("drivers_board")).toBe(2);
  });

  it("without ask_drivers or assign_tasks: no ticks, no Ask, no New task", async () => {
    const approver: Me = { ...dispatcher, permissions: ["view", "approve"], tools: ["drivers_board"] };
    await mount(transport(), "/drivers/board", approver);
    expect(screen.queryByTestId("board-ask")).toBeNull();
    expect(screen.queryByLabelText("Ask Kamal Perera")).toBeNull();
    expect(screen.queryByRole("link", { name: "New task" })).toBeNull();
  });
});

describe("the Drivers board: the week", () => {
  it("drivers × 7 days from this week's Monday: each day's tasks and entries; ‹ › a week at a time", async () => {
    const t = transport();
    await mount(t, "/drivers/board?view=week");
    expect(t.argsOf("drivers_board").at(-1)).toEqual({ week_from: "2026-10-19" });
    expect(screen.getByTestId("week-label").textContent).toBe("19 – 25 Oct 2026");
    const table = screen.getByTestId("week-table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Driver", "Mon 19 Oct", "Tue 20 Oct", "Wed 21 Oct", "Thu 22 Oct", "Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
    const weekRows = screen.getAllByTestId("week-row");
    expect(weekRows).toHaveLength(4);
    const kamalTue = within(weekRows[0]).getAllByRole("cell")[1];
    expect(kamalTue.textContent).toContain("Half day · until 13:00");
    expect(within(kamalTue).getAllByRole("link").map((a) => a.textContent)).toEqual(["09:00 Team drop", "14:30 Site visit"]);
    // Monday has passed: no "+" there; Tuesday (today) has one.
    expect(within(within(weekRows[0]).getAllByRole("cell")[0]).queryByRole("button")).toBeNull();
    expect(within(kamalTue).getByRole("button", { name: "Kamal Perera not available Tue 20 Oct" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await settle();
    expect(where()).toBe("/drivers/board?view=week&from=2026-10-26");
    expect(t.argsOf("drivers_board").at(-1)).toEqual({ week_from: "2026-10-26" });
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    await settle();
    expect(where()).toBe("/drivers/board?view=week");
  });

  it("“+” adds an entry for that driver and day in the page: When from half_day_split, Save → set_unavailability", async () => {
    const t = transport();
    await mount(t, "/drivers/board?view=week");
    const ruwanFri = within(screen.getAllByTestId("week-row")[3]).getAllByRole("cell")[4];
    expect(ruwanFri.textContent).toBe("+");
    fireEvent.click(within(ruwanFri).getByRole("button", { name: "Ruwan Jaya not available Fri 23 Oct" }));
    await settle();
    const editor = screen.getByTestId("unav-editor");
    expect(within(editor).getByRole("heading").textContent).toBe("Not available · Ruwan Jaya");
    expect((within(editor).getByLabelText("Day") as HTMLInputElement).value).toBe("2026-10-23");
    fireEvent.click(within(editor).getByRole("button", { name: "Morning until 12:30" }));
    // A morning has no last day.
    expect(within(editor).queryByLabelText(/Last day/)).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "Half day" }));
    fireEvent.change(within(editor).getByLabelText(/Note/), { target: { value: "Clinic" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await settle();
    expect(t.argsOf("set_unavailability")).toEqual([{ driver: "ruwan.j", date: "2026-10-23", part: "morning", reason: "half_day", note: "Clinic" }]);
    expect(screen.queryByTestId("unav-editor")).toBeNull();
  });

  it("a chip opens the entry to change it; Remove asks for a second click; a refused save says why and stays open", async () => {
    const t = transport();
    await mount(t, "/drivers/board?view=week");
    fireEvent.click(screen.getAllByRole("button", { name: "Ruwan Jaya, Wed 21 Oct: Not available · leave. Change or remove" })[0]);
    await settle();
    const editor = screen.getByTestId("unav-editor");
    expect((within(editor).getByLabelText(/Last day/) as HTMLInputElement).value).toBe("2026-10-22");
    expect(editor.textContent).toContain("Added by Ruwan Jaya (the driver)");
    // From–to with no times: said at once, nothing sent.
    fireEvent.click(within(editor).getByRole("button", { name: "From–to" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save changes" }));
    await settle();
    expect(editor.textContent).toContain("Give the time from and the time to.");
    expect(t.count("set_unavailability")).toBe(0);
    fireEvent.click(within(editor).getByRole("button", { name: "Full day" }));
    const remove = within(editor).getByTestId("unav-remove");
    fireEvent.click(remove);
    expect(remove.textContent).toBe("Remove? Click again");
    expect(t.count("remove_unavailability")).toBe(0);
    fireEvent.click(remove);
    await settle();
    expect(t.argsOf("remove_unavailability")).toEqual([{ id: "u1" }]);
    expect(screen.queryByTestId("unav-editor")).toBeNull();
  });

  it("on a phone: one driver at a time, the days stacked", async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    await mount(transport(), "/drivers/board?view=week");
    expect(screen.queryByTestId("week-table")).toBeNull();
    const days = () => screen.getAllByTestId("week-day");
    expect(days()).toHaveLength(7);
    expect(days()[1].textContent).toContain("Tue 20 Oct · today");
    expect(days()[1].textContent).toContain("09:00 Team drop");
    fireEvent.change(screen.getByLabelText("Driver"), { target: { value: "ruwan.j" } });
    expect(days()[2].textContent).toContain("Leave · all day");
    expect(days()[1].textContent).not.toContain("Team drop");
  });
});
