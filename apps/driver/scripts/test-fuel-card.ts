// Round 4–7 (docs/phase8-plan.md §33.2, §33.3, §33.6, §33.7, §33.9), the driver app's side of the second piece:
//   - the fuel card's words (lib/fuelCard.ts): "About 180 km · roughly 12–15 L petrol (approx.)", one litre count when the
//     ends meet, no fuel word when the type is not set, electric "check the battery" (no question), no km = no card, the
//     switch off = no card, what the phone knows offline (the plan's km, the vehicle's fuel), the copies kept per task;
//   - the answer: the queue's op and the RPC (answer_fuel_card), run through the real engine (sync/engine.ts) with a fake
//     server ('ok' and 'not_yours' done, 'bad' kept as refused, no connection kept in line); fuel_estimate read through the
//     RPC and parsed;
//   - the reminder: 30 minutes, armed at the start for "I'll fill up on the way" (with the switch on), cancelled when a fill
//     is logged on the task or the task is finished, its tap opening Log fuel (the screens' and the module's source); the
//     running task's "Fill up on the way" line until a fill is logged;
//   - Log fuel's fill type: preselected from the vehicle (hybrid → petrol, electric → none), the grade kept only when it fits;
//   - the Recent card (5, See all) and the history (by month, the server's pages below the oldest row held, two lists merged
//     without an entry out of order), "–" for a missing amount and "N fills without an amount";
//   - the passengers' line and rows (Call only with a phone; the switch off: none);
//   - the empty place box's groups (Saved, then the driver's own Recent) and driver-api {suggest, near};
//   - the reports' rows (an icon per category, one line, one meta line; 5 and See all);
//   - every new key in English and Sinhala (en.json / si.json, with src/i18n/parts/*.json merged in while they exist), the
//     same placeholders in both, numbers in Latin digits.
//
//   npm run test:fuel-card          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as realApi from '../src/lib/api';
import { ApiError, PASSENGER_COLUMNS, VEHICLE_COLUMNS } from '../src/lib/api';
import { createDriverApi } from '../src/lib/driverApi';
import {
  asksQuestion,
  ESTIMATES_KEPT,
  estimateLine,
  fillColumns,
  fillOnWayPending,
  fillPreselect,
  fillTypeOf,
  FUEL_REMINDER_AFTER_MS,
  fuelAnswerDone,
  fuelAnswerOp,
  fuelCardShown,
  type FuelEstimate,
  GRADES,
  keepEstimate,
  litresRange,
  parseFuelEstimate,
  phoneEstimate,
  planKm,
  rememberAnswer,
  rememberFilled,
  sourceKey,
  withFillType,
  withGrade,
} from '../src/lib/fuelCard';
import {
  addPage,
  amountText,
  byMonth,
  cursorOf,
  fuelEntry,
  fuelLine,
  fuelTotals,
  HISTORY_PAGE,
  litresText,
  type LogEntry,
  mergeEntries,
  mergeSafe,
  missingAmountKey,
  odometerEntry,
  ofKind,
  RECENT_N,
  recentEntries,
  streamsFor,
  totalAmountText,
  videoMark,
  videoWords,
} from '../src/lib/history';
import { namesLine, passengerRows, ridingPassengers } from '../src/lib/passengers';
import { RECENT_REPORTS, REPORT_ICON, reportIcon, reportMeta, reportsSeeAll, reportTitle } from '../src/lib/reportList';
import { parseSearchAnswer, pickFromResult, suggestGroups } from '../src/lib/trips';
import type { TaskWithStops, VehicleReport } from '../src/lib/types';
import { createSync, type Op, type QueueStore, type StoredOp } from '../src/sync/engine';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
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
  for (const name of readdirSync(partsDir).filter((n) => n.endsWith('.json')).sort()) {
    const part = loadJson(join(partsDir, name));
    deepMerge(dicts.en, (part.en ?? {}) as Dict);
    deepMerge(dicts.si, (part.si ?? {}) as Dict);
  }
}
const lookup = (lang: 'en' | 'si', key: string): unknown =>
  key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Dict)[k] : undefined), dicts[lang]);
const text = (lang: 'en' | 'si', key: string): string | null => {
  const v = lookup(lang, key);
  return typeof v === 'string' ? v : null;
};
const tr = (lang: 'en' | 'si') => (key: string, vars?: Record<string, string | number>) => {
  const found = text(lang, key) ?? text('en', key);
  if (found === null) throw new Error(`No text for "${key}"`);
  return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), found);
};
const en = tr('en');
const si = tr('si');

// ------------------------------------------------------------------------------------------------------------------------
console.log('The fuel card\'s words (lib/fuelCard.ts)');
{
  const server = { task_id: 't1', km: 180, fuel_type: 'petrol', fuel_grade: 'petrol_92', electric: false, km_per_l: 12, source: 'default', litres_low: 13, litres_high: 17 };
  const est = parseFuelEstimate(server)!;
  check(est.taskId === 't1' && est.km === 180 && est.fuelType === 'petrol' && est.fuelGrade === 'petrol_92' && est.source === 'default' && est.answer === null, 'fuel_estimate\'s answer read field by field (null keys absent)', est);
  check(estimateLine(en, est) === 'About 180 km · roughly 13–17 L petrol (approx.)', '"About 180 km · roughly 13–17 L petrol (approx.)"', estimateLine(en, est));
  check(estimateLine(en, parseFuelEstimate({ ...server, fuel_type: 'diesel', fuel_grade: 'auto_diesel' })) === 'About 180 km · roughly 13–17 L diesel (approx.)', 'diesel says diesel');
  check(estimateLine(en, parseFuelEstimate({ ...server, fuel_type: 'hybrid', fuel_grade: undefined })) === 'About 180 km · roughly 13–17 L petrol (approx.)', 'a hybrid fills petrol');
  check(estimateLine(en, parseFuelEstimate({ ...server, fuel_type: undefined })) === 'About 180 km · roughly 13–17 L (approx.)', 'no fuel type set: the litres without a fuel word');
  check(estimateLine(en, parseFuelEstimate({ ...server, litres_low: 12, litres_high: 12 })) === 'About 180 km · roughly 12 L petrol (approx.)' && litresRange(12.4, 11.6) === '12', 'the two ends meet: one number');
  check(estimateLine(en, parseFuelEstimate({ ...server, km: 1234 })) === 'About 1,234 km · roughly 13–17 L petrol (approx.)', 'km with thousands separators, Latin digits');
  const electric = parseFuelEstimate({ task_id: 't2', km: 180, fuel_type: 'electric', electric: true })!;
  check(estimateLine(en, electric) === 'About 180 km · check the battery' && !asksQuestion(electric) && sourceKey(electric) === null, 'electric: "About 180 km · check the battery", no question');
  check(asksQuestion(est), 'a vehicle that is filled is asked "Enough fuel?"');
  const noKm = parseFuelEstimate({ task_id: 't3', fuel_type: 'petrol', electric: false, km_per_l: 12, source: 'default' })!;
  check(estimateLine(en, noKm) === null && !fuelCardShown(true, noKm), 'no km (no plan): no card');
  check(!fuelCardShown(false, est) && fuelCardShown(true, est), 'the switch fuel_card off: no card');
  check(parseFuelEstimate(null) === null && parseFuelEstimate({}) === null && parseFuelEstimate('x') === null, 'not the driver\'s task (null) or nothing: no estimate');
  check(sourceKey(est) === 'fuelCard.fromDefault' && sourceKey(parseFuelEstimate({ ...server, source: 'history' })!) === 'fuelCard.fromHistory', 'where the litres come from: the vehicle\'s fills, or a figure for its kind');
  const siLine = estimateLine(si, est) ?? '';
  check(siLine.includes('180') && siLine.includes('13–17') && !/[෦-෯]/.test(siLine) && siLine.includes(si('fuelKind.word.petrol')), 'Sinhala: the numbers in Latin digits, the fuel in Sinhala', siLine);
  check(parseFuelEstimate({ ...server, answer: 'fill_on_way', answered_at: '2026-10-22T03:00:00Z' })?.answer === 'fill_on_way' && parseFuelEstimate({ ...server, answer: 'maybe' })?.answer === null, 'the answer given before is read; an unknown one is not');
  // Offline: what the phone knows itself.
  const task = { id: 't1', plan_json: { total_km: 180.4 }, fuel_answer: null, fuel_answer_at: null } as unknown as TaskWithStops;
  const phone = phoneEstimate(task, { fuel_type: 'diesel', fuel_grade: 'super_diesel' });
  check(phone.km === 180 && phone.litresLow === null && phone.fuelType === 'diesel' && estimateLine(en, phone) === 'About 180 km', 'offline, nothing kept: "About 180 km" from the plan (no litres)', phone);
  check(estimateLine(en, phoneEstimate(task, { fuel_type: 'electric' })) === 'About 180 km · check the battery', 'offline, electric: the battery line');
  check(planKm({ legs: [{ km: 10.2 }, { km: 5.5 }] }) === 16 && planKm({ legs: [{ km: 10 }, {}] }) === null && planKm(null) === null && planKm({ total_km: 0 }) === null, 'the plan\'s km: total_km, else the legs added up; no plan: none');
  // The copies kept on the phone.
  let cache: Record<string, FuelEstimate> = {};
  for (let i = 0; i < ESTIMATES_KEPT + 3; i++) cache = keepEstimate(cache, { ...est, taskId: `t${i}` });
  check(Object.keys(cache).length === ESTIMATES_KEPT && cache[`t${ESTIMATES_KEPT + 2}`] !== undefined && cache.t0 === undefined, `the newest ${ESTIMATES_KEPT} estimates are kept per task`);
}

// ------------------------------------------------------------------------------------------------------------------------
console.log('\nThe answer: the RPCs and the queue (sync/engine.ts, a fake server)');
const rpcCalls: string[] = [];
const rpcAnswers: Record<string, unknown> = {};
function fakeClient(tables: Record<string, Record<string, unknown>[]> = {}) {
  const queries: string[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push(`${name}:${JSON.stringify(args)}`);
      return { data: rpcAnswers[name] ?? null, error: null, status: 200 };
    },
    from: (table: string) => {
      const steps: string[] = [table];
      let limit = 1000;
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => (steps.push(`select(${cols})`), b);
      b.order = (col: string, o?: { ascending?: boolean }) => (steps.push(`order(${col},${o?.ascending ? 'asc' : 'desc'})`), b);
      b.limit = (n: number) => ((limit = n), steps.push(`limit(${n})`), b);
      b.or = (f: string) => (steps.push(`or(${f})`), b);
      b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        queries.push(steps.join('.'));
        return Promise.resolve({ data: (tables[table] ?? []).slice(0, limit), error: null, status: 200 }).then(ok, bad);
      };
      return b;
    },
  };
  return { client: client as unknown as realApi.Client, queries };
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

async function answers() {
  const { client } = fakeClient();
  rpcAnswers.answer_fuel_card = 'ok';
  check(await realApi.answerFuelCard(client, 't1', 'fill_on_way', '2026-10-22T03:00:00.000Z') === 'ok'
    && rpcCalls.at(-1) === 'answer_fuel_card:{"p_task_id":"t1","p_answer":"fill_on_way","p_at":"2026-10-22T03:00:00.000Z"}', 'answer_fuel_card(task, answer, the phone\'s time)', rpcCalls.at(-1));
  rpcAnswers.fuel_estimate = { task_id: 't1', km: 42, fuel_type: 'diesel', electric: false, km_per_l: 10, source: 'history', litres_low: 4, litres_high: 5 };
  const est = await realApi.fetchFuelEstimate(client, 't1');
  check(rpcCalls.at(-1) === 'fuel_estimate:{"p_task_id":"t1"}' && est?.km === 42 && est.source === 'history', 'fuel_estimate(task) read and parsed', est);
  rpcAnswers.fuel_estimate = null;
  check(await realApi.fetchFuelEstimate(client, 'x') === null, 'not mine: no estimate');

  const op = fuelAnswerOp('t1', 'enough', '2026-10-22T03:00:00.000Z');
  check(same(op, { kind: 'fuel_answer', id: 't1', answer: 'enough', at: '2026-10-22T03:00:00.000Z' }), 'the queue\'s op: the task, the answer, the phone\'s time');
  check(fuelAnswerDone('ok') && fuelAnswerDone('not_yours') && !fuelAnswerDone('bad') && !fuelAnswerDone(null), "'ok' and 'not_yours' are final; 'bad' is a refusal");

  const sent: string[] = [];
  let reply: string = 'ok';
  let network = false;
  const api = {
    ...realApi,
    answerFuelCard: async (_c: unknown, taskId: string, answer: string, at: string) => {
      if (network) throw new ApiError('fuel answer: Network request failed', false);
      sent.push(`${taskId}:${answer}:${at}`);
      return reply;
    },
    patchTask: async (_c: unknown, id: string) => void sent.push(`start:${id}`),
  } as unknown as typeof realApi;
  const q = memoryStore();
  let now = Date.parse('2026-10-22T03:00:00Z');
  const sync = createSync({ client: {} as realApi.Client, store: q.store, employeeId: () => 'e1', uploadFile: async () => undefined, removeFile: () => undefined, api, now: () => now });
  // The start first, then the answer (state/app.tsx startTask queues them so).
  q.add({ kind: 'task_patch', id: 't1', patch: { status: 'in_progress' } }, op);
  let r = await sync.flush();
  check(r.sent === 2 && q.waiting() === 0 && same(sent, ['start:t1', 't1:enough:2026-10-22T03:00:00.000Z']), 'sent after the start, with the time it was said', sent);
  reply = 'not_yours';
  q.add(fuelAnswerOp('t2', 'fill_on_way', '2026-10-22T03:05:00.000Z'));
  r = await sync.flush();
  check(r.sent === 1 && r.failed === 0 && q.waiting() === 0, "'not_yours' (the task went to someone else): done, nothing kept", r);
  reply = 'bad';
  q.add(fuelAnswerOp('t3', 'enough', '2026-10-22T03:06:00.000Z'));
  r = await sync.flush();
  check(r.failed === 1 && q.failed().length === 1 && q.waiting() === 0, "'bad': refused, kept on the phone (never sent again by itself)", r);
  network = true;
  q.add(fuelAnswerOp('t4', 'enough', '2026-10-22T03:07:00.000Z'));
  r = await sync.flush();
  check(r.offline && q.waiting() === 1, 'no connection: it waits in line (works offline)', r);
  network = false;
  reply = 'ok';
  now = sync.backoff().nextTryAt;
  r = await sync.flush();
  check(r.sent === 1 && q.waiting() === 0, 'the connection is back: it goes', r);
}

// ------------------------------------------------------------------------------------------------------------------------
function reminderAndLine() {
  console.log('\nThe reminder and the running task\'s line');
  check(FUEL_REMINDER_AFTER_MS === 30 * 60_000, 'the reminder comes 30 minutes after the start');
  const running = { id: 't1', status: 'in_progress', fuel_answer: null } as unknown as TaskWithStops;
  let memos = rememberAnswer({}, 't1', 'fill_on_way', '2026-10-22T03:00:00Z');
  check(fillOnWayPending(running, memos, true), '"I\'ll fill up on the way" at the start: the line shows while the task runs');
  check(!fillOnWayPending(running, memos, false), 'the switch off: no line');
  check(!fillOnWayPending({ ...running, status: 'completed' } as TaskWithStops, memos, true), 'the task finished: no line');
  check(!fillOnWayPending(running, rememberAnswer({}, 't1', 'enough', '2026-10-22T03:00:00Z'), true), '"Yes" (enough fuel): no line');
  memos = rememberFilled(memos, 't1', '2026-10-22T03:40:00Z');
  check(!fillOnWayPending(running, memos, true) && memos.t1.answer === 'fill_on_way' && memos.t1.filledAt === '2026-10-22T03:40:00Z', 'a fill logged on the task: the line goes');
  check(fillOnWayPending({ ...running, fuel_answer: 'fill_on_way' } as TaskWithStops, {}, true), 'the answer from the server\'s copy of the task counts too (another sign-in)');
  let many = {};
  for (let i = 0; i < 25; i++) many = rememberAnswer(many, `t${i}`, 'enough', '2026-10-22T03:00:00Z');
  check(Object.keys(many).length === 20 && 't24' in many && !('t0' in many), 'the phone keeps the newest 20 answers');

  // The module and the screens (they need the phone's modules, so they are read as text).
  const notif = code('lib/notifications.ts');
  const arm = notif.slice(notif.indexOf('export async function armFuelReminder'), notif.indexOf('export async function disarmFuelReminder'));
  check(/SchedulableTriggerInputTypes\.TIME_INTERVAL/.test(arm) && /ready\.reminders \? REMINDERS_CHANNEL : CHANNELS\.tasksChanged/.test(arm)
    && /data: \{ kind: 'fuel', taskId \}/.test(arm) && /identifier: FUEL_REMINDER_ID/.test(arm), 'armed as a timed local notification on the reminders channel (the older build\'s fallback), its tap carries the task');
  check(/cancelScheduledNotificationAsync\(FUEL_REMINDER_ID\)/.test(notif) && /dismissNotificationAsync\(FUEL_REMINDER_ID\)/.test(notif), 'cancelled: the scheduled one and the one in the tray');
  const app = code('state/app.tsx');
  check(/const answer = shiftRef\.current\.fuel_card \? fuelAnswer \?\? null : null;/.test(app) && /enqueue\(fuelAnswerOp\(task\.id, answer, now\)\)/.test(app)
    && /if \(answer === 'fill_on_way'\) \{\s*void armFuelReminder\(task\.id, \{ title: tRef\.current\('fuelCard\.reminderTitle'\), body: tRef\.current\('fuelCard\.reminderBody'\) \}, FUEL_REMINDER_AFTER_MS\);/.test(app),
    'Start task queues the answer (switch on) and arms the reminder for "I\'ll fill up on the way"');
  check(/\.\.\.fillColumns\(fuel\.fill\)/.test(app) && /if \(taskId\) \{\s*saveFuelMemos\(rememberFilled\(fuelMemosRef\.current, taskId, at\)\);\s*void disarmFuelReminder\(\);/.test(app), 'a fill logged on the task cancels it (and sends its fuel type and grade)');
  check(/void playSound\('done'\);\s*\/\/ The task is over: no "Fill up on the way" reminder after it\.\s*void disarmFuelReminder\(\);/.test(app), 'Save & finish cancels it');
  check(/remove\(KEYS\.fuelMemos\);[\s\S]{0,120}void disarmFuelReminder\(\);/.test(app), 'sign-out forgets the answers and cancels it');
  // Review of Round 4–7: a reminder armed before the office turned the switch off never fires (tests/fuelCard.test.tsx runs it).
  const sw = code('lib/fuelReminderSwitch.ts');
  check(/useFuelReminderSwitch\(shift\.fuel_card\);/.test(app) && /if \(!on\) void disarmFuelReminder\(\);/.test(sw), 'the switch fuel_card off cancels a reminder already armed (and takes it out of the tray)');
  const layout = code('app/_layout.tsx');
  check(/if \(data\.kind === 'fuel'\) \{[\s\S]*?router\.push\(\{ pathname: '\/log-mileage', params: \{ mode: 'fuel', taskId \} \}\);/.test(layout), 'its tap opens Log fuel for the task (Today underneath)');
  const task = code('app/task/[id].tsx');
  check(/\{app\.fillOnWay\(task\) && \(/.test(task) && /params: \{ mode: 'fuel', taskId: task\.id \}/.test(task) && /t\('fuelCard\.fillLine'\)/.test(task) && /t\('log\.titleFuel'\)/.test(task), 'the running task: "Fill up on the way · Log fuel", a link to Log fuel');
  const log = code('app/log-mileage.tsx');
  check(/\{mode === 'start' && task && needsOdometer && <FuelCard task=\{task\} vehicle=\{vehicle\} answer=\{fuelAnswer\} onAnswer=\{setFuelAnswer\} \/>\}/.test(log)
    && /app\.startTask\(task, reading, fuelAnswer\)/.test(log), 'Start task: the card after the check and "Which vehicle?", the answer goes with the start (optional)');
  check(!/fuelAnswer/.test(log.slice(log.indexOf('const dirty ='), log.indexOf('const { allowLeave }'))) && !/if \(!fuelAnswer\)/.test(log), 'the answer never holds the start nor counts as unsaved input');
  const card = code('components/FuelCard.tsx');
  check(/if \(!fuelCardShown\(settings\.fuel_card, est\)\) return null;/.test(card) && /asksQuestion\(est\) &&/.test(card) && /prefetchFuelEstimate/.test(code('components/TaskPreview.tsx')), 'the card hides with the switch off or no km; the preview asks for the estimate ahead');
}

// ------------------------------------------------------------------------------------------------------------------------
function fillType() {
  console.log('\nLog fuel: the fill\'s type and grade');
  check(same(fillPreselect({ fuel_type: 'petrol', fuel_grade: 'petrol_95' }), { type: 'petrol', grade: 'petrol_95' }), 'petrol with its grade');
  check(same(fillPreselect({ fuel_type: 'hybrid', fuel_grade: 'petrol_92' }), { type: 'petrol', grade: 'petrol_92' }), 'a hybrid fills petrol');
  check(same(fillPreselect({ fuel_type: 'diesel', fuel_grade: 'super_diesel' }), { type: 'diesel', grade: 'super_diesel' }), 'diesel: Super Diesel');
  check(same(fillPreselect({ fuel_type: 'electric' }), { type: null, grade: null }) && same(fillPreselect(null), { type: null, grade: null }) && same(fillPreselect({}), { type: null, grade: null }), 'electric, or not set (an older copy): nothing preselected');
  check(same(fillPreselect({ fuel_type: 'petrol', fuel_grade: 'auto_diesel' }), { type: 'petrol', grade: null }), 'a grade that does not fit the type is dropped');
  check(fillTypeOf('hybrid') === 'petrol' && fillTypeOf('electric') === null && fillTypeOf('diesel') === 'diesel', 'what the pump fills');
  check(same(withFillType({ type: 'petrol', grade: 'petrol_95' }, 'diesel'), { type: 'diesel', grade: null }) && same(withFillType({ type: 'petrol', grade: 'petrol_95' }, 'petrol'), { type: 'petrol', grade: 'petrol_95' }), 'another type: the grade stays only when it fits');
  check(same(withGrade({ type: 'diesel', grade: null }, 'auto_diesel'), { type: 'diesel', grade: 'auto_diesel' }) && same(withGrade({ type: 'diesel', grade: 'auto_diesel' }, 'auto_diesel'), { type: 'diesel', grade: null })
    && same(withGrade({ type: 'diesel', grade: null }, 'petrol_92'), { type: 'diesel', grade: null }), 'a grade tapped (again: none); a petrol grade on diesel: ignored');
  check(same(fillColumns({ type: 'petrol', grade: 'petrol_92' }), { fuel_type: 'petrol', fuel_grade: 'petrol_92' }) && same(fillColumns({ type: 'diesel', grade: null }), { fuel_type: 'diesel' }) && same(fillColumns({ type: null, grade: null }), {}) && same(fillColumns(undefined), {}),
    'the fuel_logs columns: the type, the grade when it fits, nothing when not given');
  check(same(GRADES.petrol, ['petrol_92', 'petrol_95']) && same(GRADES.diesel, ['auto_diesel', 'super_diesel']), 'the grades: Petrol 92 / 95, Auto / Super Diesel');
  check(['petrol_92', 'petrol_95', 'auto_diesel', 'super_diesel'].every((g) => /\d|Diesel/.test(en(`fuelKind.${g}`)) && !/[෦-෯]/.test(si(`fuelKind.${g}`))), 'their words in both languages (the octane in Latin digits)');
  check(VEHICLE_COLUMNS.split(', ').includes('fuel_type') && VEHICLE_COLUMNS.split(', ').includes('fuel_grade'), 'the vehicle columns a driver reads include the fuel type and grade');
  check(/'fuel_type' in \(mine\[0\] \?\? \{\}\)/.test(readFileSync(join(here, 'test-data-layer.ts'), 'utf8')), 'test:data expects them on the vehicles read');
}

// ------------------------------------------------------------------------------------------------------------------------
async function recentAndHistory() {
  console.log('\nThe Recent card and the history (lib/history.ts)');
  const fill = (id: string, at: string, litres: number | null, cents: number | null, video = 'uploaded') =>
    fuelEntry({ id, logged_at: at, vehicle_id: 'v1', litres, amount_cents: cents, video_status: video, video_bytes: 1000 });
  const read = (id: string, at: string, km: number) => odometerEntry({ id, logged_at: at, vehicle_id: 'v1', reading_km: km });
  const entries: LogEntry[] = [
    fill('f1', '2026-10-22T03:00:00Z', 32.5, 1240000),
    read('o1', '2026-10-21T03:00:00Z', 195049),
    fill('f2', '2026-10-20T03:00:00Z', 20, null),
    read('o2', '2026-10-19T03:00:00Z', 194900),
    fill('f3', '2026-10-01T03:00:00Z', 10, 400000),
    read('o3', '2026-09-30T19:00:00Z', 194000), // 00:30 on 1 October in Colombo
    fill('f4', '2026-09-29T03:00:00Z', 15, 600000),
    read('o4', '2026-09-28T03:00:00Z', 193800),
  ];
  const recent = recentEntries(entries);
  check(RECENT_N === 5 && recent.length === 5 && same(recent.map((e) => e.id), ['f1', 'o1', 'f2', 'o2', 'f3']), 'the Recent card: the newest 5, mixed, newest first');
  const pending = fuelEntry({ id: 'f0', logged_at: '2026-10-22T04:00:00Z', vehicle_id: 'v1', litres: 5, amount_cents: null }, true);
  const merged = mergeEntries([pending, { ...entries[0], onPhone: true }], entries);
  check(merged[0].id === 'f0' && merged.filter((e) => e.id === 'f1').length === 1 && merged.find((e) => e.id === 'f1')?.onPhone === true, 'the phone\'s own entries join in, each once (the phone\'s copy first)');
  const groups = byMonth(entries);
  check(same(groups.map((g) => [g.month, g.rows.length]), [['2026-10', 6], ['2026-09', 2]]), 'grouped by the Colombo month, newest first (00:30 on the 1st is October)', groups.map((g) => [g.month, g.rows.map((r) => r.id)]));
  check(same(ofKind(entries, 'fuel').map((e) => e.id), ['f1', 'f2', 'f3', 'f4']) && ofKind(entries, 'odometer').length === 4 && ofKind(entries, 'all').length === 8, 'the chips: All · Odometer · Fuel');
  check(same(streamsFor('all'), ['odometer', 'fuel']) && same(streamsFor('fuel'), ['fuel']), 'All reads both lists; a chip reads its own');

  // Money: "–", never "LKR 0"; the totals add only the known amounts.
  check(amountText(null) === '–' && amountText(1240000) === 'LKR 12,400' && amountText(0) === 'LKR 0', 'a missing amount reads "–" (a real zero stays)');
  check(fuelLine(entries[0]) === '32.5 L · LKR 12,400' && fuelLine(entries[2]) === '20 L · –' && litresText(null) === '–', 'a fill\'s line: "32.5 L · LKR 12,400", "20 L · –"');
  const totals = fuelTotals(entries);
  check(totals.fills === 4 && totals.litres === 77.5 && totals.cents === 2240000 && totals.known === 3 && totals.missing === 1, 'the totals: litres of every fill, the known amounts only', totals);
  check(totalAmountText(totals) === 'LKR 22,400' && totalAmountText(fuelTotals([fill('x', '2026-10-01T00:00:00Z', 5, null)])) === '–', 'no fill with an amount: the total reads "–"');
  const one = missingAmountKey(totals)!;
  check(en(one.key, { n: one.n }) === '1 fill without an amount' && missingAmountKey(fuelTotals([entries[0]])) === null, '"1 fill without an amount"; none missing: nothing said');
  const two = missingAmountKey(fuelTotals([...entries, fill('f9', '2026-10-02T00:00:00Z', 3, null)]))!;
  check(en(two.key, { n: two.n }) === '2 fills without an amount' && si(two.key, { n: two.n }).includes('2'), '"2 fills without an amount" (Latin digits in Sinhala)');
  const fuelTab = code('app/(tabs)/fuel.tsx');
  check(/totalAmountText\(totals\)/.test(fuelTab) && /missingAmountKey\(totals\)/.test(fuelTab) && !/LKR \$\{thousands/.test(fuelTab), 'the Fuel tab says the total from the known amounts and the fills without one');

  // The video's mark.
  check(videoMark(entries[0], undefined, false).kind === 'uploaded' && videoMark({ videoStatus: 'none', videoBytes: null }, undefined, false).kind === 'none', 'uploaded: the mark; none: nothing');
  check(videoMark(entries[0], { failed: true, bytes: 10, offset: 0 }, false).kind === 'failed' && videoMark(entries[0], { failed: false, bytes: 10, offset: 0 }, true).kind === 'waitingWifi', 'failed (tap to retry); waiting for Wi-Fi');
  // Review of Round 4–7: a retry only while the phone's queue holds the piece; the server's "failed" alone is only said.
  check(same(videoMark(entries[0], { failed: true, bytes: 10, offset: 0 }, false), { kind: 'failed', retry: true }) && same(videoMark({ videoStatus: 'failed', videoBytes: 10 }, undefined, false), { kind: 'failed', retry: false }),
    'failed with the piece on the phone: retry; failed on the server with nothing queued: no retry');
  check(same(videoWords({ kind: 'failed', retry: true }, true), { key: 'fuel.failed', tone: 'red' }) && same(videoWords({ kind: 'failed', retry: true }, false), { key: 'fuel.uploadFailed', tone: 'red' }) && same(videoWords({ kind: 'failed', retry: false }, true), { key: 'fuel.uploadFailed', tone: 'red' }),
    '"Failed · tap to retry" only where a tap retries; else "Video upload failed"');
  check(same(videoWords({ kind: 'uploading', bytes: 8_808_038, offset: 3_523_216 }, false), { key: 'fuel.pctOfSize', vars: { pct: 40, size: '8.4 MB' }, tone: 'blue' }) && same(videoWords({ kind: 'none' }, false), { key: 'fuel.noVideo', tone: 'muted' }) && videoWords({ kind: 'waitingWifi' }, false).key === 'fuel.waitingWifi' && videoWords({ kind: 'uploaded' }, false).key === 'fuel.uploaded',
    'the words back: "40 % of 8.4 MB", "No video", "Waiting for Wi-Fi", "Uploaded"');
  check(same(videoMark({ videoStatus: 'recorded', videoBytes: 3000 }, { failed: false, bytes: 1000, offset: 500 }, false), { kind: 'uploading', bytes: 3000, offset: 2500 }), 'uploading: the pieces already gone count as done');

  // The server's pages and the two lists merged.
  const odo = Array.from({ length: 25 }, (_, i) => read(`o${100 + i}`, new Date(Date.parse('2026-10-22T00:00:00Z') - i * 3600_000).toISOString(), 200000 - i));
  const fuel = Array.from({ length: 3 }, (_, i) => fill(`f${100 + i}`, new Date(Date.parse('2026-10-21T12:30:00Z') - i * 86400_000).toISOString(), 10, 100000));
  let odoStream = addPage(null, odo.slice(0, HISTORY_PAGE), true);
  const fuelStream = addPage(null, fuel, false);
  let safe = mergeSafe([odoStream, fuelStream]);
  const edge = odo[HISTORY_PAGE - 1].at;
  check(!safe.complete && safe.rows.every((r) => Date.parse(r.at) >= Date.parse(edge)) && safe.rows.length === HISTORY_PAGE + 1,
    'two lists merged: nothing older than the oldest reading held is shown while more readings may come', safe.rows.length);
  check(same(cursorOf(odoStream), { at: edge, id: odo[HISTORY_PAGE - 1].id }), 'the next page starts below the oldest row held');
  odoStream = addPage(odoStream, odo.slice(HISTORY_PAGE), false);
  safe = mergeSafe([odoStream, fuelStream]);
  check(safe.complete && safe.rows.length === 28 && safe.rows.slice(1).every((r, i) => Date.parse(safe.rows[i].at) >= Date.parse(r.at)), 'every page in: all of them, in order, complete');
  check(mergeSafe([null, fuelStream], [pending]).rows[0].id === 'f0' && !mergeSafe([null]).complete, 'a list not read yet (offline): the phone\'s own rows, never "complete"');
  // The pages from the server (fetchFuelBefore / fetchOdometerBefore).
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, logged_at: '2026-10-22T00:00:00Z' }));
  const fake = fakeClient({ fuel_logs: rows, odometer_logs: rows.slice(0, 3) });
  const page1 = await realApi.fetchFuelBefore(fake.client, null, HISTORY_PAGE);
  const page2 = await realApi.fetchOdometerBefore(fake.client, { at: '2026-10-21T00:00:00Z', id: 'r9' }, HISTORY_PAGE);
  check(page1.rows.length === 20 && page1.more && !page2.more && page2.rows.length === 3, 'a page of 20; one row more asked to know there are older ones');
  check(fake.queries[0] === 'fuel_logs.select(*).order(logged_at,desc).order(id,desc).limit(21)'
    && fake.queries[1] === 'odometer_logs.select(*).order(logged_at,desc).order(id,desc).limit(21).or(logged_at.lt."2026-10-21T00:00:00Z",and(logged_at.eq."2026-10-21T00:00:00Z",id.lt.r9))',
    'newest first (logged_at, then id), below the cursor', fake.queries);
  const history = code('app/history.tsx');
  check(/<ChoiceChips/.test(history) && /HISTORY_FILTERS\.map/.test(history) && /\{!fuelOnly && \(/.test(history) && /monthWords\(t, group\.month\)/.test(history) && /<LoadMore /.test(history)
    && /<SkeletonRows/.test(history) && /<ListError/.test(history) && /<ListEmpty/.test(history) && /RefreshControl/.test(history),
    'the history: the chips (Mileage only), month headers in words, Load more, skeletons, Try again, empty, pull to refresh');
  const mileage = code('app/(tabs)/mileage.tsx');
  check(/seeAll="all"/.test(mileage) && /recentEntries\(mergeEntries\(/.test(mileage) && /pendingOdometerLogs\(\)/.test(mileage) && /windowOf\(todayTasks, shown\)/.test(mileage), 'Mileage: today\'s tasks stay; Recent (5, the phone\'s own too) and See all');
  const rowsSrc = code('components/LogRows.tsx');
  // The row is the app's one list row since the review of Round 4–7: the kind's icon in its tile (RowIcon draws it at 20).
  check(/<RowIcon icon=\{Icon\}/.test(rowsSrc) && /<ListRow\b/.test(rowsSrc) && /const Icon = fill \? Fuel : Gauge;/.test(rowsSrc) && /dateWords\(t, entry\.at\)/.test(rowsSrc) && /testID="video-mark"/.test(rowsSrc) && /pathname: '\/history', params: \{ kind: seeAll \}/.test(rowsSrc),
    'a row: a fuel pump or an odometer gauge, the date in words, the video\'s mark; See all opens the history');
  check(rowsSrc.includes("const retry = mark?.kind === 'failed' && mark.retry && onRetry ? () => onRetry(entry) : undefined;") && rowsSrc.includes('onPress={retry}')
    && rowsSrc.includes('const words = mark ? videoWords(mark, !!retry) : null;') && rowsSrc.includes('line2={markWords ?? undefined}'),
    'a row is a retry only while the phone holds the piece; the video\'s state in words on its second line');
}

// ------------------------------------------------------------------------------------------------------------------------
function passengers() {
  console.log('\nThe passengers on the task (lib/passengers.ts)');
  const list = [
    { id: 'p1', name: 'Nimal Perera', phone: '+94771234567', removed_at: null },
    { id: 'p2', name: 'Kamal Silva', phone: null, removed_at: null },
    { id: 'p3', name: 'Gone Person', phone: '+94770000000', removed_at: '2026-10-21T00:00:00Z' },
    { id: 'p4', name: 'Sunil Fernando', phone: '0712345678', removed_at: null },
    { id: 'p5', name: 'Ruwan', phone: null, removed_at: null },
    { id: 'p6', name: 'Dilini', phone: null, removed_at: null },
  ];
  check(same(ridingPassengers(list).map((p) => p.id), ['p1', 'p2', 'p4', 'p5', 'p6']), 'the ones riding (a removed one is shown nowhere)');
  check(namesLine(en, list, true) === 'Nimal Perera, Kamal Silva +3 more', 'Today\'s card: "Nimal Perera, Kamal Silva +3 more"', namesLine(en, list, true));
  check(namesLine(en, list.slice(0, 2), true) === 'Nimal Perera, Kamal Silva' && namesLine(en, [], true) === null && namesLine(en, undefined, true) === null, 'two: both names; none (or an older copy): no line');
  check(namesLine(en, list, false) === null && passengerRows(list, false).length === 0, 'the switch passengers off: the count only, as before');
  check((namesLine(si, list, true) ?? '').includes('3') && !/[෦-෯]/.test(namesLine(si, list, true) ?? ''), 'Sinhala: "+3" in Latin digits');
  const rows = passengerRows(list, true);
  check(rows[0].tel === 'tel:+94771234567' && rows[0].display === '077 123 4567' && rows[1].tel === null && rows[1].display === null && rows[2].tel === 'tel:+94712345678',
    'Call only for those with a phone (the dialler, the number as the office shows it)', rows.slice(0, 3));
  check(/task_passengers\(\$\{PASSENGER_COLUMNS\}\)/.test(code('lib/api.ts')) && PASSENGER_COLUMNS === 'id, name, phone, removed_at' && /task_passengers: \(task\.task_passengers \?\? \[\]\)\.filter\(\(p\) => !p\.removed_at\)/.test(code('lib/api.ts')),
    'read with the tasks (the driver\'s RLS columns), so they show offline from the copy on the phone');
  const usedIn = ['components/TaskPreview.tsx', 'app/task/[id].tsx'].every((f) => /<PassengerList task=\{task\} \/>/.test(code(f)));
  check(usedIn && /namesLine\(t, next\.task_passengers, app\.settings\.passengers\)/.test(code('app/(tabs)/index.tsx')) && /usePeopleLine\(\)/.test(code('app/(tabs)/index.tsx')), 'the names on the preview, the task and Today\'s card; the count line stays');
}

// ------------------------------------------------------------------------------------------------------------------------
async function placeBox() {
  console.log('\nThe empty place box: Saved, then the driver\'s own Recent (item 10)');
  const answer = parseSearchAnswer({
    text: '',
    suggested: true,
    results: [
      { layer: 'place', badge: 'Office', name: 'Head office', id: 'p1', pinned: true, lat: 6.9, lng: 79.8, group: 'saved', group_label: 'Saved' },
      { layer: 'recent', badge: 'Used before', name: 'Kandy depot', pinned: true, lat: 7.29, lng: 80.63, group: 'recent', group_label: 'Recent' },
      { layer: 'recent', badge: 'Used before', name: 'Head office', pinned: true, lat: 6.9, lng: 79.8, group: 'recent', group_label: 'Recent' },
      { layer: 'recent', badge: 'Used before', name: 'Somewhere', pinned: false, group: 'for' },
    ],
  });
  const groups = suggestGroups(answer.results);
  check(same(groups.saved.map((r) => r.name), ['Head office']) && same(groups.recent.map((r) => r.name), ['Kandy depot']), 'Saved first, then Recent; a recent place that is saved shows once (as saved); another person\'s never', groups);
  check(answer.results[0].group === 'saved' && answer.results[3].group === undefined, 'the group is read (saved, recent); anything else left out');
  const old = suggestGroups(parseSearchAnswer({ results: [{ layer: 'place', badge: 'Saved', name: 'Store', id: 's', pinned: false }, { layer: 'recent', badge: 'Used before', name: 'Galle', pinned: false }] }).results);
  check(old.saved.length === 1 && old.recent.length === 1, 'a server before item 10 (no group): our places as saved, used-before as recent');
  const pick = pickFromResult(groups.recent[0], null);
  check(same(pick.destination, { lat: 7.29, lng: 80.63, name: 'Kandy depot' }) && pickFromResult(groups.saved[0], null).placeId === 'p1', 'a pick: a saved place by its id, a recent one by its pin');
  const bodies: unknown[] = [];
  const api = createDriverApi({
    baseUrl: 'https://x/functions/v1/driver-api',
    apiKey: 'k',
    token: async () => 't',
    fetch: (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { status: 200, json: async () => ({ text: '', suggested: true, results: [] }) } as unknown as Response;
    }) as unknown as typeof fetch,
  });
  await api.suggestPlaces({ lat: 6.9, lng: 79.8 });
  await api.suggestPlaces(null);
  check(same(bodies, [{ suggest: true, near: { lat: 6.9, lng: 79.8 } }, { suggest: true }]), 'driver-api /places/search {suggest, near} (near only when the phone knows where it is)', bodies);
  const box = code('components/PlaceSearch.tsx');
  check(/withTimeout\(driverApi\.suggestPlaces\(near\), SUGGEST_TIMEOUT_MS\)/.test(box) && /withTimeout\(Location\.getForegroundPermissionsAsync\(\), POSITION_TIMEOUT_MS\)/.test(box) && !/requestForegroundPermissionsAsync/.test(box),
    'asked once with a timeout, the position only when already allowed (no prompt)');
  check(/t\('where\.badge\.saved'\)/.test(box) && /t\('where\.recent'\)/.test(box) && /whereRows\(officesFirst\(known\), \[\], \(p\) => p\.name\)/.test(box) && /testID="trip-suggest-skeleton"/.test(box),
    'each group under its small header; skeleton rows while it asks; no answer or no connection: the phone\'s own list');
}

// ------------------------------------------------------------------------------------------------------------------------
function reports() {
  console.log('\nMy reports as Gmail\'s rows (lib/reportList.ts)');
  const now = Date.parse('2026-10-22T04:30:00Z');
  const r = (over: Partial<VehicleReport>) => ({ category: 'tyre', note: 'Front left flat', needs_vehicle: false, created_at: '2026-10-22T03:12:00Z', check_id: null, office_note: null, status: 'open', ...over }) as VehicleReport;
  check(reportTitle(en, r({})) === 'Tyre · Front left flat', 'one specific line: "Tyre · Front left flat"');
  check(reportTitle(en, r({ note: null, category: 'breakdown', needs_vehicle: true })) === 'Breakdown · I need another vehicle' && reportTitle(en, r({ note: '  ', category: 'other' })) === 'Other', 'no note: "I need another vehicle" when asked, else the category alone');
  check(reportMeta(en, r({}), 'WP CAB-4521', now) === 'WP CAB-4521 · Today 08:42' && reportMeta(en, r({ check_id: 'c1' }), null, now) === 'Today 08:42 · Vehicle check', 'the grey line: the plate · when in words (· Vehicle check)');
  check(reportMeta(en, r({ category: 'breakdown', needs_vehicle: true }), null, now) === 'Today 08:42 · I need another vehicle'
    && !reportMeta(en, r({ category: 'breakdown', note: null, needs_vehicle: true }), null, now).includes('another vehicle'), '"I need another vehicle" once: in the grey line when the driver wrote a note, else in the line above');
  const row = `${reportTitle(en, r({}))} ${reportMeta(en, r({}), 'WP CAB-4521', now)}`;
  check(row.split(/\s+/).filter((w) => w === 'Tyre').length === 1, 'the category is not repeated in the row');
  const cats = ['breakdown', 'accident', 'tyre', 'warning_light', 'damage', 'other'] as const;
  check(cats.every((c) => !!REPORT_ICON[c]) && new Set(cats.map((c) => REPORT_ICON[c])).size === 6 && reportIcon('nonsense') === 'MessageCircle', 'an icon for each of the six categories');
  check(RECENT_REPORTS === 5 && !reportsSeeAll(5) && reportsSeeAll(6), 'the last 5; See all when there are more');
  const icons = code('components/icons.ts');
  check(cats.every((c) => new RegExp(`export \\{ default as ${REPORT_ICON[c]} \\}`).test(icons)), 'every icon is imported one by one (components/icons.ts)');
}

// ------------------------------------------------------------------------------------------------------------------------
function strings() {
  console.log('\nThe strings (en and si)');
  const NEW_KEYS = [
    'fuelCard.title', 'fuelCard.km', 'fuelCard.litres', 'fuelCard.litresNoType', 'fuelCard.battery', 'fuelCard.fromHistory', 'fuelCard.fromDefault',
    'fuelCard.question', 'fuelCard.fillOnWay', 'fuelCard.reminderHint', 'fuelCard.reminderTitle', 'fuelCard.reminderBody', 'fuelCard.fillLine',
    'fuelKind.label', 'fuelKind.petrol', 'fuelKind.diesel', 'fuelKind.petrol_92', 'fuelKind.petrol_95', 'fuelKind.auto_diesel', 'fuelKind.super_diesel',
    'fuelKind.word.petrol', 'fuelKind.word.diesel',
    'logHistory.recent', 'logHistory.seeAll', 'logHistory.title', 'logHistory.fuelTitle', 'logHistory.all', 'logHistory.empty', 'logHistory.emptyFuel',
    'logHistory.emptyOdometer', 'logHistory.failed', 'logHistory.noAmount', 'logHistory.noAmountOne',
    'pax.title', 'pax.more', 'pax.call',
    // The review of Round 4–7: a fill's video in words again.
    'fuel.uploadFailed', 'fuel.pctOfSize',
  ];
  const missing = NEW_KEYS.flatMap((k) => (['en', 'si'] as const).filter((l) => !text(l, k)).map((l) => `${l}:${k}`));
  check(missing.length === 0, `every new key in both languages (${NEW_KEYS.length})`, missing);
  // Every key the new and changed files name (with the template keys spelled out).
  const files = ['components/FuelCard.tsx', 'components/LogRows.tsx', 'components/Passengers.tsx', 'components/ReportRows.tsx', 'components/PlaceSearch.tsx',
    'app/history.tsx', 'app/my-reports.tsx', 'app/(tabs)/fuel.tsx', 'app/(tabs)/mileage.tsx', 'app/(tabs)/report.tsx', 'app/log-mileage.tsx', 'app/task/[id].tsx',
    'components/TaskPreview.tsx', 'app/(tabs)/index.tsx', 'state/app.tsx', 'lib/fuelCard.ts', 'lib/history.ts', 'lib/passengers.ts', 'lib/reportList.ts'];
  const named = new Set(files.flatMap((f) => [...code(f).matchAll(/'((?:fuelCard|fuelKind|logHistory|pax|fuel|mileage|report|where|common|log|vehicleCheck)\.[A-Za-z_.]+)'/g)].map((m) => m[1])));
  for (const g of ['petrol_92', 'petrol_95', 'auto_diesel', 'super_diesel', 'petrol', 'diesel']) named.add(`fuelKind.${g}`);
  for (const w of ['petrol', 'diesel']) named.add(`fuelKind.word.${w}`);
  for (const s of ['open', 'in_garage', 'closed', 'breakdown', 'accident', 'tyre', 'warning_light', 'damage', 'other']) named.add(`report.${s}`);
  const unnamed = [...named].filter((k) => !text('en', k) || !text('si', k));
  check(named.size > 40 && unnamed.length === 0, `every key the screens name has text in both (${named.size})`, unnamed);
  const vars = (s: string | null) => [...(s ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const mismatched = NEW_KEYS.filter((k) => vars(text('en', k)) !== vars(text('si', k)));
  check(mismatched.length === 0, 'the same placeholders in both ({km}, {range}, {fuel}, {n}, {name})', mismatched);
  const all = NEW_KEYS.flatMap((k) => [text('en', k) ?? '', text('si', k) ?? '']);
  check(all.every((s) => !/[෦-෯]/.test(s)), 'no Sinhala digits: numbers in Latin digits in both languages');
  check((['en', 'si'] as const).every((l) => /30/.test(text(l, 'fuelCard.reminderHint') ?? '') && /92/.test(text(l, 'fuelKind.petrol_92') ?? '') && /1/.test(text(l, 'logHistory.noAmountOne') ?? '')), '"30 min", "92" and "1" as digits in both');
  const enWords = NEW_KEYS.map((k) => text('en', k) ?? '').filter((s) => /\b(one|two|three|four|five|thirty)\b/i.test(s));
  check(enWords.length === 0, 'no count spelled out in words', enWords);
  check(text('en', 'fuelCard.question') === 'Enough fuel?' && text('en', 'fuelCard.fillOnWay') === "I'll fill up on the way" && text('en', 'fuelCard.title') === 'Trip info', 'the card\'s words as the plan has them');
}

async function main() {
  await answers();
  reminderAndLine();
  fillType();
  await recentAndHistory();
  passengers();
  await placeBox();
  reports();
  strings();
  console.log(failures === 0 ? '\nAll fuel card checks passed.' : `\n${failures} fuel card check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
