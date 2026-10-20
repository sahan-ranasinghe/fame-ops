// No loading state runs forever (Sahan, 20 October 2026) on Settings → Notifications: a browser whose service worker never
// answers (navigator.serviceWorker.ready and getRegistration never settle) still gets the whole page, with "not available
// in this browser right now" for its push line and Turn on failing within the limit; a settings call that never answers
// shows the error with Try again after 20 s, and Try again loads the page.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { NotificationSettings } from "../../data/types";
import { BROWSER_WAIT_MS, BrowserTooSlow, pushState, subscribePush } from "../../push";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import Notifications from "./Notifications";
import { PAGE_WAIT_MS } from "./useNotifSettings";

const never = <T,>() => new Promise<T>(() => {});

const SETTINGS: NotificationSettings = {
  events: [{ event: "request.decided", label: "Your request decided", text: "x", enabled: true }],
  devices: [],
  push: { configured: true, public_key: "AQID" },
  sound: { on: true, volume: 70 },
};

class WaitingTransport implements Transport {
  readonly kind = "api" as const;
  answer = false;
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  call<T>(tool: string): Promise<T> {
    if (tool === "my_notification_settings") return this.answer ? Promise.resolve(SETTINGS as T) : never<T>();
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const me: Me = { name: "Nimal", email: "nimal@fame.test", role: "staff", permissions: ["view", "request"], tools: ["my_notification_settings", "set_my_notification_settings"] };

function mount(t: Transport) {
  const fleet: Fleet = { store: new FleetStore(t), transport: t, me, noConnector: false };
  return render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/settings/notifications"]}>
          <Routes><Route path="/settings/notifications" element={<Notifications />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

/** A browser that has push, but whose service worker never answers. */
function stuckServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: never(), getRegistration: () => never(), register: () => never(), addEventListener() {}, removeEventListener() {} },
  });
  Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission: () => Promise.resolve("granted") } });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ["serviceWorker"]) Reflect.deleteProperty(navigator, k);
  for (const k of ["PushManager", "Notification", "isSecureContext"]) Reflect.deleteProperty(window, k);
});

describe("Settings → Notifications never waits forever", () => {
  it("a service worker that never answers: the page loads; the push line says not available; Turn on fails within the limit", async () => {
    stuckServiceWorker();
    const t = new WaitingTransport();
    t.answer = true;
    mount(t);
    // The page and its groups come at once: nothing on it waits for the browser's worker.
    await screen.findByTestId("notifications");
    expect(screen.getByTestId("notif-group-mine")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(BROWSER_WAIT_MS + 1); });
    expect(await screen.findByText(/not available in this browser right now/)).toBeTruthy();
    // The push code itself, directly: the state and Turn on end within the limit.
    const state = pushState();
    await act(async () => { vi.advanceTimersByTime(BROWSER_WAIT_MS + 1); });
    await expect(state).resolves.toBe("unavailable");
    const on = subscribePush("AQID");
    const caught = on.catch((e: unknown) => e);
    await act(async () => { vi.advanceTimersByTime(BROWSER_WAIT_MS + 1); });
    expect(await caught).toBeInstanceOf(BrowserTooSlow);
  });

  it("a settings call that never answers: after 20 s the error with Try again; Try again loads the page", async () => {
    const t = new WaitingTransport();
    mount(t);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(PAGE_WAIT_MS + 1); });
    await screen.findByTestId("notifications-failed");
    t.answer = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("notifications");
  });
});
