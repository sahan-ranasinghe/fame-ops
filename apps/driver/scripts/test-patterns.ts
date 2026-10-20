// Stage 0: the shared patterns' rules (docs/ui-patterns.md), no phone: the calendar (the month grid, two taps for a range,
// a day twice for one day, the presets, a page's limit, the week strip), the time sheet (5-minute steps, Now rounded up,
// the common times, where the list opens), the filters (the badge, the chips, Clear, the sheet's draft), the list states
// and the timeout; then the components and the place box read as text (the suggestions fix, the timeouts, the skeletons).
//
//   npm run test:patterns          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { addMonths, dayAllowed, daysBetween, dayState, monthGrid, monthOf, mondayOf, PRESETS, presetOf, presetRange, rangeWords, tapDay, weekDays } from '../src/lib/patterns/calendarLogic';
import { activeChips, activeCount, clearValues, defaultValues, type FilterDef, isChosen, multi, single, toggle } from '../src/lib/patterns/filterLogic';
import { listView, TimeoutError, withTimeout } from '../src/lib/patterns/listLogic';
import { COMMON_TIMES, nowRounded, openIndex, quickTimes, TIME_STEPS } from '../src/lib/patterns/timeLogic';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

async function main() {
  console.log('\nThe calendar');
  {
    const g = monthGrid('2026-10-20');
    check(g.length === 5 && g[0][0] === null && g[0][3] === '2026-10-01' && g[4][5] === '2026-10-31' && g[4][6] === null, 'October 2026 starts on a Thursday, Monday first, 5 weeks', g[0]);
    check(monthGrid('2026-02-01').flat().filter(Boolean).length === 28 && monthGrid('2024-02-10').flat().filter(Boolean).length === 29, 'February, a leap year');
    check(addMonths('2026-12-15', 1) === '2027-01-01' && addMonths('2026-01-31', -1) === '2025-12-01', 'the month arrows across a year');
    check(mondayOf('2026-10-20') === '2026-10-19' && mondayOf('2026-10-25') === '2026-10-19' && same(weekDays('2026-10-22'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']), 'the week strip: Monday to Sunday');
    let r = tapDay({ from: null, to: null }, '2026-10-10');
    check(same(r, { from: '2026-10-10', to: null }) && dayState(r, '2026-10-10') === 'single', 'the first tap starts a range');
    r = tapDay(r, '2026-10-14');
    check(same(r, { from: '2026-10-10', to: '2026-10-14' }) && dayState(r, '2026-10-12') === 'inside' && dayState(r, '2026-10-10') === 'start' && dayState(r, '2026-10-14') === 'end', 'the second tap ends it, the days between shaded');
    check(same(tapDay({ from: '2026-10-10', to: null }, '2026-10-06'), { from: '2026-10-06', to: '2026-10-10' }), 'an earlier second day becomes the start');
    check(same(tapDay({ from: '2026-10-10', to: null }, '2026-10-10'), { from: '2026-10-10', to: '2026-10-10' }), 'a day tapped twice is a single day');
    check(same(tapDay({ from: '2026-10-10', to: '2026-10-14' }, '2026-10-20'), { from: '2026-10-20', to: null }), 'a tap after a whole range starts again');
    const today = '2026-10-20';
    check(same(presetRange('today', today), { from: today, to: today }) && same(presetRange('yesterday', today), { from: '2026-10-19', to: '2026-10-19' }) && same(presetRange('last7', today), { from: '2026-10-14', to: today }) && same(presetRange('this_month', today), { from: '2026-10-01', to: today }) && same(presetRange('last_month', today), { from: '2026-09-01', to: '2026-09-30' }), 'the presets');
    check(same(presetRange('last_month', '2026-01-05'), { from: '2025-12-01', to: '2025-12-31' }) && same(PRESETS, ['today', 'yesterday', 'last7', 'this_month', 'last_month']), 'last month across a year; the five presets of the pattern');
    check(presetOf({ from: '2026-10-14', to: today }, today) === 'last7' && presetOf({ from: '2026-10-02', to: today }, today) === null, 'the button names a preset when the range is one');
    check(!dayAllowed('2026-10-21', { max: today }) && dayAllowed('2026-10-20', { max: today }) && !dayAllowed('2026-09-01', { maxDays: 31, pending: '2026-10-10' }) && dayAllowed('2026-09-10', { maxDays: 31, pending: '2026-10-10' }), 'the future greyed for history; a page\'s limit from the pending start');
    check(daysBetween('2026-10-01', '2026-10-31') === 30 && monthOf('2026-02-10').to === '2026-02-28', 'the day maths');
    const names = { days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
    check(rangeWords({ from: '2026-10-20', to: '2026-10-20' }, names) === 'Tue 20 Oct' && rangeWords({ from: '2026-10-01', to: '2026-10-20' }, names) === '1–20 Oct' && rangeWords({ from: '2026-09-28', to: '2026-10-04' }, names) === '28 Sep – 4 Oct' && rangeWords({ from: '2025-12-29', to: '2026-01-04' }, names) === '29 Dec – 4 Jan 2026', 'the range in words');
  }

  console.log('\nThe time sheet');
  {
    check(TIME_STEPS.length === 288 && TIME_STEPS[0] === '00:00' && TIME_STEPS[1] === '00:05' && TIME_STEPS[287] === '23:55', '5-minute steps, the whole day');
    check(nowRounded('07:02') === '07:05' && nowRounded('07:05') === '07:05' && nowRounded('07:56') === '08:00' && nowRounded('23:58') === '23:55', 'Now rounded up to the next 5 minutes, never past midnight');
    check(openIndex('09:10', undefined, '07:00') === 110 && openIndex('', '07:24', '12:00') === 88 && openIndex('', undefined, '12:01') === 145, 'the list opens at the value, else the suggestion, else now');
    const q = quickTimes('07:02', '07:24');
    check(q[0].kind === 'suggested' && q[0].time === '07:24' && q[1].kind === 'now' && q[1].time === '07:05' && q.filter((x) => x.kind === 'common').length === COMMON_TIMES.length, 'the chips: the suggestion, Now, the common times');
    check(quickTimes('08:58').filter((x) => x.time === '09:00').length === 1, 'Now equal to a common time is not shown twice');
  }

  console.log('\nThe filters');
  {
    const defs: FilterDef[] = [
      { key: 'status', label: 'Status', kind: 'single', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'open', label: 'Open', count: 5 }, { value: 'resolved', label: 'Resolved' }] },
      { key: 'severity', label: 'Severity', kind: 'multi', options: [{ value: 'critical', label: 'Critical' }, { value: 'warning', label: 'Warning' }] },
    ];
    let v = defaultValues(defs);
    check(same(v, { status: 'active', severity: [] }) && activeCount(defs, v) === 0 && activeChips(defs, v).length === 0, 'the defaults: nothing in use, no badge, no chips');
    v = toggle(defs[0], v, 'open');
    v = toggle(defs[1], v, 'critical');
    v = toggle(defs[1], v, 'warning');
    check(activeCount(defs, v) === 2 && single(defs, v, 'status') === 'open' && same(multi(v, 'severity'), ['critical', 'warning']), 'a radio picks one, ticks add; the badge counts filters, not ticks');
    const chips = activeChips(defs, v);
    check(same(chips.map((c) => c.label), ['Open', 'Critical', 'Warning']), 'one chip per value in use');
    check(same(chips[1].remove, { status: 'open', severity: ['warning'] }) && same(chips[0].remove, { status: 'active', severity: ['critical', 'warning'] }), 'removing a chip leaves the rest');
    check(same(toggle(defs[1], v, 'critical').severity, ['warning']), 'a tick again unticks');
    check(same(clearValues(defs), { status: 'active', severity: [] }), 'Clear: every filter back to its default');
    check(isChosen(defs[0], { status: '', severity: [] }, 'active') && !isChosen(defs[1], v, 'other'), 'an empty single value is its default');
  }

  console.log('\nThe list states and the timeout');
  {
    check(listView({ loading: true, hasData: false, count: 0, error: false }) === 'skeleton', 'loading with nothing: skeleton rows');
    check(listView({ loading: false, hasData: false, count: 0, error: true }) === 'error', 'failed with nothing: the error with Try again');
    check(listView({ loading: false, hasData: true, count: 0, error: false }) === 'empty', 'an answer with no rows: the empty state');
    check(listView({ loading: false, hasData: true, count: 3, error: true }) === 'rows_stale', 'rows on screen and a failed refresh: the rows with "Couldn\'t refresh"');
    const slow = new Promise<string>((res) => setTimeout(() => res('late'), 200));
    let timedOut = false;
    try { await withTimeout(slow, 30); } catch (e) { timedOut = e instanceof TimeoutError; }
    check(timedOut, 'a call past its timeout ends as a TimeoutError (never a spinner for ever)');
    check(await withTimeout(Promise.resolve('ok'), 50) === 'ok', 'a call in time answers');
  }

  console.log('\nThe components and the place box as text');
  {
    const box = read('components/office/PlaceSearch.tsx');
    check(!box.includes('suggest.busy || suggest.failed) return;') && !box.includes('suggest.answer, suggest.busy, suggest.failed, api]'), 'the suggestions effect no longer depends on its own busy flag (the "Loading" for ever)');
    check(box.includes('const n = ++suggestSeq.current;') && box.includes('if (n === suggestSeq.current) setSuggest({ answer: a, busy: false, failed: false });') && box.includes('}, [canSearch, api, suggestTry]);'), 'one call per box, the latest answer shown, Try again re-asks');
    check(box.includes('withTimeout(api.call<SearchAnswer>(\'search_places\', suggestArgs(near)), SUGGEST_TIMEOUT_MS)') && box.includes('withTimeout(Location.getLastKnownPositionAsync(), POSITION_TIMEOUT_MS)') && box.includes('withTimeout(Location.getForegroundPermissionsAsync(), POSITION_TIMEOUT_MS)'), 'every step has a timeout: the position (3 s), the server (15 s)');
    check(box.includes('<SkeletonRows rows={3} lines={2} testID="place-search-skeleton" />') && box.includes("<ListError message={t('office.trip.suggestionsFailed')} onRetry={() => setSuggestTry((n) => n + 1)} />") && box.includes('testID="place-search-searching"'), 'skeleton rows while loading and searching; the error with Try again');
    const driverBox = read('components/PlaceSearch.tsx');
    check(driverBox.includes('withTimeout(driverApi.searchPlaces(text.trim(), session.current), SUGGEST_TIMEOUT_MS)') && driverBox.includes('<SkeletonRows'), 'the driver side\'s place box: a timeout and skeleton rows');
    const api = read('office/api.ts');
    check(api.includes('text = await res.text();') && api.indexOf('clearTimeout(timer);\n    }') > api.indexOf('text = await res.text();'), 'office-api calls: the timeout covers the body too');
    const filter = read('components/patterns/FilterBar.tsx');
    check(filter.includes('testID="filter-button"') && filter.includes('testID="filter-chip"') && filter.includes("onApply(draft); setOpen(false);") && filter.includes("setDraft(clearValues(defs))") && filter.includes('testID="sort-button"'), 'the filter bar: the button with its badge, chips, Apply only from the sheet, Clear, Sort apart');
    const cal = read('components/patterns/Calendar.tsx');
    check(cal.includes('export function DateRangeButton') && cal.includes('export function DayStrip') && cal.includes('export function TripDayPicker') && cal.includes('export function DateField') && cal.includes('setDraft((r) => tapDay(r, d))') && cal.includes('PanResponder.create'), 'the calendar: the range (two taps), the week strip (swipe), the trip day, a plain date');
    const time = read('components/patterns/TimeField.tsx');
    check(time.includes('quickTimes(now, suggested)') && time.includes('initialScrollIndex') && time.includes('TIME_STEPS'), 'the time sheet: the quick chips, the 5-minute list scrolled to the value');
    // The screens on the patterns (Stage 0): no typed time or date anywhere in the app.
    const when = read('app/office/trip/when.tsx');
    const change = read('app/office/task/[id]/time.tsx');
    const settings = read('app/office/people/settings.tsx');
    const ask = read('components/office/AskDriversSheet.tsx');
    const vform = read('app/office/vehicles/form.tsx');
    const avail = read('app/availability-edit.tsx');
    check(when.includes('<TripDayPicker value={f.date}') && !when.includes('pickDate') && when.includes('<TimeField') && when.includes('suggested={trip.preview?.leave_by?.slice(-5)}'), 'the trip editor\'s When: Today / Tomorrow / Pick a date (any date), the time sheet with the plan\'s leave-by suggested');
    check(change.includes('<TripDayPicker value={f.date}') && change.includes('<TimeField') && !change.includes('pickDate'), 'Change the task: the trip day picker and the time sheet');
    check(settings.includes('<TimeField') && !settings.includes('TimeInput'), 'Quick settings: the auto clock-out through the time sheet');
    check(ask.includes('<Sheet visible={visible}') && ask.includes('return <TimeField label={label} value={value} onCommit={onChange} />;') && !ask.includes('<Modal'), 'Ask drivers: the shared sheet and the time sheet');
    check(vform.includes("<DateField label={label} value={f[k] as string}") && !vform.includes("'YYYY-MM-DD'"), 'the vehicle form: dates on the calendar, never typed');
    check(avail.includes('<TripDayPicker value={form.from}') && avail.includes('<TimeField label={t(\'avail.from\')}') && avail.includes('min={form.from}'), 'the driver\'s availability: the day picker, the time sheet, the last day on the calendar from the first day');
    const appFiles = ['app/office/trip/when.tsx', 'app/office/task/[id]/time.tsx', 'app/office/people/settings.tsx', 'components/office/AskDriversSheet.tsx', 'app/office/vehicles/form.tsx', 'app/availability-edit.tsx'].map(read).join('\n');
    check(!/TimeInput|keyboardType="numbers-and-punctuation" maxLength=\{5\}/.test(appFiles), 'no typed HH:MM field left in these screens');
    const en = JSON.parse(read('i18n/en.json')) as { patterns: Record<string, string> };
    const si = JSON.parse(read('i18n/si.json')) as typeof en;
    const code = ['components/patterns/Sheet.tsx', 'components/patterns/ListState.tsx', 'components/patterns/FilterBar.tsx', 'components/patterns/Calendar.tsx', 'components/patterns/TimeField.tsx'].map(read).join('\n');
    const keys = Array.from(new Set(Array.from(code.matchAll(/'patterns\.([A-Za-z_]+)'/g)).map((m) => m[1]))).concat(PRESETS.map((p) => `preset_${p}`));
    const missing = keys.filter((k) => !en.patterns[k] || !si.patterns[k]);
    check(missing.length === 0 && keys.length > 20, `every patterns.* key in en and si (${keys.length})`, missing);
    const ph = (x: string) => (x.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
    check(keys.every((k) => ph(en.patterns[k] ?? '') === ph(si.patterns[k] ?? '')) && !/[෦-෯]/.test(Object.values(si.patterns).join(' ')), 'the same placeholders; Latin digits in Sinhala');
  }

  console.log(failures === 0 ? '\nAll pattern checks passed.' : `\n${failures} pattern check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
