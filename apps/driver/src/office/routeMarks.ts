// Round 48 (item 3): the markers of a driven route, pure (no React, no map module), shared by a driver's day
// (office/driversLogic.ts), Live's shown route (office/liveRouteLogic.ts) and the browser maps, so every engine draws the
// same set (Google Maps Timeline: the start and the end of the route are pins, the stops are small dots, the "no GPS" and
// "app not running" events are markers off by default and shown by the Layers filter, overlapping markers cluster:
// lib/cluster.ts). Tested in scripts/test-map-layout.ts.

import type { ClusterInput } from '../lib/cluster';
import type { RouteLayers } from '../lib/mapLayout';
import type { GapKind } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A line point with its time (Unix ms) and, when the answer gives it, the clock words. */
export interface TimedPoint extends LatLng {
  at: number;
  time?: string;
}

export type EndKind = 'start' | 'end';

export interface EndMark extends LatLng {
  key: EndKind;
  kind: EndKind;
  /** "08:01". */
  time: string;
}

export interface EndMarks {
  start: EndMark;
  /** None while the route is one point (the start is the end). */
  end: EndMark | null;
}

type Clock = (ms: number) => string;

/** "HH:MM" from a point's own words, else from the clock. */
const timeOf = (p: TimedPoint, clock: Clock) => (p.time ? p.time.slice(0, 5) : clock(p.at).slice(0, 5));

/** The route's two ends: the first point and the last (null without a point; no end pin for a route of one point). */
export function endsOf(points: readonly TimedPoint[], clock: Clock): EndMarks | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const start: EndMark = { key: 'start', kind: 'start', lat: first.lat, lng: first.lng, time: timeOf(first, clock) };
  if (points.length < 2) return { start, end: null };
  return { start, end: { key: 'end', kind: 'end', lat: last.lat, lng: last.lng, time: timeOf(last, clock) } };
}

export interface GapMark extends LatLng {
  key: string;
  kind: GapKind;
  fromAt: number;
  toAt: number;
  /** "14:00", "14:56". */
  from: string;
  to: string;
  minutes: number;
}

export interface GapSource {
  kind: GapKind;
  fromAt: number;
  toAt: number;
  minutes?: number;
}

/** The last point at or before the moment (where the phone was when the signal went), else the first one after it. */
export function pointAt(points: readonly TimedPoint[], at: number): TimedPoint | null {
  let found: TimedPoint | null = null;
  for (const p of points) {
    if (p.at <= at) found = p;
    else break;
  }
  return found ?? points[0] ?? null;
}

/**
 * One marker per gap (the timeline's no-GPS and no-app rows, or the line's holes when an older answer has no timeline),
 * at the place the signal was lost; gaps sharing a start are one. Nothing without a point to stand on.
 */
export function gapMarksOf(gaps: readonly GapSource[], points: readonly TimedPoint[], clock: Clock): GapMark[] {
  const out: GapMark[] = [];
  const seen = new Set<number>();
  for (const g of gaps) {
    if (!Number.isFinite(g.fromAt) || !Number.isFinite(g.toAt) || g.toAt <= g.fromAt || seen.has(g.fromAt)) continue;
    const p = pointAt(points, g.fromAt);
    if (!p) continue;
    seen.add(g.fromAt);
    const minutes = typeof g.minutes === 'number' && Number.isFinite(g.minutes) ? g.minutes : Math.round((g.toAt - g.fromAt) / 60_000);
    out.push({ key: `gap:${g.kind}:${g.fromAt}`, kind: g.kind, lat: p.lat, lng: p.lng, fromAt: g.fromAt, toAt: g.toAt, from: clock(g.fromAt).slice(0, 5), to: clock(g.toAt).slice(0, 5), minutes });
  }
  return out.sort((a, b) => a.fromAt - b.fromAt);
}

export type MarkerKind = EndKind | 'stop' | 'gap';

/** A marker on the route, for the cluster helper: its key, its place and what it is. */
export interface RouteMarkerPoint extends ClusterInput {
  kind: MarkerKind;
}

/**
 * The markers that may cluster: the two ends, the stops, and the gap markers only while the Layers filter shows them;
 * the selected marker (tapped: its card is open) is left out, so it is always drawn on its own above the rest.
 */
export function routeMarkerPoints(ends: EndMarks | null, stops: readonly (LatLng & { key: string })[], gaps: readonly GapMark[], layers: RouteLayers, selected: string | null): RouteMarkerPoint[] {
  const out: RouteMarkerPoint[] = [];
  if (ends) {
    out.push({ key: ends.start.key, kind: 'start', lat: ends.start.lat, lng: ends.start.lng });
    if (ends.end) out.push({ key: ends.end.key, kind: 'end', lat: ends.end.lat, lng: ends.end.lng });
  }
  for (const s of stops) out.push({ key: s.key, kind: 'stop', lat: s.lat, lng: s.lng });
  if (layers.events) for (const g of gaps) out.push({ key: g.key, kind: 'gap', lat: g.lat, lng: g.lng });
  return selected === null ? out : out.filter((m) => m.key !== selected);
}

/** The gap markers to draw: every one while the layer is on, else only the selected one (a tapped gap row keeps its spot). */
export function visibleGaps(gaps: readonly GapMark[], layers: RouteLayers, selected: string | null): GapMark[] {
  return layers.events ? [...gaps] : gaps.filter((g) => g.key === selected);
}
