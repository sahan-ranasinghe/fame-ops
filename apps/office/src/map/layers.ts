// The map's layers (Round 48, item 3): what a route page draws of a route's marks. The pattern is Google Maps' Layers
// menu and Samsara's map layers: the start and end pins and the stop dots are always on; the EVENT marks (no GPS, the app
// not running, uploaded late) are off by default and come on through the page's Filter button (docs/ui-patterns.md §1:
// one Filter, a "Layers" section of tick boxes, the value in the URL as ?layers=events). A tapped gap row still shows
// its own event mark while the layer is off: the open mark is always drawn. Pure.
import type { FilterDef, FilterValues } from "../ui/filterLogic";
import type { GapMarker, GapMarkerKind } from "./types";

/** The kinds the Events layer holds. */
export const EVENT_KINDS: readonly GapMarkerKind[] = ["no_data", "no_gps", "late"];
export const isEvent = (kind: GapMarkerKind): boolean => EVENT_KINDS.includes(kind);
/** The route's two pins: its first and last point. */
export const isPin = (kind: GapMarkerKind): boolean => kind === "start" || kind === "end";

/** The Filter section "Layers" (a multi section: several layers may be on; today there is one). Off by default. */
export const LAYERS_DEF: FilterDef = {
  key: "layers",
  label: "Layers",
  kind: "multi",
  options: [{ value: "events", label: "Events: no GPS, app not running, uploaded late" }],
  default: [],
};

/** Is the Events layer on in these filter values? */
export function eventsOn(values: FilterValues | undefined): boolean {
  const v = values?.layers;
  return Array.isArray(v) ? v.includes("events") : v === "events";
}

/** The values with the Events layer turned on (the "Show on map" link under the gaps line). */
export function withEvents(values: FilterValues | undefined, on: boolean): FilterValues {
  const list = Array.isArray(values?.layers) ? values!.layers : values?.layers ? [values.layers as string] : [];
  const rest = list.filter((x) => x !== "events");
  return { ...(values ?? {}), layers: on ? [...rest, "events"] : rest };
}

/** The marks the map draws: pins and stops always, events while the layer is on, plus the open one whatever the layer. */
export function visibleMarks(marks: readonly GapMarker[], events: boolean, open: string | null | undefined): GapMarker[] {
  return marks.filter((m) => !isEvent(m.kind) || events || m.id === open);
}
