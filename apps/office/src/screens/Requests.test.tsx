// Requests (Hotfix 3, L3), on the page: Waiting by default, 25 at a time with the count in the header (page numbers on
// a desktop, Load more on a phone), the status and the search in the URL and into list_requests, the empty line in
// words, and a row opening the request beside the list from the list's own card, back to the same filters.
import { cursorAt, offsetOf } from "@fleet/paging";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { applyFilter } from "../test/controls";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { RequestDetail } from "./RequestDetail";
import { Requests } from "./Requests";
import { requestsArgs, requestsEmptyText } from "./requestsListLogic";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

const card = (n: number, status: RequestCard["status"]): RequestCard => ({
  id: `r${n}`, kind: "request", requested_by: `Asker ${n}`, when: "Mon 19 Oct 08:00", route: "Head office → Kandy", status, version: 1,
});

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  rows: RequestCard[] = [];
  me(): Promise<Me> {
    return Promise.resolve(approver);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool !== "list_requests") return Promise.reject({ code: "not_found", message: tool });
    const status = String(args.status ?? "waiting");
    const all = this.rows.filter((r) => (status === "all" || r.status === status) && (!args.search || r.requested_by.includes(String(args.search))) && (!args.id || r.id === args.id));
    const from = offsetOf(args.cursor as string | undefined);
    const requests = typeof args.limit === "number" ? all.slice(from, from + args.limit) : all;
    return Promise.resolve(structuredClone({ status, count: requests.length, total: all.length, requests }) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    let stopped = false;
    void this.call<T>(tool, args).then((data) => { if (!stopped) cb({ type: "data", data, at: Date.now() }); }, (error) => cb({ type: "error", error }));
    return () => { stopped = true; };
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const approver: Me = { name: "Palitha", role: "admin", permissions: ["view", "request", "approve"], tools: ["list_requests", "decide_request", "create_request", "cancel_request"] };

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function mount(rows: RequestCard[], url = "/requests") {
  const transport = new FakeTransport();
  transport.rows = rows;
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: approver, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/requests" element={<Requests />}><Route path=":id" element={<RequestDetail />} /></Route>
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await flush();
  return transport;
}

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("the Requests list (Hotfix 3)", () => {
  it("Waiting by default, 25 a page with the count in the header; page 2 by its cursor", async () => {
    const t = await mount([...Array.from({ length: 27 }, (_, i) => card(i + 1, "waiting")), card(99, "approved")]);
    expect(t.argsOf("list_requests")[0]).toEqual({ status: "waiting", limit: 25 });
    const list = screen.getByTestId("requests-list");
    expect(within(list).getByRole("heading").textContent).toBe("Waiting · 27");
    expect(within(list).getAllByTestId("request-row")).toHaveLength(25);
    fireEvent.click(within(screen.getByTestId("pager")).getByRole("button", { name: "2" }));
    await flush();
    expect(t.argsOf("list_requests").at(-1)).toEqual({ status: "waiting", limit: 25, cursor: cursorAt(25) });
    expect(within(screen.getByTestId("requests-list")).getAllByTestId("request-row")).toHaveLength(2);
  });

  it("a phone: Load more", async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    const t = await mount(Array.from({ length: 27 }, (_, i) => card(i + 1, "waiting")));
    expect(screen.getByTestId("load-more").textContent).toContain("Showing 25 of 27");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(t.argsOf("list_requests").at(-1)).toEqual({ status: "waiting", limit: 50 });
    expect(screen.getAllByTestId("request-row")).toHaveLength(27);
  });

  it("the status and the search go into the URL and the tool; the empty line says what the filter means", async () => {
    const t = await mount([card(1, "waiting"), card(2, "approved"), card(3, "approved")]);
    applyFilter("Status", "Approved");
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/requests?status=approved");
    expect(t.argsOf("list_requests").at(-1)).toEqual({ status: "approved", limit: 25 });
    expect(screen.getAllByTestId("request-row")).toHaveLength(2);
    // The search bar above the list, beside the Filter button (docs/ui-patterns.md §1).
    const box = within(screen.getByTestId("filter-bar")).getByLabelText("Search");
    fireEvent.change(box, { target: { value: "Asker 3" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/requests?status=approved&q=Asker+3");
    expect(t.argsOf("list_requests").at(-1)).toEqual({ status: "approved", search: "Asker 3", limit: 25 });
    expect(screen.getAllByTestId("request-row")).toHaveLength(1);
    fireEvent.change(box, { target: { value: "Nobody" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(screen.getByTestId("empty-line").textContent).toBe('No approved request matches "Nobody".');
  });

  it("a row opens the request beside the list from the list's card, the filters kept; Back returns to them", async () => {
    const t = await mount([card(1, "waiting"), card(2, "approved")], "/requests?status=approved");
    fireEvent.click(screen.getAllByTestId("request-row")[0]);
    await flush();
    expect(screen.getByTestId("where").textContent).toBe("/requests/r2?status=approved");
    expect(screen.getByTestId("request-detail")).toBeTruthy();
    expect(t.argsOf("list_requests").filter((a) => a.id)).toEqual([]);
    // The list beside it still shows the approved ones.
    expect(screen.getAllByTestId("request-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("where").textContent).toBe("/requests?status=approved");
  });
});

describe("the Requests list's words", () => {
  it("the arguments and the empty lines", () => {
    expect(requestsArgs("waiting", "")).toEqual({ status: "waiting" });
    expect(requestsArgs("all", "Kandy")).toEqual({ status: "all", search: "Kandy" });
    expect(requestsEmptyText("waiting", "", true)).toBe("You have no request waiting. Add one with New request.");
    expect(requestsEmptyText("waiting", "", false)).toBe("No requests are waiting. Add one with New request when someone asks for a vehicle.");
    expect(requestsEmptyText("declined", "", false)).toBe("No declined requests.");
    expect(requestsEmptyText("all", "Kandy", false)).toBe('No request matches "Kandy".');
  });
});
