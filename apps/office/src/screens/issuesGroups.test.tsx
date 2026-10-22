// The issues page's Round 4–7 parts (item 8, §33.7): the tabs Open · Snoozed · Resolved; Open grouped by kind (the most
// urgent group first, 3 newest, "Show all N" to the kind's list, collapsible); Gmail's rows (one title, one grey line with
// the plate chip, never the kind or "System" again); the ticks and the bulk Resolve / Dismiss with one reason
// (update_issues); and every action the page had before is still there (issuesPages.test.tsx keeps its own tests).
import { offsetOf, cursorAt } from "@fleet/paging";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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
import { datesInWords } from "../lib/when";

const month = monthOf(colomboDay());

const card = (over: Partial<Issue>): Issue => ({
  id: "x", kind: "vehicle_report", kind_text: "Vehicle problem", severity: "critical", title: "Vehicle problem: breakdown", headline: "Breakdown", detail: "Engine stalls at idle",
  meta: "WP CAB-4521 · Kamal · 2 h ago", status: "open", opened: `${month.from} 08:00`, updated: `${month.from} 08:00`, opened_by: "System · Vehicle problem", vehicle: "WP CAB-4521", ...over,
});
const RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  rows: Issue[] = [card({}), card({ id: "y", kind: "service_due", kind_text: "Service", severity: "warning", title: "Service due", detail: "At 45,000 km", opened_by: "System · Service" })];
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  tools = ["list_issues", "issue_history", "update_issue", "update_issues"];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view", "issues", "vehicles"], tools: this.tools });
  }
  answer(tool: string, args: Record<string, unknown>): unknown {
    if (tool === "list_issues") {
      // As the server pages (Hotfix 3): Active = open or in progress; snoozed true = only those, false = without them;
      // Round 4–7: status snoozed = the active ones snoozed, group = by kind, the most urgent first, 3 newest each.
      const status = String(args.status);
      const active = (i: Issue) => i.status === "open" || i.status === "in_progress";
      const fits = (i: Issue) => status === "all" || (status === "active" ? active(i) : status === "snoozed" ? active(i) && !!i.snoozed_until : i.status === status);
      const snooze = (i: Issue) => (args.snoozed === true ? !!i.snoozed_until : args.snoozed === false ? !i.snoozed_until : true);
      const words = (i: Issue) => !args.search || i.title.toLowerCase().includes(String(args.search).toLowerCase());
      const ofKind = (i: Issue) => !args.kind || i.kind === args.kind;
      const all = this.rows.filter((i) => fits(i) && snooze(i) && words(i) && ofKind(i));
      const counted = this.rows.filter((i) => active(i) && !i.snoozed_until);
      const counts = {
        open: counted.filter((i) => i.status === "open").length, in_progress: counted.filter((i) => i.status === "in_progress").length,
        snoozed: this.rows.filter((i) => active(i) && i.snoozed_until).length,
        needs_action: counted.filter((i) => i.severity !== "info").length, critical: counted.filter((i) => i.severity === "critical").length,
      };
      if (args.group) {
        const kinds = [...new Set(all.map((i) => i.kind))];
        const groups = kinds.map((k) => {
          const mine = all.filter((i) => i.kind === k);
          const severity = mine.reduce<string>((b, i) => (RANK[i.severity] < RANK[b] ? i.severity : b), "info") as "critical" | "warning" | "info";
          return { kind: k, kind_text: mine[0].kind_text ?? k, severity, count: mine.length, newest: mine.slice(0, 3) };
        }).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
        return { status, count: 0, ...counts, issues: [], groups };
      }
      const from = offsetOf(args.cursor as string | undefined);
      const issues = typeof args.limit === "number" ? all.slice(from, from + args.limit) : all;
      const end = from + issues.length;
      return {
        status, from: args.from, to: args.to, sort: args.sort, count: issues.length, total: all.length, ...(end < all.length ? { next: cursorAt(end) } : {}),
        ...counts, issues,
      };
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
    if (tool === "update_issues") {
      const ids = args.ids as string[];
      for (const id of ids) this.answer("update_issue", { id, status: args.status, note: args.note });
      return { status: args.status, done: ids.length, note: args.note };
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

async function mount(url: string, rows?: Issue[]) {
  const transport = new FakeTransport();
  if (rows) transport.rows = rows;
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
const group = (kind: string) => screen.getByTestId(`issue-group-${kind}`);
/** The Filter panel has this section (and, with a choice, that choice); Esc closes it with nothing applied. */
function expectFilterSection(section: string) {
  fireEvent.click(screen.getByTestId("filter-button"));
  expect(within(screen.getByTestId("filter-panel")).getByRole("group", { name: section })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
}
function expectFilterChoice(section: string, choice: string) {
  fireEvent.click(screen.getByTestId("filter-button"));
  const g = within(screen.getByTestId("filter-panel")).getByRole("group", { name: section });
  expect(within(g).getByLabelText(choice)).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
}
/** The section is there, without that choice. */
function expectNoFilterChoice(section: string, choice: string | RegExp) {
  fireEvent.click(screen.getByTestId("filter-button"));
  const g = within(screen.getByTestId("filter-panel")).getByRole("group", { name: section });
  expect(within(g).queryByLabelText(choice)).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
}
/** The Filter panel has no such section. */
function expectNoFilterSection(section: string) {
  fireEvent.click(screen.getByTestId("filter-button"));
  expect(within(screen.getByTestId("filter-panel")).queryByRole("group", { name: section })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const realMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("the Open tab: grouped by kind (Round 4–7, item 8)", () => {
  const odo = (n: number) => Array.from({ length: n }, (_, k) => card({ id: `o${k + 1}`, kind: "odometer_flag", kind_text: "Odometer check", severity: "warning", title: `Odometer check: reading ${k + 1}`, headline: `Odometer reading ${k + 1} could not be read`, vehicle: `WP KV-${7700 + k}`, meta: `WP KV-${7700 + k} · Nimal · ${k + 1} h ago` }));
  const rows = () => [...odo(5), card({}), card({ id: "n1", kind: "documents_missing", kind_text: "Documents missing", severity: "info", title: "Documents missing: 2", headline: "CAP-2207: 2 documents missing", vehicle: "CAP-2207", meta: "CAP-2207 · 3 d ago" })];

  it("asks for the groups (the snoozed left out, any time: Sahan's OK, 22 October 2026); the most urgent group first; 3 newest; Gmail's rows", async () => {
    const t = await mount("/issues", rows());
    expect(t.argsOf("list_issues")[0]).toEqual({ status: "active", snoozed: false, group: true });
    await screen.findByTestId("issue-group-vehicle_report");
    const order = [...screen.getByTestId("issues-list").querySelectorAll("[data-kind]")].map((e) => (e as HTMLElement).dataset.kind);
    expect(order).toEqual(["vehicle_report", "odometer_flag", "documents_missing"]);
    expect(within(group("odometer_flag")).getByTestId("group-toggle").textContent).toContain("Odometer checks · 5");
    expect(within(group("odometer_flag")).getAllByTestId("issue-line")).toHaveLength(3);
    // The row: ONE title, ONE grey line (the plate chip · driver · when); never the kind, "System" or the status again.
    const row = rowOf("Breakdown");
    expect(within(row).getByTestId("issue-meta").textContent).toBe("WP CAB-4521Kamal · 2 h ago");
    expect(within(row).getByTestId("issue-meta").querySelector(".plate")?.textContent).toBe("WP CAB-4521");
    expect(row.textContent).not.toMatch(/System|Vehicle problem|open/);
    // The summary counts what needs action (not the info group); the tabs count what they list.
    expect(screen.getByTestId("issues-summary").textContent).toBe("6 need action · 1 critical");
    expect(screen.getByRole("tab", { name: "Open · 7" })).toBeTruthy();
    expect(within(screen.getByTestId("issues-list")).getByTestId("list-count").textContent).toBe(" · 7");
  });

  it("a group collapses; Show all N opens the kind's list (25 a page) with the way back to the groups", async () => {
    const t = await mount("/issues", rows());
    await screen.findByTestId("issue-group-odometer_flag");
    fireEvent.click(within(group("odometer_flag")).getByTestId("group-toggle"));
    expect(within(group("odometer_flag")).queryAllByTestId("issue-line")).toHaveLength(0);
    expect(within(group("odometer_flag")).getByTestId("group-toggle").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(group("odometer_flag")).getByTestId("group-show-all"));
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/issues?kind=odometer_flag");
    expect(t.argsOf("list_issues").at(-1)).toEqual({ status: "active", sort: "urgent", snoozed: false, kind: "odometer_flag", limit: 25 });
    await screen.findByText("Odometer reading 5 could not be read");
    const list = screen.getByTestId("issues-list");
    expect(within(list).getAllByTestId("issue-line")).toHaveLength(5);
    expect(within(list).getByRole("heading").textContent).toContain("Odometer checks");
    fireEvent.click(within(list).getByRole("button", { name: "All kinds" }));
    expect(screen.getByTestId("where").textContent).toBe("/issues");
  });

  it("the tabs: Snoozed (its rows say until when) and Resolved (the newest first); the Filter's Status is the Open tab's own", async () => {
    const t = await mount("/issues", [...rows(), card({ id: "z", title: "Documents missing", headline: "WP PH-2087: 3 documents missing", kind: "documents_missing", severity: "info", snoozed_until: "2026-10-19 07:00", snoozed_by: "Sahan" })]);
    await screen.findByTestId("issue-group-vehicle_report");
    fireEvent.click(screen.getByRole("tab", { name: "Snoozed · 1" }));
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=snoozed");
    expect(t.argsOf("list_issues").at(-1)).toEqual({ status: "active", from: month.from, to: month.to, sort: "urgent", snoozed: true, limit: 25 });
    expect((await screen.findByTestId("snoozed-until")).textContent).toBe(datesInWords("Snoozed until 2026-10-19 07:00 · by Sahan"));
    expect(within(screen.getByTestId("issues-list")).queryByText("Breakdown")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Resolved" }));
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/issues?status=resolved");
    expect(t.argsOf("list_issues").at(-1)).toEqual({ status: "resolved", from: month.from, to: month.to, sort: "newest", limit: 25 });
    expect(await screen.findByText(/^Nothing resolved/)).toBeTruthy();
    // Round 4–7 (Sahan's OK, 22 October 2026): Snoozed, Resolved, Dismissed and All repeated the tabs and left the Filter;
    // under Snoozed and Resolved the tab says the status (no Status section); the Open tab's Filter keeps its own three.
    expect(screen.getByTestId("date-range-button").textContent).toMatch(/^This month/);
    // Resolved keeps its date range as before: no "Any time" among its presets.
    fireEvent.click(screen.getByTestId("date-range-button"));
    expect(within(screen.getByTestId("date-range-sheet")).queryByRole("button", { name: "Any time" })).toBeNull();
    expect(within(screen.getByTestId("date-range-sheet")).getByRole("button", { name: "This month" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("date-range-button"));
    expectNoFilterSection("Status");
    for (const s of ["Kind", "Vehicle", "Severity"]) expectFilterSection(s);
    fireEvent.click(screen.getByRole("tab", { name: "Snoozed · 1" }));
    await flush();
    expectNoFilterSection("Status");
    fireEvent.click(screen.getByRole("tab", { name: /^Open/ }));
    await flush();
    expect(screen.getByTestId("date-range-button").textContent).toBe("Any time");
    for (const s of ["Active", "Open", "In progress"]) expectFilterChoice("Status", s);
    for (const s of [/^Snoozed/, "Resolved", "Dismissed", "All"]) expectNoFilterChoice("Status", s);
  }, 20_000);

  it("bulk: tick rows, Resolve with a reason (required), one update_issues call; the bar and the ticks go", async () => {
    const t = await mount("/issues", rows());
    await screen.findByTestId("issue-group-odometer_flag");
    const lines = within(group("odometer_flag")).getAllByTestId("issue-line");
    fireEvent.click(within(lines[0]).getByRole("checkbox"));
    fireEvent.click(within(lines[1]).getByRole("checkbox"));
    expect(screen.getByTestId("bulk-bar").textContent).toContain("2 selected");
    fireEvent.click(within(screen.getByTestId("bulk-bar")).getByRole("button", { name: "Resolve" }));
    const sheet = screen.getByTestId("bulk-sheet");
    expect(within(sheet).getByRole("heading", { name: "Resolve 2 issues" })).toBeTruthy();
    expect((within(sheet).getByTestId("bulk-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole("button", { name: "Test data" }));
    await act(async () => { fireEvent.click(within(sheet).getByTestId("bulk-confirm")); });
    expect(t.argsOf("update_issues")).toEqual([{ ids: ["o1", "o2"], status: "resolved", note: "Test data" }]);
    expect(screen.getByRole("status").textContent).toBe("2 issues resolved");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    expect(screen.queryByTestId("bulk-sheet")).toBeNull();
  });

  it("a group's tick picks its rows shown; then Select all N in this group picks every one of the kind; Dismiss them", async () => {
    const t = await mount("/issues", rows());
    await screen.findByTestId("issue-group-odometer_flag");
    fireEvent.click(within(group("odometer_flag")).getByTestId("group-tick"));
    expect(screen.getByTestId("bulk-bar").textContent).toContain("3 selected");
    await act(async () => { fireEvent.click(within(screen.getByTestId("group-select-all")).getByRole("button", { name: "Select all 5 in this group" })); });
    expect(t.argsOf("list_issues").at(-1)).toEqual({ status: "active", sort: "urgent", snoozed: false, kind: "odometer_flag", limit: 5 });
    expect(screen.getByTestId("bulk-bar").textContent).toContain("5 selected");
    fireEvent.click(within(screen.getByTestId("bulk-bar")).getByRole("button", { name: "Dismiss" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Test phone, not real" } });
    await act(async () => { fireEvent.click(screen.getByTestId("bulk-confirm")); });
    expect(t.argsOf("update_issues")).toEqual([{ ids: ["o1", "o2", "o3", "o4", "o5"], status: "dismissed", note: "Test phone, not real" }]);
    expect(screen.getByRole("status").textContent).toBe("5 issues dismissed");
  });

  // The fresh reviewer (22 October 2026): 120 picked are two calls; the second fails: the first call's 100 leave the
  // selection, the error says how many were done, and Try again sends only the 20 left (never a done one twice).
  it("bulk over 100: a failed call stops the rest, the done ones leave the selection, Try again sends only the rest", async () => {
    const t = await mount("/issues", [...odo(120), card({})]);
    let fail = true;
    const answer = t.answer.bind(t);
    t.answer = (tool, args) => {
      if (tool === "update_issues" && t.argsOf("update_issues").length === 2 && fail) throw { code: "network", message: "Failed to fetch" };
      return answer(tool, args);
    };
    const call = t.call.bind(t);
    t.call = <T,>(tool: string, args: Record<string, unknown> = {}) => {
      try {
        return call<T>(tool, args);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    await screen.findByTestId("issue-group-odometer_flag");
    fireEvent.click(within(group("odometer_flag")).getByTestId("group-tick"));
    await act(async () => { fireEvent.click(within(screen.getByTestId("group-select-all")).getByRole("button", { name: "Select all 120 in this group" })); });
    expect(screen.getByTestId("bulk-bar").textContent).toContain("120 selected");
    fireEvent.click(within(screen.getByTestId("bulk-bar")).getByRole("button", { name: "Resolve" }));
    fireEvent.click(within(screen.getByTestId("bulk-sheet")).getByRole("button", { name: "Test data" }));
    await act(async () => { fireEvent.click(screen.getByTestId("bulk-confirm")); });
    await flush();
    expect(t.argsOf("update_issues").map((a) => (a.ids as string[]).length)).toEqual([100, 20]);
    const sheet = screen.getByTestId("bulk-sheet");
    expect(sheet.textContent).toContain("100 issues resolved; the rest were not");
    expect(within(sheet).getByRole("heading", { name: "Resolve 20 issues" })).toBeTruthy();
    fail = false;
    await act(async () => { fireEvent.click(screen.getByTestId("bulk-confirm")); });
    await flush();
    const sent = t.argsOf("update_issues").map((a) => a.ids as string[]);
    expect(sent.map((x) => x.length)).toEqual([100, 20, 20]);
    expect(sent[2]).toEqual(sent[1]);
    expect(sent[2].some((id) => sent[0].includes(id))).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("20 issues resolved");
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("without update_issues (assign_tasks only): no ticks and no bulk bar", async () => {
    const transport = new FakeTransport();
    transport.tools = ["list_issues", "issue_history"];
    transport.rows = rows();
    const me = await transport.me();
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <ToastProvider><MemoryRouter initialEntries={["/issues"]}><Routes><Route path="/issues" element={<Issues />} /></Routes></MemoryRouter></ToastProvider>
      </FleetProvider>,
    );
    await screen.findByTestId("issue-group-odometer_flag");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("nothing open: the empty state with its icon", async () => {
    await mount("/issues", []);
    // Any time (the Open tab's default since Round 4–7): no days in brackets, and no "opened outside these dates" note.
    expect((await screen.findByTestId("issues-empty")).textContent).toBe("Nothing needs attention. The fleet is in order.");
    expect(screen.queryByText(/outside these dates/)).toBeNull();
  });

  it("a range picked on the Open tab is asked with its days; no note about the issues outside them", async () => {
    const t = await mount("/issues?range=month", rows());
    await screen.findByTestId("issue-group-vehicle_report");
    expect(t.argsOf("list_issues")[0]).toEqual({ status: "active", from: month.from, to: month.to, snoozed: false, group: true });
    expect(screen.getByTestId("date-range-button").textContent).toMatch(/^This month/);
    expect(screen.queryByText(/outside these dates/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the last 12 months" })).toBeNull();
  });
});

describe("every action of the page is still there (rule 4 of the Round 4–7 UI rules)", () => {
  it("the list: tabs, the date range, search, Filter (status, kind, vehicle, severity), Sort on a list, Show all, the ticks, Load more / pages, open an issue", async () => {
    const many = Array.from({ length: 30 }, (_, k) => card({ id: `i${k + 1}`, kind: "odometer_flag", kind_text: "Odometer check", severity: "warning", title: `Odometer check ${k + 1}`, headline: `Odometer check ${k + 1}` }));
    await mount("/issues", many);
    await screen.findByTestId("issue-group-odometer_flag");
    expect(screen.getAllByRole("tab").map((x) => x.textContent?.replace(/ · \d+$/, ""))).toEqual(["Open", "Snoozed", "Resolved"]);
    expect(screen.getByTestId("date-range-button")).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeTruthy();
    for (const section of ["Status", "Kind", "Vehicle", "Severity"]) expectFilterSection(section);
    expect(within(group("odometer_flag")).getByTestId("group-show-all").textContent).toBe("Show all 30");
    expect(within(group("odometer_flag")).getByTestId("group-tick")).toBeTruthy();
    fireEvent.click(within(group("odometer_flag")).getByTestId("group-show-all"));
    await flush();
    expect(await screen.findByTestId("pager")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Order/ })).toBeTruthy();
    expect(screen.getByTestId("page-tick")).toBeTruthy();
    fireEvent.click(within(screen.getAllByTestId("issue-line")[0]).getByRole("link"));
    expect(await screen.findByTestId("issue-page")).toBeTruthy();
  });

  it("one issue: Take, Add note, Resolve, Dismiss on an open one; Reopen on a closed one; its task, driver and report", async () => {
    await mount("/issues/x?kind=vehicle_report", [card({ driver: "Kamal", driver_username: "kamal" })]);
    const panel = await screen.findByTestId("issue-page");
    for (const name of ["Take", "Add note", "Resolve", "Dismiss"]) expect(await within(panel).findByRole("button", { name })).toBeTruthy();
    expect(within(panel).getByTestId("issue-report")).toBeTruthy();
    expect(within(panel).getByTestId("issue-history")).toBeTruthy();
    cleanup();
    await mount("/issues/x?status=resolved", [card({ status: "resolved", resolved_by: "Sahan", resolved_at: `${month.from} 11:00` })]);
    expect(await within(await screen.findByTestId("issue-page")).findByRole("button", { name: "Reopen" })).toBeTruthy();
  });
});
