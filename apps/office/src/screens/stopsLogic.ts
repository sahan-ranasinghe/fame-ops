// The stops of a task as the Assign form and the stops editor hold them, and
// the exact create_task / plan_task / update_task_stops arguments they become
// (the connector contract).

export type StopType = "pickup" | "drop" | "visit";
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
  /** "6.93, 79.84" typed by hand; empty = the saved place's pin or the town centre. */
  pin: string;
  dwell: string;
  arriveBy: string;
  note: string;
}

export const TYPE_LABEL: Record<StopType, string> = { pickup: "Pickup", drop: "Drop-off", visit: "Visit" };
export const WHAT_LABEL: Record<Exclude<What, "">, string> = { people: "People", goods: "Goods", documents: "Documents", other: "Other" };

let serial = 0;
export const newStop = (type: StopType = "visit"): StopDraft => ({ key: `s${++serial}`, type, what: "", place: "", pin: "", dwell: "", arriveBy: "", note: "" });
export const defaultStops = (): StopDraft[] => [newStop("pickup"), newStop("drop")];

/**
 * The row's label, numbered within its type: "Pickup 1", "Drop-off 1", "Drop-off 2", "Visit 1".
 * Adding, removing or moving a row never changes another row's type; only the numbers follow.
 */
export function stopLabel(list: { type: StopType }[], i: number): string {
  const type = list[i].type;
  const n = list.slice(0, i + 1).filter((s) => s.type === type).length;
  return `${TYPE_LABEL[type]} ${n}`;
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

/** The stops[] argument, or what is wrong with them. Empty rows at the end are dropped. */
export function stopsInput(list: StopDraft[]): { error: string } | { stops: Record<string, unknown>[] } {
  const rows = list.filter((s) => s.place.trim() || s.placeId || s.googlePlaceId || s.pin.trim() || s.arriveBy || s.note.trim());
  if (!rows.length) return { error: "Add at least one stop." };
  const out: Record<string, unknown>[] = [];
  for (const [i, s] of rows.entries()) {
    const pin = parsePin(s.pin);
    if (pin === "bad") return { error: `Stop ${i + 1}: the pin must be "lat, lng", e.g. 6.9344, 79.8428.` };
    if (!s.place.trim() && !pin && !s.placeId && !s.googlePlaceId) return { error: `Stop ${i + 1}: add a place name (a saved place, a town, or an address) or a pin.` };
    if (s.arriveBy && !isTime(s.arriveBy)) return { error: `Stop ${i + 1}: the arrive-by time must be HH:MM.` };
    const dwell = s.dwell.trim() === "" ? undefined : parseInt(s.dwell, 10);
    if (dwell !== undefined && (Number.isNaN(dwell) || dwell < 0 || dwell > 1440)) return { error: `Stop ${i + 1}: minutes at the stop must be 0 to 1440.` };
    const row: Record<string, unknown> = { type: s.type };
    if (s.what) row.what = s.what;
    if (s.placeId) row.place_id = s.placeId;
    else if (s.googlePlaceId) row.google_place_id = s.googlePlaceId;
    if (s.place.trim()) row.place = s.place.trim();
    if (pin && !s.googlePlaceId) {
      row.lat = pin.lat;
      row.lng = pin.lng;
    }
    if (dwell !== undefined) row.dwell_min = dwell;
    if (s.arriveBy) row.arrive_by = s.arriveBy;
    if (s.note.trim()) row.note = s.note.trim();
    out.push(row);
  }
  return { stops: out };
}

export const hasDeadline = (list: StopDraft[]) => list.some((s) => isTime(s.arriveBy));

/** Drafts from a task's stops (task_detail), for editing. */
export function draftsFromStops(stops: { type: string; what?: string; place?: string; place_id?: string; google_place_id?: string; lat?: number; lng?: number; dwell_min?: number; arrive_by?: string; note?: string; pin?: string }[]): StopDraft[] {
  return stops.map((s) => ({
    ...newStop((["pickup", "drop", "visit"].includes(s.type) ? s.type : "visit") as StopType),
    what: (s.what ?? "") as What,
    place: s.place ?? "",
    placeId: s.place_id,
    placePinned: s.place_id ? s.lat != null : undefined,
    googlePlaceId: s.place_id ? undefined : s.google_place_id,
    pin: s.pin === "given" && s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : "",
    dwell: s.dwell_min != null ? String(s.dwell_min) : "",
    arriveBy: s.arrive_by ?? "",
    note: s.note ?? "",
  }));
}

/** "2 h 35 min" */
export function driveText(minutes: number | undefined | null): string {
  if (minutes == null) return "—";
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
}
