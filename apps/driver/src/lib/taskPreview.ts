// The whole task before accepting (Hotfix 2, I and J). Pure: no React, so scripts/test-preview.ts runs it.
//
//   - The next-task card lists every stop in order; above CARD_STOPS stops, the first four and "Show all N stops".
//   - The preview's totals come from the stored plan (plan_json: total_km, total_drive_min; else its legs added up).
//   - The vehicle: its plate, or (J, a task made without one) "Your vehicle on the day" / "Any van".
//   - A changed task shows what changed: the copy the driver last saw (kept on the phone, SeenCopy) against the task
//     now, plus what the office's "Task changed" push named (data.changes). Stops are matched as the server matches
//     them for that push (_shared/fleet/stopChanges.ts): by our place, else the Google place, else type + name, because
//     the office's stop edit replaces the rows (new ids) rather than editing them.

import type { TaskStop, TaskWithStops, Vehicle } from './types';

/** The app's t() (useApp): a key and its {placeholders}. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

// --- The card's stops -------------------------------------------------------------------------------------------------

/** The card shows this many stops; above it, "Show all". */
export const CARD_STOPS = 4;

/** The stops the card shows: all of them up to CARD_STOPS (or when expanded), else the first four and how many wait. */
export function cardStops<T>(stops: readonly T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || stops.length <= CARD_STOPS) return { shown: [...stops], hidden: 0 };
  return { shown: stops.slice(0, CARD_STOPS), hidden: stops.length - CARD_STOPS };
}

// --- The totals -----------------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** The trip's road km and drive time from the plan: its totals, else its legs added up; null when the plan has neither. */
export function planTotals(plan: unknown): { km: number | null; driveMin: number | null } {
  if (!plan || typeof plan !== 'object') return { km: null, driveMin: null };
  const p = plan as { total_km?: unknown; total_drive_min?: unknown; legs?: unknown };
  const legs = Array.isArray(p.legs) ? p.legs.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object') : [];
  const sum = (field: string) => {
    const values = legs.map((l) => num(l[field]));
    return values.length > 0 && values.every((v) => v !== null) ? values.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
  };
  return { km: num(p.total_km) ?? sum('km'), driveMin: num(p.total_drive_min) ?? sum('minutes') };
}

/** "42" or "4.2" (under 10 km), Latin digits. */
export function totalKmText(km: number): string {
  return km < 9.95 ? km.toFixed(1) : String(Math.round(km));
}

// --- The vehicle (J) ------------------------------------------------------------------------------------------------

export type VehicleMode = 'specific' | 'driver_day' | 'any_type';

/** The task's vehicle mode (a task kept by an older version of the app has none: it had its vehicle). */
export function vehicleMode(task: Pick<TaskWithStops, 'vehicle_mode'>): VehicleMode {
  const mode = (task as { vehicle_mode?: string | null }).vehicle_mode;
  return mode === 'driver_day' || mode === 'any_type' ? mode : 'specific';
}

export type VehicleLine =
  | { kind: 'vehicle'; vehicle: Vehicle }
  /** A vehicle is set but the phone does not know it (not in the list it has). */
  | { kind: 'unknown' }
  /** "Your vehicle on the day" */
  | { kind: 'onDay' }
  /** "Any van" */
  | { kind: 'any'; type: string };

type VehicleOf = Pick<TaskWithStops, 'vehicle_id' | 'vehicle_mode' | 'vehicle_type_wanted'>;

/** What the task says about its vehicle. */
export function vehicleLine(task: VehicleOf, vehicles: readonly Vehicle[]): VehicleLine {
  if (task.vehicle_id) {
    const vehicle = vehicles.find((v) => v.id === task.vehicle_id);
    return vehicle ? { kind: 'vehicle', vehicle } : { kind: 'unknown' };
  }
  if (vehicleMode(task) === 'any_type' && task.vehicle_type_wanted) return { kind: 'any', type: task.vehicle_type_wanted };
  return { kind: 'onDay' };
}

/** The word for a vehicle type in the driver's language (vehicleType.*); a type the strings do not know reads "vehicle". */
export function typeWord(t: Translate, type: string): string {
  const key = `vehicleType.${type}`;
  const word = t(key);
  return word !== key ? word : t('vehicleType.other');
}

/** "Your vehicle on the day", "Any van", or null when the task names its vehicle (the plate is shown). */
export function vehicleWords(t: Translate, line: VehicleLine): string | null {
  if (line.kind === 'onDay') return t('preview.vehicleOnDay');
  if (line.kind === 'any') return t('preview.vehicleAny', { type: typeWord(t, line.type) });
  return null;
}

// --- What changed -----------------------------------------------------------------------------------------------------

/** What the preview can mark as changed. */
export type ChangeField = 'leave' | 'endBy' | 'vehicle' | 'title' | 'passengers' | 'contact' | 'notes' | 'stops';

interface SeenStop {
  key: string;
  place: string;
  type: string;
  /** What else the driver sees of it: compared for "changed". */
  detail: string;
}

/** The task as the driver last saw it (kept on the phone per task). */
export interface SeenCopy {
  /** When the copy was kept (ms). */
  at: number;
  /**
   * true: kept when the driver opened the task (a push older than `at` was seen with it); false: kept when the task was
   * first on Today (a push still counts: the driver has not read what it changed).
   */
  opened?: boolean;
  leave: string;
  endBy: string | null;
  vehicle: string;
  title: string;
  passengers: number | null;
  contact: string;
  notes: string | null;
  stops: SeenStop[];
}

type CopyOf = Pick<
  TaskWithStops,
  | 'leave_by'
  | 'start_at'
  | 'end_by'
  | 'vehicle_id'
  | 'vehicle_mode'
  | 'vehicle_type_wanted'
  | 'title'
  | 'passengers'
  | 'contact_name'
  | 'contact_phone'
  | 'notes'
  | 'task_stops'
>;

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : '');

function stopKey(s: Pick<TaskStop, 'place_id' | 'google_place_id' | 'type' | 'place_name'>): string {
  return s.place_id ?? s.google_place_id ?? `${s.type}|${s.place_name.trim().toLowerCase()}`;
}

/** The stops in order with their keys; the same place twice gets #2, #3 so each stays itself. */
function seenStops(stops: readonly TaskStop[]): (SeenStop & { id: string })[] {
  const count = new Map<string, number>();
  return stops
    .filter((s) => s.status !== 'removed')
    .sort((a, b) => a.seq - b.seq)
    .map((s) => {
      const base = stopKey(s);
      const n = (count.get(base) ?? 0) + 1;
      count.set(base, n);
      return {
        id: s.id,
        key: n === 1 ? base : `${base}#${n}`,
        place: s.place_name,
        type: s.type,
        detail: [s.type, s.what ?? '', s.note ?? '', s.dwell_min ?? '', iso(s.arrive_by)].join('|'),
      };
    });
}

/** The copy to keep of the task as it is shown now (`opened`: the driver opened the task itself). */
export function seenCopy(task: CopyOf, now: number, opened = false): SeenCopy {
  return {
    at: now,
    opened,
    leave: iso(task.leave_by ?? task.start_at),
    endBy: task.end_by ? iso(task.end_by) : null,
    vehicle: [task.vehicle_id ?? '', vehicleMode(task), task.vehicle_type_wanted ?? ''].join('|'),
    title: task.title,
    passengers: task.passengers ?? null,
    contact: [task.contact_name ?? '', task.contact_phone ?? ''].join('|'),
    notes: task.notes ?? null,
    stops: seenStops(task.task_stops).map(({ id: _id, ...rest }) => rest),
  };
}

/** One stop the push named: its number in the order (after the change; a removed one's number before it), what, where. */
export interface PushStop {
  n: number;
  change: 'added' | 'removed' | 'moved' | 'changed';
  place: string;
}

/**
 * The office's "Task changed" push: which fields it named (data.changes: time, end_by, vehicle, title, stops,
 * passengers, notes) and, when stops names them, which stops.
 */
export interface PushChanges {
  /** When the push came (ms). */
  at: number;
  fields: ChangeField[];
  stops?: PushStop[];
}

/** data.changes.stops as a list: true names none; [{n, change, place}] or {list: [...], more} name them. */
export function pushStops(changes: unknown): PushStop[] {
  const value = changes && typeof changes === 'object' ? (changes as Record<string, unknown>).stops : null;
  const list = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as { list?: unknown }).list) ? (value as { list: unknown[] }).list : [];
  return list.flatMap((x): PushStop[] => {
    if (!x || typeof x !== 'object') return [];
    const { n, change, place } = x as Record<string, unknown>;
    if (typeof n !== 'number' || !['added', 'removed', 'moved', 'changed'].includes(String(change))) return [];
    return [{ n, change: change as PushStop['change'], place: typeof place === 'string' ? place : '' }];
  });
}

/** What a push's data.changes says, kept on the phone with the time it came. */
export function pushChanges(changes: unknown, at: number): PushChanges | null {
  const fields = pushChangeFields(changes);
  if (fields.length === 0) return null;
  const stops = pushStops(changes);
  return stops.length > 0 ? { at, fields, stops } : { at, fields };
}

const PUSH_FIELD: Record<string, ChangeField> = {
  time: 'leave',
  end_by: 'endBy',
  vehicle: 'vehicle',
  // J: the vehicle is now chosen on the day, or any vehicle of a type.
  vehicle_day: 'vehicle',
  vehicle_any: 'vehicle',
  title: 'title',
  stops: 'stops',
  passengers: 'passengers',
  notes: 'notes',
  contact: 'contact',
  contact_name: 'contact',
  contact_phone: 'contact',
};

/** The fields a push's data.changes names (a value of false or null names nothing; vehicle_day / vehicle_any are the vehicle). */
export function pushChangeFields(changes: unknown): ChangeField[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  const out = new Set<ChangeField>();
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    const field = PUSH_FIELD[key];
    if (field && value !== false && value !== null && value !== undefined) out.add(field);
  }
  return [...out];
}

export type StopChange = 'added' | 'moved' | 'changed';

export interface TaskChanges {
  fields: ChangeField[];
  /** The stops on the task now that are new, in another place in the order, or changed (by stop id). */
  stops: Record<string, StopChange>;
  /** Stops the driver saw that are gone now. */
  removed: { place: string; type: string }[];
}

export const NO_CHANGES: TaskChanges = { fields: [], stops: {}, removed: [] };

export function hasChanges(c: TaskChanges): boolean {
  return c.fields.length > 0 || Object.keys(c.stops).length > 0 || c.removed.length > 0;
}

/**
 * What changed since the copy the driver last saw, plus what a push named. No copy (a task the driver has not seen) and
 * no push: nothing is marked. A push older than a copy kept when the driver opened the task was seen with it.
 */
export function taskChanges(before: SeenCopy | null, task: CopyOf, push: PushChanges | null): TaskChanges {
  const fields = new Set<ChangeField>();
  const stops: Record<string, StopChange> = {};
  const removed: { place: string; type: string }[] = [];
  if (before) {
    const now = seenCopy(task, before.at);
    if (now.leave !== before.leave) fields.add('leave');
    if (now.endBy !== before.endBy) fields.add('endBy');
    if (now.vehicle !== before.vehicle) fields.add('vehicle');
    if (now.title !== before.title) fields.add('title');
    if (now.passengers !== before.passengers) fields.add('passengers');
    if (now.contact !== before.contact) fields.add('contact');
    if (now.notes !== before.notes) fields.add('notes');
    const was = new Map(before.stops.map((s, i) => [s.key, { i, s }]));
    const current = seenStops(task.task_stops);
    const keys = new Set(current.map((s) => s.key));
    current.forEach((s, i) => {
      const old = was.get(s.key);
      if (!old) stops[s.id] = 'added';
      else if (old.i !== i) stops[s.id] = 'moved';
      else if (old.s.detail !== s.detail) stops[s.id] = 'changed';
    });
    for (const s of before.stops) if (!keys.has(s.key)) removed.push({ place: s.place, type: s.type });
    if (Object.keys(stops).length > 0 || removed.length > 0) fields.add('stops');
  }
  if (push && (!before || !before.opened || push.at > before.at)) {
    for (const f of push.fields) fields.add(f);
    // The stops the push named, by their number in the order now (a removed one by its name, if the copy did not have it).
    const current = seenStops(task.task_stops);
    for (const s of push.stops ?? []) {
      if (s.change === 'removed') {
        if (s.place && !removed.some((r) => r.place === s.place)) removed.push({ place: s.place, type: '' });
        continue;
      }
      const stop = current[s.n - 1];
      if (stop && !stops[stop.id]) stops[stop.id] = s.change;
    }
  }
  return { fields: [...fields], stops, removed };
}
