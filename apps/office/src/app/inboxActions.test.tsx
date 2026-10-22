// Round 4–7, feature 7 (22 October 2026): the notification centre's buttons (an Ask for it's Yes / No), in the tray, on
// the banners and on the notifications page. The item keeps everything it had (its link that opens it and marks it read,
// Mark all read, the unread count); with buttons, a tap calls the item's tool with its arguments as they are, marks it read
// and the buttons become "You said Yes"; a dropped answer says it may not have been saved, with Try again (never sent
// again by itself). An ask's link opens the Asks page for someone who cannot open tasks.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { FleetStore } from "../data/store";
import type { Inbox, InboxItem } from "../data/types";
import { InboxPage } from "../screens/InboxPage";
import { FakeAudio } from "../test/fakeAudio";
import type { FleetError, Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { type Fleet, FleetProvider } from "./FleetContext";
import { InboxBanners, InboxBell, InboxProvider } from "./inbox";
import { forgetAnswered } from "./inboxActionsLogic";

const TASK = "1b2c3d4e-0000-4000-8000-00000000abcd";
const colomboAt = (ms: number) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const askItem = (id: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  id,
  event: "holder.asked",
  title: "Nimal asks for WP CAB-4521",
  body: "Fri 24 Oct 09:00–12:00 · your trip \"Team drop\"",
  who: "Nimal",
  url: `/tasks/${TASK}`,
  at: colomboAt(Date.now()),
  ago: "2 min ago",
  read: false,
  kind: "urgent",
  actions: [
    { label: "Yes", tool: "answer_holder_ask", args: { ask_id: "ask-1", answer: "yes" } },
    { label: "No", tool: "answer_holder_ask", args: { ask_id: "ask-1", answer: "no" } },
  ],
  ...extra,
});
const plainItem = (id: number): InboxItem => ({ id, event: "request.decided", title: `Item ${id}`, who: "Palitha", url: `/requests/r${id}`, at: colomboAt(Date.now()), ago: "5 min ago", read: false, kind: "alert" });

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  inbox: Inbox = { unread: 2, items: [askItem(2), plainItem(1)] };
  failAnswers = 0;
  private cbs: ((ev: WatchEvent<unknown>) => void)[] = [];
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_inbox") return Promise.resolve(structuredClone(this.inbox) as T);
    if (tool === "answer_holder_ask") {
      if (this.failAnswers > 0) {
        this.failAnswers -= 1;
        return Promise.reject({ code: "network", message: "Failed to fetch", write: true } satisfies FleetError);
      }
      return Promise.resolve({ ask_id: args.ask_id, answer: args.answer, said: "Yes · WP CAB-4521", next: "The asker is told." } as T);
    }
    if (tool === "mark_inbox_read") {
      const ids = args.all ? this.inbox.items.map((i) => i.id) : (args.ids as number[]);
      this.inbox = { ...this.inbox, items: this.inbox.items.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i)) };
      this.inbox.unread = this.inbox.items.filter((i) => !i.read).length;
      return Promise.resolve({ marked: ids.length, unread: this.inbox.unread } as T);
    }
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    const c = cb as (ev: WatchEvent<unknown>) => void;
    this.cbs.push(c);
    void this.call(tool, args).then((data) => c({ type: "data", data, at: Date.now() }));
    return () => { this.cbs = this.cbs.filter((x) => x !== c); };
  }
  async push() {
    await Promise.all(this.cbs.map((cb) => this.call("my_inbox", { limit: 50 }).then((data) => cb({ type: "data", data, at: Date.now() }))));
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

const holderMe: Me = { name: "Anoja", role: "staff", permissions: ["view", "request"], tools: ["my_inbox", "mark_inbox_read", "answer_holder_ask", "holder_asks"] };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

async function mount(t: FakeTransport, opts: { me?: Me; url?: string } = {}) {
  const fleet: Fleet = { store: new FleetStore(t), transport: t, me: opts.me ?? holderMe, noConnector: false };
  render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.url ?? "/"]}>
          <InboxProvider makeAudio={() => new FakeAudio()}>
            <InboxBell />
            <InboxBanners />
            <Routes>
              <Route path="/" element={<div>Home</div>} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="*" element={<div>Elsewhere</div>} />
            </Routes>
            <Where />
          </InboxProvider>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await flush();
}

afterEach(() => forgetAnswered());

describe("the notification centre's buttons", () => {
  it("the tray: the item keeps its link and Mark all read; Yes calls the tool as given, marks it read and becomes the answer", async () => {
    const t = new FakeTransport();
    await mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Notifications: 2 unread" }));
    const panel = screen.getByTestId("inbox-panel");
    expect(within(panel).getByRole("button", { name: "Mark all read" })).toBeTruthy();
    const items = within(panel).getAllByTestId("inbox-item");
    expect(items).toHaveLength(2);
    // An ask's link for someone who cannot open tasks: the Asks page; the other item as before.
    expect(items[0].getAttribute("href")).toBe("/tasks/asks");
    expect(items[1].getAttribute("href")).toBe("/requests/r1");
    const entry = within(panel).getByTestId("inbox-entry");
    expect(within(entry).getAllByTestId("inbox-action").map((b) => b.textContent)).toEqual(["Yes", "No"]);
    // The buttons are not inside the link.
    expect(items[0].querySelector("button")).toBeNull();
    fireEvent.click(within(entry).getByRole("button", { name: "Yes" }));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "ask-1", answer: "yes" }]);
    expect(t.argsOf("mark_inbox_read")).toEqual([{ ids: [2] }]);
    expect(within(entry).getByTestId("inbox-said").textContent).toBe("You said Yes");
    expect(within(entry).queryByTestId("inbox-action")).toBeNull();
    expect(screen.getByTestId("inbox-count").textContent).toBe("1");
    // The plain item still opens (and is read) by its link.
    fireEvent.click(within(screen.getByTestId("inbox-panel")).getAllByTestId("inbox-item")[1]);
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/requests/r1");
  });

  it("a dropped answer: may not have been saved, Try again presses it again; never sent again by itself", async () => {
    const t = new FakeTransport();
    t.failAnswers = 1;
    await mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Notifications: 2 unread" }));
    const entry = within(screen.getByTestId("inbox-panel")).getByTestId("inbox-entry");
    fireEvent.click(within(entry).getByRole("button", { name: "No" }));
    await flush();
    expect(within(entry).getByTestId("inbox-action-error").textContent).toContain("Fame Fleet didn’t answer, so this may not have been saved.");
    await flush();
    expect(t.argsOf("answer_holder_ask")).toHaveLength(1);
    expect(t.argsOf("mark_inbox_read")).toHaveLength(0);
    fireEvent.click(within(entry).getByRole("button", { name: "Try again" }));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "ask-1", answer: "no" }, { ask_id: "ask-1", answer: "no" }]);
    expect(within(entry).getByTestId("inbox-said").textContent).toBe("You said No");
  });

  it("someone who opens tasks: the ask opens the task; the page shows the buttons too and keeps the answer", async () => {
    const t = new FakeTransport();
    await mount(t, { me: { ...holderMe, permissions: ["view", "assign_tasks"] }, url: "/inbox" });
    const page = screen.getByTestId("inbox-page");
    await waitFor(() => expect(within(page).getAllByTestId("inbox-item")).toHaveLength(2));
    expect(within(page).getAllByTestId("inbox-item")[0].getAttribute("href")).toBe(`/tasks/${TASK}`);
    expect(within(page).getByRole("button", { name: "Mark all read" })).toBeTruthy();
    fireEvent.click(within(within(page).getByTestId("inbox-entry")).getByRole("button", { name: "Yes" }));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "ask-1", answer: "yes" }]);
    expect(t.argsOf("mark_inbox_read")).toEqual([{ ids: [2] }]);
    expect(within(page).getByTestId("inbox-said").textContent).toBe("You said Yes");
    // The next answer from the server (the same buttons): the answer stays.
    await act(async () => { await t.push(); });
    expect(within(screen.getByTestId("inbox-page")).getByTestId("inbox-said").textContent).toBe("You said Yes");
  });

  it("a banner: an ask that arrives shows Yes / No beside Open; an answer reads it, the banner goes and a toast says it", async () => {
    const t = new FakeTransport();
    t.inbox = { unread: 1, items: [plainItem(1)] };
    await mount(t);
    t.inbox = { unread: 2, items: [askItem(5), plainItem(1)] };
    await act(async () => { await t.push(); });
    const banner = screen.getByTestId("inbox-banner");
    expect(within(banner).getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/tasks/asks");
    expect(within(banner).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "No" }));
    await flush();
    expect(t.argsOf("answer_holder_ask")).toEqual([{ ask_id: "ask-1", answer: "no" }]);
    expect(t.argsOf("mark_inbox_read")).toEqual([{ ids: [5] }]);
    expect(screen.queryByTestId("inbox-banner")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("You said No");
  });
});
