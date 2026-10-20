// Office mode (Phase 8, O1): the Live tab's rules (src/office/liveLogic.ts, design 15) with made-up live_drivers rows, the
// strings (office.live.* in en.json and si.json) in both languages, and how the screen and its two map engines are wired, without a
// phone. Pure code, no stack needed:
//   npm run test:live          (from apps/driver)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  batteryText, canClockOut, clockOutInput, clockOutLine, dutyOf, filterCounts, filterDrivers, fitAllFrame, focusOf, frameAll, hasPosition, hasProblem, liveChoice, liveFilterDefs, LIVE_FILTERS, markerLabel, markersOf, markerTone, moveMode, pillOf, positionsKey, rowLine, speedText, WATCH_EVERY_MS, WATCH_MAX, watchBatches, watchList, type Words, zoomStep, trailsOn,
} from '../src/office/liveLogic';
import { canMove, currentChoice, moveHint, moveInput, moveSentences, NO_VEHICLE, searchRows } from '../src/office/moveLogic';
import { swapRows } from '../src/office/taskExtrasLogic';
import type { LiveDriver, VehicleCard } from '../src/office/types';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

/** The words as "key(var,var)": the test reads which key was asked with what. */
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);

const driver = (over: Partial<LiveDriver> & Pick<LiveDriver, 'driver' | 'username'>): LiveDriver =>
  ({ state: 'sharing', ...over }) as LiveDriver;

const sunil = driver({
  driver: 'Sunil Perera', username: 'sunil', duty: 'on_task', status: 'live', status_text: 'Live · now', vehicle: 'WP CAB-4521',
  task: 'Team drop · Kurunegala site', eta_final: '10:38', near: 'Warakapola', last_position_at: '09:12', speed_kmh: 62.4,
  lat: 7.23, lng: 80.2, links: { call: 'tel:+94770000001', whatsapp: 'https://wa.me/94770000001', maps: 'https://www.google.com/maps/search/?api=1&query=7.23,80.2' },
});
const kamal = driver({
  driver: 'Kamal', username: 'kamal', duty: 'on_duty', status: 'live', status_text: 'Live · 2 min ago', vehicle: 'WP KV-7788',
  near: 'Kadawatha', last_position_at: '09:10', speed_kmh: 0, lat: 7.0, lng: 79.95, links: { call: 'tel:+94770000002', maps: 'x' },
});
const ruwan = driver({
  driver: 'Ruwan Silva', username: 'ruwan', duty: 'on_duty', status: 'location_off', status_text: 'Location off since 08:40',
  near: 'Kelaniya', last_position_at: '08:40', lat: 6.96, lng: 79.92, links: {},
});
const nimal = driver({
  driver: 'Nimal', username: 'nimal', duty: 'off_duty', status: 'not_sharing', status_text: 'Off duty', state: 'not_sharing',
  near: 'Ja-Ela', last_position_at: '17:52', lat: 7.07, lng: 79.89,
});
/** Never on the map: no position. */
const piyal = driver({ driver: 'Piyal', username: 'piyal', duty: 'off_duty', status: 'not_sharing', status_text: 'Off duty', state: 'not_sharing' });
const all = [sunil, kamal, ruwan, nimal, piyal];

console.log('\n== The chips: who belongs under which, and the counts ==');
{
  const counts = filterCounts(all);
  check(JSON.stringify(counts) === JSON.stringify({ all: 5, on_task: 1, on_duty: 2, off_duty: 2, problems: 1 }), 'All · 5, On a task · 1, Free · 2, Off duty · 2, Problems · 1 (Ruwan: Location off on duty)', counts);
  check(JSON.stringify(LIVE_FILTERS) === JSON.stringify(['all', 'on_task', 'on_duty', 'off_duty', 'problems']), 'the chips in the design\'s order, Problems last (Stage 1)');
  check(filterDrivers(all, 'all').map((d) => d.username).join() === 'sunil,kamal,ruwan,nimal,piyal', 'All keeps the server\'s order');
  check(filterDrivers(all, 'on_task').map((d) => d.username).join() === 'sunil', 'On a task');
  check(filterDrivers(all, 'on_duty').map((d) => d.username).join() === 'kamal,ruwan', 'Free = on duty with no task (a phone problem does not move them)');
  check(filterDrivers(all, 'off_duty').map((d) => d.username).join() === 'nimal,piyal', 'Off duty');
  check(filterDrivers(all, 'all') !== (all as LiveDriver[]), 'the filtered list is a copy');
  // An older server answer without `duty`: read from the card.
  check(dutyOf({ task: 'x' }) === 'on_task' && dutyOf({ status: 'not_sharing' }) === 'off_duty' && dutyOf({ state: 'not_sharing' }) === 'off_duty'
    && dutyOf({ status: 'live' }) === 'on_duty' && dutyOf({ duty: 'off_duty', task: 'x' }) === 'off_duty',
    'no duty field: a task = on a task, not sharing = off duty, else on duty; the server\'s duty wins');
  // The Filter sheet (docs/ui-patterns.md §1), no search: the duty with the counts.
  const defs = liveFilterDefs(counts, (k) => k);
  check(defs.length === 1 && defs[0].default === 'all' && JSON.stringify(defs[0].options.map((o) => [o.value, o.count])) === JSON.stringify([['all', 5], ['on_task', 1], ['on_duty', 2], ['off_duty', 2], ['problems', 1]]) && defs[0].options[1].label === 'office.live.filter.on_task', 'the Filter sheet: the five with their counts');
  check(liveFilterDefs(undefined, (k) => k)[0].options.every((o) => o.count === undefined) && liveChoice({ duty: 'off_duty' }) === 'off_duty' && liveChoice({ duty: 'x' }) === 'all', 'no counts before the answer; the choice read back');
}

console.log('\n== The line under the name ==');
{
  check(rowLine(sunil, t) === 'Team drop · Kurunegala site · office.live.about(10:38)', 'on a task: the task · about HH:MM', rowLine(sunil, t));
  check(rowLine({ ...sunil, late_min: 8 }, t) === 'Team drop · Kurunegala site · office.live.late(8) · office.live.about(10:38)', 'running late: late N min before the ETA');
  check(rowLine({ ...sunil, eta_final: undefined }, t) === 'Team drop · Kurunegala site · office.live.near(Warakapola)', 'no ETA yet: near the town instead');
  check(rowLine({ ...sunil, task: undefined }, t) === 'office.live.onTask · office.live.about(10:38)', 'a task with no title: the words "On a task"');
  check(rowLine(kamal, t) === 'office.live.onDuty · office.live.near(Kadawatha) · office.live.seen(09:10)', 'on duty: On duty · near Kadawatha · seen 09:10', rowLine(kamal, t));
  check(rowLine(ruwan, t) === 'office.live.onDuty · office.live.near(Kelaniya) · Location off since 08:40', 'a phone problem: the server\'s own words instead of "seen"', rowLine(ruwan, t));
  check(rowLine({ ...kamal, near: undefined, last_position_at: undefined }, t) === 'office.live.onDuty', 'on duty with nothing known: the word alone');
  check(rowLine(nimal, t) === 'office.live.offDuty · office.live.lastSeen(17:52) · office.live.near(Ja-Ela)', 'off duty: Off duty · last seen 17:52 near Ja-Ela', rowLine(nimal, t));
  check(rowLine(piyal, t) === 'office.live.offDuty', 'off duty, never seen: the word alone (never the server\'s "Off duty" twice)');
}

console.log('\n== The pill and the marker\'s colour ==');
{
  check(JSON.stringify(pillOf(sunil)) === JSON.stringify({ key: 'onTask', tone: 'blue' }), 'on a task: blue');
  check(JSON.stringify(pillOf(kamal)) === JSON.stringify({ key: 'free', tone: 'green' }), 'on duty and free: green');
  check(JSON.stringify(pillOf(ruwan)) === JSON.stringify({ key: 'free', tone: 'green' }), 'on duty with Location off: still free (the line says the problem)');
  check(JSON.stringify(pillOf(nimal)) === JSON.stringify({ key: 'offDuty', tone: 'muted' }), 'off duty: grey');
  check(markerTone('on_task') === 'blue' && markerTone('on_duty') === 'green' && markerTone('off_duty') === 'muted', 'the marker rings: blue, green, grey');
}

console.log('\n== The markers: one per driver with a position ==');
{
  check(hasPosition(sunil) && !hasPosition(piyal) && !hasPosition({ lat: 7, lng: undefined }) && !hasPosition({ lat: Number.NaN, lng: 80 }), 'a position is two finite numbers');
  const none = markersOf(all, null, t);
  check(none.length === 4 && !none.some((m) => m.username === 'piyal'), 'nothing is drawn for a driver without lat/lng', none.map((m) => m.username));
  check(none.every((m) => m.label === null && !m.selected), 'nobody selected: no label');
  const s = markersOf(all, 'sunil', t);
  const sel = s.find((m) => m.username === 'sunil')!;
  check(sel.selected && sel.label === 'Sunil Perera · office.live.kmh(62)' && sel.tone === 'blue' && !sel.dim && sel.initials === 'SP',
    'the selected one: "Sunil Perera · 62 km/h" (rounded), its ring blue, the initials', sel);
  check(s.filter((m) => m.label !== null).length === 1, 'one label at a time');
  check(markerLabel({ driver: 'Nimal', speed_kmh: undefined }, t) === 'Nimal', 'no speed (not sharing): the name alone');
  check(markerLabel({ driver: 'Kamal', speed_kmh: 0 }, t) === 'Kamal · office.live.kmh(0)', 'standing: 0 km/h is a speed');
  const n = markersOf(all, 'nimal', t).find((m) => m.username === 'nimal')!;
  check(n.dim && n.tone === 'muted' && n.label === 'Nimal' && n.initials === 'NI', 'off duty: drawn lighter, grey; a one-word name gives two letters', n);
  check(markersOf(all, 'piyal', t).every((m) => !m.selected), 'selecting a driver without a position labels nobody');
}

console.log('\n== The frame around everyone, and the move to one ==');
{
  const fit = frameAll(all);
  check(fit.key === 'kamal,nimal,ruwan,sunil', 'the key: the drivers with a position, by username', fit.key);
  check(fit.frame.kind === 'box' && fit.frame.sw.lat === 6.96 && fit.frame.sw.lng === 79.89 && fit.frame.ne.lat === 7.23 && fit.frame.ne.lng === 80.2,
    'the box around every position (nobody without one)', fit.frame);
  const moved = all.map((d) => (hasPosition(d) ? { ...d, lat: d.lat + 0.01, lng: d.lng + 0.01 } : d));
  check(frameAll(moved).key === fit.key && JSON.stringify(frameAll(moved).frame) !== JSON.stringify(fit.frame), 'a refresh that moved them: the same key (no new framing), a new box');
  check(frameAll([sunil, kamal, ruwan, nimal]).key === fit.key, 'a driver without a position joining or leaving changes nothing');
  check(frameAll([...all, driver({ driver: 'Asela', username: 'asela', lat: 6.9, lng: 79.85 })]).key === 'asela,kamal,nimal,ruwan,sunil', 'a driver with a position joining: a new key');
  check(positionsKey([]) === '' && frameAll([piyal]).frame.kind === 'none', 'nobody with a position: nothing to frame');
  check(frameAll([sunil]).frame.kind === 'point', 'one driver: a point (one place)');
  check(JSON.stringify(focusOf(all, 'kamal')) === JSON.stringify({ username: 'kamal', lat: 7.0, lng: 79.95 }), 'the selected driver\'s position');
  check(focusOf(all, null) === null && focusOf(all, 'piyal') === null && focusOf(all, 'nobody') === null, 'nobody selected, or no position, or unknown: no move');
}

console.log('\n== Strings ==');
{
  type Tree = { [k: string]: string | Tree };
  // The strings were merged into en.json and si.json (the sidecar is gone): read them there.
  const parts = { en: JSON.parse(read('src/i18n/en.json')), si: JSON.parse(read('src/i18n/si.json')) } as { en: { office: { live: Tree } }; si: { office: { live: Tree } } };
  const flat = (tree: Tree, prefix = ''): [string, string][] =>
    Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));
  const en = new Map(flat(parts.en.office.live));
  const si = new Map(flat(parts.si.office.live));
  const missingSi = [...en.keys()].filter((k) => !si.has(k) || si.get(k) === en.get(k) || !/[඀-෿]/.test(si.get(k)!));
  check(missingSi.length === 0, 'every string in English and in real Sinhala', missingSi);
  check([...si.keys()].every((k) => en.has(k)), 'no Sinhala string without its English');
  check([...si.values()].every((v) => !/[෦-෯]/.test(v)), 'Latin digits only in the Sinhala strings');
  check([...en.entries()].every(([k, v]) => [...v.matchAll(/\{(\w+)\}/g)].every((m) => si.get(k)?.includes(m[0]))), 'every {placeholder} kept in Sinhala');
  // Every key the screen and the map ask for exists; keys built from a filter or a pill are checked by their families.
  const src = read('src/app/office/(tabs)/live.tsx') + read('src/components/DriversMap.tsx') + read('src/office/liveLogic.ts');
  const asked = [...src.matchAll(/t\('office\.live\.([\w.]+)'/g)].map((m) => m[1]);
  const missing = asked.filter((k) => !en.has(k));
  check(asked.length > 0 && missing.length === 0, 'every office.live.* key the code asks for is in en.json (O2: the trails, the route and the playback merged)', missing);
  check(LIVE_FILTERS.every((k) => en.has(`filter.${k}`)) && ['onTask', 'free', 'offDuty'].every((k) => en.has(`pill.${k}`)), 'a chip and a pill per filter and per duty');
  check(/t\('map\.unavailable'\)/.test(read('src/components/DriversMap.tsx')) && /t\('map\.tryAgain'\)/.test(read('src/components/DriversMap.tsx')), 'the card reuses the map\'s own strings');
}

console.log('\n== The screen and the two engines ==');
{
  const screen = read('src/app/office/(tabs)/live.tsx');
  check(/useTool<LiveDrivers>\('live_drivers', \{\}, \{ every: 30_000 \}\)/.test(screen), 'live_drivers with no arguments, every 30 s while in front');
  check(/<FilterBar defs=\{liveFilterDefs\(q\.data \? counts : undefined, t, \{ trails: !!routes \}\)\} values=\{values\} onApply=\{setValues\}/.test(screen) && !/FilterChips/.test(screen) && /<SkeletonRows/.test(screen) && !/<Loading/.test(screen), 'one Filter button without a search (no chip row), skeleton rows while loading');
  check(/useLocalSearchParams<\{ driver\?: string \}>\(\)/.test(screen) && /d\.username === param \|\| d\.driver === param/.test(screen) && /setSelected\(found\.username\)/.test(screen) && /router\.setParams\(\{ driver: '' \}\)/.test(screen),
    '?driver=<username or name> selects that driver once, then the parameter is forgotten');
  // O2: the map also gets the route layers (the trails, the shown route, the playback marker: scripts/test-live-route.ts).
  check(/<DriversMap markers=\{markers\} fit=\{fit\} focus=\{focus\} onPressMarker=\{select\} mapPackage=\{me\.map\?\.package\} layers=\{layers\} controls=\{controls\} \/>/.test(screen), 'the map gets the markers, the frame, the selected driver, the office\'s map package, the route layers and the controls');
  check(/links\.call && <Action/.test(screen) && /links\.whatsapp && <Action/.test(screen) && /links\.maps && <Action/.test(screen), 'Call, WhatsApp and Open in Maps only when the server gave the link (no dead button)');
  const trailsDefs = liveFilterDefs(undefined, (k) => k, { trails: true });
  check(trailsDefs.length === 2 && trailsDefs[1].key === 'show' && trailsDefs[1].kind === 'multi' && trailsDefs[1].options[0].value === 'trails' && liveFilterDefs(undefined, (k) => k).length === 1
    && trailsOn({ show: ['trails'] }) && !trailsOn({}) && !screen.includes('testID="live-trails"') && /const trails = routes && trailsOn\(values\);/.test(screen),
    'Today\'s trails are a tick box in the Filter sheet\'s Map section (Sahan\'s decision 3: at most three map controls), only for a person who may call driver_route');
  check(/<PlaybackBar playback=\{playback\} cursor=\{cursor\} \/>/.test(screen) && /testID="live-playback"/.test(readFileSync(join(__dirname, '..', 'src', 'components', 'office', 'PlaybackBar.tsx'), 'utf8')), 'the playback bar is the shared one');
  // O2: the card grew (today's numbers, the playback bar), so the room under it follows its measured height.
  check(/paddingBottom: chosen \? Math\.max\(240, cardH \+ 16\) : 24/.test(screen), 'the list makes room under the card');

  const map = read('src/components/DriversMap.tsx');
  check(/import \{ GoogleDriversMap \} from '\.\/GoogleDriversMap'/.test(map) && /import \{ OpenDriversMap \} from '\.\/OpenDriversMap'/.test(map) && !/require\(/.test(map),
    'DriversMap carries both engines in every build (no conditional require)');
  check(/engineFor\(GOOGLE_MAP_BUILD, mapPackage \?\? settings\.map_package, failed\)/.test(map), 'the engine: the build, the office\'s package (else the phone\'s setting), Google\'s failure this session');
  check(/if \(step\.googleFailed\) mapSession\.markGoogleFailed\(Date\.now\(\)\)/.test(map), 'a failed Google map moves this phone to the free map (the session)');
  check(/if \(mount\.status !== 'loading' \|\| !focused \|\| !active\) return;/.test(map) && /useIsFocused\(\)/.test(map) && /useAppActive\(\)/.test(map),
    'the wait runs only while the tab is in front and the app on screen');
  check(/else if \(mountRef\.current\.status === 'loading'\) setWaitRun/.test(map) && /status === 'unavailable'\) dispatchRef\.current\(\{ type: 'retry' \}\)/.test(map),
    'the network back: the card goes, a loading map gets its whole wait again');
  check(/mount\.status === 'unavailable'/.test(map) && /t\('office\.live\.mapUnavailableBody'\)/.test(map) && /class MapBoundary/.test(map),
    '"Map not available" with Try again; a map that throws is a failed map, not a broken screen');
  check(/mapCredit\(mount\.engine === 'google', \[\]\)/.test(map) && /testID="drivers-map-credit"/.test(map), 'the credit line under the free map (© OpenStreetMap contributors · OpenFreeMap)');

  const google = read('src/components/GoogleDriversMap.tsx');
  const open = read('src/components/OpenDriversMap.tsx');
  // O2: both engines also take the route layers (DriversEngineProps & LiveLayerProps; scripts/test-live-route.ts).
  for (const [name, src, loaded] of [['Google', google, /onMapLoaded=\{onLoaded\}/], ['free', open, /onDidFinishLoadingMap=\{onLoaded\}/]] as const) {
    check(/: DriversEngineProps & LiveLayerProps\)/.test(src) && loaded.test(src) && /<DriverPin marker=\{m\} \/>/.test(src) && /onPressMarker\(m\.username\)/.test(src)
      && /DRIVER_ZOOM/.test(src) && /if \(!ready \|\| focused\) return;|if \(!focused\) setStop\(framed\);/.test(src) && /<MapCompass/.test(src),
    `the ${name} map: the same pins, its loaded signal, a tap selects, the move to a selected driver, the frame skipped while one is selected, the compass`);
  }
  check(/onDidFailLoadingMap=\{onFailed\}/.test(open) && /tiles\.openfreemap\.org\/styles\/liberty/.test(open), 'the free map: OpenFreeMap, no key; its failure is said');
  check(/PROVIDER_GOOGLE/.test(google) && !/googleMapId|mapId=/.test(google), "Google's map: PROVIDER_GOOGLE, no map id (free on a phone)");
  check(/tracksViewChanges=\{false\}/.test(google) && /key=\{`\$\{m\.username\}:\$\{m\.tone\}:\$\{m\.dim\}:\$\{m\.selected\}:\$\{m\.label \?\? ''\}:\$\{m\.initials\}`\}/.test(google),
    "Google's markers: the picture taken once, a new one for a new ring, label or letters");
  check(/anchor="bottom"/.test(open) && /offset=\{\[0, DRIVER_PIN\.size \/ 2\]\}/.test(open) && /driverPinAnchorY\(m\.label !== null\)/.test(google),
    'the ring\'s centre sits on the position on both maps, label or not');
  const pins = read('src/components/mapPins.tsx');
  check(/export function DriverDot/.test(pins) && /export function DriverPin/.test(pins) && /export interface DriversEngineProps/.test(pins) && /export const DRIVER_ZOOM = 15/.test(pins),
    'mapPins.tsx gained the pin, the engine props and the zoom (appended)');
  // mapPins.tsx draws with React Native, so the anchor's arithmetic is checked from its constants, not by loading it.
  const sizes = pins.match(/DRIVER_PIN = \{ size: (\d+), labelHeight: (\d+), gap: (\d+) \}/);
  const [size, labelH, gap] = sizes ? sizes.slice(1).map(Number) : [0, 0, 0];
  check(!!sizes && /if \(!labelled\) return 0\.5;/.test(pins) && Math.abs((labelH + gap + size / 2) / (labelH + gap + size) - 50 / 72) < 1e-9,
    'the labelled anchor: the ring\'s centre under a 24 px label and a 4 px gap (0.5 without a label)', sizes?.slice(1));
  const before = pins.indexOf('// --- Office mode (Phase 8, O1)');
  check(before > 0 && /export function StopPin/.test(pins.slice(0, before)) && /export const mapStyles = StyleSheet\.create/.test(pins.slice(0, before)),
    'the task map\'s own exports stand before the appended part, unchanged');
}

console.log('\n== Stage 1: Problems, watched mode, Clock out, Move to vehicle, the card\'s lines, the map\'s cluster ==');
{
  // Problems (the site's rule): No signal or Location off while on duty; off duty is never a problem.
  check(hasProblem(ruwan) && !hasProblem(kamal) && !hasProblem(nimal) && hasProblem({ duty: 'on_task', status: 'no_signal' }) && !hasProblem({ duty: 'off_duty', status: 'location_off' }) && hasProblem({ state: 'stale' }),
    'Problems: No signal or Location off on duty (an older answer: stale = no signal); never off duty');
  check(filterDrivers(all, 'problems').map((d) => d.username).join() === 'ruwan' && filterCounts(all).problems === 1, 'the Problems choice keeps Ruwan, with its count');
  check(liveChoice({ duty: 'problems' }) === 'problems' && liveFilterDefs(undefined, (k) => k)[0].options[4].label === 'office.live.filter.problems', 'the Filter sheet\'s fifth choice, read back');
  // Watched mode (the site's useWatchDrivers).
  const sharing = (u: string, on: boolean) => ({ username: u, state: (on ? 'sharing' : 'not_sharing') as 'sharing' | 'not_sharing' });
  const ds = [sharing('sunil', true), sharing('kamal', true), sharing('nimal', false), { username: 'asela', state: 'sharing' as const, signal: { sharing: false, point_at: null, heartbeat_at: null, location_on: null, permission: null, location_off_since: null } }];
  check(same(watchList(ds, false, 'kamal'), ['kamal']) && same(watchList(ds, false, 'nimal'), []) && same(watchList(ds, false, null), []), 'the selected driver while they share; nobody else');
  check(same(watchList(ds, true, null), ['kamal', 'sunil']), 'the trails on: every sharing driver (the raw signal wins over the share state), sorted');
  {
    const all30 = watchList(Array.from({ length: 30 }, (_, i) => sharing(`d${String(i).padStart(2, '0')}`, true)), true, null);
    check(all30.length === 30 && watchBatches(all30).map((b) => b.length).join() === '20,10' && WATCH_MAX === 20 && WATCH_EVERY_MS === 30_000, 'every sharing driver, sent 20 to a call (the tool\'s limit), every 30 s');
  }
  // Clock out and Move to vehicle.
  check(canClockOut(kamal) && !canClockOut(sunil) && !canClockOut(nimal), 'Clock out: a driver on duty without a task');
  check(moveMode(kamal) === 'move' && moveMode(sunil) === 'swap' && moveMode(nimal) === 'none', 'Move on duty, Swap on a task, nothing off duty');
  check(same(clockOutInput('kamal', '  Sent home  '), { driver: 'kamal', reason: 'Sent home' }) && same(clockOutInput('kamal', ' '), { driver: 'kamal' }), 'clock_out_driver: the username, the reason when typed');
  check(clockOutLine({ clocked_out: 'Kamal Perera', at: '2026-10-20 17:40' }, 'Kamal', t) === 'office.live.clockedOutAt(Kamal Perera,17:40)' && clockOutLine({ clocked_out: false, note: 'x' }, 'Kamal', t) === 'office.live.alreadyOff(Kamal)', 'the answer in words: off duty since, or already off');
  // The card's lines.
  check(speedText(sunil, t) === 'office.live.speed(62)' && speedText(ruwan, t) === null && speedText({ speed_kmh: 0, status: 'live' }, t) === 'office.live.speed(0)', 'the speed only while live (0 is a speed)');
  check(batteryText({ battery_pct: 41 }, t) === 'office.live.battery(41)' && batteryText({ battery_pct: null }, t) === null, 'the battery when the phone said it');
  // The map's cluster.
  check(zoomStep(12, 'in') === 13 && zoomStep(12.4, 'out') === 11 && zoomStep(20, 'in') === 20 && zoomStep(3, 'out') === 3 && zoomStep(Number.NaN, 'in') === 8, 'a zoom step, within 3–20');
  const f = fitAllFrame([{ lat: 7, lng: 80 }, { lat: 7.1, lng: 80.1 }], { kind: 'box', sw: { lat: 6.5, lng: 79.8 }, ne: { lat: 7.05, lng: 80.05 } });
  check(f.kind === 'box' && f.sw.lat === 6.5 && f.ne.lng === 80.1, 'fit everyone: the markers and the shown route together', f);
  check(fitAllFrame([], null).kind === 'none' && fitAllFrame([{ lat: 7, lng: 80 }], null).kind === 'point', 'nothing: no move; one marker: a point');
  // Move to vehicle's rules (office/moveLogic.ts) over the swap's rows.
  const vrows = swapRows([
    { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', held_by: 'Kamal' },
    { reg_no: 'WP KV-7788', make_model: 'Nissan Caravan', held_by: 'Nuwan' },
    { reg_no: 'WP PH-1111', make_model: 'Suzuki Alto', status: 'On a task' },
    { reg_no: 'WP GA-2222', make_model: 'Toyota Axio' },
  ] as VehicleCard[], { name: 'Kamal', vehicle: 'WP CAB-4521' });
  check(currentChoice(vrows) === 'WP CAB-4521' && !canMove(vrows, null) && !canMove(vrows, 'WP CAB-4521') && canMove(vrows, NO_VEHICLE) && canMove(vrows, 'WP KV-7788') && !canMove(vrows, 'WP PH-1111'),
    'Move: another vehicle or none; never the same one, never one on a running task');
  check(same(moveHint(vrows, null, 'Kamal'), { key: 'office.live.movePickOther', vars: { name: 'Kamal', plate: 'WP CAB-4521' } }) && same(moveHint(vrows, 'WP KV-7788', 'Kamal'), { key: 'office.live.moveTakesFrom', vars: { holder: 'Nuwan', plate: 'WP KV-7788' } })
    && moveHint(vrows, NO_VEHICLE, 'Kamal').key === 'office.live.moveStays' && moveHint(vrows, 'WP GA-2222', 'Kamal').key === 'office.live.moveTakes' && moveHint(vrows, 'WP PH-1111', 'Kamal').key === 'office.live.moveOnTask', 'the line under the list says what Move will do');
  check(same(searchRows(vrows, 'kv 77').map((r) => r.reg_no), ['WP KV-7788']) && same(searchRows(vrows, 'axio').map((r) => r.reg_no), ['WP GA-2222']) && searchRows(vrows, '').length === 4, 'the search: the plate (spaces and dashes ignored) or the model');
  check(same(moveInput('kamal', 'WP KV-7788'), { driver: 'kamal', vehicle: 'WP KV-7788' }) && same(moveInput('kamal', NO_VEHICLE), { driver: 'kamal', vehicle: null }), 'move_driver_vehicle: the plate, or null for no vehicle');
  check(same(moveSentences({ driver: 'Kamal', vehicle: 'WP KV-7788 · Nissan Caravan', taken_from: 'Nuwan' }).map((x) => x.key), ['office.live.movedTo', 'office.live.movedTold']) && moveSentences({ driver: 'Kamal', vehicle: 'none' })[0].key === 'office.live.movedNone', 'the sentences after it');

  const screen = read('src/app/office/(tabs)/live.tsx');
  check(/watchList\(all, trails, selected\)/.test(screen) && /if \(!focused \|\| !mayWatch \|\| !watchKey\) return;/.test(screen) && /api\.call\('watch_drivers', \{ drivers: batch \}\)/.test(screen) && /watchBatches\(drivers\)/.test(screen) && /setInterval\(call, WATCH_EVERY_MS\)/.test(screen) && /AppState\.currentState !== 'active'/.test(screen) && /const mayWatch = me\.tools\.includes\('watch_drivers'\)/.test(screen),
    'watched mode: watch_drivers now and every 30 s while the tab is in front and the app on screen, only with the tool');
  check(/me\.tools\.includes\('clock_out_driver'\) && canClockOut\(chosen\)/.test(screen) && /api\.call<ClockOutResult>\('clock_out_driver', clockOutInput\(chosen\.username, reason\)\)/.test(screen) && /testID="clock-out-sheet"/.test(screen) && /<ErrorNotice error=\{refused\}/.test(screen),
    'Clock out: with the tool, a sheet with the reason, the server\'s sentence when it refuses');
  check(/me\.tools\.includes\('move_driver_vehicle'\) && moveMode\(chosen\) !== 'none'/.test(screen) && /pathname: '\/office\/move\/\[username\]'/.test(screen) && /pathname: '\/office\/task\/\[id\]\/swap'/.test(screen), 'Move to vehicle (on duty) or Swap vehicle (on a task), with the tool');
  check(/onDriverPage=\{routes \?/.test(screen) && /params: \{ username: chosen\.username \} \}\)/.test(screen) && /testID="live-driver-page"/.test(screen) && /speedText\(d, t\), batteryText\(d, t\)/.test(screen), 'the card: the speed and battery, the driver\'s page for today beside Earlier days');
  const move = read('src/app/office/move/[username].tsx');
  check(/api\.call<MoveResult>\('move_driver_vehicle', moveInput\(d\.username, choice\)\)/.test(move) && /disabled=\{!ok\}/.test(move) && /<StickyActions>/.test(move) && /testID="move-hint"/.test(move) && /<FilterBar search=\{text\}/.test(move),
    'Move to vehicle: the search on top, the sticky Move disabled until another choice, the line saying what it does');
  check(/<SkeletonRows/.test(move) && /<ListFailed/.test(move) && /<ListEmpty/.test(move) && !/<Loading/.test(move) && /useTool<VehiclesList>\('list_vehicles', \{ filter: 'all' \}/.test(move), 'Move to vehicle: the list pattern, every vehicle from list_vehicles');
  const en = JSON.parse(read('src/i18n/en.json')) as { office: { live: Record<string, unknown>; task: Record<string, string> } };
  const si = JSON.parse(read('src/i18n/si.json')) as typeof en;
  const code = move + read('src/office/moveLogic.ts') + read('src/office/liveLogic.ts') + screen;
  const live = [...new Set([...code.matchAll(/'office\.live\.([A-Za-z_]+)'/g)].map((m) => m[1]))];
  const task = [...new Set([...move.matchAll(/'office\.task\.([A-Za-z_]+)'/g)].map((m) => m[1]))];
  const missing = [...live.filter((k) => typeof en.office.live[k] !== 'string' || typeof si.office.live[k] !== 'string'), ...task.filter((k) => !en.office.task[k] || !si.office.task[k])];
  check(live.length > 20 && missing.length === 0, `every key of Move to vehicle, Clock out and the card, in en and si (${live.length + task.length})`, missing);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll Live checks passed.');
process.exit(failed ? 1 : 0);
