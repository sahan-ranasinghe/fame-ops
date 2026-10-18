// Settings → Notifications → Sounds (Hotfix 2, B): on/off and the volume saved with set_my_notification_settings({
// sound }) (the slider once it rests, and when the page closes), Test sound playing each kind in turn, Play per kind,
// the words when nothing can play, and the page's feed following the saved settings at once.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../../app/FleetContext";
import { InboxProvider, SoundStrip } from "../../app/inbox";
import { PATTERNS, SOUND_KINDS } from "../../data/sounds";
import { FleetStore } from "../../data/store";
import type { NotificationSettings } from "../../data/types";
import { FakeAudio } from "../../test/fakeAudio";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import { SoundCard, VOLUME_SAVE_MS } from "./SoundCard";

const settings = (sound = { on: true, volume: 70 }): NotificationSettings => ({ events: [], devices: [], push: { configured: true }, sound });

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  sound = { on: true, volume: 70 };
  me(): Promise<Me> {
    return Promise.reject(new Error("unused"));
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "set_my_notification_settings") {
      this.sound = { ...this.sound, ...(args.sound as object) };
      return Promise.resolve(settings(this.sound) as T);
    }
    if (tool === "my_notification_settings") return Promise.resolve(settings(this.sound) as T);
    if (tool === "my_inbox") return Promise.resolve({ unread: 0, items: [] } as T);
    return Promise.reject({ code: "not_found", message: tool });
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const person: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "approve"], tools: ["my_inbox", "my_notification_settings", "set_my_notification_settings"] };
let fake: FakeAudio;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

function Card({ initial }: { initial: NotificationSettings }) {
  return <SoundCard data={initial} onSaved={() => {}} />;
}

function mount(t: FakeTransport, opts: { feed?: boolean; data?: NotificationSettings } = {}) {
  const fleet: Fleet = { store: new FleetStore(t), transport: t, me: person, noConnector: false };
  const card = <Card initial={opts.data ?? settings()} />;
  return render(
    <FleetProvider value={fleet}>
      <ToastProvider>
        <MemoryRouter>
          {opts.feed ? <InboxProvider makeAudio={() => fake}><SoundStrip />{card}</InboxProvider> : card}
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

beforeEach(() => {
  fake = new FakeAudio();
  // The card's own player (no feed) makes the browser's AudioContext: the fake.
  vi.stubGlobal("AudioContext", class { constructor() { return fake; } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Settings → Notifications → Sounds", () => {
  it("sound off and on are saved for the person; off greys the volume and the tests", async () => {
    const t = new FakeTransport();
    mount(t);
    const box = screen.getByRole("checkbox", { name: "Play sounds" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).value).toBe("70");
    fireEvent.click(box);
    await flush();
    expect(t.argsOf("set_my_notification_settings")).toEqual([{ sound: { on: false } }]);
    expect((screen.getByRole("slider", { name: "Volume" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Test sound" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Saved");
  });

  it("the volume is saved once the slider rests, with its last value only; leaving the page saves one still waiting", async () => {
    vi.useFakeTimers();
    const t = new FakeTransport();
    const view = mount(t);
    const slider = screen.getByRole("slider", { name: "Volume" });
    fireEvent.change(slider, { target: { value: "50" } });
    fireEvent.change(slider, { target: { value: "40" } });
    expect(screen.getByTestId("volume-value").textContent).toBe("40 %");
    await act(async () => { await vi.advanceTimersByTimeAsync(VOLUME_SAVE_MS - 100); });
    expect(t.argsOf("set_my_notification_settings")).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(t.argsOf("set_my_notification_settings")).toEqual([{ sound: { volume: 40 } }]);
    fireEvent.change(slider, { target: { value: "90" } });
    view.unmount();
    expect(t.argsOf("set_my_notification_settings").at(-1)).toEqual({ sound: { volume: 90 } });
  });

  it("Test sound plays each kind in turn; Play plays one; the words when nothing can play", async () => {
    const t = new FakeTransport();
    mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Test sound" }));
    await flush();
    expect(fake.oscs).toHaveLength(SOUND_KINDS.reduce((n, k) => n + PATTERNS[k].length, 0));
    const before = fake.oscs.length;
    fireEvent.click(screen.getByRole("button", { name: "Play alarm" }));
    await flush();
    expect(fake.freqs(before)).toEqual(PATTERNS.alarm.map((x) => x.freq));
    // Volume 0: nothing plays, and the page says so.
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Test sound" }));
    await flush();
    expect(screen.getByText("The volume is at 0: nothing plays.")).toBeTruthy();
    expect(fake.oscs).toHaveLength(before + PATTERNS.alarm.length);
  });

  it("a browser that will not play says what to do", async () => {
    fake = new FakeAudio(false);
    const t = new FakeTransport();
    mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Test sound" }));
    await flush();
    expect(screen.getByText(/did not let this page play a sound/)).toBeTruthy();
  });

  it("the page's feed follows at once: sound turned off, the 'Click to turn on sounds' strip goes", async () => {
    const t = new FakeTransport();
    mount(t, { feed: true });
    await flush();
    expect(screen.getByTestId("sound-strip")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Play sounds" }));
    await flush();
    expect(screen.queryByTestId("sound-strip")).toBeNull();
  });
});
