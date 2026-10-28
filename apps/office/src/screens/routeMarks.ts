// A route's marks on the map (Round 48, item 3; Google Maps Timeline's day view): the first and last point as PINS
// ("Start · 08:01", "End · 16:31"; "Latest · 16:31" while the line still grows), each stop of 10 minutes or more as a
// small DOT (dayLogic.stopPins: "Stopped near Kurunegala · 06:56–07:15 · 19 min") and each gap as an EVENT mark
// (gapsLogic.gapMarkers; the Events layer, off by default: map/layers.ts). All three are GapMarkers: the same card,
// hover and tap on every map. Pure.
import { colomboClock } from "@fleet/status";
import { drawnLine, type Route } from "../data/route";
import type { GapMarker } from "../map/types";
import { stopPins } from "./dayLogic";
import { gapMarkers, gapsOf, type GapRow } from "./gapsLogic";

/** "08:01" from a point's time in ms. */
const clock = (at: number) => colomboClock(new Date(at).toISOString());

/**
 * The route's two pins: its first and its last point of the line the map draws (the snapped line when shown). One point
 * only: the start pin alone. `latest`: today's line still grows (the driver is on the road), so the last pin says so.
 */
export function endPins(route: Route | null, snap = false, latest = false): GapMarker[] {
  if (!route || !route.points.length) return [];
  const line = drawnLine(route, snap).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.at));
  if (!line.length) return [];
  const first = line[0];
  const last = line[line.length - 1];
  const out: GapMarker[] = [{ id: "start", kind: "start", lat: first.lat, lng: first.lng, text: `Start · ${clock(first.at)}` }];
  if (line.length > 1) out.push({ id: "end", kind: "end", lat: last.lat, lng: last.lng, text: `${latest ? "Latest" : "End"} · ${clock(last.at)}` });
  return out;
}

export interface RouteMarks {
  /** The gaps as rows (Live's Gaps list). */
  rows: GapRow[];
  /** Every mark: the pins, then the stops, then the events (the page shows the events by its layer: map/layers.ts). */
  all: GapMarker[];
}

/** All of a route's marks for a page. */
export function routeMarks(route: Route | null, snap = false, latest = false): RouteMarks {
  const rows = gapsOf(route, snap);
  return { rows, all: [...endPins(route, snap, latest), ...stopPins(route), ...gapMarkers(rows)] };
}

/** What a tap on a mark zooms the map to: a gap's own positions (its row's focus), a pin's or a stop's one point. */
export function markFocus(id: string, marks: RouteMarks): { lat: number; lng: number }[] | null {
  const row = marks.rows.find((r) => r.id === id);
  if (row) return row.focus;
  const m = marks.all.find((x) => x.id === id);
  return m ? [{ lat: m.lat, lng: m.lng }] : null;
}
