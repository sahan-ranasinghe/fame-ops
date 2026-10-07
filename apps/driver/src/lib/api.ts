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
  constructor(message: string, readonly permanent: boolean, readonly code?: string) {
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
  throw new ApiError(`${what}: ${res.error?.message ?? 'no answer'}`, !retryLater, res.error?.code);
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
  return tasks.map((task) => ({ ...task, task_stops: [...task.task_stops].sort((a, b) => a.seq - b.seq) }));
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
export type StopPatch = Pick<Tables['task_stops']['Update'], 'status' | 'arrived_at' | 'done_at'>;
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

export async function insertPoints(client: Client, points: PointInsert[]): Promise<void> {
  check(
    await client.from('location_points').upsert(points, { onConflict: 'employee_id,recorded_at', ignoreDuplicates: true }),
    'location',
  );
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
