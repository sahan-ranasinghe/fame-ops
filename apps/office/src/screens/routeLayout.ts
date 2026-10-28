// The layout of a page with a route's map (Round 48, item 2): the pattern is Airbnb's split view and Google Maps
// Timeline. On a desktop the map is a pane that stays put (sticky, out of the page's scroll path, so the wheel over it
// zooms the map and scrolling the page never does) while the details scroll beside it, with the playback bar laid over
// the map's bottom edge so map and playback are always seen together. On a phone (the site under 768 px: ui/phone.ts)
// the map has a fixed height, about 45 % of the viewport and at least 300 px, the playback right under it, the content
// scrolling below. The rule is pure; useRouteLayout reads the window.
import { useEffect, useState } from "react";
import { useIsPhone } from "../ui/phone";

export const PHONE_MAP_SHARE = 0.45;
export const PHONE_MAP_MIN_PX = 300;

export interface RouteLayout {
  kind: "split" | "stacked";
  /** The map's height in px when stacked (the phone's rule); the split pane's height is the CSS's (the viewport minus the margins). */
  mapHeight?: number;
}

/** The layout for a width class and the viewport's height. `stackedOnly`: a page that is itself a panel (the task page). */
export function routeLayout(phone: boolean, viewportHeight: number, stackedOnly = false): RouteLayout {
  if (!phone && !stackedOnly) return { kind: "split" };
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  return { kind: "stacked", mapHeight: Math.max(PHONE_MAP_MIN_PX, Math.round(h * PHONE_MAP_SHARE)) };
}

/** The sticky pane's margins (styles.css .route-pane.split: top 20px, and 20px kept under it). */
export const SPLIT_PANE_MARGIN_PX = 20;
export const SPLIT_PANE_MIN_PX = 380;

/**
 * The split pane's height in px so that the map AND the playback over its bottom edge are on screen whatever the
 * scroll: the viewport minus the pane's current top (its own place on first load, 20 px once it sticks) minus the
 * bottom margin, never under SPLIT_PANE_MIN_PX. CSS alone cannot do it: a sticky pane's top depends on the scroll.
 */
export function splitPaneHeight(viewportHeight: number, paneTop: number): number {
  const top = Math.max(SPLIT_PANE_MARGIN_PX, Number.isFinite(paneTop) ? paneTop : SPLIT_PANE_MARGIN_PX);
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  return Math.max(SPLIT_PANE_MIN_PX, Math.round(h - top - SPLIT_PANE_MARGIN_PX));
}

const viewportHeight = () => (typeof window === "undefined" ? 800 : window.innerHeight);

/** The page's layout now: follows the phone breakpoint and the window's height (a turned phone, a resized window). */
export function useRouteLayout(stackedOnly = false): RouteLayout {
  const phone = useIsPhone();
  const [vh, setVh] = useState(viewportHeight);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return routeLayout(phone, vh, stackedOnly);
}
