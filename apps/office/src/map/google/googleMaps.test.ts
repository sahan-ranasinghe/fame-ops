import { afterEach, describe, expect, it } from "vitest";
import { attachMap, MAP_OPTIONS, resetGoogleMapForTests, type GoogleMapsApi } from "./googleMaps";

afterEach(() => resetGoogleMapForTests());

describe("Google's map stays light (Round 3 A3)", () => {
  it("is made with the light colour scheme and nothing that follows the browser's dark mode", () => {
    expect(MAP_OPTIONS.colorScheme).toBe("LIGHT");
    expect(MAP_OPTIONS).not.toHaveProperty("styles");
    expect(MAP_OPTIONS).not.toHaveProperty("mapId");
  });

  it("the tab's one map gets those options when it is made", () => {
    const made: google.maps.MapOptions[] = [];
    class FakeMap {
      constructor(_el: HTMLElement, opts: google.maps.MapOptions) {
        made.push(opts);
      }
    }
    const maps = { Map: FakeMap } as unknown as GoogleMapsApi;
    const box = document.createElement("div");
    attachMap(box, maps);
    attachMap(box, maps); // moved, never made twice
    expect(made).toHaveLength(1);
    expect(made[0].colorScheme).toBe("LIGHT");
    expect(made[0].gestureHandling).toBe("greedy");
  });
});
