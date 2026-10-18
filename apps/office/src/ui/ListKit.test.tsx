// The list kit (Hotfix 3, L3): new filters ask the first page at once (never the old page with the new filters); the
// watched list keeps its rows dimmed while new filters load and is current again once their answer lands, even an
// answer equal to the old one; rows in memory paged with the same look; the search box waits for the typing to settle.
import { cursorAt } from "@fleet/paging";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { LoadMore, Pager, SearchBox, useLocalPagedList, usePagedList, useWatchedPagedList } from "./ListKit";

interface Answer {
  total?: number;
  rows: string[];
}

/** Answers `list` with rows "<filter>-<n>" a page at a time; `same` = the same rows whatever the filter. */
class Fake implements Transport {
  readonly kind = "api" as const;
  calls: Record<string, unknown>[] = [];
  held: (() => void)[] = [];
  hold = false;
  same = false;
  me(): Promise<Me> {
    return Promise.resolve({ name: "T", role: "admin", permissions: ["view"], tools: [] });
  }
  answer(args: Record<string, unknown>): Answer {
    const all = Array.from({ length: 30 }, (_, i) => `${this.same ? "x" : String(args.f ?? "x")}-${i + 1}`);
    const from = typeof args.cursor === "string" ? Number(atob(args.cursor.replace(/-/g, "+").replace(/_/g, "/")).slice(2)) : 0;
    return { total: all.length, rows: all.slice(from, from + Number(args.limit ?? all.length)) };
  }
  call<T>(_tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(args);
    const data = this.answer(args) as T;
    if (this.hold) return new Promise((resolve) => this.held.push(() => resolve(data)));
    return Promise.resolve(data);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    let stopped = false;
    void this.call<T>(tool, args).then((data) => { if (!stopped) cb({ type: "data", data, at: Date.now() }); });
    return () => { stopped = true; };
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const me: Me = { name: "T", role: "admin", permissions: ["view"], tools: [] };
const phone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
};
const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

function wrap(t: Fake, ui: React.ReactNode) {
  render(<FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}><MemoryRouter>{ui}</MemoryRouter></FleetProvider>);
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Paged() {
  const [f, setF] = useState("a");
  const list = usePagedList<string, Answer>("t", "list", { f }, (a) => a.rows);
  return (
    <div>
      <button type="button" onClick={() => setF("b")}>Filter b</button>
      <ul>{list.items.map((r) => <li key={r}>{r}</li>)}</ul>
      <Pager list={list} />
      <LoadMore list={list} />
    </div>
  );
}

function Watched() {
  const [f, setF] = useState("a");
  const list = useWatchedPagedList<string, Answer>("w", "list", { f }, (a) => a.rows, { every: 60000 });
  return (
    <div>
      <button type="button" onClick={() => setF("b")}>Filter b</button>
      <span data-testid="state">{list.query.stale ? "stale" : "current"}</span>
      <span data-testid="first">{list.items[0] ?? ""}</span>
    </div>
  );
}

function Local({ n }: { n: number }) {
  const list = useLocalPagedList(Array.from({ length: n }, (_, i) => `r${i + 1}`));
  return (
    <div>
      <ul>{list.items.map((r) => <li key={r}>{r}</li>)}</ul>
      <Pager list={list} />
      <LoadMore list={list} />
    </div>
  );
}

describe("the list kit", () => {
  it("a desktop pages by numbers; new filters ask the first page at once, never the old page", async () => {
    phone(false);
    const t = new Fake();
    wrap(t, <Paged />);
    await flush();
    expect(t.calls).toEqual([{ f: "a", limit: 25 }]);
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await flush();
    expect(t.calls.at(-1)).toEqual({ f: "a", limit: 25, cursor: cursorAt(25) });
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Filter b" }));
    await flush();
    expect(t.calls.at(-1)).toEqual({ f: "b", limit: 25 });
    expect(t.calls.some((c) => c.f === "b" && c.cursor)).toBe(false);
    expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-current")).toBe("page");
  });

  it("a phone: Load more grows the list a page at a time", async () => {
    phone(true);
    const t = new Fake();
    wrap(t, <Paged />);
    await flush();
    expect(screen.getByTestId("load-more").textContent).toContain("Showing 25 of 30");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(t.calls.at(-1)).toEqual({ f: "a", limit: 50 });
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    expect(screen.queryByTestId("load-more")).toBeNull();
  });

  it("the watched list: dimmed while new filters load, current again when they land, even with the same rows", async () => {
    const t = new Fake();
    t.same = true;
    wrap(t, <Watched />);
    await flush();
    expect(screen.getByTestId("state").textContent).toBe("current");
    expect(screen.getByTestId("first").textContent).toBe("x-1");
    t.hold = true;
    fireEvent.click(screen.getByRole("button", { name: "Filter b" }));
    await flush();
    expect(screen.getByTestId("state").textContent).toBe("stale");
    expect(screen.getByTestId("first").textContent).toBe("x-1");
    // The answer for b holds the very same rows: the list is current again all the same.
    await act(async () => { t.held.forEach((r) => r()); await Promise.resolve(); });
    await flush();
    expect(screen.getByTestId("state").textContent).toBe("current");
  });

  it("rows in memory: 25 a page on a desktop, Load more on a phone", () => {
    phone(false);
    const t = new Fake();
    wrap(t, <Local n={30} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["r26", "r27", "r28", "r29", "r30"]);
  });

  it("rows in memory on a phone", () => {
    phone(true);
    wrap(new Fake(), <Local n={30} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
  });

  it("the search box waits for the typing to settle; Enter sends at once; the URL's value shows", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    function Box() {
      const [v, setV] = useState("");
      return (
        <>
          <SearchBox value={v} onChange={(x) => { sent.push(x); setV(x); }} />
          <button type="button" onClick={() => setV("from a link")}>Link</button>
        </>
      );
    }
    wrap(new Fake(), <Box />);
    const box = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "kan" } });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.change(box, { target: { value: "kandy " } });
    act(() => { vi.advanceTimersByTime(299); });
    expect(sent).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(sent).toEqual(["kandy"]);
    // The trailing space being typed stays in the box.
    expect(box.value).toBe("kandy ");
    fireEvent.change(box, { target: { value: "galle" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toEqual(["kandy", "galle"]);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(box.value).toBe("from a link");
  });
});
