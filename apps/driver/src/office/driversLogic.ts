// Office mode (Phase 8, O2): the Drivers board (design 12) and a driver's page, the pure rules, tested in
// scripts/test-drivers.ts: the chips in the design's order, the two lines under a driver's name and their pill from the
// board's row, the week (the next 7 days as a grid per driver from the not-available entries), the set_unavailability
// input and its checks, and the day's route for the map: the line's points read by column name, cut into legs coloured by
// speed band (standing / under 20 / 20–60 / over 60 km/h) with the holes dashed, the estimated road legs, the stops over
// 10 minutes as circles with their times, the frame around it all and the frame of one timeline row. Pure: no React, no
// native module; the words come through `t`.

import { type Frame, frameOf, type LatLng } from '../components/taskMapLogic';
import type { FilterDef, FilterValues } from '../lib/patterns/filterLogic';
import { addDays } from '../lib/time';
import { sentenceText } from './statusWords';
import type { BoardDriver, BoardFilter, DriverRoute, RouteSegment, UnavailableEntry, UnavailablePart, UnavailableReason } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

export const BOARD_FILTERS: readonly BoardFilter[] = ['all', 'free_now', 'on_task', 'off_duty', 'not_available'];

/** The Filter sheet's one section (Now only): drivers_board's own `filter`, with the server's counts beside each choice. */
export function boardFilterDefs(counts: Partial<Record<BoardFilter, number>> | undefined, tr: (key: string) => string): FilterDef[] {
  return [{
    key: 'filter',
    label: tr('office.drivers.filterLabel'),
    kind: 'single',
    default: 'all',
    options: BOARD_FILTERS.map((k) => ({ value: k, label: tr(`office.drivers.filter.${k}`), ...(counts?.[k] !== undefined ? { count: counts[k] } : {}) })),
  }];
}

export const boardChoice = (values: FilterValues): BoardFilter =>
  ((BOARD_FILTERS as readonly unknown[]).includes(values.filter) ? values.filter : 'all') as BoardFilter;

/**
 * drivers_board's input: Now with the filter chosen, Week every driver (no filter); the words searched for (the tool's
 * own `search`: the name, the username, the plate) only when there are any.
 */
export function boardArgs(view: 'now' | 'attendance' | 'week', filter: BoardFilter, search = ''): Record<string, unknown> {
  const words = search.trim();
  return { ...(view === 'now' ? { filter } : {}), ...(words ? { search: words } : {}) };
}

/**
 * Round 2b: Today's attendance (for the coordinators; the site's boardLogic has the same rules): every driver in four groups
 * in this order, each row's words from the day's duty sessions.
 */
export const ATTENDANCE_STATES = ['on_duty', 'not_started', 'finished', 'on_leave'] as const;
export type AttendanceState = typeof ATTENDANCE_STATES[number];
export const attendanceOf = (d: Pick<BoardDriver, 'attendance'>): AttendanceState => d.attendance?.state ?? 'not_started';

export function attendanceLine(d: Pick<BoardDriver, 'attendance' | 'usual_start'>, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const a = d.attendance;
  switch (attendanceOf(d)) {
    case 'on_duty':
      return a?.started ? t('office.attendance.started', { time: a.started }) : t('office.attendance.on_duty');
    case 'finished':
      return a?.started && a.finished ? t('office.attendance.startedFinished', { start: a.started, end: a.finished }) : t('office.attendance.finished');
    case 'on_leave':
      return t('office.attendance.leaveLine');
    default:
      return d.usual_start ? t('office.attendance.usually', { time: d.usual_start }) : t('office.attendance.not_started');
  }
}

export function attendanceGroups<D extends Pick<BoardDriver, 'attendance'>>(drivers: readonly D[]): { state: AttendanceState; drivers: D[] }[] {
  return ATTENDANCE_STATES.map((state) => ({ state, drivers: drivers.filter((d) => attendanceOf(d) === state) }));
}

export type BoardTone = 'blue' | 'green' | 'red' | 'muted';
export type BoardPillKey = 'onTask' | 'free' | 'onDuty' | 'offDuty' | 'notAvailable';

/** The dot on the avatar and the pill: blue on a task, green free, red not available, grey off duty (and on duty but not free). */
export function boardPill(d: Pick<BoardDriver, 'status' | 'free_now'>): { key: BoardPillKey; tone: BoardTone } {
  switch (d.status.kind) {
    case 'on_task':
      return { key: 'onTask', tone: 'blue' };
    case 'not_available':
      return { key: 'notAvailable', tone: 'red' };
    case 'off_duty':
      return { key: 'offDuty', tone: 'muted' };
    default:
      return d.free_now ? { key: 'free', tone: 'green' } : { key: 'onDuty', tone: 'muted' };
  }
}

/**
 * The two lines under the name (design 12):
 *   1. the server's status words ("On a task till 10:40 · Team drop", "On duty since 08:02 · free till 13:00",
 *      "Not available · leave · back Wed 21"), an off-duty driver's usual start after it;
 *   2. the next task, last seen (the server's words), an on-duty driver's usual start.
 * Round 3: the server's words in the person's language (statusWords: "Not available, back 13:00", "Last seen 17:42 near
 * Kadawatha"); the vehicle, the regular one too, is the chip under the name (the driver-first card), not a line.
 */
export function rowLines(d: Pick<BoardDriver, 'status' | 'next_task' | 'last_seen' | 'usual_start' | 'vehicle'>, t: Words): [string, string] {
  const first = [sentenceText(t, d.status.text)];
  if (d.status.kind === 'off_duty' && d.usual_start) first.push(t('office.drivers.usuallyStarts', { time: d.usual_start }));
  const second: string[] = [];
  if (d.next_task) second.push(t('office.drivers.next', { time: d.next_task.when, title: d.next_task.title }));
  if (d.last_seen) second.push(sentenceText(t, d.last_seen));
  if (d.status.kind === 'on_duty' && d.usual_start) second.push(t('office.drivers.starts', { time: d.usual_start }));
  return [first.filter(Boolean).join(' · '), second.filter(Boolean).join(' · ')];
}

/** The plate beside the name: the vehicle held today, else nothing (the regular one goes on the second line). */
export function heldPlate(d: Pick<BoardDriver, 'vehicle' | 'status'>): string | null {
  if (!d.vehicle) return null;
  return d.vehicle.source === 'on_duty' || d.status.kind === 'on_task' ? d.vehicle.reg_no : null;
}

// ---- The week ----------------------------------------------------------------------------------------------------------

/** The seven days from `today` (YYYY-MM-DD). */
export function weekDays(today: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(today, i));
}

export type DayMark = 'none' | 'full' | 'part';

export interface WeekCell {
  date: string;
  entries: UnavailableEntry[];
  mark: DayMark;
}

export interface WeekRow {
  name: string;
  username: string | null;
  cells: WeekCell[];
  /** The entries in the week, soonest first (the lines under the cells). */
  entries: UnavailableEntry[];
}

/** True when the entry covers the day (its first to its last day). */
export const coversDay = (e: Pick<UnavailableEntry, 'day' | 'last_day'>, date: string): boolean => e.day <= date && date <= e.last_day;

/**
 * The grid: one row per board driver (in the board's order), a cell per day with the entries covering it (full when any
 * entry is a full day, part otherwise). Entries of a driver not on the board are their own rows after the board's.
 */
export function weekGrid(drivers: readonly Pick<BoardDriver, 'name' | 'username'>[], entries: readonly UnavailableEntry[], days: readonly string[]): WeekRow[] {
  const keyOf = (username: string | null | undefined, name: string) => username || `name:${name}`;
  const rows = new Map<string, WeekRow>();
  for (const d of drivers) rows.set(keyOf(d.username, d.name), { name: d.name, username: d.username ?? null, cells: days.map((date) => ({ date, entries: [], mark: 'none' })), entries: [] });
  for (const e of [...entries].sort((a, b) => a.from.localeCompare(b.from))) {
    const key = keyOf(e.username, e.driver ?? '');
    let row = rows.get(key);
    if (!row) {
      row = { name: e.driver ?? e.username ?? '', username: e.username ?? null, cells: days.map((date) => ({ date, entries: [], mark: 'none' })), entries: [] };
      rows.set(key, row);
    }
    let inWeek = false;
    for (const cell of row.cells) {
      if (!coversDay(e, cell.date)) continue;
      inWeek = true;
      cell.entries.push(e);
      if (e.part === 'full_day') cell.mark = 'full';
      else if (cell.mark === 'none') cell.mark = 'part';
    }
    if (inWeek) row.entries.push(e);
  }
  return [...rows.values()];
}

/** The parts of an entry's line: the day (or the first to the last), the reason's words, the part ("13:00–15:00" for hours). */
export function entryParts(e: Pick<UnavailableEntry, 'day' | 'last_day' | 'part' | 'reason_text' | 'start_time' | 'end_time' | 'note'>, dayLabel: (date: string) => string, t: Words): string[] {
  const when = e.last_day !== e.day ? `${dayLabel(e.day)} – ${dayLabel(e.last_day)}` : dayLabel(e.day);
  const part = e.part === 'hours'
    ? [e.start_time, e.end_time].filter(Boolean).join('–')
    : e.part === 'morning' && e.end_time ? t('office.drivers.part.morningTill', { time: e.end_time })
    : e.part === 'afternoon' && e.start_time ? t('office.drivers.part.afternoonFrom', { time: e.start_time })
    : t(`office.drivers.part.${e.part}`);
  return [when, e.reason_text, part, e.note?.trim() ?? ''].filter(Boolean);
}

// ---- Not available: the sheet's input ----------------------------------------------------------------------------------

export const PARTS: readonly UnavailablePart[] = ['full_day', 'morning', 'afternoon', 'hours'];
export const REASONS: readonly UnavailableReason[] = ['leave', 'half_day', 'personal', 'other'];

export interface UnavailabilityForm {
  driver: string;
  date: string;
  /** full_day only: the last day, for several days. */
  toDate?: string;
  part: UnavailablePart;
  from?: string;
  to?: string;
  reason: UnavailableReason;
  note?: string;
}

export type UnavailabilityProblem = 'driver' | 'date' | 'toDate' | 'hours';

const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The set_unavailability input from the sheet: hours need from and to with to after from; a full day may run to a later
 * day (to_date); the note trimmed, at most 300, left out when empty. The problem names the field when it cannot be sent.
 */
export function unavailabilityInput(f: UnavailabilityForm): { ok: true; input: Record<string, unknown> } | { ok: false; problem: UnavailabilityProblem } {
  if (!f.driver.trim()) return { ok: false, problem: 'driver' };
  if (!DATE.test(f.date)) return { ok: false, problem: 'date' };
  const input: Record<string, unknown> = { driver: f.driver.trim(), date: f.date, part: f.part, reason: f.reason };
  if (f.part === 'hours') {
    if (!f.from || !f.to || !TIME.test(f.from) || !TIME.test(f.to) || f.to <= f.from) return { ok: false, problem: 'hours' };
    input.from = f.from;
    input.to = f.to;
  }
  if (f.part === 'full_day' && f.toDate && f.toDate !== f.date) {
    if (!DATE.test(f.toDate) || f.toDate < f.date) return { ok: false, problem: 'toDate' };
    input.to_date = f.toDate;
  }
  const note = f.note?.trim();
  if (note) input.note = note.slice(0, 300);
  return { ok: true, input };
}

// ---- The day's route ---------------------------------------------------------------------------------------------------

export type SpeedBand = 'standing' | 'slow' | 'mid' | 'fast';
export const SPEED_BANDS: readonly SpeedBand[] = ['standing', 'slow', 'mid', 'fast'];

/** The line's colour by speed: grey standing, amber under 20, blue 20–60, dark blue over 60 km/h; dashed grey for a hole, slate for an estimated road. */
export const BAND_COLORS: Record<SpeedBand | 'gap' | 'estimated', string> = {
  standing: '#8d9096',
  slow: '#f2a900',
  mid: '#1e4fa0',
  fast: '#0f2d66',
  gap: '#8d9096',
  estimated: '#5d646c',
};

/** Standing under 3 km/h (GPS jitter while parked), slow under 20, 20–60, over 60; an unknown speed is drawn as 20–60. */
export function speedBand(kmh: number | null | undefined): SpeedBand {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return 'mid';
  if (kmh < 3) return 'standing';
  if (kmh < 20) return 'slow';
  if (kmh <= 60) return 'mid';
  return 'fast';
}

export interface RoutePoint extends LatLng {
  /** The point's moment (ms), from the ISO column; the day's "HH:MM:SS" when an older answer has no ISO column. */
  at: number;
  time: string;
  kmh: number | null;
}

type Line = NonNullable<DriverRoute['route']>;

/** The line's points read by column name (time, lat, lng, km/h, at); a row without a usable position is skipped. */
export function routePoints(route: Pick<DriverRoute, 'route' | 'date'>): RoutePoint[] {
  const line: Line | undefined = route.route;
  if (!line || !Array.isArray(line.points)) return [];
  const col = (name: string) => line.columns.indexOf(name);
  const iTime = col('time'), iLat = col('lat'), iLng = col('lng'), iKmh = col('km/h'), iAt = col('at');
  if (iLat < 0 || iLng < 0) return [];
  const out: RoutePoint[] = [];
  for (const p of line.points) {
    const lat = Number(p[iLat]);
    const lng = Number(p[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const time = iTime >= 0 && typeof p[iTime] === 'string' ? (p[iTime] as string) : '';
    const iso = iAt >= 0 && typeof p[iAt] === 'string' ? (p[iAt] as string) : '';
    const at = iso ? Date.parse(iso) : route.date && time ? Date.parse(`${route.date}T${time.length === 5 ? `${time}:00` : time}+05:30`) : NaN;
    const kmhRaw = iKmh >= 0 ? p[iKmh] : null;
    const kmh = typeof kmhRaw === 'number' && Number.isFinite(kmhRaw) ? kmhRaw : null;
    out.push({ at: Number.isFinite(at) ? at : out.length ? out[out.length - 1].at : 0, time, lat, lng, kmh });
  }
  return out;
}

export interface RouteLine {
  key: string;
  band: SpeedBand | 'gap' | 'estimated';
  points: LatLng[];
  dashed: boolean;
}

/** Over this many minutes between two line points the leg is a hole (dashed), as the server's holes. */
export const HOLE_MIN = 2;

/**
 * The line cut into legs by speed band: each leg between two points takes the band of the faster of the two (a start from
 * standing is drawn in the speed it reaches), legs of one band joined into one line (sharing the joint point), and a leg
 * over HOLE_MIN apart in time drawn dashed as a hole.
 */
export function speedLines(points: readonly RoutePoint[], holeMin = HOLE_MIN): RouteLine[] {
  const out: RouteLine[] = [];
  let current: RouteLine | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const hole = b.at - a.at > holeMin * 60_000;
    const band: RouteLine['band'] = hole ? 'gap' : speedBand(Math.max(a.kmh ?? -1, b.kmh ?? -1) < 0 ? null : Math.max(a.kmh ?? 0, b.kmh ?? 0));
    if (current && current.band === band && !hole) {
      current.points.push({ lat: b.lat, lng: b.lng });
      continue;
    }
    current = { key: `${band}:${i}`, band, points: [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], dashed: hole };
    out.push(current);
    if (hole) current = null;
  }
  return out;
}

/** The estimated road over each gap (Part 5b), dashed slate; never km. */
export function estimatedLines(route: Pick<DriverRoute, 'estimated'>): RouteLine[] {
  return (route.estimated ?? []).flatMap((e, i): RouteLine[] => {
    const points = (e.points ?? []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([lat, lng]) => ({ lat, lng }));
    return points.length >= 2 ? [{ key: `estimated:${i}:${e.from_at}`, band: 'estimated', points, dashed: true }] : [];
  });
}

/** Every line the map draws: the estimated roads under the day's line. */
export function routeLines(route: Pick<DriverRoute, 'route' | 'date' | 'estimated'>): RouteLine[] {
  return [...estimatedLines(route), ...speedLines(routePoints(route))];
}

export interface StopMark extends LatLng {
  key: string;
  /** "10:12": when the stop began. */
  time: string;
  minutes: number;
  near: string | null;
}

/** The stops over 10 minutes with a position: a circle with the time it began. */
export function stopMarks(route: Pick<DriverRoute, 'stops_over_10_min'>): StopMark[] {
  return (route.stops_over_10_min ?? []).flatMap((s, i): StopMark[] =>
    typeof s.lat === 'number' && typeof s.lng === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lng)
      ? [{ key: `stop:${i}:${s.from}`, lat: s.lat, lng: s.lng, time: s.from, minutes: s.minutes, near: s.near ?? null }]
      : []);
}

export interface RouteFit {
  key: string;
  frame: Frame;
}

/** The frame around the whole day: the line, the stops and the estimated legs. The key changes with the points shown, not on a refresh that only re-answered. */
export function routeFrame(lines: readonly RouteLine[], stops: readonly StopMark[]): RouteFit {
  const points: LatLng[] = [...lines.flatMap((l) => l.points), ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const last = lines.length ? lines[lines.length - 1].points.slice(-1)[0] : null;
  return { key: `${points.length}:${last ? `${last.lat.toFixed(5)},${last.lng.toFixed(5)}` : ''}:${stops.length}`, frame: frameOf(points) };
}

/** The frame of one timeline row: the points within its span; a stop with a position as one place; none when nothing is known. */
export function rowFrame(points: readonly RoutePoint[], seg: Pick<RouteSegment, 'from_at' | 'to_at' | 'lat' | 'lng' | 'kind'>): Frame {
  const from = Date.parse(seg.from_at);
  const to = Date.parse(seg.to_at);
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const inside = points.filter((p) => p.at >= from && p.at <= to);
    if (inside.length > 0) return frameOf(inside.map((p) => ({ lat: p.lat, lng: p.lng })));
  }
  if (typeof seg.lat === 'number' && typeof seg.lng === 'number') return { kind: 'point', center: { lat: seg.lat, lng: seg.lng } };
  return { kind: 'none' };
}

export interface DayNumbers {
  km: number | null;
  drivingMin: number;
  stoppedMin: number;
  stops: number;
}

/** The day's numbers under the map: GPS km (null until the server says), driving and stopped minutes, the stops over 10 min. */
export function dayNumbers(route: Pick<DriverRoute, 'km' | 'driving_minutes' | 'stopped_minutes' | 'stops_count' | 'stops_over_10_min'>): DayNumbers {
  return {
    km: typeof route.km === 'number' ? Math.round(route.km * 10) / 10 : null,
    drivingMin: route.driving_minutes ?? 0,
    stoppedMin: route.stopped_minutes ?? 0,
    stops: route.stops_count ?? route.stops_over_10_min?.length ?? 0,
  };
}

/** A timeline row's mark colour: driving blue, stopped grey, no GPS amber, no data red. */
export function segmentTone(kind: RouteSegment['kind']): BoardTone | 'amber' {
  return kind === 'driving' ? 'blue' : kind === 'stopped' ? 'muted' : kind === 'no_gps' ? 'amber' : 'red';
}

/** "10:12–10:40 · 28 min · 14 km" before the server's sentence; the km only on a driving leg with km. */
export function segmentLine(seg: Pick<RouteSegment, 'from' | 'to' | 'minutes' | 'km' | 'kind' | 'uploaded'>, t: Words): string {
  const parts = [`${seg.from}–${seg.to}`, t('dur.minutes', { n: Math.round(seg.minutes) })];
  if (seg.kind === 'driving' && typeof seg.km === 'number') parts.push(`${Math.round(seg.km * 10) / 10} ${t('common.km')}`);
  if (seg.uploaded) parts.push(t('office.drivers.uploadedLater', { time: seg.uploaded }));
  return parts.join(' · ');
}
