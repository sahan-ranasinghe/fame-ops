// Part 6 (Sahan, 19 October 2026): both maps on every phone. The engine rules (lib/mapEngine.ts), what each engine draws
// (components/taskMapLogic.ts), the settings the phones read (lib/api.ts) and how the components are wired, without a phone.
//   npm run test:maps
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchDriverSettings } from '../src/lib/api';
import {
  createMapSession, engineFor, GOOGLE_RETRY_AFTER_MS, mapStep, type MountState, nextReport, OPEN_WAIT_S, SETTINGS_EVERY_MS, startMount, waitFor,
} from '../src/lib/mapEngine';
import { encodePolyline } from '../src/lib/polyline';
import type { TaskStop } from '../src/lib/types';
import { mapLines, mapStops, startPoint } from '../src/components/taskMapLogic';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

async function main() {
console.log('\n== Which map ==');
check(engineFor(true, 'google', false) === 'google', 'Google by default (the build has the key, the package is google)');
check(engineFor(true, 'open', false) === 'open', 'the office sets the package to open: the free map');
check(engineFor(true, 'google', true) === 'open', "Google failed on this phone since the app opened: the free map");
check(engineFor(false, 'google', false) === 'open', 'a build without the Android key: the free map');
check(waitFor('google', 30) === 30 && waitFor('google', 1) === 1 && waitFor('open', 1) === OPEN_WAIT_S, "Google waits phone_map_wait_s; the free map its own 30 s");
check(SETTINGS_EVERY_MS === 60_000, 'the open app reads the settings every minute (the package reaches the phones within a minute)');

console.log('\n== A forced Google failure moves the phone to the free map ==');
{
  const session = createMapSession();
  let heard = 0;
  session.subscribe(() => heard++);
  let s: MountState = startMount(engineFor(true, 'google', session.googleFailed()));
  const step = mapStep(s, { type: 'timeout', online: true });
  check(step.googleFailed === 'timeout' && step.state.engine === 'google', 'no onMapLoaded within the wait while online: Google failed (timeout)', step);
  session.markGoogleFailed(1_000);
  const engine = engineFor(true, 'google', session.googleFailed());
  check(session.googleFailed() && heard === 1 && engine === 'open', 'the session marks it and the engine becomes the free map', { heard, engine });
  s = mapStep(step.state, { type: 'engine', engine }).state;
  check(s.engine === 'open' && s.status === 'loading' && s.attempt === 1, 'the free map mounts afresh', s);
  const loaded = mapStep(s, { type: 'loaded' });
  check(loaded.state.status === 'loaded' && !loaded.googleLoaded && !loaded.googleFailed, 'the free map loads; nothing is said about Google', loaded);
  check(!session.appOpened(1_000 + GOOGLE_RETRY_AFTER_MS - 1) && session.googleFailed(), 'brought to the front within 30 minutes: still the free map');
  check(session.appOpened(1_000 + GOOGLE_RETRY_AFTER_MS) && !session.googleFailed() && engineFor(true, 'google', session.googleFailed()) === 'google',
    'the app opens 30 minutes or more later: Google is tried again');
  const fresh = createMapSession();
  check(!fresh.googleFailed(), 'a fresh start of the app tries Google again (the failure is kept in memory only)');

  const err = mapStep(startMount('google'), { type: 'error' });
  check(err.googleFailed === 'error', 'a render error of the Google map (the boundary) is a failure at once', err);
  const offline = mapStep(startMount('google'), { type: 'timeout', online: false });
  check(offline.state.status === 'unavailable' && !offline.googleFailed, 'offline: not Google\'s fault, the card shows and nothing is reported', offline);
  const back = mapStep(offline.state, { type: 'retry' });
  check(back.state.status === 'loading' && back.state.engine === 'google' && back.state.attempt === 1, 'the network back (or Try again): Google is mounted again', back.state);
  const google = mapStep(startMount('google'), { type: 'loaded' });
  check(google.state.status === 'loaded' && google.googleLoaded === true, "Google's map loads (onMapLoaded)", google);
  check(mapStep(google.state, { type: 'timeout', online: true }).state.status === 'loaded' && !mapStep(google.state, { type: 'timeout', online: true }).googleFailed,
    'a wait that ends after the map loaded changes nothing');
}

console.log('\n== The setting switches the phones ==');
{
  let s = startMount(engineFor(true, 'google', false));
  s = mapStep(mapStep(s, { type: 'loaded' }).state, { type: 'engine', engine: engineFor(true, 'open', false) }).state;
  check(s.engine === 'open' && s.status === 'loading' && s.attempt === 1, 'google → open: the free map mounts at once', s);
  s = mapStep(mapStep(s, { type: 'loaded' }).state, { type: 'engine', engine: engineFor(true, 'google', false) }).state;
  check(s.engine === 'google' && s.status === 'loading' && s.attempt === 2, 'open → google: Google mounts again', s);
  check(mapStep(s, { type: 'engine', engine: 'google' }).state === s, 'the same engine again: nothing moves');
}

console.log('\n== Both maps fail: the card ==');
{
  let s = startMount('google');
  const g = mapStep(s, { type: 'timeout', online: true });
  s = mapStep(g.state, { type: 'engine', engine: 'open' }).state;
  const o = mapStep(s, { type: 'error' });
  check(g.googleFailed === 'timeout' && o.state.status === 'unavailable' && !o.googleFailed,
    'Google failed, then the free map said onDidFailLoadingMap: "Map not available"', { g, o });
  const t = mapStep(startMount('open'), { type: 'timeout', online: true });
  check(t.state.status === 'unavailable', 'the free map not loaded within its wait while online (OpenFreeMap down): the card', t);
  const off = mapStep(startMount('open'), { type: 'timeout', online: false });
  check(off.state.status === 'unavailable', 'no network: the card', off);
  const tsx = read('src/components/TaskMap.tsx');
  check(/status === 'unavailable'[\s\S]{0,40}<MapUnavailable/.test(tsx) && /class MapBoundary/.test(tsx),
    'TaskMap shows MapUnavailable for the card and catches a map that throws (MapBoundary)');
  const card = read('src/components/MapUnavailable.tsx');
  check(/distanceKm\(me/.test(card) && /t\('task\.straightLine'\)/.test(card) && /t\('map\.tryAgain'\)/.test(card) && /GoogleCredit/.test(card),
    'the card lists the stops with the straight-line distance, the Google credit and Try again');
  const screen = read('src/app/task/[id].tsx');
  check(/<TaskMap task=\{task\} me=\{me\} googleNoteFor="current" \/>/.test(screen) && /navigateLink/.test(screen),
    'the task screen keeps its buttons outside the map (Navigate opens the Google Maps app)');
}

console.log('\n== What the server hears ==');
check(JSON.stringify(nextReport(null, { googleFailed: 'timeout' }, 'T')) === JSON.stringify({ google_ok: false, reason: 'timeout', at: 'T' }), 'a first failure is reported');
check(nextReport(false, { googleFailed: 'error' }, 'T') === null, 'a failure the server already has is not sent again');
check(nextReport(false, { googleLoaded: true }, 'T')?.google_ok === true, 'the next good load after a failure is reported (the issue resolves)');
check(nextReport(true, { googleLoaded: true }, 'T') === null, 'good loads after a good report: nothing');
check(nextReport(null, { googleLoaded: true }, 'T')?.google_ok === true, 'a phone that forgot what it sent says OK once');
check(nextReport(true, { googleFailed: 'timeout' }, 'T')?.google_ok === false, 'a new failure after OK is reported');
check(nextReport(null, {}, 'T') === null, 'the free map loading says nothing');

console.log('\n== The settings the phones read ==');
{
  const client = (value: unknown) => ({ rpc: async () => ({ data: value, error: null }) }) as never;
  const open = await fetchDriverSettings(client({ map_package: 'open', phone_map_wait_s: 1 }));
  check(open.map_package === 'open' && open.phone_map_wait_s === 1, 'map_package open and a 1 s wait (the forced-failure test) are read', open);
  const bad = await fetchDriverSettings(client({ map_package: 'osm', phone_map_wait_s: 999 }));
  check(bad.map_package === 'google' && bad.phone_map_wait_s === 30, 'anything else: Google and 30 s', bad);
  const old = await fetchDriverSettings(client({ shift_start: '08:00' }));
  check(old.map_package === 'google' && old.phone_map_wait_s === 30, 'a server without the new keys: Google and 30 s', old);
  const migration = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261019180000_phase7_6_maps.sql'), 'utf8');
  check(/'map_package',\s*coalesce\(\(select value #>> '\{\}' from public\.fleet_settings where key = 'map_package'\), 'google'\)/.test(migration)
    && /'phone_map_wait_s'/.test(migration), 'get_driver_settings answers map_package (google by default) and phone_map_wait_s');
  const app = read('src/state/app.tsx');
  check(/setInterval\(\(\) => \{\s*if \(AppState\.currentState !== 'active'\) return;\s*void api\.fetchDriverSettings/.test(app) && /SETTINGS_EVERY_MS/.test(app),
    'the open app reads them every minute (live while open)');
  check(/mapSession\.appOpened\(Date\.now\(\)\)/.test(app) && /void flushMapReport\(\)/.test(app), 'the app tries Google again on opening and sends a waiting report on refresh');
}

console.log('\n== Both engines draw the same task ==');
{
  const A = { lat: 7, lng: 80 };
  const B = { lat: 7.1, lng: 80 };
  const C = { lat: 7.2, lng: 80.05 };
  const G = { lat: 7.3, lng: 80.1 };
  const st = (id: string, seq: number, p: { lat: number; lng: number }, extra: Partial<TaskStop> = {}) =>
    ({ id, seq, type: 'drop', status: 'pending', lat: p.lat, lng: p.lng, google_place_id: null, arrive_by: null, planned_arrive_at: null, is_start: false, place_name: id, ...extra }) as unknown as TaskStop;
  const plan = { legs: [
    { from_seq: 0, to_seq: 1, km: 12, line: encodePolyline([A, B]) },
    { from_seq: 1, to_seq: 2, km: 9, line: encodePolyline([B, C]) },
  ] };
  const task = {
    task_stops: [st('s1', 1, B, { status: 'done' }), st('s2', 2, C)],
    plan_json: plan as never,
    start_lat: A.lat, start_lng: A.lng, start_google_place_id: null as string | null,
  };
  const gStops = mapStops(task, true);
  const oStops = mapStops(task, false);
  check(JSON.stringify(gStops) === JSON.stringify(oStops) && gStops.length === 2 && gStops[0].state === 'done' && gStops[1].state === 'current',
    'the same stops, numbers, times and states on both maps', { gStops, oStops });
  check(JSON.stringify(startPoint(task, true)) === JSON.stringify(startPoint(task, false)), 'the same start on both maps');
  const gLines = mapLines(task, true, gStops, startPoint(task, true));
  const oLines = mapLines(task, false, oStops, startPoint(task, false));
  check(gLines.length === 2 && gLines.every((l) => !l.dashed) && gLines[0].done && !gLines[1].done, "Google's map: Google's road line, the driven leg muted", gLines);
  check(oLines.length === 2 && oLines.every((l) => l.dashed && l.points.length === 2) && oLines[0].done && !oLines[1].done
    && JSON.stringify(oLines[1].points) === JSON.stringify([B, C]),
    'the free map: dashed straight lines start → Stop 1 → Stop 2, the driven one muted (never Google\'s line)', oLines);
  const noLine = { ...task, plan_json: { legs: [{ from_seq: 0, to_seq: 1, km: 12 }] } as never };
  check(mapLines(noLine, true, gStops, startPoint(noLine, true)).every((l) => l.dashed), "Google's map with no road line stored: the same dashed lines");
  const withGoogle = { ...task, task_stops: [...task.task_stops, st('s3', 3, G, { google_place_id: 'gp' })] };
  const g3 = mapStops(withGoogle, true);
  const o3 = mapStops(withGoogle, false);
  const o3Lines = mapLines(withGoogle, false, o3, startPoint(withGoogle, false));
  check(g3.length === 3 && o3.length === 2 && o3Lines.every((l) => !l.points.some((p) => p.lat === G.lat)),
    "a Google place: on Google's map only; the free map's lines never reach its pin (rule 10)");
  const google = read('src/components/GoogleTaskMap.tsx');
  const open = read('src/components/OpenTaskMap.tsx');
  for (const [name, src, loaded] of [['Google', google, /onMapLoaded=\{onLoaded\}/], ['free', open, /onDidFinishLoadingMap=\{onLoaded\}/]] as const) {
    check(/: EngineProps\)/.test(src) && loaded.test(src) && /<StopPin stop=\{s\} \/>/.test(src) && /<MePin \/>/.test(src) && /<StartPin \/>/.test(src)
      && /FOLLOW_ZOOM/.test(src) && /onUserMove\(\)/.test(src) && /<MapCompass/.test(src),
    `the ${name} map: the same parts (stops, start, the phone, the line), its loaded signal, Follow me, a gesture ends it, the compass`);
  }
  check(/onDidFailLoadingMap=\{onFailed\}/.test(open) && /tiles\.openfreemap\.org\/styles\/liberty/.test(open), 'the free map: OpenFreeMap, no key; its failure is said');
  check(/PROVIDER_GOOGLE/.test(google) && !/googleMapId|mapId=/.test(google), "Google's map: PROVIDER_GOOGLE, no map id (free on a phone)");
  const taskMap = read('src/components/TaskMap.tsx');
  check(/import \{ GoogleTaskMap \} from '\.\/GoogleTaskMap'/.test(taskMap) && /import \{ OpenTaskMap \} from '\.\/OpenTaskMap'/.test(taskMap) && !/require\(/.test(taskMap),
    'TaskMap carries both engines in every build (no conditional require)');
}

console.log('\n== Strings ==');
{
  const en = JSON.parse(read('src/i18n/en.json')) as Record<string, Record<string, string>>;
  const si = JSON.parse(read('src/i18n/si.json')) as Record<string, Record<string, string>>;
  const keys = [['map', 'followMe'], ['map', 'unavailable'], ['map', 'unavailableBody'], ['map', 'tryAgain'], ['map', 'northUp'], ['task', 'noRouteLine'], ['task', 'lineGoogleOnly'], ['task', 'googleNotOnMap']];
  const missing = keys.filter(([g, k]) => !en[g]?.[k] || !si[g]?.[k] || si[g][k] === en[g][k]);
  check(missing.length === 0, 'every map string in English and Sinhala', missing);
  check(keys.every(([g, k]) => !/[෦-෯]/.test(si[g][k])), 'Latin digits only in the Sinhala map strings');
}

console.log(failed ? `\n${failed} FAILED` : '\nAll map checks passed.');
process.exit(failed ? 1 : 0);
}

void main();
