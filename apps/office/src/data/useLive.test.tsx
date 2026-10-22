import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { dutyLine, type LatestRow } from "./live";
import { FleetStore } from "./store";
import type { LiveDriver, LiveDrivers } from "./types";
import { useLiveDrivers } from "./useLive";

const who: Me = { name: "Sahan", role: "admin", permissions: ["view", "assign_tasks"], tools: ["live_drivers", "clock_out_driver"] };

const card: LiveDriver = {
  driver: "Nuwan Perera", username: "nuwan.p", employee_id: "emp-1", state: "sharing", location: "Live · now",
  status: "live", status_text: "Live · now", duty: "on_duty", duty_text: "On duty", duty_since: "08:02", vehicle: "WP CAB-4521",
  signal: { sharing: true, point_at: new Date().toISOString(), heartbeat_at: null, location_on: true, permission: "always", location_off_since: null },
};
const clockedOut: LiveDriver = {
  ...card, state: "not_sharing", status: "not_sharing", status_text: "Off duty", duty: "off_duty", duty_text: "Off duty", duty_since: "12:05",
  off_duty_how: "by the office", vehicle: undefined, signal: { ...card.signal!, sharing: false },
};

/**
 * The watch delivers the first answer and then stays busy, as a 30 s poll that was running when the office clocked the
 * driver out (the watch skips the refresh after a write while it runs). live_drivers asked directly answers "now".
 */
class LiveTransport implements Transport {
  readonly kind = "api" as const;
  calls = 0;
  constructor(private now: LiveDrivers) {}
  me(): Promise<Me> {
    return Promise.resolve(who);
  }
  call<T>(tool: string): Promise<T> {
    if (tool === "live_drivers") this.calls++;
    return Promise.resolve(this.now as T);
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    queueMicrotask(() => cb({ type: "data", data: answer([card]) as T, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function mount(transport: LiveTransport) {
  let fire: (row: LatestRow) => void = () => {};
  const store = new FleetStore(transport);
  const realtime = { driverLatest: (cb: (row: LatestRow) => void) => { fire = cb; return () => {}; } };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FleetProvider value={{ store, transport, me: who, noConnector: false, realtime }}>{children}</FleetProvider>
  );
  const hook = renderHook(() => useLiveDrivers(), { wrapper });
  return { hook, fire: (row: LatestRow) => act(() => fire(row)) };
}

const answer = (drivers: LiveDriver[]): LiveDrivers => ({ as_of: "12:05", counts: { all: drivers.length, sharing: 0, stale: 0, not_sharing: 0 }, drivers });
const row = (sharing: boolean): LatestRow => ({ employee_id: "emp-1", lat: 6.9, lng: 79.9, speed_mps: 0, battery_pct: 80, recorded_at: new Date().toISOString(), sharing });

describe("live drivers: a driver who stops sharing", () => {
  it("asks live_drivers at once, so the card says how it ended (by the office) without waiting for the next poll", async () => {
    const transport = new LiveTransport(answer([clockedOut]));
    const { hook, fire } = mount(transport);
    await waitFor(() => expect(hook.result.current.live.data?.drivers[0].duty).toBe("on_duty"));
    expect(transport.calls).toBe(0);

    fire(row(false));
    expect(transport.calls).toBe(1);
    await waitFor(() => expect(dutyLine(hook.result.current.live.data!.drivers[0])).toBe("Off duty · since 12:05 · by the office"));

    // The later rows of a driver already off, and rows of a driver sharing, ask nothing.
    fire(row(false));
    expect(transport.calls).toBe(1);
  });

  it("a row of a driver still sharing moves the card and asks nothing", async () => {
    const transport = new LiveTransport(answer([card]));
    const { hook, fire } = mount(transport);
    await waitFor(() => expect(hook.result.current.live.data?.drivers).toHaveLength(1));
    fire(row(true));
    expect(transport.calls).toBe(0);
    expect(hook.result.current.live.data?.drivers[0].duty).toBe("on_duty");
  });
});
