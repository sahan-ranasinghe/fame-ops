// Runs the app's own server code (src/lib/api.ts and the offline queue in
// src/sync/engine.ts) against the LOCAL Supabase stack, as a signed-in driver.
// The phone-only parts (SQLite, files) are replaced by small in-memory ones.
//
//   npx supabase start        (from the repository root)
//   npm run test:data         (from apps/driver)
//
// It never runs against the real project, and uses fresh random names each
// time, so it does not need an empty database.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import * as api from '../src/lib/api';
import { swapReadingsWaiting, taskKmSoFar } from '../src/lib/dayRules';
import { ApiError, type HeartbeatRow, VEHICLE_COLUMNS } from '../src/lib/api';
import { currentDocuments, profilePhotoPath, vehiclePhotoPaths } from '../src/lib/photoRules';
import type { Database } from '../src/lib/database.types';
import { base64Decode, SupabaseTusStore } from '../src/lib/videoStore';
import { createSync, type Op, type QueueStore, type StoredHeartbeat, type StoredOp, type StoredPoint } from '../src/sync/engine';

// --- local stack ------------------------------------------------------------
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const status = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const setting = (name: string) => status.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))?.[1] ?? '';
const API_URL = setting('API_URL');
const ANON_KEY = setting('ANON_KEY');
const SERVICE_KEY = setting('SERVICE_ROLE_KEY');
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(API_URL) || !ANON_KEY || !SERVICE_KEY) {
  console.error('The local Supabase stack is not running. Start it with: npx supabase start');
  process.exit(2);
}

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

/** Stands in for the phone's secure store: keeps the sign-in session in memory. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: async (key: string) => items.get(key) ?? null,
    setItem: async (key: string, value: string) => void items.set(key, value),
    removeItem: async (key: string) => void items.delete(key),
  };
}
const admin = createClient<Database>(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/** A client like the app's. `online.value = false` makes every request fail like a dead connection. */
function driverClient(online: { value: boolean }) {
  return createClient<Database>(API_URL, ANON_KEY, {
    auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => (online.value ? fetch(input, init) : Promise.reject(new TypeError('Network request failed'))),
    },
  });
}

/** The queue kept in memory instead of SQLite. */
function memoryStore() {
  let seq = 0;
  const ops: (StoredOp & { failed?: string })[] = [];
  const points: StoredPoint[] = [];
  const rejected = new Set<number>();
  const heartbeats: StoredHeartbeat[] = [];
  const store: QueueStore = {
    nextOps: (limit) => ops.filter((item) => item.failed === undefined).slice(0, limit),
    removeOp: (id) => void ops.splice(ops.findIndex((item) => item.seq === id), 1),
    updateOp: (id, op) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.op = op;
    },
    failOp: (id, error) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.failed = error;
    },
    nextPoints: (limit) => points.filter((p) => !rejected.has(p.seq)).slice(0, limit),
    removePoints: (seqs) => {
      for (const id of seqs) points.splice(points.findIndex((p) => p.seq === id), 1);
    },
    rejectPoints: (seqs) => seqs.forEach((id) => rejected.add(id)),
    rejectHeartbeats: () => undefined,
    nextHeartbeats: (limit) => heartbeats.slice(0, limit),
    removeHeartbeats: (seqs) => {
      for (const id of seqs) heartbeats.splice(heartbeats.findIndex((h) => h.seq === id), 1);
    },
  };
  return {
    store,
    add: (...list: Op[]) => list.forEach((op) => ops.push({ seq: ++seq, op })),
    addPoints: (list: Omit<StoredPoint, 'seq'>[]) => list.forEach((p) => points.push({ ...p, seq: ++seq })),
    waiting: () => ops.filter((item) => item.failed === undefined).length,
    failed: () => ops.filter((item) => item.failed !== undefined).map((item) => `${item.op.kind}: ${item.failed}`),
    points: () => points.filter((p) => !rejected.has(p.seq)).length,
    rejected: () => rejected.size,
    addHeartbeats: (rows: HeartbeatRow[]) => rows.forEach((row) => heartbeats.push({ seq: ++seq, row })),
    heartbeats: () => heartbeats.length,
  };
}

const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
    'ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114' +
    '328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999a' +
    'a2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9',
  'hex',
);

async function main() {
  const run = randomUUID().slice(0, 6);
  const tmp = mkdtempSync(join(tmpdir(), 'fame-driver-test-'));
  const must = <R extends { data: unknown; error: { message: string } | null }>(res: R, what: string): NonNullable<R['data']> => {
    if (res.error || res.data === null || res.data === undefined) throw new Error(`${what}: ${res.error?.message ?? 'no data'}`);
    return res.data as NonNullable<R['data']>;
  };

  // --- fixtures, created the way the office connector does -------------------
  async function makeDriver(n: number) {
    const username = `t${n}.${run}`;
    const pin = String(100000 + Math.floor(Math.random() * 899999));
    const user = await admin.auth.admin.createUser({ email: `${username}@${api.DRIVER_EMAIL_DOMAIN}`, password: pin, email_confirm: true });
    if (user.error || !user.data.user) throw new Error(`auth: ${user.error?.message}`);
    const row = must(
      await admin.from('employees').insert({ code: `T${n}-${run}`, name: `Test Driver ${n}`, username, auth_user_id: user.data.user.id }).select('*').single(),
      'employee',
    );
    return { username, pin, row, authId: user.data.user.id };
  }
  const a = await makeDriver(1);
  const b = await makeDriver(2);
  const van = must(await admin.from('vehicles').insert({ reg_no: `TEST ${run.toUpperCase()}-1`, make_model: 'Toyota HiAce', vehicle_type: 'van', seats: 14, monthly_km_allowance: 3000, current_odometer_km: 84500, monthly_rent_cents: 18000000 }).select('*').single(), 'vehicle');
  const car = must(await admin.from('vehicles').insert({ reg_no: `TEST ${run.toUpperCase()}-2`, make_model: 'Toyota Axio', vehicle_type: 'car', seats: 4 }).select('*').single(), 'vehicle');
  const gone = must(await admin.from('vehicles').insert({ reg_no: `TEST ${run.toUpperCase()}-3`, active: false }).select('*').single(), 'vehicle');

  async function makeTask(title: string, driverId: string, vehicleId: string, minutesFromNow: number) {
    return must(
      await admin.rpc('office_create_task', {
        p_task: { title, employee_id: driverId, vehicle_id: vehicleId, start_at: new Date(Date.now() + minutesFromNow * 60000).toISOString(), passengers: 5, contact_name: 'Ashan W.', contact_phone: '0779998877', created_by: 'test' },
        p_stops: [
          { seq: 3, type: 'drop', place_name: 'Kurunegala tower site', lat: 7.4839, lng: 80.3683 },
          { seq: 1, type: 'pickup', place_name: 'Head office, Colombo 05', lat: 6.8868, lng: 79.8612, what: 'people' },
          { seq: 2, type: 'visit', place_name: 'Kurunegala hardware store', what: 'goods', dwell_min: 10, note: 'Collect the cable drums' },
        ],
        p_projects: [],
      }),
      'task',
    );
  }
  const task1 = await makeTask(`Team drop ${run}`, a.row.id, van.id, 10);
  const task2 = await makeTask(`Return team ${run}`, a.row.id, van.id, 300);
  const taskOfB = await makeTask(`Other driver ${run}`, b.row.id, car.id, 10);
  // The office edited a stop out of task 1: it stays in the table as 'removed'.
  must(await admin.from('task_stops').insert({ task_id: task1, seq: 4, type: 'visit', place_name: 'Wariyapola junction', status: 'removed', removed_at: new Date().toISOString() }).select('id').single(), 'removed stop');
  // A sharing period left open by an earlier install of the app.
  const stale = must(await admin.from('duty_sessions').insert({ employee_id: a.row.id, started_at: new Date(Date.now() - 86400000).toISOString() }).select('id').single(), 'stale session');

  // --- sign in ---------------------------------------------------------------
  console.log('\n== Sign in and read ==');
  const online = { value: true };
  const client = driverClient(online);
  check((await api.signIn(client, a.username, '000000')) === 'wrong', 'a wrong PIN gives "wrong"');
  online.value = false;
  check((await api.signIn(client, a.username, a.pin)) === 'network', 'no connection gives "network"');
  online.value = true;
  check((await api.signIn(client, ` ${a.username.toUpperCase()} `, a.pin)) === 'ok', 'signs in with username + PIN (spaces and capitals forgiven)');

  const me = await api.fetchMe(client);
  check(me?.id === a.row.id && me.username === a.username, 'fetchMe returns my own employee row', me);

  const vehicles = await api.fetchVehicles(client);
  const mine = vehicles.filter((v) => v.reg_no.includes(run.toUpperCase()));
  check(mine.length === 2 && !mine.some((v) => v.id === gone.id), 'fetchVehicles returns the active vehicles only', mine.map((v) => v.reg_no));
  check(Object.keys(mine[0] ?? {}).sort().join(',') === VEHICLE_COLUMNS.split(', ').sort().join(','), 'vehicles carry exactly the allowed columns (with the photo paths)', Object.keys(mine[0] ?? {}));
  const star = await client.from('vehicles').select('*').limit(1);
  check(star.error?.code === '42501', 'select * on vehicles is refused, as the database promises', star.error);
  const aiFromPhone = await client.from('odometer_logs').insert({ vehicle_id: van.id, employee_id: a.row.id, reading_km: 84500, kind: 'manual', ai_value: 84500 });
  check(aiFromPhone.error?.code === '42501', 'the phone cannot set what the server read from an odometer photo (ai_value)', aiFromPhone.error);

  const since = new Date(Date.now() - 3600000);
  let tasks = await api.fetchTasks(client, since);
  check(tasks.length === 2 && tasks.every((t) => t.employee_id === a.row.id) && !tasks.some((t) => t.id === taskOfB), 'fetchTasks returns my 2 tasks and not the other driver\'s', tasks.map((t) => t.title));
  check(tasks[0]?.id === task1 && tasks[0].task_stops.map((s) => s.type).join('>') === 'pickup>visit>drop', 'tasks come soonest first, stops in order (pickup, visit, drop)', tasks[0]?.task_stops.map((s) => s.seq));
  check(tasks[0]?.task_stops.length === 3 && !tasks[0].task_stops.some((s) => s.place_name === 'Wariyapola junction'), 'a stop the office removed is not shown', tasks[0]?.task_stops.map((s) => s.status));
  check(tasks[0]?.task_stops[1]?.dwell_min === 10 && tasks[0]?.task_stops[1]?.note === 'Collect the cable drums' && tasks[0]?.task_stops[1]?.what === 'goods', 'a stop carries its minutes, note and what', tasks[0]?.task_stops[1]);

  // --- the queue ---------------------------------------------------------------
  console.log('\n== Offline queue: a whole working day, first with no connection ==');
  const queue = memoryStore();
  const uploads: string[] = [];
  const answers: string[] = [];
  const photoAnswers: string[] = [];
  /** The request the phone makes (sync/index.ts uploadPhotoFile): the file POSTed straight to a bucket with the driver's token. */
  const uploader = (who: ReturnType<typeof driverClient>, log: string[], net: { value: boolean } = { value: true }) =>
    async (localUri: string, storagePath: string, bucket = 'driver-photos') => {
      const { data } = await who.auth.getSession();
      let res: Response;
      try {
        if (!net.value) throw new TypeError('Network request failed');
        res = await fetch(`${API_URL}/storage/v1/object/${bucket}/${storagePath}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.session?.access_token}`, apikey: ANON_KEY, 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
          body: readFileSync(localUri),
        });
      } catch (error) {
        throw new ApiError(`photo: ${(error as Error).message}`, false);
      }
      const body = await res.text();
      log.push(`${res.status} ${body.slice(0, 60)}`);
      if (res.ok) return;
      if (res.status === 409 || /duplicate|already exists/i.test(body)) return;
      throw new ApiError(`photo: upload refused (${res.status})`, res.status >= 400 && res.status < 500 && res.status !== 401);
    };
  const sync = createSync({
    client,
    store: queue.store,
    employeeId: () => a.row.id,
    // Photos go up with the phone's own request (uploader above). The fuel video goes through the same resumable
    // upload the phone uses (chunks read from the file at a position).
    video: new SupabaseTusStore(API_URL, { apiKey: ANON_KEY, token: async () => (await client.auth.getSession()).data.session?.access_token ?? null },
      (url, init) => (online.value ? fetch(url, init) : Promise.reject(new TypeError('Network request failed')))),
    readChunk: async (localUri, offset, length) => base64Decode(readFileSync(localUri).subarray(offset, offset + length).toString('base64')),
    fileSize: (localUri) => { try { return readFileSync(localUri).length; } catch { return null; } },
    uploadFile: uploader(client, uploads, online),
    removeFile: () => undefined,
    onAnswer: (op, answer) => answers.push(`${op.kind}:${answer}`),
    onVehiclePhoto: (_op, answer) => photoAnswers.push(answer),
  });

  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60000).toISOString();
  const day = new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);
  const photoFile = (id: string) => {
    const path = join(tmp, `${id}.jpg`);
    writeFileSync(path, TINY_JPEG);
    return path;
  };
  const photoOp = (id: string, kind: 'odometer' | 'fuel_receipt' | 'vehicle_report', reportId: string | null = null): Op => ({
    kind: 'photo', id, employee_id: a.row.id, photo_kind: kind, storage_path: `${a.row.id}/${day}/${id}.jpg`, local_uri: photoFile(id), taken_at: at(1), lat: 7.3381, lng: 80.3003, vehicle_report_id: reportId,
  });

  const session = randomUUID();
  const [pStart, pEnd, pFuel, pReport, report] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  // A valid, empty MP4 (an ftyp box and a free box): enough for the bucket's mime rule.
  const TINY_MP4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex');
  const fuelId = randomUUID();
  const videoFile = join(tmp, `${fuelId}.mp4`);
  writeFileSync(videoFile, TINY_MP4);
  const videoPath = `${a.row.id}/${day}/${fuelId}.mp4`;
  const logStart = randomUUID();
  const stops = tasks[0]!.task_stops;
  const day1: Op[] = [
    { kind: 'task_patch', id: task1, patch: { seen_at: at(50) } },
    { kind: 'employee_patch', id: a.row.id, patch: { current_vehicle_id: van.id, language: 'si' } },
    { kind: 'session_start', id: session, employee_id: a.row.id, vehicle_id: van.id, started_at: at(45), device_info: { model: 'test phone' } },
    { kind: 'heartbeat', row: { at: at(43), sharing: true, location_on: false, permission: 'always', battery_pct: 80, app_version: '1.1.0+test', queued_points: 45 } },
    photoOp(pStart, 'odometer'),
    { kind: 'odometer_log', row: { id: logStart, vehicle_id: van.id, employee_id: a.row.id, task_id: task1, reading_km: 84512, ocr_value: 84512, photo_id: pStart, kind: 'task_start', logged_at: at(44) } },
    { kind: 'task_patch', id: task1, patch: { status: 'in_progress', start_odometer_km: 84512, started_at: at(44) } },
    // The arrival nudge first (the phone saw the driver within 150 m), then the driver's own tap: the app's own queue and patchStop.
    { kind: 'stop_patch', id: stops[0]!.id, patch: { auto_detected_at: at(43) } },
    { kind: 'stop_patch', id: stops[0]!.id, patch: { status: 'arrived', arrived_at: at(42) } },
    { kind: 'stop_patch', id: stops[0]!.id, patch: { status: 'done', done_at: at(40) } },
    { kind: 'stop_patch', id: stops[1]!.id, patch: { status: 'skipped', skip_reason: 'closed', skip_note: 'Shutter down', done_at: at(30) } },
    { kind: 'report', row: { id: report, vehicle_id: van.id, employee_id: a.row.id, task_id: task1, category: 'tyre', note: 'Front left tyre is worn', created_at: at(20) } },
    photoOp(pReport, 'vehicle_report', report),
    photoOp(pEnd, 'odometer'),
    { kind: 'odometer_log', row: { id: randomUUID(), vehicle_id: van.id, employee_id: a.row.id, task_id: task1, reading_km: 84563, ocr_value: 84568, photo_id: pEnd, kind: 'task_end', logged_at: at(3) } },
    photoOp(pFuel, 'fuel_receipt'),
    { kind: 'fuel_log', row: { id: fuelId, vehicle_id: van.id, employee_id: a.row.id, task_id: task1, litres: 32, amount_cents: 1184000, receipt_photo_id: pFuel, odometer_km: 84563, logged_at: at(3) ,
      video_path: videoPath, video_status: 'recorded', video_duration_s: 5, video_bytes: TINY_MP4.length, video_checklist: [{ key: 'plate', at_s: 1 }, { key: 'final', at_s: 4 }] } },
    { kind: 'video_upload', fuel_log_id: fuelId, bucket: 'fuel-videos', path: videoPath, local_uri: videoFile, bytes: TINY_MP4.length, url: null, offset: 0, content_type: 'video/mp4' },
    // Phase 7: Done only after Arrived (the app's Arrived carries how it was marked and the distance from the pin).
    { kind: 'stop_patch', id: stops[2]!.id, patch: { status: 'arrived', arrived_at: at(4), arrival_flag: 'ok', arrival_distance_m: 35 } },
    { kind: 'stop_patch', id: stops[2]!.id, patch: { status: 'done', done_at: at(3) } },
    { kind: 'task_patch', id: task1, patch: { status: 'completed', end_odometer_km: 84563, completed_at: at(3) } },
    { kind: 'session_end', id: session, ended_at: at(1), end_reason: 'driver' },
  ];
  queue.add(...day1);
  // The heartbeat history, the way the phone keeps it (one row a minute) and uploads it (an upsert that ignores repeats).
  queue.addHeartbeats(Array.from({ length: 3 }, (_, i) => ({
    at: at(43 - i), sharing: true, location_on: true, permission: 'always' as const, battery_pct: 80, app_version: '1.1.0+test', queued_points: 0,
    session_id: session, fixes_seen: 12, fixes_stored: 12, video_uploads_waiting: 0, video_bytes_waiting: 0, location_restarts: i === 1 ? 1 : 0,
  })));
  queue.addPoints(Array.from({ length: 45 }, (_, i) => ({
    session_id: session, recorded_at: at(44 - i), lat: 6.8868 + i * 0.01, lng: 79.8612 + i * 0.01, accuracy_m: 8, speed_mps: 15, heading: 45, battery_pct: 80, is_mock: false,
  })));

  online.value = false;
  let result = await sync.flush();
  check(result.offline && result.sent === 0 && queue.waiting() === day1.length && queue.points() === 45, 'with no connection nothing is lost and nothing is marked failed', { result, waiting: queue.waiting() });

  console.log('\n== Connection returns ==');
  online.value = true;
  result = await sync.flush({ force: true }); // the app forces the first try when the connection is back
  check(!result.offline && result.failed === 0 && queue.waiting() === 0 && queue.points() === 0, `everything is sent in order (${result.sent} items)`, { result, failed: queue.failed() });

  const row = must(await admin.from('tasks').select('*').eq('id', task1).single(), 'task');
  check(row.status === 'completed' && row.km === 51 && row.start_odometer_km === 84512 && row.seen_at !== null, 'the task is completed on the server with 51 km', { status: row.status, km: row.km });
  check(row.started_at !== null && row.completed_at !== null && Math.abs(new Date(row.started_at).getTime() - (now - 44 * 60000)) < 2000, 'start and finish keep the times from the phone, not the time of sending', { started: row.started_at });
  const stopRows = must(await admin.from('task_stops').select('seq, status, arrived_at, auto_detected_at, skip_reason, skip_note').eq('task_id', task1).order('seq'), 'stops');
  check(stopRows[0]?.auto_detected_at !== null && Date.parse(stopRows[0]!.auto_detected_at!) < Date.parse(stopRows[0]!.arrived_at!),
    'the arrival nudge\'s time reached the stop through the app\'s own queue, before the driver\'s tap', { auto: stopRows[0]?.auto_detected_at, tap: stopRows[0]?.arrived_at });
  check(stopRows.map((s) => s.status).join(',') === 'done,skipped,done,removed', 'the stops are done, skipped, done; the removed one stays removed', stopRows.map((s) => s.status));
  check(stopRows[0]?.arrived_at !== null && stopRows[1]?.skip_reason === 'closed' && stopRows[1]?.skip_note === 'Shutter down', 'the pickup keeps its arrival time; the skipped stop keeps the reason and the note', stopRows.slice(0, 2));
  // Phase 7: the driver's skip (with a reason) is a line in the task's history (and a push to the dispatchers).
  const skipLine = must(await client.from('task_assignment_events').select('action, note').eq('task_id', task1).eq('action', 'stop_skipped'), 'history');
  check(skipLine.length === 1 && skipLine[0]?.note === 'Stop 2 · Kurunegala hardware store: Closed · Shutter down', 'the skipped stop is in the task\'s history, which the driver reads', skipLine);

  console.log('\n== Accept and decline ==');
  const task5 = await makeTask(`Accept twice ${run}`, a.row.id, van.id, 400);
  const task6 = await makeTask(`Decline me ${run}`, a.row.id, van.id, 420);
  const task7 = await makeTask(`Taken away ${run}`, a.row.id, van.id, 440);
  queue.add(
    { kind: 'task_accept', id: task5, at: at(20) },
    { kind: 'task_accept', id: task5, at: at(25) },
    { kind: 'task_decline', id: task6, reason: 'unwell', note: 'Fever', at: at(15) },
    { kind: 'task_accept', id: task7, at: at(10) },
  );
  // Meanwhile the office gives task 7 to driver B.
  must(await admin.from('tasks').update({ employee_id: b.row.id, sent_at: new Date().toISOString(), seen_at: null }).eq('id', task7).select('id').single(), 'reassign');
  result = await sync.flush();
  check(!result.offline && result.failed === 0 && result.sent === 4 && queue.waiting() === 0, 'accept and decline go through the queue like everything else', result);
  const t5 = must(await admin.from('tasks').select('accepted_at').eq('id', task5).single(), 'task 5');
  check(t5.accepted_at !== null && Math.abs(new Date(t5.accepted_at).getTime() - (now - 25 * 60000)) < 2000, 'the earliest acceptance wins when a tap is replayed', t5);
  const t6 = must(await admin.from('tasks').select('status, declined_reason, declined_note, declined_after_accept').eq('id', task6).single(), 'task 6');
  check(t6.status === 'declined' && t6.declined_reason === 'unwell' && t6.declined_note === 'Fever' && t6.declined_after_accept === false, 'a declined task carries the reason and the note', t6);
  check(answers.join(',') === 'task_accept:accepted,task_accept:accepted,task_decline:declined,task_accept:already_reassigned',
    'the app hears every answer; a task given away meanwhile answers already_reassigned, not an error', answers);
  const history = must(await client.from('task_assignment_events').select('action').eq('task_id', task6).order('id'), 'events');
  check(history.map((e) => e.action).join(',') === 'assigned,declined', 'the driver reads the history of their own declined task', history);
  check((await api.fetchTasks(client, since)).find((t) => t.id === task6)?.status === 'declined', 'fetchTasks shows the declined task as declined (the app lists it nowhere)');
  const photos = must(await admin.from('photos').select('id, kind, odometer_log_id, fuel_log_id, vehicle_report_id, storage_path').eq('employee_id', a.row.id), 'photos');
  check(photos.length === 4 && photos.find((p) => p.id === pStart)?.odometer_log_id === logStart && photos.find((p) => p.id === pFuel)?.fuel_log_id !== null && photos.find((p) => p.id === pReport)?.vehicle_report_id === report, '4 photo records, each linked to its reading, fuel entry or report', photos);
  const fuelRow = must(await admin.from('fuel_logs').select('video_status, video_uploaded_at, video_bytes, video_path, video_checklist').eq('id', fuelId).single(), 'fuel log');
  check(fuelRow.video_status === 'uploaded' && fuelRow.video_uploaded_at !== null && fuelRow.video_bytes === TINY_MP4.length && fuelRow.video_path === videoPath
    && JSON.stringify(fuelRow.video_checklist) === '[{"key":"plate","at_s":1},{"key":"final","at_s":4}]', 'the fuel video went up through the resumable upload: the row says uploaded, with its size, path and the steps ticked with their seconds', fuelRow);
  const listed = await admin.storage.from('fuel-videos').list(`${a.row.id}/${day}`);
  check((listed.data ?? []).some((o) => o.name === `${fuelId}.mp4`), 'the file is in the fuel-videos bucket under the driver\'s own folder', listed.data?.map((o) => o.name));
  const files = must(await admin.storage.from('driver-photos').list(`${a.row.id}/${day}`), 'files');
  check(files.length === 4 && uploads.every((u) => u.startsWith('200')), '4 photo files are in the driver\'s own folder', uploads);
  const vanNow = must(await admin.from('vehicles').select('current_odometer_km').eq('id', van.id).single(), 'vehicle');
  check(vanNow.current_odometer_km === 84563, 'the vehicle odometer follows the last reading (84,563)', vanNow);
  const sessions = must(await admin.from('duty_sessions').select('id, ended_at, end_reason').eq('employee_id', a.row.id), 'sessions');
  check(sessions.find((s) => s.id === stale.id)?.end_reason === 'auto' && sessions.find((s) => s.id === session)?.end_reason === 'driver', 'the stale sharing period was closed (auto) and the new one opened and ended (driver)', sessions);
  const pointCount = (await admin.from('location_points').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id)).count;
  const latest = must(await admin.from('driver_latest').select('*').eq('employee_id', a.row.id).single(), 'driver_latest');
  check(pointCount === 45 && latest.sharing === false && Math.abs((latest.lat ?? 0) - (6.8868 + 44 * 0.01)) < 1e-6, '45 location points stored; the office sees the newest one and "not sharing"', { pointCount, lat: latest.lat });
  check(latest.hb_location_on === false && latest.hb_permission === 'always' && latest.hb_queued_points === 45 && latest.hb_app_version === '1.1.0+test' && latest.hb_location_off_since !== null,
    'the heartbeat reached driver_latest: Location off, 45 points were waiting, app 1.1.0+test', { hb: latest.hb_location_on, since: latest.hb_location_off_since });
  const beats = must(await admin.from('driver_heartbeats').select('at, location_restarts').eq('employee_id', a.row.id).order('at'), 'heartbeat history');
  check(beats.length === 3 && queue.heartbeats() === 0 && beats.reduce((s, b) => s + (b.location_restarts ?? 0), 0) === 1,
    'the heartbeat history reached driver_heartbeats through the app\'s own upload (3 rows, one watchdog restart), and left the phone', { rows: beats.length, left: queue.heartbeats() });
  const beatAgain = await client.from('driver_heartbeats').upsert([{ employee_id: a.row.id, at: beats[0]!.at, sharing: true, location_on: true, permission: 'always', queued_points: 0 }], { onConflict: 'employee_id,at', ignoreDuplicates: true });
  check(!beatAgain.error, 'the same row uploaded again (a lost answer) is ignored, not refused', beatAgain.error);
  const meNow = await api.fetchMe(client);
  // Phase 7: Finish work (the session's end) gives the vehicle up; the history keeps the clock-in and the clock-out.
  const heldA = must(await admin.from('vehicle_assignments').select('vehicle_id, how, ended_how').eq('employee_id', a.row.id).order('from_at'), 'vehicle rows');
  // (The older app's vehicle pick carries no time: it is recorded when it reaches the server, here after the day.)
  const clockIn = heldA.find((r) => r.how === 'clock_in');
  check(meNow?.language === 'si' && meNow.current_vehicle_id === null && clockIn?.ended_how === 'clock_out' && clockIn.vehicle_id === van.id
    && !heldA.some((r) => r.ended_how === null), 'language saved; Start work held the van, Finish work gave it up', heldA);
  const arrivedRow = must(await admin.from('task_stops').select('arrival_flag, arrival_distance_m').eq('id', stops[2]!.id).single(), 'stop');
  check(arrivedRow.arrival_flag === 'ok' && arrivedRow.arrival_distance_m === 35, 'Arrived keeps how it was marked and the distance (the driver\'s update grant)', arrivedRow);
  const reports = await api.fetchReports(client);
  check(reports.length === 1 && reports[0]?.status === 'open' && reports[0].category === 'tyre', 'fetchReports shows my report as open');
  const mileage = await api.fetchMileage(client, van.id, new Date(now - 30 * 86400000));
  check(mileage.odometer.map((l) => l.reading_km).join(',') === '84512,84563' && mileage.fuel.length === 1 && Number(mileage.fuel[0]?.litres) === 32, 'fetchMileage returns my 2 readings and 1 fuel entry');
  tasks = await api.fetchTasks(client, since);
  check(tasks.find((t) => t.id === task1)?.status === 'completed' && tasks.find((t) => t.id === task2)?.status === 'assigned', 'fetchTasks now shows task 1 completed and task 2 still assigned');

  console.log('\n== Sending the same things again (answers lost on a bad connection) ==');
  uploads.length = 0;
  queue.add(...day1);
  queue.addPoints(Array.from({ length: 5 }, (_, i) => ({ session_id: session, recorded_at: at(44 - i), lat: 1, lng: 1, accuracy_m: null, speed_mps: null, heading: null, battery_pct: null, is_mock: false })));
  result = await sync.flush();
  check(!result.offline && result.failed === 0 && queue.waiting() === 0, 'a second send of everything is accepted without errors', { result, failed: queue.failed() });
  const again = must(await admin.from('tasks').select('status, km, started_at').eq('id', task1).single(), 'task');
  const counts = await Promise.all([
    admin.from('odometer_logs').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    admin.from('fuel_logs').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    admin.from('vehicle_reports').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    admin.from('location_points').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
  ]);
  check(counts.map((c) => c.count).join(',') === '2,1,4,1,45' && again.km === 51 && again.started_at === row.started_at, 'and nothing was duplicated or changed (2 readings, 1 fuel, 4 photos, 1 report, 45 points)', counts.map((c) => c.count));
  check(uploads.length === 4 && uploads.every((u) => /duplicate|already exists/i.test(u)), 'photo files already uploaded are recognised as "already there"', uploads);

  console.log('\n== When the server says no ==');
  const logNoPhoto = randomUUID();
  queue.add(
    { kind: 'task_patch', id: taskOfB, patch: { status: 'in_progress', start_odometer_km: 1, started_at: at(1) } },
    { kind: 'task_patch', id: taskOfB, patch: { seen_at: at(1) } },
    { kind: 'task_patch', id: task2, patch: { status: 'completed', end_odometer_km: 90000, completed_at: at(0) } },
    { kind: 'odometer_log', row: { id: logNoPhoto, vehicle_id: van.id, employee_id: a.row.id, task_id: null, reading_km: 84570, ocr_value: null, photo_id: randomUUID(), kind: 'manual', logged_at: at(0) } },
  );
  result = await sync.flush();
  check(result.failed === 2 && result.sent === 2 && queue.waiting() === 0, 'refused changes are set aside (2) and the rest still goes through (2)', { result, failed: queue.failed() });
  check(queue.failed().some((f) => f.includes('no longer assigned')) && queue.failed().some((f) => f.includes('Drivers cannot change a task from assigned to completed')), 'the reasons are kept: not my task; cannot skip straight to completed', queue.failed());
  const other = must(await admin.from('tasks').select('status, seen_at').eq('id', taskOfB).single(), 'task');
  check(other.status === 'assigned' && other.seen_at === null, 'the other driver\'s task was not touched');
  const saved = must(await admin.from('odometer_logs').select('reading_km, photo_id').eq('id', logNoPhoto).single(), 'log');
  check(saved.reading_km === 84570 && saved.photo_id === null, 'a reading whose photo never arrived is saved without the photo');

  console.log('\n== Points whose sharing period never reached the server ==');
  const lost = randomUUID();
  queue.addPoints(Array.from({ length: 3 }, (_, i) => ({ session_id: lost, recorded_at: new Date(now + (i + 1) * 1000).toISOString(), lat: 7.3381, lng: 80.3003, accuracy_m: 5, speed_mps: 0, heading: null, battery_pct: 70, is_mock: false })));
  result = await sync.flush();
  const rescued = must(await admin.from('duty_sessions').select('ended_at, end_reason').eq('id', lost).single(), 'session');
  const after = (await admin.from('location_points').select('id', { count: 'exact', head: true }).eq('session_id', lost)).count;
  check(result.failed === 0 && after === 3 && rescued.end_reason === 'auto' && rescued.ended_at !== null, 'the period is registered after the fact and its 3 points are stored', { result, after, rescued });

  console.log('\n== A day with no coverage: 450 points queued, then the connection returns ==');
  const offlineDay = randomUUID();
  queue.add({ kind: 'session_start', id: offlineDay, employee_id: a.row.id, vehicle_id: van.id, started_at: new Date(now - 8 * 3600000).toISOString(), device_info: { model: 'test phone' } });
  // 450 points over 8 hours (a parked vehicle sends about 60 an hour), the newest just after everything stored so far.
  queue.addPoints(Array.from({ length: 450 }, (_, i) => ({
    // 7 s off the minute, so no point lands on a time this driver already has stored (the key is employee + time).
    session_id: offlineDay, recorded_at: new Date(now - 8 * 3600000 + 7000 + i * 64000 + (i === 449 ? 8 * 3600000 - 7000 - 449 * 64000 + 5000 : 0)).toISOString(),
    lat: 6.9 + i * 0.0001, lng: 79.9, accuracy_m: 6, speed_mps: 0, heading: null, battery_pct: 60, is_mock: false,
  })));
  const t0 = Date.now();
  result = await sync.flush();
  const backlog = (await admin.from('location_points').select('id', { count: 'exact', head: true }).eq('session_id', offlineDay)).count;
  const latestAfter = must(await admin.from('driver_latest').select('recorded_at, lat').eq('employee_id', a.row.id).single(), 'driver_latest');
  check(!result.offline && result.failed === 0 && result.sent === 451 && queue.points() === 0 && backlog === 450,
    `the whole backlog went up in batches of 200 without a point lost (${Math.round((Date.now() - t0) / 100) / 10} s)`, { result, backlog });
  check(latestAfter.recorded_at !== null && Math.abs(new Date(latestAfter.recorded_at).getTime() - (now + 5000)) < 2000 && Math.abs((latestAfter.lat ?? 0) - (6.9 + 449 * 0.0001)) < 1e-6,
    'driver_latest ends on the newest point of the backlog', latestAfter);

  console.log('\n== Phase 7: Start work with a vehicle, Change vehicle sent twice, taken over, Done needs Arrived ==');
  const s7 = randomUUID();
  const c7 = randomUUID();
  queue.add(
    { kind: 'session_start', id: s7, employee_id: a.row.id, vehicle_id: car.id, started_at: new Date().toISOString(), device_info: { model: 'test phone' } },
    { kind: 'vehicle_change', id: c7, vehicle_id: van.id, at: new Date().toISOString() },
    { kind: 'vehicle_change', id: c7, vehicle_id: van.id, at: new Date().toISOString() },
  );
  result = await sync.flush();
  const rows7 = must(await admin.from('vehicle_assignments').select('vehicle_id, how, ended_how, client_id').eq('employee_id', a.row.id).order('from_at'), 'vehicle rows');
  check(result.failed === 0 && rows7.at(-2)?.how === 'clock_in' && rows7.at(-2)?.vehicle_id === car.id && rows7.at(-2)?.ended_how === 'change'
    && rows7.at(-1)?.how === 'change' && rows7.at(-1)?.vehicle_id === van.id && rows7.filter((r) => r.client_id === c7).length === 1,
    'Start work took the car (clock_in), Change vehicle the van; the resent change counted once', { result, rows: rows7.slice(-2) });
  const beat7 = await api.sendHeartbeat(client, { at: new Date().toISOString(), sharing: true, location_on: true, permission: 'always', battery_pct: 80, app_version: '1.2.0+test', queued_points: 0 });
  check(beat7.on_duty === true && beat7.duty_end === null, 'the heartbeat answers on_duty while the duty period is open', beat7);
  // Driver B starts work on the same van: one vehicle, one driver.
  must(await admin.from('duty_sessions').insert({ employee_id: b.row.id, vehicle_id: van.id }).select('id').single(), 'B session');
  const myRows = await api.fetchMyAssignments(client, 1);
  const choices = await api.fetchVehicleChoices(client);
  check(myRows[0]?.ended_how === 'taken_over' && myRows[0]?.ended_by_name === 'Test Driver 2' && choices.find((c) => c.id === van.id)?.held_by === 'Test'
    && choices.find((c) => c.id === van.id)?.my_last === true && (await api.fetchMe(client))?.current_vehicle_id === null,
    'taken over: my newest row says by whom (the banner), the picker shows "With Test now", I hold none', { myRows, van: choices.find((c) => c.id === van.id) });
  // Task 2 on the van: the start takes it back (the later take wins); Arrived with the override, Done after it, Done without Arrived refused.
  const stops2 = (await api.fetchTasks(client, since)).find((t) => t.id === task2)!.task_stops;
  queue.add(
    { kind: 'task_patch', id: task2, patch: { status: 'in_progress', start_odometer_km: 84570, started_at: new Date().toISOString() } },
    { kind: 'stop_patch', id: stops2[0]!.id, patch: { status: 'arrived', arrived_at: new Date().toISOString(), arrival_flag: 'override', arrival_distance_m: 42000 } },
    { kind: 'stop_patch', id: stops2[0]!.id, patch: { status: 'done', done_at: new Date().toISOString() } },
    { kind: 'stop_patch', id: stops2[1]!.id, patch: { status: 'done', done_at: new Date().toISOString() } },
  );
  result = await sync.flush();
  const s2rows = must(await admin.from('task_stops').select('id, status, arrival_flag, arrival_distance_m').in('id', [stops2[0]!.id, stops2[1]!.id]).order('seq'), 'stops');
  check(result.failed === 1 && queue.failed().some((f) => f.includes('Mark Arrived first')) && s2rows[0]?.status === 'done' && s2rows[0]?.arrival_flag === 'override'
    && s2rows[0]?.arrival_distance_m === 42000 && s2rows[1]?.status === 'pending',
    'Arrived far from the pin is kept with its flag; Done without Arrived is refused and set aside', { result, failed: queue.failed().slice(-1), s2rows });
  const holder = must(await admin.from('vehicle_assignments').select('employee_id, how').eq('vehicle_id', van.id).is('to_at', null).single(), 'van holder');
  check(holder.employee_id === a.row.id && holder.how === 'task_start', 'starting the task on the van took it back from driver B (task_start)', holder);

  console.log('\n== Phase 7, Part 2: the office swaps the vehicle during the task; the phone sends both readings; I need another vehicle ==');
  const swap = must(await admin.rpc('office_swap_vehicle', { p_task: task2, p_vehicle: car.id, p_by: 'test' }), 'swap') as { result?: string };
  const swapped = (await api.fetchTasks(client, since)).find((t) => t.id === task2)!;
  const owed = swapReadingsWaiting(swapped);
  check(swap.result === 'swapped' && swapped.vehicle_id === car.id && swapped.task_vehicle_segments?.length === 2
    && owed.oldEnd?.vehicleId === van.id && owed.oldEnd.startKm === 84570 && owed.newStart?.vehicleId === car.id,
    "fetchTasks reads the stretches; the phone owes the van's end and the car's start", { swap, segments: swapped.task_vehicle_segments, owed });
  queue.add(
    { kind: 'odometer_log', row: { id: randomUUID(), vehicle_id: van.id, employee_id: a.row.id, task_id: task2, reading_km: 84610, ocr_value: 84610, photo_id: null, kind: 'task_end', logged_at: new Date().toISOString(), entry: 'photo', photo_attempts: 1 } },
    { kind: 'odometer_log', row: { id: randomUUID(), vehicle_id: car.id, employee_id: a.row.id, task_id: task2, reading_km: 12000, ocr_value: 12000, photo_id: null, kind: 'task_start', logged_at: new Date().toISOString(), entry: 'photo', photo_attempts: 1 } },
  );
  const needId = randomUUID();
  queue.add({ kind: 'report', row: { id: needId, vehicle_id: car.id, employee_id: a.row.id, task_id: task2, category: 'breakdown', note: 'Clutch gone', created_at: new Date().toISOString(), needs_vehicle: true } });
  result = await sync.flush();
  const afterSwap = (await api.fetchTasks(client, since)).find((t) => t.id === task2)!;
  const need = must(await admin.from('vehicle_reports').select('needs_vehicle, task_id').eq('id', needId).single(), 'report');
  check(result.failed === 0 && swapReadingsWaiting(afterSwap).oldEnd === null && swapReadingsWaiting(afterSwap).newStart === null
    && taskKmSoFar(afterSwap, 12025) === 65 && need.needs_vehicle === true,
    'through the real queue: both readings fill the stretches (40 + 25 km), and the report asks for another vehicle', { result, failed: queue.failed(), segments: afterSwap.task_vehicle_segments, need });

  console.log('\n== Phase 7, Part 3: my photo, a vehicle\'s first photo from two phones, the held vehicle\'s documents ==');
  // "Add your photo": sent at once (not queued), with the queue's own upload request, then the row, then set_my_photo.
  check((await api.fetchMe(client))?.photo_id === null, 'a driver starts with no photo (the app shows "Add your photo")');
  const profileId = randomUUID();
  const profileFile = photoFile(profileId);
  const profile = { id: profileId, employee_id: a.row.id, storage_path: profilePhotoPath(a.row.id, profileId), taken_at: new Date().toISOString() };
  const uploadProfile = (path: string) => uploader(client, [])(profileFile, path);
  const myPhoto = await api.saveProfilePhoto(client, profile, uploadProfile);
  const meWithPhoto = await api.fetchMe(client);
  const profileRow = must(await admin.from('photos').select('kind, storage_path').eq('id', profileId).single(), 'profile photo row');
  const profileFiles = must(await admin.storage.from('driver-photos').list(`${a.row.id}/profile`), 'profile folder');
  check(myPhoto === 'ok' && meWithPhoto?.photo_id === profileId && meWithPhoto.photo_updated_at !== null && profileRow.kind === 'profile'
    && profileFiles.some((f) => f.name === `${profileId}.jpg`),
    'the photo is in <employee_id>/profile/, its row is kind profile, and set_my_photo made it mine (photo_id readable by the driver)',
    { myPhoto, photoId: meWithPhoto?.photo_id, profileRow });
  check((await api.saveProfilePhoto(client, profile, uploadProfile)) === 'ok', 'sent again after a lost answer: the same photo is accepted again');
  const myPath = await api.fetchPhotoPath(client, profileId);
  const myLink = myPath ? await client.storage.from('driver-photos').createSignedUrl(myPath, 3600) : null;
  check(myPath === profile.storage_path && !!myLink?.data?.signedUrl, 'the Me tab finds the path and signs its own link', myLink?.error);
  check((await api.setMyPhoto(client, pStart)) === 'not_yours', 'an odometer photo cannot become my profile photo (not_yours)');

  // A vehicle's first photo: phone A's op (both files, then the RPC); phone C took one of the same vehicle meanwhile.
  const c = await makeDriver(3);
  const clientC = driverClient({ value: true });
  check((await api.signIn(clientC, c.username, c.pin)) === 'ok', 'driver C signs in');
  const queueC = memoryStore();
  const answersC: string[] = [];
  const syncC = createSync({
    client: clientC,
    store: queueC.store,
    employeeId: () => c.row.id,
    uploadFile: uploader(clientC, []),
    removeFile: () => undefined,
    onVehiclePhoto: (_op, answer) => answersC.push(answer),
  });
  const photoVan = must(await admin.from('vehicles').insert({ reg_no: `TEST ${run.toUpperCase()}-4`, make_model: 'Nissan Caravan', vehicle_type: 'van' }).select('id').single(), 'vehicle');
  const vehiclePhotoOp = (id: string): Op => {
    const paths = vehiclePhotoPaths(photoVan.id, id);
    return { kind: 'vehicle_photo', id, vehicle_id: photoVan.id, path: paths.path, thumb_path: paths.thumbPath, local_uri: photoFile(id), thumb_uri: photoFile(`${id}-thumb`), taken_at: new Date().toISOString() };
  };
  const fromA = randomUUID();
  const fromC = randomUUID();
  queue.add(vehiclePhotoOp(fromA));
  queueC.add(vehiclePhotoOp(fromC));
  result = await sync.flush();
  const vanPhoto = must(await admin.from('vehicles').select('photo_path, photo_thumb_path, photo_updated_at').eq('id', photoVan.id).single(), 'vehicle photo');
  const vanFiles = must(await admin.storage.from('vehicle-photos').list(photoVan.id), 'vehicle-photos');
  check(result.failed === 0 && queue.waiting() === 0 && photoAnswers.join() === 'ok' && vanPhoto.photo_path === `${photoVan.id}/${fromA}.jpg`
    && vanPhoto.photo_thumb_path === `${photoVan.id}/${fromA}-thumb.jpg` && vanPhoto.photo_updated_at !== null
    && vanFiles.some((f) => f.name === `${fromA}.jpg`) && vanFiles.some((f) => f.name === `${fromA}-thumb.jpg`),
    "through the real queue: both files are in vehicle-photos/<vehicle_id>/ and set_vehicle_photo_from_driver made them the vehicle's photo",
    { result, failed: queue.failed(), photoAnswers, vanPhoto, files: vanFiles.map((f) => f.name) });
  const seenVan = (await api.fetchVehicles(clientC)).find((v) => v.id === photoVan.id);
  const thumbLink = seenVan?.photo_thumb_path ? await clientC.storage.from('vehicle-photos').createSignedUrl(seenVan.photo_thumb_path, 3600) : null;
  check(seenVan?.photo_thumb_path === vanPhoto.photo_thumb_path && !!thumbLink?.data?.signedUrl,
    "any driver reads the photo's paths with the vehicles (the app's column list) and signs the thumbnail", thumbLink?.error);
  const resultC = await syncC.flush();
  const vanAfter = must(await admin.from('vehicles').select('photo_path').eq('id', photoVan.id).single(), 'vehicle photo');
  check(resultC.failed === 0 && queueC.waiting() === 0 && answersC.join() === 'has_photo' && vanAfter.photo_path === vanPhoto.photo_path,
    "the second phone's op for the same vehicle ends as done on 'has_photo' (not failed); the first photo stays", { resultC, failed: queueC.failed(), answersC });
  const late = vehiclePhotoPaths(photoVan.id, randomUUID());
  check((await api.setVehiclePhotoFromDriver(clientC, photoVan.id, late.path, late.thumbPath)) === 'has_photo', 'the RPC itself answers has_photo once a photo is there');
  const wrong = vehiclePhotoPaths(car.id, randomUUID());
  check((await api.setVehiclePhotoFromDriver(clientC, photoVan.id, wrong.path, wrong.thumbPath)) === 'not_this_vehicle', "another vehicle's folder: not_this_vehicle");

  // The documents: driver C holds docVan (Start work through the queue); the office has uploaded its documents.
  const docVan = must(await admin.from('vehicles').insert({ reg_no: `TEST ${run.toUpperCase()}-5`, make_model: 'Toyota KDH', vehicle_type: 'van' }).select('id').single(), 'vehicle');
  const sessionC = randomUUID();
  queueC.add({ kind: 'session_start', id: sessionC, employee_id: c.row.id, vehicle_id: docVan.id, started_at: new Date().toISOString(), device_info: { model: 'test phone' } });
  result = await syncC.flush();
  check(result.failed === 0 && (await api.fetchHeldVehicle(clientC)) === docVan.id, 'Start work with the van: my_held_vehicle() is the van', { result, failed: queueC.failed() });
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  async function addDocument(vehicleId: string, kind: string, at: string, opts: { expiry?: string; image?: boolean; removed?: boolean; name?: string } = {}) {
    const id = randomUUID();
    const path = `${vehicleId}/${kind}/${id}.${opts.image ? 'jpg' : 'pdf'}`;
    const body = opts.image ? TINY_JPEG : PDF;
    const contentType = opts.image ? 'image/jpeg' : 'application/pdf';
    const stored = await admin.storage.from('vehicle-docs').upload(path, body, { contentType });
    if (stored.error) throw new Error(`document file: ${stored.error.message}`);
    must(await admin.from('vehicle_documents').insert({
      id, vehicle_id: vehicleId, kind, name: opts.name ?? null, path, content_type: contentType, bytes: body.length, expiry: opts.expiry ?? null,
      uploaded_by_name: 'test', uploaded_at: at, removed_at: opts.removed ? at : null, removed_by: opts.removed ? 'test' : null,
      removed_reason: opts.removed ? 'replaced' : null,
    }).select('id').single(), 'document');
    return { id, path };
  }
  const oldLicence = await addDocument(docVan.id, 'revenue_licence', '2026-01-02T00:00:00Z', { expiry: '2026-06-30', removed: true });
  const licence = await addDocument(docVan.id, 'revenue_licence', '2026-07-01T00:00:00Z', { expiry: '2027-06-30', image: true });
  const insurance = await addDocument(docVan.id, 'insurance', '2026-07-02T00:00:00Z', { expiry: '2026-11-01' });
  const emission = await addDocument(docVan.id, 'emission', '2026-07-03T00:00:00Z', { expiry: '2027-01-15' });
  const registration = await addDocument(docVan.id, 'registration', '2026-07-04T00:00:00Z');
  const otherDoc = await addDocument(docVan.id, 'other', '2026-07-05T00:00:00Z', { name: 'Permit' });
  const elsewhere = await addDocument(photoVan.id, 'insurance', '2026-07-06T00:00:00Z', { expiry: '2027-02-01' });
  const docs = await api.fetchVehicleDocuments(clientC);
  const shownDocs = currentDocuments(docs);
  check(docs.map((d) => d.id).sort().join() === [licence.id, insurance.id, emission.id].sort().join()
    && shownDocs.map((d) => d.doc?.id).join() === [licence.id, insurance.id, emission.id].join(),
    "the driver reads only the held vehicle's revenue licence, insurance and emission test: not the replaced licence, the CR, Other, or another vehicle's",
    { got: docs.map((d) => `${d.kind}:${d.id === oldLicence.id ? 'old' : ''}`) });
  check(docs.find((d) => d.id === licence.id)?.content_type === 'image/jpeg' && docs.find((d) => d.id === insurance.id)?.expiry === '2026-11-01',
    'each row carries its type (a photo opens in the app, a PDF in the browser) and its expiry');
  const pdfLink = await clientC.storage.from('vehicle-docs').createSignedUrl(insurance.path, 3600);
  const pdfBytes = pdfLink.data?.signedUrl ? Buffer.from(await (await fetch(pdfLink.data.signedUrl)).arrayBuffer()) : null;
  check(pdfBytes !== null && pdfBytes.equals(PDF), 'Open: a 1-hour link the app signs itself, and it serves the file', pdfLink.error);
  const refusedLinks = await Promise.all([registration.path, otherDoc.path, elsewhere.path].map((p) => clientC.storage.from('vehicle-docs').createSignedUrl(p, 3600)));
  check(refusedLinks.every((l) => !l.data?.signedUrl), "no link for the CR, Other, or another vehicle's document", refusedLinks.map((l) => l.error?.message));
  check(!(await api.fetchVehicleDocuments(client)).some((d) => d.vehicle_id === docVan.id), "driver A, who does not hold the van, reads none of its documents");
  queueC.add({ kind: 'session_end', id: sessionC, ended_at: new Date().toISOString(), end_reason: 'driver' });
  result = await syncC.flush();
  check(result.failed === 0 && (await api.fetchHeldVehicle(clientC)) === null && (await api.fetchVehicleDocuments(clientC)).length === 0,
    'Finish work: no vehicle held, no documents (the screen says "Start work with a vehicle")');

  console.log('\n== The other driver ==');
  const clientB = driverClient({ value: true });
  await api.signIn(clientB, b.username, b.pin);
  const tasksB = await api.fetchTasks(clientB, since);
  const seenByB = await Promise.all([
    clientB.from('location_points').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    clientB.from('photos').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    clientB.from('odometer_logs').select('id', { count: 'exact', head: true }).eq('employee_id', a.row.id),
    clientB.storage.from('driver-photos').list(`${a.row.id}/${day}`),
  ]);
  check(tasksB.every((t) => t.employee_id === b.row.id) && tasksB.some((t) => t.id === taskOfB) && tasksB.some((t) => t.id === task7), 'driver B sees only their own tasks, including the one given to B', tasksB.map((t) => t.title));
  check(seenByB[0].count === 0 && seenByB[1].count === 0 && seenByB[2].count === 0 && (seenByB[3].data ?? []).length === 0, 'driver B sees none of driver A\'s points, photos, readings or files');

  await admin.from('employees').update({ active: false }).eq('id', a.row.id);
  check((await api.fetchMe(client)) === null && (await api.fetchTasks(client, since)).length === 0, 'once the office switches driver A off, the app gets nothing (it then signs out)');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
