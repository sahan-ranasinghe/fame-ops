// Office mode (Phase 8, O2, item 5): Task detail's extras, no phone: which extras a task and the tools allow, Change
// time's input (only what differs, a running task's end only), the swap rows and move_driver_vehicle's input, the
// readings after a swap, Reopen's input, the editor's stops mode (When straight to Review, the rows numbered after the
// reached stops), and the screens read as text (each tool behind its button, every key in both languages). Stage 1 (O3
// item 3c–f): charged to, the odometer, fuel and their links, the history, the swap reading, Save as our place, the
// trip's purpose and the plan map.
//
//   npm run test:task-extras          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { nextStep, prevStep } from '../src/office/trip/draftLogic';
import {
  canSwap, changeTimeInput, extraActions, extrasFor, MAX_KM, parseKm, REOPEN_TEXT, reopenInput, samePlate, swapInput, swapPlates, swapRows, timeFieldsOf, timeLocked, typedKm,
} from '../src/office/taskExtrasLogic';
import {
  arrivalParts, arrivalPlaceInput, canSaveArrival, chargedTo, DETAIL_LINKS_FRESH_MS, detailTask, fuelTitle, historyParts, isLink, linkOf, odometerParts, PLACE_KINDS, planDrawable,
  purposeDoneText, purposeInput, reportWords, segmentRows, segmentsTotal, swapReadingInput, unloggedText, type Words as DetailWords,
} from '../src/office/taskDetailLogic';
import type { TaskDetail, VehicleCard } from '../src/office/types';

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

// ---------------------------------------------------------------------------
// Stage 1 (O3 item 3c–f): Task detail's additions (office/taskDetailLogic.ts, components/office/TaskDetailParts.tsx,
// task/[id]/purpose.tsx, task/[id]/plan.tsx)
// ---------------------------------------------------------------------------

/** The words as "key(var,var)". */
const tw: DetailWords = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);
const detail = (over: Partial<TaskDetail> = {}, task: Partial<TaskDetail['task']> = {}): TaskDetail => ({
  task: { id: 't1', title: 'Team drop', status: 'completed', start: 'Mon 20 Oct 09:00', date: '2026-10-20', time: '09:00', ...task },
  stops: [], projects: '', odometer: [], fuel: [], vehicle_reports: [], ...over,
}) as TaskDetail;

console.log('\nCharged to, the unlogged km, the warnings');
{
  check(chargedTo(detail({ projects: [{ project: 'TRKAN1', percent: 60 }, { project: 'Mobitel MS', percent: 40 }] }), tw) === 'TRKAN1 · 60%, Mobitel MS · 40%', 'the projects with their shares');
  check(chargedTo(detail({ projects: '' }), tw) === 'office.task.chargedInternal' && chargedTo(detail({ projects: 'Fame internal' }), tw) === 'Fame internal', 'none: Fame internal; the server\'s own words as they came');
  check(chargedTo(detail({ projects: [{ project: 'TRKAN1', percent: 100 }] }, { purpose: 'personal' }), tw) === 'office.task.chargedPersonal', 'a personal trip is never charged to a job');
  check(unloggedText(detail({ unlogged_km: { km: 62, last_logged_km: 45148, last_logged_at: 'Sun 19 Oct 18:02', start_km: 45210 } }), tw) === 'office.task.unlogged(62,45,148,Sun 19 Oct 18:02,45,210)' && unloggedText(detail(), tw) === null, 'the km nobody logged, with the readings; none: nothing');
}

console.log('\nOdometer, fuel, problems, links');
{
  const o = odometerParts({ kind: 'task_start', reading_km: 45210, at: '2026-10-20 08:10', check: 'matches the photo', photo_reading: 45212, flag: 'ai_differs', photo: 'https://x.supabase.co/sign/a.jpg' }, tw);
  check(o.title === '45,210 km' && o.line === 'office.task.odo_task_start · 2026-10-20 08:10 · matches the photo · office.task.photoShows(45,212)' && o.flag === 'office.task.flag_ai_differs' && o.photo === 'https://x.supabase.co/sign/a.jpg', 'a reading: km, kind, time, the check, what the photo shows, its flag, its photo', o);
  const n = odometerParts({ kind: 'odd', reading_km: 1, at: 'x', flag: 'new_flag', photo: 'photo not uploaded yet' }, tw);
  check(n.line.startsWith('odd') && n.flag === 'new_flag' && n.photo === null, 'an unknown kind or flag as it came; a note is not a link');
  check(fuelTitle({ litres: 32.5, amount_lkr: 12000 }, tw) === 'office.task.fuelLine(32.5,12,000)' && fuelTitle({ litres: null, amount_lkr: 5000 }, tw) === 'LKR 5,000', 'a fill: litres and LKR (Latin digits), or LKR alone');
  check(same(reportWords({ category: 'warning_light', status: 'in_garage' }, tw), { category: 'report.warning_light', status: 'report.in_garage' }) && reportWords({ category: 'x', status: 'y' }, tw).category === 'x', 'a problem in the driver app\'s own words');
  const p = detail({
    odometer: [{ kind: 'task_start', reading_km: 1, at: 'a', photo: 'https://o' }],
    fuel: [{ litres: 1, amount_lkr: 1, at: 'a', receipt_photo: 'https://r', video: { status: 'uploaded', segments: [{ url: 'https://v1' }, { url: 'https://v2' }] } }],
    vehicle_reports: [{ id: 'r1', category: 'tyre', status: 'open', at: 'a', photos: ['https://p0', 'https://p1'] }],
  });
  check(linkOf(p, { kind: 'odo', i: 0 }) === 'https://o' && linkOf(p, { kind: 'receipt', i: 0 }) === 'https://r' && linkOf(p, { kind: 'video', i: 0, n: 2 }) === 'https://v2' && linkOf(p, { kind: 'report', i: 0, k: 1 }) === 'https://p1', 'each link found again in a fresh answer by its key');
  check(linkOf(p, { kind: 'odo', i: 3 }) === null && linkOf(p, { kind: 'video', i: 0, n: 9 }) === null && isLink('https://a') && !isLink('photo pending'), 'a link no longer there: null');
  check(DETAIL_LINKS_FRESH_MS === 50 * 60_000, 'an answer read over 50 minutes ago is read again before a link opens');
}

console.log('\nThe history');
{
  const h = historyParts({ at: 'Mon 20 Oct 08:40', action: 'reassigned', driver: 'Kamal Perera', vehicle: 'WP CAB-4521', actor: 'Palitha', note: 'swap' }, tw);
  check(h.title === 'office.task.ev_reassigned · Kamal Perera · WP CAB-4521 · office.task.evBy(Palitha) · swap' && h.at === 'Mon 20 Oct 08:40', 'an event: the action, who, the vehicle, by whom, the note');
  const c = historyParts({ at: 'x', action: 'changed', actor: 'Sahan', note: 'n', changes: { time: { from: '09:00', to: '09:30' }, vehicle: { from: null, to: 'WP KV-7788' } } }, tw);
  check(c.title === 'office.task.ev_changed · office.task.evBy(Sahan)' && same(c.changes, ['time 09:00 → 09:30', 'vehicle — → WP KV-7788']), 'a change: its fields, from → to (the note is the changes)');
  check(historyParts({ at: 'x', action: 'something_new' }, tw).title === 'something_new', 'an action the app has no word for, as it came');
}

console.log('\nThe vehicle swap and the reading still owed');
{
  const segs = [
    { vehicle: 'WP CAB-4521', from: '08:10', to: '10:42', start_km: 45210, end_km: undefined, readings_waiting: true, reason: 'Breakdown', by: 'Palitha' },
    { vehicle: 'WP KV-7788', from: '10:42', start_km: undefined, readings_waiting: true },
  ];
  const rows = segmentRows(segs, tw);
  check(rows[0].need === 'end' && rows[0].readings === '45,210 km → office.task.segEndToCome' && rows[0].window === '08:10–10:42' && rows[0].why === 'Breakdown · office.task.evBy(Palitha)', 'the old vehicle\'s end is owed');
  check(rows[1].need === 'start' && rows[1].readings === 'office.task.segStartToCome → office.task.segInUse' && rows[1].window === 'office.task.segFrom(10:42)', 'the new vehicle\'s start is owed (it runs)');
  check(segmentRows([{ vehicle: 'A', from: '1', to: '2', start_km: 1, end_km: 5, km: 4 }], tw)[0].need === null, 'nothing owed: no button');
  check(segmentsTotal(segs, tw) === 'office.task.segWaiting' && segmentsTotal([{ from: 'a', to: 'b', km: 52 }, { from: 'b', km: 31 }], tw) === 'office.task.segTotal(52 + 31 = 83 km)'
    && segmentsTotal([{ from: 'a', to: 'b', km: 52 }, { from: 'b', readings_waiting: true }], tw) === 'office.task.segSoFar(52 km)', 'the total: added up, so far, or still to come');
  check(same(swapReadingInput('t1', 'WP CAB-4521', 'end', '45,262'), { input: { task_id: 't1', vehicle: 'WP CAB-4521', end_km: 45262 } }) && same(swapReadingInput('t1', 'WP KV-7788', 'start', ' 1200 '), { input: { task_id: 't1', vehicle: 'WP KV-7788', start_km: 1200 } }), 'swap_reading: one reading, end_km or start_km');
  check(same(swapReadingInput('t1', 'A', 'end', ''), { error: 'number' }) && same(swapReadingInput('t1', 'A', 'end', '12.5'), { error: 'whole' }) && same(swapReadingInput('t1', 'A', 'end', '-3'), { error: 'negative' }), 'an empty, broken or negative reading is not sent');
}

console.log('\nSave as our place, and a driver-started trip\'s purpose');
{
  const stop = { seq: 1, type: 'drop', status: 'done', id: 's1', google: true, arrival: { at: '10:42', lat: 7, lng: 80, accuracy_m: 12.4, near: 'Kandy', maps: 'https://maps.google.com/?q=7,80' } };
  check(same(arrivalParts(stop, tw), { line: 'office.task.arrivalAt(10:42) · office.live.near(Kandy) · office.task.arrivalAccuracy(12)', maps: 'https://maps.google.com/?q=7,80' }) && arrivalParts({}, tw) === null, 'where the phone was when the stop was reached');
  check(canSaveArrival(stop, ['save_arrival_place']) && !canSaveArrival(stop, []) && !canSaveArrival({ ...stop, google: false }, ['save_arrival_place'])
    && !canSaveArrival({ ...stop, saved_place: { id: 'p', name: 'x' } }, ['save_arrival_place']) && !canSaveArrival({ ...stop, arrival: undefined }, ['save_arrival_place']), 'Save as our place: a reached Google stop, not saved yet, with the tool');
  check(same(arrivalPlaceInput('s1', '  Kandy client office ', 'office'), { input: { stop_id: 's1', name: 'Kandy client office', kind: 'office' } }) && same(arrivalPlaceInput('s1', ' K ', 'other'), { error: 'name' }) && same([...PLACE_KINDS], ['other', 'office', 'store', 'site']), 'save_arrival_place: our own name and the kind (other first)');
  check(same(purposeInput('t1', 'company', 'personal', ''), { input: { task_id: 't1', purpose: 'personal' } }) && same(purposeInput('t1', 'company', 'company', ' 13021 '), { input: { task_id: 't1', purpose: 'company', project: '13021' } }), 'set_trip_purpose: the purpose, a project for company work');
  check(same(purposeInput('t1', 'personal', 'personal', 'x'), { error: 'personalProject' }) && same(purposeInput('t1', undefined, 'company', ''), { error: 'nothing' }), 'no project on a personal trip; nothing changed is not sent');
  check(purposeDoneText({ task_id: 't', purpose: 'personal' }, tw) === 'office.task.purposeNowPersonal' && purposeDoneText({ task_id: 't', purpose: 'company', was: 'personal', project: 'TRKAN1' }, tw) === 'office.task.purposeNowCompany · office.task.purposeCharged(TRKAN1)', 'the line after a save');
}

console.log('\nThe plan on the task map');
{
  const p = detail({
    stops: [
      { id: 's1', seq: 3, n: 1, type: 'pickup', status: 'done', place: 'Head office', lat: 6.9, lng: 79.86, planned_arrive: '09:00', planned_depart: '09:10' },
      { id: 's2', seq: 4, type: 'drop', status: 'removed', place: 'Gone' },
      { id: 's3', seq: 5, n: 2, type: 'drop', status: 'pending', place: 'Google place', lat: 7.2, lng: 80.6, google: true, google_place_id: 'gp1', arrive_by: '11:00' },
    ],
    timeline: { items: [{ kind: 'leg', from_n: 'start', to_n: 1, km: 5, minutes: 15, source: 'ors', line: 'abc' }, { kind: 'leg', from_n: 1, to_n: 2, km: 110, minutes: 150, source: 'google', line: 'def' }], totals: { drive_min: 165, km: 115, ends: '12:00' } },
  }, { leave_by: 'Mon 20 Oct 08:35', start_place: 'Base', start_lat: 6.91, start_lng: 79.85 });
  const m = detailTask(p) as unknown as { task_stops: { id: string; seq: number; status: string; google_place_id: string | null; arrive_by: string | null; planned_arrive_at: string | null }[]; plan_json: { legs: { from_seq: number; to_seq: number; line: string | null; source: string }[] }; leave_by: string; start_lat: number };
  check(same(m.task_stops.map((s) => s.id), ['s1', 's3']) && m.task_stops[1].google_place_id === 'gp1' && m.task_stops[1].arrive_by === '2026-10-20T11:00:00+05:30' && m.task_stops[0].planned_arrive_at === '2026-10-20T09:00:00+05:30', 'the stops in the plan (a removed one left out) with their pins, Google ids and times');
  check(same(m.plan_json.legs.map((l) => [l.from_seq, l.to_seq, l.line, l.source]), [[0, 3, 'abc', 'ors'], [3, 5, 'def', 'google']]), 'the legs by the stops\' seq, with their road lines (Google\'s drawn on Google\'s map only)');
  check(m.leave_by === '2026-10-20T08:35:00+05:30' && m.start_lat === 6.91, 'the leave-by\'s clock and the start\'s pin');
  check(planDrawable(p) && !planDrawable(detail()), 'a map only when there is a pin to draw');
}

console.log('\nThe additions as text');
{
  const page = read('app/office/task/[id].tsx');
  const parts = read('components/office/TaskDetailParts.tsx');
  const purpose = read('app/office/task/[id]/purpose.tsx');
  const plan = read('app/office/task/[id]/plan.tsx');
  check(page.includes('<TaskWarnings p={p} />') && page.includes('<TripPurposeCard p={p} />') && page.includes('<SwapSegments p={p} onSaved={q.reload} />') && page.includes('<StopArrival stop={s} onSaved={q.reload} />') && page.includes('<TaskMoreDetails p={p} openLink={openLink}'), 'the task page shows every addition');
  check(page.includes("pathname: '/office/task/[id]/plan'") && page.includes('DETAIL_LINKS_FRESH_MS') && page.includes('linkOf(q.data, pendingLink)'), 'Show the plan opens its screen; an old answer is read again before a link opens');
  check(parts.includes('<MoreDetails filled={false}') && parts.includes("me.tools.includes('swap_reading')") && parts.includes("api.call<{ note?: string; task_km?: number }>('swap_reading', r.input)") && parts.includes("api.call('save_arrival_place', r.input)") && parts.includes('canSaveArrival(stop, me.tools)') && parts.includes("me.tools.includes('set_trip_purpose')"),
    'the extras under one More details fold; each write only with its tool');
  check((parts.match(/<Sheet\b/g) ?? []).length === 2 && !/<Modal\b/.test(parts) && parts.includes('<ErrorNotice error={problem}'), 'the reading and the place in the one bottom sheet, the server\'s sentence when it refuses');
  check(parts.includes('videoPieces(f.video)') && parts.includes("t(`office.reports.video_${chip.key}`)") && parts.includes("openLink({ kind: 'video', i, n: piece.n })"), 'a fill\'s video state and one button per piece (Reports → Fuel\'s rules)');
  check(purpose.includes("api.call<TripPurposeResult>('set_trip_purpose', r.input)") && purpose.includes('disabled={!!reason}') && purpose.includes('<StickyActions>') && purpose.includes("api.call<FindProject>('find_project'") && purpose.includes("me.tools.includes('find_project')"), 'the purpose: one screen, the sticky Save disabled with its reason, the project\'s match line');
  check(plan.includes("useTool<TaskDetail>('task_detail', { task_id: id, with_line: true })") && plan.includes('<TaskMap report={false} mapPackage={me.map?.package} task={detailTask(p)}') && plan.includes('legTextT(t, x') && plan.includes('stopTimesT(t, x)'), 'the plan: the task map (both engines) and the timeline in both languages');
  for (const [name, s] of [['purpose', purpose], ['plan', plan]] as const) {
    check(s.includes('<SkeletonRows') && s.includes('<ListFailed') && s.includes('<ListEmpty') && !s.includes('<Loading'), `${name}: skeleton rows, the error with Try again, the empty state`);
  }
  const en = JSON.parse(read('i18n/en.json')) as { office: { task: Record<string, string> } };
  const si = JSON.parse(read('i18n/si.json')) as typeof en;
  const code = [page, parts, purpose, plan, read('office/taskDetailLogic.ts')].join('\n');
  const asked = Array.from(new Set(Array.from(code.matchAll(/'office\.task\.([A-Za-z_]+)'/g)).map((m) => m[1])));
  const dynamic = ['odo_task_start', 'odo_task_end', 'odo_manual', 'flag_photo_changed', 'flag_typed_unreadable', 'flag_ai_differs', 'flag_ai_failed', 'ev_assigned', 'ev_accepted', 'ev_declined',
    'ev_reassigned', 'ev_cancelled', 'ev_changed', 'ev_reopened', 'ev_stop_skipped', 'ev_running_late', 'kind_other', 'kind_office', 'kind_store', 'kind_site', 'purpose_company', 'purpose_personal'];
  const missing = [...asked, ...dynamic].filter((k) => !en.office.task[k] || !si.office.task[k]);
  check(asked.length > 50 && missing.length === 0, `every office.task key of the additions in en and si (${asked.length})`, missing);
  const added = [...asked, ...dynamic].filter((k) => en.office.task[k]);
  check(added.every((k) => /[඀-෿]/.test(si.office.task[k])), 'in real Sinhala', added.filter((k) => !/[඀-෿]/.test(si.office.task[k])));
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  check(added.every((k) => ph(en.office.task[k]) === ph(si.office.task[k])), 'the same placeholders in both languages', added.filter((k) => ph(en.office.task[k]) !== ph(si.office.task[k])));
}

console.log(failures === 0 ? '\nAll task extras checks passed.' : `\n${failures} task extras check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
