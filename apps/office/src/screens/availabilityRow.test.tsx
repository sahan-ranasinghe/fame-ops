// Part 3b (H2, H3): Who's available with the one driver row (the status now, the window's "Not available · …", last seen,
// the usual start, the next task). Hotfix 4 (c): no tick boxes on the rows; Ask drivers opens a sheet with its own list (the
// free ones ticked), the window and the page's task; the answers come back as chips under the rows, a Yes with "Use this
// driver".
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Ask, Availability, AvailableDriver } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { askWindow, windowLine } from "./availabilityLogic";
import { AvailabilityPanel } from "./AvailabilityPanel";

type Args = Record<string, unknown>;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  /** ask_answers' answer once a driver has answered. */
  answered: Ask | null = null;
  constructor(private answer: Availability) {}
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "ask_drivers") return Promise.resolve({ ask: sentAsk, next: "" } as T);
    if (tool === "ask_answers") return Promise.resolve({ ask: this.answered ?? sentAsk, total: 1 } as T);
    return Promise.resolve(structuredClone(this.answer) as T);
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void, intervalMs = 0): () => void {
    const once = () => void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    once();
    // Asked again on its interval, as the real transports do.
    const timer = intervalMs > 0 ? setInterval(once, intervalMs) : null;
    return () => {
      if (timer) clearInterval(timer);
    };
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

const sentAsk: Ask = {
  id: "a1", kind: "free_for_trip", question: "Free for a trip Wed 21 Oct 09:00–12:00?", trip: { date: "2026-10-21", from: "09:00", to: "12:00" },
  task_id: "t9", asked_by: "Palitha", asked: "08:00", asked_day: "Today", expires: "Wed 21 Oct 09:00",
  counts: { asked: 1, seen: 0, answered: 0, yes: 0 },
  drivers: [{ name: "Kamal Perera", username: "kamal.p", sent: "08:00", state: "sent" }],
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

    // No tick boxes on the rows; a click picks.
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(kamal);
    expect(onPick).toHaveBeenCalledTimes(1);

    // Ask drivers: a sheet with its own list, the free one ticked, the window and the task.
    fireEvent.click(screen.getByTestId("avail-ask"));
    const sheet = screen.getByRole("dialog", { name: "Ask drivers" });
    expect((within(sheet).getByLabelText("Ask Kamal Perera") as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByLabelText("Ask Ruwan Jaya") as HTMLInputElement).checked).toBe(false);
    expect((within(sheet).getByLabelText("Day") as HTMLInputElement).value).toBe("2026-10-21");
    vi.setSystemTime(new Date("2026-10-20T08:00:00+05:30"));
    fireEvent.click(within(sheet).getByTestId("sheet-send"));
    await settle();
    expect(t.calls.find((c) => c.tool === "ask_drivers")?.args).toEqual({ kind: "free_for_trip", date: "2026-10-21", from: "09:00", to: "12:00", drivers: ["kamal.p"], task_id: "t9" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("avail-ask-status").textContent).toContain("Free for a trip Wed 21 Oct 09:00–12:00?");
    expect(within(screen.getAllByTestId("avail-answer")[0]).getByText(/waiting/)).toBeTruthy();

    // Kamal says Yes: the chip under his row and "Use this driver", which picks him.
    t.answered = { ...sentAsk, counts: { asked: 1, seen: 1, answered: 1, yes: 1 },
      drivers: [{ name: "Kamal Perera", username: "kamal.p", sent: "08:00", seen: "08:02", answered: "08:03", answer: "yes", answer_text: "Yes", answer_time: "08:03", assignable: true, state: "answered" }] };
    await settle(60_000);
    await settle();
    expect(screen.getAllByTestId("avail-answer")[0].textContent).toContain("Yes");
    fireEvent.click(screen.getByTestId("avail-use"));
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick.mock.calls[1][0].username).toBe("kamal.p");
  });

  it("no ask_drivers: no ticks and no Ask button", async () => {
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

  it("the question's window: the day and time asked, back by when given; else the answer's day", () => {
    expect(askWindow({ at: "2026-10-21 09:00", until: "12:00" })).toEqual({ date: "2026-10-21", from: "09:00", to: "12:00" });
    expect(askWindow({ at: "2026-10-21 09:00" })).toEqual({ date: "2026-10-21", from: "09:00", to: undefined });
    expect(askWindow(null, "2026-10-21")).toEqual({ date: "2026-10-21" });
  });
});
