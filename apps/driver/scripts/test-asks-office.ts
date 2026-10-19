// Office mode (Phase 8, O2): Ask drivers (design 13), the rules of src/office/askLogic.ts with made-up availability, board
// and ask_answers rows, and how the sheet and the three screens that open it are wired (read as text), without a phone.
// The strings live in src/i18n/parts/drivers.json until the lead merges them: this script reads no sidecar, and checks
// en.json only for the keys the sheet reuses. Pure code, no stack needed:
//   npm run test:asks-office          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  allFree, answerLabel, answerOf, ANSWERS_EVERY_MS, ASK_KINDS, askInput, askTargets, askTargetsFromBoard, canSend, keepPolling, mergeRows, preticked, questionText, sendLabel, toggled,
  tripWindowOk, windowText, type Words,
} from '../src/office/askLogic';
import type { Ask, AskDriverRow, AvailableDriver, BoardDriver } from '../src/office/types';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The words as "key(var,var)": the test reads which key was asked with what. */
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

const avail = (over: Partial<AvailableDriver> & Pick<AvailableDriver, 'name'>): AvailableDriver =>
  ({ state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true, ...over }) as AvailableDriver;

const kamal = avail({ name: 'Kamal', username: 'kamal', match_why: 'On duty · free all day', phone: { phone: '+94770000001', phone_display: '077 000 0001', call: 'tel:+94770000001', whatsapp: 'https://wa.me/94770000001' } });
const ruwan = avail({ name: 'Ruwan', username: 'ruwan', status_text: 'On duty · free till 13:00' });
const nimal = avail({ name: 'Nimal', username: 'nimal', state: 'off_duty', status_text: 'Off duty', free: false });
const sunil = avail({ name: 'Sunil', username: 'sunil', state: 'on_task', status_text: 'On a task till 10:40', free: false, current_task: { title: 'Team drop' } });
const piyal = avail({ name: 'Piyal', username: 'piyal', free: true, not_available: 'Not available · leave' });
/** No account: an office person who drives (no username). */
const asela = avail({ name: 'Asela', username: null, free: true });
const all = [kamal, ruwan, nimal, sunil, piyal, asela];

console.log('\n== The rows the sheet lists ==');
{
  const rows = askTargets(all);
  check(rows.length === 6 && rows[0].name === 'Kamal' && rows[0].username === 'kamal' && rows[0].free && rows[0].call === 'tel:+94770000001', 'a free driver with a number: ticked first, Call known', rows[0]);
  check(rows[0].line === 'On duty · free all day', 'the line: the best-match reasons when ranked', rows[0].line);
  check(rows[3].line === 'On a task till 10:40 · Team drop' && !rows[3].free, 'on a task: the status and the task, not free', rows[3].line);
  check(rows[4].line === 'Not available · leave' && !rows[4].free, 'a not-available driver is never free for the question, whatever `free` says', rows[4]);
  check(rows[5].username === null && rows[5].call === undefined, 'no account: null username, no Call');
  const board = askTargetsFromBoard([
    { name: 'Sunil', username: 'sunil', status: { kind: 'on_task', text: 'On a task till 10:40 · Team drop' }, free_now: false, licence: { chip: 'ok' }, links: { call: 'tel:+9477' } },
    { name: 'Kamal', username: 'kamal', status: { kind: 'on_duty', text: 'On duty · free all day · 0 tasks' }, free_now: true, licence: { chip: 'ok' } },
  ] as BoardDriver[]);
  check(board[0].line === 'On a task till 10:40 · Team drop' && !board[0].free && board[0].call === 'tel:+9477' && board[1].free && board[1].call === undefined,
    'from the board: the server\'s status words, free_now, the Call link', board);
}

console.log('\n== Who is ticked ==');
{
  const rows = askTargets(all);
  check(same(preticked(rows), ['kamal', 'ruwan']), 'free drivers with an account are ticked first (never the not-available one, never one without an account)', preticked(rows));
  check(same(preticked(rows, ['nimal', 'ghost']), ['nimal']), 'the caller\'s list wins, unknown names dropped', preticked(rows, ['nimal', 'ghost']));
  check(same(preticked(rows, []), ['kamal', 'ruwan']), 'an empty list from the caller: the free ones');
  check(same(allFree(rows), ['kamal', 'ruwan']), '"All free"');
  check(same(toggled(['kamal'], rows, 'nimal'), ['kamal', 'nimal']) && same(toggled(['kamal', 'nimal'], rows, 'kamal'), ['nimal']), 'a tick toggles');
  check(same(toggled(['kamal'], rows, 'asela'), ['kamal']) && same(toggled(['kamal'], rows, 'nobody'), ['kamal']), 'a driver without an account, or unknown, is never ticked');
}

console.log('\n== The window under "Free for a trip?" ==');
{
  const day = (d: string) => `day(${d})`;
  check(windowText({ date: '2026-10-20', from: '07:24', to: '15:40', note: 'Kurunegala' }, day) === 'day(2026-10-20) · 07:24–15:40 · Kurunegala', 'Tue 20 Oct · 07:24–15:40 · Kurunegala');
  check(windowText({ date: '2026-10-20', from: '07:24' }, day) === 'day(2026-10-20) · 07:24', 'no end: the from alone');
  check(windowText({ date: '2026-10-20' }, day) === 'day(2026-10-20)' && windowText({}, day) === null, 'the day alone; nothing known: null');
  check(tripWindowOk({ date: '2026-10-20', from: '07:24' }) && tripWindowOk({ date: '2026-10-20', from: '07:24', to: '15:40' }), 'a trip question needs the day and the from (to optional)');
  check(!tripWindowOk({ date: '2026-10-20' }) && !tripWindowOk({ from: '07:24' }) && !tripWindowOk({ date: '2026-10-20', from: '7:24' }) && !tripWindowOk({ date: '2026-10-20', from: '09:00', to: '08:00' }),
    'no day, no from, a bad time, or to before from: not sendable');
  check(!canSend('free_for_trip', [], { date: '2026-10-20', from: '09:00' }) && canSend('free_for_trip', ['kamal'], { date: '2026-10-20', from: '09:00' })
    && !canSend('free_for_trip', ['kamal'], { date: '2026-10-20' }) && canSend('where_now', ['kamal'], {}) && canSend('office_time', ['kamal'], {}),
    'Send: someone ticked; a trip question also its window; the other two need nothing more');
}

console.log('\n== The ask_drivers input ==');
{
  const ctx = { date: '2026-10-20', from: '07:24', to: '15:40', note: '  Kurunegala  ', task_id: 't1', request_id: 'r1' };
  check(same(askInput('free_for_trip', ['kamal', 'ruwan'], ctx), { kind: 'free_for_trip', drivers: ['kamal', 'ruwan'], date: '2026-10-20', from: '07:24', to: '15:40', note: 'Kurunegala', task_id: 't1', request_id: 'r1' }),
    'a trip question: the kind, the drivers, the window, the note trimmed, the links', askInput('free_for_trip', ['kamal', 'ruwan'], ctx));
  check(same(askInput('where_now', ['kamal'], ctx), { kind: 'where_now', drivers: ['kamal'], note: 'Kurunegala', task_id: 't1', request_id: 'r1' }), 'Where are you?: no window sent');
  check(same(askInput('office_time', ['kamal'], { note: '' }), { kind: 'office_time', drivers: ['kamal'] }), 'an empty note is left out; never all_free (the sheet names the drivers)');
  check((askInput('office_time', ['kamal'], { note: 'x'.repeat(400) }).note as string).length === 300, 'the note at most 300');
  check(same(ASK_KINDS, ['free_for_trip', 'office_time', 'where_now']), 'the three questions in the design\'s order');
}

console.log('\n== The answer line per row ==');
{
  const row = (over: Partial<AskDriverRow> & Pick<AskDriverRow, 'name'>): AskDriverRow => ({ sent: '09:00', state: 'sent', ...over });
  const yes = answerOf(row({ name: 'Kamal', username: 'kamal', state: 'answered', answer: 'yes', answered: '09:14' }));
  check(yes.key === 'yes' && yes.tone === 'green' && yes.time === '09:14' && yes.use, 'Yes · 09:14, green, Use offered', yes);
  check(answerLabel(yes, t) === 'office.ask.yesAt(09:14)', 'the chip: "Yes · 09:14"');
  check(!answerOf(row({ name: 'X', state: 'answered', answer: 'yes', answered: '09:14' })).use, 'a Yes from a row without a username: no Use');
  check(!answerOf(row({ name: 'X', username: 'x', state: 'answered', answer: 'yes', answered: '09:14', assignable: false })).use, 'a Yes the server says is not assignable (the trip started): no Use');
  const no = answerOf(row({ name: 'Ruwan', username: 'ruwan', state: 'answered', answer: 'no', answered: '09:20' }));
  check(no.key === 'no' && no.tone === 'red' && !no.use && answerLabel(no, t) === 'office.ask.noAt(09:20)', 'No · 09:20, red');
  const call = answerOf(row({ name: 'Nimal', username: 'nimal', state: 'answered', answer: 'call_me', answered: '09:21', links: { call: 'tel:+9477' } }));
  check(call.key === 'callMe' && call.tone === 'amber' && call.call === 'tel:+9477' && answerLabel(call, t) === 'office.ask.callMe', 'Call me, amber, with the Call link', call);
  check(answerOf(row({ name: 'N', state: 'answered', answer: 'call_me' })).call === undefined, 'Call me without a number: no Call button');
  const time = answerOf(row({ name: 'P', username: 'p', state: 'answered', answer: 'time', answer_text: 'At the office at 10:30', answer_time: '10:30', answered: '09:22' }));
  check(time.key === 'time' && time.tone === 'blue' && answerLabel(time, t) === 'At the office at 10:30', 'a time: the server\'s words', time);
  const loc = answerOf(row({ name: 'S', username: 's', state: 'answered', answer: 'location', answer_text: 'Shared where they are', location: { lat: 7, lng: 80, near: 'Kadawatha', map: 'https://maps' } }));
  check(loc.key === 'location' && loc.map === 'https://maps' && answerLabel(loc, t) === 'Shared where they are', 'a location: the words and the map link', loc);
  const seen = answerOf(row({ name: 'R', username: 'r', state: 'seen', seen: '09:12' }));
  check(seen.key === 'seen' && seen.tone === 'muted' && answerLabel(seen, t) === 'office.ask.seenAt(09:12)', 'seen 09:12');
  const waiting = answerOf(row({ name: 'R', username: 'r' }));
  check(waiting.key === 'waiting' && answerLabel(waiting, t) === 'office.ask.waiting', 'waiting…');
}

console.log('\n== The rows once sent, and the polling ==');
{
  const targets = askTargets([kamal, ruwan, nimal]);
  const ask = {
    id: 'a1', kind: 'free_for_trip', question: 'Free for a trip Tue 20 Oct 07:24–15:40?', asked_by: 'Sahan', asked: '09:10', asked_day: '2026-10-19', expires: '07:24',
    counts: { asked: 2, seen: 1, answered: 1, yes: 1 },
    drivers: [
      { name: 'Kamal', username: 'kamal', sent: '09:10', state: 'answered', answer: 'yes', answered: '09:14' },
      { name: 'Ruwan', username: 'ruwan', sent: '09:10', state: 'sent' },
      { name: 'Guest', username: 'guest', sent: '09:10', state: 'seen', seen: '09:11' },
    ],
  } as Ask;
  const rows = mergeRows(targets, ask);
  check(rows.length === 4 && rows[0].row?.answer === 'yes' && rows[1].row?.state === 'sent' && rows[2].row === null && rows[3].target.name === 'Guest' && rows[3].row?.state === 'seen',
    'each listed driver with their answer row; one not asked has none; a driver the ask has but the list lacks is added', rows.map((r) => [r.target.name, r.row?.state ?? null]));
  check(mergeRows(targets, null).every((r) => r.row === null), 'nothing sent: no answer rows');
  check(keepPolling(ask) && !keepPolling({ ...ask, counts: { ...ask.counts, answered: 2 } }) && !keepPolling({ ...ask, expired: true }), 'answers are asked again while open and someone has still to answer');
  check(ANSWERS_EVERY_MS === 10_000, 'every 10 s');
  check(sendLabel(3, t) === 'office.ask.sendMany(3)' && sendLabel(1, t) === 'office.ask.sendOne' && sendLabel(0, t) === 'office.ask.send', 'Send to 3 drivers / Send to 1 driver / Send');
  check(questionText(ask, t) === 'Free for a trip Tue 20 Oct 07:24–15:40?' && questionText({ kind: 'where_now', question: '' }, t) === 'office.ask.kind.where_now', 'the question\'s own words, else the kind\'s');
}

console.log('\n== The sheet and the screens (read as text) ==');
{
  const sheet = read('src/components/office/AskDriversSheet.tsx');
  check(/<Modal visible=\{visible\} transparent animationType="slide" onRequestClose=\{onClose\}>/.test(sheet), 'a bottom sheet (Modal, like ReasonSheet): the back button closes it');
  check(/api\.call<AskDriversResult>\('ask_drivers', askInput\(kind, picked, ctx\)\)/.test(sheet), 'Send calls ask_drivers with the logic\'s input');
  check(/api\.call<AskAnswers>\('ask_answers', \{ ask_id: askId \}\)/.test(sheet) && /setInterval\(readAnswers, ANSWERS_EVERY_MS\)/.test(sheet) && /if \(!visible \|\| !askId \|\| !polling\) return;/.test(sheet),
    'the answers through ask_answers(ask_id) every 10 s, only while the sheet is open and someone has still to answer');
  check(/onUse\(target\.username as string\); onClose\(\);/.test(sheet) && /answer\?\.use && onUse && target\.username/.test(sheet), 'Use: only on a Yes, only when the caller can pick; it picks and closes');
  check(/answer\?\.key === 'callMe' && answer\.call &&/.test(sheet) && /answer\?\.key === 'location' && answer\.map &&/.test(sheet), 'Call only with a number, Map only with a link (no dead button)');
  check(/box: \{ width: 48, height: 48/.test(sheet) && /close: \{ width: 48, height: 48/.test(sheet), '48 px tick box and close button');
  check(/setPicked\(allFree\(drivers\)\)/.test(sheet) && /setPicked\(\[\]\)/.test(sheet), '"All free · None"');
  check(/disabled=\{!canSend\(kind, picked, ctx\)\}/.test(sheet), 'Send disabled until it may be sent');
  check(/t\('office\.ask\.footer'\)/.test(sheet) && /t\('office\.ask\.footerTrip'\)/.test(sheet), 'the bottom line: "They answer with one tap…" (and "closes when the trip starts" for a trip question)');
  check(!/useOffice\(\)\.me|me\.role|role ===/.test(sheet), 'no role names in the sheet');

  const request = read('src/app/office/request/[id].tsx');
  const give = read('src/app/office/task/[id]/driver.tsx');
  for (const [name, src, link, ctx] of [
    ['Approve a request', request, /link=\{mayAsk && drivers\.length > 0 \? t\('office\.ask\.open'\) : undefined\}/, /request_id: card\.id/],
    ['Give it a driver', give, /link=\{mayAsk && drivers\.length > 0 \? t\('office\.ask\.open'\) : undefined\}/, /task_id: task\.id/],
  ] as const) {
    check(/const mayAsk = me\.tools\.includes\('ask_drivers'\);/.test(src) && link.test(src), `${name}: the "Ask drivers" link beside the drivers only when the person may ask (me.tools)`);
    check(/<AskDriversSheet/.test(src) && /drivers=\{askTargets\(drivers\)\}/.test(src) && ctx.test(src) && /onUse=\{\(username\) => setPicked\(username\)\}/.test(src),
      `${name}: the sheet gets the same rows, the trip's context and its id; Use picks that driver`);
  }
  check(/from: trip\?\.leaveBy/.test(request) && /date: trip\?\.date \?\? card\.fields\?\.date/.test(request), 'Approve: the window from the request\'s plan (leave-by, the day, back-by when later)');
  check(/from: \(task\.leave_by \?\? task\.time \?\? task\.start\)\.match/.test(give) && /date: task\.date/.test(give) && /to: task\.end_by\?\.match/.test(give), 'Give it a driver: the window from the task\'s leave-by, day and end time');
  check(/to: toText && \(!fromText \|\| toText > fromText\) \? toText : undefined/.test(sheet), 'the sheet drops an end that is not after the start (the server would refuse it)');
  const board = read('src/app/office/(tabs)/drivers.tsx');
  check(/drivers=\{askTargetsFromBoard\(drivers\)\}/.test(board) && /context=\{\{ date: today \}\}/.test(board) && /const mayAsk = me\.tools\.includes\('ask_drivers'\);/.test(board),
    'the Drivers board: the sheet with the board\'s rows, today, no trip (the person types the time); only when allowed');

  // The keys the sheet reuses from the app's own strings exist already (its own keys wait in the sidecar for the lead's merge).
  const en = JSON.parse(read('src/i18n/en.json')) as { office: { common: Record<string, string> }; common: Record<string, string>; map: Record<string, string> };
  check(typeof en.office.common.call === 'string' && typeof en.common.cancel === 'string', 'office.common.call and common.cancel exist in en.json');
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Ask drivers checks passed.');
process.exit(failed ? 1 : 0);
