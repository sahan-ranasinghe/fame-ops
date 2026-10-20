// Hotfix 3 (L3) on the notifications page and Reminders: the page's own list of notifications a page at a time (the
// last 30 days; Unread; the History switch for the archived ones; the search; all in the URL), an item outside the
// bell's feed marked read here; the reminders paged on the page with the same look.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFilter } from "../test/controls";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { InboxProvider } from "../app/inbox";
import { FleetStore } from "../data/store";
import type { Attention, Inbox, InboxItem } from "../data/types";
import { FakeAudio } from "../test/fakeAudio";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { InboxPage } from "./InboxPage";
import { inboxArgs, inboxEmptyText, readHere } from "./inboxPageLogic";
import { ReminderList } from "./Reminders";

const item = (id: number, extra: Partial<InboxItem> = {}): InboxItem => ({
  id, event: "request.decided", title: `Item ${id}`, who: "Palitha", url: `/requests/r${id}`, at: "2026-10-18 10:42", ago: "5 min ago", read: true, kind: "alert", ...extra,
});

/** my_inbox: 60 items, newest first (the bell's feed, limit 50, holds 60…11); an archived one with archived. */
class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  items: InboxItem[] = Array.from({ length: 60 }, (_, i) => item(60 - i, i === 59 ? { read: false } : {}));
  archived: InboxItem[] = [item(0, { title: "Old one", at: "2026-08-01 09:00" })];
  me(): Promise<Me> {
    return Promise.resolve(person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_inbox") {
      let all = [...this.items, ...(args.archived ? this.archived : [])];
      if (args.unread) all = all.filter((i) => !i.read);
      if (args.search) all = all.filter((i) => i.title.includes(String(args.search)));
      const items = all.slice(0, Number(args.limit ?? all.length));
      const answer: Inbox = { unread: this.items.filter((i) => !i.read).length, items, total: all.length };
      return Promise.resolve(structuredClone(answer) as T);
    }
    if (tool === "mark_inbox_read") return Promise.resolve({ marked: 1, unread: 0 } as T);
    if (tool === "my_notification_settings") return Promise.resolve({ events: [], devices: [], push: { configured: false } } as T);
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const person: Me = { name: "Dilini", role: "staff", permissions: ["view", "request"], tools: ["my_inbox", "mark_inbox_read", "my_notification_settings"] };

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const phone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
};
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

async function mountInbox(url = "/inbox") {
  const t = new FakeTransport();
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: person, noConnector: false }}>
      <MemoryRouter initialEntries={[url]}>
        <InboxProvider makeAudio={() => new FakeAudio()}>
          <Routes>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/requests/:id" element={<div>The request</div>} />
          </Routes>
          <Where />
        </InboxProvider>
      </MemoryRouter>
    </FleetProvider>,
  );
  await flush();
  return t;
}

describe("the notifications page (Hotfix 3)", () => {
  it("its own list, 25 at a time with the count in the header; a phone loads more", async () => {
    phone(true);
    const t = await mountInbox();
    expect(t.argsOf("my_inbox")).toContainEqual({ limit: 25 });
    const page = screen.getByTestId("inbox-page");
    expect(within(page).getByTestId("list-count").textContent).toBe(" · 60");
    expect(within(page).getAllByTestId("inbox-item")).toHaveLength(25);
    fireEvent.click(within(page).getByRole("button", { name: "Load more" }));
    await flush();
    expect(t.argsOf("my_inbox").at(-1)).toEqual({ limit: 50 });
    expect(within(page).getAllByTestId("inbox-item")).toHaveLength(50);
  });

  it("Unread, History (the archived ones too) and the search go into the URL and my_inbox", async () => {
    const t = await mountInbox();
    applyFilter("Older ones", /Also the history/);
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/inbox?history=1");
    expect(t.argsOf("my_inbox").at(-1)).toEqual({ archived: true, limit: 25 });
    applyFilter("Show", "Unread");
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/inbox?history=1&show=unread");
    expect(t.argsOf("my_inbox").at(-1)).toEqual({ archived: true, unread: true, limit: 25 });
    const box = screen.getByLabelText("Search");
    fireEvent.change(box, { target: { value: "Nothing like it" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(t.argsOf("my_inbox").at(-1)).toEqual({ archived: true, unread: true, search: "Nothing like it", limit: 25 });
    expect(screen.getByTestId("empty-line").textContent).toBe('No unread notification matches "Nothing like it".');
  });

  it("an unread item outside the bell's feed is marked read from the page", async () => {
    phone(true);
    const t = await mountInbox();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    const rows = screen.getAllByTestId("inbox-item");
    // Item 1 is the oldest (the 60th): not in the bell's feed (it holds 50), unread.
    expect(rows).toHaveLength(60);
    fireEvent.click(rows[59]);
    await flush();
    expect(t.argsOf("mark_inbox_read")).toEqual([{ ids: [1] }]);
    expect(screen.getByTestId("where").textContent).toBe("/requests/r1");
  });

  it("the words: the arguments, read here at once, the empty lines", () => {
    expect(inboxArgs("all", false, "")).toEqual({});
    expect(inboxArgs("unread", true, "Kandy")).toEqual({ unread: true, archived: true, search: "Kandy" });
    const items = [item(1, { read: false }), item(2, { read: false })];
    expect(readHere(items, { ids: [1], all: false }).map((i) => i.read)).toEqual([true, false]);
    expect(readHere(items, { ids: [], all: true }).map((i) => i.read)).toEqual([true, true]);
    expect(inboxEmptyText("all", false, "")).toMatch(/^Nothing in the last 30 days\./);
    expect(inboxEmptyText("unread", false, "")).toBe("No unread notifications in the last 30 days.");
    expect(inboxEmptyText("all", true, "Galle")).toBe('No notification matches "Galle".');
  });
});

describe("Reminders a page at a time (Hotfix 3)", () => {
  const due = (n: number): Attention => ({ what: `Insurance expires ${n}`, vehicle: `WP CAB-${1000 + n}`, kind: "document", due: "in 5 days", level: "warn" });

  it("each group: its count in the header, 25 rows, page numbers on a desktop", () => {
    phone(false);
    render(<MemoryRouter><ReminderList items={Array.from({ length: 30 }, (_, i) => due(i + 1))} issues /></MemoryRouter>);
    const group = screen.getByTestId("reminders-due");
    expect(within(group).getByTestId("list-count").textContent).toBe(" · 30");
    expect(within(group).getAllByTestId("reminder-row")).toHaveLength(25);
    fireEvent.click(within(group).getByRole("button", { name: "2" }));
    expect(within(group).getAllByTestId("reminder-row")).toHaveLength(5);
  });

  it("on a phone: Load more", () => {
    phone(true);
    render(<MemoryRouter><ReminderList items={Array.from({ length: 30 }, (_, i) => due(i + 1))} issues /></MemoryRouter>);
    const group = screen.getByTestId("reminders-due");
    fireEvent.click(within(group).getByRole("button", { name: "Load more" }));
    expect(within(group).getAllByTestId("reminder-row")).toHaveLength(30);
  });
});
