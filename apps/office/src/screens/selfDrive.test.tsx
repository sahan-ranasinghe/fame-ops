// Round 50 (29 October 2026, phase8-plan.md §37): the site's screens for office people who drive themselves. Live shows a
// web trip as "Web trip · last seen at <stop> HH:MM" with Self-drive (never Live); Users has "Can drive (self-drive trips
// in the app)", saved at once through update_office_user can_drive; the drawn map draws a web trip's straight dashed line.
import { PRESETS } from "@fleet/permissions";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { OfficeUser } from "../data/types";
import { today } from "../lib/format";
import DrawnMap from "../map/DrawnMap";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Live } from "./Live";
import { UserManage } from "./settings/UserManage";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));

const day = today();

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private me0: Me, private answers: Record<string, (args: Record<string, unknown>) => unknown>) {}
  me(): Promise<Me> {
    return Promise.resolve(this.me0);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: tool });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => undefined;
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

describe("Live: a self-driver on a web trip", () => {
  it("the row and the card say Self-drive and \"Web trip · last seen at …\", never Live", async () => {
    const me: Me = { name: "Palitha", role: "office", permissions: ["view", "assign_tasks"], tools: ["live_drivers"] };
    const live = {
      as_of: `${day} 11:00`, counts: { all: 1, sharing: 0, stale: 0, not_sharing: 1 },
      drivers: [{
        driver: "Nimali Perera", username: "nimali@fame.test", employee_id: "e9", state: "not_sharing", status: "not_sharing", status_text: "Not sharing",
        duty: "on_task", task: "Site visit", vehicle: "WP CAB-4521 · Toyota HiAce", lat: 7.49, lng: 80.36, links: {},
        self_drive: true, web_trip: true, last_seen: { at: "10:42", stop: "Kurunegala site" },
      }],
    };
    const t = new FakeTransport(me, { live_drivers: () => live });
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
        <MemoryRouter><Live /></MemoryRouter>
      </FleetProvider>,
    );
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    const row = document.querySelector(".lrow") as HTMLElement;
    expect(within(row).getByTestId("self-drive").textContent).toBe("Self-drive");
    expect(within(row).getByTestId("live-status").textContent).toBe("Web trip · last seen at Kurunegala site 10:42");
    expect(row.textContent).not.toMatch(/\bLive\b/);
    const card = screen.getByTestId("live-detail");
    expect(within(card).getByText("Web trip · last seen at Kurunegala site 10:42")).toBeTruthy();
    expect(within(card).getByTestId("self-drive").textContent).toBe("Self-drive");
  });
});

describe("Users: Can drive (self-drive trips in the app)", () => {
  const admin: Me = { name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: [...PRESETS.fleet_admin.permissions, "users"], tools: ["list_office_users", "update_office_user"], self_drive_mode: true } as Me;
  const nimali: OfficeUser = { name: "Nimali Perera", email: "nimali@fame.test", role: "office", permissions: ["view", "request"], active: true, phone: "+94771234567" };

  async function mount(user: OfficeUser, me: Me = admin) {
    const t = new FakeTransport(me, {
      list_office_users: () => ({ count: 1, total: 1, users: [user] }),
      update_office_user: (a) => ({ updated: { name: user.name, email: a.email, role: user.role, permissions: user.permissions } }),
    });
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/settings/users/${encodeURIComponent(user.email!)}/edit`]}>
            <Routes><Route path="/settings/users/:email/edit" element={<UserManage />} /></Routes>
          </MemoryRouter>
        </ToastProvider>
      </FleetProvider>,
    );
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    return t;
  }

  it("never decided: off, with the line; switching it on calls update_office_user with can_drive only", async () => {
    const t = await mount(nimali);
    const box = await screen.findByTestId<HTMLInputElement>("can-drive");
    expect(box.checked).toBe(false);
    expect(screen.getByText("Not decided yet: it is switched on when a self-drive trip is made for Nimali Perera.")).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(t.calls.filter((c) => c.tool === "update_office_user").map((c) => c.args)).toEqual([{ email: "nimali@fame.test", can_drive: true }]));
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("can-drive").checked).toBe(true));
    expect(screen.getByText("Nimali Perera drives their own trips with the driver screens, sharing location only during the trip.")).toBeTruthy();
  });

  it("taken away: off with its line; switching it back off sends false", async () => {
    const t = await mount({ ...nimali, can_drive: true });
    const box = await screen.findByTestId<HTMLInputElement>("can-drive");
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(t.calls.filter((c) => c.tool === "update_office_user").map((c) => c.args)).toEqual([{ email: "nimali@fame.test", can_drive: false }]));
  });

  it("not shown without update_office_user (the users permission)", async () => {
    await mount(nimali, { ...admin, tools: ["list_office_users"] });
    await screen.findByText("Nimali Perera");
    expect(screen.queryByTestId("can-drive")).toBeNull();
  });
});

describe("the drawn map: a web trip's straight dashed line", () => {
  it("drawn dashed in ink when the route carries one, even with no GPS points; nothing without it", () => {
    const web = { points: [{ lat: 6.9, lng: 79.85 }, { lat: 7.49, lng: 80.36 }], label: "No live route · web trip" };
    const { container, rerender } = render(<DrawnMap markers={[]} route={{ points: [], web }} onPick={() => undefined} />);
    const line = container.querySelector('[data-testid="web-trip-line"]');
    expect(line).not.toBeNull();
    expect(line!.getAttribute("stroke-dasharray")).toBe("10 8");
    expect(container.querySelector('[data-testid="drawn-route"]')).toBeNull();
    rerender(<DrawnMap markers={[]} route={{ points: [{ lat: 6.9, lng: 79.85 }, { lat: 7, lng: 79.9 }] }} onPick={() => undefined} />);
    expect(container.querySelector('[data-testid="web-trip-line"]')).toBeNull();
  });
});
