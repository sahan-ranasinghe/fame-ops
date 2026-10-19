// Part 6 (Sahan, 19 October): the website's map works like the phones. Google's map by default; at the map-load cap, when
// Google refuses the key (gm_authFailure) or its script is not ready in time, the free map (MapLibre with OpenFreeMap)
// instead of no map; the setting "open" always the free map. The maps themselves need a browser: they are stubs here.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { GOOGLE_LOAD_TIMEOUT_MS, resetGoogleMapForTests } from "./google/googleMaps";
import { type MapChoice, snapAllowed } from "./mapChoice";
import { MapView } from "./MapView";

vi.mock("./MapLibreMap", () => ({ default: () => <div data-testid="free-map">the free map</div> }));
vi.mock("./google/GoogleMap", () => ({ default: () => <div data-testid="google-map">Google's map</div> }));

type Answer = { allowed: boolean; key?: string; note?: string };

class Fake implements Transport {
  readonly kind = "api" as const;
  calls: string[] = [];
  constructor(private pkg: "google" | "open", private answer: Answer) {}
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view"], tools: ["register_map_load"], map: { package: this.pkg, places: true } });
  }
  call<T>(tool: string): Promise<T> {
    this.calls.push(tool);
    return Promise.resolve(this.answer as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(transport: Fake) {
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MapView markers={[{ id: "d", label: "WP CAB-4521", title: "Nuwan", lat: 6.9, lng: 79.9, tone: "live", selected: false }]} route={null} onPick={() => undefined} />
    </FleetProvider>,
  );
}

afterEach(() => {
  resetGoogleMapForTests();
  document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
  vi.useRealTimers();
});

describe("the website's map: Google's by default, the free map when Google's cannot be", () => {
  it("the map-load cap reached: the free map with the reason, no Google script", async () => {
    const transport = new Fake("google", { allowed: false, note: "Google map limit reached for today: back tomorrow" });
    await mount(transport);
    expect(await screen.findByTestId("free-map")).toBeTruthy();
    expect(screen.getByTestId("free-map-note").textContent).toBe("The free map: Google map limit reached for today: back tomorrow.");
    expect(screen.queryByTestId("no-map")).toBeNull();
    expect(transport.calls).toEqual(["register_map_load"]);
    expect(document.querySelector('script[src*="maps.googleapis.com"]')).toBeNull();
  });

  it("Google refuses the key (gm_authFailure): the free map", async () => {
    const transport = new Fake("google", { allowed: true, key: "browser-key" });
    await mount(transport);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('script[src*="maps.googleapis.com"]')).toBeTruthy();
    await act(async () => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(await screen.findByTestId("free-map")).toBeTruthy();
    expect(screen.getByTestId("free-map-note").textContent).toBe("The free map: Google refused the map key.");
  });

  it("Google's script not ready in time: the free map", async () => {
    vi.useFakeTimers();
    const transport = new Fake("google", { allowed: true, key: "browser-key" });
    await mount(transport);
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_LOAD_TIMEOUT_MS + 10); });
    expect(screen.getByTestId("free-map")).toBeTruthy();
    expect(screen.getByTestId("free-map-note").textContent).toBe("The free map: Google's map did not load in time.");
  });

  it("the setting open: the free map, no note, no load counted", async () => {
    const transport = new Fake("open", { allowed: false });
    await mount(transport);
    expect(await screen.findByTestId("free-map")).toBeTruthy();
    expect(screen.queryByTestId("free-map-note")).toBeNull();
    expect(transport.calls).toEqual([]);
  });

  it("snap to roads only for Google's map or the open package; never for the free map shown instead of Google's", () => {
    const cases: [MapChoice, boolean][] = [
      [{ kind: "google", maps: {} as never }, true], [{ kind: "open" }, true], [{ kind: "free", note: "x" }, false], [{ kind: "loading" }, false],
    ];
    expect(cases.map(([c]) => snapAllowed(c))).toEqual(cases.map(([, ok]) => ok));
  });
});
