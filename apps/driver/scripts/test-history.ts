// Stage 1 item 1 (O3): a driver's previous days and the playback (office/historyLogic.ts), and the screens wired to it.
//
//   npm run test:history          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dayRouteArgs, dayTasks, HISTORY_DAYS, historyDay, historyMin, routeEvery, taskRouteArgs } from '../src/office/historyLogic';
import type { HistoryTask } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

console.log('\nThe days');
{
  const today = '2026-10-20';
  check(HISTORY_DAYS === 90 && historyMin(today) === '2026-07-23', 'today and the 89 days before it (90 in all)', historyMin(today));
  check(historyDay('2026-10-19', today) === '2026-10-19' && historyDay('2026-07-23', today) === '2026-07-23', 'a day inside the window is kept');
  check(historyDay('2026-07-22', today) === today && historyDay('2026-10-21', today) === today && historyDay('20-10', today) === today && historyDay(undefined, today) === today,
    'a day outside the window, in the future or broken opens today');
  check(routeEvery(today, today) === 60_000 && routeEvery('2026-10-19', today) === undefined, 'today is read every minute, a past day once');
  const a = dayRouteArgs('kamal', '2026-10-19');
  check(a.driver === 'kamal' && a.date === '2026-10-19' && a.line_tolerance_m === 0 && a.max_line_points === 3000 && a.estimate_gaps === true, 'the day: every stored point, the estimated roads');
  const b = taskRouteArgs('t1');
  check(b.task_id === 't1' && b.line_tolerance_m === 0 && !('date' in b), "a task's own window: the same line, no date");
}

console.log("\nThe day's tasks");
{
  const row = (id: string, time: string, status: string, km?: number) => ({ id, date: '2026-10-19', time, title: id, kind: 'dispatch', purpose: 'company', status, stops_count: 2, km }) as HistoryTask;
  const d = dayTasks([row('c', '14:00', 'completed', 12.4), row('x', '08:00', 'cancelled'), row('a', '09:00', 'completed', 30.25), row('b', '11:00', 'in_progress', 5)]);
  check(d.tasks.map((x) => x.id).join() === 'a,b,c,x', 'in time order, the cancelled ones last', d.tasks.map((x) => x.id));
  check(d.km === 42.7, 'the km of the finished ones only, to one decimal', d.km);
  check(dayTasks([]).km === 0 && dayTasks([]).tasks.length === 0, 'no tasks: 0 km');
}

console.log('\nThe screens');
{
  const day = src('components/office/DayRoute.tsx');
  check(day.includes('<PlaybackBar') && day.includes('marker={marker}') && day.includes('playback.active ? cursorAt(') && day.includes("from '@/office/liveRouteLogic'"),
    "the day's playback: Live's rules, the marker on the map only once playback has begun");
  const live = src('app/office/(tabs)/live.tsx');
  check(live.includes("from '@/components/office/PlaybackBar'") && !/function PlaybackBar|function usePlayback/.test(live), 'one playback bar: Live uses the shared one, no copy of its own');
  check(!/export function (playbackPath|positionOn|advance)/.test(src('office/historyLogic.ts')), 'one set of playback maths (office/liveRouteLogic.ts)');
  const page = src('app/office/driver/[username].tsx');
  check(page.includes('<DayStrip value={day} onChange={setDay} max={today} min={historyMin(today)}') && page.includes('dayRouteArgs(username, day)') && page.includes('routeEvery(day, today)'),
    "the driver page: the day strip (today back 90 days), the day's route, today every minute");
  check(page.includes("'list_tasks', dayTasksArgs(username, day)") && page.includes("pathname: '/office/task/[id]'") && page.includes('route.data.date === day'),
    "the day's tasks open their task; another day's answer is never drawn under the chosen day");
  const rm = src('components/RouteMap.tsx');
  const g = src('components/GoogleRouteMap.tsx');
  const o = src('components/OpenRouteMap.tsx');
  check(rm.includes('marker?: PlaybackMarker | null') && g.includes('<PlaybackPin marker={marker}') && o.includes('<PlaybackPin marker='), 'both map engines draw the playback marker');
  const bar = src('components/office/PlaybackBar.tsx');
  check(bar.includes('PLAYBACK_TICK_MS') && bar.includes('accessibilityRole="adjustable"') && bar.includes('if (!focused) setPlaying(false)'), 'the bar: a 125 ms tick, a slider a screen reader can move, paused off screen');
  const route = src('app/office/task/[id]/route.tsx');
  check(route.includes("taskRouteArgs(id)") && route.includes('<DayRoute'), "the task's driven route: driver_route with the task's id, the same route view");
  const task = src('app/office/task/[id].tsx');
  check(/task\.status === 'in_progress' \|\| task\.status === 'completed'\) && me\.tools\.includes\('driver_route'\)/.test(task) && task.includes("pathname: '/office/task/[id]/route'"),
    'a started or finished task has "Show the driven route" (with driver_route)');
  const live2 = src('app/office/(tabs)/live.tsx');
  check(live2.includes('onHistory={routes ?') && live2.includes("pathname: '/office/driver/[username]'") && live2.includes('date: plusDays(colomboDate(), -1)') && live2.includes('testID="live-history"'),
    "Live's card: Earlier days opens the driver page on yesterday (with driver_route)");
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  const keys = Object.keys(en.office?.history ?? {});
  check(keys.length >= 10 && keys.every((k) => typeof si.office?.history?.[k] === 'string'), 'office.history in both languages', keys.filter((k) => typeof si.office?.history?.[k] !== 'string'));
  for (const [file, needs] of [
    ['components/office/DayRoute.tsx', ['office.history.wholeRoute']],
    ['app/office/driver/[username].tsx', ['office.history.todayRoute', 'office.history.dayRoute', 'office.history.dayTasks', 'office.history.noDayPoints']],
    ['app/office/task/[id]/route.tsx', ['office.history.drivenRoute', 'office.history.noTaskPoints']],
  ] as const) {
    const s = src(file);
    check(needs.every((k) => s.includes(k)), `${file}: its strings`);
  }
}

console.log(failures === 0 ? '\nAll history checks passed.' : `\n${failures} history check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
