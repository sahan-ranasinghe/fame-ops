// The issues page (Phase 7 §9): the list over a range of opened days with a status filter, newest first; an issue as a
// child route (a panel beside the list with an X and Esc on a desktop, a full page with Back on a phone); Take, Resolve
// and Dismiss close the panel and patch the row in place (the other rows keep their DOM nodes; no reload, no flash).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Issue } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { colomboDay, monthOf } from "../ui/dateRange";
import { ToastProvider } from "../ui/Toast";
import IssuePage from "./IssuePage";
import Issues from "./Issues";

const month = monthOf(colomboDay());

const card = (over: Partial<Issue>): Issue => ({
  id: "x", kind: "vehicle_report", kind_text: "Vehicle problem", severity: "critical", title: "Vehicle problem: breakdown", detail: "Engine stalls at idle",
  status: "open", opened: `${month.from} 08:00`, updated: `${month.from} 08:00`, opened_by: "System · Vehicle problem", vehicle: "WP CAB-4521", ...over,
});

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  rows: Issue[] = [card({}), card({ id: "y", kind: "service_due", kind_text: "Service", severity: "warning", title: "Service due", detail: "At 45,000 km", opened_by: "System · Service" })];
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view", "issues", "vehicles"], tools: ["list_issues", "issue_history", "update_issue"] });
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "list_issues") {
      const status = String(args.status);
      const issues = this.rows.filter((i) => status === "all" || i.status === status);
      return { status, from: args.from, to: args.to, sort: args.sort, count: issues.length, open: this.rows.filter((i) => i.status === "open").length, in_progress: this.rows.filter((i) => i.status === "in_progress").length, issues };
    }
    if (tool === "issue_history") {
      const issue = this.rows.find((i) => i.id === args.id)!;
      return { issue, events: [{ at: issue.opened, actor: "system", action: "opened" }], report: issue.kind === "vehicle_report" ? { id: "r1", category: "breakdown", note: "Engine stalls at idle", status: "open", reported: issue.opened, photos: [] } : undefined };
    }
    if (tool === "update_issue") {
      const i = this.rows.findIndex((r) => r.id === args.id);
      // The tool's card: no opened_by / taken_by (only list_issues and issue_history read the events).
      const { opened_by: _o, taken_by: _t, ...rest } = this.rows[i];
      const next: Issue = { ...rest };
      if (args.assign_to === "me") next.assigned_to = { name: "Sahan" };
      if (args.status) next.status = String(args.status);
      if (args.status === "resolved" || args.status === "dismissed") Object.assign(next, { resolved: `${month.from} 11:00`, resolved_at: `${month.from} 11:00`, resolved_by: "Sahan", ...(args.note ? { resolution_note: args.note } : {}) });
      this.rows[i] = { ...next, opened_by: this.rows[i].opened_by, ...(next.assigned_to ? { taken_by: { name: "Sahan", at: `${month.from} 10:05` } } : {}) };
      return { issue: next, changed: ["done"] };
    }
    return {};
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    return Promise.resolve(structuredClone(this.answer(tool, args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

async function mount(url: string) {
  const transport = new FakeTransport();
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/issues" element={<Issues />}><Route path=":id" element={<IssuePage />} /></Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return transport;
}

const rowOf = (title: string) => within(screen.getByTestId("issues-list")).getByRole("link", { name: new RegExp(title) });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const realMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("the issues list (§9)", () => {
  it("asks for this month's open issues, newest first; the status and the dates are filters in the URL", async () => {
    const t = await mount("/issues");
    expect(t.argsOf("list_issues")[0]).toEqual({ status: "open", from: month.from, to: month.to, sort: "newest", limit: 200 });
    await screen.findByText("Vehicle problem: breakdown");
    expect(rowOf("Vehicle problem: breakdown").textContent).toContain(`Opened ${month.from} 08:00 · System · Vehicle problem`);
    expect(screen.getByRole("tab", { name: "Open" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Dismissed" }));
    await flush();
    expect(t.argsOf("list_issues").at(-1)).toMatchObject({ status: "dismissed" });
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=dismissed");
    expect(await screen.findByText(/^Nothing dismissed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await flush();
    expect(t.argsOf("list_issues").at(-1)).toMatchObject({ status: "dismissed", from: colomboDay(), to: colomboDay() });
  }, 20_000);

  it("an issue opens beside the list with what it shows; the X and Esc close it, the filters kept", async () => {
    await mount("/issues/x?status=all");
    const panel = await screen.findByTestId("issue-page");
    expect(screen.getByTestId("issues-list")).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Vehicle problem: breakdown" })).toBeTruthy();
    const facts = within(panel).getByTestId("issue-facts").textContent;
    expect(facts).toContain(`Opened${month.from} 08:00`);
    expect(facts).toContain("Opened bySystem · Vehicle problem");
    expect(facts).toContain("Taken byNobody yet");
    expect(within(panel).getByTestId("issue-report").textContent).toContain("Engine stalls at idle");
    expect(within(panel).getByTestId("issue-history").textContent).toContain("Opened by system");
    // The row of the open issue is marked.
    expect(rowOf("Vehicle problem: breakdown").getAttribute("aria-current")).toBe("true");

    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("issue-page")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=all");

    fireEvent.click(rowOf("Service due"));
    expect(await screen.findByRole("heading", { name: "Service due" })).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/issues/y?status=all");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("issue-page")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=all");
  });

  it("Take closes the panel and patches the row in place: the other rows keep their nodes, nothing reloads", async () => {
    const t = await mount("/issues/x?status=all");
    await screen.findByTestId("issue-page");
    await screen.findByRole("button", { name: "Take" });
    const other = rowOf("Service due");
    const loads = t.argsOf("list_issues").length;

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Take" })); });
    expect(t.argsOf("update_issue")).toEqual([{ id: "x", assign_to: "me", status: "in_progress" }]);
    expect(screen.getByRole("status").textContent).toBe("Taken");
    expect(screen.queryByTestId("issue-page")).toBeNull();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=all");
    const row = rowOf("Vehicle problem: breakdown");
    expect(row.textContent).toContain("in progress");
    expect(row.textContent).toContain("System · Vehicle problem · taken by Sahan");
    expect(rowOf("Service due")).toBe(other);
    expect(t.argsOf("list_issues").length).toBe(loads);
    expect(screen.queryByText("Loading issues…")).toBeNull();

    // Opened again: Taken by names the person.
    fireEvent.click(row);
    const panel = await screen.findByTestId("issue-page");
    expect((await within(panel).findByTestId("issue-facts")).textContent).toContain("Taken bySahan");
    expect(within(panel).queryByRole("button", { name: "Take" })).toBeNull();
  });

  it("Resolve with the note: the panel closes and the issue leaves the Open list at once", async () => {
    const t = await mount("/issues/x");
    await screen.findByRole("button", { name: "Resolve" });
    // No note: the panel says what to do and stays.
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.getByText("Write what was done first: it becomes the resolution.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: "Fuel pump replaced" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resolve" })); });
    expect(t.argsOf("update_issue")).toEqual([{ id: "x", status: "resolved", note: "Fuel pump replaced" }]);
    expect(screen.getByRole("status").textContent).toBe("Issue resolved");
    expect(screen.queryByTestId("issue-page")).toBeNull();
    expect(within(screen.getByTestId("issues-list")).queryByRole("link", { name: /Vehicle problem/ })).toBeNull();
    expect(rowOf("Service due")).toBeTruthy();

    // Under Resolved it shows who resolved it and when.
    fireEvent.click(screen.getByRole("tab", { name: "Resolved" }));
    fireEvent.click(await screen.findByRole("link", { name: /Vehicle problem: breakdown/ }));
    const panel = await screen.findByTestId("issue-page");
    expect((await within(panel).findByTestId("issue-facts")).textContent).toContain(`Resolved${month.from} 11:00 by Sahan`);
    expect(within(panel).getByText(/Resolved by Sahan/)).toBeTruthy();
  });

  it("Add note keeps the panel open", async () => {
    const t = await mount("/issues/x");
    await screen.findByRole("button", { name: "Add note" });
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: "Towed to the garage" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add note" })); });
    expect(t.argsOf("update_issue")).toEqual([{ id: "x", note: "Towed to the garage" }]);
    expect(screen.getByRole("status").textContent).toBe("Note added");
    expect(screen.getByTestId("issue-page")).toBeTruthy();
  });

  it("on a phone the issue is a full page with Back, which returns to the list", async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    await mount("/issues/x?status=all");
    await screen.findByTestId("issue-page");
    expect(screen.queryByTestId("issues-list")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("issue-page")).toBeNull();
    expect(await screen.findByTestId("issues-list")).toBeTruthy();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=all");
  });
});
