// Remove a place (Phase 7, §15), on the pages: the place page's second step (the first click only reads place_detail's
// in_use: the reasons and tasks above the second button, two clicks in all; the server's needs_confirm above Remove
// anyway for reasons that came up since, the notice with Settings → Fleet when the base place was cleared, the
// removed place read-only with Restore), and Places → Removed places with Restore on each row.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { applyFilter } from "../test/controls";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { PlacePage } from "./PlacePage";
import { Places } from "./Places";

vi.mock("../map/PinMap", () => ({ PinMap: () => <div data-testid="pin-map" /> }));

type Answer = (args: Record<string, unknown>, n: number) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    return Promise.resolve(structuredClone(a(args, this.argsOf(tool).length)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(transport: FakeTransport, url: string) {
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/places" element={<Places />}><Route path=":id" element={<PlacePage />} /></Route>
            <Route path="/settings/fleet/office" element={<div>Fleet settings</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

const fleetAdmin: Me = {
  name: "Sahan", role: "admin", permissions: ["view", "vehicles", "assign_tasks", "users"],
  tools: ["list_places", "place_detail", "update_place", "remove_place", "restore_place", "update_settings", "task_detail"],
};
const PLACE = { id: "p1", name: "Head office", kind: "office", badge: "Office", source: "manual", updated_at: "2026-10-01 09:00", lat: 6.9, lng: 79.85, pinned: true };
const TASKS = [{ task_id: "t1", title: "Team drop · Kurunegala site", when: "Sun 18 Oct 09:00" }];

const IN_USE = { reasons: ["Head office is the base place", "1 task today or later starts or stops there"], tasks: TASKS };

describe("the place page's Remove", () => {
  it("asks on the page in two clicks: the first only reads, the reasons and tasks above Yes, remove; then the notice and Restore", async () => {
    let removed = false;
    const t = new FakeTransport({
      list_places: () => ({ count: 1, places: [PLACE] }),
      place_detail: () => removed
        ? { place: { ...PLACE, active: false, removed: "2026-10-17 10:05 by Sahan" }, stops_90_days: 3 }
        : { place: PLACE, stops_90_days: 3, in_use: IN_USE },
      remove_place: (a) => {
        if (!a.confirm) return { needs_confirm: true, place: "Head office", ...IN_USE };
        removed = true;
        return { removed: "Head office", base_place_cleared: true, tasks: TASKS };
      },
      restore_place: () => { removed = false; return { restored: "Head office", place: PLACE }; },
    }, fleetAdmin);
    await mount(t, "/places/p1");
    const block = await screen.findByTestId("place-remove");
    expect(block.textContent).toContain("Remove this place");

    const reads = t.argsOf("place_detail").length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
    expect(t.argsOf("remove_place")).toEqual([]);
    expect(t.argsOf("place_detail").length).toBe(reads + 1);
    const asked = screen.getByTestId("place-remove");
    expect(asked.textContent).toContain("Remove Head office?");
    expect(asked.textContent).toContain("Head office is the base place; 1 task today or later starts or stops there.");
    expect(screen.getByRole("link", { name: "Sun 18 Oct 09:00 · Team drop · Kurunegala site" }).getAttribute("href")).toBe("/tasks/t1");

    // Keep it goes back; asking again starts from the first step.
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByTestId("place-remove").textContent).toContain("Remove this place");
    expect(screen.queryByTestId("place-remove-tasks")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, remove" })); });
    expect(t.argsOf("remove_place")).toEqual([{ id: "p1", confirm: true }]);

    expect(await screen.findByText(/Removed\. It is listed under Removed places\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /The base place is no longer set/ }).getAttribute("href")).toBe("/settings/fleet/office");
    expect(screen.getByTestId("place-removed").textContent).toMatch(/Removed by Sahan Sat 17 Oct/);
    expect(screen.queryByTestId("place-remove")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore" })); });
    expect(t.argsOf("restore_place")).toEqual([{ id: "p1" }]);
    expect(await screen.findByText(/Restored\. It is back in the searches/)).toBeTruthy();
    expect(screen.queryByTestId("place-removed")).toBeNull();
    expect(screen.getByTestId("place-remove").textContent).toContain("Remove this place");
  });

  it("reasons that came up after the first click: the server asks, and Remove anyway confirms", async () => {
    const t = new FakeTransport({
      list_places: () => ({ count: 1, places: [PLACE] }),
      place_detail: () => ({ place: PLACE, stops_90_days: 0 }),
      remove_place: (a) => a.confirm ? { removed: "Head office", tasks: TASKS } : { needs_confirm: true, place: "Head office", reasons: [IN_USE.reasons[1]], tasks: TASKS },
    }, fleetAdmin);
    await mount(t, "/places/p1");
    await screen.findByTestId("place-remove");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove" })); });
    expect(screen.getByTestId("place-remove").textContent).toContain("It moves to Removed places");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, remove" })); });
    expect(t.argsOf("remove_place")).toEqual([{ id: "p1" }]);
    expect(screen.getByTestId("place-remove").textContent).toContain("Remove Head office anyway?");
    expect(screen.getByTestId("place-remove-tasks").textContent).toContain("Team drop · Kurunegala site");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Remove anyway" })); });
    expect(t.argsOf("remove_place").at(-1)).toEqual({ id: "p1", confirm: true });
    expect(await screen.findByText(/Removed\. It is listed under Removed places\./)).toBeTruthy();
  });

  it("no Remove without remove_place, and no Restore without restore_place", async () => {
    const t = new FakeTransport({
      list_places: () => ({ count: 0, places: [] }),
      place_detail: () => ({ place: { ...PLACE, removed: "2026-10-17 10:05 by Sahan" }, stops_90_days: 0 }),
    }, { ...fleetAdmin, tools: ["list_places", "place_detail", "update_place"] });
    await mount(t, "/places/p1");
    expect((await screen.findByTestId("place-removed")).textContent).toContain("Removed by Sahan");
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    expect(screen.queryByTestId("place-remove")).toBeNull();
  });
});

describe("Places → Removed places", () => {
  it("lists list_places({ removed: true }) with the removed line and Restore on each row; the list refreshes", async () => {
    let removed = [{ id: "p2", name: "Kandy store", kind: "store", pinned: true, removed: "2026-10-16 15:20 by Palitha" }];
    const t = new FakeTransport({
      list_places: (a) => ({ count: 1, places: a.removed ? removed : [PLACE] }),
      restore_place: () => {
        removed = [];
        return { restored: "Kandy store", place: { ...PLACE, id: "p2", name: "Kandy store" } };
      },
    }, fleetAdmin);
    await mount(t, "/places");
    await screen.findByText("Head office");
    applyFilter("Places", "Removed places");
    expect(await screen.findByText(/^Removed by Palitha Fri 16 Oct( 2026)? 15:20$/)).toBeTruthy();
    expect(t.argsOf("list_places").at(-1)).toEqual({ limit: 25, removed: true });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore" })); });
    expect(t.argsOf("restore_place")).toEqual([{ id: "p2" }]);
    expect(await screen.findByText("No place has been removed.")).toBeTruthy();
  });

  it("no Removed places chip without restore_place", async () => {
    const t = new FakeTransport({ list_places: () => ({ count: 1, places: [PLACE] }) }, { ...fleetAdmin, tools: ["list_places", "place_detail"] });
    await mount(t, "/places?who=removed");
    await screen.findByText("Head office");
    expect(screen.queryByRole("button", { name: "Removed places" })).toBeNull();
    expect(t.argsOf("list_places").every((a) => !a.removed)).toBe(true);
  });
});
