// Round 50 (29 October 2026, phase8-plan.md §37.5): /m/ driver-lite, the rules of a self trip driven in a browser. Pure (no
// react-native): the drive page (app/office/my-trip/[id]/drive.tsx), the office's views of a web trip (Live's card, the
// route views' straight dashed line) and scripts/test-web-trip.ts read them; every word is a key (office.webTrip.*,
// office.selfDrive.*).
//
// The pattern is Zipcar's and Turo's trip flow for whoever drives (Start with the vehicle check and the odometer photo, each
// stop arrived and done, Finish with the odometer and the fuel), done in a browser that cannot track in the background:
// each action sends ONE position the browser gives at that moment (navigator.geolocation; without one the action still
// saves, "no position"), and the office sees the actions joined by straight dashed lines (Google Maps' straight line
// where no route is known), never a GPS line, never km from them.

import { MAX_LITRES, MAX_LKR, MIN_PROBLEM_PHOTOS, MAX_PROBLEM_PHOTOS, odometerReason, parseAmount, parseKm, type Side, type Words } from './myTripLogic';
import type { FleetError, LiveDriver, MyTripWeb, MyTripWebStop, ReportCategory, WebPoint, WebTripActionInput, WebTripActionKind } from './types';

export type { Words };

// ---- What comes next ---------------------------------------------------------------------------------------------------

export type WebStep =
  | { kind: 'start' }
  | { kind: 'arrive'; stop: MyTripWebStop }
  | { kind: 'leave'; stop: MyTripWebStop }
  | { kind: 'finish' }
  | { kind: 'done' }
  /** The trip is driven in the Fame Fleet app (another phone, or this person's own app). */
  | { kind: 'inApp' }
  /** Not offered here (self_drive_mode off, not the person's trip, cancelled…): the server's sentence in `why`. */
  | { kind: 'closed'; why?: string };

/**
 * The one job of the page now: Start until the trip is started; then the first stop arrived but not done (its Done slide),
 * else the first stop still to do (its Arrived slide); then Finish. A trip already finished is done; one started in the app
 * is the app's.
 */
export function webStep(web: MyTripWeb | null | undefined, finished = false): WebStep {
  if (finished) return { kind: 'done' };
  if (!web) return { kind: 'closed' };
  if (web.driven_in === 'app') return { kind: 'inApp' };
  if (!web.allowed) return { kind: 'closed', why: web.why };
  if (!web.started) return { kind: 'start' };
  const stops = [...web.stops].sort((a, b) => a.n - b.n);
  const here = stops.find((s) => s.status === 'arrived');
  if (here) return { kind: 'leave', stop: here };
  const next = stops.find((s) => s.status === 'pending');
  if (next) return { kind: 'arrive', stop: next };
  return { kind: 'finish' };
}

/** The stops still to do once started (pending or arrived): Finish now leaves them as not visited. */
export const stopsLeft = (web: Pick<MyTripWeb, 'stops'>): number => web.stops.filter((s) => s.status === 'pending' || s.status === 'arrived').length;

/**
 * Whether an action may be sent now (the server refuses the wrong order too): start before anything; arrive at the next
 * pending stop only, and only when no stop is still open; leave the stop arrived at; finish any time after the start (the
 * stops not reached are left as not visited, as the driver app's Save & finish does).
 */
export function actionAllowed(web: MyTripWeb | null | undefined, action: WebTripActionKind, stopId?: string): boolean {
  const step = webStep(web);
  if (step.kind === 'start') return action === 'start';
  if (step.kind === 'arrive') return (action === 'arrive' && stopId === step.stop.id) || action === 'finish';
  if (step.kind === 'leave') return (action === 'leave' && stopId === step.stop.id) || action === 'finish';
  if (step.kind === 'finish') return action === 'finish';
  return false;
}

/** The trip page's offer: "Drive this trip here" only in a browser and only when my_trip says this trip may be driven here. */
export const offerWebDrive = (platform: string, web: MyTripWeb | null | undefined): boolean =>
  platform === 'web' && !!web && web.allowed && web.driven_in !== 'app';

// ---- One position per action ---------------------------------------------------------------------------------------------

/** What the browser answered when asked for one position. */
export type PositionResult =
  | { ok: true; lat: number; lng: number; accuracy_m?: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };

/** How long the page waits for the browser's one position before saving without it. */
export const POSITION_TIMEOUT_MS = 10_000;
/** A position this old is still taken (the browser may answer from its last fix). */
export const POSITION_MAX_AGE_MS = 30_000;

/** The browser's error code (GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout) in our words. */
export function positionFailure(code: number | undefined): Extract<PositionResult, { ok: false }>['reason'] {
  return code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable';
}

/** The tool's `position` from the browser's answer: absent without a usable one (the action is saved with no position). */
export function positionInput(p: PositionResult | null | undefined): WebTripActionInput['position'] | undefined {
  if (!p || !p.ok) return undefined;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return undefined;
  const accuracy = typeof p.accuracy_m === 'number' && Number.isFinite(p.accuracy_m) && p.accuracy_m >= 0 ? Math.round(p.accuracy_m) : undefined;
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6, ...(accuracy !== undefined ? { accuracy_m: accuracy } : {}) };
}

/** The line after an action saved without a position (null when it had one). */
export function noPositionWords(p: PositionResult | null | undefined): Words | null {
  if (positionInput(p)) return null;
  const reason = p && !p.ok ? p.reason : 'unavailable';
  return { key: `office.webTrip.noPosition.${reason}` };
}

// ---- One client id per action (a retry never doubles) ---------------------------------------------------------------------

/** The action's key: one id per start, per stop's arrive and leave, per finish. */
export const actionKey = (action: WebTripActionKind, stopId?: string): string => (action === 'arrive' || action === 'leave' ? `${action}:${stopId ?? ''}` : action);

/** The id for an action: the one already made for it (Try again sends the same), else a new one from `make`. */
export function clientIdFor(ids: Readonly<Record<string, string>>, key: string, make: () => string): { id: string; ids: Record<string, string> } {
  const have = ids[key];
  if (have) return { id: have, ids: { ...ids } };
  const id = make();
  return { id, ids: { ...ids, [key]: id } };
}

/**
 * After a failed send: the same id stays for Try again when the action may have been saved (no answer: a dropped
 * connection, a time-out, a server error), so a repeat never doubles it; a refusal (the server said no: 409, bad input,
 * no permission) drops it, so the corrected action (another odometer reading) is a new one.
 */
export function idsAfterFailure(ids: Readonly<Record<string, string>>, key: string, error: Pick<FleetError, 'code'>): Record<string, string> {
  const refused = error.code === 'tool_error' || error.code === 'bad_input' || error.code === 'forbidden' || error.code === 'no_such_tool';
  if (!refused) return { ...ids };
  const next = { ...ids };
  delete next[key];
  return next;
}

// ---- No connection: refused at once (no queue on the web) ----------------------------------------------------------------

/** The error a browser that says it is offline gets before anything is sent: "No connection" with Try again. */
export const OFFLINE: FleetError = { code: 'network', message: 'No connection to Fame Fleet.', write: true };

/** True when the browser says it has no connection (navigator.onLine false); unknown = try. */
export const browserOffline = (online: boolean | undefined): boolean => online === false;

// ---- The fuel card's estimate (the server's English, read back into the person's language) ---------------------------------

/**
 * "About 180 km · roughly 13–17 L diesel (approx.)" / "About 60 km · check the battery" in the person's language (the
 * office.fuel.* words, `fuel` the key of the fuel's word); any other text as it came.
 */
export function fuelEstimateWords(text: string | null | undefined): (Words & { fuel?: string }) | { text: string } | null {
  if (!text) return null;
  let m = /^About ([\d,.]+) km · roughly ([\d.–-]+) L (petrol|diesel|fuel) \(approx\.\)$/.exec(text);
  if (m) return { key: 'office.fuel.estimate', vars: { km: m[1], litres: m[2] }, fuel: `office.fuel.word_${m[3]}` };
  m = /^About ([\d,.]+) km · check the battery$/.exec(text);
  if (m) return { key: 'office.fuel.estimateElectric', vars: { km: m[1] } };
  return { text };
}

// ---- Start ---------------------------------------------------------------------------------------------------------------

export interface StartForm {
  /** The check's answer when check_needed (null = not answered yet). */
  check: 'ok' | 'problem' | null;
  category: ReportCategory | '';
  note: string;
  /** The problem's photos already up (their ids). */
  photos: string[];
  /** The sides of an all-good check, optional. */
  sides: { photo_id: string; side: Side }[];
  /** The fuel card's answer when it asks (null = not answered yet). */
  fuel: 'enough' | 'fill_on_way' | null;
  /** The odometer photo's id (required), and the reading typed. */
  odoPhoto: string | null;
  odometer: string;
  uploading: number;
}

export const emptyStart = (web: Pick<MyTripWeb, 'last_km'>): StartForm => ({
  check: null,
  category: '',
  note: '',
  photos: [],
  sides: [],
  fuel: null,
  odoPhoto: null,
  odometer: web.last_km != null ? String(web.last_km) : '',
  uploading: 0,
});

/** Why Start trip is not ready (null = ready). */
export function startReason(web: Pick<MyTripWeb, 'check_needed' | 'fuel_card' | 'last_km'>, f: StartForm): Words | null {
  if (web.check_needed) {
    if (!f.check) return { key: 'office.webTrip.why.check' };
    if (f.check === 'problem') {
      if (!f.category) return { key: 'office.myTrip.why.category' };
      if (f.photos.length < MIN_PROBLEM_PHOTOS && f.uploading === 0) return { key: 'office.myTrip.why.photo' };
    }
  }
  if (web.fuel_card?.asked && !f.fuel) return { key: 'office.webTrip.why.fuel' };
  if (f.uploading > 0) return { key: 'office.myTrip.why.uploading' };
  if (!f.odoPhoto) return { key: 'office.webTrip.why.odoPhoto' };
  return odometerReason(f.odometer, web.last_km, 'last');
}

/** web_trip_action's start input. */
export function startInput(taskId: string, clientId: string, web: Pick<MyTripWeb, 'check_needed' | 'fuel_card'>, f: StartForm, position?: WebTripActionInput['position']): WebTripActionInput {
  const note = f.note.trim();
  const check: WebTripActionInput['check'] | undefined = !web.check_needed || !f.check
    ? undefined
    : f.check === 'problem'
      ? { result: 'problem', category: f.category || 'other', ...(note ? { note } : {}), photos: f.photos.slice(0, MAX_PROBLEM_PHOTOS) }
      : { result: 'ok', ...(f.sides.length ? { sides: f.sides } : {}) };
  return {
    task_id: taskId,
    client_id: clientId,
    action: 'start',
    ...(position ? { position } : {}),
    odometer_km: parseKm(f.odometer) ?? 0,
    ...(f.odoPhoto ? { odometer_photo_id: f.odoPhoto } : {}),
    ...(check ? { check } : {}),
    ...(web.fuel_card?.asked && f.fuel ? { fuel_answer: f.fuel } : {}),
  };
}

// ---- A stop ---------------------------------------------------------------------------------------------------------------

export function stopInput(taskId: string, clientId: string, action: 'arrive' | 'leave', stopId: string, position?: WebTripActionInput['position']): WebTripActionInput {
  return { task_id: taskId, client_id: clientId, action, stop_id: stopId, ...(position ? { position } : {}) };
}

// ---- Finish ---------------------------------------------------------------------------------------------------------------

export interface WebFinishForm {
  odoPhoto: string | null;
  odometer: string;
  litres: string;
  lkr: string;
  receipt: string | null;
  uploading: number;
}

export const emptyWebFinish = (): WebFinishForm => ({ odoPhoto: null, odometer: '', litres: '', lkr: '', receipt: null, uploading: 0 });

/** Why Finish trip is not ready (null = ready): the photo and the reading (never under the start), the fuel when typed. */
export function webFinishReason(start: number | null | undefined, f: WebFinishForm): Words | null {
  if (f.uploading > 0) return { key: 'office.myTrip.why.uploading' };
  if (!f.odoPhoto) return { key: 'office.webTrip.why.odoPhoto' };
  const odo = odometerReason(f.odometer, start, 'start');
  if (odo) return odo;
  const litres = parseAmount(f.litres);
  const lkr = parseAmount(f.lkr);
  if (litres === null || (typeof litres === 'number' && (litres <= 0 || litres > MAX_LITRES))) return { key: 'office.myTrip.why.litres', vars: { max: MAX_LITRES } };
  if (lkr === null || (typeof lkr === 'number' && lkr > MAX_LKR)) return { key: 'office.myTrip.why.amount', vars: { max: MAX_LKR.toLocaleString('en-US') } };
  // An amount or a receipt needs the litres (the fill is litres first, as in the driver app's fuel form).
  if (litres === '' && (lkr !== '' || f.receipt)) return { key: 'office.webTrip.why.litresFirst' };
  return null;
}

/** The km as typed so far (null until the reading is at or over the start). */
export function webKm(start: number | null | undefined, odometer: string): number | null {
  const end = parseKm(odometer);
  return start != null && end != null && end >= start ? end - start : null;
}

/** web_trip_action's finish input (the fuel only when litres are typed). */
export function webFinishInput(taskId: string, clientId: string, f: WebFinishForm, position?: WebTripActionInput['position']): WebTripActionInput {
  const litres = parseAmount(f.litres);
  const lkr = parseAmount(f.lkr);
  return {
    task_id: taskId,
    client_id: clientId,
    action: 'finish',
    ...(position ? { position } : {}),
    odometer_km: parseKm(f.odometer) ?? 0,
    ...(f.odoPhoto ? { odometer_photo_id: f.odoPhoto } : {}),
    ...(typeof litres === 'number'
      ? { fuel: { litres, ...(typeof lkr === 'number' ? { lkr } : {}), ...(f.receipt ? { receipt_photo_id: f.receipt } : {}) } }
      : {}),
  };
}

// ---- The words after an action ----------------------------------------------------------------------------------------

/** The snackbar after a saved action: "Trip started", "Arrived at Kurunegala site · 10:42", "Trip finished · 42 km". */
export function doneWords(action: WebTripActionKind, r: { stop?: { at: string }; km?: number }, place?: string): Words {
  switch (action) {
    case 'start':
      return { key: 'office.webTrip.done.started' };
    case 'arrive':
      return { key: 'office.webTrip.done.arrived', vars: { place: place ?? '', time: r.stop?.at ?? '' } };
    case 'leave':
      return { key: 'office.webTrip.done.left', vars: { place: place ?? '', time: r.stop?.at ?? '' } };
    default:
      return r.km != null ? { key: 'office.webTrip.done.finished', vars: { km: r.km.toLocaleString('en-US') } } : { key: 'office.webTrip.done.finishedNoKm' };
  }
}

// ---- The office's views of a web trip ----------------------------------------------------------------------------------

/** A self trip driven with the app or on the web: the driver card says "Self-drive" (not "Drives themselves · no app"). */
export function isSelfDriveTrip(t: { driven_by?: string; self_drive?: boolean; driven_in?: string | null }): boolean {
  if (t.driven_in === 'app' || t.driven_in === 'web') return true;
  if (t.driven_in === 'office') return false;
  return t.self_drive === true;
}

/** Live's line for a web trip: "Web trip · last seen at Kurunegala site 10:42" (never the Live state). */
export function webTripSeenWords(d: Pick<LiveDriver, 'web_trip' | 'last_seen'>): Words | null {
  if (!d.web_trip) return null;
  const at = d.last_seen?.at;
  if (!at) return { key: 'office.selfDrive.webTripNone' };
  return d.last_seen?.stop ? { key: 'office.selfDrive.webTripAt', vars: { stop: d.last_seen.stop, time: at } } : { key: 'office.selfDrive.webTripSeen', vars: { time: at } };
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** The web trip's positions in time order (the usable ones). */
export function webPointsInOrder(points: readonly WebPoint[] | null | undefined): WebPoint[] {
  return (points ?? [])
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .map((p, i) => ({ p, i, at: Date.parse(p.at) }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.i - b.i))
    .map((x) => x.p);
}

/**
 * The straight dashed line of a web trip (Google Maps' straight line where no route is known): one line through the
 * actions' positions in time order, two points or more; a repeat of the same place is drawn once. Never km.
 */
export function webLinePoints(points: readonly WebPoint[] | null | undefined): LatLng[] {
  const out: LatLng[] = [];
  for (const p of webPointsInOrder(points)) {
    const last = out[out.length - 1];
    if (last && last.lat === p.lat && last.lng === p.lng) continue;
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out.length >= 2 ? out : [];
}

/** A web action's mark on the map: "Started · 07:42", "Arrived · Kurunegala site · 10:42", "Left · …", "Finished · 16:31". */
export function webMarkWords(p: Pick<WebPoint, 'action' | 'stop' | 'time'>): Words {
  const key = `office.selfDrive.mark.${p.action}`;
  return p.stop && (p.action === 'arrive' || p.action === 'leave') ? { key: `${key}At`, vars: { stop: p.stop, time: p.time } } : { key, vars: { time: p.time } };
}

/** The marks of a web trip with their words (their own keys, so they never mix with the GPS stops). */
export function webMarks(points: readonly WebPoint[] | null | undefined): (LatLng & { key: string; time: string; action: WebTripActionKind; words: Words })[] {
  return webPointsInOrder(points).map((p, i) => ({ key: `web:${i}:${p.at}`, lat: p.lat, lng: p.lng, time: p.time, action: p.action, words: webMarkWords(p) }));
}

/** True when the route answer is a web trip with something to draw. */
export const hasWebTrip = (r: { web_trip?: boolean; web_points?: readonly WebPoint[] } | null | undefined): boolean => !!r && (r.web_trip === true || (r.web_points?.length ?? 0) > 0) && webPointsInOrder(r.web_points).length > 0;
