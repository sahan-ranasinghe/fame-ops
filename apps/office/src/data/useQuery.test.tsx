// No flicker, no resets (Phase 7, §10): an answer deep-equal to the last one
// keeps its object and re-renders nothing; the answer is keyed by its
// arguments and the last one stays on screen ("Updating…") while new ones
// load; a refetch that answers changed data keeps the same DOM nodes and what
// the person typed or picked, on Who's available and on the decide page.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { AvailabilityPanel } from "../screens/AvailabilityPanel";
import { RequestDecide } from "../screens/RequestDecide";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import type { Availability, AvailableDriver, RequestCard, Suggestions } from "./types";
import { deepEqual, FleetStore } from "./store";
import { useQuery } from "./useQuery";

type Answer = (args: Record<string, unknown>, n: number) => unknown;

/** Answers each tool from a function of its arguments and how many times it was called. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private tools: string[]) {}
  me(): Promise<Me> {
    return Promise.resolve({ name: "Palitha", email: "palitha@fame.test", role: "admin", permissions: ["view", "request", "approve", "assign_tasks", "vehicles"], tools: this.tools });
  }
  count(tool: string) {
    return this.calls.filter((c) => c.tool === tool).length;
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args, this.count(tool))) as T);
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function setup(transport: FakeTransport) {
  const store = new FleetStore(transport);
  const me = await transport.me();
  return { store, me, wrap: (ui: React.ReactNode) => <FleetProvider value={{ store, transport, me, noConnector: false }}><ToastProvider>{ui}</ToastProvider></FleetProvider> };
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

const driver = (name: string, username: string, extra: Partial<AvailableDriver> = {}): AvailableDriver => ({
  name, username, state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true, ...extra,
});

/** Who's available: Kamal (best, brings WP CAB-4521) and Nuwan; from the second answer on, Nuwan's line changes. */
const availability = (_args: Record<string, unknown>, n: number): Availability => ({
  as_of: "16 Oct 08:00",
  window: { from: "Fri 17 Oct 09:00", until: "end of the day", day: "2026-10-17" },
  drivers: [
    driver("Kamal Perera", "kamal.p", { rank: 1, vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } }),
    driver("Nuwan Silva", "nuwan.s", n > 1 ? { state: "on_task", status_text: "On a task until ~10:40", free: false, busy_with: "Team drop 09:00–10:40" } : { rank: 2, vehicle: { reg_no: "WP KL-1234", source: "regular" } }),
  ],
  best: { name: "Kamal Perera", username: "kamal.p", vehicle: { reg_no: "WP CAB-4521", source: "on_duty" }, why: "On duty · free 09:00–end of day · 1 task today" },
  counts: { free: n > 1 ? 1 : 2, on_duty: 2, all: 2 },
  vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
});

describe("the store keeps an answer that did not change", () => {
  it("folds a later answer for the same arguments into the one shown when the query has a merge", async () => {
    let n = 0;
    const transport = new FakeTransport({ count: () => ({ n: ++n, kept: n }) }, ["count"]);
    const store = new FleetStore(transport);
    store.retain("q:count:{}", "count", {}, true, (prev, next) => ({ ...(next as object), kept: (prev as { kept: number }).kept }));
    await store.fetch("q:count:{}", "count", {});
    await store.fetch("q:count:{}", "count", {}, true);
    expect(store.get("q:count:{}").data).toEqual({ n: 2, kept: 1 });
  });

  it("compares answers deep-equal", () => {
    expect(deepEqual({ a: [1, { b: "x" }], c: undefined }, { a: [1, { b: "x" }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it("a refresh with the same data keeps the object and re-renders nothing; changed data replaces it", async () => {
    vi.useFakeTimers();
    let answer = { rows: [{ id: 1, text: "one" }] };
    const transport = new FakeTransport({ thing: () => answer }, []);
    const { wrap } = await setup(transport);
    const seen: unknown[] = [];
    let renders = 0;
    function Probe() {
      const q = useQuery<typeof answer>("thing", "thing", {}, { every: 10_000 });
      renders++;
      if (q.data) seen.push(q.data);
      return <div>{q.data?.rows[0].text ?? "…"}</div>;
    }
    render(wrap(<Probe />));
    await settle();
    expect(screen.getByText("one")).toBeTruthy();
    const before = renders;
    await settle(10_000); // the same answer again
    expect(renders).toBe(before);
    answer = { rows: [{ id: 1, text: "two" }] };
    await settle(10_000);
    expect(screen.getByText("two")).toBeTruthy();
    expect(seen[0]).not.toBe(seen[seen.length - 1]);
    vi.useRealTimers();
  });
});

describe("useQuery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is keyed by its arguments; with keep the last answer stays (stale, Updating…) while new arguments load", async () => {
    const transport = new FakeTransport({ list: (a) => ({ filter: a.filter, rows: [`${a.filter}-1`] }) }, []);
    const { wrap } = await setup(transport);
    function Probe({ filter, keep }: { filter: string; keep: boolean }) {
      const q = useQuery<{ filter: string; rows: string[] }>("list", "list", { filter }, { debounce: 400, keep });
      return <div data-testid="probe">{q.loading ? "Loading" : `${q.data?.rows.join(",")}${q.stale ? " (stale)" : ""}${q.updating ? " · Updating…" : ""}`}</div>;
    }
    const { rerender } = render(wrap(<Probe filter="a" keep />));
    expect(screen.getByTestId("probe").textContent).toBe("Loading");
    await settle(400);
    expect(screen.getByTestId("probe").textContent).toBe("a-1");
    rerender(wrap(<Probe filter="b" keep />));
    expect(screen.getByTestId("probe").textContent).toBe("a-1 (stale) · Updating…");
    await settle(400);
    expect(screen.getByTestId("probe").textContent).toBe("b-1");
    // Without keep a changed filter never shows another filter's rows.
    rerender(wrap(<Probe filter="c" keep={false} />));
    expect(screen.getByTestId("probe").textContent).toBe("Loading");
    await settle(400);
    expect(screen.getByTestId("probe").textContent).toBe("c-1");
  });

  it("waits for typed input to settle, and refetch goes at once", async () => {
    const transport = new FakeTransport({ search: (a) => ({ text: a.text }) }, []);
    const { wrap } = await setup(transport);
    let refetch = () => {};
    function Probe({ text }: { text: string }) {
      const q = useQuery<{ text: string }>("search", "search", { text }, { debounce: 1500, keep: true });
      refetch = q.refetch;
      return <div data-testid="probe">{q.data?.text ?? "-"}</div>;
    }
    const { rerender } = render(wrap(<Probe text="K" />));
    rerender(wrap(<Probe text="Ku" />));
    rerender(wrap(<Probe text="Kur" />));
    await settle(1000);
    expect(transport.count("search")).toBe(0);
    await settle(500);
    expect(transport.calls.map((c) => c.args.text)).toEqual(["Kur"]);
    rerender(wrap(<Probe text="Kuru" />));
    act(() => refetch());
    await settle();
    expect(screen.getByTestId("probe").textContent).toBe("Kuru");
    await settle(2000);
    expect(transport.count("search")).toBe(2); // the waiting fetch went at once instead, not twice
  });
});

describe("Who's available: a refresh keeps the nodes and the choices", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the same DOM nodes stay through a refresh with changed data; the pick and a typed value stay", async () => {
    const transport = new FakeTransport({ availability }, ["availability"]);
    const { wrap } = await setup(transport);
    const used: string[] = [];
    function Form() {
      const [picked, setPicked] = useState("");
      const [note, setNote] = useState("");
      return (
        <>
          <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <AvailabilityPanel args={{ at: "2026-10-17 09:00" }} picked={picked} onPick={(d) => setPicked(d.username ?? "")}
            onUse={(b, v) => { used.push(`${b.username} ${v?.reg_no} ${v?.why}`); setPicked(b.username ?? ""); }} />
        </>
      );
    }
    render(wrap(<Form />));
    await settle(400);
    const panel = screen.getByTestId("availability");
    const rows = screen.getAllByTestId("avail-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("1Kamal Perera");
    expect(rows[0].textContent).toContain("WP CAB-4521 Kamal's vehicle today");
    expect(rows[1].textContent).toContain("2Nuwan Silva");
    expect(rows[1].textContent).toContain("WP KL-1234 Nuwan's regular vehicle");
    expect(screen.getByTestId("best-match").textContent).toContain("WP CAB-4521 Kamal's vehicle today");
    fireEvent.click(screen.getByRole("button", { name: "Use suggestion" }));
    expect(used).toEqual(["kamal.p WP CAB-4521 Kamal's vehicle today"]);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Gate 2" } });

    await settle(60_000); // the quiet refresh: Nuwan is now busy
    expect(transport.count("availability")).toBe(2);
    expect(screen.getByTestId("availability")).toBe(panel);
    const after = screen.getAllByTestId("avail-row");
    expect(after[0]).toBe(rows[0]); // Kamal's row: the same node
    expect(after[1]).toBe(rows[1]); // Nuwan's row: the same node, new words
    expect(after[1].textContent).toContain("Busy");
    expect(after[0].getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("Gate 2");
    expect(screen.queryByText("Looking who is free…")).toBeNull();
  });

  it("new arguments keep the rows on screen with Updating…, never a Loading block", async () => {
    const transport = new FakeTransport({ availability }, ["availability"]);
    const { wrap } = await setup(transport);
    const { rerender } = render(wrap(<AvailabilityPanel args={{ at: "2026-10-17 09:00" }} />));
    await settle(400);
    const rows = screen.getAllByTestId("avail-row");
    rerender(wrap(<AvailabilityPanel args={{ at: "2026-10-17 09:30" }} />));
    expect(screen.getByTestId("avail-updating")).toBeTruthy();
    expect(screen.queryByText("Looking who is free…")).toBeNull();
    expect(screen.getAllByTestId("avail-row")[0]).toBe(rows[0]);
    await settle(400);
    expect(screen.queryByTestId("avail-updating")).toBeNull();
    expect(screen.getAllByTestId("avail-row")[0]).toBe(rows[0]);
  });
});

describe("Who's available: two drivers side by side (hotfix, 17 October 2026)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Kamal and Nuwan parked together: each answer ranks the other one first, as their GPS wanders. */
  const swapping = (_args: Record<string, unknown>, n: number): Availability => {
    const kamalFirst = n % 2 === 1;
    const kamal = driver("Kamal Perera", "kamal.p", { rank: kamalFirst ? 1 : 2, vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } });
    const nuwan = driver("Nuwan Perera", "nuwan.p", { rank: kamalFirst ? 2 : 1, vehicle: { reg_no: "WP KL-1234", source: "regular" } });
    const top = kamalFirst ? kamal : nuwan;
    return {
      as_of: "17 Oct 08:00",
      window: { from: "Sat 17 Oct 09:00", until: "end of the day", day: "2026-10-17" },
      drivers: [kamal, nuwan, driver("Kamal Silva", "kamal.s", { state: "off_duty", status_text: "Off duty", vehicle: { reg_no: "WP PH-2087", source: "regular" } })],
      best: { name: top.name, username: top.username, vehicle: top.vehicle, why: `On duty · ${kamalFirst ? "0.4" : "0.3"} km from the pickup` },
      counts: { free: 3, on_duty: 2, all: 3 },
      vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
    };
  };

  it("the rows and the best match stay put through refreshes; a click picks a row with the vehicle they bring", async () => {
    const transport = new FakeTransport({ availability: swapping }, ["availability"]);
    const { wrap } = await setup(transport);
    const picks: string[] = [];
    function Form() {
      const [picked, setPicked] = useState("");
      return <AvailabilityPanel args={{ at: "2026-10-17 09:00" }} picked={picked} onPick={(d, v) => { picks.push(`${d.username} ${v?.reg_no} ${v?.why}`); setPicked(d.username ?? ""); }} onUse={() => {}} />;
    }
    render(wrap(<Form />));
    await settle(400);
    const rows = screen.getAllByTestId("avail-row");
    const names = () => screen.getAllByTestId("avail-row").map((r) => r.querySelector(".name")?.textContent);
    expect(names()).toEqual(["Kamal Perera", "Nuwan Perera", "Kamal Silva"]);
    expect(screen.getByTestId("best-match").textContent).toContain("Kamal Perera");
    // Two drivers called Kamal: their full names; Nuwan Perera is the only Nuwan.
    expect(rows[0].textContent).toContain("WP CAB-4521 Kamal Perera's vehicle today");
    expect(rows[1].textContent).toContain("WP KL-1234 Nuwan's regular vehicle");
    expect(rows[2].textContent).toContain("WP PH-2087 Kamal Silva's regular vehicle");

    fireEvent.click(rows[1]);
    expect(picks).toEqual(["nuwan.p WP KL-1234 Nuwan's regular vehicle"]);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    expect(rows[1].className).toContain("picked");
    expect(rows[0].getAttribute("aria-selected")).toBe("false");

    for (let i = 0; i < 3; i++) await settle(60_000); // three refreshes, each ranking the other first
    expect(transport.count("availability")).toBe(4);
    expect(screen.getAllByTestId("avail-row")).toEqual(rows); // the same nodes in the same order
    expect(names()).toEqual(["Kamal Perera", "Nuwan Perera", "Kamal Silva"]);
    expect(screen.getByTestId("best-match").textContent).toContain("Kamal Perera");
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
  });
});

describe("the decide page: a refresh never resets the driver, the vehicle or what was typed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  const card: RequestCard = {
    id: "r1", requested_by: "Dilini Jayasinghe", when: "Fri 17 Oct 09:00", route: "Head office → Kurunegala site", status: "waiting", version: 2,
    fields: { date: "2026-10-17", time: "09:00", route_from: "Head office", route_to: "Kurunegala site", pax: 3 },
  };
  /** The free vehicles; from the second answer on, one more is free and the availability words change. */
  const suggestions = (_a: Record<string, unknown>, n: number): Suggestions => {
    const v = (reg: string, availability = "Free") => ({ reg_no: reg, make_model: "Toyota HiAce", seats: 14, availability, pick: "good" });
    const pool = [v("WP CAB-4521"), v("WP KL-1234"), ...(n > 1 ? [v("WP PH-2087", "Free · back 08:40")] : [])];
    return {
      request: card,
      vehicles: pool,
      drivers: [{ name: "Kamal Perera", username: "kamal.p", availability: "free" }, { name: "Nuwan Silva", username: "nuwan.s", availability: n > 1 ? "busy 09:00–10:40" : "free" }],
      groups: { free_pool: pool, free_assigned: [], busy: [], in_garage: [] },
      drivers_free: [{ name: "Kamal Perera", username: "kamal.p" }, { name: "Nuwan Silva", username: "nuwan.s" }],
    };
  };
  const plan = () => ({
    date: "2026-10-17", leave_by: "Fri 17 Oct 09:00", leave_by_source: "manual", stops: [], warnings: [],
    timeline: { items: [{ kind: "leave", at: "09:00", source: "manual" }], totals: { drive_min: 90, km: 94, ends: "10:35" } },
  });
  const tools = ["suggest_vehicles", "availability", "plan_task", "get_settings", "decide_request", "list_drivers", "list_vehicles", "list_places", "list_requests"];

  it("keeps the picked driver and vehicle, the typed reason and the same nodes while the answers change", async () => {
    const transport = new FakeTransport({
      list_requests: () => ({ status: "all", count: 1, requests: [card] }),
      suggest_vehicles: suggestions,
      availability,
      plan_task: plan,
      get_settings: () => ({ settings: { dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5 } }, defaults: {}, about: {}, base_place: { id: "p-base", name: "Head office", has_pin: true }, routing_provider: "estimate" }),
      list_drivers: () => ({ drivers: [{ name: "Kamal Perera", username: "kamal.p" }, { name: "Nuwan Silva", username: "nuwan.s" }] }),
      list_vehicles: () => ({ vehicles: [{ reg_no: "WP CAB-4521" }, { reg_no: "WP KL-1234" }] }),
      list_places: () => ({ places: [] }),
    }, tools);
    const { wrap } = await setup(transport);
    render(wrap(
      <MemoryRouter initialEntries={["/requests/r1/decide"]}>
        <Routes><Route path="/requests/:id/decide" element={<RequestDecide />} /></Routes>
      </MemoryRouter>,
    ));
    await settle(400);
    await settle(1500);
    const select = screen.getByLabelText("Driver") as HTMLSelectElement;
    // The best match is the default until the person picks: Kamal, with the vehicle he holds today.
    expect(select.value).toBe("kamal.p");
    expect(screen.getByTestId("vehicle-default").textContent).toContain("WP CAB-4521 · Kamal's vehicle today");
    // The person picks Nuwan, then another vehicle, and types a reason.
    fireEvent.change(select, { target: { value: "nuwan.s" } });
    expect(screen.getByTestId("vehicle-default").textContent).toContain("WP KL-1234 · Nuwan's regular vehicle");
    const cab = screen.getByDisplayValue("WP CAB-4521") as HTMLInputElement;
    fireEvent.click(cab);
    const reason = screen.getByLabelText("Decline with a reason") as HTMLInputElement;
    fireEvent.change(reason, { target: { value: "Maybe later" } });
    const pickCard = screen.getByTestId("decide-pick");
    const kamalRow = screen.getAllByTestId("avail-row")[0];

    await settle(60_000); // the quiet refreshes: a new free vehicle, Nuwan busy, the best match the same
    await settle(1500);
    expect(transport.count("suggest_vehicles")).toBeGreaterThanOrEqual(2);
    expect(transport.count("availability")).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue("WP PH-2087")).toBeTruthy(); // the new answer is on screen
    expect(screen.getByLabelText("Driver")).toBe(select);
    expect(select.value).toBe("nuwan.s");
    expect(screen.getByDisplayValue("WP CAB-4521")).toBe(cab);
    expect(cab.checked).toBe(true);
    expect(screen.getByLabelText("Decline with a reason")).toBe(reason);
    expect(reason.value).toBe("Maybe later");
    expect(screen.getByTestId("decide-pick")).toBe(pickCard);
    expect(screen.getAllByTestId("avail-row")[0]).toBe(kamalRow);
    expect(screen.queryByText("Finding free vehicles…")).toBeNull();
  });
});
