// What the task map may draw (Phase 6, Part 5). A stop that is a Google place (google_place_id:
// its pin came from Google's place search) is drawn on Google's map only (Google's terms); on the
// OpenFreeMap map it is left out and a line says Navigate opens it in Google Maps. The distance
// left is still worked out from its pin (no map involved).
import type { TaskStop } from './types';

export type LngLat = [number, number];

export function stopPoint(stop: Pick<TaskStop, 'lat' | 'lng'> | null | undefined): LngLat | null {
  return stop?.lat != null && stop.lng != null ? [stop.lng, stop.lat] : null;
}

/** The destination the map may draw: none for a Google place unless the map is Google's. */
export function drawnDestination(stop: Pick<TaskStop, 'lat' | 'lng' | 'google_place_id'> | null | undefined, googleMap: boolean): LngLat | null {
  if (!stop) return null;
  if (stop.google_place_id && !googleMap) return null;
  return stopPoint(stop);
}
