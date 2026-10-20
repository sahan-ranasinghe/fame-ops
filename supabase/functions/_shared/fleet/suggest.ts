// The location search's suggestions for an empty box (Hotfix O2-H1, Part A): what a person can pick without typing,
// recent and nearest first. Pure: the ranking of our places and the towns around a point; search_places (tools/places.ts)
// loads the rows and calls these.

import { haversineKm } from "./geo.ts";

/** Colombo, when neither the phone's position nor the base place is known. */
export const COLOMBO = { lat: 6.9271, lng: 79.8612 };

/** How many of each layer an empty box suggests. */
export const SUGGEST_LIMITS = { recent: 5, ours: 8, towns: 5 } as const;

/** The box around the point the towns are read from (about 65 km). */
export const TOWN_BOX_DEG = 0.6;

export interface Pinned {
  lat: number;
  lng: number;
}

/** Nearest first; ties by name. Rows without a pin go last, in their order. */
export function nearestFirst<T extends { name: string; lat?: number | null; lng?: number | null }>(rows: readonly T[], point: Pinned, limit: number): T[] {
  const pinned = rows.filter((r) => r.lat != null && r.lng != null);
  const unpinned = rows.filter((r) => r.lat == null || r.lng == null);
  const ranked = pinned
    .map((r) => ({ r, km: haversineKm(point, { lat: r.lat as number, lng: r.lng as number }) }))
    .sort((a, b) => a.km - b.km || a.r.name.localeCompare(b.r.name))
    .map((x) => x.r);
  return [...ranked, ...unpinned].slice(0, limit);
}

/** Our own places first by kind (offices, then the rest), each group nearest first. */
export function ourPlacesFirst<T extends { name: string; kind: string; lat?: number | null; lng?: number | null }>(rows: readonly T[], point: Pinned, limit: number): T[] {
  const offices = nearestFirst(rows.filter((r) => r.kind === "office"), point, limit);
  const rest = nearestFirst(rows.filter((r) => r.kind !== "office"), point, limit);
  return [...offices, ...rest].slice(0, limit);
}

/** "3 km" under a suggestion (1 decimal under 10 km). */
export function kmText(point: Pinned, row: Pinned): string {
  const km = haversineKm(point, row);
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
