// Settings → Notifications in groups (Hotfix O2-H2, Part 2): only the groups this person's permissions bring, each a row
// with its summary opening its own page; a box flips at once and turns back with a toast when the save fails; Pause all
// switches every shown event off and Resume puts back what each was. The groups are one file shared with the app.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fleet, FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { NotificationSettings } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import { NOTIF_GROUPS } from "./notificationGroups";
import NotificationGroup from "./NotificationGroup";
import Notifications from "./Notifications";
import { pauseStorageKey } from "./useNotifSettings";

const ALL = NOTIF_GROUPS.flatMap((g) => g.events);

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  saved: Record<string, boolean> = {};
  fail = false;
  constructor(private permissions: string[]) {}
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  settings(): NotificationSettings {
    const events = ALL.filter((e) => e.needs.length === 0 || e.needs.some((p) => this.permissions.includes(p)))
      .map((e) => ({ event: e.event, label: `Server ${e.event}`, text: "Server text", enabled: this.saved[e.event] ?? true }));
    return { events, devices: [], push: { configured: true }, sound: { on: true, volume: 70 } };
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "my_notification_settings") return Promise.resolve(this.settings() as T);
    if (tool === "set_my_notification_settings") {
      if (this.fail) return Promise.reject({ code: "network", message: "Failed to fetch" });
      Object.assign(this.saved, args.events as Record<string, boolean>);
      return Promise.resolve(this.settings() as T);
    }
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const requester: Me = { name: "Nimal", email: "nimal@fame.test", role: "staff", permissions: ["view", "request"], tools: ["my_notification_settings", "set_my_notification_settings"] };

function mount(t: FakeTransport, at = "/settings/notifications", me: Me = requester) {
  const fleet: Fleet = { store: new FleetStore(t), transport: t, me, noConnector: false };
  return render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/settings/notifications" element={<Notifications />} />
            <Route path="/settings/notifications/:group" element={<NotificationGroup />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

const sets = (t: FakeTransport) => t.calls.filter((c) => c.tool === "set_my_notification_settings").map((c) => c.args.events as Record<string, boolean>);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("Settings → Notifications in groups", () => {
  it("the groups file is byte-identical to the app's", () => {
    const here = readFileSync(join(__dirname, "notificationGroups.ts"), "utf8");
    const app = readFileSync(join(__dirname, "../../../../driver/src/office/notificationGroups.ts"), "utf8");
    expect(here).toBe(app);
  });

  it("shows only the groups a requester can get, each with its summary, and no event switches on the page", async () => {
    const t = new FakeTransport(requester.permissions);
    t.saved = { "request.arrived": false };
    mount(t);
    await screen.findByTestId("notif-group-mine");
    for (const g of ["requests", "tasks", "vehicles", "mine"]) expect(screen.getByTestId(`notif-group-${g}`)).toBeTruthy();
    for (const g of ["issues", "drivers"]) expect(screen.queryByTestId(`notif-group-${g}`)).toBeNull();
    expect(screen.getByTestId("notif-group-mine").textContent).toContain("Things I asked for or ride in · 10 of 11 on");
    expect(screen.getByTestId("notif-group-vehicles").textContent).toContain("All on");
    expect(screen.getByTestId("notif-group-mine").getAttribute("href")).toBe("/settings/notifications/mine");
    expect(screen.getAllByRole("switch")).toHaveLength(1); // Pause all
    expect(screen.getByTestId("notif-sounds").textContent).toContain("On · 70 %");
  });

  it("a group's page: its switches only, with our short words; a box saves at once", async () => {
    const t = new FakeTransport(requester.permissions);
    mount(t, "/settings/notifications/tasks");
    await screen.findByRole("switch", { name: "Driver can't do a task" });
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.queryByRole("switch", { name: "Driver skips a stop" })).toBeNull();
    expect(screen.getByText("It needs another driver")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Task not accepted in time" }));
    expect((screen.getByRole("switch", { name: "Task not accepted in time" }) as HTMLInputElement).checked).toBe(false);
    await waitFor(() => expect(sets(t)).toEqual([{ "task.not_accepted": false }]));
  });

  it("a failed save turns the box back and says so", async () => {
    const t = new FakeTransport(requester.permissions);
    t.fail = true;
    mount(t, "/settings/notifications/mine");
    const box = await screen.findByRole("switch", { name: "Driver on the way" });
    await act(async () => {
      fireEvent.click(box);
    });
    await waitFor(() => expect((screen.getByRole("switch", { name: "Driver on the way" }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByRole("status").textContent).toContain("Not saved.");
  });

  it("Pause all switches every shown event off and keeps what each was; Resume puts them back", async () => {
    const t = new FakeTransport(requester.permissions);
    t.saved = { "request.arrived": false };
    mount(t);
    const pause = await screen.findByRole("switch", { name: "Pause all notifications" });
    await act(async () => {
      fireEvent.click(pause);
    });
    await waitFor(() => expect((screen.getByRole("switch", { name: "Pause all notifications" }) as HTMLInputElement).checked).toBe(true));
    const offs = sets(t)[0];
    expect(Object.values(offs).every((v) => !v)).toBe(true);
    expect("request.arrived" in offs).toBe(false);
    expect("request.created" in offs).toBe(false);
    expect(JSON.parse(localStorage.getItem(pauseStorageKey(requester)) ?? "{}").saved["request.arrived"]).toBe(false);
    expect(screen.getByTestId("notif-group-mine").tagName).not.toBe("A"); // paused: the groups do not open
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Pause all notifications" }));
    });
    await waitFor(() => expect((screen.getByRole("switch", { name: "Pause all notifications" }) as HTMLInputElement).checked).toBe(false));
    expect(t.saved["request.arrived"]).toBe(false);
    expect(t.saved["request.on_the_way"]).toBe(true);
    expect(localStorage.getItem(pauseStorageKey(requester))).toBeNull();
    expect(screen.getByTestId("notif-group-mine").textContent).toContain("10 of 11 on");
  });
});
