// Snap to roads in Office mode and /m/ (Round 48 item 5, 28 October 2026; the site's data/route.ts drawnLine, snapLegend,
// snapControl and map/mapChoice.ts snapAllowed, cut to what the phone draws). The pattern: Google Maps Timeline's
// road-aligned line and Strava's "snap to roads" toggle: the day's line follows the roads when the server could snap it,
// one switch brings the recorded GPS points back, and the words under the map say which line it is.
//   - driver_route is asked with `snap: true` only where the answer may be drawn (hard rule 10): on Google's map (the
//     server snaps with Google's Roads API under the google package: its lines go on a Google map only), or under the
//     open package (the server then snaps with OSRM when the setting names it, never with Google). The free map shown
//     because Google's failed on this phone never asks: it would get Google's lines. Every Roads call is counted by the
//     server before it is made and refused at the cap (the leg stays raw); since Round 48 Google's answers are never
//     stored (the server keeps them 30 minutes in memory, so the 60-second refresh costs nothing).
//   - The line drawn: the tool's route_snapped (its driving legs on the roads, the rest raw) with the recorded points
//     after its end, else the recorded points. Km, driving time and stops stay the server's (from the odometer and the
//     raw points): never from the snapped line.
//   - Default on; off from the chip; the choice lives in the open screen only (no storage). The free map, or the server's
//     refusal (the cap, no package, a failed match), draws the GPS line and the note says so.
// Pure: no React, no native module (scripts/test-snap.ts).

import type { Engine, MapPackage } from '../lib/mapEngine';
import { pointsOf, type RoutePoint } from './liveRouteLogic';
import type { DriverRoute } from './types';

/** What the server said about snapping (driver_route's `snapped`; it names the provider even when snap was not asked). */
export type SnapInfo = NonNullable<DriverRoute['snapped']>;

/**
 * May this screen ask for snap to roads (the site's snapAllowed): on Google's map, or under the open package (OSRM or
 * nothing). Never for the free map standing in for Google's (its snapping would be Google's, drawn on a map that is not
 * Google's: rule 10).
 */
export function snapAllowed(engine: Engine, mapPackage: MapPackage | undefined): boolean {
  return engine === 'google' || mapPackage === 'open';
}

/** driver_route's arguments with `snap: true` when asked; untouched when not (never `snap: false`: the old call as it was). */
export function withSnap<A extends Record<string, unknown>>(args: A, snap: boolean): A | (A & { snap: true }) {
  return snap ? { ...args, snap: true } : args;
}

/** The snapped line's points (route_snapped's columns are the route's plus "snapped"), or null when the answer has none. */
export function snappedPointsOf(p: Pick<DriverRoute, 'date' | 'route_snapped'>): RoutePoint[] | null {
  if (!p.route_snapped || !Array.isArray(p.route_snapped.points) || p.route_snapped.points.length < 2) return null;
  const points = pointsOf(p.date, p.route_snapped);
  return points.length >= 2 ? points : null;
}

/**
 * The line the map draws when snapping is on: the snapped line, then the recorded points after its end (a line merged
 * since the answer that may reach further); else the recorded points.
 */
export function drawnLine(points: readonly RoutePoint[], snapped: readonly RoutePoint[] | null, on: boolean): RoutePoint[] {
  if (!on || !snapped || snapped.length < 2) return [...points];
  const end = snapped[snapped.length - 1].at;
  const tail = points.filter((p) => p.at > end);
  return tail.length ? [...snapped, ...tail] : [...snapped];
}

/** The tool's answer as the day's route view draws it: the snapped line in the route's place when on and the server gave one. */
export function snapView<T extends Pick<DriverRoute, 'date' | 'route' | 'route_snapped'>>(data: T, on: boolean): T {
  if (!on || !data.route_snapped || !Array.isArray(data.route_snapped.points) || data.route_snapped.points.length < 2) return data;
  return { ...data, route: data.route_snapped };
}

/** The note under the map: which line it is (the i18n keys under office.live). */
export type SnapNote = 'snapped' | 'partly' | 'failed' | 'gps';

export interface SnapControl {
  /** The chip shows: the server names a provider and this map may draw its line. */
  toggle: boolean;
  /** The chip's state (and the line drawn): asked and allowed. */
  on: boolean;
  /** What the line is, or null when snapping is not a thing here (no provider: nothing new on the screen). */
  note: SnapNote | null;
}

/**
 * The chip and the note (the site's snapControl): no provider named = nothing; a provider but a map that may not draw its
 * line = "GPS line", no chip; the chip off = "GPS line"; on = by the server's status: snapped (km from the odometer),
 * partly (some legs raw), failed (the cap or an error: the GPS line, said so), or off (the answer before the snapped one
 * lands) = "GPS line".
 */
export function snapControl(info: SnapInfo | null | undefined, allowed: boolean, wanted: boolean): SnapControl {
  if (!info || !info.provider || info.provider === 'none') return { toggle: false, on: false, note: null };
  if (!allowed) return { toggle: false, on: false, note: 'gps' };
  if (!wanted) return { toggle: true, on: false, note: 'gps' };
  const note: SnapNote = info.status === 'ok' ? 'snapped' : info.status === 'partial' ? 'partly' : info.status === 'failed' ? 'failed' : 'gps';
  return { toggle: true, on: true, note };
}

/** The i18n key of a note. */
export const snapNoteKey = (note: SnapNote): string => `office.live.snap_${note}`;
