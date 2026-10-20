// Office mode (Stage 1, O3 row 8): Places under More, the rules only (pure). As the website's /places and /places/:id
// (Phase 6 Part 4, Phase 7 §15): the list (list_places) with the search box and one Filter (Ours by default, Dialog sites,
// Mobitel sites, Other sites, Removed; with or without a pin), 50 a page; a place's page (place_detail: the badge, the
// address, district, depot, region, the ids, the pin with Open in Maps, how often it was used); Edit (update_place: the
// name, address, kind, district, depot; the vehicles permission); Remove (remove_place: the first call answers
// needs_confirm with the reasons when it is the base place or tasks use it, the second sends confirm) and Restore
// (restore_place) for a removed one.

import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';
import type { Paged, Place, PlaceDetail } from './types';

export interface PlacesList extends Paged {
  count: number;
  places: Place[];
}

export interface PlaceDetailAnswer {
  place: PlaceDetail;
  stops_90_days: number;
  in_use?: { reasons: string[]; tasks?: { task_id: string; title: string; when: string }[] };
}

export interface RemoveAnswer {
  needs_confirm?: boolean;
  removed?: string;
  place?: string;
  reasons?: string[];
  tasks?: { task_id: string; title: string; when: string }[];
  note?: string;
  base_place_cleared?: boolean;
}

export type PlacesWho = 'ours' | 'dialog' | 'mobitel' | 'other_sites' | 'removed';
export const PLACES_WHO: readonly PlacesWho[] = ['ours', 'dialog', 'mobitel', 'other_sites', 'removed'];
export type PinFilter = 'any' | 'with' | 'without';
export const PIN_FILTERS: readonly PinFilter[] = ['any', 'with', 'without'];
export const PLACES_PAGE = 50;

type Words = (key: string) => string;

export function placesFilterDefs(tr: Words): FilterDef[] {
  return [
    { key: 'who', label: tr('office.places.filterWho'), kind: 'single', default: 'ours', options: PLACES_WHO.map((w) => ({ value: w, label: tr(`office.places.who_${w}`) })) },
    { key: 'pin', label: tr('office.places.filterPin'), kind: 'single', default: 'any', options: PIN_FILTERS.map((p) => ({ value: p, label: tr(`office.places.pin_${p}`) })) },
  ];
}

export function placesChoice(v: FilterValues): { who: PlacesWho; pin: PinFilter } {
  const who = typeof v.who === 'string' && (PLACES_WHO as readonly string[]).includes(v.who) ? (v.who as PlacesWho) : 'ours';
  const pin = typeof v.pin === 'string' && (PIN_FILTERS as readonly string[]).includes(v.pin) ? (v.pin as PinFilter) : 'any';
  return { who, pin };
}

/** list_places' input: ours are the office's own (no operator); the sites by operator; Removed; the pin; the search. */
export function placesArgs(who: PlacesWho, pin: PinFilter, search: string, cursor?: string): Record<string, unknown> {
  const words = search.trim().slice(0, 80);
  return {
    limit: PLACES_PAGE,
    ...(who === 'dialog' || who === 'mobitel' ? { operator: who } : who === 'other_sites' ? { operator: 'other' } : {}),
    ...(who === 'removed' ? { removed: true } : {}),
    ...(pin === 'with' ? { pinned: true } : pin === 'without' ? { pinned: false } : {}),
    ...(words ? { search: words } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function appendPlaces(list: PlacesList, page: PlacesList): PlacesList {
  const key = (p: Place) => p.id ?? p.name;
  const seen = new Set(list.places.map(key));
  const out: PlacesList = { ...list, places: [...list.places, ...page.places.filter((p) => !seen.has(key(p)))] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

/** "Colombo 05 · Western" under a place's name. */
export const placeLine = (p: Pick<Place, 'address' | 'district' | 'site_id'>): string => [p.site_id, p.address, p.district].filter(Boolean).join(' · ');

/** Edit's fields, and update_place's input: only what changed (names trimmed). */
export interface PlaceFields {
  name: string;
  address: string;
  district: string;
  depot: string;
}

export function placeFields(p: Pick<PlaceDetail, 'name' | 'address' | 'district' | 'depot'>): PlaceFields {
  return { name: p.name ?? '', address: p.address ?? '', district: p.district ?? '', depot: p.depot ?? '' };
}

export function updatePlaceInput(id: string, was: PlaceFields, now: PlaceFields): Record<string, unknown> | 'name' | null {
  const out: Record<string, unknown> = {};
  if (!now.name.trim()) return 'name';
  // update_place cannot clear a field (its texts need a letter): an emptied field keeps its value (the screen says so).
  for (const k of ['name', 'address', 'district', 'depot'] as const) if (now[k].trim() && now[k].trim() !== was[k].trim()) out[k] = now[k].trim();
  return Object.keys(out).length ? { id, ...out } : null;
}
