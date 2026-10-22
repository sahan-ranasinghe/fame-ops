import { afterEach, describe, expect, it } from "vitest";
import { attachMap, DARK_STYLES, LIGHT_STYLES, MAP_OPTIONS, mapOptionsFor, resetGoogleMapForTests, schemeStyles, type GoogleMapsApi } from "./googleMaps";

afterEach(() => resetGoogleMapForTests());

/** A stand-in for google.maps.Map: the options it was made with and every setOptions after. */
function fakeMaps() {
  const made: google.maps.MapOptions[] = [];
  const set: google.maps.MapOptions[] = [];
  class FakeMap {
    constructor(_el: HTMLElement, opts: google.maps.MapOptions) {
      made.push(opts);
    }
    setOptions(opts: google.maps.MapOptions) {
      set.push(opts);
    }
  }
  return { maps: { Map: FakeMap } as unknown as GoogleMapsApi, made, set };
}

// C (Round 4–7, §33.12; Google Maps, Uber): the map follows the page's theme. Round 3 A3's "always light" is replaced.
describe("Google's map follows the page's theme (C, §33.12)", () => {
  it("is made in the page's scheme: Google's own colour scheme, no map id, no styles", () => {
    expect(MAP_OPTIONS).not.toHaveProperty("colorScheme");
    expect(mapOptionsFor("light").colorScheme).toBe("LIGHT");
    expect(mapOptionsFor("dark").colorScheme).toBe("DARK");
    for (const scheme of ["light", "dark"] as const) {
      expect(mapOptionsFor(scheme)).not.toHaveProperty("styles");
      expect(mapOptionsFor(scheme)).not.toHaveProperty("mapId");
      expect(mapOptionsFor(scheme).gestureHandling).toBe("greedy");
    }
  });

  it("the tab's one map is made once, in the scheme of the page that first shows it", () => {
    const { maps, made } = fakeMaps();
    const box = document.createElement("div");
    attachMap(box, maps, "dark");
    attachMap(box, maps, "dark"); // moved, never made twice
    expect(made).toHaveLength(1);
    expect(made[0].colorScheme).toBe("DARK");
    expect(made[0].gestureHandling).toBe("greedy");
  });

  it("the light page's map is made light (as before)", () => {
    const { maps, made } = fakeMaps();
    attachMap(document.createElement("div"), maps, "light");
    expect(made[0].colorScheme).toBe("LIGHT");
  });

  it("a theme changed later is drawn with the legacy styles (colorScheme is read only when the map is made), and none once back", () => {
    const { maps, made, set } = fakeMaps();
    const box = document.createElement("div");
    attachMap(box, maps, "light");
    attachMap(box, maps, "dark");
    attachMap(box, maps, "light");
    expect(made).toHaveLength(1); // never a second map load
    expect(set.map((o) => o.styles)).toEqual([DARK_STYLES, null]);
  });

  it("the styles for each pair", () => {
    expect(schemeStyles("light", "light")).toBeNull();
    expect(schemeStyles("dark", "dark")).toBeNull();
    expect(schemeStyles("dark", "light")).toBe(DARK_STYLES);
    expect(schemeStyles("light", "dark")).toBe(LIGHT_STYLES);
    // The land's colour is set for every feature, so either works over the other scheme.
    for (const s of [DARK_STYLES, LIGHT_STYLES]) expect(s.find((x) => !x.featureType && x.elementType === "geometry")).toBeTruthy();
  });
});
