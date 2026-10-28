// Round 48 (item 4): free or busy by the trip's date in Office mode (Google Calendar's room picker: availability for the
// meeting's time, never now). The window the forms ask for (the plan's end as planned_end), the trip's chip in both
// languages from the server's own words (statusWords), the pill rule (busy for the trip is busy, whatever the driver
// does now), the best match's reasons for a later trip, Ask drivers' rows from a board judged for a trip, and the
// screens read as text: every pill goes through tripChipText, the sheet asks the board about the trip typed in it.
//   npm run test:trip-window          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { availabilityArgs, driverPill, tripChipText } from '../src/office/approveLogic';
import { askTargets, askTargetsFromBoard, preticked, tripBoardArgs } from '../src/office/askLogic';
import { availabilityAt } from '../src/office/decideLogic';
import { sentenceText } from '../src/office/statusWords';
import { availabilityArgsForTask } from '../src/office/taskLogic';
import { withPlannedEnd } from '../src/office/trip/requestLogic';
import { planEndOf, whoArgs } from '../src/office/trip/whoLogic';
import type { AvailableDriver, BoardDriver, RequestCard, TaskDetail } from '../src/office/types';

type Tree = { [k: string]: string | Tree | string[] };
const here = join(__dirname);
const SRC = join(here, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const dicts = { en: JSON.parse(read('i18n/en.json')) as Tree, si: JSON.parse(read('i18n/si.json')) as Tree };
const get = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Tree)[k] : undefined), tree);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = get(dicts[lang], key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`));
};
const en = tr('en');
const si = tr('si');

let failures = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};
const noEnglish = (s: string) => !/[A-Za-z]{2,}/.test(s);
const sinhalaDigits = /[෦-෯]/;

const base: AvailableDriver = { name: 'Nuwan', username: 'nuwan.p', state: 'off_duty', status_text: 'Off duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true };

console.log('The window the forms ask for');
{
  const draft = { date: '2026-10-29', leaveBy: '09:03', end: '', stops: [], start: '', startPax: false };
  check(same(whoArgs(draft, { plannedEnd: '13:10' }), { at: '2026-10-29 09:00', planned_end: '13:10' }), 'the Who step: the plan\'s end as planned_end when no end is typed', whoArgs(draft, { plannedEnd: '13:10' }));
  check(same(whoArgs({ ...draft, end: '12:00' }, { plannedEnd: '13:10' }), { at: '2026-10-29 09:00', until: '12:00' }), 'a typed end wins: until, no planned_end');
  check(same(whoArgs(draft, { plannedEnd: '08:00' }), { at: '2026-10-29 09:00' }), 'a plan ending before the time is no window');
  check(planEndOf({ timeline: { totals: { ends: '13:10' } } }) === '13:10' && planEndOf({ plan: { ends_at: '2026-10-29 13:10' } }) === '13:10' && planEndOf(null) === '', 'planEndOf: the timeline\'s ends, else the plan\'s ends_at, as HH:MM');
  check(same(withPlannedEnd({ date: '2026-10-29', time: '09:00' }, '13:10'), { date: '2026-10-29', time: '09:00', planned_end: '13:10' }) && same(withPlannedEnd({ date: '2026-10-29', time: '09:00', back_by: '12:00' }, '13:10'), { date: '2026-10-29', time: '09:00', back_by: '12:00' }), 'Book now\'s suggest_vehicles: the plan\'s end only without a back-by');
  const td = { task: { id: 't1', title: 'x', date: '2026-10-29', leave_by: '09:00', end_by: undefined }, stops: [], timeline: { items: [], totals: { drive_min: 60, km: 40, ends: '13:10' } } } as unknown as TaskDetail;
  check(same(availabilityArgsForTask(td), { at: '2026-10-29 09:00', planned_end: '13:10' }), 'Who can take it: the task\'s plan end as planned_end when it has no end time', availabilityArgsForTask(td));
  check(same(availabilityArgsForTask({ ...td, task: { ...td.task, end_by: '12:00' } } as TaskDetail), { at: '2026-10-29 09:00', until: '12:00' }), 'the task\'s end time wins');
  const card = { fields: { date: '2026-10-29', time: '09:00' }, trip: { leave_by: '09:00', stops: [], timeline: { items: [], totals: { drive_min: 60, km: 40, ends: '13:10' } } } } as unknown as RequestCard;
  const args = availabilityArgs(card);
  check(same(args, { at: '2026-10-29 09:00', planned_end: '13:10' }), 'Approve: the request\'s plan end as planned_end when it has no back-by', args);
  check(same(availabilityAt(args, { date: '2026-10-29', leaveBy: '09:00', back: '', fromDwell: null, toDwell: null }), args), 'the times as asked keep the plan\'s end');
  check(same(availabilityAt(args, { date: '2026-10-29', leaveBy: '10:00', back: '', fromDwell: null, toDwell: null }), { at: '2026-10-29 10:00' }), 'a new leave time drops it (the trip is planned again when decided)');
  check(same(availabilityAt(args, { date: '2026-10-29', leaveBy: '09:00', back: '12:00', fromDwell: null, toDwell: null }), { at: '2026-10-29 09:00', until: '12:00' }), 'a typed back-by replaces it');
}

console.log('\nThe chip says the trip\'s day, in both languages');
{
  // "Thu 29 Oct" in the person's day and month names (office.when.day with days.4 and months.9).
  const thu = si('office.when.day', { day: si('days.4'), date: 29, month: si('months.9') });
  const cases: [string, string][] = [
    ['Free today', 'අද නිදහස්'],
    ['Free tomorrow', 'හෙට නිදහස්'],
    ['Free Thu 29 Oct', `${thu} නිදහස්`],
    ['Busy 09:00–13:00 that day · Team drop', 'එදින 09:00–13:00 කාර්යබහුලයි · Team drop'],
    ['Busy from 09:00 that day · Team drop', 'එදින 09:00 සිට කාර්යබහුලයි · Team drop'],
    ['In the garage now', 'දැන් ගරාජයේ'],
    ['In the garage now · not known for Thu 29 Oct', `දැන් ගරාජයේ · ${thu} ගැන නොදනී`],
    ['In the garage now · not known for tomorrow', 'දැන් ගරාජයේ · හෙට ගැන නොදනී'],
    ['Free tomorrow 09:00–13:00 · 1 task that day', 'හෙට 09:00–13:00 නිදහස් · එදින කාර්ය 1'],
    ['Free Thu 29 Oct 09:00–end of day · 2 tasks that day', `${thu} 09:00 සිට නිදහස් · එදින කාර්ය 2`],
    ['Free today 09:00–13:00 · 0 tasks that day', 'අද 09:00–13:00 නිදහස් · එදින කාර්ය 0'],
  ];
  for (const [line, want] of cases) {
    const back = sentenceText(en, line);
    const said = sentenceText(si, line);
    check(back === line && said === want && noEnglish(said.replace(/Team drop/, '')) && !sinhalaDigits.test(said), `"${line}" → "${said}"`, { back, said });
  }
  check(sentenceText(en, 'On duty · free 09:00–13:00 · 3.2 km from the pickup · 1 task today') === 'On duty · free 09:00–13:00 · 3.2 km from the pickup · 1 task today', 'a trip starting soon keeps the old reasons');
  check(tripChipText({ ...base, free_text: 'Free Thu 29 Oct' }, si) === `${thu} නිදහස්` && tripChipText({ ...base, free: false, busy_text: 'Busy 09:00–13:00 that day · Team drop' }, en) === 'Busy 09:00–13:00 that day · Team drop', 'tripChipText: the server\'s words through statusWords');
  check(tripChipText(base, en) === '' && tripChipText({ ...base, free: false }, en) === 'busy' && tripChipText({ ...base, free: false, not_available: 'Not available · leave' }, en) === 'Not available · leave', 'an answer without the words: nothing for a free row, "busy" for a busy one, the not-available words');
}

console.log('\nThe pill rule: busy for the trip is busy, whatever the driver does now');
{
  const offBusy: AvailableDriver = { ...base, free: false, busy_text: 'Busy 09:00–13:00 that day · Team drop' };
  check(driverPill(offBusy, 'kamal') === 'busy', 'a driver off duty now but busy then: busy (was "off duty")');
  check(driverPill({ ...base, state: 'on_task', free: true }, 'kamal') === null, 'a driver on a running task now but free then: free (no pill; the chip says the day)');
  check(driverPill({ ...base, free: true }, 'nuwan.p') === 'best', 'the best match');
}

console.log('\nAsk drivers: the rows judged for the trip');
{
  const rows = askTargets([{ ...base, free_text: 'Free tomorrow' }, { ...base, name: 'Kamal', username: 'kamal', free: false, busy_text: 'Busy 09:00–13:00 that day · Team drop' }], si);
  check(rows[0].chip === 'හෙට නිදහස්' && rows[0].free && rows[1].chip === 'එදින 09:00–13:00 කාර්යබහුලයි · Team drop' && !rows[1].free, 'from Who\'s available: the chip in the person\'s words; the line unchanged', rows);
  const board = askTargetsFromBoard([
    { name: 'Sunil', username: 'sunil', status: { kind: 'on_duty', text: 'On duty since 07:12' }, free_now: true, licence: { chip: 'ok' }, trip_free: false, busy_text: 'Busy 09:00–13:00 that day · Team drop' },
    { name: 'Kamal', username: 'kamal', status: { kind: 'off_duty', text: 'Off duty' }, free_now: false, licence: { chip: 'ok' }, trip_free: true, free_text: 'Free Thu 29 Oct' },
    { name: 'Nimal', username: 'nimal', status: { kind: 'off_duty', text: 'Off duty' }, free_now: false, licence: { chip: 'ok' } },
  ] as BoardDriver[], en);
  check(!board[0].free && board[0].chip === 'Busy 09:00–13:00 that day · Team drop' && board[1].free && board[1].chip === 'Free Thu 29 Oct' && !board[2].free && board[2].chip === undefined,
    'from the board with a trip: free means free for the trip (Sunil free now but busy then is not ticked; Kamal off duty now but free then is)', board);
  check(same(preticked(board), ['kamal']), 'the ticks follow the trip', preticked(board));
  check(same(tripBoardArgs({ date: '2026-10-29', from: '09:00', to: '13:00' }, 'free_for_trip'), { trip_date: '2026-10-29', trip_from: '09:00', trip_to: '13:00' })
    && same(tripBoardArgs({ date: '2026-10-29', from: '09:00', to: '08:00' }, 'free_for_trip'), { trip_date: '2026-10-29', trip_from: '09:00' })
    && same(tripBoardArgs({ date: '2026-10-29', from: '09:00' }, 'where_now'), {}) && same(tripBoardArgs({ date: '2026-10-29' }, 'free_for_trip'), {}),
    'the board\'s trip arguments: only a trip question with a day and a start');
}

console.log('\nThe screens, read as text');
{
  const rows = read('components/office/DriverRows.tsx');
  const request = read('app/office/request/[id].tsx');
  const give = read('app/office/task/[id]/driver.tsx');
  const sheet = read('components/office/AskDriversSheet.tsx');
  const who = read('app/office/trip/who.tsx');
  for (const [name, text] of [['DriverRows', rows], ['Approve', request], ['Give it a driver', give]] as const) {
    check(text.includes("pillKey === 'busy' ? tripChipText(") && text.includes('.free_text ? { text: tripChipText('), `${name}: the busy pill and the free chip say the trip's day (tripChipText)`);
  }
  check(sheet.includes("api.call<DriversBoard>('drivers_board', tripArgs)") && sheet.includes('askTargetsFromBoard(r.drivers, t)') && sheet.includes('target.chip ?'), 'the Ask sheet asks the board about the trip typed in it and shows the chip on every row');
  check(who.includes('plannedEnd: planEndOf(trip.preview)') && who.includes('withPlannedEnd(suggestInput('), 'the Who step sends the plan\'s end to Who\'s available and to the free vehicles');
  for (const key of ['office.avail.freeToday', 'office.avail.freeTomorrow', 'office.avail.freeDay', 'office.avail.busyThatDay', 'office.avail.busyFromThatDay', 'office.avail.garageNow', 'office.avail.garageNowDay', 'office.avail.dayToday', 'office.avail.dayTomorrow', 'office.why.freeDay', 'office.why.freeDayToEnd', 'office.why.oneTaskThatDay', 'office.why.tasksThatDay']) {
    check(typeof get(dicts.en, key) === 'string' && typeof get(dicts.si, key) === 'string' && noEnglish(String(get(dicts.si, key)).replace(/\{\w+\}/g, '')), `${key} in both languages`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
