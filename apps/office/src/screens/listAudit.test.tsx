// Round 4–7 (item 8, §33.7, rule 7: the list audit): the site's other long lists. The Activity log pages by number on a
// desktop (before, only a phone's Load more reached past the first 25); the actions stay (the date range, the person
// search, routine actions, a row's words and its outcome).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageOf, pageWindow } from "@fleet/paging";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { ActivityEntry } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import ActivityLogPage from "./settings/ActivityLog";

const admin: Me = { name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view", "users"], tools: ["activity_log"] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private entries: ActivityEntry[]) {}
  me() {
    return Promise.resolve(admin);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const p = pageOf(this.entries, pageWindow(args.limit as number | undefined, args.cursor as string | undefined));
    return Promise.resolve(structuredClone({ from: args.from, to: args.to, count: p.rows.length, total: p.total, next: p.next, entries: p.rows }) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => undefined;
  }
  invalidate() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00+05:30"));
});
afterEach(() => vi.useRealTimers());

describe("the Activity log (the list audit)", () => {
  const entries: ActivityEntry[] = Array.from({ length: 30 }, (_, i) => ({
    id: 30 - i, at: `2026-10-21 09:${String(59 - i).padStart(2, "0")}`, person: "Sahan", channel: "Website or app", action: `Change ${i + 1}`,
    outcome: i === 1 ? "refused" : "done", ...(i === 1 ? { reason: "Not allowed" } : {}),
  }));

  it("a desktop: 25 a page with page numbers (page 2 reachable); every control and the outcome stay", async () => {
    const t = new FakeTransport(entries);
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me: admin, noConnector: false }}>
        <ToastProvider><MemoryRouter initialEntries={["/settings/activity"]}><Routes><Route path="/settings/activity" element={<ActivityLogPage />} /></Routes></MemoryRouter></ToastProvider>
      </FleetProvider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getAllByTestId("activity-row")).toHaveLength(25);
    expect(screen.getByTestId("list-count").textContent).toBe(" · 30");
    const rows = screen.getAllByTestId("activity-row");
    expect(within(rows[0]).getByText("Done")).toBeTruthy();
    expect(within(rows[1]).getByText("Refused")).toBeTruthy();
    // The controls: the date range, the person search, the routine switch.
    expect(screen.getByTestId("date-range-button")).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByTestId("routine-switch")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("pager")).getByRole("button", { name: "2" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(t.argsOf("activity_log").at(-1)?.cursor).toBeTruthy();
    expect(screen.getAllByTestId("activity-row")).toHaveLength(5);
    expect(screen.getByText("Change 30")).toBeTruthy();
  });
});
