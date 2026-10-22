// Round 4–7, feature 4 (phase8-plan.md §33.1), Office mode and /m/: a trip nobody drives with the app on the person's own
// page (the vehicle check before setting off, Trip finished? / Enter the odometer), and the office's view of the checks
// (a vehicle's Today's check and last 7 days, the Pre-trip tag, a task's check lines, Completed · not confirmed), the five
// switches in Quick settings, the two notification links. The rules (office/myTripLogic.ts) against the server's own
// (supabase/functions/_shared/fleet/checks.ts) and the site's twin (apps/office/src/screens/myTripLogic.ts); the strings in
// both languages (en.json / si.json deep-merged with src/i18n/parts/*.json while a sidecar is waiting for the merge); the
// screens wired as the plan says (read as text: no phone).
//   npm run test:trip-close          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeForUrl } from '../src/office/nav';
import {
  byDay, CATEGORIES, categoryKey, checkButtonKey, checkDone, checkInput, checkReason, type CheckForm, emptyCheck, emptyFinish, finishDone,
  finishInput, finishReason, howKey, lastWeekArgs, MAX_PROBLEM_PHOTOS, MAX_TRIP_KM, MIN_PROBLEM_PHOTOS, odometerReason, parseAmount, parseKm,
  resultText, SIDES, TRIP_ACTION_KEY, tripFacts, tripKm, tripMode, tripTaskId, windowWords,
} from '../src/office/myTripLogic';
import { FEATURE_KEYS, QUICK_SETTINGS, switchValue } from '../src/office/peopleLogic';
import { ISSUE_KINDS } from '../src/office/issuesLogic';
import { taskChip } from '../src/office/statusWords';
import type { MyTrip, VehicleCheck } from '../src/office/types';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const ROOT = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- The strings: en.json / si.json, deep-merged with the sidecars while they wait for the lead's merge ----
type Tree = { [k: string]: string | Tree | string[] };
function merge(into: Tree, from: Tree): Tree {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur, v);
    else into[k] = v;
  }
  return into;
}
const dicts: Record<'en' | 'si', Tree> = { en: JSON.parse(read('i18n/en.json')), si: JSON.parse(read('i18n/si.json')) };
const partsDir = join(SRC, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const f of readdirSync(partsDir).filter((x) => x.endsWith('.json')).sort()) {
    const part = JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (part.en) merge(dicts.en, part.en);
    if (part.si) merge(dicts.si, part.si);
  }
}
const lookup = (lang: 'en' | 'si', key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(lang, key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const en = tr('en');

// The server's own rules and the site's twin, loaded as they are.
const load = createRequire(import.meta.url);
const server = load(join(ROOT, 'supabase', 'functions', '_shared', 'fleet', 'checks.ts')) as {
  REPORT_CATEGORIES: readonly string[];
  CATEGORY_TEXT: Record<string, string>;
  CHECK_HOW_TEXT: Record<string, string>;
  SIDES: readonly string[];
  MIN_PROBLEM_PHOTOS: number;
  MAX_PROBLEM_PHOTOS: number;
  MAX_TRIP_KM: number;
  resultText: (result: string, category?: string | null) => string;
};
const site = load(join(ROOT, 'apps', 'office', 'src', 'screens', 'myTripLogic.ts')) as {
  TRIP_ACTION_TEXT: Record<string, string>;
  CATEGORIES: readonly (readonly [string, string])[];
  MAX_TRIP_KM: number;
  MAX_PROBLEM_PHOTOS: number;
  tripMode: (t: unknown, finishing?: boolean) => string;
  finishInput: (taskId: string, t: unknown, f: unknown) => unknown;
};

const trip = (over: Partial<MyTrip> = {}): MyTrip => ({
  task_id: 't1', title: 'Site visit · Kandy', date: '2026-10-23', leave_at: '09:00', driven_by: 'self', stops: [],
  state: 'to_check', window: { opens_at: '07:00', open: true, past: false }, check_needed: true,
  can: { check: true, finish: true }, last_odometer_km: 45210, vehicle: 'WP CAB-4521',
  ...over,
});
const form = (over: Partial<CheckForm> = {}): CheckForm => ({ ...emptyCheck(trip(), 'ok'), ...over });
const words = (w: { key: string; vars?: Record<string, string | number> } | null) => (w ? en(w.key, w.vars) : null);

console.log('\nThe rules match the server and the site');
{
  check(same([...CATEGORIES].sort(), [...server.REPORT_CATEGORIES].sort()), 'the six kinds of problem are the server\'s (Damage the sixth)', CATEGORIES);
  check(same([...SIDES], [...server.SIDES]), 'the four sides are the server\'s');
  check(MIN_PROBLEM_PHOTOS === server.MIN_PROBLEM_PHOTOS && MAX_PROBLEM_PHOTOS === server.MAX_PROBLEM_PHOTOS && MAX_PROBLEM_PHOTOS === site.MAX_PROBLEM_PHOTOS, '1–6 photos of a problem, as the server and the site');
  check(MAX_TRIP_KM === server.MAX_TRIP_KM && MAX_TRIP_KM === site.MAX_TRIP_KM, 'a typed odometer over 3,000 km more is a mistake, as the server and the site');
  check(same(site.CATEGORIES.map(([k]) => k), [...CATEGORIES]), 'the site offers the kinds in the same order');
  for (const k of Object.keys(TRIP_ACTION_KEY)) check(en(TRIP_ACTION_KEY[k as keyof typeof TRIP_ACTION_KEY]) === site.TRIP_ACTION_TEXT[k], `My trips' button for ${k}: the site's words in English`, en(TRIP_ACTION_KEY[k as keyof typeof TRIP_ACTION_KEY]));
  for (const k of server.REPORT_CATEGORIES) {
    const said = server.resultText('problem', k);
    check(resultText(en, { result: 'problem', result_text: said }) === `Problem: ${en(categoryKey(k))}`, `the server's "${said}" read back in words`);
    check(en(categoryKey(k)) === server.CATEGORY_TEXT[k], `the kind ${k} in the server's English words`);
  }
  for (const [how, text] of Object.entries(server.CHECK_HOW_TEXT)) check(en(howKey(how)) === text, `how a check was made (${how}): the server's English words`);
  check(resultText(en, { result: 'ok' }) === 'All good' && resultText(en, { result: 'problem', result_text: 'Problem: reported' }) === 'Problem reported', 'All good; a problem with no known kind');
  const states: MyTrip['state'][] = ['to_check', 'on_the_way', 'finish', 'not_confirmed', 'done', 'cancelled', 'other'];
  check(states.every((s) => tripMode(trip({ state: s })) === site.tripMode(trip({ state: s }))), 'the page asks the same as the site for every state');
}

console.log('\nThe trip page: what it asks');
{
  check(tripMode(trip()) === 'check' && tripMode(trip({ window: { opens_at: '07:00', open: false, past: true } })) === 'finish', 'not started: the check, or the finish once its day is over');
  check(tripMode(trip({ state: 'on_the_way' })) === 'finish' && tripMode(trip({ state: 'finish' })) === 'finish' && tripMode(trip({ state: 'not_confirmed' })) === 'confirm', 'started or asked: the finish; closed without it: the confirm');
  check(tripMode(trip({ state: 'done' })) === 'done' && tripMode(trip({ state: 'cancelled' })) === 'cancelled', 'finished and cancelled say so');
  check(tripTaskId({ id: 'r1', task_id: 't9' }) === 't9' && tripTaskId({ id: 't7', source: 'task' }) === 't7' && tripTaskId({ id: 'r2' }) === undefined, 'a row\'s button opens the trip\'s task');
  check(same(windowWords(trip(), 'x'), { key: 'office.myTrip.windowOpen' }), 'on its day from 2 h before: the check starts the trip');
  const early = trip({ window: { opens_at: '07:00', open: false, past: false } });
  check(en(windowWords(early, 'Tomorrow 07:00').key, windowWords(early, 'Tomorrow 07:00').vars) === 'The trip starts from Tomorrow 07:00. A check now is only recorded: check again then.', 'earlier: only recorded, and the page says so');
  check(checkButtonKey(early, { result: 'ok' }) === 'office.myTrip.saveCheck' && checkButtonKey(trip(), { result: 'ok' }) === 'office.myTrip.startTrip' && checkButtonKey(trip(), { result: 'problem' }) === 'office.myTrip.sendAndStart', 'the button says what it does');
}

console.log('\nThe check: the odometer and a problem');
{
  check(parseKm('45 210') === 45210 && parseKm('45,210') === 45210 && parseKm('45.2') === null, 'the odometer typed with spaces or commas');
  check(emptyCheck(trip(), 'ok').odometer === '45210', 'prefilled with the vehicle\'s last reading');
  check(words(odometerReason('45200', 45210, 'last')) === 'Under the vehicle\'s last reading (45,210 km): check the number', 'never under the last reading');
  check(words(odometerReason('49000', 45210, 'last')) === '3,790 km more than the last reading: check the number', 'never a jump of over 3,000 km');
  check(checkReason(trip(), form(), 'x') === null, 'all good with the reading: ready');
  check(words(checkReason(trip(), form({ result: 'problem' }), 'x')) === 'Pick what the problem is', 'a problem: what it is');
  check(words(checkReason(trip(), form({ result: 'problem', category: 'damage' }), 'x')) === 'Add at least one photo of the problem', 'a problem: at least one photo');
  check(words(checkReason(trip(), form({ result: 'problem', category: 'damage', uploading: 1 }), 'x')) === 'Wait for the photos to go up', 'photos still going up');
  check(checkReason(trip(), form({ result: 'problem', category: 'damage', photos: ['p1'] }), 'x') === null, 'a problem with its photo: ready');
  check(same(checkInput('t1', 'c1', form({ odometer: '45230', sides: [{ photo_id: 'p1', side: 'front' }] })), { task_id: 't1', check_id: 'c1', result: 'ok', odometer_km: 45230, sides: [{ photo_id: 'p1', side: 'front' }] }), 'all good: the sides with the check');
  check(same(checkInput('t1', 'c1', form({ result: 'problem', category: 'tyre', note: '  flat  ', photos: ['p2'] })), { task_id: 't1', check_id: 'c1', result: 'problem', odometer_km: 45210, category: 'tyre', note: 'flat', photos: ['p2'] }), 'a problem: its kind, note and photos');
  const off = trip({ check_needed: false, window: { opens_at: '07:00', open: false, past: false } });
  check(words(checkReason(off, { ...form(), result: 'odo' }, 'Tomorrow 07:00')) === 'You can start the trip from Tomorrow 07:00', 'the switch off: the odometer alone, from its time');
  check(same(checkInput('t1', 'c1', { ...form(), result: 'odo', sides: [{ photo_id: 'p1', side: 'front' }] }), { task_id: 't1', check_id: 'c1', result: 'ok', odometer_km: 45210 }), 'the switch off: no question, no photos sent');
  check(en(checkDone({ started_now: true, started: '07:42' }, '').key, checkDone({ started_now: true, started: '07:42' }, '').vars) === 'On the way · left 07:42', 'a check that started it: On the way');
  check(en(checkDone({ started_now: false }, 'Tomorrow 07:00').key, checkDone({ started_now: false }, 'Tomorrow 07:00').vars) === 'Check recorded. The trip starts from Tomorrow 07:00: check again then.', 'an early check: recorded');
}

console.log('\nTrip finished? Enter the odometer');
{
  const never = trip({ window: { opens_at: '07:00', open: false, past: true } });
  const f = emptyFinish(never);
  check(f.start === '45210', 'no start reading: the vehicle\'s last reading, editable');
  check(words(finishReason(never, f)) === 'Enter the odometer' && words(finishReason(never, { ...f, start: '' })) === 'Enter the odometer at the start', 'the readings first');
  check(words(finishReason(never, { ...f, odometer: '45200' })) === 'Under the start (45,210 km): check the number', 'never under the start');
  check(words(finishReason(never, { ...f, odometer: '45252', litres: 'x' })) === 'Litres: a number up to 500' && parseAmount('') === '' && parseAmount('4,500') === 4500, 'the fuel is optional, and a number');
  check(finishReason(never, { ...f, odometer: '45252', litres: '12.5', amount: '4500' }) === null && tripKm(never, { ...f, odometer: '45252' }) === 42, 'ready: 42 km this trip');
  const input = finishInput('t1', never, { ...f, odometer: '45252', litres: '12.5', amount: '4500', photo: 'p9' });
  check(same(input, { task_id: 't1', odometer_km: 45252, start_odometer_km: 45210, fuel: { litres: 12.5, amount_lkr: 4500 }, photo: 'p9' }), 'finish_my_trip: the readings, the fuel, the photo');
  check(same(input, site.finishInput('t1', never, { ...f, odometer: '45252', litres: '12.5', amount: '4500', photo: 'p9' })), 'the same input as the site');
  const started = trip({ state: 'on_the_way', start_odometer_km: 45220 });
  check(emptyFinish(started).start === '' && same(finishInput('t1', started, { ...emptyFinish(started), odometer: '45300' }), { task_id: 't1', odometer_km: 45300 }), 'a started trip keeps its start');
  check(en(finishDone(42, false).key, finishDone(42, false).vars) === 'Trip finished · 42 km' && en(finishDone(90, true).key, finishDone(90, true).vars) === 'Trip finished · 90 km · confirmed', 'the snackbar after it');
  const facts = tripFacts(trip({ state: 'on_the_way', started: '07:42', start_odometer_km: 45220, check: { id: 'c', at: '07:40', date: '2026-10-23', result: 'ok', odometer_km: 45220 } })).map((w) => en(w.key, w.vars));
  check(same(facts, ['Checked 07:40 · all good · 45,220 km', 'Started 07:42 · 45,220 km']), 'what the trip already has', facts);
}

console.log('\nThe office: the checks, the issue, the chip, the switches, the links');
{
  check(same(lastWeekArgs('WP CAB-4521', '2026-10-22'), { vehicle: 'WP CAB-4521', from: '2026-10-16', to: '2026-10-22', limit: 50 }), 'a vehicle\'s last 7 days');
  const c = (id: string, date: string) => ({ id, date }) as VehicleCheck;
  check(same(byDay([c('a', '2026-10-22'), c('b', '2026-10-22'), c('c', '2026-10-21')]).map((d) => d.checks.length), [2, 1]), 'by day, newest first');
  check((ISSUE_KINDS as readonly string[]).includes('trip_not_confirmed') && en('office.issues.kind.trip_not_confirmed') === 'Trip not confirmed', 'the issue kind Trip not confirmed has its words');
  check(same(taskChip('completed', { finish_flag: { kind: 'not_confirmed' } }), { key: 'notConfirmed', tone: 'muted' }) && same(taskChip('completed', {}), { key: 'done', tone: 'green' }), 'Completed · not confirmed is a grey chip');
  check(same([...FEATURE_KEYS], ['vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact']) && FEATURE_KEYS.every((k) => QUICK_SETTINGS.some((r) => r.key === k && r.kind === 'switch')), 'the five switches in Quick settings');
  check(FEATURE_KEYS.every((k) => switchValue(k, {}, {}) === true) && switchValue('passengers', { passengers: false }, {}) === false, 'on when absent');
  const UUID = '1b2c3d4e-0000-4000-8000-00000000abcd';
  check(routeForUrl(`/my-trips/${UUID}`, ['request']) === `/office/my-trip/${UUID}` && routeForUrl(`/my-trips/${UUID}`, ['view']) === `/office/my-trip/${UUID}`, '"Trip finished?" opens the trip\'s page (anyone\'s own trip)');
  check(routeForUrl('/my-trips', ['request']) === '/office/(tabs)/trips', 'My trips itself as before');
  check(routeForUrl(`/vehicles/WP%20CAB-4521?check=${UUID}`, ['issues', 'view']) === `/office/vehicles/WP%20CAB-4521?check=${UUID}`, 'a pre-trip problem opens the vehicle with its check');
  check(routeForUrl('/vehicles/WP%20CAB-4521', ['view']) === '/office/vehicles/WP%20CAB-4521', 'a vehicle\'s link as before');
}

console.log('\nThe screens');
{
  const page = read('app/office/my-trip/[id].tsx');
  const step = read('app/office/my-trip/[id]/check.tsx');
  const fin = read('app/office/my-trip/[id]/finish.tsx');
  const parts = read('components/office/MyTripParts.tsx');
  const trips = read('app/office/(tabs)/trips.tsx');
  const veh = read('app/office/vehicles/[reg].tsx');
  const task = read('app/office/task/[id].tsx');
  const issues = read('app/office/issues/index.tsx') + read('app/office/issues/[id].tsx');
  const settings = read('app/office/people/settings.tsx');
  const photo = read('office/myPhoto.ts');
  check(/useTool<MyTrip>\('my_trip', \{ task_id: id \}/.test(page) && /step\('check', 'ok'\)/.test(page) && /step\('check', 'problem'\)/.test(page) && /step\('finish'\)/.test(page), 'the page: my_trip; All good, A problem, Trip finished? open their step');
  check(/api\.call<MyTrip>\('my_trip_check', checkInput\(trip\.task_id, checkId, form\)\)/.test(step) && /Crypto\.randomUUID\(\)/.test(step), 'the check: my_trip_check with an id made on the screen (a retry never doubles it)');
  check(/up\.add\('vehicle_report'/.test(step) && /up\.add\('vehicle_check'/.test(step) && /up\.add\('odometer'/.test(fin), 'the photos of each kind: a problem\'s, the sides, the odometer');
  check(/saveMyTripPhoto\(kind, shot\.photo\.uri\)/.test(parts) && /createSignedUploadUrl\(path\)/.test(photo) && /tripPhotoPath/.test(photo), 'each photo into the person\'s own folder, its id kept');
  check(/api\.call<MyTrip>\('finish_my_trip', finishInput\(trip\.task_id, trip, f\)\)/.test(fin), 'the finish: finish_my_trip');
  check([step, fin].every((s) => /<StickyActions>/.test(s) && /disabled=\{!!why\}/.test(s) && /t\(why\.key, why\.vars\)/.test(s)), 'one sticky button, disabled with its reason under it');
  check(/<MoreDetails/.test(step) && /<MoreDetails/.test(fin), 'the optional things under More details (the sides; the fuel and the photo)');
  check([step, fin].every((s) => /useLeaveGuard\(/.test(s) && /allowLeave\(\)/.test(s)), 'Discard changes? on the way back, never after a save');
  check(/TRIP_ACTION_KEY\[trip\.trip_action\]/.test(trips) && /pathname: '\/office\/my-trip\/\[id\]'/.test(trips), 'My trips: the row\'s button opens the trip\'s page');
  check(/<VehicleChecksSection plate=\{v\.reg_no\} today=\{v\.check_today\} focus=\{check\}/.test(veh), 'a vehicle: Today\'s check and the last 7 days, a notification\'s check marked');
  check(/<TaskCheckLines checks=\{task\.vehicle_checks\}/.test(task) && /office\.checks\.notConfirmed/.test(task), 'a task: the check lines and Completed · not confirmed');
  check((issues.match(/i\.pre_trip/g) ?? []).length >= 2 && /office\.checks\.preTrip/.test(issues), 'Issues: the Pre-trip tag on the row and the page');
  check(/FEATURE_KEYS\.map/.test(settings) && /office\.features\.title/.test(settings), 'Quick settings: the five switches as a group');
}

console.log('\nThe strings in both languages');
{
  const files = ['app/office/my-trip/[id].tsx', 'app/office/my-trip/[id]/check.tsx', 'app/office/my-trip/[id]/finish.tsx', 'components/office/MyTripParts.tsx', 'components/office/VehicleChecks.tsx',
    'office/myTripLogic.ts', 'app/office/(tabs)/trips.tsx', 'app/office/task/[id].tsx', 'app/office/issues/index.tsx', 'app/office/issues/[id].tsx', 'app/office/people/settings.tsx'];
  const code = files.map(read).join('\n');
  const used = new Set<string>();
  for (const m of code.matchAll(/'(office\.(?:myTrip|checks|features)\.[A-Za-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);
  const families = [
    ...CATEGORIES.map((k) => categoryKey(k)),
    ...SIDES.map((s) => `office.checks.side.${s}`),
    ...['clock_in', 'change', 'task_start', 'vehicle_confirm', 'trip'].map(howKey),
    ...FEATURE_KEYS.flatMap((k) => [`office.features.${k}`, `office.features.${k}Hint`]),
    'office.chip.notConfirmed', 'office.issues.kind.trip_not_confirmed',
  ];
  for (const k of families) used.add(k);
  const missing = [...used].filter((k) => typeof lookup('en', k) !== 'string' || typeof lookup('si', k) !== 'string');
  check(used.size > 100 && missing.length === 0, `every key the screens use is in English and Sinhala (${used.size})`, missing);
  const vars = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const differ = [...used].filter((k) => typeof lookup('si', k) === 'string' && vars(String(lookup('en', k))) !== vars(String(lookup('si', k))));
  check(differ.length === 0, 'the same placeholders in both languages', differ);
  const si = [...used].map((k) => [k, String(lookup('si', k) ?? '')] as const);
  check(si.every(([, v]) => !/[෦-෯]/.test(v)), 'no Sinhala digits: numbers, plates and times stay Latin', si.filter(([, v]) => /[෦-෯]/.test(v)).map(([k]) => k));
  check(si.every(([, v]) => v.trim() !== ''), 'no empty Sinhala');
  const english = si.filter(([k, v]) => /^[A-Za-z][a-z]+ [a-z]+/.test(v) && !k.endsWith('.note')).map(([k]) => k);
  check(english.length === 0, 'the Sinhala is Sinhala (no English sentence left in it)', english);
}

console.log(failures === 0 ? '\nAll trip-close checks passed.' : `\n${failures} trip-close check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
