// C (Round 4–7, §33.12): one theme value for the page and its maps (data-theme wins, else the system's preference), and the
// map's own colours per scheme.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_MAP_STYLES, pageScheme, schemeOf, usePageScheme } from "./scheme";
import { estimatedColor, MAP_CANVAS, MAP_CANVAS_DARK, mapCanvas, SPEED_COLORS, SPEED_COLORS_DARK, speedColors } from "./types";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

describe("the page's scheme (styles.css's rule)", () => {
  it("data-theme wins; else the system's preference", () => {
    expect(schemeOf("dark", false)).toBe("dark");
    expect(schemeOf("light", true)).toBe("light");
    expect(schemeOf(null, true)).toBe("dark");
    expect(schemeOf(undefined, false)).toBe("light");
    expect(schemeOf("", true)).toBe("dark");
  });

  it("reads <html data-theme> and the system's dark mode", () => {
    let dark = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("dark") && dark, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }));
    expect(pageScheme()).toBe("dark");
    document.documentElement.setAttribute("data-theme", "light");
    expect(pageScheme()).toBe("light");
    document.documentElement.removeAttribute("data-theme");
    const { result } = renderHook(() => usePageScheme());
    expect(result.current).toBe("dark");
    dark = false;
    act(() => listeners.forEach((fn) => fn()));
    expect(result.current).toBe("light");
  });

  it("follows data-theme set while the page is open", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const { result } = renderHook(() => usePageScheme());
    expect(result.current).toBe("light");
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      await Promise.resolve();
    });
    expect(result.current).toBe("dark");
  });
});

describe("the maps' own colours per scheme", () => {
  it("OpenFreeMap's Liberty for light, its Dark style for dark", () => {
    expect(FREE_MAP_STYLES).toEqual({ light: "https://tiles.openfreemap.org/styles/liberty", dark: "https://tiles.openfreemap.org/styles/dark" });
  });
  it("the light set as before; the dark set from the dark theme's tokens", () => {
    expect(mapCanvas("light")).toBe(MAP_CANVAS);
    expect(mapCanvas("dark")).toBe(MAP_CANVAS_DARK);
    expect(speedColors("light")).toBe(SPEED_COLORS);
    expect(speedColors("dark")).toBe(SPEED_COLORS_DARK);
    expect(MAP_CANVAS_DARK.line).toBe("#8fb4f2"); // --live in the dark theme
    expect(MAP_CANVAS_DARK.ink).toBe("#ecebe6"); // --ink in the dark theme
    expect(estimatedColor("light")).not.toBe(estimatedColor("dark"));
  });
});
