// Gap markers and the Gaps list (Phase 7, §21): no map carries text any more;
// each gap gets one small grey marker at the middle of its dashed line, with
// its words on hover or tap, and a list beside the map (the driver page's
// timeline column, under a task's route, Live's card of the shown route).
// - A hole of the tool's line (no_data "App not running", no_gps "Stopped · no
//   GPS signal"): the marker at the middle of the dashed line, the straight one
//   between the line points around it, or its estimated road line when one
//   covers it (then "about 21.3 km by road").
// - A stretch uploaded late ("Offline here · uploaded 07:06"): its line is
//   drawn as usual; the marker sits at the middle of that stretch's points.
// Pure: the same answer gives the same ids, so an open card survives a refresh.
import { positionAt } from "@fleet/route";
import { colomboClock } from "@fleet/status";
import { distanceM } from "@fleet/track";
import { drawnLine, KIND_LABEL, minutesText, type Route, type RoutePoint } from "../data/route";
import { joinDots, num } from "../lib/format";
import type { GapMarker, GapMarkerKind } from "../map/types";

type LatLng = { lat: number; lng: number };

export interface GapRow {
  /** Stable for the same gap: its kind and start time. */
  id: string;
  kind: GapMarkerKind;
  fromAt: number;
  toAt: number;
  /** "06:49–07:06" (one time when both ends are the same minute). */
  when: string;
  /** "App not running", "Stopped · no GPS signal", "Offline here · uploaded 07:06". */
  what: string;
  minutes: number;
  /** About this many km by road over the gap (its estimated line), when known; never counted in the km. */
  km?: number;
  /** The marker: the middle of the gap's dashed line, or of the stretch uploaded late. */
  lat: number;
  lng: number;
  /** The marker's card: "App not running · 06:49–07:06 · 17 min · about 21.3 km by road". */
  text: string;
  /** What a row zooms the map to: the positions around the gap and its estimated line. */
  focus: LatLng[];
}

/** The point halfway along a line (by distance; the middle point when it does not move). */
export function middleOf(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng };
  const steps: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceM(points[i - 1], points[i]);
    steps.push(d);
    total += d;
  }
  if (total === 0) return { lat: points[0].lat, lng: points[0].lng };
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const d = steps[i - 1];
    if (left <= d && d > 0) {
      const k = left / d;
      const a = points[i - 1], b = points[i];
      return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
    }
    left -= d;
  }
  const last = points[points.length - 1];
  return { lat: last.lat, lng: last.lng };
}

/** The last line point at or before a time and the first at or after another: the ends of a gap's dashed line. */
function endsAround(line: RoutePoint[], fromAt: number, toAt: number): { before?: RoutePoint; after?: RoutePoint } {
  let before: RoutePoint | undefined;
  let after: RoutePoint | undefined;
  for (const p of line) {
    if (p.at <= fromAt) before = p;
    if (p.at >= toAt) {
      after = p;
      break;
    }
  }
  return { before, after };
}

const span = (fromAt: number, toAt: number) => {
  const a = colomboClock(new Date(fromAt).toISOString());
  const b = colomboClock(new Date(toAt).toISOString());
  return a === b ? a : `${a}–${b}`;
};

/** "17 min", "1 h 5 min"; a stretch under a minute is "under 1 min". */
export const gapDuration = (minutes: number) => (minutes < 1 ? "under 1 min" : minutesText(minutes));

/**
 * The gaps of a route as the list's rows and the markers' places, in time order: the tool's holes (at the middle of the
 * dashed line the map draws for them: along the estimated road line when one covers the hole, else straight between the
 * line points around it) and the stretches uploaded late (at the middle of their points). `snap`: the line the map
 * draws (the snapped line's raw points around a hole are the same fixes).
 */
export function gapsOf(route: Route | null, snap = false): GapRow[] {
  if (!route || !route.points.length) return [];
  const line = drawnLine(route, snap);
  const est = route.estimated ?? [];
  const rows: GapRow[] = [];
  for (const h of route.holes) {
    if (!isFinite(h.fromAt) || !isFinite(h.toAt)) continue;
    // The estimated line over this hole: the same ends, else the one overlapping it most.
    let cover: (typeof est)[number] | undefined;
    let best = 0;
    for (const e of est) {
      const overlap = Math.min(e.toAt, h.toAt) - Math.max(e.fromAt, h.fromAt);
      if (overlap > best && e.points.length > 1) {
        best = overlap;
        cover = e;
      }
    }
    const { before, after } = endsAround(line, h.fromAt, h.toAt);
    const dashed: LatLng[] = cover ? cover.points : [before, after].filter((p): p is RoutePoint => !!p);
    const mid = middleOf(dashed);
    if (!mid) continue;
    const what = KIND_LABEL[h.kind] ?? "No position";
    const km = cover?.km;
    const when = span(h.fromAt, h.toAt);
    rows.push({
      id: `${h.kind}-${h.fromAt}`,
      kind: h.kind,
      fromAt: h.fromAt,
      toAt: h.toAt,
      when,
      what,
      minutes: h.minutes,
      km,
      lat: mid.lat,
      lng: mid.lng,
      text: joinDots([what, when, gapDuration(h.minutes), km != null ? `about ${num(km)} km by road` : null]),
      focus: [before, ...(cover?.points ?? []), after].filter((p): p is RoutePoint => !!p).map((p) => ({ lat: p.lat, lng: p.lng })),
    });
  }
  for (const w of route.late) {
    const inside = line.filter((p) => p.at >= w.fromAt && p.at <= w.toAt);
    const mid = inside.length ? middleOf(inside) : positionAt(line, (w.fromAt + w.toAt) / 2);
    if (!mid) continue;
    const what = `Offline here · uploaded ${w.uploaded}`;
    const when = span(w.fromAt, w.toAt);
    const minutes = Math.round((w.toAt - w.fromAt) / 60000);
    rows.push({
      id: `late-${w.fromAt}`,
      kind: "late",
      fromAt: w.fromAt,
      toAt: w.toAt,
      when,
      what,
      minutes,
      lat: mid.lat,
      lng: mid.lng,
      text: joinDots(["Offline here", when, `uploaded ${w.uploaded}`]),
      focus: inside.length ? inside.map((p) => ({ lat: p.lat, lng: p.lng })) : [{ lat: mid.lat, lng: mid.lng }],
    });
  }
  return rows.sort((a, b) => a.fromAt - b.fromAt || a.toAt - b.toAt);
}

/** The map's markers for the rows (one each, the words on hover or tap). */
export const gapMarkers = (rows: GapRow[]): GapMarker[] => rows.map(({ id, kind, lat, lng, text }) => ({ id, kind, lat, lng, text }));
