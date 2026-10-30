// The stops of a task as the Assign form and the stops editor hold them, and
// the exact create_task / plan_task / update_task_stops arguments they become
// (the connector contract). Stops are named by their place in the order
// (Phase 7, §11): "Stop 2 · Drop · Kurunegala site". The time at each stop
// (§17): quick picks, or minutes / h:mm up to 12 h; empty = the place's usual
// time, else the default by type (the server decides and says which).

export type StopType = "pickup" | "drop" | "visit";
import { duration } from "@fleet/durations";
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
  /** Hotfix O2-H1: set by a pick (a result, My location, a pin); typing clears it. The box shows the picked state only then. */
  picked?: boolean;
  /** The picked place's pin when the search box knew it (the same-as-start check, the best match). Never sent. */
  lat?: number;
  lng?: number;
  /** "6.93, 79.84" typed by hand; empty = the saved place's pin or the town centre. */
  pin: string;
  /** The time at the stop as chosen: minutes or h:mm; empty = the usual time or the default. */
  dwell: string;
  arriveBy: string;
  note: string;
  /**
   * Fix B (29 October 2026): the type was chosen (⋯ Options) or came with the trip (a task's or a request's stops, a draft
   * saved before Fix B), so a move never changes it. false (a row added here): the type follows the row's place in the list
   * (`typeAt`): the last row, To, is the drop-off; the rows between are visits. Missing = came with the trip.
   */
  typeSet?: boolean;
}

export const TYPE_LABEL: Record<StopType, string> = { pickup: "Pickup", drop: "Drop-off", visit: "Visit" };
/** The type in a stop's name, as the server names it ("Stop 2 · Drop · Kurunegala site"). */
export const TYPE_WORD: Record<StopType, string> = { pickup: "Pickup", drop: "Drop", visit: "Visit" };
export const WHAT_LABEL: Record<Exclude<What, "">, string> = { people: "People", goods: "Goods", documents: "Documents", other: "Other" };

let serial = 0;
/**
 * Each page load's own prefix (30 October 2026, CI 41050400834's flaky phone test): a resumed draft brings back its rows with
 * the keys of the load that saved it, and a counter that restarted at s1 could hand Add stop the key of the draft's To, so
 * both rows were "the open one" and both ⋯ Options sheets showed. Keys from another load never repeat one of this load's.
 */
const LOAD = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newStop = (type: StopType = "visit"): StopDraft => ({ key: `s${LOAD}-${++serial}`, type, what: "", place: "", pin: "", dwell: "", arriveBy: "", note: "", typeSet: false });
/**
 * A new trip: From (the start, the base place by default) and one To; Add stop puts rows between them (Fix B). `back`: the
 * trip goes back to the office (a new trip does), so To is a visit (wait there); one-way, To is the drop-off.
 */
export const defaultStops = (back = true): StopDraft[] => [newStop(typeAt(0, 1, back))];

// ---------------------------------------------------------------------------
// From / To / Add stop (Fix B, Sahan, 29 October 2026; Uber's, PickMe's and Google Maps' route form). The start is From;
// the rows are the stops in order and the last row is To. No type on the form: a row's type follows its place (To = the
// drop-off, the rows between = visits) until it is chosen under ⋯ Options. The server still gets pickup / visit / drop.
// ---------------------------------------------------------------------------

/**
 * The type a row gets from its place in the list (Sahan, 30 October 2026): the rows before To are short stops (a drop-off,
 * the drop-off's short default stay); To is a visit (wait there) when the trip goes back to the office (`back`), else the
 * drop-off.
 */
export const typeAt = (i: number, n: number, back = false): StopType => (i === n - 1 && back ? "visit" : "drop");

/** Each row whose type was not chosen takes the type of its place (after an add, a move or a removal). */
export function withPositions(list: StopDraft[], back = false): StopDraft[] {
  return list.map((s, i) => (s.typeSet || s.type === typeAt(i, list.length, back) ? s : { ...s, type: typeAt(i, list.length, back) }));
}

/**
 * "Then back to the office" switched: To (when its type was not chosen) becomes a visit with Wait there, or, one-way, the
 * drop-off; the wait typed for it goes with the field.
 */
export function withReturn(list: StopDraft[], back: boolean): StopDraft[] {
  const out = withPositions(list, back);
  const last = out.length - 1;
  return !back && last >= 0 && !out[last].typeSet && out[last].dwell ? out.map((s, i) => (i === last ? { ...s, dwell: "" } : s)) : out;
}

/** The row has a place: a picked or typed place, a Google place or a pin. */
export const hasPlace = (s: StopDraft) => !!(s.place.trim() || s.placeId || s.googlePlaceId || s.pin.trim());

/** + Add stop: a new row between the last stop and To (the first row of an empty list is To). Its key, to open its search. */
export function addStop(list: StopDraft[], back = false): { list: StopDraft[]; key: string } {
  if (!list.length) {
    const to = newStop(typeAt(0, 1, back));
    return { list: [to], key: to.key };
  }
  const n = newStop("drop");
  return { list: withPositions([...list.slice(0, -1), n, list[list.length - 1]], back), key: n.key };
}

/** ✕: the row goes; the trip keeps one row (To). The row before a removed To becomes To. */
export function removeStop(list: StopDraft[], i: number, back = false): StopDraft[] {
  const rest = list.filter((_, j) => j !== i);
  return rest.length ? withPositions(rest, back) : [newStop(typeAt(0, 1, back))];
}

/** Drag (or Move up / down): row `from` lands at `to`; the rows that were not given a type take their new place's. */
export function moveStopTo(list: StopDraft[], from: number, to: number, back = false): StopDraft[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [row] = out.splice(from, 1);
  out.splice(to, 0, row);
  return withPositions(out, back);
}

/**
 * On Next / Save draft / Send, once To has a place: the rows with nothing in them go, silently (Sahan, 30 October 2026); a
 * row with an arrive-by, a stay, a note or what is carried but no place stays and is named ("Stop 2 needs a place"), so
 * Next and Send wait. To with no place: nothing changes (Next waits).
 */
export function tidyStops(list: StopDraft[], back = false): StopDraft[] {
  const to = list[list.length - 1];
  if (!to || !hasPlace(to)) return list;
  const kept = list.filter(usedRow);
  return kept.length === list.length ? list : withPositions(kept, back);
}

/**
 * A draft, request or task opened in the form: the rows with nothing in them (an old draft's or an old request's empty
 * stop) are left out, a row with something in it stays (named on Next); a type that came with the trip stays (a move keeps
 * it), a row added in the form follows its new place. At least To stays.
 */
export function openStops(list: StopDraft[], back = false): StopDraft[] {
  const kept = list.filter(usedRow);
  // Nothing in any row: the last row stays as To, a row whose type follows its place.
  if (!kept.length) {
    const last = list[list.length - 1];
    return last ? [{ ...last, type: typeAt(0, 1, back), typeSet: false }] : [newStop(typeAt(0, 1, back))];
  }
  // A row added here follows its new place (a resumed draft whose To was empty: the last stop becomes To); a type that came
  // with the trip or an older draft stays.
  return withPositions(kept.map((s) => ({ ...s, typeSet: s.typeSet ?? true })), back);
}

/**
 * What happens at a stop, as ⋯ Options offers it: Short stop (the drop-off's short stay; on To, one-way, the drop-off) /
 * People get in / People get out / Visit · wait / Goods.
 */
export type StopRole = "short" | "in" | "out" | "visit" | "goods";
export const STOP_ROLES: StopRole[] = ["short", "in", "out", "visit", "goods"];

/** The role a row shows: goods carried, else by its type (a drop-off of people: People get out; any other: a short stop). */
export function roleOf(s: Pick<StopDraft, "type" | "what">): StopRole {
  if (s.what === "goods") return "goods";
  if (s.type === "pickup") return "in";
  if (s.type === "visit") return "visit";
  return s.what === "people" ? "out" : "short";
}

/**
 * The role chosen under ⋯ Options, as the server's type and what: Short stop = a drop-off with nothing named (documents or
 * other carried stay), People get in = a pickup of people, People get out = a drop of people, Visit · wait = a visit
 * (documents or other carried stay), Goods = a drop of goods (a pickup of goods stays a pickup). The type is then the
 * row's own: a move keeps it.
 */
export function withRole(s: StopDraft, role: StopRole): StopDraft {
  const keepWhat = s.what === "documents" || s.what === "other" ? s.what : "";
  if (role === "short") return { ...s, type: "drop", what: keepWhat, typeSet: true };
  if (role === "in") return { ...s, type: "pickup", what: "people", typeSet: true };
  if (role === "out") return { ...s, type: "drop", what: "people", typeSet: true };
  if (role === "visit") return { ...s, type: "visit", what: keepWhat, typeSet: true };
  return { ...s, type: s.type === "pickup" ? "pickup" : "drop", what: "goods", typeSet: true };
}

/** From's ⋯ Options: Leave from here (the start only), People get in, Goods (the start becomes Stop 1, a pickup). */
export type StartRole = "leave" | "in" | "goods";
export const START_ROLES: StartRole[] = ["leave", "in", "goods"];
export function startRoleOf(f: Pick<StartFields, "startPax" | "startWhat">): StartRole {
  return !f.startPax ? "leave" : f.startWhat === "goods" ? "goods" : "in";
}
export function withStartRole(f: Pick<StartFields, "startWhat">, role: StartRole): Pick<StartFields, "startPax" | "startWhat"> {
  if (role === "leave") return { startPax: false, startWhat: f.startWhat };
  if (role === "goods") return { startPax: true, startWhat: "goods" };
  return { startPax: true, startWhat: f.startWhat === "goods" ? "" : f.startWhat };
}

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

/** A row the person has put something in: a place, a pin, an arrive-by, a stay, a note or what is carried (rows with none are dropped). */
export const usedRow = (s: StopDraft) => !!(s.place.trim() || s.placeId || s.googlePlaceId || s.pin.trim() || s.arriveBy || s.note.trim() || s.dwell.trim() || s.what);

/**
 * The stops[] argument, or what is wrong with them. Empty rows are dropped. `offset`: the stops before these rows (the
 * start stop, stops already reached), so an error names the row as its label does ("Stop 3: add a place name").
 */
export function stopsInput(list: StopDraft[], offset = 0): { error: string } | { stops: Record<string, unknown>[] } {
  // Fix B: To (the last row) is never dropped while another row is used: an empty To is named ("Stop 3: add a place…").
  const used = list.some(usedRow);
  const rows = list.filter((s, i) => usedRow(s) || (used && i === list.length - 1));
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
  return openStops(stops.map((s) => ({
    picked: !!(s.place_id || s.google_place_id || (s.lat != null && s.lng != null) || (s.place ?? "").trim()),
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
    // The trip's own type: kept on a move (Fix B).
    typeSet: true,
  })));
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
export function tickStart(list: StopDraft[], i: number, back = false): { list: StopDraft[]; carried: Pick<StartFields, "startWhat" | "startNote" | "startDwell"> } {
  const row = list[i];
  const rest = list.filter((_, j) => j !== i);
  return {
    list: rest.length ? withPositions(rest, back) : [newStop(typeAt(0, 1, back))],
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
