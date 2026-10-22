// C (Round 4–7, docs/phase8-plan.md §33.12; Google Maps, Uber): one theme value drives the page and every map. The page's
// theme is decided by styles.css: data-theme="dark" | "light" on <html> wins, else the system's (prefers-color-scheme).
// The maps read the same answer here: the dark theme gets a dark map (Google's dark colour scheme, OpenFreeMap's dark style,
// the drawn map's dark tokens, the lines in the dark theme's colours), the light theme a light one, and a change of theme
// while a page is open redraws the map in the new scheme (MapView keys the map on it).
import { useEffect, useState } from "react";

export type MapScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The scheme styles.css shows: data-theme wins, else the system's preference. */
export function schemeOf(dataTheme: string | null | undefined, systemDark: boolean): MapScheme {
  if (dataTheme === "dark") return "dark";
  if (dataTheme === "light") return "light";
  return systemDark ? "dark" : "light";
}

const systemDark = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;

/** The page's scheme now (light outside a browser). */
export function pageScheme(): MapScheme {
  if (typeof document === "undefined") return "light";
  return schemeOf(document.documentElement.getAttribute("data-theme"), systemDark());
}

/** The page's scheme, following a change of the system's preference or of data-theme while the page is open. */
export function usePageScheme(): MapScheme {
  const [scheme, setScheme] = useState<MapScheme>(pageScheme);
  useEffect(() => {
    const update = () => setScheme(pageScheme());
    const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    mq?.addEventListener?.("change", update);
    const watcher = typeof MutationObserver !== "undefined" ? new MutationObserver(update) : null;
    watcher?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    update();
    return () => {
      mq?.removeEventListener?.("change", update);
      watcher?.disconnect();
    };
  }, []);
  return scheme;
}

/** OpenFreeMap's styles (no key): Liberty for the light theme, its Dark style for the dark one. */
export const FREE_MAP_STYLES: Record<MapScheme, string> = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
