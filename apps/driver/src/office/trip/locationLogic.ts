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
  if (badge === "Town") return "muted";
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

/** Hotfix O2-H1: search_places' input for an empty box: suggestions, nearest to the phone when its position is known. */
export function suggestArgs(near: { lat: number; lng: number } | null, forRequest?: string): Record<string, unknown> {
  // Round 4–7 (item 10): someone else's request being edited: their recent places come too ("Anoja's recent").
  return { suggest: true, ...(near ? { near: { lat: near.lat, lng: near.lng } } : {}), ...(forRequest ? { for_request: forRequest } : {}) };
}

/** Hotfix O2-H1: what the box shows under the field; never an empty list while a search is pending or failed. */
export type SearchState = 'idle' | 'searching' | 'results' | 'none' | 'error';
export function searchState(args: { searchable: boolean; busy: boolean; answer: { results: unknown[]; pin?: unknown } | null; problem: string | null }): SearchState {
  if (!args.searchable) return 'idle';
  if (args.problem) return 'error';
  if (!args.answer) return args.busy ? 'searching' : 'idle';
  return args.answer.results.length > 0 || args.answer.pin ? 'results' : 'none';
}

/**
 * Hotfix O2-H1: what a place box shows. Typing never chooses a place: the picked state (the name with Change) appears
 * only after a pick; while the person types, or until something is picked, the box is a text field with the typed
 * text kept (so leaving and returning restores the text, never a fake place). Change returns to the field.
 */
export type PlaceBox = 'field' | 'picked';
export function placeBoxState(s: { picked?: boolean; place: string }, editing: boolean): PlaceBox {
  if (editing) return 'field';
  return s.picked && s.place.trim() ? 'picked' : 'field';
}

/** Typing into a stop's box: the text is kept, the pick and its ids go. */
export function typedPatch(text: string): { place: string; picked: false; placeId: undefined; placePinned: undefined; googlePlaceId: undefined; lat: undefined; lng: undefined } {
  return { place: text, picked: false, placeId: undefined, placePinned: undefined, googlePlaceId: undefined, lat: undefined, lng: undefined };
}
