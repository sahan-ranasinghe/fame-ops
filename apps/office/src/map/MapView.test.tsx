import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { MapView } from "./MapView";

/** The google package with the map loads cap reached: register_map_load refuses, no key. */
class Refused implements Transport {
  readonly kind = "api" as const;
  calls: string[] = [];
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view"], tools: ["register_map_load"], map: { package: "google", places: true } });
  }
  call<T>(tool: string): Promise<T> {
    this.calls.push(tool);
    return Promise.resolve({ allowed: false, package: "google", map: "none", note: "Google map limit reached for today: back tomorrow", reason: "day" } as T);
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

describe("MapView under the google package (Part 5)", () => {
  it("a refused map load shows the lists without a map (never OpenFreeMap) and loads no Google script", async () => {
    const transport = new Refused();
    const me = await transport.me();
    render(
      <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
        <MapView markers={[{ id: "d", label: "WP CAB-4521", title: "Nuwan", lat: 6.9, lng: 79.9, tone: "live", selected: false }]} route={null} onPick={() => undefined} />
      </FleetProvider>,
    );
    const note = await screen.findByTestId("no-map");
    expect(note.textContent).toBe("No map: Google map limit reached for today: back tomorrow. The lists show everything.");
    expect(transport.calls).toEqual(["register_map_load"]);
    expect(document.querySelector('script[src*="maps.googleapis.com"]')).toBeNull();
  });
});
