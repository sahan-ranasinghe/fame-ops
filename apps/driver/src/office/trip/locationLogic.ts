// Office mode (Phase 8, O2): copied from the office site (apps/office/src/ui/locationLogic.ts at main 03d3538) for the phone's trip editor,
// as Sahan asked for this round (the shared package comes later). Edit the site's file and copy again, never this one alone.

// The location search box's rules (Part 4), pure so Vitest runs them: when to
// ask, how a badge looks, what a picked row becomes in a form.
import type { Tone } from './format';
import type { SearchResult } from '../types';

/** Our places and the places used before from 2 characters; the server adds the map from 3. */
export const MIN_CHARS = 2;
/** The pause after the last key before the box asks. */
export const DEBOUNCE_MS = 300;

/** "6.9271, 79.8612" or a link: asked at once, whatever the length. */
export function looksPasted(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || /^-?\d{1,2}(\.\d+)?\s*[,;\s]\s*-?\d{1,3}(\.\d+)?$/.test(t);
}

export const shouldSearch = (text: string) => text.trim().length >= MIN_CHARS || looksPasted(text);

/** Office green, sites blue, the map amber, used before grey. */
export function badgeTone(badge: string): Tone {
  if (badge === "Office") return "green";
  if (badge.startsWith("Site")) return "blue";
  if (badge === "Map") return "amber";
  if (badge === "Google") return "blue";
  return "muted";
}

/** What a form takes from a pick: the name, the place's id (our places), the pin. */
export interface Picked {
  name: string;
  placeId?: string;
  /** A Google place (Part 5): the stop is sent with google_place_id; its pin is Google's. */
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
  pinned: boolean;
  badge?: string;
}

export function pickedOf(r: SearchResult): Picked {
  return { name: r.name, placeId: r.layer === "place" ? r.id : undefined, lat: r.lat, lng: r.lng, pinned: r.pinned, badge: r.badge };
}

/** "6.927100, 79.861200" for a pin field. */
export const pinText = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/** Inside Sri Lanka, roughly: a pin far outside is probably a mistake (warned, not refused). */
export const inLanka = (lat: number, lng: number) => lat >= 5 && lat <= 10 && lng >= 79 && lng <= 82;
