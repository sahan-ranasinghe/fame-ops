// The notification centre and its sounds (Hotfix 2, A and B), on the page: the bell's unread count; the first load
// plays nothing and shows no banner; "Click to turn on sounds" until the first click anywhere; a new item after that
// shows its banner and plays its kind's sound (info plays nothing, the loudest kind wins); sound off and volume 0 stay
// silent; Open marks it read; the desktop panel with Mark all read stays open until closed; a phone's bell opens
// /inbox; Realtime reloads at once on the web; the artifact polls every 30 s; a refusing tool hides it all.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PATTERNS } from "../data/sounds";
import { FleetStore } from "../data/store";
import type { Inbox, InboxItem } from "../data/types";
import { InboxPage } from "../screens/InboxPage";
import { FakeAudio } from "../test/fakeAudio";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { type Fleet, FleetProvider } from "./FleetContext";
import { InboxBanners, InboxBell, InboxProvider, SoundStrip } from "./inbox";

/** "2026-10-18 10:42" in Colombo, as my_inbox writes an item's time. */
const colomboAt = (ms: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const item = (id: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  id, event: "request.decided", title: `Item ${id}`, who: "Palitha", url: `/requests/r${id}`, at: colomboAt(Date.now()), ago: "5 min ago", read: false, kind: "alert", ...extra,
});

/** my_inbox answers `inbox` (changed by the test); push() is the next poll. */
class FakeTransport implements Transport {
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  inbox: Inbox = { unread: 1, items: [item(2), item(1, { read: true })] };
  sound: { on: boolean; volume: number } | undefined = { on: true, volume: 70 };
  intervals: number[] = [];
  refuse = false;
  cached: Inbox | null = null;
  private cbs: ((ev: WatchEvent<unknown>) => void)[] = [];
  constructor(readonly kind: "api" | "claude" = "api") {}
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_inbox") return this.refuse ? Promise.reject({ code: "tool_error", message: "This is personal" }) : Promise.resolve(structuredClone(this.inbox) as T);
    if (tool === "my_notification_settings") return Promise.resolve({ events: [], devices: [], push: { configured: false }, sound: this.sound } as T);
    if (tool === "mark_inbox_read") {
      const ids = args.all ? this.inbox.items.map((i) => i.id) : (args.ids as number[]);
      this.inbox = { unread: 0, items: this.inbox.items.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i)) };
      this.inbox.unread = this.inbox.items.filter((i) => !i.read).length;
      return Promise.resolve({ marked: ids.length, unread: this.inbox.unread } as T);
    }
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void, intervalMs: number): () => void {
    this.intervals.push(intervalMs);
    const c = cb as (ev: WatchEvent<unknown>) => void;
    this.cbs.push(c);
    // The artifact's watchTool may hand over its cached copy first (fetched a while ago), then the fresh answer.
    if (this.cached) c({ type: "data", data: structuredClone(this.cached), at: Date.now() - 120000 });
    void this.tick(tool, args, c);
    return () => { this.cbs = this.cbs.filter((x) => x !== c); };
  }
  private tick(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<unknown>) => void) {
    return this.call(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
  }
  /** The next poll. */
  async push() {
    await Promise.all(this.cbs.map((cb) => this.tick("my_inbox", { limit: 50 }, cb)));
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

const person: Me = { name: "Dilini", role: "staff", permissions: ["view", "request"], tools: ["my_inbox", "mark_inbox_read", "my_notification_settings"] };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

async function mount(t: FakeTransport, opts: { me?: Me; realtime?: Fleet["realtime"]; url?: string } = {}) {
  const fake = new FakeAudio();
  const fleet: Fleet = { store: new FleetStore(t), transport: t, me: opts.me ?? person, noConnector: false, realtime: opts.realtime };
  render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.url ?? "/"]}>
          <InboxProvider makeAudio={() => fake}>
            <InboxBell />
            <SoundStrip />
            <InboxBanners />
            <Routes>
              <Route path="/" element={<div>Home</div>} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/requests/:id" element={<div>The request</div>} />
            </Routes>
            <Where />
          </InboxProvider>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await flush();
  return fake;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the notification centre", () => {
  it("the first load: the count, no banner, no sound; the strip until the first click anywhere", async () => {
    const t = new FakeTransport();
    const fake = await mount(t);
    expect(screen.getByTestId("inbox-count").textContent).toBe("1");
    expect(screen.getByRole("button", { name: "Notifications: 1 unread" })).toBeTruthy();
    expect(screen.queryByTestId("inbox-banner")).toBeNull();
    expect(fake.oscs).toHaveLength(0);
    expect(screen.getByTestId("sound-strip").textContent).toContain("Click to turn on sounds");
    // One click anywhere on the page turns sounds on; the strip goes.
    fireEvent.pointerDown(screen.getByText("Home"));
    await flush();
    expect(fake.state).toBe("running");
    expect(screen.queryByTestId("sound-strip")).toBeNull();
    expect(t.intervals).toEqual([60000]);
  });

  it("a new item after the page loaded: its banner and its kind's sound; info plays nothing; the loudest kind wins", async () => {
    const t = new FakeTransport();
    const fake = await mount(t);
    fireEvent.click(document.body);
    await flush();
    t.inbox = { unread: 2, items: [item(3, { kind: "urgent", title: "Task to approve", event: "request.created" }), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    const banner = screen.getByTestId("inbox-banner");
    expect(banner.textContent).toContain("Palitha · Task to approve");
    expect(fake.oscs).toHaveLength(PATTERNS.urgent.length);
    expect(fake.freqs()).toEqual(PATTERNS.urgent.map((x) => x.freq));
    expect(screen.getByTestId("inbox-count").textContent).toBe("2");
    // The same answer again: nothing new.
    await act(async () => { await t.push(); });
    expect(fake.oscs).toHaveLength(PATTERNS.urgent.length);
    // An info item: a banner, no sound.
    t.inbox = { unread: 3, items: [item(4, { kind: "info", title: "An issue given to you" }), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    expect(screen.getAllByTestId("inbox-banner")).toHaveLength(2);
    expect(fake.oscs).toHaveLength(PATTERNS.urgent.length);
    // Two at once (soft and alarm): one sound, the alarm.
    const before = fake.oscs.length;
    t.inbox = { unread: 5, items: [item(6, { kind: "soft" }), item(5, { kind: "alarm" }), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    expect(fake.freqs(before)).toEqual(PATTERNS.alarm.map((x) => x.freq));
    // At most three banners, the newest first.
    expect(screen.getAllByTestId("inbox-banner").map((b) => b.textContent?.includes("Item 6"))).toEqual([true, false, false]);
  });

  it("before the first click a new item still shows its banner; the sound waits for the click (nothing plays late)", async () => {
    const t = new FakeTransport();
    const fake = await mount(t);
    t.inbox = { unread: 2, items: [item(3, { kind: "alert" }), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    expect(screen.getByTestId("inbox-banner")).toBeTruthy();
    expect(fake.oscs).toHaveLength(0);
    expect(screen.getByTestId("sound-strip")).toBeTruthy();
  });

  it("sound off, or the volume at 0: banners only, no strip", async () => {
    for (const sound of [{ on: false, volume: 70 }, { on: true, volume: 0 }]) {
      const t = new FakeTransport();
      t.sound = sound;
      const fake = await mount(t);
      expect(screen.queryByTestId("sound-strip")).toBeNull();
      fireEvent.click(document.body);
      await flush();
      t.inbox = { unread: 2, items: [item(3, { kind: "alarm" }), ...t.inbox.items] };
      await act(async () => { await t.push(); });
      expect(screen.getByTestId("inbox-banner")).toBeTruthy();
      expect(fake.oscs).toHaveLength(0);
      cleanup();
    }
  });

  it("Open on a banner goes to its page and marks it read; Close only closes it", async () => {
    const t = new FakeTransport();
    await mount(t);
    t.inbox = { unread: 3, items: [item(4), item(3), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    const [newest, older] = screen.getAllByTestId("inbox-banner");
    fireEvent.click(within(older).getByRole("button", { name: "Close" }));
    expect(screen.getAllByTestId("inbox-banner")).toHaveLength(1);
    expect(t.argsOf("mark_inbox_read")).toEqual([]);
    fireEvent.click(within(newest).getByRole("link", { name: "Open" }));
    expect(screen.getByTestId("where").textContent).toBe("/requests/r4");
    expect(screen.queryByTestId("inbox-banner")).toBeNull();
    expect(screen.getByTestId("inbox-count").textContent).toBe("2");
    await flush();
    expect(t.argsOf("mark_inbox_read")).toEqual([{ ids: [4] }]);
  });

  it("the desktop panel: who, what, when; an item opens its page (read); Mark all read; it stays open until closed", async () => {
    const t = new FakeTransport();
    await mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Notifications: 1 unread" }));
    const panel = screen.getByTestId("inbox-panel");
    expect(within(panel).getAllByTestId("inbox-item").map((e) => e.textContent)).toEqual([
      "Palitha · Item 25 min ago · unread",
      "Palitha · Item 15 min ago",
    ]);
    // A click elsewhere does not close it.
    fireEvent.pointerDown(screen.getByText("Home"));
    fireEvent.click(screen.getByText("Home"));
    expect(screen.getByTestId("inbox-panel")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Mark all read" }));
    await flush();
    expect(t.argsOf("mark_inbox_read")).toEqual([{ all: true }]);
    expect(screen.queryByTestId("inbox-count")).toBeNull();
    fireEvent.click(within(screen.getByTestId("inbox-panel")).getByRole("button", { name: "Close notifications" }));
    expect(screen.queryByTestId("inbox-panel")).toBeNull();
    // An item opens its page and marks it read.
    t.inbox = { unread: 1, items: [item(9), ...t.inbox.items] };
    await act(async () => { await t.push(); });
    fireEvent.click(screen.getByRole("button", { name: "Notifications: 1 unread" }));
    fireEvent.click(within(screen.getByTestId("inbox-panel")).getAllByTestId("inbox-item")[0]);
    expect(screen.getByTestId("where").textContent).toBe("/requests/r9");
    expect(screen.queryByTestId("inbox-panel")).toBeNull();
    await flush();
    expect(t.argsOf("mark_inbox_read").at(-1)).toEqual({ ids: [9] });
  });

  it("on a phone the bell opens /inbox: the list and Mark all read", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    const t = new FakeTransport();
    await mount(t);
    fireEvent.click(screen.getByRole("link", { name: "Notifications: 1 unread" }));
    expect(screen.getByTestId("where").textContent).toBe("/inbox");
    const page = screen.getByTestId("inbox-page");
    expect(within(page).getAllByTestId("inbox-item")).toHaveLength(2);
    fireEvent.click(within(page).getByRole("button", { name: "Mark all read" }));
    await flush();
    expect(t.argsOf("mark_inbox_read")).toEqual([{ all: true }]);
  });

  it("web: a Realtime change reloads at once (half a second, once for a burst)", async () => {
    vi.useFakeTimers();
    let fire = () => {};
    const t = new FakeTransport();
    const fake = await mount(t, { realtime: { driverLatest: () => () => {}, inbox: (cb) => { fire = cb; return () => {}; } } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.keyDown(document.body, { key: "a" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    t.inbox = { unread: 2, items: [item(3, { kind: "soft" }), ...t.inbox.items] };
    const before = t.argsOf("my_inbox").length;
    fire();
    fire();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(t.argsOf("my_inbox").length).toBe(before + 1);
    expect(screen.getByTestId("inbox-banner")).toBeTruthy();
    expect(fake.oscs).toHaveLength(PATTERNS.soft.length);
  });

  it("the artifact's cached copy first: items that came before the page opened are not news; the next ones are", async () => {
    const t = new FakeTransport("claude");
    t.cached = { unread: 1, items: [item(1)] };
    // Item 2 came in two minutes before the page opened, after the cached copy was taken.
    t.inbox = { unread: 2, items: [item(2, { at: colomboAt(Date.now() - 120000) }), item(1)] };
    await mount(t);
    expect(screen.queryByTestId("inbox-banner")).toBeNull();
    expect(screen.getByTestId("inbox-count").textContent).toBe("2");
    t.inbox = { unread: 3, items: [item(3), item(2), item(1)] };
    await act(async () => { await t.push(); });
    expect(screen.getAllByTestId("inbox-banner")).toHaveLength(1);
    expect(screen.getByTestId("inbox-banner").textContent).toContain("Item 3");
  });

  it("the artifact polls every 30 s; a tool that refuses (the shared key has no person) hides it all and stops", async () => {
    const t = new FakeTransport("claude");
    await mount(t);
    expect(t.intervals).toEqual([30000]);
    const r = new FakeTransport("claude");
    r.refuse = true;
    cleanup();
    await mount(r);
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
    expect(screen.queryByTestId("sound-strip")).toBeNull();
    await act(async () => { await r.push(); });
    expect(r.argsOf("my_inbox")).toHaveLength(1);
  });

  it("without my_inbox: nothing at all", async () => {
    const t = new FakeTransport();
    await mount(t, { me: { ...person, tools: [] } });
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
    expect(t.calls).toEqual([]);
  });
});
