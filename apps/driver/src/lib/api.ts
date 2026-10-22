// Every call the app makes to Supabase, as plain functions of a client. There
// is no phone-only code here, so these run unchanged in the tests
// (scripts/test-data-layer.ts) against a local Supabase stack.
//
// The database decides what a driver may do (Row Level Security + column
// privileges). The app only ever asks for its own rows.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from './database.types';
import { ASK_SELECT, type AskAnswer, type AskReply, type AskRow, parseAskRow } from './asks';
import { type AvailArgs, parseAvailAnswer, type UnavailabilityRow } from './availability';
import { type OfficeContacts, parseOfficeContacts, parseTaskContacts, type TaskContacts } from './contacts';
import type { LateReply } from './late';
import type { LicenceSide } from './profile';
import { parsePersonalTrips, type PersonalTrips } from './trips';
import type { Employee, FuelLog, Language, OdometerLog, TaskWithStops, Vehicle, VehicleReport } from './types';

export type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];

/** Drivers type a username; Supabase Auth needs an email. */
export const DRIVER_EMAIL_DOMAIN = 'drivers.fame.invalid';

/**
 * The vehicle columns a driver is allowed to read. Always select exactly these
 * by name: `select *` on vehicles is refused by the database. The photo's two
 * paths (Phase 7 §6) are signed by the app itself (lib/signedUrls.ts).
 */
export const VEHICLE_COLUMNS =
  'id, reg_no, make_model, vehicle_type, seats, current_odometer_km, monthly_km_allowance, in_garage, active, photo_path, photo_thumb_path' as const;

/** The private buckets the app reads or writes. */
export const BUCKETS = { driverPhotos: 'driver-photos', vehiclePhotos: 'vehicle-photos', vehicleDocs: 'vehicle-docs' } as const;

/**
 * `permanent` = the server refused this request and will refuse it again
 * (a rule was broken). Otherwise it is a connection or server hiccup and the
 * same request can be tried again later.
 */
export class ApiError extends Error {
  constructor(message: string, readonly permanent: boolean, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Result {
  data: unknown;
  error: PostgrestError | null;
  status: number;
}

function fail(res: Result, what: string): never {
  // No status / no error code = the request never got an answer. 401 = the
  // sign-in token expired mid-flight; it is refreshed before the next try.
  const retryLater =
    res.status === 0 || res.status >= 500 || res.status === 401 || res.status === 408 || res.status === 429 || !res.error?.code;
  throw new ApiError(`${what}: ${res.error?.message ?? 'no answer'}`, !retryLater, res.error?.code, res.status || undefined);
}

/** The data of a successful request; throws ApiError otherwise. */
function check<R extends Result>(res: R, what: string): NonNullable<R['data']> {
  if (res.error) fail(res, what);
  return res.data as NonNullable<R['data']>;
}

/** Like check, for requests that may find nothing (maybeSingle). */
function checkMaybe<R extends Result>(res: R, what: string): R['data'] {
  if (res.error) fail(res, what);
  return res.data;
}

// ---------------------------------------------------------------------------
// Sign-in and reading
// ---------------------------------------------------------------------------

export type SignInResult = 'ok' | 'wrong' | 'network';

export async function signIn(client: Client, username: string, pin: string): Promise<SignInResult> {
  const email = `${username.trim().toLowerCase()}@${DRIVER_EMAIL_DOMAIN}`;
  const { error } = await client.auth.signInWithPassword({ email, password: pin });
  if (!error) return 'ok';
  return error.status !== undefined && error.status >= 400 && error.status < 500 ? 'wrong' : 'network';
}

/** The signed-in driver's own employee row, or null when the account is switched off. */
export async function fetchMe(client: Client): Promise<Employee | null> {
  return checkMaybe(await client.from('employees').select('*').maybeSingle(), 'employee');
}

/** The only fleet settings a driver may read (Phase 6): the shift nudge's time and days (0 = Sunday … 6 = Saturday). */
export interface ChecklistItem {
  key: string;
  en: string;
  si: string;
}
export interface DriverSettings {
  shift_start: string;
  shift_days: number[];
  /** The steps to show in order while recording a fuel video (Phase 6, Part 3 and 3b), in both languages; the last unlocks Stop. */
  fuel_video_checklist: ChecklistItem[];
  /** The recording quality the office chose: 480p (default) or 720p. */
  fuel_video_quality: '480p' | '720p';
  /** Phase 7 §13: whether Start a trip offers Personal (allowed, default = preselected, off; ask_first behaves as allowed). */
  driver_personal_trips: PersonalTrips;
  /** Part 3b (H1): a morning ends and an afternoon starts here (HH:MM, 13:00 by default). */
  half_day_split: string;
  /** Part 6: the office's map package; the phone's map follows it (google: Google's map while it loads; open: the free map). */
  map_package: 'google' | 'open';
  /** Part 6: seconds to wait for Google's map to finish loading while online before showing the free map (30 by default). */
  phone_map_wait_s: number;
  /**
   * Round 4–7 (§33): the office's five switches (Settings → Dispatch; no row = on). vehicle_check: the check before work
   * (off: nothing asks and Start task is never held); trip_close_prompt, fuel_card, passengers, holder_contact: the other
   * features of the round.
   */
  vehicle_check: boolean;
  trip_close_prompt: boolean;
  fuel_card: boolean;
  passengers: boolean;
  holder_contact: boolean;
}
/** The five switches of Round 4–7, each on unless the server says false. */
export const FEATURE_SWITCHES = ['vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact'] as const;
export type FeatureSwitch = (typeof FEATURE_SWITCHES)[number];
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: 'plate', en: 'Number plate', si: 'අංක තහඩුව' },
  { key: 'zero', en: 'Pump display at zero before pumping', si: 'පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ' },
  { key: 'pumping', en: 'Pumping', si: 'පොම්ප කරමින්' },
  { key: 'final', en: 'Final pump display: litres and amount', si: 'අවසාන පොම්ප තිරය: ලීටර් සහ මුදල' },
];
/** Monday to Friday by default (the office is closed on Saturday and Sunday). */
export const DEFAULT_DRIVER_SETTINGS: DriverSettings = {
  shift_start: '08:00',
  shift_days: [1, 2, 3, 4, 5],
  fuel_video_checklist: DEFAULT_CHECKLIST,
  fuel_video_quality: '480p',
  driver_personal_trips: 'allowed',
  half_day_split: '13:00',
  map_package: 'google',
  phone_map_wait_s: 30,
  vehicle_check: true,
  trip_close_prompt: true,
  fuel_card: true,
  passengers: true,
  holder_contact: true,
};

/** A switch as the server answered it: on unless it is exactly false (absent, from a server before Round 4–7, is on). */
export function switchOn(value: unknown): boolean {
  return value !== false;
}

export async function fetchDriverSettings(client: Client): Promise<DriverSettings> {
  const res = await client.rpc('get_driver_settings');
  const value = check(res, 'settings') as Partial<DriverSettings> | null;
  const start = typeof value?.shift_start === 'string' && /^\d{2}:\d{2}$/.test(value.shift_start) ? value.shift_start : DEFAULT_DRIVER_SETTINGS.shift_start;
  const days = Array.isArray(value?.shift_days) ? value.shift_days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_DRIVER_SETTINGS.shift_days;
  const list = Array.isArray(value?.fuel_video_checklist)
    ? value.fuel_video_checklist
      .filter((i): i is ChecklistItem => !!i && typeof i === 'object' && typeof i.key === 'string' && typeof i.en === 'string')
      .map((i) => ({ key: i.key, en: i.en, si: typeof i.si === 'string' && i.si ? i.si : i.en }))
    : [];
  const quality = value?.fuel_video_quality === '720p' ? '720p' : '480p';
  const split = typeof value?.half_day_split === 'string' && /^\d{2}:\d{2}/.test(value.half_day_split)
    ? value.half_day_split.slice(0, 5)
    : DEFAULT_DRIVER_SETTINGS.half_day_split;
  return {
    shift_start: start,
    shift_days: days,
    fuel_video_checklist: list.length ? list : DEFAULT_CHECKLIST,
    fuel_video_quality: quality,
    driver_personal_trips: parsePersonalTrips(value?.driver_personal_trips),
    half_day_split: split,
    map_package: value?.map_package === 'open' ? 'open' : 'google',
    phone_map_wait_s: typeof value?.phone_map_wait_s === 'number' && Number.isInteger(value.phone_map_wait_s) && value.phone_map_wait_s >= 1 && value.phone_map_wait_s <= 120
      ? value.phone_map_wait_s
      : DEFAULT_DRIVER_SETTINGS.phone_map_wait_s,
    vehicle_check: switchOn(value?.vehicle_check),
    trip_close_prompt: switchOn(value?.trip_close_prompt),
    fuel_card: switchOn(value?.fuel_card),
    passengers: switchOn(value?.passengers),
    holder_contact: switchOn(value?.holder_contact),
  };
}

/** Part 6: whether Google's map loaded on this phone (lib/mapEngine.ts); the office's issue follows it. */
export async function reportMapState(client: Client, report: { google_ok: boolean; reason: 'timeout' | 'error' | null; at: string; app_version: string }): Promise<string> {
  const res = await client.rpc('report_map_state', { p_google_ok: report.google_ok, p_reason: report.reason ?? '', p_at: report.at, p_app_version: report.app_version });
  return check(res, 'map report') as string;
}

export type FuelVideoPatch = Pick<Tables['fuel_logs']['Update'], 'video_status' | 'video_uploaded_at' | 'video_bytes'>;

/** The upload's progress on the fuel log row (own rows only, the video columns only). */
export async function patchFuelVideo(client: Client, id: string, patch: FuelVideoPatch): Promise<void> {
  check(await client.from('fuel_logs').update(patch).eq('id', id), 'fuel video');
}

/** The row's video status (the last piece of an interrupted fill looks before marking the fill uploaded). */
export async function fetchFuelVideoStatus(client: Client, id: string): Promise<string | null> {
  const row = checkMaybe(await client.from('fuel_logs').select('video_status').eq('id', id).maybeSingle(), 'fuel video');
  return row?.video_status ?? null;
}

export async function fetchVehicles(client: Client): Promise<Vehicle[]> {
  return check(await client.from('vehicles').select(VEHICLE_COLUMNS).order('reg_no'), 'vehicles');
}

/**
 * Tasks still to do or under way, plus everything that starts at or after `since`. Never a missed one (Hotfix 3: never
 * started, its leave-by over a day ago): the app shows it nowhere.
 */
export async function fetchTasks(client: Client, since: Date): Promise<TaskWithStops[]> {
  const tasks = check(
    await client
      .from('tasks')
      .select('*, task_stops(*), task_vehicle_segments(*)')
      .or(`status.in.(assigned,in_progress),start_at.gte."${since.toISOString()}"`)
      .neq('status', 'missed')
      .order('start_at'),
    'tasks',
  );
  // A stop the office edited out stays in the table as 'removed' and is shown nowhere.
  // A vehicle swap during the task (Phase 7) keeps each vehicle's stretch, in order.
  return tasks.map((task) => ({
    ...task,
    task_stops: task.task_stops.filter((stop) => stop.status !== 'removed').sort((a, b) => a.seq - b.seq),
    task_vehicle_segments: [...(task.task_vehicle_segments ?? [])].sort((a, b) => a.seq - b.seq),
  }));
}

/** Our own places (offices, stores, saved places; not the operators' sites), for Start a trip with no connection (Phase 7 §13). */
export type OurPlace = Pick<Tables['places']['Row'], 'id' | 'name' | 'address' | 'lat' | 'lng' | 'site_id' | 'kind'>;

export async function fetchOurPlaces(client: Client, limit = 500): Promise<OurPlace[]> {
  return check(
    await client.from('places').select('id, name, address, lat, lng, site_id, kind').eq('active', true).is('removed_at', null)
      .neq('kind', 'site').order('name').limit(limit),
    'places',
  );
}

export async function fetchTaskStatus(client: Client, id: string): Promise<string | null> {
  const row = checkMaybe(await client.from('tasks').select('status').eq('id', id).maybeSingle(), 'task');
  return row?.status ?? null;
}

/** My newest reports (kept on the phone; the Report tab asks for older ones with fetchReportsBefore). */
export async function fetchReports(client: Client): Promise<VehicleReport[]> {
  return check(
    await client.from('vehicle_reports').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30),
    'reports',
  );
}

/** The filter for the reports below this one, newest first (created_at, then id): the order fetchReports and the Report tab use. */
export function reportsOlderThan(before: ReportCursor): string {
  return `created_at.lt."${before.created_at}",and(created_at.eq."${before.created_at}",id.lt.${before.id})`;
}

export interface ReportCursor {
  created_at: string;
  id: string;
}

/**
 * Hotfix 3 (L6): my reports older than `before` (all of them when null), newest first, `limit` at a time, and how many
 * there are below `before` in all (`limit` 0 only counts them).
 */
export async function fetchReportsBefore(
  client: Client,
  before: ReportCursor | null,
  limit: number,
): Promise<{ rows: VehicleReport[]; older: number }> {
  if (limit <= 0) {
    const head = client.from('vehicle_reports').select('id', { count: 'exact', head: true });
    const res = await (before ? head.or(reportsOlderThan(before)) : head);
    if (res.error) fail(res, 'reports');
    return { rows: [], older: res.count ?? 0 };
  }
  const query = client.from('vehicle_reports').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  const res = await (before ? query.or(reportsOlderThan(before)) : query);
  const rows = check(res, 'reports');
  return { rows, older: res.count ?? rows.length };
}

export interface Mileage {
  /** My last reading for this vehicle before the month began, if any. */
  baselineKm: number | null;
  /** My readings for this vehicle this month, oldest first. */
  odometer: OdometerLog[];
  /** My fuel entries this month (all vehicles), newest first. */
  fuel: FuelLog[];
}

export async function fetchMileage(client: Client, vehicleId: string | null, monthStart: Date): Promise<Mileage> {
  const from = monthStart.toISOString();
  const fuelQuery = client.from('fuel_logs').select('*').gte('logged_at', from).order('logged_at', { ascending: false }).limit(200);
  if (!vehicleId) return { baselineKm: null, odometer: [], fuel: check(await fuelQuery, 'fuel') };

  const [before, inMonth, fuel] = await Promise.all([
    client.from('odometer_logs').select('reading_km').eq('vehicle_id', vehicleId).lt('logged_at', from)
      .order('logged_at', { ascending: false }).limit(1),
    client.from('odometer_logs').select('*').eq('vehicle_id', vehicleId).gte('logged_at', from).order('logged_at').limit(1000),
    fuelQuery,
  ]);
  return {
    baselineKm: check(before, 'odometer')[0]?.reading_km ?? null,
    odometer: check(inMonth, 'odometer'),
    fuel: check(fuel, 'fuel'),
  };
}

// ---------------------------------------------------------------------------
// Writing. Rows carry an id made on the phone, and inserts ignore a duplicate
// id: sending the same thing twice (after a lost answer) is harmless.
// ---------------------------------------------------------------------------

export type TaskPatch = Pick<
  Tables['tasks']['Update'],
  'seen_at' | 'started_at' | 'completed_at' | 'start_odometer_km' | 'end_odometer_km' | 'status'
>;
export type StopPatch = Pick<
  Tables['task_stops']['Update'],
  'status' | 'arrived_at' | 'done_at' | 'skip_reason' | 'skip_note' | 'auto_detected_at' | 'arrival_flag' | 'arrival_distance_m' | 'confirmed_later_at'
>;
export type OdometerInsert = Tables['odometer_logs']['Insert'] & { id: string };
export type FuelInsert = Tables['fuel_logs']['Insert'] & { id: string };
export type ReportInsert = Pick<
  Tables['vehicle_reports']['Insert'],
  'vehicle_id' | 'employee_id' | 'task_id' | 'category' | 'note' | 'created_at' | 'needs_vehicle' | 'check_id'
> & { id: string };
export type PhotoInsert = Pick<
  Tables['photos']['Insert'],
  'employee_id' | 'kind' | 'storage_path' | 'taken_at' | 'lat' | 'lng' | 'vehicle_report_id' | 'vehicle_check_id' | 'side'
> & { id: string };
/** Round 4–7 (§33.1): a vehicle check before work, as the driver may write it (the insert grant's columns). */
export type VehicleCheckInsert = Pick<
  Tables['vehicle_checks']['Insert'],
  'vehicle_id' | 'employee_id' | 'task_id' | 'checked_at' | 'result' | 'odometer_km' | 'how'
> & { id: string };
export type PointInsert = Pick<
  Tables['location_points']['Insert'],
  'employee_id' | 'session_id' | 'recorded_at' | 'lat' | 'lng' | 'accuracy_m' | 'speed_mps' | 'heading' | 'battery_pct' | 'is_mock'
>;
export interface SessionStart {
  id: string;
  employee_id: string;
  vehicle_id: string | null;
  started_at: string;
  device_info: Json;
}

export type AcceptAnswer = 'accepted' | 'declined' | 'already_started' | 'already_reassigned' | 'already_declined' | 'cancelled';
export type DeclineReason = 'vehicle_problem' | 'not_available' | 'unwell' | 'other';

/** Accept a task. The server keeps the earliest time; an answer other than 'accepted' says why nothing changed. */
export async function acceptTask(client: Client, id: string, at: string): Promise<AcceptAnswer> {
  const res = await client.rpc('accept_task', { p_task_id: id, p_at: at });
  return check(res, 'accept') as AcceptAnswer;
}

/** Decline a task with a reason. Only while it is still assigned to this driver. */
export async function declineTask(client: Client, id: string, reason: DeclineReason, note: string | null, at: string): Promise<AcceptAnswer> {
  const res = await client.rpc('decline_task', { p_task_id: id, p_reason: reason, p_note: note ?? undefined, p_at: at });
  return check(res, 'decline') as AcceptAnswer;
}

export async function patchTask(client: Client, id: string, patch: TaskPatch): Promise<void> {
  const rows = check(await client.from('tasks').update(patch).eq('id', id).select('id'), 'task');
  if (rows.length === 0) throw new ApiError('task: it is no longer assigned to this driver', true, 'gone');
}

/** Marks a stop. Has no effect (and is not an error) once the task is no longer in progress. */
export async function patchStop(client: Client, id: string, patch: StopPatch): Promise<void> {
  check(await client.from('task_stops').update(patch).eq('id', id), 'stop');
}

export async function patchEmployee(
  client: Client,
  id: string,
  patch: { current_vehicle_id?: string | null; language?: Language },
): Promise<void> {
  check(await client.from('employees').update(patch).eq('id', id), 'employee');
}

/** Starts a sharing period. An older one left open (app removed, phone died) is closed first. */
export async function startSession(client: Client, session: SessionStart): Promise<void> {
  check(
    await client.from('duty_sessions').update({ ended_at: session.started_at, end_reason: 'auto' })
      .eq('employee_id', session.employee_id).is('ended_at', null).neq('id', session.id),
    'sharing',
  );
  check(await client.from('duty_sessions').upsert(session, { onConflict: 'id', ignoreDuplicates: true }), 'sharing');
}

export async function endSession(client: Client, id: string, endedAt: string, reason: 'driver' | 'auto'): Promise<void> {
  check(
    await client.from('duty_sessions').update({ ended_at: endedAt, end_reason: reason }).eq('id', id).is('ended_at', null),
    'sharing',
  );
}

/** Registers a finished sharing period after the fact (used to rescue points whose period never reached the server). */
export async function insertClosedSession(
  client: Client,
  session: { id: string; employee_id: string; started_at: string; ended_at: string },
): Promise<void> {
  check(
    await client.from('duty_sessions').upsert({ ...session, end_reason: 'auto' }, { onConflict: 'id', ignoreDuplicates: true }),
    'sharing',
  );
}

/** A batch of points that gets no answer in this long is tried again later (a stalled connection must not block the queue). */
export const UPLOAD_TIMEOUT_MS = 45_000;

export async function insertPoints(client: Client, points: PointInsert[]): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    check(
      await client
        .from('location_points')
        .upsert(points, { onConflict: 'employee_id,recorded_at', ignoreDuplicates: true })
        .abortSignal(controller.signal),
      'location',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the phone reports about itself (lib/heartbeat.ts): the newest one goes to driver_latest through
 * send_heartbeat(); every one is also kept in driver_heartbeats (insertHeartbeats, in batches, also after an outage).
 */
export interface HeartbeatRow {
  /** Phone time, ISO. The server never stores it later than its own clock. */
  at: string;
  sharing: boolean;
  location_on: boolean;
  permission: 'always' | 'foreground' | 'denied' | 'unknown';
  battery_pct: number | null;
  app_version: string | null;
  queued_points: number;
  /** Points the server refused and the phone keeps (sync/store.ts). */
  rejected_points?: number;
  /** Whether the phone had a data connection. */
  data_available?: boolean | null;
  app_state?: 'foreground' | 'background';
  /** Seconds since a usable GPS fix was last seen. */
  fix_age_s?: number | null;
  session_id?: string | null;
  /** Fixes seen and what became of them since the last heartbeat. */
  fixes_seen?: number;
  fixes_stored?: number;
  dropped_accuracy?: number;
  dropped_jump?: number;
  dropped_jitter?: number;
  dropped_duplicate?: number;
  /** Fuel videos still on the phone, and their bytes still to go (Phase 6, Part 3). */
  video_uploads_waiting?: number;
  video_bytes_waiting?: number;
  /** How often the watchdog restarted the location service since the previous heartbeat (history only). */
  location_restarts?: number;
}

/**
 * The heartbeat's answer: whether the office is watching this driver right now (the phone then uploads every 10 s while
 * moving), and (Phase 7) whether the server has the driver on duty, with how the last duty ended when not: the app stops
 * by itself after a clock-out whose push it missed. on_duty is null from a server that does not say.
 */
export interface HeartbeatAnswer {
  watched: boolean;
  on_duty: boolean | null;
  duty_end: { at: string; reason: 'driver' | 'auto' | 'admin' } | null;
}

export async function sendHeartbeat(client: Client, row: HeartbeatRow): Promise<HeartbeatAnswer> {
  const res = await client.rpc('send_heartbeat', {
    p_at: row.at,
    p_sharing: row.sharing,
    p_location_on: row.location_on,
    p_permission: row.permission,
    p_battery_pct: row.battery_pct ?? undefined,
    p_app_version: row.app_version ?? undefined,
    p_queued_points: row.queued_points,
    p_rejected_points: row.rejected_points ?? undefined,
    p_data_available: row.data_available ?? undefined,
    p_app_state: row.app_state ?? undefined,
    p_fix_age_s: row.fix_age_s ?? undefined,
    p_video_uploads_waiting: row.video_uploads_waiting ?? undefined,
    p_video_bytes_waiting: row.video_bytes_waiting ?? undefined,
  });
  if (res.error) fail(res, 'heartbeat');
  const data = res.data as { watched?: unknown; on_duty?: unknown; duty_end?: { at?: unknown; reason?: unknown } | null } | null;
  const end = data?.duty_end;
  return {
    watched: data?.watched === true,
    on_duty: typeof data?.on_duty === 'boolean' ? data.on_duty : null,
    duty_end: end && typeof end.at === 'string' && (end.reason === 'driver' || end.reason === 'auto' || end.reason === 'admin')
      ? { at: end.at, reason: end.reason }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Phase 7: the driver's day (vehicle_assignments, my_vehicle_choices, change_vehicle).
// ---------------------------------------------------------------------------

/** A vehicle in the picker: who holds it now (first name), and whether it is mine now, my last or my regular one. */
export interface VehicleChoice {
  id: string;
  reg_no: string;
  make_model: string | null;
  vehicle_type: string | null;
  seats: number | null;
  in_garage: boolean;
  current_odometer_km: number | null;
  held_by: string | null;
  held_since: string | null;
  mine_now: boolean;
  my_last: boolean;
  my_regular: boolean;
}

export async function fetchVehicleChoices(client: Client): Promise<VehicleChoice[]> {
  const res = await client.rpc('my_vehicle_choices');
  if (res.error) fail(res, 'vehicles');
  return Array.isArray(res.data) ? (res.data as unknown as VehicleChoice[]) : [];
}

/** Change vehicle (null = no vehicle) at the phone's time; the same id twice changes nothing. Answers the vehicle held after. */
export async function changeVehicle(client: Client, vehicleId: string | null, at: string, clientId: string): Promise<string | null> {
  const res = await client.rpc('change_vehicle', { p_vehicle: vehicleId as string, p_at: at, p_client: clientId });
  if (res.error) fail(res, 'vehicle');
  const data = res.data as { vehicle_id?: unknown } | null;
  return typeof data?.vehicle_id === 'string' ? data.vehicle_id : null;
}

export type Assignment = Pick<
  Tables['vehicle_assignments']['Row'],
  'id' | 'vehicle_id' | 'from_at' | 'to_at' | 'how' | 'ended_how' | 'ended_by_name'
>;

/** My latest vehicle rows (newest first): the "taken over" banner reads the newest. */
export async function fetchMyAssignments(client: Client, limit = 5): Promise<Assignment[]> {
  return check(
    await client.from('vehicle_assignments').select('id, vehicle_id, from_at, to_at, how, ended_how, ended_by_name')
      .order('from_at', { ascending: false }).order('created_at', { ascending: false }).limit(limit),
    'vehicle history',
  );
}

// ---------------------------------------------------------------------------
// Hotfix 2: the vehicle of a task made without one (J), and who to call (F, K).
// ---------------------------------------------------------------------------

/**
 * The vehicle of a task made without one, before Start task (confirm_task_vehicle): 'ok', or the refusal
 * ('not_yours' | 'started' | 'has_vehicle' | 'inactive' | 'in_garage' | 'wrong_type'). Only the task's own driver.
 */
export async function confirmTaskVehicle(client: Client, taskId: string, vehicleId: string, queued = false): Promise<string> {
  const res = await client.rpc('confirm_task_vehicle', { p_task: taskId, p_vehicle: vehicleId, p_queued: queued });
  if (res.error) fail(res, 'task vehicle');
  return typeof res.data === 'string' ? res.data : '';
}

/** Who to call about one of my tasks (my_task_contacts): null when the server has nothing for me. */
export async function fetchTaskContacts(client: Client, taskId: string): Promise<TaskContacts | null> {
  const res = await client.rpc('my_task_contacts', { p_task: taskId });
  if (res.error) fail(res, 'task contacts');
  return parseTaskContacts(res.data);
}

/** Me → Call office and Call fleet admin (my_office_contacts). */
export async function fetchOfficeContacts(client: Client): Promise<OfficeContacts | null> {
  const res = await client.rpc('my_office_contacts');
  if (res.error) fail(res, 'office contacts');
  return parseOfficeContacts(res.data);
}

/** The heartbeat history: a batch of rows into driver_heartbeats; one already there (same time) is ignored. */
export async function insertHeartbeats(client: Client, employeeId: string, rows: HeartbeatRow[]): Promise<void> {
  const inserts = rows.map((row) => ({
    employee_id: employeeId,
    at: row.at,
    session_id: row.session_id ?? null,
    sharing: row.sharing,
    location_on: row.location_on,
    permission: row.permission,
    battery_pct: row.battery_pct,
    app_state: row.app_state ?? null,
    data_available: row.data_available ?? null,
    fixes_seen: row.fixes_seen ?? null,
    fixes_stored: row.fixes_stored ?? null,
    dropped_accuracy: row.dropped_accuracy ?? null,
    dropped_jump: row.dropped_jump ?? null,
    dropped_jitter: row.dropped_jitter ?? null,
    dropped_duplicate: row.dropped_duplicate ?? null,
    video_uploads_waiting: row.video_uploads_waiting ?? null,
    video_bytes_waiting: row.video_bytes_waiting ?? null,
    location_restarts: row.location_restarts ?? null,
    last_gps_fix_age_s: row.fix_age_s ?? null,
    queued_points: row.queued_points,
    rejected_points: row.rejected_points ?? null,
    app_version: row.app_version,
  }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    check(
      await client.from('driver_heartbeats').upsert(inserts, { onConflict: 'employee_id,at', ignoreDuplicates: true }).abortSignal(controller.signal),
      'heartbeats',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function insertPhoto(client: Client, photo: PhotoInsert): Promise<void> {
  check(await client.from('photos').upsert(photo, { onConflict: 'id', ignoreDuplicates: true }), 'photo');
}

export async function insertOdometerLog(client: Client, row: OdometerInsert): Promise<void> {
  check(await client.from('odometer_logs').upsert(row, { onConflict: 'id', ignoreDuplicates: true }), 'odometer');
}

export async function insertFuelLog(client: Client, row: FuelInsert): Promise<void> {
  check(await client.from('fuel_logs').upsert(row, { onConflict: 'id', ignoreDuplicates: true }), 'fuel');
}

export async function insertReport(client: Client, row: ReportInsert): Promise<void> {
  check(await client.from('vehicle_reports').upsert(row, { onConflict: 'id', ignoreDuplicates: true }), 'report');
}

/** Round 4–7 (§33.1): a vehicle check (a resend after a lost answer changes nothing: the id is the phone's). */
export async function insertVehicleCheck(client: Client, row: VehicleCheckInsert): Promise<void> {
  check(await client.from('vehicle_checks').upsert(row, { onConflict: 'id', ignoreDuplicates: true }), 'vehicle check');
}

/** The columns of my vehicle checks the phone keeps (lib/vehicleCheck.ts VehicleCheck). */
export const CHECK_COLUMNS = 'id, vehicle_id, employee_id, task_id, checked_at, result, odometer_km, how' as const;

/** My vehicle checks since `since` (today's, read back on refresh and after a fresh sign-in), oldest first. */
export async function fetchMyChecks(client: Client, since: Date): Promise<VehicleCheckInsert[]> {
  return check(
    await client.from('vehicle_checks').select(CHECK_COLUMNS).gte('checked_at', since.toISOString()).order('checked_at').limit(200),
    'vehicle checks',
  );
}

// ---------------------------------------------------------------------------
// Phase 7 Part 3: the driver's photo (§5), vehicle photos (§6), the held vehicle's documents (§28).
// ---------------------------------------------------------------------------

/** The driver's photo is set when its file is in the bucket, its row in photos, and set_my_photo answered 'ok'. */
export type MyPhotoAnswer = 'ok' | 'not_yours';

export async function setMyPhoto(client: Client, photoId: string): Promise<MyPhotoAnswer> {
  const res = await client.rpc('set_my_photo', { p_photo_id: photoId });
  return check(res, 'my photo') as MyPhotoAnswer;
}

/**
 * "Add your photo" and Change photo: sent at once, not queued (the step needs it done). The file first (`upload`, the
 * same request the queue makes; a file already there counts), then the photos row, then set_my_photo. Each step can
 * be repeated after a lost answer.
 */
export async function saveProfilePhoto(
  client: Client,
  photo: { id: string; employee_id: string; storage_path: string; taken_at: string },
  upload: (storagePath: string) => Promise<void>,
): Promise<MyPhotoAnswer> {
  await upload(photo.storage_path);
  await insertPhoto(client, { ...photo, kind: 'profile', lat: null, lng: null, vehicle_report_id: null });
  return setMyPhoto(client, photo.id);
}

/** Where one of my photos is in the bucket (the Me tab signs it), or null. */
export async function fetchPhotoPath(client: Client, photoId: string): Promise<string | null> {
  const row = checkMaybe(await client.from('photos').select('storage_path').eq('id', photoId).maybeSingle(), 'photo');
  return row?.storage_path ?? null;
}

/** A vehicle's photo from this phone: the server takes it only while the vehicle has none ('has_photo' otherwise). */
export async function setVehiclePhotoFromDriver(client: Client, vehicleId: string, path: string, thumbPath: string): Promise<string> {
  const res = await client.rpc('set_vehicle_photo_from_driver', { p_vehicle_id: vehicleId, p_path: path, p_thumb_path: thumbPath });
  return check(res, 'vehicle photo') as string;
}

/** The vehicle's photo now: `active` false when the vehicle is gone (a driver reads active vehicles only). */
export async function fetchVehiclePhoto(client: Client, vehicleId: string): Promise<{ active: boolean; path: string | null }> {
  const row = checkMaybe(await client.from('vehicles').select('id, photo_path').eq('id', vehicleId).maybeSingle(), 'vehicle');
  return { active: row !== null, path: row?.photo_path ?? null };
}

/** The vehicle I hold now (my open assignment), or null. */
export async function fetchHeldVehicle(client: Client): Promise<string | null> {
  const res = await client.rpc('my_held_vehicle');
  if (res.error) fail(res, 'held vehicle');
  return typeof res.data === 'string' ? res.data : null;
}

export type VehicleDocument = Pick<
  Tables['vehicle_documents']['Row'],
  'id' | 'vehicle_id' | 'kind' | 'name' | 'path' | 'content_type' | 'expiry' | 'uploaded_at'
>;

/** The held vehicle's revenue licence, insurance and emission test (the database returns nothing else to a driver). */
export async function fetchVehicleDocuments(client: Client): Promise<VehicleDocument[]> {
  return check(
    await client.from('vehicle_documents').select('id, vehicle_id, kind, name, path, content_type, expiry, uploaded_at')
      .order('uploaded_at', { ascending: false }),
    'documents',
  );
}

// ---------------------------------------------------------------------------
// Part 3b: the driver's profile (G), availability (H1), questions from the office (H3), running late (H4).
// ---------------------------------------------------------------------------

/** Me's "This month": my completed tasks since the month began (their km). */
export async function fetchMonthTasks(client: Client, employeeId: string, monthStart: Date): Promise<{ km: number | null }[]> {
  return check(
    await client.from('tasks').select('id, km').eq('employee_id', employeeId).eq('status', 'completed')
      .gte('completed_at', monthStart.toISOString()).limit(1000),
    'month',
  );
}

/** A licence photo is set when its file is in my folder, its row in photos (kind licence) and the RPC answered 'ok'. */
export type LicencePhotoAnswer = 'ok' | 'not_yours';

export async function setMyLicencePhoto(client: Client, side: LicenceSide, photoId: string): Promise<LicencePhotoAnswer> {
  const res = await client.rpc('set_my_licence_photo', { p_side: side, p_photo_id: photoId });
  return check(res, 'licence photo') as LicencePhotoAnswer;
}

/** The licence's front or back from Me → Edit: sent at once (online only), like the profile photo; each step repeats safely. */
export async function saveLicencePhoto(
  client: Client,
  photo: { id: string; employee_id: string; storage_path: string; taken_at: string },
  side: LicenceSide,
  upload: (storagePath: string) => Promise<void>,
): Promise<LicencePhotoAnswer> {
  await upload(photo.storage_path);
  await insertPhoto(client, { ...photo, kind: 'licence', lat: null, lng: null, vehicle_report_id: null });
  return setMyLicencePhoto(client, side, photo.id);
}

const UNAVAILABILITY_COLUMNS = 'id, starts_at, ends_at, part, reason, note, created_by_name, created_by_employee_id, channel, removed_at' as const;

/** My entries still ahead (or running now), soonest first (Me → Availability). */
export async function fetchMyUnavailability(client: Client, employeeId: string, now: Date): Promise<UnavailabilityRow[]> {
  return check(
    await client.from('driver_unavailability').select(UNAVAILABILITY_COLUMNS).eq('employee_id', employeeId)
      .gt('ends_at', now.toISOString()).is('removed_at', null).order('starts_at').limit(100),
    'availability',
  );
}

/** Adds (p_id null) or changes one of my entries: ok with its id, or the refusal's words. */
export async function setMyUnavailability(client: Client, args: AvailArgs): Promise<{ result: 'ok'; id: string | null } | { result: 'refused'; reason: string }> {
  // The function has no defaults: null goes as null (the generated types say string).
  const res = await client.rpc('set_my_unavailability', args as unknown as Database['public']['Functions']['set_my_unavailability']['Args']);
  return parseAvailAnswer(check(res, 'availability'));
}

/** Removes one of my entries (kept on the server as removed): 'ok', or 'not_found' when it is gone already. */
/** 'office' = the office added it (theirs to remove); 'past' = it has ended (kept as it was). */
export async function removeMyUnavailability(client: Client, id: string): Promise<'ok' | 'not_found' | 'office' | 'past'> {
  const res = check(await client.rpc('remove_my_unavailability', { p_id: id }), 'availability');
  return res === 'ok' || res === 'office' || res === 'past' ? res : 'not_found';
}

/** The questions I was asked that are still open (or closed since `since`), newest first. */
export async function fetchMyAsks(client: Client, employeeId: string, since: Date): Promise<AskRow[]> {
  const rows = check(
    await client.from('driver_ask_answers').select(ASK_SELECT).eq('employee_id', employeeId)
      .gt('driver_asks.expires_at', since.toISOString()).order('sent_at', { ascending: false }).limit(20),
    'questions',
  ) as unknown[];
  return rows.map(parseAskRow).filter((row): row is AskRow => row !== null);
}

/** One question I was asked, open or closed (the ask screen), or null when it is not mine (or gone after 30 days). */
export async function fetchMyAsk(client: Client, employeeId: string, askId: string): Promise<AskRow | null> {
  const row = checkMaybe(
    await client.from('driver_ask_answers').select(ASK_SELECT).eq('employee_id', employeeId).eq('ask_id', askId).maybeSingle(),
    'question',
  );
  return parseAskRow(row);
}

/** Answers (or, with 'seen', opens) a question at the phone's time. */
export async function answerAsk(
  client: Client,
  askId: string,
  answer: AskAnswer | 'seen',
  fields: { answer_at?: string | null; lat?: number | null; lng?: number | null; accuracy_m?: number | null },
  at: string,
): Promise<AskReply> {
  const res = await client.rpc('answer_ask', {
    p_ask_id: askId,
    p_answer: answer,
    p_answer_at: fields.answer_at ?? undefined,
    p_lat: fields.lat ?? undefined,
    p_lng: fields.lng ?? undefined,
    p_accuracy: fields.accuracy_m ?? undefined,
    p_at: at,
  });
  return check(res, 'answer') as AskReply;
}

/** "Running late" by `minutes`, said at the phone's time (the server keeps the latest report). */
export async function reportRunningLate(client: Client, taskId: string, minutes: number, at: string): Promise<LateReply> {
  const res = await client.rpc('report_running_late', { p_task_id: taskId, p_minutes: minutes, p_at: at });
  return check(res, 'running late') as LateReply;
}
