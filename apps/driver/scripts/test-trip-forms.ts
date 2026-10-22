// Hotfix O2-H1, Part B: the trip forms' parity with the site, no phone: the project split (Split equally, the match line,
// the total), the request's Book now (the vehicle groups, the driver options, the default
// vehicle), the plan's "Leave by" note, the conflict cards' actions, the outcome after sending, the driver's WhatsApp
// message, Change the task's input (only what changed, a running task's words only), and the screens read as text:
// every field reaching its server input, the planner states, the validation, the versions, the shared controls, no role
// names, every key in both languages.
//
//   npm run test:trip-forms          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { changeFieldsOf, changeTaskInput } from '../src/office/taskExtrasLogic';
import { newStop } from '../src/office/trip/stopsLogic';
import {
  addProjectRow, bookOutcome, conflictActions, driverMessage, driverOptions, groupRows, leaveNote, projectMatch, removeProjectRow, requestOutcome, setProjectRow, splitEqually, splitRows, splitState,
  taskOutcome, vehicleLine, whatsappWithText,
} from '../src/office/trip/formsLogic';
import { validateAssign } from '../src/office/trip/assignLogic';
import { whoArgs } from '../src/office/trip/whoLogic';
import { STAY_PRESETS } from '../src/lib/durations';
import { bookInput, validateNewRequest } from '../src/office/trip/requestLogic';
import type { Conflict, PlanPreview, SuggestedVehicle } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

console.log('\nThe project split');
{
  check(same(splitEqually(3), [34, 33, 33]) && same(splitEqually(2), [50, 50]) && same(splitEqually(0), []), 'Split equally adds up to 100 (the site\'s rule)');
  let rows = addProjectRow([]);
  check(same(rows, [{ project: '', percent: 100 }]), 'the first row takes 100');
  rows = addProjectRow(rows);
  check(rows.length === 2 && rows[1].percent === '', 'the next row starts empty');
  rows = setProjectRow(rows, 0, { project: '13021' });
  rows = setProjectRow(rows, 1, { project: 'TRKAN1', percent: '40' });
  check(splitState(rows).total === 140 && !splitState(rows).ok, 'the total over 100 is not ok');
  rows = splitRows(rows);
  check(same(rows.map((r) => r.percent), [50, 50]) && splitState(rows).ok, 'Split equally on two rows');
  check(splitState(removeProjectRow(rows, 1)).used === 1 && splitState([]).ok && splitState([{ project: '', percent: 100 }]).ok, 'an empty row does not count; no rows = Fame internal');
  check(projectMatch({ count: 0, projects: [] }).key === 'none' && projectMatch({ count: 0, projects: [] }).bad, 'no project: the bad line');
  check(same(projectMatch({ count: 1, projects: [{ job_no: '13021', short_name: 'TRKAN1', name: 'Tower Kandy', customer_name: 'Dialog' }] }), { key: 'one', text: '13021 · TRKAN1 · Tower Kandy · Dialog', bad: false }), 'one match: ✓ with the job, the short name, the name, the customer');
  check(projectMatch({ count: 2, matched_by: 'contains', projects: [{ job_no: '1' }, { job_no: '2' }] }).key === 'several', 'several by contains: "first:"');
  const v = validateAssign({ date: '2026-10-21', leaveBy: '08:00', stops: [{ ...newStop('drop'), place: 'Kandy' }], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false, title: 'T', buffer: '', driver: 'kamal', vehicle: '', pax: '', cname: '', cphone: '', notes: '', whatsapp: false }, [{ project: '13021', percent: 60 }, { project: 'TRKAN1', percent: 40 }], 'Sahan', { defaultVehicle: undefined });
  check('input' in v && same(v.input.projects, [{ project: '13021', percent: 60 }, { project: 'TRKAN1', percent: 40 }]), 'create_task carries the split as projects[]');
}

console.log('\nBook now (New request)');
{
  const veh = (reg_no: string, more: Partial<SuggestedVehicle> = {}): SuggestedVehicle => ({ reg_no, availability: 'Free', pick: 'yes', ...more });
  const groups = { free_pool: [veh('WP A-1')], free_assigned: [veh('WP B-2', { assigned_to: 'Nimali', note: 'ask first', call: 'tel:+94771234567' })], busy: [veh('WP C-3', { availability: 'On a task', back: 'back 14:30', pick: 'no' })], in_garage: [veh('WP D-4', { availability: 'In garage', pick: 'no' })] };
  const rows = groupRows({ groups, vehicles: [] });
  check(same(rows.map((g) => g.key), ['free_pool', 'free_assigned', 'busy', 'in_garage']) && rows[3].disabled && !rows[2].disabled, 'the four groups in the site\'s order; the garage shown, not offered');
  check(same(groupRows({ groups: { ...groups, busy: [] }, vehicles: [] }).map((g) => g.key), ['free_pool', 'free_assigned', 'in_garage']), 'an empty group is left out');
  check(groupRows({ vehicles: [veh('WP A-1')] }).length === 1 && groupRows({ vehicles: [veh('WP A-1')] })[0].key === 'all', 'without groups: one list');
  check(groupRows(null).length === 0, 'nothing yet: no rows');
  check(vehicleLine(veh('WP C-3', { make_model: 'Toyota HiAce', seats: 12, availability: 'On a task', back: 'back 14:30', but: 'not a van' }), (n) => `${n} seats`) === 'Toyota HiAce · 12 seats · On a task · not a van · back 14:30', 'a vehicle\'s line');
  check(same(driverOptions([{ name: 'Kamal', username: 'kamal' }], 'ruwan', 'Ruwan'), [{ name: 'Kamal', username: 'kamal' }, { username: 'ruwan', name: 'Ruwan' }]) && driverOptions([{ name: 'Kamal', username: 'kamal' }], 'kamal').length === 1, 'the picked driver stays in the list');
  const rf = { date: '2026-10-21', leaveBy: '08:00', stops: [{ ...newStop('drop'), place: 'Kandy' }], returnToBase: false, avoidExpressway: false, end: '17:00', start: '', startPax: false, behalf: '', project: '', need: 'van', pax: '3', tools: false, note: '', requesterPhone: '' };
  const r1 = bookInput(rf, { vehicle: '', driver: 'kamal', defaultVehicle: 'WP A-1' });
  check('input' in r1 && r1.input.driver === 'kamal' && !('vehicle' in r1.input) && r1.input.need_type === 'van' && r1.input.pax === 3, 'book_vehicle: the driver with the vehicle they bring (none named), the request\'s fields');
  const r2 = bookInput(rf, { vehicle: 'WP B-2', driver: '', defaultVehicle: null });
  check('error' in r2 && r2.error === 'Pick a driver.', 'no driver: refused (the site\'s rule: Book now has no custodian path since Round 3; "I\'ll drive myself" asks it)');
  const r4 = validateNewRequest({ ...rf, requesterPhone: '077 123 4567', behalf: 'Nimali' });
  check('input' in r4 && r4.input.requester_phone === '077 123 4567' && r4.input.on_behalf_of === 'Nimali', 'create_request carries the requester\'s phone and on behalf of');
}

console.log('\nThe plan\'s words and the conflicts');
{
  const plan = (source: string, legSource: string): PlanPreview => ({ date: '2026-10-21', leave_by: '07:24', leave_by_source: source, stops: [], warnings: [], plan: { source: legSource, total_drive_min: 0, total_km: 0, legs: [], warnings: [] }, timeline: { items: [{ kind: 'leave', at: '07:24', source }, { kind: 'leg', from_n: 'start', to_n: 1, km: 10, minutes: 20, source: legSource }], totals: { drive_min: 20, km: 10, ends: '08:00' } } } as unknown as PlanPreview);
  check(same(leaveNote(plan('plan', 'ors')), { source: 'plan', estimate: false }) && same(leaveNote(plan('manual', 'estimate')), { source: 'typed', estimate: true }) && leaveNote(null) === null, 'planned from the arrive-by times / as typed · estimated times');
  const c: Conflict = { kind: 'vehicle', text: 'WP CAB-4521 is on task Team drop 08:00–11:00', task: { id: 't9', title: 'Team drop', window: '08:00–11:00' }, requester: { name: 'Dilini Perera', call: 'tel:1' }, driver: { name: 'Kamal', whatsapp: 'https://wa.me/94' } };
  check(same(conflictActions(c, true), { openTask: 't9', pick: 'vehicle' }) && conflictActions(c, false).openTask === undefined && conflictActions({ kind: 'driver', text: 'x' }, true).pick === 'driver' && conflictActions({ kind: 'garage', text: 'x' }, true).pick === 'vehicle', 'Open that task only to who may open tasks; Pick another vehicle / driver by the kind');
}

console.log('\nThe outcome after sending');
{
  const sent = taskOutcome({ task_id: 't1', title: 'T', leave_by: '2026-10-21 07:24', vehicle_used: { reg_no: 'WP CAB-4521', why: "Kamal's vehicle today" }, warnings: ['The vehicle is over its allowance'], conflicts: [] });
  check(sent.kind === 'sent' && sent.taskId === 't1' && sent.leaveBy === '07:24' && sent.vehicle === "WP CAB-4521 · Kamal's vehicle today" && sent.warnings.length === 1, 'sent to the driver: Leave by, the vehicle used and why, the warnings');
  check(taskOutcome({ title: 'T', waiting_for_approval: true, request_id: 'r1', next: 'Waiting…' }).kind === 'waiting' && taskOutcome({ title: 'T', request_id: 'r1' }).kind === 'waiting', 'waiting for the fleet admin\'s OK (no task yet)');
  check(taskOutcome({ task_id: 't1', title: 'T', vehicle_used: { reg_no: 'WP X-1', why: 'chosen' } }).vehicle === 'WP X-1' && taskOutcome({ task_id: 't1', title: 'T', vehicle_changed: 'WP Y-2 instead of WP X-1' }).vehicle === 'WP Y-2 instead of WP X-1', 'a chosen vehicle shows its plate; a changed one the server\'s sentence');
  const booked = bookOutcome({ task_id: 't2', request_id: 'r2', leave_by: '08:00', vehicle: 'WP A-1', warnings: [] });
  check(booked.kind === 'booked' && booked.taskId === 't2' && booked.vehicle === 'WP A-1', 'booked: the task and the vehicle');
  check(requestOutcome('request_sent', { next: 'Sent to the fleet admin' }).next === 'Sent to the fleet admin' && requestOutcome('saved', {}).kind === 'saved', 'a request sent, changes saved');
  check(whatsappWithText('https://wa.me/94771234567', 'Hi there') === 'https://wa.me/94771234567?text=Hi%20there' && whatsappWithText(undefined, 'x') === '', 'the WhatsApp link with the message');
  const words = { pickup: 'Pickup', drop: 'Drop-off', visit: 'Visit', stop: 'Stop', contact: 'Contact', open: 'Open Fame Fleet for the details.', newTask: 'New task' };
  const msg = driverMessage({ title: 'Team drop', date: '2026-10-21', leave_by: '07:24', stops: [{ type: 'pickup', place: 'Head office' }, { type: 'drop', place: 'Kandy' }], contact_name: 'Nimali', contact_phone: '077' }, 'Leave by 07:24', words);
  check(msg === 'New task: Team drop\nLeave by 07:24\nPickup: Head office\nDrop-off: Kandy\nContact: Nimali 077\nOpen Fame Fleet for the details.', 'the driver\'s message (the site\'s driverWhatsApp)', msg);
}

console.log('\nChange the task');
{
  const task = { status: 'assigned', date: '2026-10-21', time: '08:00', leave_by: '08:00', end_by: '15:00', title: 'Team drop', passengers: 3, contact: { name: 'Nimali', phone: '077' }, notes: 'keys' };
  const f0 = changeFieldsOf(task);
  check(same(f0, { date: '2026-10-21', time: '08:00', end: '15:00', driver: '', vehicle: '', title: 'Team drop', passengers: '3', contactName: 'Nimali', contactPhone: '077', notes: 'keys' }), 'the form starts from the task; the driver and vehicle empty = keep');
  const r0 = changeTaskInput('t1', 4, f0, task);
  check('error' in r0 && r0.error === 'nothing', 'nothing changed → nothing is sent');
  const r1 = changeTaskInput('t1', 4, { ...f0, title: 'Team drop 2', passengers: '', notes: '', driver: 'ruwan', vehicle: 'on the day' }, task);
  check('input' in r1 && same(r1.input, { task_id: 't1', plan_version: 4, driver: 'ruwan', vehicle: 'on the day', title: 'Team drop 2', passengers: null, notes: '' }), 'only what differs, with the plan version; passengers cleared = null', r1);
  const running = { ...task, status: 'in_progress' };
  const r2 = changeTaskInput('t1', 4, { ...f0, driver: 'ruwan', date: '2026-10-22', time: '09:00', end: '16:00', contactName: 'Sunil' }, running);
  check('input' in r2 && same(r2.input, { task_id: 't1', plan_version: 4, contact_name: 'Sunil' }), 'a running task: the words only (no day, leave-by, end, driver or vehicle: the server refuses them)', r2);
  const r3 = changeTaskInput('t1', 4, { ...f0, end: '07:00' }, task);
  check('error' in r3 && r3.error === 'endBeforeStart', 'the end before the leave-by is refused');
}

console.log('\nThe reviewer\'s findings, fixed');
{
  const base = { date: '2026-10-21', leaveBy: '08:07', end: '', stops: [{ ...newStop('drop'), place: 'Kandy', lat: 7.29, lng: 80.63 }], start: 'Head office', startLat: 6.9, startLng: 79.86 };
  const a1 = whoArgs({ ...base, startPax: false });
  check(a1 !== null && a1.at === '2026-10-21 08:05' && a1.lat === 7.29 && a1.first_stop === undefined, 'Who\'s available: the first row is the first stop when passengers do not get in at the start (floored to 5 min)', a1);
  const a2 = whoArgs({ ...base, startPax: true }, { base: 'Base', need: 'van', pax: '3' });
  check(a2 !== null && a2.lat === 6.9 && a2.need_type === 'van' && a2.pax === 3, 'with passengers at the start the start is the first stop; a request sends its type and passengers', a2);
  check(whoArgs({ ...base, start: '', startPax: true, startLat: undefined, startLng: undefined }, { base: 'Base' })?.first_stop === 'Base', 'an empty start with passengers (no pin) names the base place');
  check(STAY_PRESETS[0] === 5 && (STAY_PRESETS as readonly number[]).includes(240), 'the Stay presets include 5 min and 4 h');
  const useTripSrc = read('office/trip/useTrip.ts');
  check(useTripSrc.includes('const planStore = new Map<string, PlanEntry>();') && useTripSrc.includes('if (!key || cur?.inFlight) return;') && useTripSrc.includes("const offset = tripOffset(f) + (d.reached ?? 0);"), 'one plan store for every mounted step (a call in flight is never doubled); the rows count the reached stops');
}

console.log('\nThe screens as text: every field reaches its input');
{
  const where = read('app/office/trip/where.tsx');
  const when = read('app/office/trip/when.tsx');
  const who = read('app/office/trip/who.tsx');
  const review = read('app/office/trip/review.tsx');
  const change = read('app/office/task/[id]/time.tsx');
  const controls = read('components/office/Controls.tsx');
  const rows = read('components/office/DriverRows.tsx');
  check(controls.includes('export function Stepper') && controls.includes('export function MoreDetails') && controls.includes('export function ToggleRow') && controls.includes('export function Chips'), 'the shared controls: a stepper, More details, a toggle row, chips');
  check(where.includes("setF({ startWhat: f.startWhat === w ? '' : w })") && where.includes('startNote') && where.includes('startDwell') && where.includes('testID="start-details"'), 'Where: what gets in, the note and the minutes at the start under More details');
  check(where.includes("patchStop(s.key, { pin, lat: undefined, lng: undefined })") && where.includes("patchStop(s.key, { note })") && where.includes('testID={`stop-details-${i}`}'), 'Where: a stop\'s typed pin and note under More details');
  check(where.includes('pickupAtStart(f.stops,') && where.includes('tickStart(f.stops, i)') && where.includes('testID="same-as-start"'), 'Where: "Same as the start · Tick it"');
  check(when.includes("'office.trip.freeBy' : 'office.trip.backBy'"), 'When: "Vehicle free by" on a task, "Back by" on a request');
  check(who.includes('<Stepper label={t(\'office.trip.passengers\')} value={f.pax}') && who.includes("setReq({ requesterPhone })") && who.includes("NEED_TYPES = ['car', 'van', 'double_cab', 'lorry', 'other']") && who.includes('maxLength={1000}'), 'Who (request): the passengers stepper, the requester\'s phone, the vehicle type with Other, a note of 1000');
  check(who.includes('testID="request-details"') && who.includes('testID="task-details"') && who.includes('testID="book-now"'), 'Who: More details on both flows; the Book now card');
  check(who.includes("useTool<Suggestions>('suggest_vehicles', sugArgs ?? {}") && who.includes('groupRows(sug.data)') && who.includes('book: { defaultVehicle:') && !who.includes('custodianDrives'), 'Who (Book now): suggest_vehicles, the four groups, the default vehicle kept for Review (no custodian path, as on the site)');
  check(who.includes("api.call<FindProject>('find_project', { text: text.trim() })") && who.includes('setRows(splitRows)') && who.includes('setRows(addProjectRow)') && who.includes("t('office.trip.splitTotal'"), 'Who (task): the project rows with find_project, Split equally, the total');
  check(who.includes("<ToggleRow label={t('office.trip.whatsappToo')} value={f.whatsapp}") && who.includes("driverWhatsapp: whatsapp") && who.includes('<DriverRows'), 'Who (task): the WhatsApp option, the driver\'s link kept, the shared driver rows (with the best match\'s reason)');
  check(who.includes('vehicleDefault({ on: onDay, date: f.date') && who.includes("t('office.trip.needVehicle')") && who.includes('if (!isTask && !books) return;') && who.includes('testID="vehicle-facts"') && who.includes('testID="asked-by"') && who.includes('office.vehicles.type_${type}'), 'Who: the on-the-day default for a task, the known-none block, the default kept for Review, the vehicle facts, the asker line, the type labels');
  check(where.includes('testID="return-toggle"') && where.includes('testID="expressway-toggle"') && where.includes("wasApproved: card.status === 'approved'") && where.includes("running: p.task.status === 'in_progress'") && when.includes("draft.running ?") && when.includes('suggestedMin={trip.suggestions ? fb?.min : undefined}'), 'Where: toggle rows for the two switches, the drafts remember an approved booking and a running task; When: no leave-by on a running task, the usual stay offered as the suggestion (21 October 2026: the Stay field)');
  check(who.includes("byDriver && !f.driver ? t('office.trip.needDriver') : !f.title.trim() ? t('office.trip.needTitle') : !split.ok ? t('office.trip.reasonSplit', { total: split.total }) : whoWhy ? reasonText(t, whoWhy) : byDriver && known && !def && !f.vehicle && !dayDefault ? t('office.trip.needVehicle') : null") && who.includes('whoReason(whoNow, { needsPlate: isTask, plate: f.vehicle })') && who.includes('disabled={!!problem} problem={problem}'), 'Who: the button disabled until the step is valid (the driver, the title, the split, someone else\'s name and phone, the plate with no app, a vehicle when the driver holds none), with the reason under it');
  check(review.includes("bookInput(rf, { vehicle, driver: f.driver, defaultVehicle: d.book?.defaultVehicle }, trip.base)") && review.includes("secondary={books ? { label: t('office.trip.saveWaiting'), onPress: () => void send('send'), disabled: 'error' in planned } : undefined}"), 'Review: Book now as the primary with Save as waiting beside it (book_vehicle), else Send request');
  check(review.includes("testID=\"plan-updating\"") && review.includes('testID="leave-note"') && review.includes('testID="vehicle-used"') && review.includes('testID="conflict-card"') && !review.includes('testID="outcome-card"'), 'Review: Updating plan…, the Leave by note, the vehicle used, the conflict cards (Hotfix O2-H2: no outcome card)');
  check(review.includes("t('office.trip.openThatTask')") && review.includes("t('office.trip.callName'") && review.includes("t('office.trip.whatsappName'") && review.includes("'office.trip.pickAnotherDriver' : 'office.trip.pickAnotherVehicle'"), 'the conflict cards: Open that task, Call / WhatsApp, Pick another vehicle / driver');
  check(review.includes("const o: Outcome = chosen.tool === 'create_task' ? taskOutcome(out)") && review.includes('successOf(') && review.includes("setSavedNotice(s.noticeKey, notice, undefined, o.conflicts)") && review.includes("showSnackbar({") && review.includes("t('office.saved.whatsapp')") && review.indexOf('showSnackbar({') < review.indexOf('setDraft(null);'), 'Hotfix O2-H2: after the save the item opens (successOf), a snackbar with WhatsApp the driver, the warnings on the item; the draft goes last');
  check(review.indexOf('if (outcome) {') < review.indexOf("if (!d) return <View") && review.includes('mode: d!.mode') && review.includes('lastKind.current = kind;') && review.includes('onRetry={() => void send(lastKind.current)}'), 'the outcome shows before the draft guard (the draft is gone by then); Try again sends the same call');
  check(!review.includes('p?.warnings?.map') && review.includes("stopTimesT(t, x)") && review.includes("legTextT(t, x, p.start?.name)") && review.includes("'office.trip.endsAtTime'") && review.includes('testID="reapproval-notice"'), 'the warnings once (the reasons), the rows in the phone\'s language, "ends HH:MM" without a return, the re-approval notice');
  check(review.includes("defaultVehicle: d.book?.defaultVehicle, base: trip.base"), 'create_task with the driver\'s known default vehicle (the site\'s "Add a vehicle" rule)');
  check(review.includes("plan_version: d.planVersion ?? 0") && review.includes("updateRequestInput(d.requestId ?? '', d.version ?? 0, rf, was, trip.base)") && review.includes('const was = d.was ? { ...d.was, who: whoOfDraft(d.was) } : rf;'), 'the versions: plan_version on the stops, version on a request');
  check(change.includes("changeTaskInput(task.id, task.plan_version ?? 0, { ...f, vehicle: vehicleToSend }, task)") && change.includes("api.call<UpdateTaskResult & { warnings?: string[] }>('update_task', r.input)") && change.includes('<DriverRows') && change.includes("t('office.task.keepVehicle'") && change.includes('disabled={!changed}'), 'Change the task: update_task with the plan version and the new driver\'s vehicle, the driver rows, Keep the vehicle, Save disabled until something changed');
  check(change.includes("picked.vehicle.reg_no !== currentPlate ? picked.vehicle.reg_no : ''") && change.includes('{!locked && <View style={styles.card}>') && change.includes("checkDeparture(f.time, departurePlan(p.timeline, p.plan?.buffer_min))") && change.includes('<DepartureNote') && change.includes('floor5(f.time)') && change.includes("'office.task.timeEndBeforeStart' : 'office.task.changeNothingYet'"), 'a new driver\'s vehicle is sent; a running task hides the end and the vehicle; the departure check with Use; the availability time floored; the end-before-start reason');
  check(rows.includes("data?.best?.why") && rows.includes("t('office.ask.open')"), 'the shared driver rows: the best match\'s reason, Ask drivers');
  const roleWord = /'(admin|fleet_admin|office|viewer|staff)'/;
  check(![where, when, who, review, change, controls, rows].some((s) => roleWord.test(s)), 'no role names');
}

console.log('\nStrings in both languages');
{
  type Tree = { [k: string]: string | Tree };
  const en = JSON.parse(read('i18n/en.json')) as { office: Tree };
  const si = JSON.parse(read('i18n/si.json')) as { office: Tree };
  const get = (tree: Tree, path: string): string | undefined => {
    let cur: string | Tree | undefined = tree;
    for (const k of path.split('.')) {
      if (!cur || typeof cur === 'string') return undefined;
      cur = cur[k];
    }
    return typeof cur === 'string' ? cur : undefined;
  };
  const code = ['app/office/trip/where.tsx', 'app/office/trip/when.tsx', 'app/office/trip/who.tsx', 'app/office/trip/review.tsx', 'app/office/task/[id]/time.tsx', 'components/office/Controls.tsx', 'components/office/DriverRows.tsx'].map(read).join('\n');
  const keys = Array.from(new Set(Array.from(code.matchAll(/'office\.(trip|task|common|request|ask)\.([A-Za-z_]+)'/g)).map((m) => `${m[1]}.${m[2]}`)));
  const missing = keys.filter((k) => get(en.office, k) === undefined || get(si.office, k) === undefined);
  check(keys.length > 80 && missing.length === 0, `every key the forms name exists in en and si (${keys.length})`, missing);
  const families = [...['free_pool', 'free_assigned', 'busy', 'in_garage', 'all'].map((k) => `trip.group_${k}`), ...['pickup', 'drop', 'visit', 'stop', 'contact', 'open', 'newTask'].map((k) => `trip.wa_${k}`), ...['people', 'goods', 'documents', 'other'].map((k) => `trip.what_${k}`)];
  const famMissing = families.filter((k) => get(en.office, k) === undefined || get(si.office, k) === undefined);
  check(famMissing.length === 0, 'the run-time families (the groups, the WhatsApp words, what) exist in both languages', famMissing);
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const badPh = [...keys, ...families].filter((k) => { const a = get(en.office, k); const b = get(si.office, k); return a && b && ph(a) !== ph(b); });
  check(badPh.length === 0, 'the same placeholders in both languages', badPh);
  check(!/[෦-෯]/.test([...keys, ...families].map((k) => get(si.office, k) ?? '').join(' ')), 'Latin digits only in Sinhala');
}

console.log(failures === 0 ? '\nAll trip-forms checks passed.' : `\n${failures} trip-forms check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
