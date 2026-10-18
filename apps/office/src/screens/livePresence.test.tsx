// Part 3b (H2, H4) on Live: for people with approve or assign_tasks the answer carries the late report, "not available"
// now, the next task and the usual start; Live shows them on the driver's row and card, and nothing when they are absent.
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import { today } from "../lib/format";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { Live } from "./Live";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));

const day = today();
const base = { employee_id: "e1", state: "sharing" as const, duty: "on_task" as const, location: "Live · 1 min", status: "live" as const, status_text: "Live · 1 min", last_position_at: "08:59", vehicle: "WP CAB-4521 · Toyota HiAce", near: "Kelaniya", lat: 6.96, lng: 79.89, links: {} };
const live = {
  as_of: `${day} 09:00`, counts: { all: 2, sharing: 2, stale: 0, not_sharing: 0 },
  drivers: [
    {
      ...base, driver: "Kamal Perera", username: "kamal.p", task: "Team drop",
      late_report: { min: 15, said: "08:52", text: "Running late 15 min · said 08:52" },
      next_task: { title: "Site visit", when: "14:30" }, usual_start: "07:40",
    },
    { ...base, employee_id: "e2", driver: "Nuwan Silva", username: "nuwan.s", duty: "off_duty" as const, not_available: "Not available, back 13:00" },
  ],
};
const me: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["live_drivers"] };

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  me(): Promise<Me> {
    return Promise.resolve(me);
  }
  call<T>(tool: string): Promise<T> {
    return Promise.resolve((tool === "live_drivers" ? structuredClone(live) : {}) as T);
  }
  watch<T>(tool: string, _args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    cb({ type: "data", data: (tool === "live_drivers" ? structuredClone(live) : {}) as T, at: Date.now() });
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

describe("Live: the dispatcher's lines (H2, H4)", () => {
  it("the late report and not available in amber, the next task and the usual start in grey, on the row and the card", async () => {
    const transport = new FakeTransport();
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <MemoryRouter><Live /></MemoryRouter>
      </FleetProvider>,
    );
    await act(async () => { await Promise.resolve(); });
    const rows = document.querySelectorAll(".lrow");
    expect(rows).toHaveLength(2);
    const kamal = rows[0] as HTMLElement;
    expect(within(kamal).getByTestId("live-presence-warn").textContent).toBe("Running late 15 min · said 08:52");
    expect(within(kamal).getByTestId("live-presence").textContent).toBe("Next: Site visit · 14:30 · usually starts 07:40");
    const nuwan = rows[1] as HTMLElement;
    expect(within(nuwan).getByTestId("live-presence-warn").textContent).toBe("Not available, back 13:00");
    expect(within(nuwan).queryByTestId("live-presence")).toBeNull();
    // The card of the driver shown says the same.
    const card = screen.getByTestId("live-detail");
    expect(within(card).getAllByTestId(/^live-presence/).map((e) => e.textContent).join(" | ")).toMatch(/Running late 15 min · said 08:52|Not available, back 13:00/);
  });
});
