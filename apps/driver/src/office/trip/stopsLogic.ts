// Office mode (Phase 8, O2): copied from the office site (apps/office/src/screens/stopsLogic.ts at main 03d3538) for the phone's trip editor,
// as Sahan asked for this round (the shared package comes later). Edit the site's file and copy again, never this one alone.

// The stops of a task as the Assign form and the stops editor hold them, and
// the exact create_task / plan_task / update_task_stops arguments they become
// (the connector contract). Stops are named by their place in the order
// (Phase 7, §11): "Stop 2 · Drop · Kurunegala site". The time at each stop
// (§17): quick picks, or minutes / h:mm up to 12 h; empty = the place's usual
// time, else the default by type (the server decides and says which).

export type StopType = "pickup" | "drop" | "visit";
import { duration } from './durations';
export type What = "" | "people" | "goods" | "documents" | "other";

export interface StopDraft {
  key: string;
  type: StopType;
  what: What;
  place: string;
  /** The place picked in the search box (Part 4): sent as place_id, so the stop is that place. */
  placeId?: string;
  /** Whether the picked place has a pin (a site without one: the plan skips the leg). */
  placePinned?: boolean;
  /** A Google place picked in the search box (Part 5): sent as google_place_id with the name as place. */
  googlePlaceId?: string;
  /** The picked place's pin when the search box knew it (the same-as-start check, the best match). Never sent. */
  lat?: number;
  lng?: number;
  /** Hotfix O2-H1: set by a pick (a result, My location, a pin); typing clears it. The box shows the picked state only then. */
  picked?: boolean;
  /** "6.93, 79.84" typed by hand; empty = the saved place's pin or the town centre. */
  pin: string;
  /** The time at the stop as chosen: minutes or h:mm; empty = the usual time or the default. */
  dwell: string;
  arriveBy: string;
  note: string;
}

export const TYPE_LABEL: Record<StopType, string> = { pickup: "Pickup", drop: "Drop-off", visit: "Visit" };
/** The type in a stop's name, as the server names it ("Stop 2 · Drop · Kurunegala site"). */
export const TYPE_WORD: Record<StopType, string> = { pickup: "Pickup", drop: "Drop", visit: "Visit" };
export const WHAT_LABEL: Record<Exclude<What, "">, string> = { people: "People", goods: "Goods", documents: "Documents", other: "Other" };

let serial = 0;
export const newStop = (type: StopType = "visit"): StopDraft => ({ key: `s${++serial}`, type, what: "", place: "", pin: "", dwell: "", arriveBy: "", note: "" });
export const defaultStops = (): StopDraft[] => [newStop("pickup"), newStop("drop")];

/** "Stop 2": the row's place in the order; `offset` counts the stops before the rows (the start stop, stops already reached). */
export const stopNumber = (i: number, offset = 0) => `Stop ${offset + i + 1}`;

/**
 * The row's name by its place in the order: "Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kurunegala site"
 * ("Stop 3 · Visit" while the place is empty). Adding, removing or moving a row renumbers; a row's type never changes.
 */
export function stopLabel(list: { type: StopType; place?: string }[], i: number, offset = 0): string {
  const s = list[i];
  const place = s.place?.trim();
  return `${stopNumber(i, offset)} · ${TYPE_WORD[s.type]}${place ? ` · ${place}` : ""}`;
}

export function moveStop(list: StopDraft[], i: number, dir: -1 | 1): StopDraft[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function parsePin(text: string): { lat: number; lng: number } | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return "bad";
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : "bad";
}

const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** The quick picks for the time at a stop, in minutes. */
export const DWELL_PICKS = [5, 15, 30, 60, 90, 120] as const;
/** The longest time at a stop the form takes: 12 h. */
export const DWELL_MAX = 720;

/** "45" → 45, "1:30" → 90, "" → null; anything else, or over 12 h, is "bad". */
export function parseDwell(text: string): number | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  let min: number;
  if (/^\d{1,3}$/.test(t)) min = Number(t);
  else {
    const m = /^(\d{1,2})[:.]([0-5]\d)$/.exec(t);
    if (!m) return "bad";
    min = Number(m[1]) * 60 + Number(m[2]);
  }
  return min > DWELL_MAX ? "bad" : min;
}

/** 5 → "5 min", 60 → "1 h", 90 → "1 h 30 min" (Hotfix 2, D: the shared words). */
export function dwellText(min: number): string {
  return duration(Math.max(0, min));
}

/** The default time at a stop by type, from the fleet setting dwell_min ({"pickup":5,"drop":5,"visit":60,"default":5}). */
export function typeDwell(type: StopType, setting?: Record<string, number> | null): number {
  const s = setting ?? {};
  return s[type] ?? s.default ?? (type === "visit" ? 60 : 5);
}

/** A row the person has put something in (empty rows at the end are dropped). */
export const usedRow = (s: StopDraft) => !!(s.place.trim() || s.placeId || s.googlePlaceId || s.pin.trim() || s.arriveBy || s.note.trim());

/**
 * The stops[] argument, or what is wrong with them. Empty rows are dropped. `offset`: the stops before these rows (the
 * start stop, stops already reached), so an error names the row as its label does ("Stop 3: add a place name").
 */
export function stopsInput(list: StopDraft[], offset = 0): { error: string } | { stops: Record<string, unknown>[] } {
  const rows = list.filter(usedRow);
  if (!rows.length) return { error: "Add at least one stop." };
  const out: Record<string, unknown>[] = [];
  for (const s of rows) {
    const i = list.indexOf(s) + offset;
    const pin = parsePin(s.pin);
    if (pin === "bad") return { error: `Stop ${i + 1}: the pin must be "lat, lng", e.g. 6.9344, 79.8428.` };
    if (!s.place.trim() && !pin && !s.placeId && !s.googlePlaceId) return { error: `Stop ${i + 1}: add a place name (a saved place, a town, or an address) or a pin.` };
    if (s.arriveBy && !isTime(s.arriveBy)) return { error: `Stop ${i + 1}: the arrive-by time must be HH:MM.` };
    const dwell = parseDwell(s.dwell);
    if (dwell === "bad") return { error: `Stop ${i + 1}: the time at the stop must be minutes or h:mm, up to 12 h.` };
    const row: Record<string, unknown> = { type: s.type };
    if (s.what) row.what = s.what;
    if (s.placeId) row.place_id = s.placeId;
    else if (s.googlePlaceId) row.google_place_id = s.googlePlaceId;
    if (s.place.trim()) row.place = s.place.trim();
    if (pin && !s.googlePlaceId) {
      row.lat = pin.lat;
      row.lng = pin.lng;
    }
    if (dwell !== null) row.dwell_min = dwell;
    if (s.arriveBy) row.arrive_by = s.arriveBy;
    if (s.note.trim()) row.note = s.note.trim();
    out.push(row);
  }
  return { stops: out };
}

export const hasDeadline = (list: StopDraft[]) => list.some((s) => isTime(s.arriveBy));

/** Drafts from a task's stops (task_detail), for editing. A time the server chose (usual or default) stays unchosen. */
export function draftsFromStops(stops: { type: string; what?: string; place?: string; place_id?: string; google_place_id?: string; lat?: number; lng?: number; dwell_min?: number; dwell_source?: string; arrive_by?: string; note?: string; pin?: string }[]): StopDraft[] {
  return stops.map((s) => ({
    picked: !!(s.place_id || s.google_place_id || (s.lat != null && s.lng != null) || (s.place ?? '').trim()),
    ...newStop((["pickup", "drop", "visit"].includes(s.type) ? s.type : "visit") as StopType),
    what: (s.what ?? "") as What,
    place: s.place ?? "",
    placeId: s.place_id,
    placePinned: s.place_id ? s.lat != null : undefined,
    googlePlaceId: s.place_id ? undefined : s.google_place_id,
    lat: s.google_place_id && !s.place_id ? undefined : s.lat,
    lng: s.google_place_id && !s.place_id ? undefined : s.lng,
    pin: s.pin === "given" && s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : "",
    dwell: s.dwell_min != null && (s.dwell_source === undefined || s.dwell_source === "chosen") ? String(s.dwell_min) : "",
    arriveBy: s.arrive_by ?? "",
    note: s.note ?? "",
  }));
}

/** "2 h 35 min" */
export function driveText(minutes: number | undefined | null): string {
  return minutes == null ? "—" : duration(minutes);
}

// ---------------------------------------------------------------------------
// The start and "Passengers get in here" (§11)
// ---------------------------------------------------------------------------

/** Where the trip starts, as the forms hold it. */
export interface StartPoint {
  placeId?: string;
  lat?: number;
  lng?: number;
  /** The start's saved-place name, when only the name is known (a task's start in task_detail). */
  name?: string;
}

/** A row's pin: the picked place's, else the typed one. */
export function rowPin(s: StopDraft): { lat: number; lng: number } | null {
  if (s.lat !== undefined && s.lng !== undefined) return { lat: s.lat, lng: s.lng };
  const p = parsePin(s.pin);
  return p && p !== "bad" ? p : null;
}

/** Straight-line metres between two pins. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The same place as the start: the same saved place, or pins within 50 m (cars kept in the office basement). */
export function sameAsStart(start: StartPoint | null | undefined, s: StopDraft): boolean {
  if (!start) return false;
  if (start.placeId && s.placeId && start.placeId === s.placeId) return true;
  // Only the start's name is known: one of our places picked under the same name (our places' names are unique).
  if (!start.placeId && start.name && s.placeId && start.name.trim().toLowerCase() === s.place.trim().toLowerCase()) return true;
  const p = rowPin(s);
  if (!p || start.lat === undefined || start.lng === undefined) return false;
  return metresBetween({ lat: start.lat, lng: start.lng }, p) <= 50;
}

/** The row that should be the start instead (a first pickup where the trip starts), or -1. Not while the start is already a stop. */
export function pickupAtStart(list: StopDraft[], start: StartPoint | null | undefined, startIsStop: boolean): number {
  if (startIsStop) return -1;
  const i = list.findIndex(usedRow);
  return i >= 0 && list[i].type === "pickup" && sameAsStart(start, list[i]) ? i : -1;
}

/**
 * The first stop for the best match: the start when passengers get in there, else the first row: its pin, or
 * the name of a place picked from our list (free text is not sent: every key would ask again).
 */
export function firstStopOf(list: StopDraft[], start?: { name: string; lat?: number; lng?: number } | null): { place?: string; lat?: number; lng?: number } | null {
  if (start) return start.lat !== undefined && start.lng !== undefined ? { lat: start.lat, lng: start.lng } : start.name.trim() ? { place: start.name } : null;
  const s = list.find(usedRow);
  if (!s) return null;
  const pin = s.googlePlaceId ? null : rowPin(s);
  return pin ? pin : s.placeId && s.place.trim() ? { place: s.place } : null;
}

/**
 * Tick it: the pickup at the start goes, and "Passengers get in here" takes its place; what the row carried (what,
 * the note, the time at the stop) moves to the start stop. A task keeps at least one row.
 */
export function tickStart(list: StopDraft[], i: number): { list: StopDraft[]; carried: Pick<StartFields, "startWhat" | "startNote" | "startDwell"> } {
  const row = list[i];
  const rest = list.filter((_, j) => j !== i);
  return {
    list: rest.length ? rest : [newStop("drop")],
    carried: { startWhat: row?.what ?? "", startNote: row?.note.trim() ?? "", startDwell: row?.dwell.trim() ?? "" },
  };
}

/** Where the trip starts, as the forms hold it. */
export interface StartFields {
  /** The text in the box; "" with no id = the base place. */
  start: string;
  startPlaceId?: string;
  startGooglePlaceId?: string;
  startLat?: number;
  startLng?: number;
  /** Passengers get in here: the start becomes Stop 1, a pickup. */
  startPax: boolean;
  /** The start stop's own fields while passengers get in there (Tick it moves them from the pickup); "" = the defaults. */
  startWhat?: What;
  startNote?: string;
  startDwell?: string;
}

/** The start stop's what, note and time there, for a call (only with passengers). */
export function startExtras(f: Pick<StartFields, "startWhat" | "startNote" | "startDwell">): Record<string, unknown> {
  const dwell = parseDwell(f.startDwell ?? "");
  return {
    ...(f.startWhat ? { what: f.startWhat } : {}),
    ...(f.startNote?.trim() ? { note: f.startNote.trim() } : {}),
    ...(typeof dwell === "number" ? { dwell_min: dwell } : {}),
  };
}

/** The start for a call: the picked or typed one, else the base place (as the server would take it); passengers when ticked. */
export function startInput(f: StartFields, base: { id: string; name: string } | null): Record<string, unknown> | undefined {
  const t = f.start.trim();
  if (t || f.startPlaceId || f.startGooglePlaceId) {
    return {
      ...(f.startPlaceId ? { place_id: f.startPlaceId } : f.startGooglePlaceId ? { google_place_id: f.startGooglePlaceId } : {}),
      ...(t ? { place: t } : {}),
      ...(f.startPax ? { passengers: true, ...startExtras(f) } : {}),
    };
  }
  if (f.startPax) return base ? { place_id: base.id, place: base.name, passengers: true, ...startExtras(f) } : { passengers: true, ...startExtras(f) };
  return undefined;
}
