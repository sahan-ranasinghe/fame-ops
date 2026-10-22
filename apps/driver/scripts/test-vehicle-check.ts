// Round 4–7, feature 4 (docs/phase8-plan.md §33.1): the vehicle check before work, the driver app's side.
//   - the rule (lib/vehicleCheck.ts needsCheck): a check is needed, not after one today, another day's check does not count
//     (Colombo midnight), the switch off asks nothing, another vehicle's (or another driver's) check does not count;
//   - today's checks on the phone and read back from the server (mergeChecks, parseCheck);
//   - the queue: the ops' shapes (the check's row = the driver's insert grant; a side photo's link and side) and their
//     order (the check, then the report naming it, then the photos), run through the real engine (sync/engine.ts) with a
//     fake server, and a pre-trip report whose check was refused for good still reaching the office;
//   - get_driver_settings' five switches (absent = on);
//   - Damage in every list of categories; 1 to 6 photos on a pre-trip report, 1 to 3 elsewhere;
//   - the four routes and Today's card reach the one screen (source checks);
//   - every new key in English and Sinhala (en.json / si.json, with src/i18n/parts/*.json merged in while they exist),
//     the same placeholders in both, counts in Latin digits and never spelled out.
//
//   npm run test:vehicle-check          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as realApi from '../src/lib/api';
import { ApiError, CHECK_COLUMNS, DEFAULT_DRIVER_SETTINGS, FEATURE_SWITCHES, fetchDriverSettings, switchOn } from '../src/lib/api';
import { photoOp, photoStoragePath } from '../src/lib/photoRules';
import { colomboDate } from '../src/lib/time';
import {
  CHECK_HOWS,
  CHECK_SIDES,
  checkOp,
  checkRow,
  checkToday,
  heldHowFor,
  knownOdometer,
  mergeChecks,
  needsCheck,
  nextSide,
  parseCheck,
  parseHow,
  PRE_TRIP_MAX_PHOTOS,
  problemOps,
  REPORT_CATEGORIES,
  REPORT_MAX_PHOTOS,
  reportOps,
  reportRow,
  sidePhotoOps,
  type VehicleCheck,
} from '../src/lib/vehicleCheck';
import { createSync, type Op, type QueueStore, type StoredOp } from '../src/sync/engine';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'src');
const code = (p: string) => readFileSync(join(src, p), 'utf8');

let failures = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

// --- the strings: en.json / si.json, with the sidecars merged in while they exist (the lead merges and deletes them) ----
type Dict = Record<string, unknown>;
const loadJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Dict;
function deepMerge(into: Dict, from: Dict): void {
  for (const [k, v] of Object.entries(from)) {
    const had = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && had && typeof had === 'object' && !Array.isArray(had)) deepMerge(had as Dict, v as Dict);
    else into[k] = v;
  }
}
const dicts = { en: loadJson(join(src, 'i18n', 'en.json')), si: loadJson(join(src, 'i18n', 'si.json')) };
const partsDir = join(src, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const name of readdirSync(partsDir).filter((n) => n.endsWith('.json'))) {
    const part = loadJson(join(partsDir, name));
    deepMerge(dicts.en, (part.en ?? {}) as Dict);
    deepMerge(dicts.si, (part.si ?? {}) as Dict);
  }
}
const lookup = (lang: 'en' | 'si', key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Dict)[k] : undefined), dicts[lang]);
const text = (lang: 'en' | 'si', key: string) => {
  const v = lookup(lang, key);
  return typeof v === 'string' ? v : null;
};

// "Now": Thursday 22 October 2026, 10:00 in Colombo (04:30 UTC).
const NOW = Date.parse('2026-10-22T04:30:00Z');
const ON = { vehicle_check: true };
const OFF = { vehicle_check: false };
const E1 = 'e1';
const V1 = 'v1';
const V2 = 'v2';
const mk = (over: Partial<VehicleCheck> = {}): VehicleCheck => ({
  id: 'c1', vehicle_id: V1, employee_id: E1, task_id: null, checked_at: '2026-10-22T02:30:00.000Z', result: 'ok', odometer_km: 1200, how: 'clock_in', ...over,
});

console.log('The rule: one check a day per vehicle (lib/vehicleCheck.ts needsCheck)');
{
  check(needsCheck(V1, [], NOW, ON, E1), 'no check yet: the vehicle needs its check');
  check(!needsCheck(V1, [mk()], NOW, ON, E1), 'checked today (08:00): not asked again');
  check(!needsCheck(V1, [mk({ result: 'problem' })], NOW, ON, E1), 'a check that found a problem counts too (one of the two was chosen)');
  check(needsCheck(V1, [mk({ checked_at: '2026-10-21T14:30:00.000Z' })], NOW, ON, E1), "yesterday's check (20:00) does not count today");
  check(needsCheck(V1, [mk({ checked_at: '2026-10-21T18:29:00.000Z' })], NOW, ON, E1), '23:59 Colombo on the 21st is another day (UTC+05:30)');
  check(!needsCheck(V1, [mk({ checked_at: '2026-10-21T18:31:00.000Z' })], NOW, ON, E1), '00:01 Colombo on the 22nd is today');
  check(!needsCheck(V1, [], NOW, OFF, E1) && !needsCheck(V1, [mk({ checked_at: '2026-10-20T03:00:00Z' })], NOW, OFF, E1), 'the switch off: nothing asks, Start task is never held');
  check(needsCheck(V2, [mk()], NOW, ON, E1), "a check of another vehicle does not count (v1 checked, v2 still needs one)");
  check(needsCheck(V1, [mk({ employee_id: 'e2' })], NOW, ON, E1), "another driver's check of the same vehicle does not count");
  check(!needsCheck(null, [], NOW, ON, E1) && !needsCheck(undefined, [], NOW, ON, E1) && !needsCheck('', [], NOW, ON, E1), 'no vehicle ("No vehicle today"): nothing to check');
  const later = mk({ id: 'c2', checked_at: '2026-10-22T03:30:00.000Z', result: 'problem' });
  check(checkToday(V1, [mk(), later], NOW, E1)?.id === 'c2', "today's latest check of the vehicle is the one shown");
  check(checkToday(V1, [mk({ checked_at: '2026-10-21T03:00:00Z' })], NOW, E1) === null, 'none today: null');
}

console.log('\nToday\'s checks on the phone and from the server (mergeChecks, parseCheck)');
{
  const local = mk({ id: 'local' });
  const server = [
    { ...mk({ id: 'srv' }), channel: 'app', received_at: '2026-10-22T02:31:00Z' },
    { ...mk({ id: 'old', checked_at: '2026-10-21T03:00:00Z' }) },
    { id: 'bad', vehicle_id: V1 },
    { ...mk({ id: 'local', odometer_km: 1300 }) },
  ];
  const merged = mergeChecks([local, mk({ id: 'yesterday', checked_at: '2026-10-21T03:00:00Z' })], server, NOW);
  check(same(merged.map((c) => c.id).sort(), ['local', 'srv']), 'the server\'s of today plus the phone\'s own still on its way; other days and bad rows left out', merged.map((c) => c.id));
  check(merged.find((c) => c.id === 'local')?.odometer_km === 1300, 'one per id: the server\'s copy wins when both have it');
  check(Object.keys(merged[0]).sort().join() === ['checked_at', 'employee_id', 'how', 'id', 'odometer_km', 'result', 'task_id', 'vehicle_id'].join(), 'the phone keeps the check\'s own columns only (no channel, no received_at)', Object.keys(merged[0]));
  check(parseCheck({ ...mk(), result: 'maybe' }) === null && parseCheck({ ...mk(), checked_at: 'yesterday' }) === null && parseCheck(null) === null, 'a row with an unknown result or a bad time is not a check');
  check(parseCheck({ ...mk(), how: 'trip' })?.how === 'trip' && parseCheck({ ...mk(), how: 'later' })?.how === 'clock_in', "the office side's 'trip' is kept; an unknown how reads as a clock-in");
  check(mergeChecks([local], [], Date.parse('2026-10-22T18:31:00Z')).length === 0, 'after Colombo midnight the phone keeps none of yesterday\'s');
}

console.log('\nHow, the odometer, the guided capture');
{
  check(same([...CHECK_HOWS], ['clock_in', 'change', 'task_start', 'vehicle_confirm']), 'the four ways a driver takes a vehicle (the server\'s how values for the app)');
  check(parseHow('change') === 'change' && parseHow('task_start') === 'task_start' && parseHow('vehicle_confirm') === 'vehicle_confirm' && parseHow(undefined) === 'clock_in' && parseHow('x') === 'clock_in', 'the screen\'s how parameter: known words, else clock_in');
  check(heldHowFor({ vehicleId: V1, how: 'clock_in' }, V1) === 'clock_in' && heldHowFor({ vehicleId: V1, how: 'task_start' }, V1) === 'task_start', "Today's card answers with how the phone took the vehicle held");
  check(heldHowFor({ vehicleId: V1, how: 'clock_in' }, V2) === 'change' && heldHowFor(null, V1) === 'clock_in', 'a vehicle the phone did not take came by a change (the office moved the driver); nothing noted: a clock-in');
  check(knownOdometer(195049.6) === 195050 && knownOdometer(null) === null && knownOdometer(-3) === null && knownOdometer(Number.NaN) === null, 'the odometer the phone knows: whole km, else nothing');
  check(same([...CHECK_SIDES], ['front', 'back', 'left', 'right']), 'the four sides in the order they are asked');
  check(nextSide({}) === 'front' && nextSide({ front: 1 }) === 'back' && nextSide({ front: 1, back: 1, right: 1 }) === 'left' && nextSide({ front: 1, back: 1, left: 1, right: 1 }) === null, 'the next side to take; none once all four are taken');
}

console.log('\nThe queue: shapes and order (check → report → photos)');
const photo = (id: string) => ({ id, uri: `file:///photos/${id}.jpg`, takenAt: '2026-10-22T02:29:00.000Z', lat: 6.9, lng: 79.86 });
const migration = readFileSync(join(root, '..', '..', 'supabase', 'migrations', '20261022120100_round4_vehicle_check.sql'), 'utf8');
const grant = /grant insert \(([^)]+)\) on public\.vehicle_checks to authenticated/.exec(migration)?.[1].split(',').map((c) => c.trim()) ?? [];
{
  const ok = checkRow({ id: 'c1', vehicleId: V1, employeeId: E1, at: '2026-10-22T02:30:00.000Z', result: 'ok', odometerKm: 1200.4, how: 'clock_in' });
  const op = checkOp(ok);
  check(op.kind === 'vehicle_check' && grant.length === 8 && same(Object.keys(op.row).sort(), [...grant].sort()), "the check's row is exactly the driver's insert grant (no channel, no demo)", { row: Object.keys(op.row), grant });
  check(same(CHECK_COLUMNS.split(',').map((c) => c.trim()).sort(), [...grant].sort()), 'the read back asks for the same columns (CHECK_COLUMNS)');
  check(op.row.odometer_km === 1200 && op.row.task_id === null && op.row.result === 'ok' && op.row.how === 'clock_in', 'who, which vehicle, when, the result, the odometer the phone knows, how');

  const problem = checkRow({ id: 'c2', vehicleId: V1, employeeId: E1, taskId: 't1', at: '2026-10-22T02:30:00.000Z', result: 'problem', odometerKm: null, how: 'task_start' });
  const row = reportRow({ id: 'r1', vehicleId: V1, employeeId: E1, taskId: 't1', category: 'damage', note: '  Dent on the left door ', at: '2026-10-22T02:30:00.000Z' });
  const ops = problemOps(problem, row, [photo('p1'), photo('p2')], E1);
  check(same(ops.map((o) => o.kind), ['vehicle_check', 'report', 'photo', 'photo']), 'a problem: the check first, then the report, then its photos', ops.map((o) => o.kind));
  const report = ops[1] as Extract<Op, { kind: 'report' }>;
  check(report.row.check_id === 'c2' && report.row.category === 'damage' && report.row.note === 'Dent on the left door' && report.row.task_id === 't1', 'the report names its check (pre-trip), Damage, the note trimmed, the task');
  check(!('needs_vehicle' in report.row), 'no "I need another vehicle" on a report before the start');
  const photos = ops.slice(2) as Extract<Op, { kind: 'photo' }>[];
  check(photos.every((p) => p.photo_kind === 'vehicle_report' && p.vehicle_report_id === 'r1' && !('vehicle_check_id' in p) && !('side' in p)), "the report's photos name the report (not the check) and have no side");
  check(photos[0].storage_path === `${E1}/2026-10-22/p1.jpg` && photos[0].storage_path === photoStoragePath(photo('p1'), E1), 'a photo goes to <employee>/<Colombo day>/<id>.jpg');

  const plain = reportOps(reportRow({ id: 'r2', vehicleId: V1, employeeId: E1, taskId: null, category: 'tyre', note: ' ', at: '2026-10-22T02:30:00.000Z', needsVehicle: true }), [photo('p3')], E1);
  const plainRow = (plain[0] as Extract<Op, { kind: 'report' }>).row;
  check(same(plain.map((o) => o.kind), ['report', 'photo']) && !('check_id' in plainRow) && plainRow.note === null && plainRow.needs_vehicle === true, 'an ordinary report: no check_id at all, an empty note is none, the tick kept');

  const sides = sidePhotoOps(ok, [{ side: 'front', photo: photo('f') }, { side: 'left', photo: photo('l') }], E1) as Extract<Op, { kind: 'photo' }>[];
  check(sides.every((p) => p.photo_kind === 'vehicle_check' && p.vehicle_check_id === 'c1' && p.vehicle_report_id === null) && same(sides.map((p) => p.side), ['front', 'left']), 'an all-good check\'s photos: kind vehicle_check, linked to the check, each with its side');
  check(same(Object.keys(photoOp(photo('o'), 'odometer', E1)).sort(), ['employee_id', 'id', 'kind', 'lat', 'lng', 'local_uri', 'photo_kind', 'storage_path', 'taken_at', 'vehicle_report_id']), 'every other photo\'s op is what it always was (no check link, no side)');
}

function memoryStore() {
  let seq = 0;
  const ops: (StoredOp & { failed?: string })[] = [];
  const store: QueueStore = {
    nextOps: (limit) => ops.filter((item) => item.failed === undefined).slice(0, limit),
    removeOp: (id) => void ops.splice(ops.findIndex((item) => item.seq === id), 1),
    updateOp: () => undefined,
    failOp: (id, error) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.failed = error;
    },
    nextPoints: () => [],
    removePoints: () => undefined,
    rejectPoints: () => undefined,
    nextHeartbeats: () => [],
    removeHeartbeats: () => undefined,
    rejectHeartbeats: () => undefined,
  };
  return { store, add: (...list: Op[]) => list.forEach((op) => ops.push({ seq: ++seq, op })), waiting: () => ops.filter((o) => o.failed === undefined).length, failed: () => ops.filter((o) => o.failed !== undefined) };
}
async function engine() {
  console.log('\nThe engine sends them in that order (sync/engine.ts, a fake server)');
  const calls: string[] = [];
  let refuse: 'none' | 'check' | 'checked_report' = 'none';
  const api = {
    ...realApi,
    insertVehicleCheck: async (_c: unknown, row: realApi.VehicleCheckInsert) => {
      if (refuse === 'check') throw new ApiError('vehicle check: new row violates check constraint "vehicle_checks_not_future"', true, '23514', 400);
      calls.push(`check:${row.id}:${row.result}:${row.how}`);
    },
    insertReport: async (_c: unknown, row: realApi.ReportInsert) => {
      if (refuse !== 'none' && row.check_id) throw new ApiError('report: check_mismatch', true, '23514', 400);
      calls.push(`report:${row.id}:${row.check_id ?? '-'}`);
    },
    insertPhoto: async (_c: unknown, row: realApi.PhotoInsert) => {
      calls.push(`photo:${row.id}:${row.kind}:${row.vehicle_report_id ?? '-'}:${row.vehicle_check_id ?? '-'}:${row.side ?? '-'}`);
    },
  } as unknown as typeof realApi;
  const refused: string[] = [];
  const run = async (ops: Op[]) => {
    const q = memoryStore();
    q.add(...ops);
    calls.length = 0;
    const sync = createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => E1,
      uploadFile: async (_uri, path) => void calls.push(`upload:${path}`),
      removeFile: () => undefined,
      api,
      now: () => NOW,
      onRefused: (op, message) => void refused.push(`${op.kind}:${message}`),
    });
    const result = await sync.flush();
    return { q, result };
  };

  const problem = checkRow({ id: 'c2', vehicleId: V1, employeeId: E1, taskId: 't1', at: '2026-10-22T02:30:00.000Z', result: 'problem', odometerKm: null, how: 'task_start' });
  const row = reportRow({ id: 'r1', vehicleId: V1, employeeId: E1, taskId: 't1', category: 'accident', note: '', at: '2026-10-22T02:30:00.000Z' });
  const ok = checkRow({ id: 'c3', vehicleId: V2, employeeId: E1, at: '2026-10-22T02:40:00.000Z', result: 'ok', odometerKm: 50, how: 'change' });
  {
    const { q, result } = await run([
      ...problemOps(problem, row, [photo('p1')], E1),
      checkOp(ok),
      ...sidePhotoOps(ok, [{ side: 'back', photo: photo('b') }], E1),
    ]);
    check(same(calls, [
      'check:c2:problem:task_start',
      'report:r1:c2',
      `upload:${E1}/2026-10-22/p1.jpg`,
      'photo:p1:vehicle_report:r1:-:-',
      'check:c3:ok:change',
      `upload:${E1}/2026-10-22/b.jpg`,
      'photo:b:vehicle_check:-:c3:back',
    ]), 'sent in queue order: the check, the report naming it, its photo; the next check, then its side photo with its link and side', calls);
    check(result.sent === 5 && q.waiting() === 0 && !result.offline, 'all five sent, nothing left waiting', result);
  }
  {
    refuse = 'check';
    const { q } = await run([...problemOps(problem, row, [], E1)]);
    check(same(calls, ['report:r1:-']) && q.failed().length === 1 && refused.some((r) => r.startsWith('vehicle_check:')), 'a check refused for good (a phone clock far ahead) is kept as failed; its report still reaches the office, as an ordinary report', { calls, refused });
    refuse = 'none';
  }
}

async function settings() {
  console.log('\nThe five switches (get_driver_settings; absent = on)');
  const client = (data: unknown) => ({ rpc: async () => ({ data, error: null, status: 200 }) }) as unknown as realApi.Client;
  check(same([...FEATURE_SWITCHES], ['vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact']), 'the five switches of Round 4–7');
  check(FEATURE_SWITCHES.every((k) => DEFAULT_DRIVER_SETTINGS[k] === true), 'all on by default (before the first read, and on a phone that kept older settings)');
  const old = await fetchDriverSettings(client({ shift_start: '08:00' }));
  check(FEATURE_SWITCHES.every((k) => old[k] === true), 'a server that does not answer them yet: all on');
  const off = await fetchDriverSettings(client({ vehicle_check: false, trip_close_prompt: true, fuel_card: false, passengers: true }));
  check(off.vehicle_check === false && off.fuel_card === false && off.trip_close_prompt && off.passengers && off.holder_contact, 'false is off; true and absent are on', off);
  check(switchOn(undefined) && switchOn(null) && switchOn(true) && switchOn('false') && !switchOn(false), 'only exactly false turns a switch off');
  check(!needsCheck(V1, [], NOW, off, E1) && needsCheck(V1, [], NOW, old, E1), 'the rule reads the setting: off asks nothing');
}

console.log('\nDamage and the photos');
{
  check(same([...REPORT_CATEGORIES], ['breakdown', 'accident', 'tyre', 'warning_light', 'damage', 'other']), 'six categories, Damage before Other (the server\'s list)');
  const constraint = /vehicle_reports_category_check\s+check \(category in \(([^)]+)\)\)/.exec(migration)?.[1].split(',').map((c) => c.trim().replace(/'/g, '')) ?? [];
  check(same(constraint, [...REPORT_CATEGORIES]), 'the same six as the database allows', constraint);
  check(/'damage'/.test(code('lib/types.ts').match(/export type ReportCategory = [^;]+;/)?.[0] ?? ''), 'ReportCategory has damage');
  check(/REPORT_CATEGORIES\.map/.test(code('components/ReportForm.tsx')) && !/const CATEGORIES/.test(code('components/ReportForm.tsx')), 'the report form lists them from the one list (the Report tab, report-problem, the check)');
  check(REPORT_CATEGORIES.every((c) => text('en', `report.${c}`) && text('si', `report.${c}`)), "every category has its words in both languages (the form's chips, the Report tab's list)");
  check(PRE_TRIP_MAX_PHOTOS === 6 && REPORT_MAX_PHOTOS === 3, '1 to 6 photos on a pre-trip report, 1 to 3 elsewhere');
  check(/maxPhotos=\{PRE_TRIP_MAX_PHOTOS\}/.test(code('app/vehicle-check.tsx')) && !/maxPhotos/.test(code('app/(tabs)/report.tsx')) && !/maxPhotos/.test(code('app/report-problem.tsx')), 'only the check\'s report takes 6');
  check(/maxPhotos = REPORT_MAX_PHOTOS/.test(code('components/ReportForm.tsx')) && /photos\.length < maxPhotos/.test(code('components/ReportForm.tsx')), 'the form stops at its own maximum');
}

console.log('\nThe four routes and Today\'s card reach the one screen');
{
  const vehicle = code('app/vehicle.tsx');
  check(/afterTake\(picked, 'clock_in'\)/.test(vehicle) && /afterTake\(picked, 'change'\)/.test(vehicle) && /checkNeeded\(vehicleId\)\) router\.replace\(\{ pathname: '\/vehicle-check'/.test(vehicle), 'Start work and Change vehicle: on to the check in the picker\'s place (back = Today)');
  const log = code('app/log-mileage.tsx');
  check(/const checkFirst = app\.checkNeeded\(checkVehicleId\)/.test(log) && /needsOdometer = mode !== 'fuel' && !confirming && !checkFirst/.test(log) && /if \(checkFirst\) return;/.test(log), 'Start task: the odometer step and the save wait for the check');
  check(/vehicleConfirmed \? 'vehicle_confirm' : 'task_start'/.test(log) && /router\.push\(\{ pathname: '\/vehicle-check', params: \{ vehicleId: checkVehicleId, how: checkHow, taskId: task\.id \} \}\)/.test(log), 'the task\'s vehicle (task_start) or the one confirmed on the day (vehicle_confirm): the check pushed over the start, with the task');
  check(/askedCheck\.current === checkVehicleId/.test(log) && /<VehicleCheckCard vehicleId=\{checkVehicleId\}[^>]*body="vehicleCheck\.startWaits"/.test(log), 'asked once per vehicle; back without an answer leaves the card in the odometer\'s place');
  const today = code('app/(tabs)/index.tsx');
  const notices = today.indexOf('<DutyNotices />');
  const card = today.indexOf('<VehicleCheckCard');
  const nextCard = today.indexOf('{next ? (');
  check(notices > 0 && card > notices && nextCard > card, "Today: the card between the duty notices and the next task's card");
  check(/app\.sharing && app\.vehicle && app\.checkNeeded\(app\.vehicle\.id\)/.test(today), 'only on duty, with a vehicle held, while that vehicle needs its check');
  const state = code('state/app.tsx');
  check(/needsCheck\(vehicleId, checks, Date\.now\(\), shift, me\?\.id\)/.test(state), 'one rule in the state: the switch, my checks of today, me');
  check(/problemOps\(check, row, photos, current\.id\)/.test(state) && /enqueue\(checkOp\(check\)\)/.test(state) && /sidePhotoOps\(check, shots, current\.id\)/.test(state), 'the state queues through the same builders this test runs');
  check(/api\.fetchMyChecks\(supabase, startOfColomboDay\(colomboDate\(\)\)\)/.test(state) && /mergeChecks\(checksRef\.current, checkRows, Date\.now\(\)\)/.test(state), "refresh (and a fresh sign-in) reads my checks of today back and keeps the phone's own");
  check(/remove\(KEYS\.vehicleChecks\)/.test(state), 'signing out forgets them');
  const screen = code('app/vehicle-check.tsx');
  check(!/skip/i.test(screen.replace(/^\/\/.*$/gm, '')), 'no Skip on the screen: one of the two answers is needed');
  check(/type !== 'GO_BACK' && type !== 'POP'/.test(screen) && /stepBack\('ask'/.test(screen) && /stepBack\('done'/.test(screen), 'back from the report or the photos steps back inside the screen; from the question it leaves without answering');
}

console.log('\nThe strings, English and Sinhala');
{
  const NEW_KEYS = [
    'vehicleCheck.title', 'vehicleCheck.question', 'vehicleCheck.hint', 'vehicleCheck.required', 'vehicleCheck.allGood',
    'vehicleCheck.problem', 'vehicleCheck.problemHint', 'vehicleCheck.savedTitle', 'vehicleCheck.savedAt', 'vehicleCheck.problemAt',
    'vehicleCheck.addPhotos', 'vehicleCheck.photosAdded', 'vehicleCheck.continue', 'vehicleCheck.photosTitle', 'vehicleCheck.photosHint',
    'vehicleCheck.takeSide', 'vehicleCheck.retakeHint', 'vehicleCheck.savePhotos', 'vehicleCheck.cardTitle', 'vehicleCheck.cardBody',
    'vehicleCheck.checkNow', 'vehicleCheck.startWaits', 'report.damage', 'report.photosOf',
    ...CHECK_SIDES.map((s) => `vehicleCheck.side.${s}`),
  ];
  const missing = NEW_KEYS.flatMap((k) => (['en', 'si'] as const).filter((l) => !text(l, k)).map((l) => `${l}:${k}`));
  check(missing.length === 0, `every new key in both languages (${NEW_KEYS.length})`, missing);
  // Every key the new and changed screens name, also the ones in a ternary.
  const files = ['app/vehicle-check.tsx', 'components/VehicleCheckCard.tsx', 'components/ReportForm.tsx', 'app/log-mileage.tsx', 'app/(tabs)/report.tsx', 'app/(tabs)/index.tsx', 'app/vehicle.tsx'];
  const named = new Set(files.flatMap((f) => [...code(f).matchAll(/'((?:vehicleCheck|report|done|common)\.[A-Za-z_.]+)'/g)].map((m) => m[1])));
  const unnamed = [...named].filter((k) => !text('en', k) || !text('si', k));
  check(named.size > 20 && unnamed.length === 0, `every key the screens name has text in both (${named.size})`, unnamed);
  const vars = (s: string | null) => [...(s ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const mismatched = NEW_KEYS.filter((k) => vars(text('en', k)) !== vars(text('si', k)));
  check(mismatched.length === 0, 'the same placeholders in both ({plate}, {time}, {n}, {max}, {side})', mismatched);
  check(/\{plate\}/.test(text('en', 'vehicleCheck.question') ?? '') && /\{plate\}/.test(text('en', 'vehicleCheck.cardTitle') ?? ''), 'the plate goes in its chip (PlateText) where each language puts it');
  const all = NEW_KEYS.flatMap((k) => [text('en', k) ?? '', text('si', k) ?? '']);
  check(all.every((s) => !/[෦-෯]/.test(s)), 'no Sinhala digits: numbers in Latin digits in both languages');
  const enWords = NEW_KEYS.map((k) => text('en', k) ?? '').filter((s) => /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(s));
  const siWords = NEW_KEYS.map((k) => text('si', k) ?? '').filter((s) => s.split(/[\s,.:()·]+/).some((w) => ['එක', 'දෙක', 'තුන', 'හතර', 'පහ', 'හය'].includes(w)));
  check(enWords.length === 0 && siWords.length === 0, 'no count spelled out in words', [...enWords, ...siWords]);
  check((['en', 'si'] as const).every((l) => /4/.test(text(l, 'vehicleCheck.addPhotos') ?? '') && /4/.test(text(l, 'vehicleCheck.photosTitle') ?? '') && /1\D+6/.test(text(l, 'vehicleCheck.problemHint') ?? '')), '"4 photos" and "1 to 6" are digits in both');
  check(text('en', 'vehicleCheck.allGood') === 'No, all good' && text('en', 'vehicleCheck.question') === 'Any damage or problem with {plate}?', 'the question and the one-tap answer, as the plan words them');
  const sidecar = join(partsDir, 'vehicle-check.json');
  if (existsSync(sidecar)) {
    const part = loadJson(sidecar);
    const flat = (o: unknown, p = ''): string[] => (o && typeof o === 'object' ? Object.entries(o as Dict).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p]);
    check(same(flat(part.en).sort(), flat(part.si).sort()) && same(flat(part.en).sort(), [...NEW_KEYS].sort()), 'the sidecar has the same keys in both languages, and exactly the new ones', { en: flat(part.en).length, keys: NEW_KEYS.length });
  }
}

void (async () => {
  await engine();
  await settings();
  console.log(failures ? `\n${failures} vehicle check test(s) FAILED.` : '\nAll vehicle check tests passed.');
  process.exit(failures ? 1 : 0);
})();
