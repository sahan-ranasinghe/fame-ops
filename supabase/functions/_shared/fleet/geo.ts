// Distance, stops, route thinning and nearest-place helpers for location
// points. Distance and stops come from the GPS drift filter in track.ts (the
// same code the driver app runs): bad fixes, jumps and drift while standing
// still add nothing.

import { type Fix, summarise } from "./track.ts";

export interface Point {
  at: string; // UTC ISO time
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
}

export interface Stop {
  from: string;
  to: string;
  minutes: number;
  lat: number;
  lng: number;
}

export interface RouteSummary {
  /** Km driven, straight-line steps between accepted fixes (always a little under the odometer). */
  km: number;
  /** Places where the vehicle stayed 10 minutes or more. */
  stops: Stop[];
  /** How many of the points were precise enough to use. */
  usable: number;
}

export const GPS_KM_NOTE =
  "Km from GPS: fixes worse than 50 m, jumps over 150 km/h and drift while standing still are left out. The odometer is the true figure.";

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toFix(p: Point): Fix {
  return {
    at: new Date(p.at).getTime(),
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
    speedMps: p.speedMps,
  };
}

/** Km and stops for points in time order. */
export function summariseRoute(points: Point[]): RouteSummary {
  const summary = summarise(points.map(toFix));
  return {
    km: summary.km,
    usable: summary.usable,
    stops: summary.stops.map((stop) => ({
      from: new Date(stop.from).toISOString(),
      to: new Date(stop.to).toISOString(),
      minutes: stop.minutes,
      lat: stop.lat,
      lng: stop.lng,
    })),
  };
}

/** At most `max` points, evenly spread, always keeping the first and the last. */
export function thin<T>(points: T[], max = 300): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** The closest of some candidate places, or null when there are none. */
export function closest<T extends { lat: number; lng: number }>(
  to: { lat: number; lng: number },
  places: T[],
): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const place of places) {
    const km = haversineKm(to, place);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best;
}
