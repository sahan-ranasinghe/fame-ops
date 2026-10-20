// Office mode (Phase 8, O2, item 5): Task detail's extras, no phone: which extras a task and the tools allow, Change
// time's input (only what differs, a running task's end only), the swap rows and move_driver_vehicle's input, the
// readings after a swap, Reopen's input, the editor's stops mode (When straight to Review, the rows numbered after the
// reached stops), and the screens read as text (each tool behind its button, every key in both languages).
//
//   npm run test:task-extras          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { nextStep, prevStep } from '../src/office/trip/draftLogic';
import {
  canSwap, changeTimeInput, extraActions, extrasFor, MAX_KM, parseKm, REOPEN_TEXT, reopenInput, samePlate, swapInput, swapPlates, swapRows, timeFieldsOf, timeLocked, typedKm,
} from '../src/office/taskExtrasLogic';
import type { VehicleCard } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

console.log('\nWhich extras a task allows');
{
  const t = (status: string, more: Record<string, unknown> = {}) => ({ status, driver: 'Kamal Perera', ...more });
  check(same(extraActions(t('assigned')), { time: true, stops: true, swap: false, reopen: false }), 'assigned: the time and the stops, no swap, no reopen');
  check(same(extraActions(t('in_progress')), { time: true, stops: true, swap: true, reopen: false }), 'running: the time (its end), the stops and the swap');
  check(extraActions({ status: 'in_progress' }).swap === false, 'a running task with no driver (an office person drives) has no swap');
  check(same(extraActions(t('completed', { can_reopen: true })), { time: false, stops: false, swap: false, reopen: true }), 'completed today: only Reopen, as the server says');
  check(extraActions(t('completed')).reopen === false, 'completed on another day: nothing');
  check(same(extraActions(t('cancelled')), { time: false, stops: false, swap: false, reopen: false }), 'cancelled: nothing');
  check(extraActions(t('declined')).time && extraActions(t('declined')).stops, 'declined (needs a driver): the time and the stops still change');
  const all = ['update_task', 'update_task_stops', 'move_driver_vehicle', 'reopen_task'];
  check(same(extrasFor(t('in_progress'), all), { time: true, stops: true, swap: true, reopen: false }), 'every tool: what the task allows');
  check(same(extrasFor(t('in_progress'), ['update_task']), { time: true, stops: false, swap: false, reopen: false }), 'only update_task: only Change time');
  check(same(extrasFor(t('completed', { can_reopen: true }), ['update_task']), { time: false, stops: false, swap: false, reopen: false }), 'Reopen needs reopen_task: no dead button');
  check(same(extrasFor(t('assigned'), []), { time: false, stops: false, swap: false, reopen: false }), 'no tools: no buttons');
}

console.log('\nChange time');
{
  const task = { date: '2026-10-20', time: '08:30', leave_by: '08:30', end_by: '15:00', status: 'assigned' };
  check(same(timeFieldsOf(task), { date: '2026-10-20', time: '08:30', end: '15:00' }), 'the form starts from the task');
  check(timeFieldsOf({ date: '2026-10-20', leave_by: '09:00' }).time === '09:00' && timeFieldsOf({}).end === '', 'leave_by stands in for time; no end = empty');
  check(!timeLocked({ status: 'assigned' }) && timeLocked({ status: 'in_progress' }), 'a running task is locked to its end time');
  const r0 = changeTimeInput('t1', 3, timeFieldsOf(task), task);
  check('error' in r0 && r0.error === 'nothing', 'nothing changed → nothing is sent');
  const r1 = changeTimeInput('t1', 3, { date: '2026-10-21', time: '08:30', end: '15:00' }, task);
  check('input' in r1 && same(r1.input, { task_id: 't1', plan_version: 3, date: '2026-10-21' }), 'only the day when only the day changed', r1);
  const r2 = changeTimeInput('t1', 3, { date: '2026-10-20', time: '09:15', end: '' }, task);
  check('input' in r2 && same(r2.input, { task_id: 't1', plan_version: 3, time: '09:15', end_time: null }), 'a new leave-by and the end cleared (null)', r2);
  const r3 = changeTimeInput('t1', 3, { date: '2026-10-20', time: '08:30', end: '08:00' }, task);
  check('error' in r3 && r3.error === 'endBeforeStart', 'an end at or before the leave-by is refused');
  const r4 = changeTimeInput('t1', 3, { date: '2026-10-20', time: '', end: '16:00' }, task);
  check('input' in r4 && same(r4.input, { task_id: 't1', plan_version: 3, end_time: '16:00' }), 'an empty leave-by means not changed (a running task)', r4);
  const r5 = changeTimeInput('t1', 3, { date: '', time: '', end: '07:00' }, { ...task, time: undefined, leave_by: undefined });
  check('input' in r5, 'with no leave-by known the end is not compared to one');
}

console.log('\nSwap vehicle');
{
  const v = (reg_no: string, more: Partial<VehicleCard> = {}): VehicleCard => ({ reg_no, make_model: 'Toyota HiAce', seats: 14, status: 'Available', availability: 'Free', ...more });
  const vehicles = [
    v('WP KL-1234', { status: 'In garage', in_garage: true }),
    v('WP CAB-4521', { status: 'On a task', held_by: 'Kamal Perera', held_since: '08:40' }),
    v('WP AB-0001', { held_by: 'Nuwan Perera', held_since: '07:55' }),
    v('WP CD-0002'),
    v('WP EF-0003', { status: 'On a task', held_by: 'Ruwan Silva', back_at: '14:30' }),
    v('WP GH-0004', { active: false }),
    v('WP IJ-0005', { availability: 'Booked later today · 16:00' }),
  ];
  const rows = swapRows(vehicles, { name: 'Kamal Perera', vehicle: 'WP CAB-4521 · Toyota HiAce' });
  check(rows.map((r) => r.reg_no).join(' '), 'rows');
  check(same(rows.map((r) => r.state), ['current', 'free', 'free', 'held', 'garage', 'on_task']), 'the task\'s vehicle first, then free, held, garage, on another task; an inactive one left out', rows.map((r) => `${r.reg_no}:${r.state}`));
  check(rows[0].reg_no === 'WP CAB-4521' && rows[0].disabled, 'the task\'s vehicle is shown, not offered');
  check(rows.find((r) => r.reg_no === 'WP EF-0003')?.disabled === true && rows.find((r) => r.reg_no === 'WP EF-0003')?.back_at === '14:30', 'a vehicle on another running task is not selectable, with its back time');
  check(rows.find((r) => r.reg_no === 'WP AB-0001')?.held_by === 'Nuwan Perera', 'who holds it now is named (they are told)');
  check(rows.find((r) => r.reg_no === 'WP IJ-0005')?.booked === 'Booked later today · 16:00', 'a booking later is said');
  check(rows[1].what === 'Toyota HiAce · 14', 'the make and the seats');
  check(samePlate('WP CAB-4521 · Toyota HiAce', 'wp cab 4521') && !samePlate('WP CAB-4521', 'WP CAB-4522') && !samePlate(undefined, 'WP CAB-4521'), 'plates compare without spaces, dashes or case');
  check(!canSwap(rows, null) && !canSwap(rows, 'WP CAB-4521') && !canSwap(rows, 'WP EF-0003') && canSwap(rows, 'WP AB-0001') && canSwap(rows, 'WP CD-0002') && canSwap(rows, 'WP KL-1234'), 'Swap only for another vehicle not on a running task (the garage is allowed, the server warns)');
  check(same(parseKm(''), {}) && same(parseKm(' 45,262 '), { km: 45262 }), 'an empty reading is the phone\'s; spaces and commas are ignored');
  check(same(parseKm('-5'), { error: 'negative' }) && same(parseKm('45.5'), { error: 'whole' }) && same(parseKm('abc'), { error: 'number' }) && same(parseKm(String(MAX_KM + 1)), { error: 'tooBig' }), 'the refusals');
  const s0 = swapInput('Kamal Perera', null, { oldKm: '', newKm: '', reason: '' });
  check('error' in s0 && s0.error === 'pick', 'no vehicle picked');
  const s1 = swapInput('Kamal Perera', 'WP AB-0001', { oldKm: '45262', newKm: '', reason: ' Puncture ' });
  check('input' in s1 && same(s1.input, { driver: 'Kamal Perera', vehicle: 'WP AB-0001', old_end_km: 45262, reason: 'Puncture' }), 'the driver, the plate, the typed reading only, the reason trimmed', s1);
  const s2 = swapInput('Kamal Perera', 'WP AB-0001', { oldKm: '1.5', newKm: '', reason: '' });
  check('error' in s2 && s2.error === 'oldKm' && s2.detail === 'whole', 'a bad old reading names the field and why');
  const s3 = swapInput('Kamal Perera', 'WP AB-0001', { oldKm: '', newKm: 'x', reason: 'y'.repeat(300) });
  check('error' in s3 && s3.error === 'newKm', 'a bad new reading');
  const s4 = swapInput('Kamal Perera', 'WP AB-0001', { oldKm: '', newKm: '', reason: 'y'.repeat(300) });
  check('input' in s4 && (s4.input.reason as string).length === 200, 'the reason at most 200');
  check(typedKm('typed: 45262 km') === 45262 && typedKm('the driver enters it on the phone') === null && typedKm(undefined) === null, 'a typed reading is read back from the answer');
  check(same(swapPlates({ driver: 'Kamal', vehicle: 'WP AB-0001 · Toyota HiAce', swapped: { from: 'WP CAB-4521 · Toyota HiAce', to: 'WP AB-0001 · Toyota HiAce' } }), { from: 'WP CAB-4521', to: 'WP AB-0001' }), 'the plates of the swap');
  check(same(swapPlates({ driver: 'Kamal', vehicle: 'WP AB-0001' }), { to: 'WP AB-0001' }), 'without swapped: the vehicle');
}

console.log('\nReopen');
{
  check(same(reopenInput('t1', REOPEN_TEXT.wrong_reading, ' 45262 was 45226 '), { task_id: 't1', reason: 'Wrong end reading: 45262 was 45226' }), 'the reason with the note');
  check(same(reopenInput('t1', REOPEN_TEXT.finished_early, ''), { task_id: 't1', reason: 'Finished too soon' }), 'the reason alone');
}

console.log('\nThe editor\'s stops mode');
{
  check(nextStep('when', 'stops') === 'review' && prevStep('review', 'stops') === 'when', 'stops: When goes straight to Review and back');
  check(nextStep('when', 'task') === 'who' && prevStep('review', 'task') === 'who' && nextStep('when') === 'who', 'the other modes keep Who');
  check(nextStep('where', 'stops') === 'when' && prevStep('when', 'stops') === 'where' && nextStep('review', 'stops') === null, 'Where → When; nothing after Review');
}

console.log('\nThe screens as text');
{
  const page = read('app/office/task/[id].tsx');
  const time = read('app/office/task/[id]/time.tsx');
  const swap = read('app/office/task/[id]/swap.tsx');
  const where = read('app/office/trip/where.tsx');
  const review = read('app/office/trip/review.tsx');
  const when = read('app/office/trip/when.tsx');
  check(page.includes("extrasFor(task, me.tools)") && page.includes("extras.time &&") && page.includes("extras.stops &&") && page.includes("extras.swap &&") && page.includes("extras.reopen &&"), 'the task page shows each extra by the task and the tools');
  check(page.includes("pathname: '/office/task/[id]/time'") && page.includes("params: { mode: 'stops', id: task.id }") && page.includes("pathname: '/office/task/[id]/swap'"), 'the buttons open Change time, the editor in mode stops, and Swap vehicle');
  check(page.includes("api.call('reopen_task', reopenInput(") && page.includes('ReasonSheet<ReopenReasonKey>'), 'Reopen asks a reason in the sheet and calls reopen_task');
  check(!/role|fleet_admin|admin/.test(page.replace(/\/\/.*$/gm, '')) || !/'(admin|fleet_admin|office|viewer|staff)'/.test(page), 'no role names on the task page');
  check(time.includes("api.call<UpdateTaskResult & { warnings?: string[] }>('update_task', r.input)") && time.includes('changeTaskInput(task.id, task.plan_version ?? 0, { ...f, vehicle: vehicleToSend }, task)'), 'Change the task sends update_task with the plan version (Part B: the words, the driver and the vehicle too)');
  check(time.includes('timeLocked(task)') && time.includes("t('office.task.timeLocked'"), 'a running task shows the locked note instead of the day and leave-by');
  check(swap.includes("api.call<SwapResult>('move_driver_vehicle', r.input)") && swap.includes("useTool<VehiclesList>('list_vehicles', { filter: 'all' }") && swap.includes("swapRows(veh.data.vehicles, { name: task.driver ?? '', vehicle: task.vehicle })"), 'Swap vehicle lists every vehicle and calls move_driver_vehicle');
  check(swap.includes('disabled={!canSwap(rows, choice)}'), 'Swap is disabled until a usable vehicle is picked');
  check(where.includes("useTool<TaskDetail>('task_detail', { task_id: id ?? '' }, { enabled: mode === 'stops' && !!id })") && where.includes("draftsFromStops(pending.filter((s) => !s.is_start)"), 'Where in mode stops loads the task\'s pending stops');
  check(where.includes("(d.reached ?? 0)") && when.includes("(draft.reached ?? 0)"), 'the rows are numbered after the reached stops on Where and When');
  check(review.includes("tool: 'update_task_stops'") && review.includes("plan_version: d.planVersion ?? 0") && review.includes("stopsInput(f.stops, (d.reached ?? 0) + (f.startPax ? 1 : 0))"), 'Review in mode stops sends update_task_stops with the plan version and the offset');
  check(review.includes("if (!d.running && f.leaveBy.trim()) input.leave_by = f.leaveBy.trim();") && where.includes("leaveBy: p.task.leave_by_source === 'manual' && p.task.status === 'assigned' ? hhmm(p.task.leave_by) : ''"), 'a leave time typed by hand is sent; a running task\'s leave-by is never sent');
  check(when.includes("nextStep('when', draft.mode)"), 'When asks the mode for its next step');
  // The list pattern (docs/ui-patterns.md §5) on the task's screens, Give it a driver, Approve a request and the driver rows.
  const give = read('app/office/task/[id]/driver.tsx');
  const request = read('app/office/request/[id].tsx');
  const rows = read('components/office/DriverRows.tsx');
  for (const [name, src] of [['the task page', page], ['Swap vehicle', swap], ['Give it a driver', give], ['Approve a request', request], ['the driver rows', rows]] as const) {
    check(src.includes('<SkeletonRows') && src.includes('<ListFailed') && src.includes('<ListEmpty') && !src.includes('<Loading') && !src.includes('<Empty '), `${name}: skeleton rows, the error with Try again, the empty state`);
  }
  check(page.includes("busy={busy === 'cancel'}") && page.includes("busy={busy === 'reopen'}") && !page.includes("t('office.task.working')"), 'Cancel and Reopen show their spinner on the button pressed (no "Working…" line)');
}

console.log('\nStrings in both languages');
{
  const en = JSON.parse(read('i18n/en.json')) as { office: { task: Record<string, string>; trip: Record<string, string>; tabs: Record<string, string> } };
  const si = JSON.parse(read('i18n/si.json')) as typeof en;
  const code = [read('app/office/task/[id].tsx'), read('app/office/task/[id]/time.tsx'), read('app/office/task/[id]/swap.tsx')].join('\n');
  const keys = Array.from(new Set(Array.from(code.matchAll(/'office\.task\.([A-Za-z_]+)'/g)).map((m) => m[1])));
  const missing = keys.filter((k) => !(k in en.office.task) || !(k in si.office.task));
  check(keys.length > 30 && missing.length === 0, `every office.task key the extras use exists in en and si (${keys.length})`, missing);
  const kmKeys = ['km_negative', 'km_whole', 'km_number', 'km_tooBig'];
  check(kmKeys.every((k) => k in en.office.task && k in si.office.task), 'the km refusals in both languages');
  check('stopsAbove' in en.office.trip && 'stopsAbove' in si.office.trip && 'drivers' in en.office.tabs && 'drivers' in si.office.tabs, 'the stops heading and the Drivers tab label');
  const sinhalaDigits = Object.values(si.office.task).filter((v) => /[෦-෯]/.test(v));
  check(sinhalaDigits.length === 0, 'Latin digits only in Sinhala');
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const badPh = keys.filter((k) => en.office.task[k] && si.office.task[k] && ph(en.office.task[k]) !== ph(si.office.task[k]));
  check(badPh.length === 0, 'the same placeholders in both languages', badPh);
}

console.log(failures === 0 ? '\nAll task extras checks passed.' : `\n${failures} task extras check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
