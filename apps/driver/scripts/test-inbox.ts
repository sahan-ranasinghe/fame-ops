// Office mode (Phase 8, O1): the notification centre's rules (office/inboxLogic.ts), My trips' rules
// (office/tripsLogic.ts), a notification link → an app route (office/nav.ts routeForUrl) and the three screens' strings
// (office.alerts / trips / profile in en.json and si.json). Pure code, no phone:
//
//   npm run test:inbox          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendInbox, atParts, DAY_ORDER, dayKey, filterInbox, groupByDay, inboxArgs, inboxChoice, inboxFilterDefs, inboxLine, kindTone, markRead, unreadAfter } from '../src/office/inboxLogic';
import { routeForUrl } from '../src/office/nav';
import {
  bucketCounts, bucketOf, canWithdraw, changedText, TRIP_BUCKETS, tripBuckets, tripKey, tripLine, tripRoute, tripsArgs, tripsChoice, tripsFilterDefs, TRIPS_DAYS_AHEAD, TRIPS_DAYS_BACK,
  WITHDRAW_REASONS,
  withdrawReason,
} from '../src/office/tripsLogic';
import type { CreatedTaskCard, InboxItem, RequestCard, TripLive } from '../src/office/types';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TODAY = '2026-10-19';
const NAMES = {
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const item = (id: number, at: string, patch: Partial<InboxItem> = {}): InboxItem =>
  ({ id, event: 'request.created', title: `Item ${id}`, at, ago: '5 min ago', read: false, kind: 'info', ...patch });

console.log('\n== Notifications: the day groups ==');
{
  check(same(atParts('2026-10-18 10:42'), { date: '2026-10-18', time: '10:42', iso: '2026-10-18T10:42:00+05:30' }), '"2026-10-18 10:42" splits into its date, time and instant');
  check(same(atParts('nonsense'), { date: '', time: '', iso: '' }) && same(atParts(undefined), { date: '', time: '', iso: '' }), 'an unreadable at gives empty parts');
  check(dayKey('2026-10-19 08:14', TODAY) === 'today', "today's date is Today");
  check(dayKey('2026-10-19 00:00', TODAY) === 'today' && dayKey('2026-10-19 23:59', TODAY) === 'today', 'the whole Colombo day counts as Today');
  check(dayKey('2026-10-18 16:40', TODAY) === 'yesterday', 'the day before is Yesterday');
  check(dayKey('2026-10-17 12:33', TODAY) === 'earlier' && dayKey('2026-09-01 09:00', TODAY) === 'earlier', 'anything older is Earlier');
  check(dayKey('2026-10-20 09:00', TODAY) === 'earlier', 'a later date (the clocks differ) is not Today or Yesterday');
  check(dayKey('', TODAY) === 'earlier' && dayKey(undefined, TODAY) === 'earlier', 'no at: Earlier, never a crash');
  check(dayKey('2026-11-01 09:00', '2026-11-02') === 'yesterday' && dayKey('2026-12-31 09:00', '2027-01-01') === 'yesterday', 'Yesterday across a month and a year end');
  check(same(DAY_ORDER, ['today', 'yesterday', 'earlier']), 'the groups are Today, Yesterday, Earlier in that order');

  const items = [
    item(1, '2026-10-19 08:14'),
    item(2, '2026-10-19 07:02', { read: true }),
    item(3, '2026-10-18 16:40', { read: true }),
    item(4, '2026-10-17 12:33'),
    item(5, '2026-10-19 08:50'),
  ];
  const groups = groupByDay(items, TODAY);
  check(same(groups.map((g) => g.key), ['today', 'yesterday', 'earlier']), 'three groups when every day has items');
  check(same(groups[0].items.map((i) => i.id), [1, 2, 5]), "Today keeps the server's order (newest first as it came)");
  check(same(groups[1].items.map((i) => i.id), [3]) && same(groups[2].items.map((i) => i.id), [4]), 'Yesterday and Earlier hold theirs');
  check(same(groupByDay(items.slice(0, 2), TODAY).map((g) => g.key), ['today']), 'an empty group is left out');
  check(groupByDay([], TODAY).length === 0, 'no items: no groups');

  console.log('\n== Notifications: the filter and the rows marked read ==');
  check(same(filterInbox(items, 'all').map((i) => i.id), [1, 2, 3, 4, 5]), 'All shows everything');
  check(same(filterInbox(items, 'unread').map((i) => i.id), [1, 4, 5]), 'Unread shows only what is not read');
  check(same(groupByDay(filterInbox(items, 'unread'), TODAY).map((g) => g.key), ['today', 'earlier']), 'Unread then grouped: Yesterday (all read) disappears');
  check(same(inboxArgs(50, '', true, 'c1'), { limit: 50, archived: true, cursor: 'c1' }) && same(inboxArgs(50, ''), { limit: 50 }), "my_inbox: archived for the older ones, the next page's cursor");
  {
    const a = { unread: 1, items: [{ id: 1 }, { id: 2 }], next: 'n' } as never;
    const both = appendInbox(a, { unread: 1, items: [{ id: 2 }, { id: 3 }] } as never) as { items: { id: number }[]; next?: string };
    check(both.items.map((i) => i.id).join() === '1,2,3' && both.next === undefined, 'Load more: never an alert twice');
  }
  const idefs = inboxFilterDefs(3, (k) => k);
  check(idefs.length === 2 && idefs[0].default === 'all' && same(idefs[0].options.map((o) => [o.value, o.count]), [['all', undefined], ['unread', 3]]) && idefs[1].key === 'history' && idefs[1].default === 'recent', 'the Filter sheet: All or Unread with the unread count; how far back (O3: the last 30 days or older ones too)');
  check(inboxChoice({ show: 'unread' }) === 'unread' && inboxChoice({}) === 'all' && same(inboxArgs(50), { limit: 50 }) && same(inboxArgs(50, ' kamal '), { limit: 50, search: 'kamal' }), 'my_inbox: the page as before, the search only when typed');
  const one = markRead(items, [1]);
  check(one[0].read && !one[3].read && !one[4].read && one[1] === items[1], 'a tap marks that row read and leaves the others as they are (same objects)');
  check(markRead(items, 'all').every((i) => i.read), 'Mark all read marks every row');
  check(items[0].read === false, 'the original list is not changed');
  check(unreadAfter(3, 1) === 2 && unreadAfter(0, 1) === 0 && unreadAfter(1, 5) === 0, 'the unread count never goes below zero');

  console.log('\n== Notifications: the line under an item and the icon tone ==');
  check(inboxLine({ at: '2026-10-19 08:14', ago: '48 min ago' }, TODAY, NAMES) === '08:14 · 48 min ago', 'today: "08:14 · 48 min ago"');
  check(inboxLine({ at: '2026-10-18 16:40', ago: '17 h ago' }, TODAY, NAMES) === 'Sun 18 Oct 16:40', 'yesterday: the day, the date and the time');
  check(inboxLine({ at: '2026-10-11 12:33', ago: '8 days ago' }, TODAY, NAMES) === 'Sun 11 Oct 12:33', 'earlier: the same');
  check(inboxLine({ at: 'bad', ago: '2 h ago' }, TODAY, NAMES) === '2 h ago', 'an unreadable at: the ago words alone');
  check(kindTone('urgent') === 'red' && kindTone('alarm') === 'red' && kindTone('alert') === 'amber' && kindTone('soft') === 'blue' && kindTone('info') === 'muted' && kindTone(undefined) === 'muted',
    'urgent and alarm red, alert amber, soft blue, info grey');
}

console.log('\n== A notification link → the app route (routeForUrl) ==');
{
  const ID = '0f3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const approver = ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues'];
  const dispatcher = ['view', 'request', 'assign_tasks'];
  const requester = ['view', 'request'];
  const viewer = ['view'];
  check(routeForUrl(`/requests/${ID}/decide`, approver) === `/office/request/${ID}`, '/requests/<id>/decide with approve: the request page');
  check(routeForUrl(`https://fame-fleet.pages.dev/requests/${ID}/decide`, approver) === `/office/request/${ID}`, 'the same with the site in front');
  check(routeForUrl(`/requests/${ID}`, requester) === '/office/(tabs)/trips', '/requests/<id> for a requester: My trips (no request page yet)');
  check(routeForUrl(`/requests/${ID}/decide`, viewer) === null, 'a viewer: nothing opens');
  check(routeForUrl(`/tasks/${ID}`, dispatcher) === `/office/task/${ID}`, '/tasks/<id> with assign_tasks: the task');
  check(routeForUrl(`/tasks/${ID}`, requester) === null, '/tasks/<id> without assign_tasks: nothing');
  check(routeForUrl(`/tasks/${ID}/edit`, dispatcher) === `/office/task/${ID}/driver`, '/tasks/<id>/edit: Give it a driver');
  check(routeForUrl(`/tasks?task=${ID}`, dispatcher) === `/office/task/${ID}`, "/tasks?task=<id> (the site's push tap) with assign_tasks: that task");
  check(routeForUrl(`https://fame-fleet.pages.dev/tasks?task=${ID}`, dispatcher) === `/office/task/${ID}`, 'the same with the site in front');
  check(routeForUrl(`/tasks?task=${ID}`, requester) === null, '/tasks?task=<id> without assign_tasks: nothing');
  check(routeForUrl('/tasks', dispatcher) === '/office/(tabs)/tasks' && routeForUrl('/tasks?date=2026-10-20', dispatcher) === '/office/(tabs)/tasks', '/tasks (no task named): the board');
  check(routeForUrl('/my-trips', requester) === '/office/(tabs)/trips', '/my-trips with request: My trips');
  check(routeForUrl('/my-trips', viewer) === null, '/my-trips without request: nothing');
  check(routeForUrl('/live', viewer) === '/office/(tabs)/live' && routeForUrl('/live?driver=sunil', viewer) === '/office/(tabs)/live', '/live with view: Live');
  check(routeForUrl('/live', []) === null, '/live with no permissions: nothing');
  check(routeForUrl('/requests', approver) === '/office/(tabs)/approve' && routeForUrl('/requests', requester) === null, '/requests: Approve for approvers only');
  check(routeForUrl('/settings/users', approver) === null && routeForUrl('/issues/123', approver) === null, 'a path with no screen in O1: nothing');
  check(routeForUrl(undefined, approver) === null && routeForUrl('', approver) === null, 'no link: nothing');
}

console.log('\n== My trips: the buckets ==');
{
  const live = (state: TripLive['state'], text: string = state): TripLive => ({ state, text });
  const request = (id: string, status: RequestCard['status'], patch: Partial<RequestCard> = {}): RequestCard =>
    ({ id, requested_by: 'Nimali', when: 'Tue 20 Oct 11:00', status, ...patch });
  const task = (id: string, state: TripLive['state'], patch: Partial<CreatedTaskCard> = {}): CreatedTaskCard =>
    ({ source: 'task', id, task_id: id, title: `Task ${id}`, when: 'Thu 22 Oct 15:00', status: state, live: live(state), created: '2026-10-18 10:42', ...patch });

  check(TRIPS_DAYS_BACK === 30 && TRIPS_DAYS_AHEAD === 60, 'the range: the last 30 days to the next 60');
  check(same(TRIP_BUCKETS, ['waiting', 'coming', 'done']), 'the sections: Waiting, Coming up, Done');
  check(bucketOf(request('a', 'waiting')) === 'waiting', 'a waiting request: Waiting');
  check(bucketOf(request('a', 'changed')) === 'waiting', 'a changed booking (waits for the office again): Waiting');
  check(bucketOf(request('a', 'approved')) === 'coming', 'an approved request with no live state: Coming up');
  for (const s of ['approved', 'accepted', 'on_the_way', 'arrived'] as const) check(bucketOf(task('t', s)) === 'coming', `live ${s}: Coming up`);
  for (const s of ['completed', 'declined', 'cancelled', 'missed'] as const) check(bucketOf(task('t', s)) === 'done', `live ${s}: Done`);
  check(bucketOf(request('a', 'approved', { live: live('completed', 'Completed · 11:40') })) === 'done', "a request's live state wins over its status");
  check(bucketOf(request('a', 'declined')) === 'done' && bucketOf(request('a', 'cancelled')) === 'done', 'declined and cancelled requests: Done');

  const trips = [
    request('r1', 'waiting'),
    task('t1', 'on_the_way'),
    request('r2', 'approved', { live: live('accepted', 'Driver accepted · 09:12') }),
    task('t2', 'completed'),
    request('r3', 'declined'),
    request('r4', 'cancelled'),
    task('t3', 'missed'),
  ];
  check(same(bucketCounts(trips), { waiting: 1, coming: 2, done: 4 }), 'the chips count 1 waiting, 2 coming up, 4 done');
  const all = tripBuckets(trips, 'all');
  check(same(all.map((g) => g.key), ['waiting', 'coming', 'done']), 'All: the three sections');
  check(same(all[1].trips.map(tripKey), ['t-t1', 'r-r2']), "Coming up keeps the server's order; keys tell a task from a request");
  check(same(tripBuckets(trips, 'done').map((g) => g.key), ['done']) && tripBuckets(trips, 'done')[0].trips.length === 4, 'Done alone: one section with its four');
  check(tripBuckets([request('r1', 'waiting')], 'done').length === 0, 'a filter with nothing in it: no section');
  check(tripBuckets([], 'all').length === 0, 'no trips: no sections');
  const tdefs = tripsFilterDefs(trips, (k) => k);
  const tc = bucketCounts(trips);
  check(tdefs.length === 1 && same(tdefs[0].options.map((o) => [o.value, o.count]), [['all', trips.length], ['waiting', tc.waiting], ['coming', tc.coming], ['done', tc.done]]) && tdefs[0].options[1].label === 'office.trips.waiting', 'the Filter sheet: All and the buckets with their counts');
  check(tripsChoice({ show: 'done' }) === 'done' && tripsChoice({ show: 'x' }) === 'all' && tripsFilterDefs(undefined, (k) => k)[0].options.every((o) => o.count === undefined), 'the choice read back; no counts before the answer');
  check(same(tripsArgs('2026-10-20', 100), { from: '2026-09-20', to: '2026-12-19', include: 'all', limit: 100 }) && same(tripsArgs('2026-10-20', 100, ' galle '), { from: '2026-09-20', to: '2026-12-19', include: 'all', limit: 100, search: 'galle' }), 'my_trips: 30 days back to 60 ahead as before, the search only when typed');

  console.log('\n== My trips: the line, Withdraw and where a row opens ==');
  check(tripLine(request('a', 'waiting', { back_by: '17:00', need: '1 pax' }), 'back by') === 'Tue 20 Oct 11:00 · back by 17:00 · 1 pax', 'a request: when · back by · need');
  check(tripLine(request('a', 'approved', { assigned: { driver: 'Sunil', vehicle: 'WP CAB-4521' } }), 'back by') === 'Tue 20 Oct 11:00 · Sunil · WP CAB-4521', 'an approved one adds the driver and the plate');
  check(tripLine(request('a', 'approved', { assigned: { driver: 'Sunil', vehicle: '', vehicle_text: 'Vehicle: on the day' } }), 'back by') === 'Tue 20 Oct 11:00 · Sunil · Vehicle: on the day',
    'a vehicle chosen on the day says so');
  check(tripLine(task('t', 'accepted', { back_by: '18:00' }), 'back by') === 'Thu 22 Oct 15:00 · back by 18:00', 'a created task: when · back by (no need)');
  check(changedText(request('a', 'approved', { trip: { stops: [], changed: { by: 'Palitha', text: 'Changed by the office · was 14:00 · stops changed' } } })) === 'Changed by the office · was 14:00 · stops changed',
    "the office's change line comes from the card");
  check(changedText(request('a', 'approved')) === undefined && changedText(task('t', 'accepted')) === undefined, 'no change: no line');

  check(canWithdraw(request('a', 'waiting')), 'own waiting request: Withdraw');
  check(!canWithdraw(request('a', 'approved')) && !canWithdraw(request('a', 'changed')) && !canWithdraw(request('a', 'declined')) && !canWithdraw(request('a', 'cancelled')),
    'anything decided or changed: no Withdraw (the request page handles it)');
  check(!canWithdraw(task('t', 'accepted')), 'a created task: never Withdraw');
  check(same(WITHDRAW_REASONS.map((r) => r.value), ['not_needed', 'plans_changed', 'other']), 'the three reasons in their order');
  check(withdrawReason('plans_changed', ' the meeting moved ') === 'Plans changed — the meeting moved', 'the reason and the note, trimmed');
  check(withdrawReason('not_needed', '') === 'Not needed any more' && withdrawReason('other', '   ') === 'Other', 'no note: the reason alone');

  const approver = ['view', 'request', 'approve'];
  check(tripRoute(request('r1', 'waiting'), approver) === '/office/request/r1', 'an approver opens the request page');
  check(tripRoute(request('r1', 'waiting'), ['view', 'request']) === '/office/request/r1', 'a requester opens their own request (O3 row 2: the trip, the timeline, Edit, Withdraw)');
  check(tripRoute(task('t1', 'accepted'), approver) === null, 'a created task: no page in O1');
}

console.log('\n== The screens as text (Alerts, My trips, Home, Approve, Tasks) ==');
{
  const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
  const alerts = read('app/office/(tabs)/alerts.tsx');
  const trips = read('app/office/(tabs)/trips.tsx');
  const home = read('app/office/(tabs)/index.tsx');
  const approve = read('app/office/(tabs)/approve.tsx');
  const tasks = read('app/office/(tabs)/tasks.tsx');
  check(/<FilterBar/.test(alerts) && /defs=\{inboxFilterDefs\(unreadN, t\)\}/.test(alerts) && /useTool<Inbox>\('my_inbox', inboxArgs\(LIMIT, search, archived\)/.test(alerts) && /<LoadMore/.test(alerts) && !/FilterChips/.test(alerts), 'Alerts: the search bar (my_inbox\'s search), one Filter button (All / Unread, how far back), Load more');
  check(/<FilterBar/.test(trips) && /defs=\{tripsFilterDefs\(q\.data \? trips : undefined, t\)\}/.test(trips) && /useTool<MyTrips>\('my_trips', tripsArgs\(today, LIMIT, search\)\)/.test(trips) && !/FilterChips/.test(trips), 'My trips: the search bar (my_trips\' search) and one Filter button with the counts');
  check(/<DayStrip value=\{date\} onChange=\{setDate\}/.test(tasks) && !/max=/.test(tasks.split('<DayStrip')[1].split('/>')[0]) && /useTool<Board>\('task_board', \{ date, limit: 50 \}/.test(tasks) && !/ChevronLeft|prevDay/.test(tasks), 'Tasks: the week strip with Today and the calendar, days ahead allowed; task_board by the day as before');
  check(/q\.data && q\.data\.date === date \? q\.data : null/.test(tasks), 'Tasks: another day\'s board is never shown under the day chosen (skeleton rows until it comes)');
  for (const [name, src] of [['Alerts', alerts], ['My trips', trips], ['Home', home], ['Approve', approve], ['Tasks', tasks]] as const) {
    check(/<SkeletonRows/.test(src) && /<ListFailed/.test(src) && /<ListEmpty/.test(src) && !/<Loading|<Empty /.test(src), `${name}: skeleton rows, the error with Try again, the empty state that says what next`);
  }
  check(/action=\{actions\.includes\('assign'\)/.test(home) && /action=\{me\.tools\.includes\('create_request'\)/.test(trips), 'an empty list\'s action only when the person may (Assign a task, Request a vehicle)');
}

console.log('\n== Strings (office.alerts / trips / profile in en.json and si.json) ==');
{
  // The strings were merged into en.json and si.json (the sidecar is gone): read them there.
  const parts = {
    en: JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', 'en.json'), 'utf8')),
    si: JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', 'si.json'), 'utf8')),
  } as {
    en: { office: Record<string, Record<string, string>> };
    si: { office: Record<string, Record<string, string>> };
  };
  const groups = ['alerts', 'trips', 'profile'];
  check(groups.every((g) => g in parts.en.office && g in parts.si.office), 'en and si both carry office.alerts, office.trips and office.profile');
  const missing: string[] = [];
  const untranslated: string[] = [];
  const digits: string[] = [];
  const vars: string[] = [];
  for (const g of groups) {
    for (const [k, en] of Object.entries(parts.en.office[g] ?? {})) {
      const si = parts.si.office[g]?.[k];
      if (!si) missing.push(`${g}.${k}`);
      else {
        if (si === en) untranslated.push(`${g}.${k}`);
        if (/[෦-෯]/.test(si)) digits.push(`${g}.${k}`);
        const a = (en.match(/\{\w+\}/g) ?? []).sort();
        const b = (si.match(/\{\w+\}/g) ?? []).sort();
        if (!same(a, b)) vars.push(`${g}.${k}`);
      }
    }
    for (const k of Object.keys(parts.si.office[g] ?? {})) if (!parts.en.office[g]?.[k]) missing.push(`en ${g}.${k}`);
  }
  check(missing.length === 0, 'every key in both languages', missing);
  check(untranslated.length === 0, 'every Sinhala string differs from the English', untranslated);
  check(digits.length === 0, 'Latin digits only in the Sinhala strings', digits);
  check(vars.length === 0, 'the same {placeholders} in both languages', vars);
  const used = ['alerts.above', 'alerts.title', 'alerts.markAllRead', 'alerts.unread', 'alerts.none', 'alerts.noneUnread', 'alerts.open',
    'trips.above', 'trips.waiting', 'trips.coming', 'trips.done', 'trips.none', 'trips.approvedBy', 'trips.callName', 'trips.withdraw', 'trips.withdrawTitle',
    'trips.withdrawQuestion', 'trips.withdrawNote', 'trips.withdrawConfirm', 'trips.withdrawn', 'trips.reasonNotNeeded', 'trips.reasonPlansChanged', 'trips.reasonOther',
    'profile.contact', 'profile.myPhone', 'profile.noPhone', 'profile.edit', 'profile.phoneLabel', 'profile.phonePlaceholder', 'profile.phoneNeeded', 'profile.saved',
    'profile.email', 'profile.notifications', 'profile.noEvents', 'profile.app', 'profile.language', 'profile.officePhone', 'profile.officePhoneNone', 'profile.privacyHint'];
  const absent = used.filter((k) => { const [g, kk] = k.split('.'); return !parts.en.office[g]?.[kk]; });
  check(absent.length === 0, 'every key the three screens use is in the part', absent);
  check(WITHDRAW_REASONS.every((r) => { const [, g, k] = r.label.split('.'); return !!parts.en.office[g]?.[k]; }), "the Withdraw reasons' labels are in the part");
}

console.log(failed ? `\n${failed} FAILED` : '\nAll inbox, trips and route checks passed.');
process.exit(failed ? 1 : 0);
