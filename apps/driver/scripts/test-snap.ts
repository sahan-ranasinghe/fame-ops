// Round 48 item 5: snap to roads in Office mode and /m/ (src/office/snapLogic.ts) and how the screens, the chip and the two
// map engines are wired, without a phone. The pattern: Google Maps Timeline's road-aligned line, Strava's snap-to-roads
// toggle. Pure code, no stack needed:
//   npm run test:snap          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { routeArgs, routeOf, type RoutePoint } from '../src/office/liveRouteLogic';
import { drawnLine, snapAllowed, snapControl, snapNoteKey, snappedPointsOf, snapView, withSnap } from '../src/office/snapLogic';
import { dayRouteArgs, taskRouteArgs } from '../src/office/historyLogic';
import type { DriverRoute } from '../src/office/types';

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

console.log('\n== Where snap is asked: the engine and the package (rule 10) ==');
{
  check(snapAllowed('google', 'google') === true, "Google's map under the google package: asked (Google's Roads lines on Google's map)");
  check(snapAllowed('open', 'google') === false, "the free map under the google package (Google's failed on this phone, or not in the build): never asked (its snapping would be Google's)");
  check(snapAllowed('open', 'open') === true, 'the free map under the open package: asked (the server snaps with OSRM when set, never Google)');
  check(snapAllowed('open', undefined) === false && snapAllowed('google', undefined) === true, 'no package known (an older /me): only on Google\'s map');
  check(same(withSnap(routeArgs('sunil'), true), { driver: 'sunil', line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true, snap: true }), 'the shown route with snap: true');
  check(withSnap(routeArgs('sunil'), false) === routeArgs('sunil') || same(withSnap(routeArgs('sunil'), false), routeArgs('sunil')), 'without: the call exactly as before (never snap: false)');
  check(same(withSnap(dayRouteArgs('kamal', '2026-10-19'), true), { driver: 'kamal', date: '2026-10-19', line_tolerance_m: 0, max_line_points: 3000, estimate_gaps: true, snap: true }), "a driver's day with snap");
  check(!('snap' in withSnap(taskRouteArgs('t1'), false)) && 'snap' in withSnap(taskRouteArgs('t1'), true), "a task's route with and without");
}

// ---- A made-up answer: the raw line and the snapped one -----------------------------------------------------------------
const DATE = '2026-10-19';
const atMs = (hhmm: string) => Date.parse(`${DATE}T${hhmm}:00+05:30`);
const iso = (hhmm: string) => new Date(atMs(hhmm)).toISOString();
const raw: (string | number | null)[][] = [
  ['08:00', 6.9, 79.9, 0, iso('08:00'), 10],
  ['08:02', 6.905, 79.905, 35, iso('08:02'), 8],
  ['08:04', 6.912, 79.912, 65, iso('08:04'), 9],
  ['08:10', 6.95, 79.95, 40, iso('08:10'), 11],
];
const snappedRows: (string | number | null)[][] = [
  ['08:00', 6.9, 79.9, 0, iso('08:00'), 10, 1],
  ['08:01', 6.9021, 79.9018, 30, iso('08:01'), null, 1],
  ['08:02', 6.9049, 79.9051, 35, iso('08:02'), 8, 1],
  ['08:03', 6.9085, 79.9088, 60, iso('08:03'), null, 1],
  ['08:04', 6.912, 79.912, 65, iso('08:04'), 9, 1],
  ['08:10', 6.95, 79.95, 40, iso('08:10'), 11, 0],
];
const answer: DriverRoute = {
  driver: 'Sunil Perera', date: DATE, recorded_points: 40, points_shown: 4, first_point: '08:00', last_point: '08:10', km: 8.4,
  route: { columns: ['time', 'lat', 'lng', 'km/h', 'at', 'acc'], points: raw },
  route_snapped: { columns: ['time', 'lat', 'lng', 'km/h', 'at', 'acc', 'snapped'], points: snappedRows },
  snapped: { provider: 'google_roads', status: 'ok', legs: 1, matched: 1 },
};

console.log('\n== The line drawn ==');
{
  const route = routeOf('sunil', answer);
  const snapped = snappedPointsOf(answer)!;
  check(snapped.length === 6 && snapped[1].at === atMs('08:01') && snapped[1].lat === 6.9021 && snapped[1].kmh === 30, 'the snapped line read from route_snapped (its own columns, the road vertices with their times)', snapped[1]);
  check(snappedPointsOf({ date: DATE }) === null && snappedPointsOf({ date: DATE, route_snapped: { columns: [], points: [] } }) === null, 'no route_snapped (not asked, the cap, no provider): null');
  const on = drawnLine(route.points, snapped, true);
  check(on.length === 6 && on.every((p, i) => i === 0 || p.at > on[i - 1].at), 'on: the snapped line is the line drawn', on.length);
  const later: RoutePoint = { at: atMs('08:12'), lat: 6.96, lng: 79.96, kmh: 30 };
  const grown = drawnLine([...route.points, later], snapped, true);
  check(grown.length === 7 && grown[6].at === later.at, 'a recorded point after the snapped line\'s end is drawn after it (the merged line reaches further)');
  check(same(drawnLine(route.points, snapped, false), route.points) && same(drawnLine(route.points, null, true), route.points), 'off, or no snapped line: the recorded points');
  check(route.km === 8.4 && routeOf('sunil', snapView(answer, true)).km === 8.4, "the km stay the server's (the odometer, the raw points), never the snapped line's");
  const view = snapView(answer, true);
  check(view.route === answer.route_snapped && view.km === 8.4 && snapView(answer, false).route === answer.route, "the day's view: route_snapped in the route's place when on; the answer as it is when off");
  check(snapView({ ...answer, route_snapped: undefined }, true).route === answer.route, 'no snapped line in the answer: the raw one');
}

console.log('\n== The chip and the note ==');
{
  const info = (status: 'off' | 'ok' | 'partial' | 'failed', provider = 'google_roads') => ({ provider, status });
  check(same(snapControl(info('ok'), true, true), { toggle: true, on: true, note: 'snapped' }), 'snapped: the chip on, "Snapped to roads · km from the odometer"');
  check(same(snapControl(info('partial'), true, true), { toggle: true, on: true, note: 'partly' }), 'some legs raw: said so');
  check(same(snapControl(info('failed'), true, true), { toggle: true, on: true, note: 'failed' }), 'the cap or an error: the GPS line, said so; the chip stays as asked');
  check(same(snapControl(info('off'), true, true), { toggle: true, on: true, note: 'gps' }), 'the answer before the snapped one lands: the GPS line');
  check(same(snapControl(info('ok'), true, false), { toggle: true, on: false, note: 'gps' }), 'the chip off: the GPS line, whatever the server sent');
  check(same(snapControl(info('ok'), false, true), { toggle: false, on: false, note: 'gps' }), "the free map in Google's place: no chip, the GPS line said (the snapped line is dropped at once)");
  check(same(snapControl(info('off', 'none'), true, true), { toggle: false, on: false, note: null }) && same(snapControl(undefined, true, true), { toggle: false, on: false, note: null }),
    'no provider on the server (the open package without OSRM, Google\'s roads cap at 0), or no answer yet: nothing new on the screen');
  check(same(snapControl(info('ok', 'osrm'), true, true), { toggle: true, on: true, note: 'snapped' }), 'OSRM under the open package: the same chip and words');
  check(snapNoteKey('snapped') === 'office.live.snap_snapped' && snapNoteKey('gps') === 'office.live.snap_gps', 'the notes\' keys');
}

console.log('\n== The screens, the chip and both engines ==');
{
  const chip = read('src/components/office/SnapChip.tsx');
  check(/useRouteMapEngine\(mapPackage\)/.test(chip) && /snapAllowed\(engine, mapPackage\)/.test(chip) && /useState\(true\)/.test(chip) && !/AsyncStorage|expo-sqlite|SecureStore/.test(chip),
    'useSnap: allowed from the engine shown now and the package (Google failing mid-screen moves it to the free map and drops the snapped line); default on; no storage');
  check(/accessibilityRole="switch"/.test(chip) && /accessibilityState=\{\{ checked: on \}\}/.test(chip) && /office\.live\.snapOn/.test(chip) && /office\.live\.snapOff/.test(chip),
    'the chip is a switch (not a selection), "Snapped to roads" / "GPS line"');
  const day = read('src/components/office/DayRoute.tsx');
  check(/snapView\(data, snapOn\)/.test(day) && /routePoints\(shown\)/.test(day) && /routeLines\(shown\)/.test(day) && /routeOf\(shown\.driver, shown\)/.test(day) && /dayNumbers\(data\)/.test(day) && /daySummary\(data\)/.test(day),
    "DayRoute draws and plays the snapped view; the summary's numbers come from the answer as the server sent it");
  check(/controls=\{snap && snapUi\.toggle && points\.length > 0 \? <SnapChip on=\{snapUi\.on\} onChange=\{snap\.setWanted\} \/> : null\}/.test(day) && /testID="snap-note"/.test(day),
    'the chip over the map (RouteMap controls), the note in the legend row');
  for (const f of ['src/components/RouteMap.tsx', 'src/components/RouteMap.web.tsx']) {
    const s = read(f);
    check(/controls\?: ReactNode;/.test(s) && /testID="route-map-controls">\{controls\}/.test(s) && s.indexOf("mount.status === 'unavailable'") < s.indexOf('testID="route-map-controls"'),
      `${f}: the controls cluster under the compass, only over a mounted map`);
  }
  for (const [f, args] of [['src/app/office/driver/[username]/route.tsx', 'withSnap(dayRouteArgs(username, day), snap.on)'], ['src/app/office/task/[id]/route.tsx', 'withSnap(taskRouteArgs(id), snap.on)']] as const) {
    const s = read(f);
    check(s.includes(args) && /const snap = useSnap\(me\.map\?\.package\);/.test(s) && /snap=\{snap\}/.test(s) && /const \[held, setHeld\] = useState<DriverRoute \| null>\(null\);/.test(s),
      `${f}: driver_route with snap where allowed; the chip's state to DayRoute; the last answer kept while the next loads`);
  }
  const live = read('src/app/office/(tabs)/live.tsx');
  check(/withSnap\(routeArgs\(who\), snapOn\)/.test(live) && /withSnap\(routeArgs\(shownUser\), snapOn\)/.test(live) && /api\.call<DriverRoute>\('driver_route', routeArgs\(u\)\)/.test(live),
    "Live: the shown route and its refresh with snap where allowed; a trail never (only a route a person opens is snapped)");
  check(/snapControl\(snapHere\?\.info, snap\.allowed, snap\.wanted\)/.test(live) && /drawnLine\(shownRoute\.points, snapHere\.points, true\)/.test(live) && /drawingOf\(drawnRoute, t\)/.test(live) && /playbackPath\(drawnRoute\.points, drawnRoute\.estimated\)/.test(live)
    && /routeSummary\(route\.route, t\)/.test(live),
    "Live draws and plays the line drawn (snapped when on); the card's numbers stay the route's");
  check(/<SnapChip on=\{snapUi\.on\} onChange=\{snap\.setWanted\} testID="live-snap-chip" \/>/.test(live) && /\{trailsPill\}\s*\{snapChip\}/.test(live) && /testID="live-snap-note"/.test(live),
    "the chip in the map's cluster beside the trails' pill (with fit everyone: at most three), the note on the card");
  const profile = read('src/app/office/driver/[username].tsx');
  check(!/snap/i.test(profile), "the profile's Today's route card draws no line: no snap asked (nothing to draw)");
  const logic = read('src/office/snapLogic.ts');
  check(/Google Maps Timeline/.test(logic) && /Strava/.test(logic), 'the pattern named');
  check(!/snap|route_snapped/.test(read('src/office/liveRouteLogic.ts').replace(/^\/\/.*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '')), 'the Live rules stay engine-neutral: the snap rules live in office/snapLogic.ts');
  const parts = read('src/office/types.ts');
  check(/route_snapped\?: \{ columns: string\[\]; points: \(string \| number \| null\)\[\]\[\] \};/.test(parts) && /snapped\?: \{ provider: string; status: "off" \| "ok" \| "partial" \| "failed"/.test(parts), "the tool's answer typed");
}

console.log('\n== Strings ==');
{
  const en = JSON.parse(read('src/i18n/en.json')) as { office: { live: Record<string, string>; retention: { rule: Record<string, string> } } };
  const si = JSON.parse(read('src/i18n/si.json')) as { office: { live: Record<string, string>; retention: { rule: Record<string, string> } } };
  const keys = ['snapToggle', 'snapOn', 'snapOff', 'snap_snapped', 'snap_partly', 'snap_failed', 'snap_gps'];
  const missing = keys.filter((k) => !en.office.live[k] || !si.office.live[k] || si.office.live[k] === en.office.live[k]);
  check(missing.length === 0, 'every snap string in English and Sinhala', missing);
  check(keys.every((k) => !/[෦-෯]/.test(si.office.live[k])), 'Latin digits only in the Sinhala strings');
  check(en.office.live.snapOn === 'Snapped to roads' && en.office.live.snapOff === 'GPS line' && /km from the odometer/.test(en.office.live.snap_snapped), "the site's words: Snapped to roads · km from the odometer; GPS line");
  check(/OSRM; Google's are never stored/.test(en.office.retention.rule.route_matched) && /OSRM/.test(si.office.retention.rule.route_matched), "the Data retention screen says Google's lines are never stored (Round 48)");
}

console.log(failed ? `\n${failed} FAILED` : '\nAll snap checks passed.');
process.exit(failed ? 1 : 0);
