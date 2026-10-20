// Stage 1 item 3a–b (O3): Tasks → History (office/taskHistoryLogic.ts, list_tasks) and Load more on the board's columns
// (task_board's column paging), no phone: the filters, the tool's input, the paging, the words of a row and of the
// totals, the column pages kept apart from the board's first page, More's row, and the screens as text (the shared
// patterns, each tool behind its button, every key in both languages).
//
//   npm run test:task-history          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { activeChips, activeCount, defaultValues } from '../src/lib/patterns/filterLogic';
import { moreFor, MORE_SECTION, tabsFor } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import {
  addColumnPage, appendHistory, BOARD_LIMIT, columnArgs, columnView, defaultHistoryRange, emptyHistoryValues, emptyKey, HISTORY_LIMIT, HISTORY_MAX_DAYS, historyArgs,
  historyChoice, historyFilterDefs, historyTone, routeText, rowSub, sameRange, statusKey, totalsLine, type Words,
} from '../src/office/taskHistoryLogic';
import type { Board, BoardCard, HistoryTask, TaskHistory } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
/** The words as "key(var,var)": the test reads which key was asked with what. */
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

const task = (over: Partial<HistoryTask> & Pick<HistoryTask, 'id'>): HistoryTask => ({
  date: '2026-10-20', time: '09:00', title: 'Team drop', kind: 'dispatch', purpose: 'company', status: 'completed', stops_count: 2, ...over,
});

console.log('\nThe days and the filters');
{
  check(same(defaultHistoryRange('2026-10-20'), { from: '2026-10-14', to: '2026-10-20' }), 'Last 7 days at first, today included');
  check(HISTORY_MAX_DAYS === 366 && HISTORY_LIMIT === 25, 'at most 366 days (the tool\'s limit), 25 a page');
  const defs = historyFilterDefs([{ username: 'kamal', name: 'Kamal Perera' }, { username: null, name: 'No login' }], [{ reg_no: 'WP CAB-4521' }], t);
  check(same(defs.map((d) => d.key), ['driver', 'vehicle', 'status', 'kind']) && defs.every((d) => d.kind === 'single' && d.default === ''), 'four sections, each one of a kind with All by default');
  check(same(defs[0].options.map((o) => o.value), ['', 'kamal']) && defs[0].options[1].label === 'Kamal Perera', 'the drivers by username (a driver without a login is left out)');
  check(same(defs[2].options.map((o) => o.value), ['', 'assigned', 'in_progress', 'completed', 'cancelled', 'declined', 'missed']) && defs[2].options[3].label === 'office.history.status_completed', 'the tool\'s six statuses, in the history\'s words');
  check(same(defs[3].options.map((o) => o.value), ['', 'dispatch', 'self']), 'the kinds: office tasks, driver-started');
  check(same(historyFilterDefs([], [], t).map((d) => d.key), ['status', 'kind']), 'no driver or vehicle list (no tool): those sections are left out');
  const v = emptyHistoryValues();
  check(activeCount(defs, v) === 0 && activeChips(defs, v).length === 0 && same(defaultValues(defs), v), 'nothing chosen: no badge, no chips');
  const chosen = { ...v, driver: 'kamal', status: 'cancelled' };
  check(activeCount(defs, chosen) === 2 && same(activeChips(defs, chosen).map((c) => c.label), ['Kamal Perera', 'office.history.status_cancelled']), 'two chosen: the badge says 2, a chip each');
  check(same(historyChoice({ driver: 'kamal', vehicle: '', status: 'nonsense', kind: 'self' }), { driver: 'kamal', vehicle: '', status: '', kind: 'self' }), 'a status the tool does not know is dropped');
}

console.log('\nlist_tasks\' input and the pages');
{
  const r = { from: '2026-10-14', to: '2026-10-20' };
  check(same(historyArgs(r, historyChoice(emptyHistoryValues()), ''), { from: '2026-10-14', to: '2026-10-20', limit: 25 }), 'only the days and the page when nothing is chosen');
  check(same(historyArgs(r, { driver: 'kamal', vehicle: 'WP CAB-4521', status: 'completed', kind: 'self' }, '  drop ', 'c25'),
    { from: '2026-10-14', to: '2026-10-20', limit: 25, driver: 'kamal', vehicle: 'WP CAB-4521', status: 'completed', kind: 'self', search: 'drop', cursor: 'c25' }), 'every filter, the words trimmed, the cursor for the next page');
  const first: TaskHistory = { from: r.from, to: r.to, count: 2, total: 3, next: 'c2', totals: { completed: 2, cancelled: 1, km: 84.4, driver_started: 1, personal: 0 }, tasks: [task({ id: 'a' }), task({ id: 'b' })] };
  const page: TaskHistory = { ...first, count: 2, next: undefined, tasks: [task({ id: 'b' }), task({ id: 'c' })] };
  const both = appendHistory(first, page);
  check(same(both.tasks.map((x) => x.id), ['a', 'b', 'c']) && both.next === undefined && both.total === 3, 'Load more adds the next page once (a task already shown is not shown twice); the cursor ends');
  check(sameRange(first, r) && !sameRange(first, { from: '2026-10-01', to: '2026-10-20' }) && !sameRange(null, r), 'the rows shown are the days chosen (other days on their way: the skeleton)');
}

console.log('\nThe words of the totals and of a row');
{
  const d = { count: 25, total: 140, totals: { completed: 90, cancelled: 3, km: 1840.6, driver_started: 7, personal: 2, missed: 1 } } as unknown as TaskHistory;
  check(totalsLine(d, t) === 'office.history2.tasks(140) · office.history2.completed(90) · office.history2.cancelled(3) · office.history2.missed(1) · 1,841 km · office.history2.driverStarted(7) · office.history2.personal(2)', 'every task the filters match (total, not the page), the parts that are not zero', totalsLine(d, t));
  check(totalsLine({ count: 1, totals: { completed: 0, cancelled: 0, km: 0, driver_started: 0, personal: 0 } } as unknown as TaskHistory, t) === 'office.history2.tasksOne', 'one task, nothing else');
  check(routeText(task({ id: 'x', from: 'Head office', to: 'Kurunegala site', stops_count: 4 }), t) === 'Head office → Kurunegala site · office.history2.stopsN(4)', 'from → to · N stops');
  check(routeText(task({ id: 'x', from: 'Head office', stops_count: 1 }), t) === 'Head office' && routeText(task({ id: 'x', stops_count: 0 }), t) === '', 'one stop; none known');
  check(rowSub(task({ id: 'x', label: 'Mobitel MS', kind: 'self', purpose: 'personal', started: '2026-10-20 09:10', completed: '2026-10-20 11:40', km: 42 }), t) === 'Mobitel MS · office.history2.kind_self · office.history2.personalTag · 09:10–11:40 · 42 km', 'the tags, when it ran, the km once completed');
  check(rowSub(task({ id: 'x', status: 'in_progress', started: '2026-10-20 09:10', km: 3 }), t) === '09:10–office.history2.now', 'still running: "09:10–now", no km yet');
  check(rowSub(task({ id: 'x', status: 'cancelled', cancelled_reason: 'Plans changed' }), t) === 'Plans changed', 'cancelled: why');
  check(historyTone('completed') === 'green' && historyTone('in_progress') === 'blue' && historyTone('assigned') === 'amber' && historyTone('missed') === 'red' && historyTone('odd') === 'muted', 'the status pill\'s colours');
  check(statusKey('declined') === 'office.history.status_declined' && statusKey('odd') === null, 'the status word, or the status as it came');
  const none = historyChoice(emptyHistoryValues());
  check(emptyKey('drop', none) === 'office.history2.emptySearch' && emptyKey('', { ...none, kind: 'self' }) === 'office.history2.emptyFiltered' && emptyKey('', none) === 'office.history2.empty', 'the empty state says why: the words, the filters, or none in these days');
}

console.log('\nLoad more on the board\'s columns');
{
  const card = (id: string): BoardCard => ({ id, time: '09:00', title: id });
  const b = {
    date: '2026-10-20',
    counts: { assigned: 3, in_progress: 1, completed: 0, cancelled: 0 },
    totals: { assigned: 3, in_progress: 1, completed: 0 },
    next: { assigned: 'c2' },
    assigned: [card('a1'), card('a2')], in_progress: [card('p1')], completed: [],
  } as unknown as Board;
  const first = columnView(b, 'assigned');
  check(same(first.cards.map((c) => c.id), ['a1', 'a2']) && first.total === 3 && first.next === 'c2', 'a column with more than its first page: Load more with the board\'s cursor');
  check(columnView(b, 'in_progress').next === null && columnView(b, 'completed').next === null, 'a whole column: no Load more');
  check(same(columnArgs('2026-10-20', 'assigned', 'c2'), { date: '2026-10-20', limit: BOARD_LIMIT, column: 'assigned', cursor: 'c2' }) && BOARD_LIMIT === 50, 'task_board with the column and its cursor (that column\'s page only)');
  const more = addColumnPage(undefined, { assigned: [card('a2'), card('a3')], next: undefined } as unknown as Board, 'assigned');
  const after = columnView(b, 'assigned', more);
  check(same(after.cards.map((c) => c.id), ['a1', 'a2', 'a3']) && after.next === null, 'the page added after the first, every card once; nothing more after it');
  const refreshed = { ...b, assigned: [card('a0'), card('a1')] } as Board;
  check(same(columnView(refreshed, 'assigned', more).cards.map((c) => c.id), ['a0', 'a1', 'a2', 'a3']), 'the board read again (every minute) keeps the pages loaded since');
}

console.log('\nMore: Task history beside Tasks');
{
  const fa = moreFor(PRESETS.fleet_admin.permissions);
  check(fa.indexOf('task_history') === fa.indexOf('tasks') + 1, 'Tasks under More (an approver who also dispatches): Task history right after it', fa);
  const di = PRESETS.dispatcher.permissions;
  check(tabsFor(di).some((x) => x.key === 'tasks') && !moreFor(di).includes('task_history'), 'Tasks on the bar: History is its own button, not under More');
  check(!moreFor(PRESETS.requester.permissions).includes('task_history') && !moreFor(PRESETS.viewer.permissions).includes('task_history'), 'no assign_tasks: no Task history');
  check(MORE_SECTION.task_history === 'work', 'under Work');
  const more = src('app/office/(tabs)/more.tsx');
  check(more.includes("task_history: { icon: Clock, label: 'office.history2.title', path: '/office/task-history' }") && more.includes("key !== 'task_history' || me.tools.includes('list_tasks')"), 'More\'s row opens the history, only with list_tasks');
}

console.log('\nThe screens as text');
{
  const s = src('app/office/task-history.tsx');
  check(s.includes("useTool<TaskHistory>('list_tasks', historyArgs(range, choice, search), { enabled: allowed })") && s.includes("const allowed = me.tools.includes('list_tasks')"), 'list_tasks with the range, the filters and the words; only with the tool');
  check(s.includes('<DateRangeButton value={range} onChange={setRange} max={today} maxDays={HISTORY_MAX_DAYS}') && s.includes('<FilterBar') && s.includes('defs={defs}') && !s.includes('FilterChips') && !/TextInput/.test(s),
    'the date range pattern (no future days, 366 at most) and the one Filter button with the search; no chip row, nothing typed for a date');
  check(s.includes('<SkeletonRows') && s.includes('<ListFailed') && s.includes('<ListEmpty') && s.includes('<LoadMore') && !s.includes('<Loading') && !s.includes('ActivityIndicator'), 'the list pattern: skeleton, error with Try again, empty, Load more; no spinner');
  check(s.includes("historyArgs(range, choice, search, d.next)") && s.includes('appendHistory(p, page)'), 'Load more asks the next page on the cursor and adds it');
  check(s.includes("onPress={() => router.push({ pathname: '/office/task/[id]', params: { id: x.id } })}"), 'a row opens the task');
  check(s.includes('HISTORY_SEARCH_MS') && s.includes('setSearch(text.trim())'), 'the words go to the server half a second after the last key');
  check(s.includes("useTool<DriversList>('list_drivers'") && s.includes("me.tools.includes('list_drivers')") && s.includes("me.tools.includes('list_vehicles')"), 'the driver and vehicle choices only with their tools');
  const tasks = src('app/office/(tabs)/tasks.tsx');
  check(tasks.includes("me.tools.includes('list_tasks') && (") && tasks.includes("router.push('/office/task-history')") && tasks.includes('testID="tasks-history"'), 'the Tasks tab: History in the header, with list_tasks');
  check(tasks.includes("api.call<Board>('task_board', columnArgs(date, column, cursor))") && tasks.includes('addColumnPage(m[column], page, column)') && tasks.includes('<LoadMore shown={v.cards.length} total={v.total}'), 'the board: Load more per column through task_board\'s column paging');
  check(tasks.includes("{list('in_progress',") && tasks.includes("{list('assigned',") && tasks.includes("{list('completed',") && /setMore\(\{\}\);[\s\S]*?\}, \[date\]\);/.test(tasks), 'every column pages; another day starts over');
  check(!/'(admin|fleet_admin|office|viewer|staff)'/.test(s + tasks), 'no role names');
}

console.log('\nStrings in both languages');
{
  const en = JSON.parse(src('i18n/en.json')) as { office: { history2: Record<string, string> } };
  const si = JSON.parse(src('i18n/si.json')) as typeof en;
  const code = src('app/office/task-history.tsx') + src('app/office/(tabs)/tasks.tsx') + src('office/taskHistoryLogic.ts') + src('app/office/(tabs)/more.tsx');
  const asked = [...new Set([...code.matchAll(/'office\.history2\.([A-Za-z_]+)'/g)].map((m) => m[1]))];
  const dynamic = ['kind_dispatch', 'kind_self'];
  const missing = [...asked, ...dynamic].filter((k) => !en.office.history2?.[k] || !si.office.history2?.[k]);
  check(asked.length >= 20 && missing.length === 0, `every office.history2 key the code asks for, in en and si (${asked.length})`, missing);
  const keys = Object.keys(en.office.history2);
  check(keys.every((k) => /[඀-෿]/.test(si.office.history2[k]) && si.office.history2[k] !== en.office.history2[k]), 'every string in real Sinhala', keys.filter((k) => !/[඀-෿]/.test(si.office.history2[k] ?? '')));
  check(Object.values(si.office.history2).every((v) => !/[෦-෯]/.test(v)), 'Latin digits only in Sinhala');
  const ph = (x: string) => (x.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  check(keys.every((k) => ph(en.office.history2[k]) === ph(si.office.history2[k] ?? '')), 'the same placeholders in both languages');
  const hist = (JSON.parse(src('i18n/en.json')) as { office: { history: Record<string, string> } }).office.history;
  check(['assigned', 'in_progress', 'completed', 'cancelled', 'declined', 'missed'].every((s) => typeof hist[`status_${s}`] === 'string'), 'the status words (office.history.status_*) exist for every status the filter offers');
}

console.log(failures === 0 ? '\nAll task history checks passed.' : `\n${failures} task history check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
