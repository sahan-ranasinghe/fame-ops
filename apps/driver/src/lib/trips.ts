// Trips the driver starts (Phase 7, §13 of docs/phase7-plan.md): the rules the trip page, the task screen and the
// offline queue share. Pure (no React, no Expo), so scripts/test-trips.ts runs it.
//   - Company work or Personal, by the office's setting driver_personal_trips.
//   - What the driver picked in the search box (our place, used before, the map's, Google's, a pasted pin or the typed
//     words) as the destination driver-api takes.
//   - With no connection only one of our places the phone knows, or the typed words, can be picked.
//   - The bodies of POST /trips and POST /trips/:id/stops and the queue's ops: every id is made on the phone (the
//     trip's id is the task's id), so the queue can send them again and nothing is made twice.
//   - The phone's own copy of the trip (a task row with its stop), so the normal Start task flow runs offline, and the
//     server's answer merged into it (the first stop gets the server's id; the stops added on the way keep the phone's).

import type { TaskStop, TaskWithStops } from './types';

export type Purpose = 'company' | 'personal';
/** The office's setting: allowed (Company preselected), default (Personal preselected), off (company only); ask_first behaves as allowed. */
export type PersonalTrips = 'allowed' | 'default' | 'off' | 'ask_first';

const PERSONAL_TRIPS: readonly PersonalTrips[] = ['allowed', 'default', 'off', 'ask_first'];

/** The search box asks from 2 characters (the server's own minimum), 300 ms after the last key. */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 300;
/** A trip has 12 stops at most (the server refuses a 13th). */
export const MAX_STOPS = 12;
/** The typed words and a place's name go to the server as at most 160 characters; a note as 500. */
export const MAX_NAME = 160;
export const MAX_NOTE = 500;

export function parsePersonalTrips(value: unknown): PersonalTrips {
  return typeof value === 'string' && (PERSONAL_TRIPS as readonly string[]).includes(value) ? (value as PersonalTrips) : 'allowed';
}

/** The two big choices on the trip page: which ones, which is preselected, and whether the choice is shown at all. */
export function purposeChoices(setting: PersonalTrips): { options: Purpose[]; preselected: Purpose; showChoice: boolean } {
  if (setting === 'off') return { options: ['company'], preselected: 'company', showChoice: false };
  return { options: ['company', 'personal'], preselected: setting === 'default' ? 'personal' : 'company', showChoice: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The search box (driver-api POST /places/search: the office's three layers, from the same code)
// ---------------------------------------------------------------------------------------------------------------------

export type Layer = 'place' | 'recent' | 'map' | 'google';

export interface SearchResult {
  layer: Layer;
  /** The server's badge: Office, Site · Dialog, Saved, Used before, Map, Google. */
  badge: string;
  name: string;
  detail?: string;
  /** place: our place's id. */
  id?: string;
  site_id?: string;
  pinned: boolean;
  lat?: number;
  lng?: number;
  attribution?: string;
  /** google: Google's place id (no pin on the phone: the server fetches it through its counted gate). */
  google_place_id?: string;
}

export interface SearchAnswer {
  text: string;
  results: SearchResult[];
  /** A pasted "lat, lng" or Google Maps link. */
  pin?: { lat: number; lng: number };
  /** Why the map layer is short (a cap, Google refused): the server's words. */
  map_note?: string;
}

const LAYERS: readonly Layer[] = ['place', 'recent', 'map', 'google'];
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** The server's answer, checked field by field (anything odd is left out rather than shown wrong). */
export function parseSearchAnswer(body: unknown): SearchAnswer {
  const b = (body ?? {}) as { text?: unknown; results?: unknown; pin?: { lat?: unknown; lng?: unknown } | null; map_note?: unknown };
  const results: SearchResult[] = [];
  for (const raw of Array.isArray(b.results) ? b.results : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const layer = r.layer as Layer;
    const name = str(r.name);
    if (!LAYERS.includes(layer) || !name) continue;
    const lat = num(r.lat);
    const lng = num(r.lng);
    results.push({
      layer,
      badge: str(r.badge) ?? '',
      name,
      detail: str(r.detail),
      id: str(r.id),
      site_id: str(r.site_id),
      pinned: lat !== undefined && lng !== undefined,
      lat: lat !== undefined && lng !== undefined ? lat : undefined,
      lng: lat !== undefined && lng !== undefined ? lng : undefined,
      attribution: str(r.attribution),
      google_place_id: str(r.google_place_id),
    });
  }
  const pinLat = num(b.pin?.lat);
  const pinLng = num(b.pin?.lng);
  return {
    text: typeof b.text === 'string' ? b.text : '',
    results,
    pin: pinLat !== undefined && pinLng !== undefined ? { lat: pinLat, lng: pinLng } : undefined,
    map_note: str(b.map_note),
  };
}

/** Whether to ask the server for this text (from 2 characters). Never one request per key press: the box waits 300 ms. */
export function shouldSearch(text: string): boolean {
  const typed = text.trim();
  return typed.length >= SEARCH_MIN_CHARS && typed.length <= 500;
}

/** The search box's session token: one per typing session, 8–36 of [A-Za-z0-9_-] (a uuid is 36). */
export const SESSION_RE = /^[A-Za-z0-9_-]{8,36}$/;

export function isSessionToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && SESSION_RE.test(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// What the driver picked, and the destination the server takes
// ---------------------------------------------------------------------------------------------------------------------

export type Destination =
  | { place_id: string }
  | { google_place_id: string; name: string; session?: string }
  | { lat: number; lng: number; name?: string }
  | { text: string };

/** A choice in the box: the destination for the server, and what the phone shows and keeps in its own copy. */
export interface Choice {
  /** What the list and the stop show. */
  name: string;
  /** The search answer's second line, or our place's address. */
  detail: string | null;
  /** The server's badge (English, as the office's box shows it); none for the phone's own list. */
  badge: string | null;
  layer: Layer | 'typed' | 'pin' | 'known';
  destination: Destination;
  /**
   * For one of our places: its pin or its words. The queue sends this instead when the server refuses the place (it
   * was removed while the trip waited on the phone), so an offline trip is not lost over a list change.
   */
  fallback?: Destination;
  placeId: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

function placeFallback(name: string, lat: number | null | undefined, lng: number | null | undefined): Destination {
  return lat != null && lng != null ? { lat, lng, name: clip(name, MAX_NAME) } : { text: clip(name, MAX_NAME) };
}

/** A search result as a choice: our place by its id, Google's by its id and name, a pinned one by its pin, else its words. */
export function pickFromResult(r: SearchResult, session?: string | null): Choice {
  const name = clip(r.name, MAX_NAME);
  const lat = r.lat ?? null;
  const lng = r.lng ?? null;
  const base = { name, detail: r.detail ?? null, badge: r.badge || null, layer: r.layer, address: r.layer === 'place' ? r.detail ?? null : null };
  if (r.layer === 'place' && r.id) {
    return { ...base, destination: { place_id: r.id }, fallback: placeFallback(name, lat, lng), placeId: r.id, googlePlaceId: null, lat, lng };
  }
  if (r.layer === 'google' && r.google_place_id) {
    return {
      ...base,
      destination: { google_place_id: r.google_place_id, name, ...(isSessionToken(session) ? { session } : {}) },
      placeId: null,
      googlePlaceId: r.google_place_id,
      // Google's pin is never on the phone before the server fetched it (the 30-day rule is the server's).
      lat: null,
      lng: null,
    };
  }
  if (lat !== null && lng !== null) return { ...base, destination: { lat, lng, name }, placeId: null, googlePlaceId: null, lat, lng };
  return { ...base, destination: { text: name }, placeId: null, googlePlaceId: null, lat: null, lng: null };
}

/** A pasted "lat, lng" or Google Maps link: the server names it by its coordinates. */
export function pickFromPin(pin: { lat: number; lng: number }): Choice {
  const name = `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
  return { name, detail: null, badge: null, layer: 'pin', destination: { lat: pin.lat, lng: pin.lng }, placeId: null, googlePlaceId: null, lat: pin.lat, lng: pin.lng, address: null };
}

/** "Go to “…”": the typed words, as they are (the driver navigates by them; the office sees them without a pin). */
export function pickFromText(text: string): Choice | null {
  const name = clip(text, MAX_NAME);
  if (name === '') return null;
  return { name, detail: null, badge: null, layer: 'typed', destination: { text: name }, placeId: null, googlePlaceId: null, lat: null, lng: null, address: null };
}

/** One of our places the phone knows (works offline). */
export interface KnownPlace {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  site_id?: string | null;
}

export function pickFromKnown(place: KnownPlace): Choice {
  const name = clip(place.name, MAX_NAME);
  return {
    name,
    detail: [place.site_id, place.address].filter(Boolean).join(' · ') || null,
    badge: null,
    layer: 'known',
    destination: { place_id: place.id },
    fallback: placeFallback(name, place.lat, place.lng),
    placeId: place.id,
    googlePlaceId: null,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
  };
}

/** With no connection the search has no answers: only one of our places (by its id) or the typed words. */
export function allowedOffline(pick: Choice): boolean {
  return 'place_id' in pick.destination || 'text' in pick.destination;
}

/** Our place picked online, kept so the phone can offer it again with no connection. */
export function knownFromPick(pick: Choice): KnownPlace | null {
  if (!pick.placeId) return null;
  return { id: pick.placeId, name: pick.name, address: pick.address, lat: pick.lat, lng: pick.lng };
}

/** The phone's own list, newest first, each place once, at most `max`. */
export function rememberPlace(list: readonly KnownPlace[], place: KnownPlace, max = 50): KnownPlace[] {
  return [place, ...list.filter((p) => p.id !== place.id)].slice(0, max);
}

/** Our places on the driver's own tasks (their stops carry the place's id): the phone has them already. */
export function knownFromTasks(tasks: readonly Pick<TaskWithStops, 'task_stops'>[]): KnownPlace[] {
  const out: KnownPlace[] = [];
  for (const task of tasks) {
    for (const s of task.task_stops) {
      if (s.place_id && !s.google_place_id) out.push({ id: s.place_id, name: s.place_name, address: s.address, lat: s.lat, lng: s.lng });
    }
  }
  return out;
}

/** The lists together, each place once (the first list wins). */
export function mergeKnown(...lists: readonly (readonly KnownPlace[])[]): KnownPlace[] {
  const seen = new Set<string>();
  const out: KnownPlace[] = [];
  for (const list of lists) {
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** The phone's places for the typed text with no connection: every word in the name, site id or address; names starting with the text first. */
export function offlineMatches(text: string, places: readonly KnownPlace[], limit = 8): KnownPlace[] {
  const typed = text.trim().toLowerCase();
  if (typed.length < SEARCH_MIN_CHARS) return [];
  const words = typed.split(/\s+/);
  const scored: { place: KnownPlace; score: number }[] = [];
  for (const place of places) {
    const name = place.name.toLowerCase();
    const hay = [name, place.site_id ?? '', place.address ?? ''].join(' ').toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const score = name.startsWith(typed) ? 0 : (place.site_id ?? '').toLowerCase().startsWith(typed) ? 1 : name.includes(typed) ? 2 : 3;
    scored.push({ place, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name)).slice(0, limit).map((s) => s.place);
}

// ---------------------------------------------------------------------------------------------------------------------
// The requests, the server's answer and the queue's ops
// ---------------------------------------------------------------------------------------------------------------------

/** POST /trips. */
export interface TripRequest {
  /** The phone's uuid: the task's id. */
  id: string;
  /** The phone's uuid for the first stop: the server keeps it, so Arrived and Done queued before the trip was sent land on it. */
  stop_id?: string;
  purpose: Purpose;
  destination: Destination;
  note?: string;
  /** The vehicle held on the phone (the server's default is the same; sent so a vehicle change still waiting in the queue does not matter). */
  vehicle_id?: string;
  /** When the driver pressed Start (an offline start is sent later). */
  at: string;
  /** Sent by the offline queue: the trip happened already, so the server notes its start-time rules instead of refusing. */
  queued?: boolean;
}

/** POST /trips/:taskId/stops. */
export interface StopRequest {
  /** The phone's uuid: the stop's id. */
  id: string;
  destination: Destination;
  /** Sent by the offline queue (see TripRequest.queued). */
  queued?: boolean;
}

export function tripRequest(input: { id: string; stopId?: string; purpose: Purpose; pick: Choice; note: string; vehicleId: string | null; at: string }): TripRequest {
  const note = clip(input.note, MAX_NOTE);
  return {
    id: input.id,
    ...(input.stopId ? { stop_id: input.stopId } : {}),
    purpose: input.purpose,
    destination: input.pick.destination,
    ...(note !== '' ? { note } : {}),
    ...(input.vehicleId ? { vehicle_id: input.vehicleId } : {}),
    at: input.at,
  };
}

export function stopRequest(id: string, pick: Choice): StopRequest {
  return { id, destination: pick.destination };
}

export interface TripCardStop {
  stop_id: string;
  seq: number;
  type: string;
  place: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  /** A Google place: never drawn on a map that is not Google's (lib/mapRule.ts). */
  google?: boolean;
  status: string;
}

export interface TripCard {
  task_id: string;
  title: string;
  kind: string;
  purpose: Purpose;
  status: string;
  vehicle_id: string;
  started_at: string;
  stops: TripCardStop[];
}

export interface TripAnswer {
  trip: TripCard;
  /** true when the same id was sent before (the queue resent it): nothing new was made. */
  repeated: boolean;
  personal_note?: string;
}

/** The server's answer to /trips and /trips/:id/stops, checked; null when it is not one. */
export function parseTripAnswer(body: unknown): TripAnswer | null {
  const b = (body ?? {}) as { trip?: Record<string, unknown>; repeated?: unknown; personal_note?: unknown };
  const t = b.trip;
  if (!t || typeof t.task_id !== 'string' || typeof t.vehicle_id !== 'string' || !Array.isArray(t.stops)) return null;
  const stops: TripCardStop[] = [];
  for (const raw of t.stops) {
    const s = (raw ?? {}) as Record<string, unknown>;
    if (typeof s.stop_id !== 'string' || typeof s.seq !== 'number') return null;
    stops.push({
      stop_id: s.stop_id,
      seq: s.seq,
      type: str(s.type) ?? 'visit',
      place: str(s.place) ?? '',
      place_id: str(s.place_id),
      lat: num(s.lat),
      lng: num(s.lng),
      google: s.google === true ? true : undefined,
      status: str(s.status) ?? 'pending',
    });
  }
  return {
    trip: {
      task_id: t.task_id,
      title: str(t.title) ?? '',
      kind: str(t.kind) ?? 'self',
      purpose: t.purpose === 'personal' ? 'personal' : 'company',
      status: str(t.status) ?? 'assigned',
      vehicle_id: t.vehicle_id,
      started_at: str(t.started_at) ?? '',
      stops: stops.sort((a, b) => a.seq - b.seq),
    },
    repeated: b.repeated === true,
    personal_note: str(b.personal_note),
  };
}

/** The queue's op for a trip started with no connection: sent before the Start task that follows it (queue order). */
export interface TripCreateOp {
  kind: 'trip_create';
  /** The trip's (the task's) id. */
  id: string;
  request: TripRequest;
  /** The id of the stop in the phone's copy: the server names the first stop itself, and the queue maps it on. */
  local_stop_id: string;
  /** Sent instead of our place when the server refuses it (see Choice.fallback). */
  fallback?: Destination;
}

/** The queue's op for a stop added on the way with no connection. */
export interface TripStopOp {
  kind: 'trip_stop';
  /** The stop's id (the server keeps the phone's). */
  id: string;
  task_id: string;
  destination: Destination;
  fallback?: Destination;
}

export function tripCreateOp(request: TripRequest, localStopId: string, pick: Choice): TripCreateOp {
  return { kind: 'trip_create', id: request.id, request, local_stop_id: localStopId, ...(pick.fallback ? { fallback: pick.fallback } : {}) };
}

export function tripStopOp(taskId: string, request: StopRequest, pick: Choice): TripStopOp {
  return { kind: 'trip_stop', id: request.id, task_id: taskId, destination: request.destination, ...(pick.fallback ? { fallback: pick.fallback } : {}) };
}

/**
 * What an HTTP status means for the phone: ok; refused (409: a rule, its words go on the screen); retry (no answer,
 * the token, too many calls or the server's own trouble: the same request later); failed (any other 4xx: sending it
 * again changes nothing).
 */
export type AnswerKind = 'ok' | 'refused' | 'retry' | 'failed';

export function answerKind(status: number): AnswerKind {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409) return 'refused';
  if (status === 0 || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';
  return 'failed';
}

/** The words of an error answer: a refusal's message, else its error code. */
export function errorWords(body: unknown, status: number): string {
  const b = (body ?? {}) as { message?: unknown; error?: unknown };
  return str(b.message) ?? str(b.error) ?? `HTTP ${status}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The phone's copy of a trip
// ---------------------------------------------------------------------------------------------------------------------

/** The trip's title as the server writes it ("Trip · Kadawatha", trips.ts tripTitle); the screens show "Your trip" instead. */
export function tripTitle(purpose: Purpose, place: string): string {
  return `${purpose === 'personal' ? 'Personal trip' : 'Trip'} · ${place}`.slice(0, 120);
}

/** A stop row of the phone's copy (a visit, pending). */
export function localStop(fields: {
  id: string;
  taskId: string;
  seq: number;
  name: string;
  placeId: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
}): TaskStop {
  return {
    id: fields.id,
    task_id: fields.taskId,
    seq: fields.seq,
    type: 'visit',
    status: 'pending',
    place_id: fields.placeId,
    place_name: fields.name,
    address: fields.address,
    lat: fields.lat,
    lng: fields.lng,
    google_place_id: fields.googlePlaceId,
    google_fetched_at: null,
    is_start: false,
    what: null,
    note: null,
    dwell_min: null,
    dwell_source: null,
    arrive_by: null,
    planned_arrive_at: null,
    planned_depart_at: null,
    arrived_at: null,
    done_at: null,
    skip_reason: null,
    skip_note: null,
    removed_at: null,
    auto_detected_at: null,
    arrival_flag: null,
    arrival_distance_m: null,
    arrival_lat: null,
    arrival_lng: null,
    arrival_at: null,
    arrival_accuracy_m: null,
    saved_place_id: null,
  };
}

/**
 * The phone's copy of a trip it just started: as the server makes it (kind self, assigned, already seen and
 * accepted, its leave-by its start, one visit), so Today, the task screen and Start task work before the server's row
 * arrives, and with no connection at all.
 */
export function localTrip(input: {
  request: TripRequest;
  pick: Choice;
  employeeId: string;
  employeeName: string;
  vehicleId: string;
  localStopId: string;
}): TaskWithStops {
  const { request, pick } = input;
  const at = request.at;
  return {
    id: request.id,
    kind: 'self',
    purpose: request.purpose,
    title: tripTitle(request.purpose, pick.name),
    label: null,
    employee_id: input.employeeId,
    vehicle_id: input.vehicleId,
    status: 'assigned',
    start_at: at,
    leave_by: at,
    leave_by_source: 'manual',
    end_by: null,
    sent_at: at,
    seen_at: at,
    accepted_at: at,
    started_at: null,
    completed_at: null,
    start_odometer_km: null,
    end_odometer_km: null,
    km: null,
    passengers: null,
    contact_name: null,
    contact_phone: null,
    notes: request.note ?? null,
    created_by: `driver: ${input.employeeName}`,
    created_at: at,
    updated_at: at,
    request_id: null,
    cancelled_reason: null,
    declined_at: null,
    declined_by: null,
    declined_reason: null,
    declined_note: null,
    declined_after_accept: false,
    accept_reminder_sent_at: at,
    reminder_30_sent_at: at,
    reminder_0_sent_at: at,
    assigned_by_employee_id: null,
    avoid_expressway: false,
    return_to_base: false,
    buffer_min: null,
    plan_json: null,
    plan_version: 1,
    warnings: null,
    finish_flag: null,
    needs_driver_reason: null,
    needs_driver_since: null,
    vehicle_choice: null,
    // Hotfix 2: a trip of the driver's own is in the vehicle they hold (never "on the day"); nobody approves it.
    vehicle_mode: 'specific',
    vehicle_type_wanted: null,
    approved_by_employee_id: null,
    approved_at: null,
    missed_at: null,
    late_report_min: null,
    late_report_at: null,
    start_place_id: null,
    start_name: null,
    start_lat: null,
    start_lng: null,
    start_google_place_id: null,
    start_google_fetched_at: null,
    task_stops: [
      localStop({
        id: input.localStopId,
        taskId: request.id,
        seq: 1,
        name: pick.name,
        placeId: pick.placeId,
        googlePlaceId: pick.googlePlaceId,
        lat: pick.lat,
        lng: pick.lng,
        address: pick.address,
      }),
    ],
    task_vehicle_segments: [],
  };
}

/** A Google stop the server answered without our copy knowing its id: still never drawn on the OpenFreeMap map. */
const GOOGLE_MARK = 'google';

/**
 * The server's answer merged into the phone's copy. The first stop of the trip gets the server's id (`localFirstStopId`
 * names it in the copy); a stop the answer lists that the copy lacks is added; the copy's own progress (status,
 * arrived, done) is kept, since the phone may be ahead of the answer. Stops the phone added that the answer does not
 * list yet stay.
 */
export function withCard(task: TaskWithStops, card: TripCard, localFirstStopId?: string | null): TaskWithStops {
  const first = card.stops[0];
  const byId = new Map(task.task_stops.map((s) => [s.id === localFirstStopId && first ? first.stop_id : s.id, s] as const));
  const merged: TaskStop[] = [];
  for (const cs of card.stops) {
    const mine = byId.get(cs.stop_id);
    byId.delete(cs.stop_id);
    const lat = cs.lat ?? mine?.lat ?? null;
    const lng = cs.lng ?? mine?.lng ?? null;
    const google = mine?.google_place_id ?? (cs.google ? GOOGLE_MARK : null);
    merged.push(
      mine
        ? { ...mine, id: cs.stop_id, seq: cs.seq, place_name: cs.place || mine.place_name, place_id: cs.place_id ?? mine.place_id, lat, lng, google_place_id: google }
        : {
          ...localStop({ id: cs.stop_id, taskId: card.task_id, seq: cs.seq, name: cs.place, placeId: cs.place_id ?? null, googlePlaceId: google, lat, lng, address: null }),
          status: cs.status,
        },
    );
  }
  // Stops added on the phone that the answer does not have yet (a queued "Add a stop").
  for (const rest of byId.values()) merged.push(rest);
  merged.sort((a, b) => a.seq - b.seq);
  return {
    ...task,
    title: card.title || task.title,
    kind: card.kind || task.kind,
    purpose: card.purpose,
    vehicle_id: card.vehicle_id,
    task_stops: merged,
  };
}

/** A stop added on the way, in the phone's copy: after the last one (the server numbers it the same way). */
export function withAddedStop(task: TaskWithStops, stopId: string, pick: Choice): TaskWithStops {
  if (task.task_stops.some((s) => s.id === stopId)) return task;
  const seq = task.task_stops.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
  const stop = localStop({ id: stopId, taskId: task.id, seq, name: pick.name, placeId: pick.placeId, googlePlaceId: pick.googlePlaceId, lat: pick.lat, lng: pick.lng, address: pick.address });
  return { ...task, task_stops: [...task.task_stops, stop].sort((a, b) => a.seq - b.seq) };
}

/**
 * The server's list after a refresh, with the trips this phone just made that the list does not have yet (the
 * refresh may have read the list a moment before the trip was made). `pending` loses the ids the list has now.
 */
export function keepLocalTrips(rows: TaskWithStops[], local: readonly TaskWithStops[], pending: Set<string>): TaskWithStops[] {
  const have = new Set(rows.map((r) => r.id));
  for (const id of [...pending]) if (have.has(id)) pending.delete(id);
  const missing = local.filter((t) => pending.has(t.id));
  return missing.length === 0 ? rows : [...rows, ...missing].sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export function isSelfTrip(task: Pick<TaskWithStops, 'kind'> | null | undefined): boolean {
  return task?.kind === 'self';
}

/** "Add a stop": a trip of the driver's own, under way, with room for another stop. */
export function canAddStop(task: Pick<TaskWithStops, 'kind' | 'status' | 'task_stops'>): boolean {
  return task.kind === 'self' && task.status === 'in_progress' && task.task_stops.filter((s) => s.status !== 'removed').length < MAX_STOPS;
}

/** The i18n key of a trip's purpose. */
export function purposeKey(purpose: string | null | undefined): 'trip.personal' | 'trip.company' {
  return purpose === 'personal' ? 'trip.personal' : 'trip.company';
}

/** Ids already mapped (the first stop of each trip sent from the queue): kept small. */
export function rememberStopId(map: Record<string, string>, localId: string, serverId: string, max = 200): Record<string, string> {
  const next: Record<string, string> = { ...map };
  delete next[localId];
  next[localId] = serverId;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) delete next[key];
  return next;
}
