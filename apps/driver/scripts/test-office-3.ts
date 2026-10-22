// Round 4–7, item 12 (design/mockups/2026-10-22, mockups 1–4; docs/phase8-plan.md §33.13 "Restyle, never rebuild"), Office
// mode and /m/:
//   - the pure rules the restyled screens draw with: the plan's rows for the route stepper (office/stepperRows.ts: S at the
//     leave time, the stops with ONE meta line and their chip, the legs under the stop before them, B back at base; the ⓘ
//     notes), a request's own rows, the status banners and the task page's bar (office/detailBanner.ts);
//   - the inventory's key actions are still on each screen (read as text): Home (the tiles, Needs you now, the requests,
//     Give a driver, Snooze, View all, Live map, Board, the bell, the avatar, New trip), Review (Send / Book now / Save as
//     waiting, Back, the conflict cards' Open that task, Call, WhatsApp, Pick another, ⓘ, Change, Edit), the request
//     (Approve, Decline, Change time, Ask drivers, Tell requester, Cancel booking, Edit, Withdraw, Request again, Call and
//     WhatsApp the requester, the timeline), the trip (Change the task, Give a driver / Reassign, Change stops, Swap vehicle,
//     Reopen, Cancel task, Show the driven route, Show the plan, Live map, Call and WhatsApp the driver and the holder, the
//     passengers' Call / WhatsApp / Share trip, the requester's Call, the asks link, More details), the passenger's view;
//   - the shared patterns are the ones each screen draws (components/patterns: TopBar, StatsRow, StatusBanner, RouteStepper,
//     ListRow, BottomActionBar, NewTripFab);
//   - the four design pages (src/design/Office*.tsx): a default export each, the marker the deploy refuses, ?lang=, the
//     real screen, and the browser's import graph reaches no phone-only module;
//   - every new key (office.ui3.*) in English and Sinhala (en.json / si.json with src/i18n/parts/*.json merged in while they
//     exist), the same placeholders, Latin digits, and the Sinhala words of the tiles, facts, chips and bar buttons short
//     enough for 390 px.
//
//   npx tsx scripts/test-office-3.ts          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { lateMinutes, requestBanner, taskActions, taskBanner } from '../src/office/detailBanner';
import { legShort, planNotes, planRows, type PlanWords, requestRows, timelineRows } from '../src/office/stepperRows';
import type { TimelineItem } from '../src/office/types';

const src = join(__dirname, '..', 'src');
let failures = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const code = (p: string) => readFileSync(join(src, p), 'utf8');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------------------------
// The strings: en / si, deep-merged with the sidecars while they exist
// ---------------------------------------------------------------------------------------------------------------------
type Tree = { [k: string]: string | string[] | Tree };
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const was = out[k];
    out[k] = was && typeof was === 'object' && !Array.isArray(was) && typeof v === 'object' && !Array.isArray(v) ? merge(was, v) : v;
  }
  return out;
}
const lang: Record<'en' | 'si', Tree> = { en: JSON.parse(code('i18n/en.json')) as Tree, si: JSON.parse(code('i18n/si.json')) as Tree };
const parts = join(src, 'i18n', 'parts');
if (existsSync(parts)) {
  for (const f of readdirSync(parts).filter((n) => n.endsWith('.json')).sort()) {
    const side = JSON.parse(readFileSync(join(parts, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (side.en) lang.en = merge(lang.en, side.en);
    if (side.si) lang.si = merge(lang.si, side.si);
  }
}
function text(l: 'en' | 'si', key: string): string | null {
  let node: unknown = lang[l];
  for (const p of key.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[p] : undefined;
  return typeof node === 'string' ? node : null;
}
const en = (key: string, vars?: Record<string, string | number>) => {
  let s = text('en', key) ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------
console.log('\nThe plan on the route stepper (office/stepperRows.ts)');
{
  const words: PlanWords = {
    stay: (dur, usual) => `${dur} stay${usual ? ' (usual here)' : ''}`,
    leave: (t) => `leave ${t}`,
    by: (t) => `by ${t}`,
    passengersHere: 'passengers get in here',
    onTime: 'On time',
    late: (m) => `${m} min late`,
    km: (k) => `${k} km`,
    dur: (m) => `${Math.floor(m / 60)} h ${m % 60} min`,
    expressway: 'via the expressway',
    theStart: 'the start',
    backAt: (p) => `Back at ${p}`,
  };
  const items: TimelineItem[] = [
    { kind: 'leave', at: '08:16', source: 'plan' },
    { kind: 'leg', from_n: 'start', to_n: 1, km: 99, minutes: 143, source: 'google', rush_factor: 1.3 },
    { kind: 'stop', n: 1, label: '1', place: 'Wariyapola', planned_arrive: '10:45', planned_leave: '11:45', arrive_by: '11:00', late_min: 0, dwell_min: 60 },
    { kind: 'leg', from_n: 1, to_n: 2, km: 20.04, minutes: 30, source: 'ors', via_expressway: true },
    { kind: 'stop', n: 2, label: '2', place: 'Kurunegala', planned_arrive: '12:15', planned_leave: '12:45', arrive_by: '12:00', late_min: 15, dwell_min: 30, dwell_source: 'place' },
    { kind: 'leg', from_n: 2, to_n: 'base', km: 98, minutes: 159, source: 'estimate' },
  ];
  const rows = planRows(items, { startName: 'Head office', back: { time: '14:23', place: 'Head office', meta: 'back by 15:00' } }, words);
  check(same(rows.map((r) => `${r.mark}:${r.kind}:${r.time}:${r.title}`), ['S:start:08:16:Head office', '1:stop:10:45:Wariyapola', '2:stop:12:15:Kurunegala', 'B:back:14:23:Back at Head office']), 'S at the leave time (no start stop), the stops with their planned arrival, B at the end time');
  check(rows[0].leg === '99 km · 2 h 23 min' && rows[1].leg === '20 km · 0 h 30 min · via the expressway' && rows[2].leg === '98 km · 2 h 39 min', 'each leg as the short line under the stop before it (via the expressway kept), never its source');
  check(same(rows[1].meta?.map((m) => `${m.icon}:${m.text}`), ['stay:1 h 0 min stay', 'leave:leave 11:45', 'by:by 11:00']) && same(rows[1].chip, { text: 'On time', tone: 'green' }), 'ONE meta line (the stay, the leave time, the deadline) and the chip "On time" green');
  check(same(rows[2].chip, { text: '15 min late', tone: 'amber' }) && rows[2].meta?.[0].text === '0 h 30 min stay (usual here)', 'late against the deadline amber; the place\'s usual time said');
  check(same(rows[3].meta, [{ text: 'back by 15:00' }]), 'B with its back-by');
  const withStart = planRows([{ kind: 'leave', at: '09:29', source: 'plan' }, { kind: 'stop', n: 0, label: 'S', place: 'Office', planned_arrive: '09:29', planned_leave: '09:29', dwell_min: 0, is_start: true }], { offset: 2 }, words);
  check(withStart.length === 1 && withStart[0].mark === 'S' && withStart[0].meta?.[0].text === 'passengers get in here', 'a start stop (passengers get in) is the S row, never twice');
  const offset = planRows([{ kind: 'stop', n: 1, label: '1', place: 'X', planned_arrive: '10:00', planned_leave: '10:10', dwell_min: 10 }], { offset: 2 }, words);
  check(offset[0].mark === '3', 'Change stops on a running task: the numbers after the stops reached');
  check(legShort({ kind: 'leg', from_n: 1, to_n: 2, km: 5.55, minutes: 9, source: 'estimate' }, words) === '5.6 km · 0 h 9 min', 'a leg\'s km to one decimal');
  const notes = planNotes(items, 'planned from the arrive-by times', (l) => `${l.km} km · ${l.source}`);
  check(notes.length === 4 && notes[0] === 'planned from the arrive-by times' && notes[1] === '99 km · google', 'ⓘ: the leave note and every leg in full (their source), nothing dropped');
  const req = requestRows([{ kind: 'start', mark: 'S', place: 'Office', parts: ['leave 09:00'] }, { kind: 'stop', mark: '1', place: 'Site', parts: [] }, { kind: 'back', mark: 'B', place: 'Back at Office', parts: ['back by 18:00'] }]);
  check(same(req.map((r) => `${r.mark}:${r.title}:${r.meta?.[0]?.text ?? ''}`), ['S:Office:leave 09:00', '1:Site:', 'B:Back at Office:back by 18:00']), 'a request with no plan yet: its own rows on the stepper');
}

console.log('\nThe plan screen on the route stepper (office/stepperRows.ts timelineRows; task/[id]/plan.tsx)');
{
  const words = {
    leaveBy: 'Leave by',
    stopTimes: (x: Extract<TimelineItem, { kind: 'stop' }>) => (x.is_start ? `Leave ${x.planned_leave} · Passengers get in here` : `Arrive ${x.planned_arrive} · ${x.dwell_min} min · Leave ${x.planned_leave}`),
    arriveBy: (time: string) => `Arrive by ${time}`,
    onTime: 'On time',
    late: (min: number) => `${min} min late`,
    leg: (x: Extract<TimelineItem, { kind: 'leg' }>) => [x.from_n === 'start' ? 'From Head office' : x.to_n === 'base' ? 'Back to the base' : '', `${x.km} km`, `${x.minutes} min`, x.source, x.via_expressway ? 'via the expressway' : ''].filter(Boolean).join(' · '),
  };
  const items: TimelineItem[] = [
    { kind: 'leave', at: '08:16', source: 'plan' },
    { kind: 'leg', from_n: 'start', to_n: 1, km: 99, minutes: 143, source: 'google' },
    { kind: 'stop', n: 1, label: 'Stop 1 · Pickup · Wariyapola', place: 'Wariyapola', planned_arrive: '10:45', planned_leave: '11:45', arrive_by: '11:00', late_min: 0, dwell_min: 60 },
    { kind: 'leg', from_n: 1, to_n: 2, km: 20, minutes: 30, source: 'ors', via_expressway: true },
    { kind: 'stop', n: 2, label: '', place: 'Kurunegala', planned_arrive: '12:15', planned_leave: '12:45', arrive_by: '12:00', late_min: 15, dwell_min: 30 },
    { kind: 'stop', n: 3, label: 'Stop 3 · Visit · Kandy', place: 'Kandy', planned_arrive: '14:00', planned_leave: '14:10', dwell_min: 10 },
    { kind: 'leg', from_n: 3, to_n: 'base', km: 98, minutes: 159, source: 'estimate' },
  ];
  const rows = timelineRows(items, words);
  check(same(rows.map((r) => `${r.mark}:${r.kind}:${r.time}:${r.title}`), ['S:start:08:16:Leave by', '1:stop:10:45:Stop 1 · Pickup · Wariyapola', '2:stop:12:15:Kurunegala', '3:stop:14:00:Stop 3 · Visit · Kandy']),
    'S at the leave time ("Leave by"), each stop by its number with its planned arrival and its label (else the place)', rows.map((r) => `${r.mark}:${r.kind}:${r.time}:${r.title}`));
  check(rows[0].leg === 'From Head office · 99 km · 143 min · google' && rows[1].leg === '20 km · 30 min · ors · via the expressway' && rows[2].leg === undefined && rows[3].leg === 'Back to the base · 98 km · 159 min · estimate',
    'each leg in full under the row before it: from the start under S, its source, via the expressway, the drive back under the last stop', rows.map((r) => r.leg));
  check(rows[1].words === 'Arrive 10:45 · 60 min · Leave 11:45 · Arrive by 11:00' && rows[3].words === 'Arrive 14:00 · 10 min · Leave 14:10', 'a stop\'s times in words under it, its arrive-by after them', rows.map((r) => r.words));
  check(same(rows.map((r) => r.chip ?? null), [null, { text: 'On time', tone: 'green' }, { text: '15 min late', tone: 'amber' }, null]), 'the chip against the deadline: on time green, late amber; none without a deadline');
  check(rows.slice(1).every((r) => r.titleLines === 2) && !rows.some((r) => r.meta), 'the label on up to two lines; no meta line of its own (the words say it all)');
  const start = timelineRows([{ kind: 'leave', at: '09:29', source: 'plan' }, { kind: 'stop', n: 1, label: 'Stop 1 · Pickup · Office', place: 'Office', planned_arrive: '09:29', planned_leave: '09:29', dwell_min: 0, is_start: true }], words);
  check(same(start.map((r) => `${r.mark}:${r.title}:${r.words ?? ''}`), ['S:Leave by:', '1:Stop 1 · Pickup · Office:Leave 09:29 · Passengers get in here']), 'a start stop keeps its own row and words under "Leave by" (as the screen had both)');
  const two = timelineRows([{ kind: 'leave', at: '09:00', source: 'plan' }, { kind: 'leg', from_n: 'start', to_n: 1, km: 1, minutes: 2, source: 'ors' }, { kind: 'leg', from_n: 'start', to_n: 2, km: 3, minutes: 4, source: 'ors' }], words);
  check(two.length === 1 && two[0].leg === 'From Head office · 1 km · 2 min · ors\nFrom Head office · 3 km · 4 min · ors', 'two legs in a row (a stop with no plan): both kept, one per line');
  const plan = code('app/office/task/[id]/plan.tsx');
  check(/<PlanStepper\s+rows=\{timelineRows\(items, \{/.test(plan) && /framed=\{false\}\s+testID="plan-timeline"/.test(plan) && !/items\.map\(/.test(plan) && !/<Pill\b/.test(plan),
    'the plan screen draws its timeline on the one route stepper (PlanStepper), no timeline of its own');
  check(plan.includes("leaveBy: t('office.request.leaveBy')") && plan.includes('stopTimes: (x) => stopTimesT(t, x)') && plan.includes("arriveBy: (time) => t('office.request.arriveBy', { time })")
    && plan.includes("onTime: t('office.trip.onTime')") && plan.includes("late: (min) => t('office.task.minLate', { min })") && plan.includes("legTextT(t, x, task?.start_place), x.via_expressway ? t('office.trip.viaExpressway') : ''")
    && plan.includes("t('office.trip.endsAtTime', { time: totals.ends })") && plan.includes('sentenceText(t, w)'), 'every word of the plan screen kept: Leave by, the stops\' times, arrive by, on time / late, each leg with its source, the totals, the warnings');
  const stepper = code('components/office/PlanStepper.tsx');
  check(/lines: words \? <Txt variant="muted" size=\{15\}/.test(stepper), 'a row\'s sentence wraps under it (the stepper\'s lines)');
}

console.log('\nThe banners and the task page\'s bar (office/detailBanner.ts)');
{
  check(same(requestBanner({ status: 'waiting' }, true, true), { tone: 'amber', icon: 'clock', title: 'waiting' }), 'a waiting request for an approver: "Waiting for your OK", amber');
  check(requestBanner({ status: 'changed' }, true, true).title === 'changed', 'a changed booking: "changed · decide again"');
  check(same(requestBanner({ status: 'waiting' }, false, false), { tone: 'amber', icon: 'clock', title: 'status' }), 'the asker\'s own waiting request: its status');
  check(requestBanner({ status: 'approved' }, false, true).tone === 'green' && requestBanner({ status: 'declined' }, false, true).tone === 'red' && requestBanner({ status: 'cancelled' }, false, true).tone === 'muted' && requestBanner({ status: 'expired' }, false, true).icon === 'calendarX', 'approved green, declined red, cancelled grey, expired with the calendar');
  check(same(taskBanner({ status: 'in_progress' }), { tone: 'blue', icon: 'navigation', title: 'onTheWay' }), 'a running task: on the way, blue');
  check(taskBanner({ status: 'assigned', needs_driver: { since: 'x' } }).title === 'needsDriver' && taskBanner({ status: 'completed', needs_driver: { since: 'x' } }).title === 'status', 'needs a driver (red) until done or cancelled');
  check(taskBanner({ status: 'assigned' }).tone === 'amber' && taskBanner({ status: 'assigned', accepted: '07:41' }).tone === 'green' && taskBanner({ status: 'missed' }).tone === 'red' && taskBanner({ status: 'cancelled' }).tone === 'muted', 'sent amber, accepted green, missed red, cancelled grey');
  check(lateMinutes({ status: 'in_progress', eta: { late_min: 7 } }) === 7 && lateMinutes({ status: 'in_progress', eta: { late_min: 7 }, late_report: { text: 'x' } as never }) === null && lateMinutes({ status: 'assigned', eta: { late_min: 7 } }) === null, 'the late chip: the ETA\'s minutes while running, the driver\'s own Running late wins');
  const running = taskActions({ time: true, stops: true, swap: true, cancel: true, route: true }, false);
  check(same(running, { bar: ['time', 'stops'], more: ['swap', 'route', 'cancel'] }), 'on the way: Change the task and Change stops on the bar; Swap vehicle, the driven route and Cancel under ⋯', running);
  const needs = taskActions({ reassign: true, time: true, stops: true, cancel: true }, true);
  check(same(needs, { bar: ['giveDriver', 'time'], more: ['stops', 'cancel'] }), 'needs a driver: Give a driver first', needs);
  const assigned = taskActions({ reassign: true, time: true, stops: true, cancel: true }, false);
  check(same(assigned, { bar: ['time', 'reassign'], more: ['stops', 'cancel'] }), 'sent: Change the task and Reassign driver on the bar', assigned);
  const done = taskActions({ reopen: true, route: true }, false);
  check(same(done, { bar: ['reopen'], more: ['route'] }), 'done today: Reopen on the bar, the driven route under ⋯', done);
  check(same(taskActions({}, false), { bar: [], more: [] }), 'a viewer: no bar');
  // Review of Round 4–7: a bar never holds ⋯ More alone.
  check(same(taskActions({ route: true }, false), { bar: ['route'], more: [] }) && same(taskActions({ route: true, cancel: true }, false), { bar: ['route', 'cancel'], more: [] }),
    'none of the first jobs: one or two others go on the bar themselves (no ⋯ More holding them)');
  check(same(taskActions({ route: true, plan: true, cancel: true }, false), { bar: ['route'], more: ['plan', 'cancel'] }), 'three: the most used (the driven route) on the bar, the rest under ⋯');
  // Review of Round 4–7: "km" through the key Review uses (office.trip.kmN), never typed after a number.
  const kmTyped = ['components/office/VehicleChecks.tsx', 'app/office/request/[id].tsx'].filter((f) => /\} km`/.test(code(f)));
  check(kmTyped.length === 0 && code('app/office/request/[id].tsx').includes("t('office.trip.kmN', { km: trip.totals.km })") && (code('components/office/VehicleChecks.tsx').match(/t\('office\.trip\.kmN', \{ km: kmText\(c\.odometer_km\) \}\)/g) ?? []).length === 2,
    'the request\'s distance and a check\'s odometer say km in the person\'s language', kmTyped);
}

console.log('\nThe key actions on each screen (read as text)');
{
  const home = code('app/office/(tabs)/index.tsx');
  for (const [what, ok] of [
    ['the stats row (StatTiles, each tile through chipTarget)', /<StatTiles/.test(home) && (home.match(/onPress: go\('/g) ?? []).length === 3],
    ['Needs you now with its total', /testID="needs-you-now"/.test(home) && /needsTotal/.test(home)],
    ['the requests to approve, each to its page', /pathname: '\/office\/request\/\[id\]'/.test(home)],
    ['Give a driver', /office\.home\.giveDriver/.test(home) && /pathname: '\/office\/task\/\[id\]\/driver'/.test(home)],
    ['Snooze with Undo', /testID="attention-snooze"/.test(home) && /office\.decide\.undo/.test(home)],
    ['View all (Approve, Tasks, Issues, My trips)', (home.match(/office\.common\.viewAll/g) ?? []).length >= 4],
    ['Live map and Board', /office\.home\.liveMap/.test(home) && /office\.home\.board/.test(home)],
    ['the reminders row', /testID="home-reminders"/.test(home) && /onPress=\{go\('reminders'\)\}/.test(home)],
    ['New trip (Assign a task, Request a vehicle)', /<NewTripButton/.test(home) && /office\.trip\.assignTask/.test(home) && /office\.trip\.requestVehicle/.test(home)],
    ['the thin top bar (the bell, the avatar)', /<TopBar greeting=/.test(home)],
  ] as const) check(ok, `Home: ${what}`);
  const ui = code('office/ui.tsx');
  check(/testID="top-bar-avatar"/.test(ui) && /router\.push\('\/office\/profile'\)/.test(ui) && /<BellButton light count=\{unread\}/.test(ui), 'the top bar: the bell with its count, the avatar opens My profile');

  const review = code('app/office/trip/review.tsx');
  for (const [what, ok] of [
    ['Send / Book now with Save as waiting', /<TripFooter/.test(review) && /office\.trip\.saveWaiting/.test(review) && /office\.trip\.bookNow/.test(review) && /office\.trip\.sendRequest/.test(review)],
    ['Back beside the primary', /onBack=\{\(\) => router\.back\(\)\}/.test(review)],
    ['the conflict cards: Open that task, Call, WhatsApp, Pick another, the holder', /office\.trip\.openThatTask/.test(review) && /office\.trip\.callName/.test(review) && /office\.trip\.whatsappName/.test(review) && /office\.trip\.pickAnotherDriver/.test(review) && /<HolderLine/.test(review)],
    ['ⓘ how it was planned', /<PlanInfo lines=/.test(review)],
    ['the driver with ✓ Checked and Change', /office\.ui3\.checked/.test(review) && /testID="review-change-driver"/.test(review)],
    ['who rides with Edit', /testID="review-edit-riders"/.test(review) && /<AvatarStack/.test(review)],
    ['the stepper and the facts', /<PlanStepper rows=\{rows\}/.test(review) && /<StatsRow variant="facts"/.test(review)],
    ['the map (both engines)', /<TaskMap report=\{false\} mapPackage=\{me\.map\?\.package\}/.test(review)],
  ] as const) check(ok, `Review: ${what}`);

  const req = code('app/office/request/[id].tsx');
  for (const [what, ok] of [
    ['Approve', /testID="approve-button"/.test(req) && /void decide\('approve'\)/.test(req)],
    ['Decline (the reason sheet)', /testID="decline-button"/.test(req) && /ReasonSheet<DeclineReasonKey>/.test(req)],
    ['Change time under ⋯', /testID="decide-change-time"/.test(req) && /pathname: '\/office\/request\/\[id\]\/time'/.test(req) && /testID="request-more"/.test(req)],
    ['Ask drivers (the link and ⋯)', /link=\{mayAsk && drivers\.length > 0 \? t\('office\.ask\.open'\) : undefined\}/.test(req) && /testID="request-ask-drivers"/.test(req)],
    ['Tell requester', /<TellRequester/.test(req)],
    ['Cancel booking, Edit, Withdraw', /testID="cancel-booking"/.test(req) && /testID="edit-request"/.test(req) && /testID="withdraw-request"/.test(req)],
    ['Request again', /testID="request-again"/.test(req)],
    ['Call and WhatsApp the requester', /testID="request-call"/.test(req) && /testID="request-whatsapp"/.test(req)],
    ['the best match first and Choose another', /testID="choose-another"/.test(req) && /<DriverChoiceRow/.test(req)],
    ['the banner, the facts, the stepper, the timeline', /<StatusBanner/.test(req) && /<StatsRow variant="facts"/.test(req) && /<PlanStepper rows=\{stepRows\}/.test(req) && /card\.events!\.map/.test(req)],
  ] as const) check(ok, `The request: ${what}`);

  const task = code('app/office/task/[id].tsx');
  for (const [what, ok] of [
    ['Change the task', /extras\.time && <Button/.test(task) && /pathname: '\/office\/task\/\[id\]\/time'/.test(task)],
    ['Give a driver / Reassign driver', /actions\.reassign && <Button/.test(task) && /office\.home\.giveDriver/.test(task) && /office\.task\.reassign/.test(task)],
    ['Change stops', /extras\.stops && <Button/.test(task) && /params: \{ mode: 'stops', id: task\.id \}/.test(task)],
    ['Swap vehicle', /extras\.swap && <Button/.test(task) && /pathname: '\/office\/task\/\[id\]\/swap'/.test(task)],
    ['Reopen (the reason sheet)', /extras\.reopen && <Button/.test(task) && /ReasonSheet<ReopenReasonKey>/.test(task)],
    ['Cancel task (the reason sheet)', /actions\.cancel && <Button/.test(task) && /ReasonSheet<CancelReasonKey>/.test(task)],
    ['Show the driven route and the plan', /pathname: '\/office\/task\/\[id\]\/route'/.test(task) && /pathname: '\/office\/task\/\[id\]\/plan'/.test(task)],
    ['Live map (the banner)', /office\.home\.liveMap/.test(task) && /pathname: '\/office\/\(tabs\)\/live'/.test(task)],
    ['Call and WhatsApp the driver', /<TaskDriverCard/.test(task)],
    ['the holder with Call and WhatsApp', /testID="task-holder-call"/.test(task) && /testID="task-holder-whatsapp"/.test(task) && /task\?\.holder/.test(task)],
    ['the passengers', /<PassengerRows list=\{task\.passengers_list\} \/>/.test(task)],
    ['the requester\'s Call', /office\.request\.callRequester/.test(task)],
    ['the asks line, the saved notice, More details', /<TaskAsksLink taskId=\{task\.id\} \/>/.test(task) && /<SavedNotice noticeKey=/.test(task) && /<TaskMoreDetails/.test(task)],
    ['the fuel card and the vehicle check', /<FuelCardSection/.test(task) && /<TaskCheckLines checks=\{task\.vehicle_checks\}/.test(task)],
    ['the map with the driver\'s position', /useTool<LiveDrivers>\('live_drivers'/.test(task) && /<TaskMap report=\{false\}/.test(task)],
    ['the bar and ⋯ More', /testID="task-more"/.test(task) && /plan\.more\.map/.test(task)],
  ] as const) check(ok, `The trip: ${what}`);
  const rows = code('components/office/DriverRows.tsx');
  check(/testID="task-driver-call"/.test(rows) && /testID="task-driver-whatsapp"/.test(rows), 'the driver card keeps Call and WhatsApp');
  const pax = code('components/office/Passengers.tsx');
  check(/testID="passenger-call"/.test(pax) && /testID="passenger-whatsapp"/.test(pax) && /testID="passenger-share"/.test(pax) && /<StatusBanner/.test(pax) && /<RouteStepper/.test(pax) && /<TaskDriverCard/.test(pax), 'the passenger\'s view: the banner, the driver with Call / WhatsApp, the stepper; a passenger\'s Call, WhatsApp, Share trip');
  const timeline = code('components/office/StopTimeline.tsx');
  check(/<RouteStepper/.test(timeline) && /timeline-times-\$\{i\}/.test(timeline) && /timeline-estimate-\$\{i\}/.test(timeline) && /timeline-confirmed-\$\{i\}/.test(timeline), 'the live timeline on the stepper with its words (planned, arrived, left, the estimate, confirmed later)');
}

console.log('\nThe shared patterns (components/patterns)');
{
  for (const f of ['TopBar.tsx', 'StatsRow.tsx', 'StatusBanner.tsx', 'RouteStepper.tsx', 'ListRow.tsx', 'BottomActionBar.tsx', 'NewTripFab.tsx', 'look.ts']) check(existsSync(join(src, 'components', 'patterns', f)), `components/patterns/${f}`);
  const ui = code('office/ui.tsx');
  check(/<ThinBar/.test(ui) && /<StatsRow/.test(ui) && /export const Row = ListRow;/.test(ui) && /<BottomActionBar>/.test(ui) && /<NewTripFab/.test(ui), 'office/ui.tsx wires them: TopBar / BackHeader on the thin bar, StatTiles on the stats row, Row is ListRow, StickyActions the bottom bar, NewTripButton the FAB');
  check(/<TopBar/.test(code('components/office/TripShell.tsx')) && /<BottomActionBar/.test(code('components/office/TripShell.tsx')), 'the trip editor\'s header and footer on the thin bar and the bottom bar');
  const stepper = code('components/patterns/RouteStepper.tsx');
  check(/sub\?: string/.test(stepper) && /subStruck/.test(stepper) && /compact/.test(stepper) && /live/.test(stepper), 'the stepper takes planned and actual times, a compact size and the live rail (general enough for the driver\'s screens)');
  check(!/elevation:/.test(['TopBar.tsx', 'StatsRow.tsx', 'StatusBanner.tsx', 'RouteStepper.tsx', 'ListRow.tsx', 'BottomActionBar.tsx', 'NewTripFab.tsx'].map((f) => code(`components/patterns/${f}`)).join('\n')), 'no bare elevation (web parity: shadow())');
}

console.log('\nThe design pages (src/design)');
{
  const pages = ['OfficeHome.tsx', 'OfficeReview.tsx', 'OfficeRequest.tsx', 'OfficeTrip.tsx'];
  const real: Record<string, RegExp> = { 'OfficeHome.tsx': /<OfficeHome \/>/, 'OfficeReview.tsx': /<TripReview \/>/, 'OfficeRequest.tsx': /<ApproveRequest \/>/, 'OfficeTrip.tsx': /<TaskDetailScreen \/>/ };
  for (const p of pages) {
    const s = code(`design/${p}`);
    check(/export default function/.test(s) && s.includes('testID="fleet-design-page"') && /<OfficeValueProvider value=\{value\}>/.test(s), `${p}: a default export, the marker, the sample office context`);
    check(/officeDesignLanguage\(params\.lang\)/.test(s) && /setLanguage\(language\)/.test(s) && real[p].test(s), `${p}: ?lang=si sets the language; the real screen`);
  }
  const exts = ['.web.tsx', '.web.ts', '.tsx', '.ts', '.json', '/index.web.tsx', '/index.web.ts', '/index.tsx', '/index.ts'];
  const res = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    if (existsSync(base) && /\.json$/.test(base)) return base;
    for (const e of exts) if (existsSync(base + e)) return base + e;
    return null;
  };
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = pages.map((f) => join(src, 'design', f));
  while (queue.length) {
    const f = queue.shift() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.json')) continue;
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/^(?!\s*(?:import|export)\s+type\s)(?:import|export)\b[^'"\n]*?(?:from\s+)?['"]([^'"]+)['"]/gm)) {
      const r = res(f, m[1]);
      if (r) queue.push(r);
      else if (!m[1].startsWith('.') && !m[1].startsWith('@/')) packages.add(m[1]);
    }
  }
  const files = [...seen].map((f) => f.slice(src.length + 1));
  const phoneOnly = files.filter((f) => /^sync\/|^lib\/photos\.ts$|^lib\/location\.ts$|^state\/app\.tsx$|^lib\/arrival\.ts$|^lib\/heartbeat|^lib\/push\.ts$|^lib\/locationTask\.ts$/.test(f));
  check(phoneOnly.length === 0 && files.length > 50, `the pages' browser graph (${files.length} files) has no phone-only module`, phoneOnly);
  check(!packages.has('expo-sqlite') && !packages.has('expo-task-manager') && !packages.has('react-native-maps') && !packages.has('@maplibre/maplibre-react-native'), 'no expo-sqlite, task manager or native map package', [...packages].filter((p) => /sqlite|task-manager|react-native-maps|maplibre-react/.test(p)));
  check(readdirSync(join(src, 'design')).includes('sampleOffice.ts') && !readdirSync(join(src, 'design')).includes('sampleOffice.tsx'), 'the sample answers are a .ts file (no page of their own)');
}

console.log('\nThe strings (en and si)');
{
  const used = new Set<string>();
  const files = ['app/office/(tabs)/index.tsx', 'app/office/trip/review.tsx', 'app/office/request/[id].tsx', 'app/office/task/[id].tsx', 'components/office/PlanStepper.tsx', 'components/office/Passengers.tsx', 'components/office/StopTimeline.tsx', 'office/ui.tsx', 'components/office/TripShell.tsx', 'components/office/DriverRows.tsx', 'components/office/MyTripParts.tsx'];
  for (const f of files) for (const m of code(f).matchAll(/'(office\.ui3\.[A-Za-z]+)'/g)) used.add(m[1]);
  const keys = [...used];
  const missing = keys.filter((k) => text('en', k) === null || text('si', k) === null);
  check(missing.length === 0 && keys.length >= 15, `every office.ui3 key the screens use is in both languages (${keys.length})`, missing);
  const all = Object.keys((lang.en.office as Tree).ui3 as Tree).map((k) => `office.ui3.${k}`);
  const unused = all.filter((k) => !used.has(k));
  check(unused.length === 0, 'no office.ui3 key left unused', unused);
  const ph = (x: string | null) => (x ?? '').match(/\{[a-z]+\}/gi)?.sort().join(',') ?? '';
  const differ = all.filter((k) => ph(text('en', k)) !== ph(text('si', k)));
  check(differ.length === 0, 'the same placeholders in both', differ);
  check(!/[෦-෯]/.test(all.map((k) => text('si', k)).join(' ')), 'Latin digits in Sinhala');
  // 390 px: a stats tile's label has about 75 px (13 pt: ~10 Sinhala letters), a fact's label about 80 px, a chip at most
  // 120 px (~16 letters at 13 pt), a bar button half the bar at 17 pt in two lines (~28 letters), a banner's title two
  // lines of 16 pt (~44 letters, the place excluded), a section's title one line of 17 pt (~30 letters).
  const fit: [string, number][] = [
    ['office.home.tileRoad', 10], ['office.home.tileFree', 10], ['office.home.tileGarage', 10],
    ['office.ui3.factDistance', 10], ['office.ui3.factDriving', 10], ['office.ui3.factBack', 10], ['office.ui3.factEnds', 10], ['office.ui3.factPeople', 10],
    ['office.ui3.checked', 16], ['office.ui3.checkProblem', 16], ['office.timeline.onTime', 16], ['office.passengers.tag', 16], ['office.chip.underWay', 16], ['office.chip.onDuty', 16],
    ['office.task.changeTime', 28], ['office.task.changeStops', 28], ['office.task.reassign', 28], ['office.home.giveDriver', 28], ['office.request.decline', 28], ['common.back', 28],
    ['office.trip.saveWaiting', 28], ['office.trip.bookNow', 28], ['office.trip.sendRequest', 28],
    ['office.request.waitingYourOk', 44], ['office.request.changedByRequester', 44], ['office.task.onTheWayNow', 44],
    ['office.home.needsYouNow', 30], ['office.home.requests', 30], ['office.home.attention', 30], ['office.home.needsDriver', 30], ['office.home.road', 30], ['office.home.tasks', 30], ['office.passengers.title', 30],
    ['office.ui3.chooseAnother', 30], ['office.ui3.howPlanned', 30], ['office.home.newTrip', 16],
  ];
  const long = fit.filter(([k, max]) => (text('si', k) ?? '').length > max).map(([k, max]) => `${k}: ${text('si', k)?.length} > ${max}`);
  check(long.length === 0, 'the Sinhala words of the tiles, facts, chips, bar buttons, banners and section titles fit their place at 390 px (letters counted)', long);
  const onTheWay = en('office.ui3.onTheWayTo', { place: 'Wariyapola' });
  check(onTheWay === 'On the way to Wariyapola' && en('office.ui3.arrivesAbout', { time: '10:52' }) === 'Arrives about 10:52', 'the banner\'s words');
}

console.log(failures === 0 ? '\nAll office-3 checks passed.' : `\n${failures} office-3 check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
