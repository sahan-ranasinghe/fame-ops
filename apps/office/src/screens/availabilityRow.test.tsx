// Part 3b (H2, H3): Who's available with the one driver row (the status now, the window's "Not available · …", last seen,
// the usual start, the next task) and Ask drivers in its header: the window, the page's task or request, the ticked drivers
// or all the free ones. The ticks sit beside the row's button, never inside it.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Availability, AvailableDriver } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { askWindow, windowLine } from "./availabilityLogic";
import { AvailabilityPanel, panelAskLink } from "./AvailabilityPanel";

type Args = Record<string, unknown>;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(private answer: Availability) {}
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(structuredClone(this.answer) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["availability", "ask_drivers"] };

const row = (name: string, username: string, over: Partial<AvailableDriver> = {}): AvailableDriver => ({
  name, username, state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true, ...over,
});

const answer: Availability = {
  as_of: "20 Oct 08:00",
  window: { from: "Wed 21 Oct 09:00", until: "12:00", day: "2026-10-21" },
  drivers: [
    row("Kamal Perera", "kamal.p", {
      rank: 1,
      now_status: { kind: "on_duty", text: "On duty since 07:12" },
      last_seen: "Last seen 08:01 near Kadawatha",
      usual_start: "07:40",
      next_task: { title: "Team drop", when: "Wed 21 Oct 14:30" },
      phone: { phone: "+94771112222", phone_display: "077 111 2222", call: "tel:+94771112222", whatsapp: "https://wa.me/94771112222" },
    }),
    row("Ruwan Jaya", "ruwan.j", {
      state: "off_duty", status_text: "Off duty", free: false,
      now_status: { kind: "off_duty", text: "Off duty" },
      not_available: "Not available · half day, back 13:00",
    }),
  ],
  counts: { free: 1, on_duty: 1, all: 2 },
  vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
};

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Who's available: the one driver row and Ask drivers (H2, H3)", () => {
  it("each row: the status now, the window's not available, last seen · usual start, the next task; the window's line said once", async () => {
    const t = new FakeTransport(answer);
    const onPick = vi.fn();
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me: dispatcher, noConnector: false }}>
        <ToastProvider><MemoryRouter><AvailabilityPanel args={{ at: "2026-10-21 09:00", until: "12:00" }} askFor={{ task: "t9" }} onPick={onPick} /></MemoryRouter></ToastProvider>
      </FleetProvider>,
    );
    await settle(400);
    await settle();
    const [kamal, ruwan] = screen.getAllByTestId("avail-row");
    expect(kamal.tagName).toBe("BUTTON");
    expect(within(kamal).getByTestId("drow-status").textContent).toBe("On duty since 07:12");
    expect(within(kamal).getByTestId("drow-facts").textContent).toBe("Last seen 08:01 near Kadawatha · usually starts 07:40");
    expect(within(kamal).getByTestId("drow-next").textContent).toBe("Next: Team drop · Wed 21 Oct 14:30");
    // "On duty since 07:12" is the chip; the window's line does not say it again.
    expect(kamal.textContent?.match(/On duty since 07:12/g)).toHaveLength(1);
    expect(within(ruwan).getByTestId("drow-not-available").textContent).toBe("Not available · half day, back 13:00");
    expect(ruwan.textContent).toContain("Busy");

    // Ask drivers: all the free ones for the window and the task; then the ticked ones.
    const ask = screen.getByTestId("avail-ask");
    expect(ask.getAttribute("href")).toBe("/drivers/ask?kind=free_for_trip&all_free=1&date=2026-10-21&from=09%3A00&to=12%3A00&task=t9");
    const tick = screen.getByLabelText("Ask Ruwan Jaya");
    expect(kamal.contains(tick) || ruwan.contains(tick)).toBe(false);
    fireEvent.click(tick);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("avail-ask").getAttribute("href")).toBe("/drivers/ask?kind=free_for_trip&drivers=ruwan.j&date=2026-10-21&from=09%3A00&to=12%3A00&task=t9");
    expect(screen.getByTestId("avail-ask").textContent).toBe("Ask drivers · 1 ticked");
    fireEvent.click(kamal);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("no ask_drivers: no ticks and no Ask link", async () => {
    const me: Me = { ...dispatcher, tools: ["availability"] };
    const t = new FakeTransport(answer);
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
        <ToastProvider><MemoryRouter><AvailabilityPanel args={{ at: "2026-10-21 09:00" }} /></MemoryRouter></ToastProvider>
      </FleetProvider>,
    );
    await settle(400);
    await settle();
    expect(screen.getAllByTestId("avail-row")).toHaveLength(2);
    expect(screen.queryByTestId("avail-ask")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("the panel's pure parts", () => {
  it("the window's line drops the status the chip already says", () => {
    const d = row("Kamal Perera", "kamal.p", { next_task_start: "13:00", accepted_today: 1 });
    expect(windowLine(d)).toBe("On duty since 07:12 · next task 13:00 · 1 accepted");
    expect(windowLine({ ...d, now_status: { kind: "on_duty", text: "On duty since 07:12" } })).toBe("next task 13:00 · 1 accepted");
    expect(windowLine({ ...d, now_status: { kind: "on_task", text: "On a task until 10:40" } })).toBe("On duty since 07:12 · next task 13:00 · 1 accepted");
  });

  it("the Ask link's window: the day and time asked, back by when given; else the answer's day", () => {
    expect(askWindow({ at: "2026-10-21 09:00", until: "12:00" })).toEqual({ date: "2026-10-21", from: "09:00", to: "12:00" });
    expect(askWindow({ at: "2026-10-21 09:00" })).toEqual({ date: "2026-10-21", from: "09:00", to: undefined });
    expect(askWindow(null, "2026-10-21")).toEqual({ date: "2026-10-21" });
    expect(panelAskLink({ at: "2026-10-21 09:00" }, undefined, ["kamal.p"], { request: "r1" })).toBe("/drivers/ask?kind=free_for_trip&drivers=kamal.p&date=2026-10-21&from=09%3A00&request=r1");
  });
});
