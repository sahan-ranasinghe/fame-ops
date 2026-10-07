// Distance, route thinning and stop detection for location points.

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

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points too imprecise to trust for distance. */
function usable(p: Point): boolean {
  return p.accuracyM == null || p.accuracyM <= 150;
}

/**
 * Distance travelled. A step counts only once the phone has moved at least
 * 25 m from the last counted position, so GPS jitter while parked adds nothing.
 */
export function routeKm(points: Point[]): number {
  let total = 0;
  let anchor: Point | null = null;
  for (const p of points) {
    if (!usable(p)) continue;
    if (!anchor) {
      anchor = p;
      continue;
    }
    const step = haversineKm(anchor, p);
    if (step >= 0.025) {
      total += step;
      anchor = p;
    }
  }
  return total;
}

/** At most `max` points, evenly spread, always keeping the first and the last. */
export function thin<T>(points: T[], max = 300): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Places where the phone stayed within `radiusM` for at least `minMinutes`. */
export function findStops(points: Point[], minMinutes = 10, radiusM = 80): Stop[] {
  const good = points.filter(usable);
  const stops: Stop[] = [];
  let i = 0;
  while (i < good.length) {
    let j = i;
    while (j + 1 < good.length && haversineKm(good[i], good[j + 1]) * 1000 <= radiusM) j++;
    const minutes = (new Date(good[j].at).getTime() - new Date(good[i].at).getTime()) / 60000;
    if (j > i && minutes >= minMinutes) {
      stops.push({ from: good[i].at, to: good[j].at, minutes: Math.round(minutes), lat: good[i].lat, lng: good[i].lng });
      i = j + 1;
    } else {
      i++;
    }
  }
  return stops;
}

/** The closest of some candidate places, or null when there are none. */
export function closest<T extends { lat: number; lng: number }>(to: { lat: number; lng: number }, places: T[]): T | null {
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
