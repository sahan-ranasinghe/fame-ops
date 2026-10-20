// Office mode (Stage 1, O3 item 3c–f): Task detail's additions from task_detail, the rules only (the site's TaskDetail,
// taskDetailLogic, StopArrival and TripPurpose). Pure: no react-native; the words come through `t`.
//   - charged to (the projects; a personal trip is never charged), the unlogged km, the warnings saved past;
//   - the odometer readings and the fuel fills (their photo links, the fill's video state and pieces: Reports → Fuel's
//     rules in office/manageLogic.ts), the problems reported, the history (assignment_history with its changes);
//   - the vehicle swap's stretches and the reading still owed (swap_reading);
//   - a reached Google stop saved as one of our places (save_arrival_place: our own name, never Google's);
//   - a driver-started trip's purpose and project (set_trip_purpose);
//   - the plan on the task map (task_detail with with_line, shaped as the map's task: components/TaskMap.tsx).

import type { TaskWithStops } from '@/lib/types';
import { videoPieces } from './manageLogic';
import { parseKm } from './taskExtrasLogic';
import { isoOn } from './trip/planMap';
import type { AssignmentEvent, OdometerRead, ProjectShare, Stop, TaskDetail, TaskSegment, TimelineItem, TripPurpose, TripPurposeResult } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

const n = (x: number) => x.toLocaleString('en-US');

/** A link the phone may open (the server's signed links; a note such as "photo not uploaded yet" is not one). */
export const isLink = (u: string | null | undefined): u is string => typeof u === 'string' && /^https:\/\//.test(u);

/** The task_detail answer read over this long ago is read again before a photo link opens (the links last an hour). */
export const DETAIL_LINKS_FRESH_MS = 50 * 60_000;

// ---------------------------------------------------------------------------
// Charged to, the unlogged km, the warnings
// ---------------------------------------------------------------------------

/** "TRKAN1 · 60%, Mobitel MS · 40%"; a personal trip is never charged to a job; nothing = Fame internal. */
export function chargedTo(p: Pick<TaskDetail, 'projects'> & { task: Pick<TaskDetail['task'], 'purpose'> }, t: Words): string {
  if (p.task.purpose === 'personal') return t('office.task.chargedPersonal');
  const list = typeof p.projects === 'string'
    ? p.projects.trim()
    : (p.projects as ProjectShare[]).map((x) => [x.project, x.percent != null ? `${x.percent}%` : ''].filter(Boolean).join(' · ')).join(', ');
  return list || t('office.task.chargedInternal');
}

/** "62 km were driven before this task that nobody logged (last reading …)", or null. */
export function unloggedText(p: Pick<TaskDetail, 'unlogged_km'>, t: Words): string | null {
  const u = p.unlogged_km;
  if (!u) return null;
  return t('office.task.unlogged', { km: n(u.km), last: n(u.last_logged_km), at: u.last_logged_at, start: n(u.start_km) });
}

// ---------------------------------------------------------------------------
// Odometer, fuel, problems
// ---------------------------------------------------------------------------

const ODO_KINDS = ['task_start', 'task_end', 'manual'];
const FLAGS = ['photo_changed', 'typed_unreadable', 'ai_differs', 'ai_failed'];

/** A reading's lines: "45,210 km", "Task start · 2026-10-20 08:10 · <the server's check> · photo shows 45,212"; its flag. */
export function odometerParts(o: OdometerRead, t: Words): { title: string; line: string; flag: string | null; photo: string | null } {
  const kind = ODO_KINDS.includes(o.kind) ? t(`office.task.odo_${o.kind}`) : o.kind;
  return {
    title: `${n(o.reading_km)} km`,
    line: [kind, o.at, o.check ?? '', o.photo_reading != null ? t('office.task.photoShows', { km: n(o.photo_reading) }) : ''].filter(Boolean).join(' · '),
    flag: o.flag ? (FLAGS.includes(o.flag) ? t(`office.task.flag_${o.flag}`) : o.flag) : null,
    photo: isLink(o.photo) ? o.photo : null,
  };
}

/** "32.5 L · LKR 12,000" (the litres may be unknown). */
export function fuelTitle(f: { litres: number | null; amount_lkr: number }, t: Words): string {
  return f.litres != null ? t('office.task.fuelLine', { litres: n(f.litres), lkr: n(f.amount_lkr) }) : `LKR ${n(f.amount_lkr)}`;
}

const REPORT_CATEGORIES = ['breakdown', 'accident', 'tyre', 'warning_light', 'other'];
const REPORT_STATUSES = ['open', 'in_garage', 'closed'];

/** A problem's words: the category and status in the driver app's own words (report.*), else as they came. */
export function reportWords(r: { category: string; status: string }, t: Words): { category: string; status: string } {
  return {
    category: REPORT_CATEGORIES.includes(r.category) ? t(`report.${r.category}`) : r.category,
    status: REPORT_STATUSES.includes(r.status) ? t(`report.${r.status}`) : r.status,
  };
}

/** Which link a tap asked for, so it can be found again in a fresh answer (a stale answer is read again first). */
export type LinkKey =
  | { kind: 'odo'; i: number }
  | { kind: 'receipt'; i: number }
  | { kind: 'video'; i: number; n: number }
  | { kind: 'report'; i: number; k: number };

/** The link a key names in this answer, or null when it is no longer there. */
export function linkOf(p: Pick<TaskDetail, 'odometer' | 'fuel' | 'vehicle_reports'>, key: LinkKey): string | null {
  switch (key.kind) {
    case 'odo':
      return isLink(p.odometer[key.i]?.photo) ? p.odometer[key.i].photo ?? null : null;
    case 'receipt':
      return isLink(p.fuel[key.i]?.receipt_photo) ? p.fuel[key.i].receipt_photo ?? null : null;
    case 'video': {
      const v = p.fuel[key.i]?.video;
      return v ? videoPieces(v).find((x) => x.n === key.n)?.url ?? null : null;
    }
    case 'report': {
      const u = p.vehicle_reports[key.i]?.photos?.[key.k];
      return isLink(u) ? u : null;
    }
  }
}

// ---------------------------------------------------------------------------
// The history
// ---------------------------------------------------------------------------

const ACTIONS = ['assigned', 'accepted', 'declined', 'reassigned', 'cancelled', 'changed', 'reopened', 'stop_skipped', 'running_late'];

/**
 * One event: "Reassigned · Kamal Perera · WP CAB-4521 · by Palitha" with its note, and the changes as their own lines
 * ("time 09:00 → 09:30"). A reopen reads "Reopened · by Sahan · wrong reading" (the reason is its note).
 */
export function historyParts(e: AssignmentEvent, t: Words): { at: string; title: string; changes: string[] } {
  const action = ACTIONS.includes(e.action) ? t(`office.task.ev_${e.action}`) : e.action;
  const title = [action, e.driver, e.vehicle, e.actor ? t('office.task.evBy', { name: e.actor }) : '', e.changes ? '' : e.note ?? ''].filter(Boolean).join(' · ');
  const changes = Object.entries(e.changes ?? {}).map(([k, c]) => `${k} ${c.from ?? '—'} → ${c.to ?? '—'}`);
  return { at: e.at, title, changes };
}

// ---------------------------------------------------------------------------
// The vehicle swap: the stretches, their total, the reading still owed
// ---------------------------------------------------------------------------

export interface SegmentRow {
  vehicle: string;
  /** "08:10–10:42", or "from 10:42" while it runs. */
  window: string;
  /** "45,210 km → 45,262 km", "45,210 km → end to come", "start to come → in use now". */
  readings: string;
  /** "52 km", or "" while a reading is missing. */
  km: string;
  waiting: boolean;
  /** "Breakdown near Kurunegala · by Palitha" */
  why: string;
  /** The reading the office may type (swap_reading): the new vehicle's start, or the old one's end; null when none is owed. */
  need: 'start' | 'end' | null;
}

const plate = (v?: string) => (v ?? '').split(' · ')[0];

/** One row per vehicle's stretch of the task, in order (the site's segmentRows; the reading owed as its SwapReadingForm). */
export function segmentRows(segments: readonly TaskSegment[] | undefined | null, t: Words): SegmentRow[] {
  return (segments ?? []).map((g, i) => {
    const start = g.start_km != null ? `${n(g.start_km)} km` : t('office.task.segStartToCome');
    const end = g.end_km != null ? `${n(g.end_km)} km` : g.to ? t('office.task.segEndToCome') : t('office.task.segInUse');
    const needStart = i > 0 && g.start_km == null;
    const needEnd = !!g.to && g.end_km == null;
    return {
      vehicle: plate(g.vehicle),
      window: g.to ? `${g.from}–${g.to}` : t('office.task.segFrom', { time: g.from }),
      readings: `${start} → ${end}`,
      km: g.km != null ? `${n(g.km)} km` : '',
      waiting: !!g.readings_waiting,
      why: [g.reason ?? '', g.by ? t('office.task.evBy', { name: g.by }) : ''].filter(Boolean).join(' · '),
      need: g.readings_waiting && g.vehicle ? (needStart ? 'start' : needEnd ? 'end' : null) : null,
    };
  });
}

/** The swap's total: "Total 52 + 31 = 83 km", "52 km so far · a reading is still to come", or that none came yet. */
export function segmentsTotal(segments: readonly TaskSegment[] | undefined | null, t: Words): string {
  const list = segments ?? [];
  const known = list.filter((g) => g.km != null).map((g) => g.km as number);
  const km = known.reduce((a, b) => a + b, 0);
  const complete = list.length > 0 && known.length === list.length && !list.some((g) => g.readings_waiting);
  const sum = known.length > 1 ? `${known.map(n).join(' + ')} = ${n(km)} km` : `${n(km)} km`;
  if (complete) return t('office.task.segTotal', { sum });
  return known.length ? t('office.task.segSoFar', { sum }) : t('office.task.segWaiting');
}

/** swap_reading's input: one reading, whole km (required here: an empty field is not sent), or why not. */
export function swapReadingInput(taskId: string, vehicle: string, need: 'start' | 'end', text: string): { error: string } | { input: Record<string, unknown> } {
  const r = parseKm(text);
  if ('error' in r) return { error: r.error };
  if (r.km === undefined) return { error: 'number' };
  return { input: { task_id: taskId, vehicle, ...(need === 'end' ? { end_km: r.km } : { start_km: r.km }) } };
}

// ---------------------------------------------------------------------------
// A reached Google stop saved as one of our places
// ---------------------------------------------------------------------------

export const PLACE_KINDS = ['other', 'office', 'store', 'site'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** Where the driver's phone was when the stop was reached: "arrived 10:42 · near Kandy · phone ±12 m", the map link. */
export function arrivalParts(s: Pick<Stop, 'arrival'>, t: Words): { line: string; maps: string | null } | null {
  const a = s.arrival;
  if (!a) return null;
  return {
    line: [
      a.at ? t('office.task.arrivalAt', { time: a.at }) : t('office.task.arrivalPoint'),
      a.near ? t('office.live.near', { town: a.near }) : '',
      a.accuracy_m != null ? t('office.task.arrivalAccuracy', { m: Math.round(a.accuracy_m) }) : '',
    ].filter(Boolean).join(' · '),
    maps: isLink(a.maps) ? a.maps : null,
  };
}

/** Save as our place: a reached Google stop with its id and the arrival point, not saved yet, for someone with the tool. */
export const canSaveArrival = (s: Pick<Stop, 'id' | 'google' | 'arrival' | 'saved_place'>, tools: readonly string[]): boolean =>
  !!s.id && !!s.google && !!s.arrival && !s.saved_place && tools.includes('save_arrival_place');

/** save_arrival_place's input: our own name (2–120 characters) and the kind, or why not. */
export function arrivalPlaceInput(stopId: string, name: string, kind: PlaceKind): { error: 'name' } | { input: { stop_id: string; name: string; kind: PlaceKind } } {
  const typed = name.trim();
  if (typed.length < 2 || typed.length > 120) return { error: 'name' };
  return { input: { stop_id: stopId, name: typed, kind } };
}

// ---------------------------------------------------------------------------
// A driver-started trip: company work or personal, and its project
// ---------------------------------------------------------------------------

/**
 * set_trip_purpose's input, or why not: a personal trip takes no project (the server says the same); nothing changed
 * (the same purpose and no project typed) is not sent.
 */
export function purposeInput(taskId: string, was: TripPurpose | undefined, purpose: TripPurpose, project: string): { error: 'personalProject' | 'nothing' } | { input: { task_id: string; purpose: TripPurpose; project?: string } } {
  const p = project.trim();
  if (p && purpose === 'personal') return { error: 'personalProject' };
  if (!p && purpose === (was ?? 'company')) return { error: 'nothing' };
  return { input: { task_id: taskId, purpose, ...(p ? { project: p } : {}) } };
}

/** The line after a save: "Now personal: its km are counted apart from the jobs." / "Now company work · charged to TRKAN1". */
export function purposeDoneText(r: TripPurposeResult, t: Words): string {
  if (r.purpose === 'personal') return t('office.task.purposeNowPersonal');
  return [t(r.was === 'personal' ? 'office.task.purposeNowCompany' : 'office.task.purpose_company'), r.project ? t('office.task.purposeCharged', { project: r.project }) : ''].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// The plan on the task map
// ---------------------------------------------------------------------------

/** The seq of the stop numbered n (the timeline names stops by their number). */
function seqOfN(stops: readonly Stop[], num: number): number {
  const s = stops.find((x) => x.n === num) ?? stops[num - 1];
  return s ? s.seq : num;
}

/**
 * The task as the task map reads it (components/TaskMap.tsx; the same shape as the trip editor's preview,
 * office/trip/planMap.ts): its stops still in the plan (removed ones left out) with their pins, status and planned times,
 * the legs with their road lines (with_line: Google's line drawn on Google's map only), and the start's pin.
 */
export function detailTask(p: TaskDetail): TaskWithStops {
  const task = p.task;
  const date = task.date ?? '';
  const stops = p.stops.filter((s) => s.status !== 'removed');
  const taskStops = stops.map((s, i) => ({
    id: s.id ?? `detail-${s.seq}`,
    task_id: task.id,
    seq: s.seq,
    type: s.type,
    what: s.what ?? null,
    place_id: s.place_id ?? null,
    place_name: s.place ?? s.address ?? '',
    address: s.address ?? null,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    status: s.status,
    arrive_by: isoOn(date, s.arrive_by),
    planned_arrive_at: isoOn(date, s.planned_arrive),
    planned_depart_at: isoOn(date, s.planned_depart ?? s.planned_leave),
    is_start: s.is_start === true,
    google_place_id: s.google ? s.google_place_id ?? `detail-google-${i}` : null,
  }));
  const legs = (p.timeline?.items ?? []).flatMap((it: TimelineItem) =>
    it.kind === 'leg'
      ? [{
        from_seq: it.from_n === 'start' ? 0 : seqOfN(stops, it.from_n),
        to_seq: it.to_n === 'base' ? -1 : seqOfN(stops, it.to_n),
        km: it.km,
        line: it.line ?? null,
        source: it.source,
      }]
      : []);
  // leave_by is "Mon 20 Oct 07:24": its clock; else the task's start time.
  const lb = task.leave_by?.slice(-5);
  const leave = lb && /^\d{2}:\d{2}$/.test(lb) ? lb : task.time;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    start_at: isoOn(date, leave),
    leave_by: isoOn(date, leave),
    start_name: task.start_place ?? null,
    start_lat: task.start_lat ?? null,
    start_lng: task.start_lng ?? null,
    start_google_place_id: task.start_google_place_id ?? null,
    return_to_base: task.return_to_base === true,
    plan_json: { legs },
    task_stops: taskStops,
  } as unknown as TaskWithStops;
}

/** The map is worth showing: a pin (a stop's or the start's) to draw. */
export const planDrawable = (p: TaskDetail): boolean =>
  (typeof p.task.start_lat === 'number' && typeof p.task.start_lng === 'number') || p.stops.some((s) => s.status !== 'removed' && typeof s.lat === 'number' && typeof s.lng === 'number');
