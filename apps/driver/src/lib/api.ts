// Every call the app makes to Supabase, as plain functions of a client. There
// is no phone-only code here, so these run unchanged in the tests
// (scripts/test-data-layer.ts) against a local Supabase stack.
//
// The database decides what a driver may do (Row Level Security + column
// privileges). The app only ever asks for its own rows.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from './database.types';
import type { Employee, FuelLog, Language, OdometerLog, TaskWithStops, Vehicle, VehicleReport } from './types';

export type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];

/** Drivers type a username; Supabase Auth needs an email. */
export const DRIVER_EMAIL_DOMAIN = 'drivers.fame.invalid';

/**
 * The vehicle columns a driver is allowed to read. Always select exactly these
 * by name: `select *` on vehicles is refused by the database.
 */
export const VEHICLE_COLUMNS =
  'id, reg_no, make_model, vehicle_type, seats, current_odometer_km, monthly_km_allowance, in_garage, active' as const;

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
}
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: 'plate', en: 'Number plate', si: 'අංක තහඩුව' },
  { key: 'zero', en: 'Pump display at zero before pumping', si: 'පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ' },
  { key: 'pumping', en: 'Pumping', si: 'පොම්ප කරමින්' },
  { key: 'final', en: 'Final pump display: litres and amount', si: 'අවසාන පොම්ප තිරය: ලීටර් සහ මුදල' },
];
/** Monday to Friday by default (the office is closed on Saturday and Sunday). */
export const DEFAULT_DRIVER_SETTINGS: DriverSettings = { shift_start: '08:00', shift_days: [1, 2, 3, 4, 5], fuel_video_checklist: DEFAULT_CHECKLIST, fuel_video_quality: '480p' };

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
  return { shift_start: start, shift_days: days, fuel_video_checklist: list.length ? list : DEFAULT_CHECKLIST, fuel_video_quality: quality };
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

/** Tasks still to do or under way, plus everything that starts at or after `since`. */
export async function fetchTasks(client: Client, since: Date): Promise<TaskWithStops[]> {
  const tasks = check(
    await client
      .from('tasks')
      .select('*, task_stops(*)')
      .or(`status.in.(assigned,in_progress),start_at.gte."${since.toISOString()}"`)
      .order('start_at'),
    'tasks',
  );
  // A stop the office edited out stays in the table as 'removed' and is shown nowhere.
  return tasks.map((task) => ({ ...task, task_stops: task.task_stops.filter((stop) => stop.status !== 'removed').sort((a, b) => a.seq - b.seq) }));
}

export async function fetchTaskStatus(client: Client, id: string): Promise<string | null> {
  const row = checkMaybe(await client.from('tasks').select('status').eq('id', id).maybeSingle(), 'task');
  return row?.status ?? null;
}

export async function fetchReports(client: Client): Promise<VehicleReport[]> {
  return check(
    await client.from('vehicle_reports').select('*').order('created_at', { ascending: false }).limit(30),
    'reports',
  );
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
export type StopPatch = Pick<Tables['task_stops']['Update'], 'status' | 'arrived_at' | 'done_at' | 'skip_reason' | 'skip_note' | 'auto_detected_at'>;
export type OdometerInsert = Tables['odometer_logs']['Insert'] & { id: string };
export type FuelInsert = Tables['fuel_logs']['Insert'] & { id: string };
export type ReportInsert = Pick<
  Tables['vehicle_reports']['Insert'],
  'vehicle_id' | 'employee_id' | 'task_id' | 'category' | 'note' | 'created_at'
> & { id: string };
export type PhotoInsert = Pick<
  Tables['photos']['Insert'],
  'employee_id' | 'kind' | 'storage_path' | 'taken_at' | 'lat' | 'lng' | 'vehicle_report_id'
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

/** The heartbeat's answer: whether the office is watching this driver right now (the phone then uploads every 10 s while moving). */
export interface HeartbeatAnswer {
  watched: boolean;
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
  const data = res.data as { watched?: unknown } | null;
  return { watched: data?.watched === true };
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
