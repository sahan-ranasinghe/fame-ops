// Office mode (Phase 8, O2): the trip editor's rules on the phone, no phone needed: the draft (what starts a flow, what
// is worth resuming, the request's fields from it), the plan on the map (a plan_task preview shaped for the task map),
// the words (the site's English reasons and checks said through i18n keys), Who's availability arguments, the entries
// by permission, and a smoke check of the copied site logic (plan_task's and create_request's inputs from a draft).
//
//   npm run test:trip          (from apps/driver)

import { homeActions, moreFor, routeForUrl } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import { validateAssign } from '../src/office/trip/assignLogic';
import { checkDeparture, departurePlan } from '../src/office/trip/departureLogic';
import { draftWorthKeeping, newDraft, nextStep, prevStep, requestFieldsOf, type TripDraft } from '../src/office/trip/draftLogic';
import { previewTask } from '../src/office/trip/planMap';
import { validateNewRequest } from '../src/office/trip/requestLogic';
import { newStop } from '../src/office/trip/stopsLogic';
import { tripPlanInput } from '../src/office/trip/tripLogic';
import { departureText, DWELL_CHIPS, dwellChipText, lateByText, reasonText } from '../src/office/trip/words';
import type { PlanPreview, PlanTimeline } from '../src/office/types';
import { formatTyped, isTime } from '../src/office/trip/timeLogic';
import { whoArgs } from '../src/office/trip/whoLogic';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A translate that shows the key and its variables, so a sentence's parts can be checked. */
const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;

console.log('The draft (office/trip/draftLogic.ts):');
{
  const d = newDraft('task', '2026-10-20');
  check(d.mode === 'task' && d.fields.date === '2026-10-20' && d.fields.stops.length === 2 && d.step === 'where' && d.req.driverRequired, 'a new task draft: the day, a pickup and a drop, the first step');
  check(!draftWorthKeeping(d), 'an untouched draft is not worth resuming');
  const typed: TripDraft = { ...d, fields: { ...d.fields, stops: [{ ...d.fields.stops[0], place: 'Kandy' }, d.fields.stops[1]] } };
  check(draftWorthKeeping(typed), 'a draft with a place typed is');
  check(!draftWorthKeeping({ ...typed, at: Date.now() - 2 * 86_400_000 }), 'but not after a day');
  check(nextStep('where') === 'when' && nextStep('review') === null && prevStep('who') === 'when' && prevStep('where') === null, 'the steps in order');
  const r = requestFieldsOf({ ...newDraft('request'), req: { behalf: 'Nimali', project: 'TRKAN1', need: 'van', tools: true, note: 'keys', driverRequired: false, requesterPhone: '' } });
  check(r.behalf === 'Nimali' && r.need === 'van' && r.driver === false && r.tools && 'stops' in r && !('title' in r), "the request's fields from a draft (driver = the driver-needed switch; the task's fields left out)", Object.keys(r));
}

console.log('\nThe copied site logic from a draft (plan_task, create_request, create_task):');
{
  const d = newDraft('request', '2026-10-20');
  const s1 = { ...newStop('pickup'), place: 'Head office', placeId: 'p1', placePinned: true };
  const s2 = { ...newStop('visit'), place: 'Kurunegala site', placeId: 'p2', placePinned: true, arriveBy: '10:30', dwell: '90' };
  const f = { ...d.fields, stops: [s1, s2], end: '17:00' };
  const plan = tripPlanInput(f, { id: 'b', name: 'Head office' });
  check(!!plan && plan.date === '2026-10-20' && Array.isArray(plan.stops) && (plan.stops as unknown[]).length === 2 && !('leave_by' in plan), 'plan_task: the day and the stops; no leave_by when planned from the arrive-by', plan);
  const req = validateNewRequest(requestFieldsOf({ ...d, fields: f, req: { ...d.req, need: 'van' } }), null);
  check('input' in req && req.input.need_type === 'van' && req.input.back_by === '17:00', 'create_request: the trip and what is asked for', req);
  const task = validateAssign({ ...f, title: 'Site visit', driver: 'kamal' }, [{ project: 'TRKAN1', percent: 100 }], 'Sahan', { defaultVehicle: undefined });
  check('input' in task && task.input.driver === 'kamal' && task.input.title === 'Site visit' && same(task.input.projects, [{ project: 'TRKAN1', percent: 100 }]), 'create_task: the driver, the title, the project', task);
  const noDriver = validateAssign({ ...f, title: 'x', driver: '' }, [], 'Sahan', {});
  check('error' in noDriver, 'create_task without a driver: what is missing', noDriver);
}

console.log('\nThe plan on the map (office/trip/planMap.ts):');
{
  const timeline: PlanTimeline = {
    items: [
      { kind: 'leave', at: '07:24', source: 'plan' },
      { kind: 'stop', n: 1, label: 'Stop 1 · Pickup · Head office', place: 'Head office', planned_arrive: '07:24', planned_leave: '07:24', dwell_min: 0, is_start: true },
      { kind: 'leg', from_n: 1, to_n: 2, km: 94, minutes: 171, source: 'google', line: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
      { kind: 'stop', n: 2, label: 'Stop 2 · Visit · Kurunegala site', place: 'Kurunegala site', planned_arrive: '10:15', planned_leave: '11:45', arrive_by: '10:30', dwell_min: 90 },
      { kind: 'leg', from_n: 2, to_n: 'base', km: 94, minutes: 171, source: 'ors', line: 'abc' },
    ],
    totals: { drive_min: 342, km: 188, ends: '14:36' },
  };
  const p: PlanPreview = {
    date: '2026-10-20', leave_by: '07:24', leave_by_source: 'plan', start: { name: 'Head office', has_pin: true, lat: 6.96, lng: 79.92 },
    stops: [
      { seq: 1, n: 1, type: 'pickup', place: 'Head office', is_start: true, lat: 6.96, lng: 79.92, planned_arrive: '07:24', planned_leave: '07:24' },
      { seq: 2, n: 2, type: 'visit', place: 'Kurunegala site', lat: 7.48, lng: 80.36, arrive_by: '10:30', planned_arrive: '10:15', planned_leave: '11:45', dwell_min: 90, google: true },
    ],
    warnings: [], timeline,
  };
  const task = previewTask(p) as unknown as { task_stops: Record<string, unknown>[]; plan_json: { legs: Record<string, unknown>[] }; start_lat: number; leave_by: string };
  check(task.task_stops.length === 2 && task.task_stops[0].is_start === true && task.task_stops[1].google_place_id !== null && task.task_stops[0].google_place_id === null, 'the stops: the start marked, a Google stop marked (drawn on Google\'s map only)', task.task_stops);
  check(task.task_stops[1].arrive_by === '2026-10-20T10:30:00+05:30' && task.task_stops[1].planned_arrive_at === '2026-10-20T10:15:00+05:30', 'the times as ISO on the plan\'s day (the map shows HH:MM)', task.task_stops[1]);
  check(same(task.plan_json.legs.map((l) => [l.from_seq, l.to_seq, l.source]), [[1, 2, 'google'], [2, -1, 'ors']]), 'the legs by seq, -1 = back to base, with their source', task.plan_json.legs);
  check(task.start_lat === 6.96 && task.leave_by === '2026-10-20T07:24:00+05:30', 'the start\'s pin and the leave time');
}

console.log('\nThe words (office/trip/words.ts):');
{
  check(reasonText(t, 'Add a date.') === 'office.trip.reasonDate' && reasonText(t, 'Add the day.') === 'office.trip.reasonDate', 'the day');
  check(reasonText(t, 'Add at least one stop with a place.') === 'office.trip.reasonStop' && reasonText(t, 'Add at least one stop.') === 'office.trip.reasonStop', 'a stop');
  check(reasonText(t, 'Add a leave-by time, or an arrive-by time on a stop, so it can be planned.') === 'office.trip.reasonLeave', 'a leave time');
  check(reasonText(t, 'Kurunegala site has no pin — add one.') === 'office.trip.reasonNoPin {"place":"Kurunegala site"}', 'no pin, with the place');
  check(reasonText(t, 'Stop 2: needs a place.').startsWith('office.trip.reasonStopPlace'), 'a stop without a place');
  check(reasonText(t, 'The vehicle is in the garage') === 'The vehicle is in the garage', 'the server\'s own warning as it came');
  const plan = departurePlan({ items: [{ kind: 'leave', at: '07:24', source: 'plan' }, { kind: 'stop', n: 2, label: 'Stop 2', place: 'Kurunegala site', planned_arrive: '10:15', planned_leave: '11:45', arrive_by: '10:30', dwell_min: 90 }], totals: { drive_min: 171, km: 94, ends: '11:45' } }, 15, undefined);
  const late = checkDeparture('08:00', plan);
  check(late?.kind === 'late' && late.tone === 'bad' && late.leaveBy === '07:24', 'leaving 08:00 is late for a 10:30 arrive-by', late);
  const said = late ? departureText(t, late) : '';
  check(said.startsWith('office.trip.lateAfter') && said.includes('"leave":"08:00"') && said.includes('"place":"Kurunegala site"') && said.includes('"by":"10:30"') && said.includes('"use":"07:24"'), 'the sentence through i18n with its parts', said);
  check(lateByText(t, late, '08:00') === 'office.trip.tooLate {"min":36}', '"36 min too late"', lateByText(t, late, '08:00'));
  check(lateByText(t, late, '07:00') === null, 'nothing when the typed time is early enough');
  const fill = checkDeparture('', plan);
  check(fill?.kind === 'fill' && fill.leaveBy === '07:24', 'an empty leave-by is filled from the plan');
  check(same(DWELL_CHIPS, [5, 15, 30, 60, 90, 120]) && dwellChipText(t, 90) === 'dur.hours {"h":1,"m":30}' && dwellChipText(t, 15) === 'dur.minutes {"n":15}' && dwellChipText(t, 60) === 'dur.hoursOnly {"h":1}', 'the time-at-stop chips');
}

console.log('\nThe time field (office/trip/timeLogic.ts):');
check(formatTyped('0930') === '09:30' && formatTyped('93') === '93' && formatTyped('9') === '9' && formatTyped('1a2b3c4') === '12:34', 'the colon goes in after two digits');
check(isTime('09:30') && isTime('23:59') && !isTime('24:00') && !isTime('9:30') && !isTime('09:60'), 'a valid time');

console.log('\nWho\'s available for the draft (app/office/trip/who.tsx whoArgs):');
{
  const base = { date: '2026-10-20', leaveBy: '07:24', end: '17:00', stops: [{ ...newStop('visit'), place: 'Kurunegala site', lat: 7.48, lng: 80.36 }], start: '' };
  check(same(whoArgs(base), { at: '2026-10-20 07:20', until: '17:00', lat: 7.48, lng: 80.36 }), 'at the leave-by floored to 5 min, until back-by, the first stop\'s pin', whoArgs(base));
  check(same(whoArgs({ ...base, stops: [{ ...newStop('visit'), place: 'Kandy', placeId: 'p9' }], end: '' }), { at: '2026-10-20 07:20', first_stop: 'Kandy' }), 'a picked place without a pin by its name; no until without back-by');
  check(same(whoArgs({ ...base, stops: [{ ...newStop('visit'), place: 'Kandy' }], end: '' }), { at: '2026-10-20 07:20' }), 'free text is not sent as the first stop (the site\'s rule)');
  check(whoArgs({ ...base, leaveBy: '' }) === null, 'no leave time: nothing to ask');
}

console.log('\nThe entries by permission (office/nav.ts):');
check(same(homeActions(PRESETS.fleet_admin.permissions), ['assign', 'request']) && same(homeActions(PRESETS.dispatcher.permissions), ['assign', 'request']) && same(homeActions(PRESETS.requester.permissions), ['request']) && same(homeActions(PRESETS.viewer.permissions), []), 'Assign a task with assign_tasks, Request a vehicle with request');
check(moreFor(PRESETS.fleet_admin.permissions).includes('issues') && moreFor(PRESETS.dispatcher.permissions).includes('issues') && !moreFor(PRESETS.requester.permissions).includes('issues'), 'Issues under More with issues or assign_tasks');
const U = '0f1e2d3c-4b5a-4968-8777-665544332211';
check(routeForUrl(`/issues/${U}`, PRESETS.fleet_admin.permissions) === `/office/issues/${U}` && routeForUrl('/issues', PRESETS.dispatcher.permissions) === '/office/issues' && routeForUrl(`/issues/${U}`, PRESETS.requester.permissions) === null, 'an issue\'s link by permission');

console.log(failures === 0 ? '\nAll trip tests passed.' : `\n${failures} trip test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
