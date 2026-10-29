// A driver's day as ONE summary card above the map (§33.6 item 1, Round 4–7; Samsara's driver day, Google Maps Timeline):
// the km, the driving and stopped time, the stops, the first and last point, and one line for the GPS gaps ("No GPS for
// 2 h 10 min"); the day's timeline list and the Gaps list are gone (Sahan's decision). Each stop stays a pin on the map whose
// card says "Stopped near Kurunegala · 06:56–07:15 · 19 min"; each gap keeps its dashed line and its marker. Pure, from
// driver_route's answer as the page holds it (data/route.ts Route): nothing new is asked of the server.
import { duration } from "@fleet/durations";
import type { Route, StopView } from "../data/route";
import type { GapMarker } from "../map/types";

export interface DaySummary {
  /** GPS km, drift filtered (the tool's km). */
  km: number | null;
  /** Points recorded that day. */
  points: number;
  drivingMinutes: number | null;
  stoppedMinutes: number | null;
  /** Stops of 10 minutes or more. */
  stops: number | null;
  /** "06:12" / "18:40": the day's first and last point. */
  first: string | null;
  last: string | null;
  /** "No GPS for 2 h 10 min" (all the day's gaps of over 10 minutes added up), or null with none. */
  noGps: string | null;
  /** How many gaps that line adds up. */
  gaps: number;
}

/** "No GPS for 2 h 10 min" for the day's gaps (no GPS or the app not running: either way no position), or null. */
export function noGpsLine(gaps: readonly { minutes: number }[]): string | null {
  const total = gaps.reduce((sum, g) => sum + (Number.isFinite(g.minutes) && g.minutes > 0 ? g.minutes : 0), 0);
  return gaps.length && total > 0 ? `No GPS for ${duration(total)}` : null;
}

/** The card's numbers (null until the route is read). */
export function daySummary(route: Route | null): DaySummary | null {
  if (!route) return null;
  return {
    km: route.km ?? null,
    points: route.count,
    drivingMinutes: route.drivingMinutes ?? null,
    stoppedMinutes: route.stoppedMinutes ?? null,
    stops: route.stopsCount ?? route.stops.length,
    first: route.first ?? null,
    last: route.last ?? null,
    noGps: noGpsLine(route.gaps),
    gaps: route.gaps.length,
  };
}

/**
 * A day with nothing recorded (no point, no summary kept): the summary card says "No trips recorded this day." (the empty
 * state main's timeline had). A day kept as a summary only (older than the points) is not empty: its numbers are shown.
 */
export function dayIsEmpty(route: Route | null): boolean {
  return !!route && route.count === 0 && route.points.length === 0 && route.km == null && !route.first && !route.web?.length;
}

/** A stop's card (Google Maps' visit): "Stopped near Kurunegala · 06:56–07:15 · 19 min"; with no town, "Stopped · …". */
export function stopText(s: Pick<StopView, "from" | "to" | "minutes" | "near">): string {
  const span = s.from === s.to ? s.from : `${s.from}–${s.to}`;
  return `${s.near ? `Stopped near ${s.near}` : "Stopped"} · ${span} · ${duration(s.minutes)}`;
}

/** The day's stops as pins on the map (the gap markers' card, hover and tap), one per stop with a position. */
export function stopPins(route: Route | null): GapMarker[] {
  return (route?.stops ?? []).flatMap((s, i): GapMarker[] =>
    s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng)
      ? [{ id: `stop:${i}:${s.from}`, kind: "stop", lat: s.lat, lng: s.lng, text: stopText(s) }]
      : []);
}
