// Office mode (Phase 8, O1): the pure rules and the office-api client with a fake server, no phone needed:
//   - office/api.ts: the retry rule (a dropped read asked again once, a write never and marked write, /me the same),
//     the error mapping (401 → not_signed_in, 403 codes, 400, 409, 429, 5xx), signed out only on a 401 or 403;
//   - office/nav.ts: the tabs, Home's sections and chips, More's list for every preset and the odd sets, and a
//     notification's link → the app's screen by permission;
//   - office/homeLogic.ts, office/approveLogic.ts, office/taskLogic.ts: the words and inputs the screens build.
//
//   npm run test:office          (from apps/driver)

import { createOfficeApi, dropped, isWrite, mapHttpError, mayRetry, READ_TOOLS, signedOut } from '../src/office/api';
import { alreadyDecided, availabilityArgs, canApprove, decideCall, declineReason, driverPill, firstPick, rankedDrivers, tripView } from '../src/office/approveLogic';
import { boardLine, boardPill, greeting, requestLine, requestTitle, statusTone, tripLive } from '../src/office/homeLogic';
import { homeChips, homeSections, moreFor, routeForUrl, tabsFor } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import { allowedActions, availabilityArgsForTask, cancelInput, firstPickForTask, leaveIn, reassignInput, steps, stopLateMin, stopParts, taskStatusKey } from '../src/office/taskLogic';
import type { AvailableDriver, FleetError, RequestCard, Stop, TaskDetail } from '../src/office/types';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A fake office-api: answers in order, each [status, body]; records every request. */
function fakeServer(answers: [number, unknown][]) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://x.test/functions/v1/office-api', '');
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const [status, body] = answers.shift() ?? [500, { error: 'no answer scripted' }];
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const api = createOfficeApi({ baseUrl: 'https://x.test/functions/v1/office-api/', apiKey: 'anon', token: async () => 'tok', fetch: fetchFn, retryWaitMs: 1 });
  return { api, calls };
}

async function main() {
  console.log('The office-api client (office/api.ts):');
  {
    const { api, calls } = fakeServer([[503, {}], [200, { name: 'Sahan', role: 'admin', permissions: ['view', 'users'], tools: ['fleet_overview'] }]]);
    const me = await api.me();
    check(me.name === 'Sahan' && calls.length === 2 && calls.every((c) => c.path === '/me'), '/me dropped once (503) is asked again and answers', calls);
    check(same(me.permissions, ['view', 'users']), 'the permissions are normalised (known ones, in order)', me.permissions);
  }
  {
    const { api, calls } = fakeServer([[200, { name: 'Old', role: 'fleet_admin', tools: [] }]]);
    const me = await api.me();
    check(same(me.permissions, PRESETS.fleet_admin.permissions), 'an older /me without permissions gets the role\'s defaults', me.permissions);
    check(calls.length === 1, 'one call');
  }
  {
    const { api, calls } = fakeServer([[503, {}], [503, {}]]);
    const err = await api.me().catch((e) => e as FleetError);
    check((err as FleetError).code === 'upstream_error' && calls.length === 2, '/me dropped twice fails as did-not-answer after two tries (never signed out)', err);
    check(!signedOut(err as FleetError), 'and that is not "signed out"');
  }
  {
    const { api, calls } = fakeServer([[401, { error: 'not_signed_in' }]]);
    const err = await api.me().catch((e) => e as FleetError);
    check((err as FleetError).code === 'not_signed_in' && calls.length === 1, '/me 401 fails at once, never asked again', err);
    check(signedOut(err as FleetError), 'a 401 is signed out');
    check(signedOut({ code: 'not_an_office_user', message: '' }) && signedOut({ code: 'switched_off', message: '' }), 'a 403 no-office-role or switched-off is signed out');
    check(!signedOut({ code: 'network', message: '' }) && !signedOut({ code: 'forbidden', message: '' }), 'no connection or a refused tool is not signed out');
  }
  {
    const { api, calls } = fakeServer([[500, { error: 'boom' }], [200, { result: { date: '2026-10-19', assigned: [] } }]]);
    const out = await api.call<{ date: string }>('task_board', { date: '2026-10-19' });
    check(out.date === '2026-10-19' && calls.length === 2 && same(calls[0].body, { date: '2026-10-19' }), 'a dropped read (task_board 500) is asked again once with the same arguments', calls);
  }
  {
    const { api, calls } = fakeServer([[503, {}]]);
    const err = await api.call('cancel_task', { task_id: 'x', reason: 'r' }).catch((e) => e as FleetError);
    check(calls.length === 1 && (err as FleetError).write === true && (err as FleetError).code === 'upstream_error', 'a dropped write (cancel_task 503) is sent once and marked write', { calls: calls.length, err });
  }
  {
    const { api, calls } = fakeServer([[503, {}], [200, { result: { reviewing: [] } }]]);
    await api.call('reviewing', { request_id: 'r' });
    check(calls.length === 2, 'reviewing is the one keyed write: asked again when dropped');
  }
  {
    const { api } = fakeServer([[409, { error: 'Already approved by Palitha at 10:42' }]]);
    const err = await api.call('decide_request', { request_id: 'r', decision: 'approve' }).catch((e) => e as FleetError);
    check((err as FleetError).code === 'tool_error' && (err as FleetError).message.includes('Palitha') && (err as FleetError).write === true, 'a refusal (409) carries the server\'s words', err);
    check(alreadyDecided(err as FleetError) && alreadyDecided({ code: 'tool_error', message: 'This request was edited since you opened it: open it again.' }) && !alreadyDecided({ code: 'tool_error', message: 'No driver named x' }), 'and "Already approved by …" or "edited since you opened it" read as already decided');
  }
  check(mapHttpError(403, { error: 'mfa_required' }).code === 'mfa_required' && mapHttpError(403, { error: 'Your role cannot' }).code === 'forbidden', '403: mfa_required / forbidden');
  check(mapHttpError(400, { error: 'bad_input', issues: [{ path: 'date', message: 'YYYY-MM-DD' }] }).message === 'Check date: YYYY-MM-DD', '400 names the field');
  check(mapHttpError(429, null).code === 'rate_limited' && mapHttpError(404, null).code === 'no_such_tool', '429 and 404');
  check(READ_TOOLS.has('fleet_overview') && READ_TOOLS.has('availability') && !READ_TOOLS.has('decide_request') && !READ_TOOLS.has('reassign_task'), 'the read tools list');
  check(isWrite('cancel_task') && !isWrite('reviewing') && !isWrite('my_inbox'), 'isWrite: a write, the keyed write, a read');
  check(mayRetry('task_board', { code: 'network', message: '' }) && !mayRetry('task_board', { code: 'forbidden', message: '' }) && !mayRetry('cancel_task', { code: 'network', message: '' }), 'mayRetry: a dropped read only');
  check(dropped({ code: 'server_unavailable', message: '' }) && !dropped({ code: 'tool_error', message: '' }), 'dropped: no connection or a 5xx, never a refusal');

  console.log('\nTabs, Home and More by permission (office/nav.ts):');
  const keys = (p: readonly string[]) => tabsFor(p).map((t) => t.key).join(' ');
  check(keys(PRESETS.fleet_admin.permissions) === 'home approve live drivers more', 'fleet admin: Home · Approve · Live · Drivers · More (O2: Drivers on the bar as designs 03, 12, 15, Alerts under More)', keys(PRESETS.fleet_admin.permissions));
  check(keys(PRESETS.dispatcher.permissions) === 'home tasks live drivers more', 'dispatcher: Home · Tasks · Live · Drivers · More (design 03)', keys(PRESETS.dispatcher.permissions));
  check(keys(PRESETS.requester.permissions) === 'home trips live alerts more', 'requester: Home · My trips · Live · Alerts · More', keys(PRESETS.requester.permissions));
  check(keys(PRESETS.viewer.permissions) === 'home live alerts more', 'viewer: Home · Live · Alerts · More', keys(PRESETS.viewer.permissions));
  check(keys(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']) === 'home approve live drivers more', 'admin: as an approver (Tasks and Alerts under More)');
  check(keys(['approve']) === 'home approve drivers alerts more', 'approve without view: no Live, Alerts back on the bar', keys(['approve']));
  check(keys(['vehicles']) === 'home alerts more' && keys(['users']) === 'home alerts more' && keys([]) === 'home alerts more', 'vehicles only, users only, nothing: Home · Alerts · More');
  check(tabsFor(['view', 'approve']).every((t, i, a) => a.findIndex((x) => x.key === t.key) === i), 'never a tab twice');
  check(same(moreFor(PRESETS.fleet_admin.permissions), ['tasks', 'task_history', 'trips', 'issues', 'asks', 'alerts', 'vehicles', 'reports', 'maintenance', 'places', 'people_drivers']) && same(moreFor(PRESETS.dispatcher.permissions), ['trips', 'issues', 'asks', 'alerts', 'vehicles', 'reports']) && same(moreFor(PRESETS.viewer.permissions), ['vehicles']), 'More lists what is not on the bar (O2: Issues, Alerts for approvers and dispatchers, the management rows by permission; O3: Questions for approve or assign; Task history beside Tasks when Tasks is under More)', [moreFor(PRESETS.fleet_admin.permissions), moreFor(PRESETS.dispatcher.permissions)]);
  check(same(homeSections(PRESETS.fleet_admin.permissions), ['requests', 'needs_driver', 'critical', 'tasks', 'road', 'trips']), 'fleet admin Home: every section', homeSections(PRESETS.fleet_admin.permissions));
  check(same(homeSections(PRESETS.dispatcher.permissions), ['needs_driver', 'tasks', 'road', 'trips']), 'dispatcher Home: needs a driver, tasks, road, trips');
  check(same(homeSections(PRESETS.requester.permissions), ['road', 'trips']) && same(homeSections(PRESETS.viewer.permissions), ['road']), 'requester and viewer Home');
  check(same(homeChips(PRESETS.fleet_admin.permissions), ['road', 'free', 'waiting', 'garage']) && same(homeChips(PRESETS.dispatcher.permissions), ['road', 'free']), 'the header chips');
  const ad = PRESETS.fleet_admin.permissions, rq = PRESETS.requester.permissions, vw = PRESETS.viewer.permissions;
  const U = '0f1e2d3c-4b5a-4968-8777-665544332211';
  check(routeForUrl(`/requests/${U}/decide`, ad) === `/office/request/${U}`, 'a request to decide → Approve (approve)');
  check(routeForUrl(`https://fame-fleet.pages.dev/requests/${U}`, rq) === '/office/(tabs)/trips', 'a request page for a requester → My trips');
  check(routeForUrl(`/requests/${U}`, vw) === null, 'a request page for a viewer → nothing');
  check(routeForUrl(`/tasks/${U}/edit?driver=1`, ad) === `/office/task/${U}/driver`, 'give it a driver → Needs a driver (assign_tasks)');
  check(routeForUrl(`/tasks/${U}`, ad) === `/office/task/${U}` && routeForUrl(`/tasks?task=${U}`, ad) === `/office/task/${U}`, 'a task page, also the push form');
  check(routeForUrl(`/tasks/${U}`, rq) === null && routeForUrl('/live', vw) === '/office/(tabs)/live' && routeForUrl('/settings/users', ad) === null && routeForUrl(undefined, ad) === null, 'the permission gate, Live, an unknown path, no link');

  console.log('\nHome (office/homeLogic.ts):');
  check(greeting(Date.parse('2026-10-19T03:30:00Z')) === 'morning' && greeting(Date.parse('2026-10-19T08:30:00Z')) === 'afternoon' && greeting(Date.parse('2026-10-19T13:00:00Z')) === 'evening', 'morning / afternoon / evening by the Colombo hour');
  check(requestTitle({ title: undefined, route: 'Head office → Kandy', requested_by: 'Nimali' }) === 'Head office → Kandy' && requestTitle({ title: 'Docs', route: 'x', requested_by: 'N' }) === 'Docs', 'a request\'s title');
  check(requestLine({ requested_by: 'Nimali', when: 'Tue 20 Oct 08:30', need: '3 passengers · any van' }) === 'Nimali · Tue 20 Oct 08:30 · 3 passengers · any van', 'a request\'s line');
  check(requestLine({ requested_by: 'Sahan', when: 'Tue 20 Oct 11:00', proposed: { driver: 'Kamal', vehicle: 'WP CAB-4521' } }) === 'Sahan · Tue 20 Oct 11:00 · Kamal · WP CAB-4521', 'a proposal names its driver and vehicle');
  check(statusTone('in_progress') === 'blue' && statusTone('completed') === 'green' && statusTone('waiting') === 'amber' && statusTone('declined') === 'red' && statusTone('zzz') === 'muted', 'status tones');
  check(same(boardPill({ status: 'in_progress', late_min: 15 }), { key: 'late', tone: 'red', min: 15 }) && same(boardPill({ status: 'assigned', accepted: '07:05' }), { key: 'accepted', tone: 'green' }) && same(boardPill({ status: 'assigned' }), { key: 'assigned', tone: 'amber' }), 'board pills: late, accepted, sent');
  check(boardLine({ driver: 'Sunil', vehicle: 'WP CAB-4521' }, 4) === 'Sunil · WP CAB-4521 · 4 pax' && boardLine({ driver: 'Ruwan', vehicle_text: 'Vehicle: on the day' }) === 'Ruwan · Vehicle: on the day', 'board lines');
  check(tripLive({ source: 'task', id: 't', task_id: 't', title: 'x', when: 'w', status: 'assigned', live: { state: 'approved', text: 'Approved' }, created: 'c' }).state === 'approved', 'a created task\'s live state');

  console.log('\nApprove a request (office/approveLogic.ts):');
  const words = { passengersHere: 'passengers get in here', arriveBy: (x: string) => `arrive by ${x}`, there: (m: number) => `${m} min there`, leave: (x: string) => `leave ${x}`, about: (x: string) => `about ${x}`, backBy: (x: string) => `back by ${x}`, backAt: (p: string) => `Back at ${p}` };
  const card: RequestCard = {
    id: 'r1', requested_by: 'Nimali', when: 'Tue 20 Oct 07:24', status: 'waiting', version: 3,
    fields: { date: '2026-10-20', time: '07:24', back_by: '17:00', need_type: 'van', pax: 3, route_from: 'Head office', route_to: 'Kurunegala site' },
    trip: {
      start: { name: 'Head office, Kelaniya', has_pin: true, lat: 6.96, lng: 79.92 }, leave_by: '07:24', return_to_base: true,
      stops: [
        { seq: 0, type: 'pickup', what: 'people', place: 'Head office, Kelaniya', is_start: true, n: 1, planned_leave: '07:24' },
        { seq: 1, type: 'visit', place: 'Kurunegala site', n: 2, arrive_by: '10:30', dwell_min: 90, planned_arrive: '10:15', planned_leave: '11:45', lat: 7.48, lng: 80.36 },
      ],
      timeline: { items: [], totals: { drive_min: 342, km: 188, ends: '14:36' } },
    },
  };
  const tv = tripView(card, words);
  check(tv.date === '2026-10-20' && tv.leaveBy === '07:24' && tv.rows.length === 3, 'the trip: the day, leave by, three rows (S, 1, B)', tv);
  check(tv.rows[0].mark === 'S' && same(tv.rows[0].parts, ['passengers get in here', '07:24']), 'S: passengers get in here · 07:24', tv.rows[0]);
  check(tv.rows[1].mark === '2' && same(tv.rows[1].parts, ['arrive by 10:30', '90 min there', 'leave 11:45']), 'the stop: arrive by · there · leave', tv.rows[1]);
  check(tv.rows[2].kind === 'back' && tv.rows[2].place === 'Back at Head office, Kelaniya' && same(tv.rows[2].parts, ['about 14:36', 'back by 17:00']), 'B: about · back by', tv.rows[2]);
  check(tv.totals?.km === 188 && tv.totals?.driveMin === 342, 'the totals');
  const old = tripView({ when: 'Tue 20 Oct 09:00', fields: { date: '2026-10-20', time: '09:00', back_by: '12:00', route_from: 'Head office', route_to: 'Kandy' } }, words);
  check(old.rows.length === 3 && old.rows[0].place === 'Head office' && old.rows[1].place === 'Kandy' && same(old.rows[2].parts, ['back by 12:00']), 'the old From → To shape', old);
  check(same(availabilityArgs(card), { at: '2026-10-20 07:24', until: '17:00', need_type: 'van', pax: 3, lat: 7.48, lng: 80.36 }), 'availability: at the leave-by until back-by, the type and pax, the first stop\'s pin', availabilityArgs(card));
  check(availabilityArgs({ fields: { date: '', time: '' } }) === null, 'no day and time: no call');
  const drivers: AvailableDriver[] = [
    { name: 'Nimal', username: 'nimal', state: 'off_duty', status_text: 'Off duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: false },
    { name: 'Kamal', username: 'kamal', state: 'on_duty', status_text: 'On duty', accepted_today: 1, declined_today: 0, licence: { chip: 'ok' }, free: true, rank: 1, match_why: 'On duty · free all day · 1.7 km away', vehicle: { reg_no: 'WP CAB-4521', source: 'on_duty' } },
    { name: 'Ruwan', username: 'ruwan', state: 'on_duty', status_text: 'On duty · busy 13:30–16:00', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: false },
  ];
  const avail = { best: { name: 'Kamal', username: 'kamal', why: '' }, drivers };
  check(rankedDrivers(drivers).map((d) => d.name).join(' ') === 'Kamal Ruwan Nimal', 'free first, then busy, then off duty', rankedDrivers(drivers).map((d) => d.name));
  check(firstPick(card, avail) === 'kamal', 'the best match is picked first');
  check(firstPick({ proposed: { driver: 'Ruwan', username: 'ruwan' } }, avail) === 'ruwan' && firstPick({ proposed: { driver: 'Ruwan' } }, avail) === 'ruwan', 'a proposal\'s driver is picked first');
  check(firstPick({}, null) === '', 'nobody yet without Who\'s available');
  check(driverPill(drivers[1], 'kamal') === 'best' && driverPill(drivers[2], 'kamal') === 'busy' && driverPill(drivers[0], 'kamal') === 'off_duty' && driverPill({ ...drivers[1], not_available: 'Not available · leave' }, 'kamal') === 'not_available', 'the row pills');
  check(same(decideCall(card, 'approve', { driver: 'kamal', vehicle: 'WP CAB-4521' }), { tool: 'decide_request', input: { request_id: 'r1', decision: 'approve', version: 3, driver: 'kamal', vehicle: 'WP CAB-4521' } }), 'approve a waiting request: decide_request with the driver and vehicle');
  check(same(decideCall(card, 'decline', { reason: 'No vehicle free then' }), { tool: 'decide_request', input: { request_id: 'r1', decision: 'decline', version: 3, reason: 'No vehicle free then' } }), 'decline: decide_request with the reason');
  const changed = { ...card, status: 'changed' as const };
  check(same(decideCall(changed, 'approve', {}), { tool: 'redecide_request', input: { request_id: 'r1', version: 3, decision: 'keep' } }), 'a changed booking kept: redecide_request keep with the version');
  check(same(decideCall(changed, 'approve', { driver: 'ruwan' }), { tool: 'redecide_request', input: { request_id: 'r1', version: 3, decision: 'change', driver: 'ruwan' } }), 'a changed booking with another driver: change');
  check(decideCall(changed, 'decline', { reason: 'x' }).input.decision === 'decline', 'a changed booking declined');
  check(canApprove(card, 'kamal') && !canApprove(card, '') && canApprove({ driver_required: false }, ''), 'Approve needs a driver unless the custodian drives');
  check(declineReason('Not approved', '  see me ') === 'Not approved — see me' && declineReason('Other', '') === 'Other', 'the decline reason\'s words');

  console.log('\nTask detail and Give it a driver (office/taskLogic.ts):');
  const stop = (s: Partial<Stop>): Stop => ({ seq: 1, type: 'visit', status: 'pending', ...s });
  const sw = { planned: (x: string) => `planned ${x}`, left: (x: string) => `left ${x}`, arriveBy: (x: string) => `arrive by ${x}`, about: (x: string) => `about ${x}`, arrived: (x: string) => `arrived ${x}`, done: (x: string) => `done ${x}`, late: (m: number) => `${m} min late`, there: (m: number) => `${m} min there`, skipped: (w: string) => `skipped · ${w}` };
  check(same(stopParts(stop({ is_start: true, planned_depart: '08:30', done: '08:31' }), sw), ['planned 08:30', 'left 08:31']), 'the start: planned · left');
  check(same(stopParts(stop({ arrive_by: '10:30', planned_arrive: '10:38', dwell_min: 90 }), sw), ['arrive by 10:30', 'about 10:38', '90 min there']), 'a stop still to come: arrive by · about · there');
  check(same(stopParts(stop({ arrive_by: '10:30', arrived: '10:41', done: '12:10', status: 'done' }), sw), ['arrive by 10:30', 'arrived 10:41', 'done 12:10']), 'a stop done: arrived · done');
  check(same(stopParts(stop({ status: 'skipped', skip_reason: 'closed', planned_arrive: '10:00' }), sw), ['about 10:00', 'skipped · closed']), 'a skipped stop');
  check(stopLateMin(stop({ arrive_by: '10:30', planned_arrive: '10:38' })) === 8 && stopLateMin(stop({ arrive_by: '10:30', arrived: '10:20' })) === 0 && stopLateMin(stop({ planned_arrive: '10:38' })) === 0, '8 min late from the planned arrival; on time or unknown = 0');
  const task: TaskDetail['task'] = { id: 't1', title: 'Team drop', status: 'in_progress', start: 'Today 08:30', date: '2026-10-19', time: '08:30', leave_by: '08:30', end_by: '17:00', driver: 'Sunil', passengers: 4, approved_by: { name: 'Palitha', at: 'Sun 18 Oct 16:40' }, accepted: '07:05', started: '08:31', eta: { next: '10:38' } };
  const st = steps(task, [stop({ planned_arrive: '10:30' })]);
  check(st.map((s) => `${s.key}:${s.time}:${s.state}`).join(' ') === 'approved:Sun 18 Oct 16:40:done accepted:07:05:done on_the_way:08:31:now arrived:~10:38:todo done:—:todo', 'the five steps while on the way', st);
  const stDone = steps({ ...task, status: 'completed', completed: '12:30' }, [stop({ arrived: '10:41', done: '12:10', status: 'done' })]);
  check(stDone.every((s) => s.state === 'done') && stDone[3].time === '10:41' && stDone[4].time === '12:30', 'every step done once completed');
  check(taskStatusKey(task) === 'in_progress' && taskStatusKey({ status: 'assigned', accepted: '07:05' }) === 'accepted' && taskStatusKey({ status: 'assigned', needs_driver: { since: 'x' } }) === 'declined', 'the status pill');
  const now = Date.parse('2026-10-19T02:48:00Z'); // 08:18 Colombo
  check(same(leaveIn('2026-10-19', '09:00', now), { key: 'leavesIn', minutes: 42 }) && same(leaveIn('2026-10-19', '08:08', now), { key: 'passed', minutes: 10 }) && leaveIn('2026-10-19', '15:00', now) === null && leaveIn(undefined, '09:00', now) === null, '"leaves in 42 min", "passed 10 min ago", nothing far off');
  const detail: TaskDetail = { task: { ...task, status: 'assigned', vehicle_type_wanted: 'car', needs_driver: { since: '08:14', reason: 'declined', reason_text: 'not available' }, driver: 'Kamal' }, stops: [stop({ is_start: true, place: 'Head office', lat: 6.96, lng: 79.92 }), stop({ seq: 2, place: 'SLTC', lat: 6.84, lng: 80.1 })], projects: 'x', odometer: [], fuel: [], vehicle_reports: [] };
  check(same(availabilityArgsForTask(detail), { at: '2026-10-19 08:30', until: '17:00', need_type: 'car', pax: 4, lat: 6.84, lng: 80.1 }), 'Who can take it: at the leave-by until the end, the type and pax, the first real stop\'s pin', availabilityArgsForTask(detail));
  const kamalFirst = { best: { name: 'Kamal', username: 'kamal', why: '' }, drivers };
  check(firstPickForTask(detail.task, kamalFirst) === 'ruwan' || firstPickForTask(detail.task, kamalFirst) === '', 'never the driver who declined it, even as the best match');
  check(firstPickForTask({ ...detail.task, driver: 'Sunil' }, kamalFirst) === 'kamal', 'the best match otherwise');
  check(same(reassignInput('t1', drivers[1]), { task_id: 't1', driver: 'kamal', vehicle: 'WP CAB-4521' }) && same(reassignInput('t1', drivers[2]), { task_id: 't1', driver: 'ruwan' }), 'reassign_task: the driver, and the vehicle they hold when known');
  check(same(cancelInput('t1', 'Not needed any more', ' plans changed '), { task_id: 't1', reason: 'Not needed any more — plans changed' }), 'cancel_task\'s reason');
  check(same(allowedActions({ status: 'assigned' }), { reassign: true, cancel: true }) && same(allowedActions({ status: 'in_progress' }), { reassign: false, cancel: true }) && same(allowedActions({ status: 'completed' }), { reassign: false, cancel: false }), 'what a task still allows');

  console.log(failures === 0 ? '\nAll office tests passed.' : `\n${failures} office test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
