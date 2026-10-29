// Office mode (Phase 8, O1): the Live tab's pure rules (design 15), tested in scripts/test-live.ts: which chip a driver
// belongs under and the counts, the one line under a driver's name, the status pill, the marker's colour and label, the
// markers (only drivers with a position) and the frame around them (it changes when the set of drivers changes, never on a
// refresh that only moved them). Pure: no React, no native module; the words come through `t`, so both languages read the
// same fields. The server's own sentences (status_text: "Location off since 09:10") are shown as they are.
// Stage 1 (O3 item 4): the Problems choice (the site's rule: No signal or Location off while on duty), watched mode's
// drivers (watch_drivers every 30 s), Clock out and Move to vehicle (who may be clocked out or moved; the answers in
// words), the card's speed and battery, and the map's fit-all frame and zoom steps.

import { webTripSeenWords } from './webTripLogic';
import { type Frame, frameOf, type LatLng } from '../components/taskMapLogic';
import { routeLayerOptions, type RouteLayers, routeLayersOf } from '../lib/mapLayout';
import type { FilterDef, FilterValues } from '../lib/patterns/filterLogic';
import { sentenceText } from './statusWords';
import { initials } from './text';
import type { DutyState, LiveDriver } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

export type LiveFilter = 'all' | DutyState | 'problems';
export const LIVE_FILTERS: readonly LiveFilter[] = ['all', 'on_task', 'on_duty', 'off_duty', 'problems'];

type DutyOf = Partial<Pick<LiveDriver, 'duty' | 'task' | 'status' | 'state'>>;

/** The driver's duty: the server's, else read from the card (an older answer without `duty`). */
export function dutyOf(d: DutyOf): DutyState {
  if (d.duty) return d.duty;
  if (d.task) return 'on_task';
  return d.status === 'not_sharing' || d.state === 'not_sharing' ? 'off_duty' : 'on_duty';
}

/**
 * A phone problem while on duty (the site's Problems chip, data/live.ts hasProblem): No signal or Location off. The
 * status from the server, else read from the older share state (stale = no signal). Off duty is never a problem.
 */
export function hasProblem(d: DutyOf): boolean {
  const s = d.status ?? (d.state === 'sharing' ? 'live' : d.state === 'stale' ? 'no_signal' : 'not_sharing');
  return dutyOf(d) !== 'off_duty' && (s === 'no_signal' || s === 'location_off');
}

/** "All · 4", "On a task · 1", "Free · 2", "Off duty · 1", "Problems · 1" (a driver with a problem is in their duty too). */
export function filterCounts(drivers: readonly DutyOf[]): Record<LiveFilter, number> {
  const counts: Record<LiveFilter, number> = { all: drivers.length, on_task: 0, on_duty: 0, off_duty: 0, problems: 0 };
  for (const d of drivers) {
    counts[dutyOf(d)]++;
    if (hasProblem(d)) counts.problems++;
  }
  return counts;
}

/** The Filter sheet's one section (no search: the map's list is short): the duty, with the counts beside each choice. */
export function liveFilterDefs(counts: Record<LiveFilter, number> | undefined, t: Words, opts: { trails?: boolean } = {}): FilterDef[] {
  const defs: FilterDef[] = [{
    key: 'duty',
    label: t('office.live.filterLabel'),
    kind: 'single',
    default: 'all',
    options: LIVE_FILTERS.map((k) => ({ value: k, label: t(`office.live.filter.${k}`), ...(counts ? { count: counts[k] } : {}) })),
  }];
  // Today's trails live in the sheet, not over the map (Sahan's decision 3, 20 October 2026: at most three map controls);
  // on, they show as a chip like any other filter.
  // Round 48 (item 3): the route's layers (the gap markers, every stop's time: lib/mapLayout.ts) in the same Map section,
  // after the trails (Google Maps' Layers button, inside the one Filter sheet); they need the shown route, so driver_route.
  if (opts.trails) defs.push({ key: 'show', label: t('office.live.mapSection'), kind: 'multi', options: [{ value: 'trails', label: t('office.live.trails') }, ...routeLayerOptions(t)] });
  return defs;
}

/** The route's layers ticked in the Map section (Round 48). */
export const liveLayersOf = (values: FilterValues): RouteLayers => routeLayersOf(values, 'show');

/** Today's trails are ticked in the sheet. */
export const trailsOn = (values: FilterValues): boolean => Array.isArray(values.show) && values.show.includes('trails');

export const liveChoice = (values: FilterValues): LiveFilter =>
  ((LIVE_FILTERS as readonly unknown[]).includes(values.duty) ? values.duty : 'all') as LiveFilter;

/** The rows (and the markers) under a chip, in the server's order. */
export function filterDrivers<D extends DutyOf>(drivers: readonly D[], filter: LiveFilter): D[] {
  if (filter === 'all') return [...drivers];
  return filter === 'problems' ? drivers.filter(hasProblem) : drivers.filter((d) => dutyOf(d) === filter);
}

export type PillKey = 'onTask' | 'free' | 'offDuty';
export type LiveTone = 'blue' | 'green' | 'muted';

/** The marker's ring and the avatar's: blue on a task, green on duty and free, grey off duty (design 15). */
export function markerTone(duty: DutyState): LiveTone {
  return duty === 'on_task' ? 'blue' : duty === 'on_duty' ? 'green' : 'muted';
}

/** The status pill: "on a task" (blue), "free" (green: on duty with no task), "off duty" (grey). */
export function pillOf(d: DutyOf): { key: PillKey; tone: LiveTone } {
  const duty = dutyOf(d);
  return { key: duty === 'on_task' ? 'onTask' : duty === 'on_duty' ? 'free' : 'offDuty', tone: markerTone(duty) };
}

type LineOf = DutyOf & Pick<LiveDriver, 'eta_final' | 'late_min' | 'near' | 'last_position_at' | 'status_text'> & Partial<Pick<LiveDriver, 'web_trip' | 'last_seen'>>;

/**
 * The line under the name, from the fields the server already formatted:
 *   on a task → the task's title · late N min · about HH:MM (else near the town);
 *   on duty   → On duty · near the town · seen HH:MM (the server's words instead when the phone has a problem:
 *               "Location off since 09:10", "No signal since 09:10");
 *   off duty  → Off duty · last seen HH:MM · near the town.
 */
export function rowLine(d: LineOf, t: Words): string {
  const duty = dutyOf(d);
  const parts: string[] = [];
  // Round 50 (§37.3): a trip driven on the web has no live state: "Web trip · last seen at <stop> HH:MM" instead.
  const web = webTripSeenWords(d);
  if (web) {
    parts.push(d.task || t('office.live.onTask'));
    parts.push(t(web.key, web.vars));
  } else if (duty === 'on_task') {
    parts.push(d.task || t('office.live.onTask'));
    if (d.late_min && d.late_min > 0) parts.push(t('office.live.late', { min: d.late_min }));
    if (d.eta_final) parts.push(t('office.live.about', { time: d.eta_final }));
    else if (d.near) parts.push(t('office.live.near', { town: d.near }));
  } else if (duty === 'on_duty') {
    parts.push(t('office.live.onDuty'));
    if (d.near) parts.push(t('office.live.near', { town: d.near }));
    if (d.status && d.status !== 'live' && d.status_text) parts.push(sentenceText(t, d.status_text));
    else if (d.last_position_at) parts.push(t('office.live.seen', { time: d.last_position_at }));
  } else {
    parts.push(t('office.live.offDuty'));
    if (d.last_position_at) parts.push(t('office.live.lastSeen', { time: d.last_position_at }));
    if (d.near) parts.push(t('office.live.near', { town: d.near }));
  }
  return parts.join(' · ');
}

type Positioned<D> = D & { lat: number; lng: number };

/** True when the card carries a position the map can draw; a driver without one is drawn nowhere. */
export function hasPosition<D extends Pick<LiveDriver, 'lat' | 'lng'>>(d: D): d is Positioned<D> {
  return typeof d.lat === 'number' && Number.isFinite(d.lat) && typeof d.lng === 'number' && Number.isFinite(d.lng);
}

/** "Sunil · 62 km/h" above the selected marker; the name alone while the speed is unknown (not sharing). */
export function markerLabel(d: Pick<LiveDriver, 'driver' | 'speed_kmh'>, t: Words): string {
  return typeof d.speed_kmh === 'number' && Number.isFinite(d.speed_kmh)
    ? `${d.driver} · ${t('office.live.kmh', { n: Math.round(d.speed_kmh) })}`
    : d.driver;
}

export interface DriverMarker {
  username: string;
  name: string;
  /** "SR": the letters in the ring. */
  initials: string;
  lat: number;
  lng: number;
  tone: LiveTone;
  /** Off duty: drawn lighter. */
  dim: boolean;
  selected: boolean;
  /** The selected driver's "Sunil · 62 km/h"; null on the others. */
  label: string | null;
}

type MarkerOf = DutyOf & Pick<LiveDriver, 'username' | 'driver' | 'lat' | 'lng' | 'speed_kmh'>;

/** One marker per driver with a position, the selected one labelled. */
export function markersOf(drivers: readonly MarkerOf[], selected: string | null, t: Words): DriverMarker[] {
  return drivers.filter(hasPosition).map((d) => {
    const duty = dutyOf(d);
    const isSelected = selected !== null && d.username === selected;
    return {
      username: d.username,
      name: d.driver,
      initials: initials(d.driver),
      lat: d.lat,
      lng: d.lng,
      tone: markerTone(duty),
      dim: duty === 'off_duty',
      selected: isSelected,
      label: isSelected ? markerLabel(d, t) : null,
    };
  });
}

/** The drivers with a position, by username: the key the map frames on (a position moving does not change it). */
export function positionsKey(drivers: readonly Pick<LiveDriver, 'username' | 'lat' | 'lng'>[]): string {
  return drivers.filter(hasPosition).map((d) => d.username).sort().join(',');
}

export interface LiveFit {
  key: string;
  frame: Frame;
}

/** The frame around every driver with a position: the map fits it when the set changes, not on each refresh. */
export function frameAll(drivers: readonly Pick<LiveDriver, 'username' | 'lat' | 'lng'>[]): LiveFit {
  const points: LatLng[] = drivers.filter(hasPosition).map((d) => ({ lat: d.lat, lng: d.lng }));
  return { key: positionsKey(drivers), frame: frameOf(points) };
}

export interface Focus extends LatLng {
  username: string;
}

/** Where the map moves when a driver is selected: their position; null when nobody is selected or they have none. */
export function focusOf(drivers: readonly Pick<LiveDriver, 'username' | 'lat' | 'lng'>[], selected: string | null): Focus | null {
  if (selected === null) return null;
  const d = drivers.find((x) => x.username === selected);
  return d && hasPosition(d) ? { username: d.username, lat: d.lat, lng: d.lng } : null;
}

// ---------------------------------------------------------------------------
// Stage 1 (O3 item 4): watched mode, Clock out, Move to vehicle, the card's lines, the map's controls
// ---------------------------------------------------------------------------

/** watch_drivers is called again this often while Live is in front (each call keeps a driver watched 90 s). */
export const WATCH_EVERY_MS = 30_000;
/** The most drivers one watch_drivers call takes. */
export const WATCH_MAX = 20;

type ShareOf = Pick<LiveDriver, 'username' | 'state'> & Partial<Pick<LiveDriver, 'signal'>>;

/** Sharing now (the site's sharingNow): the raw signal when the card has it, else the share state. */
export const sharingNow = (d: Partial<Pick<LiveDriver, 'state' | 'signal'>>): boolean => (d.signal ? d.signal.sharing : d.state !== 'not_sharing');

/**
 * Who is watched (the site's Live): every sharing driver while today's trails are on, else the selected driver while
 * they share; all of them, in a steady order (the key does not change on a refresh that changed nothing), sent
 * WATCH_MAX to a call (watchBatches; Stage 1 review: the 21st sharing driver is watched too).
 */
export function watchList(drivers: readonly ShareOf[], trails: boolean, selected: string | null): string[] {
  const who = trails ? drivers.filter(sharingNow) : drivers.filter((d) => d.username === selected && sharingNow(d));
  return [...new Set(who.map((d) => d.username))].sort();
}

/** watch_drivers takes at most WATCH_MAX drivers: the list in calls of that size. */
export function watchBatches(list: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += WATCH_MAX) out.push(list.slice(i, i + WATCH_MAX));
  return out;
}

/** Clock out: a driver on duty without a task (the server refuses a running task too, and says so). */
export const canClockOut = (d: DutyOf): boolean => dutyOf(d) === 'on_duty';

/** Move to vehicle on duty; on a task the same move is a swap during the task (Task detail's Swap vehicle). */
export function moveMode(d: DutyOf): 'move' | 'swap' | 'none' {
  const duty = dutyOf(d);
  return duty === 'on_task' ? 'swap' : duty === 'on_duty' ? 'move' : 'none';
}

/** clock_out_driver's answer. */
export interface ClockOutResult {
  clocked_out: string | false;
  at?: string;
  reason?: string;
  note?: string;
}

/** "Kamal Perera is off duty since 17:40." / "Kamal is already off duty." */
export function clockOutLine(r: ClockOutResult, name: string, t: Words): string {
  if (r.clocked_out === false) return t('office.live.alreadyOff', { name });
  const at = r.at ? r.at.slice(-5) : '';
  return at ? t('office.live.clockedOutAt', { name: r.clocked_out, time: at }) : t('office.live.clockedOut', { name: r.clocked_out });
}

/** clock_out_driver's input: the driver's username and the reason when one was typed. */
export function clockOutInput(username: string, reason: string): { driver: string; reason?: string } {
  const why = reason.trim().slice(0, 200);
  return { driver: username, ...(why ? { reason: why } : {}) };
}

/** The card's speed line: only while the position is live (a stale speed would mislead), rounded. */
export function speedText(d: Pick<LiveDriver, 'speed_kmh' | 'status'>, t: Words): string | null {
  if (typeof d.speed_kmh !== 'number' || !Number.isFinite(d.speed_kmh) || (d.status ?? 'live') !== 'live') return null;
  return t('office.live.speed', { n: Math.round(d.speed_kmh) });
}

/** The card's battery line: the phone's last battery reading. */
export function batteryText(d: Pick<LiveDriver, 'battery_pct'>, t: Words): string | null {
  return typeof d.battery_pct === 'number' && Number.isFinite(d.battery_pct) ? t('office.live.battery', { n: Math.round(d.battery_pct) }) : null;
}

/** A map control's command for the engine: zoom one step in or out, or fit everyone (a new nonce each tap). */
export interface MapCommand {
  kind: 'in' | 'out' | 'fit';
  nonce: number;
}

/** The zoom after a step, within what both engines draw well. */
export const zoomStep = (zoom: number, kind: 'in' | 'out'): number => Math.max(3, Math.min(20, Math.round((Number.isFinite(zoom) ? zoom : 7) + (kind === 'in' ? 1 : -1))));

/** Fit all (the site's fitAll): every driver's marker and the shown route together. */
export function fitAllFrame(markers: readonly LatLng[], route: Frame | null | undefined): Frame {
  const points: LatLng[] = markers.map((m) => ({ lat: m.lat, lng: m.lng }));
  if (route?.kind === 'box') points.push(route.sw, route.ne);
  else if (route?.kind === 'point') points.push(route.center);
  return frameOf(points);
}
