// Round 4–7, item 12 (design/mockups/2026-10-22, mockups 5 and 6) and §33.6 item 1, the driver app's side:
//   - what Today's card and the running sheet say (lib/todayCard.ts): the chip beside Next task (Leave in 25 min, Leave
//     now, 12 min late, Tomorrow, nothing under way), the stepper (S, the stops by number, B; the plan's times; four then
//     "Show all"), "3 people · 197 km", the rows' grey line and chip, "leave from …", the greeting, "Next stop · 2 of 3",
//     the stats (km left by road or in a straight line, arrive about, be there by);
//   - every key action of the two screens is still there (read as text): Today's Accept, Can't do this task / Can't make
//     it, Start task, Open task, Running late, Start a trip, the card opening the task, Call and every call with WhatsApp,
//     the rows, All today's tasks, the notices, the language pill, the tiles' Start work / Finish work / Change vehicle /
//     the vehicle check; the running task's Navigate, Call contact, the stops sheet (Skip, the out-of-order slides, Add a
//     stop, All stops in Google Maps, the odometer, the GPS km, passengers, calls, Approved by, Running late, Complete
//     task), the current stop's slide, Complete task, Log fuel, Problem with the vehicle, the arrival card, the swap card;
//   - the design pages (src/design): a default export each, the marker the deploy refuses, ?lang= and ?state=, and the
//     browser's import graph reaches no phone-only module (the queue's expo-sqlite has no web bundle: CI 39557478415);
//   - every new key in English and Sinhala (en.json / si.json, with src/i18n/parts/*.json merged in while they exist), the
//     same placeholders, Latin digits; the Sinhala words of the tiles, chips and buttons short enough for 390 px.
//
//   npx tsx scripts/test-driver-3.ts          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { durationText } from '../src/lib/durations';
import {
  backAtBaseTime,
  contactWithoutCall,
  greetingKey,
  leaveChip,
  leaveFromWords,
  openStop,
  peopleWords,
  rowChip,
  rowChipTone,
  rowMeta,
  sheetStats,
  stepperRows,
  stopPosition,
  todaySteps,
  tripKmText,
} from '../src/lib/todayCard';
import { colomboTime } from '../src/lib/time';
import type { TaskStop, TaskWithStops } from '../src/lib/types';

const src = join(__dirname, '..', 'src');
let failures = 0;
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
const code = (rel: string) => readFileSync(join(src, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// --- sample tasks -------------------------------------------------------------------------------------------------------
const MIN = 60_000;
const NOW = Date.parse('2026-10-22T02:30:00Z'); // 08:00 in Colombo
const iso = (ms: number) => new Date(ms).toISOString();
const stop = (over: Partial<TaskStop> & Pick<TaskStop, 'id' | 'seq' | 'place_name'>): TaskStop => ({
  task_id: 't', type: 'visit', status: 'pending', lat: null, lng: null, arrive_by: null, planned_arrive_at: null, planned_depart_at: null,
  is_start: false, google_place_id: null, ...over,
} as TaskStop);
const task = (over: Partial<TaskWithStops> = {}): TaskWithStops => ({
  id: 't', title: 'Team drop', kind: 'dispatch', status: 'assigned', start_at: iso(NOW + 25 * MIN), leave_by: iso(NOW + 25 * MIN), started_at: null,
  accepted_at: null, passengers: 3, return_to_base: true, start_name: 'Head office', plan_json: { total_km: 197, ends_at: iso(NOW + 380 * MIN) },
  task_stops: [
    stop({ id: 'a', seq: 1, type: 'pickup', is_start: true, place_name: 'Head office', planned_depart_at: iso(NOW + 25 * MIN) }),
    stop({ id: 'b', seq: 2, type: 'drop', place_name: 'Kurunegala site', planned_arrive_at: iso(NOW + 175 * MIN), arrive_by: iso(NOW + 190 * MIN) }),
    stop({ id: 'c', seq: 3, place_name: 'Kandy depot', planned_arrive_at: iso(NOW + 265 * MIN) }),
  ],
  ...over,
} as unknown as TaskWithStops);
const dayLabel = (at: string) => `day ${at.slice(0, 10)}`;

console.log('\nThe chip beside Next task (lib/todayCard.ts leaveChip)');
{
  check(same(leaveChip(en, task(), NOW, dayLabel), { text: 'Leave in 25 min', tone: 'amber' }), 'ahead: "Leave in 25 min" (amber)', leaveChip(en, task(), NOW, dayLabel));
  check(same(leaveChip(en, task({ leave_by: iso(NOW + 130 * MIN) }), NOW, dayLabel), { text: 'Leave in 2 h 10 min', tone: 'amber' }), 'in hours: "Leave in 2 h 10 min"');
  check(leaveChip(en, task({ leave_by: iso(NOW - 30_000) }), NOW, dayLabel)?.text === 'Leave now' && leaveChip(en, task({ leave_by: iso(NOW) }), NOW, dayLabel)?.text === 'Leave now', 'within the minute: "Leave now"');
  check(same(leaveChip(en, task({ leave_by: iso(NOW - 12 * MIN) }), NOW, dayLabel), { text: '12 min late', tone: 'red' }), 'passed: "12 min late" (red)');
  check(same(leaveChip(en, task({ leave_by: iso(NOW + 24 * 60 * MIN) }), NOW, dayLabel), { text: 'Tomorrow', tone: 'grey' }), 'tomorrow: "Tomorrow" (grey)');
  check(leaveChip(en, task({ leave_by: iso(NOW + 3 * 24 * 60 * MIN) }), NOW, dayLabel)?.text === 'day 2026-10-25', 'later: its day');
  check(leaveChip(en, task({ status: 'in_progress', started_at: iso(NOW - 5 * MIN) }), NOW, dayLabel) === null, 'under way: no chip (the card says when it started)');
  check(leaveChip(si, task(), NOW, dayLabel)?.text === 'මිනිත්තු 25 කින් පිටත් වන්න', 'Sinhala: "මිනිත්තු 25 කින් පිටත් වන්න", Latin digits', leaveChip(si, task(), NOW, dayLabel));
  check(leaveChip(en, task({ leave_by: null, start_at: iso(NOW + 40 * MIN) }), NOW, dayLabel)?.text === 'Leave in 40 min', 'no plan: the office\'s start time');
}

console.log('\nThe stepper (stepperRows)');
{
  const rows = stepperRows(task());
  check(same(rows.rows.map((r) => r.mark), ['S', '2', '3', 'B']), 'S, the stops by number, B', rows.rows.map((r) => r.mark));
  check(rows.rows[0].time === colomboTime(iso(NOW + 25 * MIN)) && rows.rows[1].time === colomboTime(iso(NOW + 175 * MIN)) && rows.rows[3].time === colomboTime(iso(NOW + 380 * MIN)),
    'the times: leaving the start, arriving at a stop, back at base (plan_json.ends_at)', rows.rows.map((r) => r.time));
  check(rows.rows[0].type === 'pickup' && rows.rows[1].type === 'drop' && rows.rows[2].type === null, 'pickup / drop said after the name; a visit says nothing');
  const noStart = stepperRows(task({ task_stops: task().task_stops.slice(1) }));
  check(same(noStart.rows.map((r) => r.mark), ['S', '1', '2', 'B']) && noStart.rows[0].name === 'Head office' && noStart.rows[0].stopId === null, 'no start stop: the task\'s start place as S, the stops 1, 2');
  const self = stepperRows(task({ kind: 'self', return_to_base: false, task_stops: task().task_stops.slice(1) }));
  check(same(self.rows.map((r) => r.mark), ['1', '2']), 'a trip of the driver\'s own: no S row, no B');
  const many = task({ return_to_base: false, task_stops: Array.from({ length: 7 }, (_, i) => stop({ id: `s${i}`, seq: i + 1, place_name: `P${i}` })) });
  check(stepperRows(many).rows.length === 4 + 1 && stepperRows(many).hidden === 3 && stepperRows(many, true).rows.length === 8, 'four stops then "Show all" (3 hidden); expanded: all (plus S)', stepperRows(many));
  const running = task({ status: 'in_progress', task_stops: [{ ...task().task_stops[0], status: 'done' }, ...task().task_stops.slice(1)] });
  const r = stepperRows(running).rows;
  check(r[0].passed && !r[1].passed && r[1].current && !r[2].current, 'under way: the start ticked, the next stop marked');
  check(stepperRows(task({ task_stops: [...task().task_stops, stop({ id: 'x', seq: 4, place_name: 'Gone', status: 'removed' })] })).total === 3, 'a removed stop is shown nowhere');
  check(backAtBaseTime(null) === null && backAtBaseTime({ ends_at: 'x' }) === null, 'no plan: no back-at-base time');
}

console.log('\nThe stepper on the one route stepper (todaySteps → components/patterns/RouteStepper.tsx)');
{
  const { steps, showAllAfter, total, google } = todaySteps(en, task());
  check(same(steps.map((s) => `${s.mark}:${s.kind}:${s.title}`), ['S:start:Head office · pickup', '2:stop:Kurunegala site · drop', '3:stop:Kandy depot', 'B:back:Back at base']),
    'S, the stops by number (pickup / drop after the name, a visit says nothing), B "Back at base"', steps.map((s) => `${s.mark}:${s.kind}:${s.title}`));
  check(same(steps.map((s) => s.time), stepperRows(task()).rows.map((r) => r.time ?? undefined)), 'the plan\'s time on each row, as stepperRows has it');
  check(same(steps.map((s) => s.chip), [null, { text: `by ${colomboTime(iso(NOW + 190 * MIN))}`, tone: 'amber' }, null, null]), 'a stop\'s deadline: "by HH:MM", the row\'s amber chip', steps.map((s) => s.chip));
  check(steps[0].accessibilityLabel === `Start · passengers get in here, Head office · pickup, ${colomboTime(iso(NOW + 25 * MIN))}` && steps[3].accessibilityLabel === `Back at base, ${colomboTime(iso(NOW + 380 * MIN))}`, 'what a screen reader says for a row (as before)', steps.map((s) => s.accessibilityLabel));
  check(showAllAfter === null && total === 3 && google === false && steps.every((s) => s.state === 'todo'), 'three stops: all shown, no Google credit, nothing behind the driver yet');
  const running = task({ status: 'in_progress', task_stops: [{ ...task().task_stops[0], status: 'done' }, { ...task().task_stops[1], status: 'skipped' }, ...task().task_stops.slice(2)] });
  const r = todaySteps(en, running).steps;
  check(same(r.map((s) => s.state), ['passed', 'passed', 'current', 'todo']) && r[1].chip === null, 'under way: the stops behind the driver passed (no deadline chip), the one driven to current', r.map((s) => s.state));
  const many = task({ task_stops: Array.from({ length: 7 }, (_, i) => stop({ id: `s${i}`, seq: i + 1, place_name: `P${i}`, google_place_id: i === 5 ? 'g' : null })) });
  const four = todaySteps(en, many);
  check(four.steps.length === 1 + 4 + 1 && four.showAllAfter === 4 && four.total === 7 && four.steps[4].mark === '4' && four.steps[5].mark === 'B', '"Show all 7 stops" under the fourth stop, before Back at base', { n: four.steps.length, after: four.showAllAfter });
  const all = todaySteps(en, many, true);
  check(all.steps.length === 1 + 7 + 1 && all.showAllAfter === null && all.google, 'expanded: every stop, no link; a Google place: the credit');
  const si3 = todaySteps(si, task()).steps;
  check(si3[3].title === si('todayCard.backAtBase') && si3[0].title === `Head office · ${si('todayCard.pickup')}` && si3[1].chip?.text === si('preview.arriveBy', { time: colomboTime(iso(NOW + 190 * MIN)) }), 'in Sinhala: the words, the place as written, Latin digits');
}

console.log('\nPeople, km, the rows');
{
  check(peopleWords(en, 3) === '3 people' && peopleWords(en, 1) === '1 person' && peopleWords(en, 0) === null && peopleWords(en, null) === null, '"3 people", "1 person", none');
  check(peopleWords(si, 3) === '3 දෙනෙක්', 'Sinhala, Latin digits');
  check(tripKmText({ total_km: 197 }) === '197' && tripKmText({ legs: [{ km: 2.1 }, { km: 2 }] }) === '4.1' && tripKmText(null) === null, 'the plan\'s km (or its legs), none without a plan');
  check(rowMeta(en, task()) === '3 people · 197 km · From Head office', 'a row: "3 people · 197 km · From Head office"', rowMeta(en, task()));
  check(rowMeta(en, task({ passengers: null, plan_json: null })) === 'From Head office', 'nothing known but the start: "From Head office" (as before)');
  check(rowMeta(en, task({ kind: 'self', passengers: null, plan_json: null })) === 'Kandy depot', 'a trip of the driver\'s own: where it goes');
  check(same(rowChip(en, task()), { text: 'Not accepted yet', tone: 'amber' }) && same(rowChip(en, task({ accepted_at: iso(NOW) })), { text: 'Accepted', tone: 'green' })
    && same(rowChip(en, task({ status: 'in_progress' })), { text: 'In progress', tone: 'blue' }), 'the rows\' chip: Not accepted yet, Accepted, In progress');
  check(leaveFromWords(en, task()) === 'leave from Head office' && leaveFromWords(en, task({ start_name: null, task_stops: [] })) === 'leave', '"leave from Head office", else "leave"');
  check(leaveFromWords(si, task()) === 'Head office සිට පිටත් වන්න', 'Sinhala: the place first');
  check(greetingKey(7) === 'todayCard.goodMorning' && greetingKey(12) === 'todayCard.goodAfternoon' && greetingKey(18) === 'todayCard.goodEvening', 'Good morning / afternoon / evening');
}

console.log('\nThe running sheet');
{
  const running = task({ status: 'in_progress', task_stops: [{ ...task().task_stops[0], status: 'done' }, ...task().task_stops.slice(1)] });
  const open = openStop(running.task_stops);
  check(open?.id === 'b' && same(stopPosition(running, open?.id), { n: 2, total: 3 }), '"Next stop · 2 of 3"');
  check(openStop(running.task_stops.map((s) => ({ ...s, status: 'done' }))) === null, 'every stop done: none (Complete task)');
  const k = (n: number) => (n < 9.95 ? n.toFixed(1) : String(Math.round(n)));
  const road = sheetStats(open, 42.3, 30, null, k);
  check(same(road.km, { text: '42', kind: 'road' }) && road.about === colomboTime(iso(NOW + 175 * MIN)) && road.by === colomboTime(iso(NOW + 190 * MIN)), 'by road, the plan\'s arrival, the deadline', road);
  const straight = sheetStats(open, null, 3.04, '10:52', k);
  check(same(straight.km, { text: '≈ 3.0', kind: 'straight' }) && straight.about === '10:52', 'no road km: the straight line; the re-estimate wins', straight);
  check(sheetStats(open, null, null, null, k).km === null, 'neither: "–"');
  check(sheetStats({ ...open!, status: 'arrived' }, 0, null, null, k).about === null, 'at the stop: no "arrive about"');
  check(en('taskSheet.nextStop', { n: 2, total: 3 }) === 'Next stop · 2 of 3' && si('taskSheet.nextStop', { n: 2, total: 3 }) === 'ඊළඟ නැවතුම · 3 න් 2', 'the words, both languages');
}

console.log('\nToday keeps every action (read as text)');
{
  const today = code('app/(tabs)/index.tsx');
  const duty = code('components/DutyCard.tsx');
  const rows = code('components/TaskRows.tsx');
  const has = (s: string, re: RegExp) => re.test(s);
  check(has(today, /onPress=\{\(\) => app\.acceptTask\(next\)\}/) && has(today, /t\('task\.accept'\)/), 'Accept');
  check(has(today, /!isSelfTrip\(next\) && decline && <Button kind="danger-text" label=\{t\(decline\)\} onPress=\{\(\) => setDeclining\(next\)\}/) && has(today, /<DeclineSheet task=\{declining\}/), "Can't do this task / Can't make it (the reasons sheet); never on a trip of the driver's own");
  check(has(today, /t\(next\.status === 'in_progress' \? 'today\.openTask' : 'today\.startTask'\)/) && has(today, /pathname: '\/log-mileage', params: \{ mode: 'start', taskId: next\.id, from: 'today' \}/) && has(today, /app\.requireLocation\('start'/), 'Start task (Location first) / Open task');
  check(has(today, /next\.accepted_at && canReportLate\(next\) && <RunningLate task=\{next\} \/>/) && has(today, /t\('task\.accepted', \{ time: colomboTime\(next\.accepted_at\) \}\)/), 'Running late and "Accepted ✓ 08:02"');
  check(has(today, /onPress=\{openCard\}/) && has(today, /pathname: '\/task\/\[id\]', params: \{ id: next\.id \}/), 'the card opens the whole task');
  check(has(today, /taskCalls\(next, app\.taskContacts\[next\.id\] \?\? null\)/) && has(today, /Linking\.openURL\(firstCall\.tel\)/) && has(today, /<CallButtons calls=\{calls\} \/>/), 'Call the first person; ⋯ every call with WhatsApp');
  check(has(today, /app\.sharing && !running && \(\s*<Button [^\n]*t\('trip\.start'\)[^\n]*router\.push\('\/start-trip'\)/), 'Start a trip (on duty, nothing under way)');
  check(has(today, /<TaskList title=\{t\('todayCard\.laterToday', \{ n: lists\.laterToday\.length \}\)\} tasks=\{shownToday\} \/>/) && has(today, /<TaskList title=\{t\('today\.upcoming'\)\} tasks=\{shownUpcoming\} showDate \/>/), '"Later today · N" and Coming up');
  check(has(today, /router\.push\('\/today-tasks'\)/) && has(today, /t\('today\.moreLater', \{ n: moreToday \}\)/), "All today's tasks, with \"N more later today\"");
  check(['common.savedOffline', 'today.offlineWaiting', 'ask.banner', 'ask.answer'].every((k) => today.includes(`t('${k}'`)) && /<DutyNotices \/>/.test(today) && /<TrackingNotice \/>/.test(today) && /app\.tripProblem && \(/.test(today) && /app\.notice && \(/.test(today),
    'the notices: offline, the duty notices, the notice, a refused trip, the tracking notice, the office\'s question, the points waiting');
  check(has(today, /<LanguagePill light \/>/) && has(today, /RefreshControl refreshing=\{app\.refreshing\} onRefresh=\{refresh\}/), 'the language pill and pull to refresh');
  check(has(today, /namesLine\(t, next\.task_passengers, app\.settings\.passengers\)/) && has(today, /testID="today-riders"/), 'the riders\' names');
  check(has(today, /vehicleWords\(t, vehicleLine\(next, app\.vehicles\)\)/) && has(today, /<Plate regNo=\{nextVehicle\.reg_no\} \/>/), 'the task\'s vehicle (when not the one held) or "Your vehicle on the day"');
  check(has(today, /waitingTasks\.has\(next\.id\)/) && has(today, /swapCard\(next\)/) && has(today, /<ChangedTag \/>/) && has(today, /t\('today\.nextStopAbout'/), 'Not sent yet, the vehicle swap, Changed, the next stop\'s "about"');
  check(has(duty, /Alert\.alert\(t\('duty\.finishConfirm'\)/) && has(duty, /onPress=\{confirmFinish\}/) && has(duty, /disabled=\{taskRunning\}/), 'the duty switch: Finish work, asked first; not while a task runs');
  check(has(duty, /pathname: '\/vehicle', params: \{ mode: 'start' \}/) && has(duty, /testID="duty-start-work"/) && has(duty, /t\('duty\.offDutyHint'\)/), 'off duty: Start work (the vehicle picker) and its hint');
  check(has(duty, /pathname: '\/vehicle', params: \{ mode: sharing \? 'change' : 'start' \}/) && has(duty, /disabled=\{!canChoose\}/), 'Change vehicle (not while a task holds it)');
  check(has(duty, /pathname: '\/vehicle-check', params: \{ vehicleId: held\.id, how: heldHow\(held\.id\) \}/) && has(duty, /t\('todayCard\.checkNeeded'\)/) && has(duty, /todayCard\.checked/), 'the vehicle check: Check needed opens it; ✓ Checked');
  check(has(duty, /t\('duty\.finishTaskFirst'\)/) && has(duty, /t\('todayCard\.since', \{ time: colomboTime\(dutySince\) \}\)/) && has(duty, /t\('duty\.officeCanSee'\)/), '"since 08:12 · Office can see you" and "Finish the task first."');
  check(has(rows, /pathname: '\/task\/\[id\]', params: \{ id: task\.id \}/) && has(rows, /<ChangedTag \/>/) && has(rows, /<GoogleCredit/) && has(rows, /showDate &&/), 'the rows: open the task, Changed, the Google credit, the date on Coming up');
  // One stepper in the app (Round 4–7 unify): the card's stops are drawn by the route stepper, never by a stepper of its own.
  check(has(today, /<NextStops task=\{next\} \/>/) && has(today, /todaySteps\(t, task, expanded\)/) && has(today, /<RouteStepper rows=\{rows\} timeSide="right" compact framed=\{false\} testID="stop-stepper" \/>/)
    && has(today, /onPress=\{\(\) => setExpanded\(true\)\}[^\n]*testID="stepper-show-all"/) && has(today, /<GoogleCredit show=\{google\} \/>/), 'Today\'s stops on the one route stepper (compact, the time on the right), Show all N stops, the Google credit');
  const stopStepper = readdirSync(src, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && /\bStopStepper\b/.test(code(f)));
  check(stopStepper.length === 0, 'StopStepper is gone (no file draws or names it)', stopStepper);

  // Review of Round 4–7: a contact with a name and no number was gone from the card; one chip, one plate, one row, one stepper.
  check(contactWithoutCall({ contact_name: 'Ashan W.' }, []) === 'Ashan W.' && contactWithoutCall({ contact_name: 'Ashan W.' }, [{ kind: 'requester' }]) === 'Ashan W.'
    && contactWithoutCall({ contact_name: 'Ashan W.' }, [{ kind: 'contact' }, { kind: 'office' }]) === null && contactWithoutCall({ contact_name: ' ' }, []) === null && contactWithoutCall({ contact_name: null }, []) === null,
    'a contact with no number (or none that can be dialled) is named on the card; one with a call is the call link');
  check(has(today, /const contactName = next \? contactWithoutCall\(next, calls\) : null;/) && has(today, /\{contactName && <Fact [^\n]*text=\{t\('today\.contact', \{ name: contactName \}\)\} testID="today-contact" \/>\}/),
    'Today: "Contact: Ashan W." in the facts, no call link');
  const toneChip = readdirSync(src, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && /\bToneChip\b/.test(code(f)));
  check(toneChip.length === 0 && !existsSync(join(src, 'components', 'ToneChip.tsx')), 'ToneChip is gone: the status chips are the one RowChip', toneChip);
  check(rowChipTone('grey') === 'muted' && rowChipTone('amber') === 'amber' && has(today, /<RowChip text=\{chip\.text\} tone=\{rowChipTone\(chip\.tone\)\} wide testID="next-task-chip" \/>/)
    && has(rows, /lineChip=\{chip \? \{ text: chip\.text, tone: rowChipTone\(chip\.tone\) \} : null\}/), 'Next task\'s chip and the rows\' chips are RowChip (grey is its muted)');
  check(has(duty, /<Plate regNo=\{held\.reg_no\} \/>/) && !/plateText/.test(duty), 'the vehicle tile\'s plate is the shared Plate');
  check(has(rows, /<ListRow\b/) && /<ListRow\b/.test(code('components/LogRows.tsx')) && /<ListRow\b/.test(code('components/ReportRows.tsx')), 'the task rows, the fill and reading rows and the reports are the one list row');
  const taskParts = code('components/task.tsx');
  check(/<RouteStepper rows=\{rows\} framed=\{false\} testID="stop-timeline" \/>/.test(taskParts) && !/styles\.(dot|rail)\b/.test(taskParts), 'the preview\'s and the finished task\'s stops are on the one route stepper (no rail or dots of their own)');
}

console.log('\nThe running task keeps every function (read as text)');
{
  const screen = code('app/task/[id].tsx');
  const has = (re: RegExp) => re.test(screen);
  check(has(/testID="task-navigate"/) && has(/Linking\.openURL\(navigate\)/) && has(/navigateLink\(\{ lat: target\.lat/), 'Navigate (Google Maps to the stop)');
  check(has(/testID="task-call"/) && has(/telLink\(task\.contact_phone\)/), 'Call contact');
  check(has(/onPress=\{\(\) => setStopsOpen\(true\)\}/) && has(/<Sheet visible=\{stopsOpen\} title=\{t\('task\.stops'\)\}/), 'the stops button opens the stops sheet');
  check(has(/<ArrivalButton key=\{stop\.id\} stop=\{stop\} here=\{here\} last=\{stop\.id === lastId\} onFinish=\{finishTask\} short \/>/), 'the current stop\'s slide (arrive, the override, leave, finish)');
  check(has(/lastOpen === null && \(/) && has(/onPress=\{\(\) => finishTask\(\)\}/) && has(/disabled=\{lastOpen !== null\}/) && has(/t\('complete\.needsLastStop'\)/), 'Complete task (on the sheet once the last stop is done; in the stops sheet, waiting for it)');
  check(has(/app\.fillOnWay\(task\) && \(/) && has(/params: \{ mode: 'fuel', taskId: task\.id \}/), 'Fill up on the way · Log fuel');
  check(has(/pathname: '\/report-problem', params: \{ taskId: task\.id, \.\.\.\(task\.vehicle_id \? \{ vehicleId: task\.vehicle_id \} : \{\}\) \}/) && has(/t\('taskSheet\.problem'\)/), 'Problem with the vehicle (the task and its vehicle)');
  check(has(/fromSheet\(\(\) => setSkipping\(item\)\)/) && has(/<SkipSheet stop=\{skipping\}/) && has(/slides\.leave\(item\)/) && has(/slides\.arrive\(item, nearHere\)/), 'the stops sheet: Skip (its reasons), the out-of-order slides');
  check(has(/canAddStop\(task\) && \(/) && has(/pathname: '\/add-stop'/) && has(/allStops && <Button kind="outline" icon=\{MapPin\} label=\{t\('task\.allStops'\)\} onPress=\{openAllStops\} \/>/), 'Add a stop (a trip of the driver\'s own), All stops in Google Maps');
  check(has(/t\('task\.startOdo'\)/) && has(/t\('tracking\.gpsKm'\)/) && has(/<PassengerList task=\{task\} \/>/) && has(/<CallButtons calls=\{calls\} callHidden=\{\['contact'\]\} \/>/) && has(/<ApprovedLine /) && has(/canReportLate\(task\) && <RunningLate task=\{task\} \/>/),
    'the odometer, the GPS km, the passengers, every call with WhatsApp, Approved by, Running late');
  check(has(/<GeofenceCard task=\{task\} here=\{here\} onSkip=\{setSkipping\} \/>/) && has(/<SwapCard task=\{task\} \/>/) && has(/<TrackingNotice \/>/) && has(/app\.tripProblem && \(/), 'the arrival card, the swap card, the tracking notice, a refused trip');
  check(has(/<TaskMap task=\{task\} me=\{me\} googleNoteFor="current" \/>/) && has(/lineNote\(task, engine === 'google'\)/), 'the map (both engines, its fallbacks) and its line note');
  check(has(/app\.startWork\(task\.vehicle_id\)/) && has(/t\('task\.notSharing'\)/) && has(/t\('todayCard\.inProgress'\)/), 'the pill: "In progress since …"; off duty in red, a tap starts work');
  check(has(/if \(task\.status === 'assigned'\) return <TaskPreview task=\{task\} \/>/) && has(/t\('task\.backToToday'\)/) && has(/<StopTimeline stops=\{task\.task_stops\} \/>/), 'still to start: the preview; finished: the stops and Back to Today');
  check(has(/setTaskOnScreen\(id\)/) && has(/useHere\(running && !design\)/), 'the background arrival notification stays quiet while the screen is in front; the phone\'s own position');
}

console.log('\nThe design pages (src/design)');
{
  for (const page of ['DriverToday.tsx', 'DriverTask.tsx']) {
    const s = readFileSync(join(src, 'design', page), 'utf8');
    check(/export default function/.test(s) && s.includes('testID="fleet-design-page"') && /<AppValueProvider value=\{value\}>/.test(s), `${page}: a default export, the marker, the sample state`);
    check(/designLanguage\(params\.lang\)/.test(s) && /setLanguage\(language\)/.test(s), `${page}: ?lang=si sets the language`);
  }
  check(/<TodayScreen \/>/.test(readFileSync(join(src, 'design', 'DriverToday.tsx'), 'utf8')) && /<TaskView id="t-sample-1" design=\{design\} \/>/.test(readFileSync(join(src, 'design', 'DriverTask.tsx'), 'utf8')), 'the real screens, not copies');
  // Round 4–7, item 12: the office's four design pages (Office*.tsx) sit beside the driver's two.
  check(readdirSync(join(src, 'design')).filter((n) => /^Driver.*\.tsx$/.test(n)).length === 2 && !readdirSync(join(src, 'design')).includes('sampleDriver.tsx'), 'two pages (sampleDriver.ts is not one: only .tsx become routes)');
  // The browser's import graph (a .web file wins, as Metro picks it): never the queue, lib/photos, lib/location or the
  // phone's state.
  const exts = ['.web.tsx', '.web.ts', '.tsx', '.ts', '/index.web.tsx', '/index.web.ts', '/index.tsx', '/index.ts'];
  const res = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? join(src, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const e of exts) if (existsSync(base + e)) return base + e;
    return null;
  };
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = ['design/DriverToday.tsx', 'design/DriverTask.tsx'].map((f) => join(src, f));
  while (queue.length) {
    const f = queue.shift() as string;
    if (seen.has(f)) continue;
    seen.add(f);
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
}

console.log('\nThe strings (en and si)');
{
  const used = new Set<string>();
  for (const f of ['app/(tabs)/index.tsx', 'app/task/[id].tsx', 'components/DutyCard.tsx', 'components/TaskRows.tsx', 'components/task.tsx', 'components/ArrivalButton.tsx', 'components/TabBarView.tsx', 'lib/todayCard.ts', 'components/office/DayRoute.tsx', 'office/driversLogic.ts', 'components/RouteMap.tsx', 'components/RouteMap.web.tsx']) {
    if (!existsSync(join(src, f))) continue;
    for (const m of code(f).matchAll(/t\('((?:todayCard|taskSheet|dayRoute)\.[A-Za-z.]+)'/g)) used.add(m[1]);
  }
  const keys = [...used];
  const missing = keys.filter((k) => text('en', k) === null || text('si', k) === null);
  check(missing.length === 0 && keys.length >= 30, `every new key the screens use is in both languages (${keys.length})`, missing);
  const ph = (x: string | null) => (x ?? '').match(/\{[a-z]+\}/gi)?.sort().join(',') ?? '';
  const differ = keys.filter((k) => ph(text('en', k)) !== ph(text('si', k)));
  check(differ.length === 0, 'the same placeholders in both', differ);
  check(!/[෦-෯]/.test(keys.map((k) => text('si', k)).join(' ')), 'Latin digits in Sinhala');
  // 390 px: a tile's text column is about 146 px, a chip shares a 358 px row with its heading. Sinhala letters run about
  // 7–8 px at 12 pt: a tile's line of 12 pt words holds about 20 letters (two lines allowed), a chip about 30.
  const fit: [string, number][] = [
    ['todayCard.checked', 18], ['todayCard.checkNeeded', 18], ['todayCard.checkProblem', 20], ['todayCard.leaveNow', 30], ['todayCard.nextTask', 24],
    ['todayCard.inProgress', 24], ['taskSheet.leftApprox', 28], ['taskSheet.arriveAbout', 28], ['taskSheet.beThereBy', 28], ['taskSheet.slideArrive', 40],
    ['taskSheet.slideLeave', 40], ['taskSheet.problem', 40], ['duty.startWork', 20], ['duty.offDuty', 20], ['today.sharing', 20], ['duty.officeCanSee', 40],
  ];
  const long = fit.filter(([k, max]) => (text('si', k) ?? '').length > max).map(([k, max]) => `${k}: ${text('si', k)?.length} > ${max}`);
  check(long.length === 0, 'the Sinhala words of the tiles, chips, stats and the slide fit their place at 390 px (letters counted)', long);
  check(en('dur.late', { dur: durationText(en, 12) }) === '12 min late', 'the late chip uses the one duration formatter');
}

console.log(failures === 0 ? '\nAll driver-3 checks passed.' : `\n${failures} driver-3 check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
