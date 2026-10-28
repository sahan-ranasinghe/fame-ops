// Round 48 (item 2 and 3): the map screens' layout rules, pure (no React, no map module; scripts/test-map-layout.ts).
//   - The map's height on a phone (Google Maps Timeline, Airbnb's split view): a fixed share of the window, never under
//     MAP_MIN_HEIGHT, with the playback bar under it and the content scrolling below; the map is never inside the
//     scrolling content, so pinch zooms the map and the page's scroll never does. On /m/ at a desktop width the same
//     rule holds (45 % of a 1080 px window is 486 px).
//   - The route's layers (Google Maps' Layers button, inside the one Filter sheet of docs/ui-patterns.md §1): the gap
//     and signal-loss markers and every stop's time label, both off by default; the tapped stop always shows its time.

import type { FilterDef, FilterValues } from './patterns/filterLogic';

/** The map takes this share of the window's height on a phone… */
export const MAP_SHARE = 0.45;
/** …and never less than this (a small phone). */
export const MAP_MIN_HEIGHT = 300;

/** The map's height for a window: 45 % of it, at least 300 px; an unknown window gives the minimum. */
export function mapHeight(windowHeight: number, share = MAP_SHARE, min = MAP_MIN_HEIGHT): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return min;
  return Math.max(min, Math.round(windowHeight * share));
}

export type RouteLayerKey = 'events' | 'stopTimes';
export const ROUTE_LAYER_KEYS: readonly RouteLayerKey[] = ['events', 'stopTimes'];

export interface RouteLayers {
  /** The "no GPS" and "app not running" markers at the place the signal was lost. */
  events: boolean;
  /** The time label on every stop dot (the tapped stop shows its time whatever this says). */
  stopTimes: boolean;
}

export const NO_ROUTE_LAYERS: RouteLayers = { events: false, stopTimes: false };

/** The Filter sheet's key for the layers section. */
export const LAYERS_FILTER_KEY = 'layers';

type Words = (key: string, vars?: Record<string, string | number>) => string;

/** The Filter sheet's Layers section: tick boxes, none ticked by default (the chips say which are on). */
export function routeLayerDefs(t: Words, key = LAYERS_FILTER_KEY): FilterDef[] {
  return [{ key, label: t('dayRoute.layersSection'), kind: 'multi', options: routeLayerOptions(t) }];
}

/** The layer choices alone, for a sheet that already has a section for the map (Live's). */
export function routeLayerOptions(t: Words): { value: RouteLayerKey; label: string }[] {
  return [
    { value: 'events', label: t('dayRoute.layerEvents') },
    { value: 'stopTimes', label: t('dayRoute.layerStopTimes') },
  ];
}

/** The layers ticked in the sheet's values. */
export function routeLayersOf(values: FilterValues, key = LAYERS_FILTER_KEY): RouteLayers {
  const v = values[key];
  const on = Array.isArray(v) ? v : [];
  return { events: on.includes('events'), stopTimes: on.includes('stopTimes') };
}
