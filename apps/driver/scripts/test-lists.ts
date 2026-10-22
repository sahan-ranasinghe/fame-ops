// Tests of Hotfix 3 (L6) in the driver app: nothing on Today grows without limit. The missed rule (a task never started,
// its leave-by over a day ago, is shown nowhere; a start already saved keeps it), Today's split (the card, at most 3
// later ones, "{n} more later today", the all-tasks list), "Load more" 20 at a time ("Showing {n} of {total}", the
// phone's rows first, then the server's), my reports' order and cursor, and the screens' use of them (read as text).
// Pure code, no stack needed:
//
//   npm run test:lists          (from apps/driver)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reportsOlderThan } from '../src/lib/api';
import {
  isMissed,
  loadMore,
  MISSED_AFTER_MS,
  mergeNewest,
  newestFirst,
  oldestOf,
  PAGE,
  pageInfo,
  TODAY_LATER,
  todayLists,
  visibleTasks,
  windowOf,
} from '../src/lib/lists';
import type { TaskWithStops } from '../src/lib/types';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

// 18 October 2026, 10:00 in Colombo (04:30 UTC).
const NOW = Date.parse('2026-10-18T10:00:00+05:30');
const HOUR = 3_600_000;
const at = (offsetHours: number) => new Date(NOW + offsetHours * HOUR).toISOString();
const task = (id: string, status: string, startHours: number, patch: Partial<TaskWithStops> = {}): TaskWithStops =>
  ({ id, status, start_at: at(startHours), leave_by: at(startHours), task_stops: [], ...patch }) as unknown as TaskWithStops;
const ids = (list: readonly { id: string }[]) => list.map((t) => t.id).join(',');

console.log('A missed task is shown nowhere:');
check(MISSED_AFTER_MS === 24 * HOUR, 'the server\'s rule: never started, the leave-by over 24 hours ago');
check(isMissed(task('m', 'missed', 1), NOW), 'status missed (from the server): missed, whatever its time');
check(isMissed(task('a', 'assigned', -25), NOW), 'the phone\'s copy, assigned, leave-by 25 h ago (not read again yet): missed');
check(!isMissed(task('a', 'assigned', -23), NOW), 'assigned, leave-by 23 h ago: still shown');
check(isMissed(task('d', 'declined', -30), NOW), 'declined and never started, 30 h ago: missed');
check(!isMissed(task('r', 'in_progress', -72), NOW), 'started (a start saved on the phone, even offline): never missed, so the queued start goes as it is');
check(!isMissed(task('c', 'completed', -72), NOW) && !isMissed(task('x', 'cancelled', -72), NOW), 'completed or cancelled: not missed');
check(isMissed(task('s', 'assigned', -30, { leave_by: null }), NOW), 'no leave-by: the start time');
check(!isMissed(task('l', 'assigned', -30, { leave_by: at(-2) }), NOW), 'the leave-by counts, not the start time');
check(ids(visibleTasks([task('a', 'assigned', 1), task('m', 'missed', 1), task('o', 'assigned', -48)], NOW)) === 'a', 'visibleTasks leaves the missed out');

console.log('\nToday: the card, at most 3 later ones, then "All today\'s tasks":');
check(TODAY_LATER === 3 && PAGE === 20, 'at most 3 later tasks on Today; lists load 20 at a time');
{
  const list = [
    task('t6', 'assigned', 6), task('t2', 'assigned', 2), task('run', 'in_progress', -1), task('t3', 'assigned', 3),
    task('t4', 'assigned', 4), task('t5', 'assigned', 5), task('t1', 'assigned', 1),
    task('tom1', 'assigned', 24), task('tom2', 'assigned', 26),
    task('miss', 'missed', -30), task('old', 'assigned', -40), task('done', 'completed', -3), task('dec', 'declined', 2), task('can', 'cancelled', 2),
  ];
  const l = todayLists(list, NOW);
  check(l.next?.id === 'run' && l.running?.id === 'run', 'the task under way is the card');
  check(ids(l.shownToday) === 't1,t2,t3' && l.shownUpcoming.length === 0, 'then the first 3 later today, in time order', ids(l.shownToday));
  check(l.moreToday === 3, '"3 more later today"', l.moreToday);
  check(l.allRow, 'the row "All today\'s tasks" is there');
  check(ids(l.all) === 'run,t1,t2,t3,t4,t5,t6,tom1,tom2' && l.allToday === 7, 'the all-tasks list: the running one, every task today, then coming up', ids(l.all));
  const everywhere = [l.next, ...l.shownToday, ...l.shownUpcoming, ...l.all, ...l.laterToday, ...l.upcoming].map((t) => t?.id);
  check(!everywhere.some((id) => id === 'miss' || id === 'old'), 'never a missed task (the server\'s word or the phone\'s stale copy): not the card, not a row, not the list');
  check(!everywhere.some((id) => id === 'done' || id === 'dec' || id === 'can'), 'done, declined and cancelled tasks are not on Today (as before)');
}
{
  const l = todayLists([task('a', 'assigned', 1), task('b', 'assigned', 2), task('c', 'assigned', 3), task('d', 'assigned', 4), task('e', 'assigned', 5)], NOW);
  check(l.next?.id === 'a' && ids(l.shownToday) === 'b,c,d' && l.moreToday === 1, 'no task under way: the first is the card, the next 3 are rows, "1 more later today"');
  check(ids(l.all) === 'a,b,c,d,e' && l.allToday === 5, 'the list has the card\'s task too');
}
{
  const l = todayLists([task('a', 'assigned', 1), task('b', 'assigned', 2), task('t1', 'assigned', 25), task('t2', 'assigned', 26), task('t3', 'assigned', 49)], NOW);
  check(ids(l.shownToday) === 'b' && ids(l.shownUpcoming) === 't1,t2', 'one later today, then coming up: 3 rows in all', { today: ids(l.shownToday), up: ids(l.shownUpcoming) });
  check(l.moreToday === 0 && l.allRow, 'nothing more today (no "more later today" line), the row still opens the whole list');
  check(ids(l.all) === 'a,b,t1,t2,t3' && l.allToday === 2, 'the list: today\'s 2, then coming up 3');
}
{
  const only = todayLists([task('a', 'assigned', 1)], NOW);
  check(only.next?.id === 'a' && !only.allRow && only.moreToday === 0, 'only the card: no row (nothing after it)');
  const none = todayLists([task('m', 'missed', -30)], NOW);
  check(none.next === undefined && !none.allRow && none.all.length === 0, 'only a missed task: "No tasks right now"');
  const tomorrow = todayLists([task('t1', 'assigned', 25), task('t2', 'assigned', 30)], NOW);
  check(tomorrow.next?.id === 't1' && ids(tomorrow.shownUpcoming) === 't2' && tomorrow.allToday === 0, 'nothing today: tomorrow\'s first task is the card, the list is all "Coming up"');
  const early = todayLists([task('y', 'assigned', -20), task('a', 'assigned', 1)], NOW);
  check(early.next?.id === 'y' && ids(early.shownToday) === 'a', 'a task from yesterday not missed yet (leave-by 20 h ago) is still the card');
}

console.log('\nLoad more, 20 at a time:');
check(JSON.stringify(pageInfo(20, 45)) === '{"n":20,"total":45,"more":true}', 'Showing 20 of 45, Load more', pageInfo(20, 45));
check(JSON.stringify(pageInfo(20, 12)) === '{"n":12,"total":12,"more":false}', '12 rows: all on screen, no Load more');
check(JSON.stringify(pageInfo(60, 45)) === '{"n":45,"total":45,"more":false}', 'the last page: no Load more');
check(JSON.stringify(pageInfo(20, 30, 35)) === '{"n":20,"total":65,"more":true}', 'the server\'s older ones count in the total: Showing 20 of 65');
check(pageInfo(20, 20, null).more === false && pageInfo(20, 20, 0).more === false, 'offline (count unknown) or none older: the phone\'s rows are the list');
check(JSON.stringify(loadMore(20, 45, null)) === '{"shown":40,"fetch":false}', 'Load more shows the next 20 the phone holds');
check(JSON.stringify(loadMore(20, 30, 35)) === '{"shown":40,"fetch":true}', 'fewer than 20 more on the phone and more on the server: ask the server');
check(loadMore(20, 30, 0).fetch === false && loadMore(20, 30, null).fetch === false, 'none on the server (or offline): never asks');
check(JSON.stringify(loadMore(40, 30, 35)) === '{"shown":50,"fetch":true}', 'after a failed request (no connection) Load more asks again');
check(ids(windowOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)) === 'a,b' && windowOf([{ id: 'a' }], 20).length === 1, 'the window is the first rows');
{
  // The server has 65 reports; the phone keeps the newest 30. The Report tab pages through them all.
  const server = Array.from({ length: 65 }, (_, i) => ({ id: `r${String(100 - i)}`, created_at: new Date(NOW - i * HOUR).toISOString() }));
  let held = server.slice(0, 30);
  let remaining: number | null = 35; // the count asked when the tab opens: below the oldest held
  let shown = PAGE;
  const seen: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const info = pageInfo(shown, held.length, remaining);
    seen.push(`${info.n}/${info.total}`);
    if (!info.more) break;
    const step = loadMore(shown, held.length, remaining);
    shown = step.shown;
    if (step.fetch) {
      const cursor = oldestOf(held);
      const below = server.filter((r) => cursor && newestFirst(r, cursor) > 0);
      const page = below.slice(0, PAGE);
      held = mergeNewest(held, page);
      remaining = below.length - page.length;
    }
  }
  check(seen.join(' ') === '20/65 40/65 60/65 65/65', 'Showing 20, 40, 60, then all 65 of 65 (the phone\'s 30 first, then the server\'s 20 and 15)', seen.join(' '));
  check(held.length === 65 && new Set(held.map((r) => r.id)).size === 65, 'every report once, none missed or doubled');
}

console.log('\nMy reports, newest first:');
{
  const local = { id: 'b', created_at: '2026-10-18T05:00:00.500Z', status: 'open' };
  const rows = mergeNewest(
    [local, { id: 'a', created_at: '2026-10-18T04:00:00+00:00', status: 'open' }],
    [{ id: 'b', created_at: '2026-10-18T05:00:00.5+00:00', status: 'closed' }, { id: 'c', created_at: '2026-10-18T05:00:00+00:00', status: 'open' }],
  );
  check(ids(rows) === 'b,c,a', 'one list, newest first, whatever the time\'s format (the phone\'s Z, the server\'s +00:00)', ids(rows));
  check(rows[0] === local, 'a report in both lists is taken from the first (the phone\'s fresh copy)');
  const tie = mergeNewest([{ id: 'x1', created_at: '2026-10-18T05:00:00Z' }, { id: 'x2', created_at: '2026-10-18T05:00:00Z' }]);
  check(ids(tie) === 'x2,x1', 'the same time: by id, descending (the server\'s order)');
  check(JSON.stringify(oldestOf(rows)) === '{"created_at":"2026-10-18T04:00:00+00:00","id":"a"}' && oldestOf([]) === null, 'the cursor is the oldest row held');
  check(reportsOlderThan({ created_at: '2026-10-18T04:00:00.123+00:00', id: 'a1b2c3d4-0000-4000-8000-000000000001' }) ===
    'created_at.lt."2026-10-18T04:00:00.123+00:00",and(created_at.eq."2026-10-18T04:00:00.123+00:00",id.lt.a1b2c3d4-0000-4000-8000-000000000001)',
  'the server\'s next page: older, or the same time with a lower id (the time quoted for the filter)');
}

// The screens' source, read as text (they need React Native, so they are not run here). Comments are left out.
console.log('\nThe screens:');
const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const code = (path: string) => readFileSync(join(src, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const today = code('app/(tabs)/index.tsx');
const report = code('app/(tabs)/report.tsx');
const fuel = code('app/(tabs)/fuel.tsx');
const mileage = code('app/(tabs)/mileage.tsx');
// Round 4–7 (§33.6, §33.7): the tabs show the last 5 with "See all"; the pages (20 at a time) are on their own screens.
const history = code('app/history.tsx');
const myReports = code('app/my-reports.tsx');
const reportRows = code('components/ReportRows.tsx');
const taskScreen = code('app/task/[id].tsx');
const api = code('lib/api.ts');
check(/todayLists\(tasks, now\)/.test(today) && /tasks=\{shownToday\}/.test(today) && /tasks=\{shownUpcoming\}/.test(today) && !/tasks=\{laterToday\}|tasks=\{upcoming\}/.test(today),
  'Today shows the capped lists (never the whole later list)');
check(/t\('today\.allTasks'\)/.test(today) && /t\('today\.moreLater', \{ n: moreToday \}\)/.test(today) && /lists\.allRow &&/.test(today), 'Today has the row with "{n} more later today"');
check(/useMarkShown\(\[\.\.\.\(next \? \[next\] : \[\]\), \.\.\.shownToday, \.\.\.shownUpcoming\]\)/.test(today), 'Today marks seen only the tasks on screen');
check(/recentEntries\(entries\)/.test(fuel) && /seeAll="fuel"/.test(fuel) && !/<LoadMore /.test(fuel), 'Fuel: the last 5 fills and See all (no growing list on the tab)');
check(/windowOf\(merged\.rows, shown\)/.test(history) && /<LoadMore /.test(history) && /fetchFuelBefore\(supabase, cursor, HISTORY_PAGE\)/.test(history)
  && /fetchOdometerBefore\(supabase, cursor, HISTORY_PAGE\)/.test(history), 'the history: 20 at a time from the server, below the oldest held');
check(/windowOf\(todayTasks, shown\)/.test(mileage) && /visibleTasks\(tasks, now\)/.test(mileage) && /<LoadMore /.test(mileage), 'Mileage: today\'s tasks 20 at a time, never a missed one');
check(/newest\.slice\(0, RECENT_REPORTS\)/.test(report) && /reportsSeeAll\(newest\.length\)/.test(report) && /router\.push\('\/my-reports'\)/.test(report) && !/<LoadMore /.test(report),
  'Report: the last 5 of my reports and See all');
check(/pages\.visible\.map/.test(myReports) && /useReportPages\(reports\)/.test(myReports) && /fetchReportsBefore\(supabase, cursor\(\), PAGE\)/.test(reportRows)
  && /fetchReportsBefore\(supabase, cursor\(\), 0\)/.test(reportRows) && /<LoadMore /.test(myReports),
  'My reports (See all): 20 at a time, the older ones from the server (and their count) below the oldest held');
check(/!isMissed\(item, Date\.now\(\)\)/.test(taskScreen), 'the task screen (and its preview) treats a missed task as gone');
check(/\.neq\('status', 'missed'\)/.test(api), 'the task list read from the server never has a missed task');

console.log('\nThe strings (en and si):');
const lookup = (dict: unknown, key: string) => key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);
for (const key of ['today.allTasks', 'today.allTasksTitle', 'today.moreLater', 'today.upcoming', 'today.inProgress', 'patterns.loadMore', 'patterns.shownOf']) {
  check(typeof lookup(en, key) === 'string' && typeof lookup(si, key) === 'string', `${key} in both languages`);
}
check((lookup(si, 'patterns.shownOf') as string).includes('{n}') && (lookup(si, 'patterns.shownOf') as string).includes('{total}') && (lookup(si, 'today.moreLater') as string).includes('{n}'),
  'the Sinhala strings keep the numbers\' places (Latin digits are filled in)');

console.log(failures === 0 ? '\nAll list tests passed.' : `\n${failures} list test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
