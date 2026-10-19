// Office mode (Phase 8, O1): the Live tab's pure rules (design 15), tested in scripts/test-live.ts: which chip a driver
// belongs under and the counts, the one line under a driver's name, the status pill, the marker's colour and label, the
// markers (only drivers with a position) and the frame around them (it changes when the set of drivers changes, never on a
// refresh that only moved them). Pure: no React, no native module; the words come through `t`, so both languages read the
// same fields. The server's own sentences (status_text: "Location off since 09:10") are shown as they are.

import { type Frame, frameOf, type LatLng } from '../components/taskMapLogic';
import { initials } from './text';
import type { DutyState, LiveDriver } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

export type LiveFilter = 'all' | DutyState;
export const LIVE_FILTERS: readonly LiveFilter[] = ['all', 'on_task', 'on_duty', 'off_duty'];

type DutyOf = Partial<Pick<LiveDriver, 'duty' | 'task' | 'status' | 'state'>>;

/** The driver's duty: the server's, else read from the card (an older answer without `duty`). */
export function dutyOf(d: DutyOf): DutyState {
  if (d.duty) return d.duty;
  if (d.task) return 'on_task';
  return d.status === 'not_sharing' || d.state === 'not_sharing' ? 'off_duty' : 'on_duty';
}

/** "All · 4", "On a task · 1", "Free · 2", "Off duty · 1". */
export function filterCounts(drivers: readonly DutyOf[]): Record<LiveFilter, number> {
  const counts: Record<LiveFilter, number> = { all: drivers.length, on_task: 0, on_duty: 0, off_duty: 0 };
  for (const d of drivers) counts[dutyOf(d)]++;
  return counts;
}

/** The rows (and the markers) under a chip, in the server's order. */
export function filterDrivers<D extends DutyOf>(drivers: readonly D[], filter: LiveFilter): D[] {
  return filter === 'all' ? [...drivers] : drivers.filter((d) => dutyOf(d) === filter);
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

type LineOf = DutyOf & Pick<LiveDriver, 'eta_final' | 'late_min' | 'near' | 'last_position_at' | 'status_text'>;

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
  if (duty === 'on_task') {
    parts.push(d.task || t('office.live.onTask'));
    if (d.late_min && d.late_min > 0) parts.push(t('office.live.late', { min: d.late_min }));
    if (d.eta_final) parts.push(t('office.live.about', { time: d.eta_final }));
    else if (d.near) parts.push(t('office.live.near', { town: d.near }));
  } else if (duty === 'on_duty') {
    parts.push(t('office.live.onDuty'));
    if (d.near) parts.push(t('office.live.near', { town: d.near }));
    if (d.status && d.status !== 'live' && d.status_text) parts.push(d.status_text);
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
