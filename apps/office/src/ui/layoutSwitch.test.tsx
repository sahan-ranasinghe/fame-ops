// A height-only resize never reloads or remounts a page (Sahan, 22 October 2026: a phone's address bar shows and hides,
// and phones still use the desktop site), and neither does the moment Chromium's full-page capture (Playwright's
// `fullPage` screenshot) spends at a viewport a few pixels wide: there every max-width query fires "change" and is back at
// the real width a moment later. CI's mockup picture caught the task page that way: the board's skeletons and
// "Loading the task…" (ui/phone.ts, ui/PullToRefresh.tsx, ui/Page.tsx ListWithDetail). The page here is the task page
// beside the board, inside the shell's pull-to-refresh wrapper, as the site draws it.
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { TaskDetail as TaskDetailData } from "../data/types";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { TaskDetail } from "../screens/TaskDetail";
import { Tasks } from "../screens/Tasks";
import { PHONE_SETTLE_MS } from "./phone";
import { PullToRefresh } from "./PullToRefresh";
import { ToastProvider } from "./Toast";

const detail: TaskDetailData = {
  task: { id: "t1", title: "Team drop · Kurunegala", kind: "dispatch", purpose: "company", status: "in_progress", start: "Thu 22 Oct 08:05", driver: "Kamal Silva", vehicle: "WP CAB-4521 · Toyota HiAce" },
  stops: [],
  projects: "Fame internal (no project)",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
};

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  me(): Promise<Me> {
    return Promise.resolve(dispatcher);
  }
  count(tool: string) {
    return this.calls.filter((c) => c.tool === tool).length;
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "task_board") {
      return Promise.resolve({
        date: today(), counts: { assigned: 0, in_progress: 1, completed: 0, cancelled: 0 },
        assigned: [], completed: [],
        in_progress: [{ id: "t1", time: "08:05", title: "Team drop · Kurunegala", kind: "dispatch", purpose: "company", driver: "Kamal Silva", vehicle: "WP CAB-4521", status: "Started 08:05" }],
      } as T);
    }
    if (tool === "task_detail") return Promise.resolve(structuredClone(detail) as T);
    return Promise.resolve({} as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["task_detail", "task_board"] };

// ---- The window: its size, and matchMedia answering from it (a query's listeners hear a change, as a browser's do). ----
let width = 1440;
let height = 900;
const listeners = new Map<string, Set<() => void>>();
const lastState = new Map<string, boolean>();
function evaluate(q: string): boolean {
  const maxW = q.match(/max-width:\s*(\d+)px/);
  if (maxW) return width <= Number(maxW[1]);
  const maxH = q.match(/max-height:\s*(\d+)px/);
  if (maxH) return height <= Number(maxH[1]);
  return false;
}
/** The window takes a new size: innerWidth / innerHeight, each query whose answer changed tells its listeners, then resize. */
function resizeTo(w: number, h: number) {
  width = w;
  height = h;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  for (const [q, set] of listeners) {
    const now = evaluate(q);
    if (lastState.get(q) === now) continue;
    lastState.set(q, now);
    set.forEach((fn) => fn());
  }
  window.dispatchEvent(new Event("resize"));
}
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  width = 1440;
  height = 900;
  listeners.clear();
  lastState.clear();
  window.matchMedia = ((q: string) => {
    if (!listeners.has(q)) listeners.set(q, new Set());
    if (!lastState.has(q)) lastState.set(q, evaluate(q));
    return {
      media: q,
      get matches() { return evaluate(q); },
      addEventListener: (_: string, fn: () => void) => listeners.get(q)!.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.get(q)!.delete(fn),
    };
  }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount() {
  const transport = new FakeTransport();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: dispatcher, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/tasks/t1"]}>
          <PullToRefresh>
            <Routes>
              <Route path="/tasks" element={<Tasks />}><Route path=":id" element={<TaskDetail />} /></Route>
            </Routes>
          </PullToRefresh>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await screen.findByTestId("task-detail");
  await screen.findByTestId("board-col-in_progress");
  return transport;
}

/** The page as it is now: its nodes (a remount makes new ones) and the calls so far. */
function snapshot(t: FakeTransport) {
  return { page: screen.getByTestId("task-detail"), column: screen.getByTestId("board-col-in_progress"), detail: t.count("task_detail"), board: t.count("task_board") };
}
function expectKept(t: FakeTransport, before: ReturnType<typeof snapshot>) {
  expect(screen.getByTestId("task-detail")).toBe(before.page);
  expect(screen.getByTestId("board-col-in_progress")).toBe(before.column);
  expect(t.count("task_detail")).toBe(before.detail);
  expect(t.count("task_board")).toBe(before.board);
  expect(screen.queryByText(/Loading the task/)).toBeNull();
  expect(screen.queryByText(/Loading tasks/)).toBeNull();
}

describe("a resize never remounts the page", () => {
  it("height only (900 → 600 → 1400 → 900): the same page, nothing asked again", async () => {
    const t = await mount();
    const before = snapshot(t);
    for (const h of [600, 1400, 900]) {
      resizeTo(1440, h);
      await wait(20);
    }
    await wait(PHONE_SETTLE_MS + 50);
    expectKept(t, before);
  });

  it("Chromium's full-page capture (a moment at a viewport a few pixels wide, then back): the same page, nothing asked again", async () => {
    const t = await mount();
    const before = snapshot(t);
    // The capture: a few pixels wide for a moment (a render happens in between), then the real size again.
    resizeTo(40, 600);
    await wait(30);
    resizeTo(1440, 900);
    await wait(PHONE_SETTLE_MS + 50);
    expectKept(t, before);
    // The desktop layout throughout: the board beside the panel.
    expect(document.querySelector(".split.has-detail > .split-detail [data-testid='task-detail']")).toBe(before.page);
  });

  it("a real change of width is followed once it holds; the task page itself is never made again", async () => {
    const t = await mount();
    const before = snapshot(t);
    resizeTo(412, 915);
    // Not yet: the layout follows once the width has held.
    expect(document.querySelector(".split.has-detail")).toBeTruthy();
    await wait(PHONE_SETTLE_MS + 50);
    // A phone: the task alone, full screen (the board left out, as before).
    expect(document.querySelector(".split.detail-only > .detail-page [data-testid='task-detail']")).toBe(before.page);
    expect(screen.queryByTestId("board-col-in_progress")).toBeNull();
    resizeTo(1440, 900);
    await wait(PHONE_SETTLE_MS + 50);
    // Back on a desktop: the same task page (not loaded again); the board drawn from what the page already holds.
    expect(screen.getByTestId("task-detail")).toBe(before.page);
    expect(t.count("task_detail")).toBe(before.detail);
    expect(t.count("task_board")).toBe(before.board);
    expect(screen.getByTestId("board-col-in_progress")).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
