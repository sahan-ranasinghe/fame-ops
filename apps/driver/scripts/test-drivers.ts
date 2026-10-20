// Office mode (Phase 8, O2): the Drivers board (design 12) and a driver's page, the rules of src/office/driversLogic.ts
// with made-up drivers_board, unavailability and driver_route answers, and how the tab, the page, the route map and its
// two engines are wired (read as text), without a phone. The strings live in src/i18n/parts/drivers.json until the lead
// merges them: this script reads no sidecar. Pure code, no stack needed:
//   npm run test:drivers          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BAND_COLORS, boardArgs, boardChoice, boardFilterDefs, BOARD_FILTERS, boardPill, coversDay, dayNumbers, entryParts, estimatedLines, heldPlate, HOLE_MIN, PARTS, REASONS, routeFrame, routeLines, routePoints, rowFrame, rowLines,
  segmentLine, segmentTone, SPEED_BANDS, speedBand, speedLines, stopMarks, unavailabilityInput, weekDays, weekGrid, type Words,
} from '../src/office/driversLogic';
import type { BoardDriver, DriverRoute, UnavailableEntry } from '../src/office/types';

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
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);
const day = (d: string) => `day(${d})`;

const driver = (over: Partial<BoardDriver> & Pick<BoardDriver, 'name' | 'status'>): BoardDriver => ({ free_now: false, licence: { chip: 'ok' }, ...over });
const sunil = driver({ name: 'Sunil', username: 'sunil', status: { kind: 'on_task', text: 'On a task till 10:40 · Team drop · Kurunegala' }, next_task: { title: 'Airport pickup', when: '15:00' }, vehicle: { reg_no: 'WP CAB-4521', source: 'on_duty' }, links: { call: 'tel:+9477' } });
const ruwan = driver({ name: 'Ruwan', username: 'ruwan', status: { kind: 'on_duty', text: 'On duty since 08:02 · free till 13:00' }, free_now: true, last_seen: 'Last seen 09:12 near Kelaniya', usual_start: '08:00', vehicle: { reg_no: 'WP PA-1200', source: 'on_duty' } });
const kamal = driver({ name: 'Kamal', username: 'kamal', status: { kind: 'on_duty', text: 'On duty · free all day · 0 tasks' }, free_now: true, last_seen: 'Last seen 09:10 near Kadawatha', vehicle: { reg_no: 'WP KV-7788', source: 'on_duty' } });
const nimal = driver({ name: 'Nimal', username: 'nimal', status: { kind: 'off_duty', text: 'Off duty' }, usual_start: '08:30', last_seen: 'Last seen Fri 17:52 near Ja-Ela', vehicle: { reg_no: 'WP KV-7788', source: 'regular' } });
const priyantha = driver({ name: 'Priyantha', username: 'priyantha', status: { kind: 'not_available', text: 'Not available · leave · back Wed 21' } });
const busy = driver({ name: 'Asela', username: 'asela', status: { kind: 'on_duty', text: 'On duty · next task 10:00' }, free_now: false });

console.log('\n== The chips, the pill and the dot ==');
{
  check(same(BOARD_FILTERS, ['all', 'free_now', 'on_task', 'off_duty', 'not_available']), 'All · Free now · On a task · Off duty · Not available, the tool\'s own filters');
  // The Filter sheet (docs/ui-patterns.md §1) and drivers_board's input: the same as the chips sent, the search only when typed.
  const bdefs = boardFilterDefs({ all: 5, free_now: 2, on_task: 1 }, (k) => k);
  check(bdefs.length === 1 && bdefs[0].default === 'all' && same(bdefs[0].options.map((o) => o.value), [...BOARD_FILTERS]) && bdefs[0].options[1].count === 2 && bdefs[0].options[3].count === undefined && bdefs[0].options[1].label === 'office.drivers.filter.free_now', 'the Filter sheet: the five filters with the server\'s counts');
  check(boardChoice({ filter: 'on_task' }) === 'on_task' && boardChoice({ filter: 'x' }) === 'all' && boardChoice({}) === 'all', 'the choice read back (anything unknown is All)');
  check(same(boardArgs('now', 'all'), { filter: 'all' }) && same(boardArgs('now', 'free_now', ' kam '), { filter: 'free_now', search: 'kam' }) && same(boardArgs('week', 'free_now'), {}) && same(boardArgs('week', 'all', 'kam'), { search: 'kam' }), 'drivers_board: Now with the filter, Week every driver; the search trimmed, only when typed');
  check(same(boardPill(sunil), { key: 'onTask', tone: 'blue' }), 'on a task: blue');
  check(same(boardPill(ruwan), { key: 'free', tone: 'green' }), 'on duty and free now: green');
  check(same(boardPill(busy), { key: 'onDuty', tone: 'muted' }), 'on duty but not free: grey "on duty"');
  check(same(boardPill(nimal), { key: 'offDuty', tone: 'muted' }), 'off duty: grey');
  check(same(boardPill(priyantha), { key: 'notAvailable', tone: 'red' }), 'not available: red');
}

console.log('\n== The two lines under the name ==');
{
  check(same(rowLines(sunil, t), ['On a task till 10:40 · Team drop · Kurunegala', 'office.drivers.next(15:00,Airport pickup)']), 'Sunil: the status, then Next: 15:00 Airport pickup', rowLines(sunil, t));
  check(same(rowLines(ruwan, t), ['On duty since 08:02 · free till 13:00', 'Last seen 09:12 near Kelaniya · office.drivers.starts(08:00)']), 'Ruwan: last seen · starts 08:00', rowLines(ruwan, t));
  check(same(rowLines(kamal, t), ['On duty · free all day · 0 tasks', 'Last seen 09:10 near Kadawatha']), 'Kamal: last seen alone', rowLines(kamal, t));
  check(same(rowLines(nimal, t), ['Off duty · office.drivers.usuallyStarts(08:30)', 'Last seen Fri 17:52 near Ja-Ela · office.drivers.regular(WP KV-7788)']), 'Nimal: usually starts after Off duty; the regular plate on the second line', rowLines(nimal, t));
  check(same(rowLines(priyantha, t), ['Not available · leave · back Wed 21', '']), 'Priyantha: the server\'s words, nothing on the second line', rowLines(priyantha, t));
  check(heldPlate(sunil) === 'WP CAB-4521' && heldPlate(ruwan) === 'WP PA-1200' && heldPlate(nimal) === null && heldPlate(priyantha) === null, 'the plate beside the name: the vehicle held today only');
}

console.log('\n== The week ==');
{
  const days = weekDays('2026-10-19');
  check(same(days, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']), 'seven days from today');
  const entry = (over: Partial<UnavailableEntry> & Pick<UnavailableEntry, 'id' | 'username' | 'day' | 'last_day' | 'part'>): UnavailableEntry =>
    ({ driver: over.username, from: `${over.day} 00:00`, to: `${over.last_day} 23:59`, reason: 'leave', reason_text: 'leave', text: 'Not available', added_by: 'Sahan', added: '09:00', ...over });
  const leave = entry({ id: 'e1', username: 'priyantha', day: '2026-10-19', last_day: '2026-10-21', part: 'full_day' });
  const half = entry({ id: 'e2', username: 'ruwan', day: '2026-10-22', last_day: '2026-10-22', part: 'afternoon', start_time: '13:00', reason: 'half_day', reason_text: 'half day', from: '2026-10-22 13:00' });
  const hours = entry({ id: 'e3', username: 'ruwan', day: '2026-10-22', last_day: '2026-10-22', part: 'hours', start_time: '09:00', end_time: '11:00', from: '2026-10-22 09:00' });
  const later = entry({ id: 'e4', username: 'kamal', day: '2026-10-27', last_day: '2026-10-27', part: 'full_day' });
  const stranger = entry({ id: 'e5', username: 'tharindu', driver: 'Tharindu', day: '2026-10-20', last_day: '2026-10-20', part: 'morning', end_time: '12:00' });
  const grid = weekGrid([sunil, ruwan, kamal, priyantha], [later, half, leave, hours, stranger], days);
  check(grid.map((r) => r.name).join() === 'Sunil,Ruwan,Kamal,Priyantha,Tharindu', 'the board\'s drivers in order, then a driver with an entry who is not on the board', grid.map((r) => r.name));
  const p = grid[3];
  check(p.cells.slice(0, 3).every((c) => c.mark === 'full') && p.cells.slice(3).every((c) => c.mark === 'none') && p.entries.length === 1, 'a three-day leave marks three cells full', p.cells.map((c) => c.mark));
  const r = grid[1];
  check(r.cells[3].mark === 'part' && r.cells[3].entries.length === 2 && r.entries.map((e) => e.id).join() === 'e3,e2', 'two part-day entries on one day: one part cell, both listed soonest first', r.cells[3]);
  check(grid[2].entries.length === 0 && grid[2].cells.every((c) => c.mark === 'none'), 'an entry after the week is not in it');
  check(grid[4].cells[1].mark === 'part', 'the stranger\'s morning on Tuesday');
  check(coversDay(leave, '2026-10-21') && !coversDay(leave, '2026-10-22'), 'coversDay: the first to the last day');
  check(same(entryParts(leave, day, t), ['day(2026-10-19) – day(2026-10-21)', 'leave', 'office.drivers.part.full_day']), 'a range: first – last · leave · Full day', entryParts(leave, day, t));
  check(same(entryParts(half, day, t), ['day(2026-10-22)', 'half day', 'office.drivers.part.afternoonFrom(13:00)']), 'an afternoon: from 13:00');
  check(same(entryParts(hours, day, t), ['day(2026-10-22)', 'leave', '09:00–11:00']), 'hours: 09:00–11:00');
  check(same(entryParts(stranger, day, t), ['day(2026-10-20)', 'leave', 'office.drivers.part.morningTill(12:00)']), 'a morning: back 12:00');
  check(entryParts({ ...hours, note: ' sick ' }, day, t).slice(-1)[0] === 'sick', 'the note last, trimmed');
}

console.log('\n== Not available: the input ==');
{
  const base = { driver: 'ruwan', date: '2026-10-22', part: 'full_day' as const, reason: 'leave' as const };
  check(same(unavailabilityInput(base), { ok: true, input: { driver: 'ruwan', date: '2026-10-22', part: 'full_day', reason: 'leave' } }), 'a full day', unavailabilityInput(base));
  check(same(unavailabilityInput({ ...base, toDate: '2026-10-24', note: '  trip  ' }), { ok: true, input: { driver: 'ruwan', date: '2026-10-22', part: 'full_day', reason: 'leave', to_date: '2026-10-24', note: 'trip' } }), 'full days to a later day (to_date), the note trimmed');
  check(same(unavailabilityInput({ ...base, toDate: '2026-10-22' }), { ok: true, input: { driver: 'ruwan', date: '2026-10-22', part: 'full_day', reason: 'leave' } }), 'the same last day: no to_date');
  check(same(unavailabilityInput({ ...base, toDate: '2026-10-21' }), { ok: false, problem: 'toDate' }), 'a last day before the day: refused');
  check(same(unavailabilityInput({ ...base, part: 'afternoon', toDate: '2026-10-24' }), { ok: true, input: { driver: 'ruwan', date: '2026-10-22', part: 'afternoon', reason: 'leave' } }), 'to_date only for full days');
  check(same(unavailabilityInput({ ...base, part: 'hours', from: '09:00', to: '11:00', reason: 'personal' }), { ok: true, input: { driver: 'ruwan', date: '2026-10-22', part: 'hours', reason: 'personal', from: '09:00', to: '11:00' } }), 'hours with from and to');
  check(same(unavailabilityInput({ ...base, part: 'hours', from: '09:00' }), { ok: false, problem: 'hours' }) && same(unavailabilityInput({ ...base, part: 'hours', from: '11:00', to: '09:00' }), { ok: false, problem: 'hours' })
    && same(unavailabilityInput({ ...base, part: 'hours', from: '9:00', to: '11:00' }), { ok: false, problem: 'hours' }), 'hours without to, to before from, or a bad time: refused');
  check(same(unavailabilityInput({ ...base, date: '22/10' }), { ok: false, problem: 'date' }) && same(unavailabilityInput({ ...base, driver: ' ' }), { ok: false, problem: 'driver' }), 'a bad day or no driver: refused');
  const long = unavailabilityInput({ ...base, note: 'x'.repeat(400) });
  check(long.ok && (long.input.note as string).length === 300, 'the note at most 300');
  check(same(PARTS, ['full_day', 'morning', 'afternoon', 'hours']) && same(REASONS, ['leave', 'half_day', 'personal', 'other']), 'the parts and the reasons, the server\'s');
}

console.log('\n== The route: the bands ==');
{
  check(same(SPEED_BANDS, ['standing', 'slow', 'mid', 'fast']), 'four bands');
  check(speedBand(0) === 'standing' && speedBand(2.9) === 'standing' && speedBand(3) === 'slow' && speedBand(19.9) === 'slow' && speedBand(20) === 'mid' && speedBand(60) === 'mid' && speedBand(60.1) === 'fast',
    'standing under 3, slow under 20, 20–60, over 60');
  check(speedBand(null) === 'mid' && speedBand(undefined) === 'mid' && speedBand(NaN) === 'mid', 'an unknown speed is drawn as 20–60');
  check(BAND_COLORS.standing === '#8d9096' && BAND_COLORS.slow === '#f2a900' && BAND_COLORS.mid === '#1e4fa0' && BAND_COLORS.fast === '#0f2d66' && BAND_COLORS.gap === '#8d9096' && BAND_COLORS.estimated === '#5d646c',
    'grey, amber, blue, dark blue; a hole grey, an estimated road slate');
}

const at = (hhmmss: string) => `2026-10-19T${hhmmss}+05:30`;
const route: DriverRoute = {
  driver: 'Sunil', date: '2026-10-19', recorded_points: 7, km: 14.26, driving_minutes: 41, stopped_minutes: 22, stops_count: 1,
  route: {
    columns: ['time', 'lat', 'lng', 'km/h', 'at', 'acc'],
    points: [
      ['09:00:00', 6.90, 79.90, 0, at('09:00:00'), 8],
      ['09:00:30', 6.901, 79.901, 12, at('09:00:30'), 8],
      ['09:01:00', 6.902, 79.902, 35, at('09:01:00'), 8],
      ['09:01:30', 6.903, 79.903, 45, at('09:01:30'), 8],
      ['09:02:00', 6.904, 79.904, 70, at('09:02:00'), 8],
      ['09:10:00', 6.95, 79.95, 0, at('09:10:00'), 8], // 8 min later: a hole
      ['09:10:30', 6.951, 79.951, 0, at('09:10:30'), 8],
      ['bad', 'x', 79.9, 0, at('09:11:00'), 8],
    ],
  },
  stops_over_10_min: [{ from: '09:10', to: '09:32', minutes: 22, near: 'Kadawatha', lat: 6.95, lng: 79.95 }, { from: '12:00', to: '12:15', minutes: 15 }],
  estimated: [{ from_at: at('09:02:00'), to_at: at('09:10:00'), from: '09:02', to: '09:10', points: [[6.904, 79.904], [6.93, 79.93], [6.95, 79.95]] }, { from_at: 'x', to_at: 'y', from: '', to: '', points: [[1, 2]] }],
  timeline: [
    { kind: 'driving', from: '09:00', to: '09:02', from_at: at('09:00:00'), to_at: at('09:02:00'), minutes: 2, km: 0.6, text: 'Driving · 0.6 km' },
    { kind: 'no_data', from: '09:02', to: '09:10', from_at: at('09:02:00'), to_at: at('09:10:00'), minutes: 8, text: 'App not running' },
    { kind: 'stopped', from: '09:10', to: '09:32', from_at: at('09:10:00'), to_at: at('09:32:00'), minutes: 22, lat: 6.95, lng: 79.95, near: 'Kadawatha', text: 'Stopped 22 min near Kadawatha', uploaded: '09:40' },
  ],
};

console.log('\n== The route: the points, the legs, the stops, the frames ==');
{
  const points = routePoints(route);
  check(points.length === 7 && points[0].time === '09:00:00' && points[0].kmh === 0 && points[0].at === Date.parse(at('09:00:00')), 'the points by column name; a row without a position is skipped', points.length);
  const old = routePoints({ date: '2026-10-19', route: { columns: ['time', 'lat', 'lng', 'km/h'], points: [['09:00:00', 6.9, 79.9, 5]] } });
  check(old.length === 1 && old[0].at === Date.parse(at('09:00:00')), 'an older answer without the ISO column: the time on the day (Colombo)');
  check(routePoints({ date: '2026-10-19' }).length === 0 && routePoints({ date: '2026-10-19', route: { columns: ['x'], points: [[1]] } }).length === 0, 'no line, or no lat/lng columns: nothing');
  const legs = speedLines(points);
  check(legs.map((l) => l.band).join() === 'slow,mid,fast,gap,standing', 'the legs: slow (0→12), 20–60 (12→35, 35→45 joined), fast (45→70), a hole, standing', legs.map((l) => l.band));
  check(legs[1].points.length === 3 && legs[0].points.length === 2, 'legs of one band are joined, sharing the joint point');
  check(legs[3].dashed && legs[3].points.length === 2 && !legs[0].dashed, 'the hole dashed, the rest solid');
  check(speedLines(points, 10).every((l) => l.band !== 'gap'), 'a wider hole rule: no hole');
  check(HOLE_MIN === 2, 'a hole is over 2 minutes, as the server\'s holes');
  check(speedLines([]).length === 0 && speedLines(points.slice(0, 1)).length === 0, 'under two points: no line');
  const est = estimatedLines(route);
  check(est.length === 1 && est[0].band === 'estimated' && est[0].dashed && est[0].points.length === 3, 'the estimated road over the gap, dashed; one point is no line');
  const all = routeLines(route);
  check(all[0].band === 'estimated' && all.length === 6, 'the estimated roads under the day\'s line');
  const stops = stopMarks(route);
  check(stops.length === 1 && stops[0].time === '09:10' && stops[0].minutes === 22 && stops[0].near === 'Kadawatha', 'a stop with a position as a circle with its time; one without is not drawn', stops);
  const fit = routeFrame(all, stops);
  check(fit.frame.kind === 'box' && fit.frame.sw.lat === 6.9 && fit.frame.ne.lng === 79.951, 'the frame around the line and the stops', fit.frame);
  check(routeFrame(all, stops).key === fit.key && routeFrame(all.slice(1), stops).key !== fit.key, 'the key follows the points shown');
  check(routeFrame([], []).frame.kind === 'none', 'nothing: no frame');
  const seg = route.timeline![0];
  const f = rowFrame(points, seg);
  check(f.kind === 'box' && f.sw.lat === 6.9 && f.ne.lat === 6.904, 'a driving row: the box around its points', f);
  const s = rowFrame(points, route.timeline![2]);
  check(s.kind === 'point' && Math.abs(s.center.lat - 6.9505) < 1e-9, 'a stop row: its two points as one place (the midpoint)', s);
  check(rowFrame([], route.timeline![2]).kind === 'point' && rowFrame([], { kind: 'no_data', from_at: 'x', to_at: 'y' }).kind === 'none', 'no points: the row\'s own position, else nothing');
  check(same(dayNumbers(route), { km: 14.3, drivingMin: 41, stoppedMin: 22, stops: 1 }), 'the day\'s numbers', dayNumbers(route));
  check(same(dayNumbers({}), { km: null, drivingMin: 0, stoppedMin: 0, stops: 0 }), 'nothing yet: km unknown');
  check(segmentTone('driving') === 'blue' && segmentTone('stopped') === 'muted' && segmentTone('no_gps') === 'amber' && segmentTone('no_data') === 'red', 'the timeline\'s marks');
  check(segmentLine(seg, t) === '09:00–09:02 · dur.minutes(2) · 0.6 common.km', 'a driving row: the span, the minutes, the km', segmentLine(seg, t));
  check(segmentLine(route.timeline![2], t) === '09:10–09:32 · dur.minutes(22) · office.drivers.uploadedLater(09:40)', 'a stop uploaded later: no km, the upload time', segmentLine(route.timeline![2], t));
}

const page0 = () => read('src/app/office/driver/[username].tsx');
console.log('\n== The tab, the page, the map and its two engines (read as text) ==');
{
  const tab = read('src/app/office/(tabs)/drivers.tsx');
  check(/useTool<DriversBoard>\('drivers_board', boardArgs\(view, filter, search\), \{ every: EVERY_MS \}\)/.test(tab) && /const EVERY_MS = 60_000;/.test(tab), 'drivers_board with the Filter sheet\'s choice as its filter (every driver in Week) and the search, every 60 s');
  check(/useTool<UnavailabilityList>\('unavailability', \{ from: today, to: addDays\(today, 6\) \}, \{ every: EVERY_MS, enabled: view === 'week' \}\)/.test(tab), 'unavailability from today to +6, only in Week');
  check(/const mayAsk = me\.tools\.includes\('ask_drivers'\);/.test(tab) && /const mayAdd = me\.tools\.includes\('set_unavailability'\);/.test(tab) && /const mayRemove = me\.tools\.includes\('remove_unavailability'\);/.test(tab),
    'Ask drivers, + Not available and Remove by the person\'s tools');
  check(/\{mayAsk && \(\s*<AskBar/.test(tab) && /onAdd=\{mayAdd && row\.username \? /.test(tab) && /onRemove=\{mayRemove \? confirmRemove : undefined\}/.test(tab), 'none of the three is shown to someone who may not (no dead UI)');
  check(/Alert\.alert\(t\('office\.drivers\.removeTitle'\)/.test(tab) && /api\.call\('remove_unavailability', \{ id: e\.id \}\)/.test(tab), 'Remove asks first, then remove_unavailability');
  check(/api\.call<SetUnavailabilityResult>\('set_unavailability', checked\.input\)/.test(tab) && /unavailabilityInput\(form\)/.test(tab), 'the sheet sends the logic\'s input through set_unavailability');
  check(/<Sheet\s+visible=\{visible\}/.test(tab) && !/<Modal/.test(tab), 'the Not available sheet is the one bottom sheet (the back button closes it)');
  check(/<TripDayPicker value=\{date\}/.test(tab) && /<DateField label=\{t\('office\.drivers\.lastDay'\)\} value=\{toDate\}/.test(tab) && /<TimeField label=\{t\('office\.drivers\.from'\)\} value=\{from\} onCommit=\{setFrom\}/.test(tab) && /<TimeField label=\{t\('office\.drivers\.to'\)\} value=\{to\} onCommit=\{setTo\}/.test(tab) && !/placeholder="HH:MM"/.test(tab),
    'the sheet: the day as Today / Tomorrow / Pick a date, until as a date field, from–to in the time sheet (no typed times)');
  check(/router\.push\(\{ pathname: '\/office\/driver\/\[username\]', params: \{ username: d\.username \} \}\)/.test(tab), 'a row opens the driver\'s page');
  check(/<FilterBar/.test(tab) && /defs=\{view === 'now' \? boardFilterDefs\(board\.data\?\.counts, t\) : \[\]\}/.test(tab) && !/FilterChips|ScrollView horizontal/.test(tab), 'the search bar and one Filter button with the server\'s counts (Now only), no chip row');
  check(/<SkeletonRows/.test(tab) && /<ListFailed/.test(tab) && !/<Loading/.test(tab) && /<SkeletonRows/.test(page0()) && !/<Loading/.test(page0()), 'skeleton rows while loading, the error with Try again (the tab and the driver\'s page)');
  check(/callBtn: \{ width: 48, height: 48/.test(tab) && /segBtn: \{ minWidth: 72, minHeight: 40/.test(tab) && /cell: \{ width: 40, height: 40/.test(tab), 'the Call button 48 px; the week\'s cells 40 px');
  check(!/me\.role|role ===|'admin'|'fleet_admin'/.test(tab), 'no role names');

  const page = read('src/app/office/driver/[username].tsx');
  check(/useTool<DriverProfile>\('driver_profile', \{ driver: username \}\)/.test(page), 'driver_profile by username');
  check(page.includes("me.tools.includes('create_task')") && page.includes("params: { mode: 'task', driver: username, name: d.name }") && page.includes('testID="driver-new-task"'), 'New task for this driver (O3 row 7: from a row of the board, two taps), with create_task');
  {
    const where = read('src/app/office/trip/where.tsx');
    const logic = read('src/office/trip/draftLogic.ts');
    check(where.includes("withDriver(newDraft(m), m === 'task' ? forDriver : undefined, forName)") && logic.includes('export function withDriver') && read('src/app/office/trip/who.tsx').includes('x.fields.driver ? x :'),
      'Assign a task opens with the driver picked (the Who step keeps them; the best match never replaces them)');
  }
  check(/useTool<DriverRoute>\('driver_route', dayRouteArgs\(username, day\), \{ enabled: mayRoute, every: routeEvery\(day, today\) \}\)/.test(page) && /const mayRoute = me\.tools\.includes\('driver_route'\);/.test(page),
    'driver_route for the chosen day (tolerance 0, 3,000 points, the estimated roads: historyLogic dayRouteArgs), today every minute, only when the person may');
  check(/useTool<DriversBoard>\('drivers_board', \{ search: username \}, \{ enabled: mayBoard, every: 60_000 \}\)/.test(page), 'today\'s state from the board\'s row, only when the person may read the board');
  check(/<BackHeader title=\{d\?\.name \?\? username\}/.test(page), 'a stack screen with the back header (back means back)');
  check(/<RouteMap lines=\{lines\} stops=\{stops\} fit=\{fit\} focus=\{focus\} marker=\{marker\} mapPackage=\{mapPackage\} \/>/.test(read('src/components/office/DayRoute.tsx')) && /<DayRoute\b/.test(page), 'the map (components/office/DayRoute.tsx) gets the lines, the stops, the frame, the focus, the playback marker and the office\'s map package');
  check(/setFocus\(\{ frame: rowFrame\(points, seg\), nonce: \(focus\?\.nonce \?\? 0\) \+ 1, index: i \}\)/.test(read('src/components/office/DayRoute.tsx')), 'a timeline row tapped moves the map to its span (again on a second tap)');
  check(/links\.call && <Action/.test(page) && /links\.whatsapp && <Action/.test(page) && /p\.emergency\.links\?\.call &&/.test(page), 'Call and WhatsApp only when the server gave the link');
  check(/p\?\.emergency &&/.test(page) && /p\?\.licence\?\.number/.test(page) && /p\?\.private_hidden/.test(page), 'the private part only when the answer carries it');
  check(/mayRemove && \(/.test(page) && /api\.call\('remove_unavailability', \{ id: e\.id \}\)/.test(page) && /Alert\.alert\(t\('office\.drivers\.removeTitle'\)/.test(page), 'Remove on the page too, after a confirmation, only when allowed');
  check(/<PlaybackBar playback=\{playback\} cursor=\{marker\} \/>/.test(read('src/components/office/DayRoute.tsx')), 'one playback bar (Stage 1, O3 item 1: the shared bar, as on Live)');
  check(SPEED_BANDS.every((b) => read('src/components/office/DayRoute.tsx').includes(`BAND_COLORS[b]`)) || /SPEED_BANDS\.map\(\(b\) => <LegendItem key=\{b\} color=\{BAND_COLORS\[b\]\}/.test(read('src/components/office/DayRoute.tsx')), 'the legend from the bands');

  const map = read('src/components/RouteMap.tsx');
  check(/import \{ GoogleRouteMap \} from '\.\/GoogleRouteMap'/.test(map) && /import \{ OpenRouteMap \} from '\.\/OpenRouteMap'/.test(map) && !/require\(/.test(map), 'RouteMap carries both engines in every build (no conditional require)');
  check(/engineFor\(GOOGLE_MAP_BUILD, mapPackage \?\? settings\.map_package, failed\)/.test(map), 'the engine: the build, the office\'s package (else the phone\'s setting), Google\'s failure this session');
  check(/if \(step\.googleFailed\) mapSession\.markGoogleFailed\(Date\.now\(\)\)/.test(map) && /class MapBoundary/.test(map) && /mount\.status === 'unavailable'/.test(map), 'a failed Google map moves this phone to the free map; a map that throws is a failed map; "Map not available" with Try again');
  check(/if \(mount\.status !== 'loading' \|\| !focused \|\| !active\) return;/.test(map) && /useIsFocused\(\)/.test(map), 'the wait runs only while the screen is in front and the app on screen');
  check(/routeCredit\(mount\.engine === 'google', parts\.lines\)/.test(map) && /ORS_CREDIT/.test(map) && /OSM_CREDIT/.test(map) && /testID="route-map-credit"/.test(map), 'the credits: OpenFreeMap on the free map, openrouteservice when an estimated road is drawn');
  check(/t\('map\.unavailable'\)/.test(map) && /t\('map\.tryAgain'\)/.test(map), 'the card reuses the map\'s own strings');

  const google = read('src/components/GoogleRouteMap.tsx');
  const open = read('src/components/OpenRouteMap.tsx');
  for (const [name, src, loaded] of [['Google', google, /onMapLoaded=\{onLoaded\}/], ['free', open, /onDidFinishLoadingMap=\{onLoaded\}/]] as const) {
    check(/: RouteEngineProps\)/.test(src) && loaded.test(src) && /<RouteStopPin stop=\{s\} \/>/.test(src) && /ROUTE_ZOOM/.test(src) && /<MapCompass/.test(src) && /BAND_COLORS\[l\.band\]/.test(src) && /lineWidth\(l\)/.test(src),
      `the ${name} map: the same stops and colours, its loaded signal, the move to a row, the compass`);
  }
  check(/PROVIDER_GOOGLE/.test(google) && !/googleMapId|mapId=/.test(google) && /lineDashPattern=\{l\.dashed \? \[12, 10\] : undefined\}/.test(google) && /tracksViewChanges=\{false\}/.test(google),
    "Google's map: PROVIDER_GOOGLE, no map id, the dashed legs dashed, the stop's picture taken once");
  check(/onDidFailLoadingMap=\{onFailed\}/.test(open) && /tiles\.openfreemap\.org\/styles\/liberty/.test(open) && /'line-dasharray': \[2, 1\.5\]/.test(open) && /\['get', 'color'\]/.test(open) && /filter=\{\['==', \['get', 'dashed'\], true\]\}/.test(open),
    'the free map: OpenFreeMap, no key; its failure said; a colour per leg, the dashed legs on their own layer');
  check(/if \(!ready \|\| focusedRow\) return;/.test(google) && /if \(!focusedRow\) setStop\(framed\);/.test(open), 'the frame around the day is skipped while a row is focused (both engines)');
  check(/anchor=\{\{ x: 0\.5, y: routePinAnchorY\(\) \}\}/.test(google) && /anchor="top" offset=\{\[0, -ROUTE_PIN\.circle \/ 2\]\}/.test(open), 'the stop circle\'s centre sits on the position on both maps, label or not');
  const sizes = map.match(/ROUTE_PIN = \{ circle: (\d+), gap: (\d+), label: (\d+) \}/);
  const [circle, gap, label] = sizes ? sizes.slice(1).map(Number) : [0, 0, 0];
  check(!!sizes && /return ROUTE_PIN\.circle \/ 2 \/ \(ROUTE_PIN\.circle \+ ROUTE_PIN\.gap \+ ROUTE_PIN\.label\);/.test(map) && Math.abs(circle / 2 / (circle + gap + label) - 9 / 38) < 1e-9,
    'the anchor: the circle\'s centre over an 18 px label and a 2 px gap', sizes?.slice(1));
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Drivers board checks passed.');
process.exit(failed ? 1 : 0);
