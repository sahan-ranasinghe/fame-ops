// Round 4–7, feature 6 (phase8-plan.md §33.3), Office mode and /m/: passengers on trips. The rules (the site's
// passengersLogic.ts, copied to office/trip/) against the server's own (supabase/functions/_shared/fleet/passengers.ts:
// the limit, the count never under the names, a typed phone), the trip calls carrying passenger_list (Request a vehicle,
// Book now, Assign a task, an edit of a request, Change the task: the names alone with the ids only), the passenger's view
// (office/passengerView.ts: the server's live words, the stops as they go), My trips' Passenger route and the notification
// link, the screens' wiring (read as text: no phone), and the strings in both languages (en.json / si.json deep-merged with
// src/i18n/parts/*.json while a sidecar waits for the merge).
//   npm run test:passengers          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeForUrl } from '../src/office/nav';
import { isPassengerView, liveWords, passengerTone, stopWords } from '../src/office/passengerView';
import { changeFieldsOf, changeTaskInput } from '../src/office/taskExtrasLogic';
import { emptyAssign, validateAssign } from '../src/office/trip/assignLogic';
import { newDraft, requestFieldsOf } from '../src/office/trip/draftLogic';
import {
  addRider, countWithNames, MAX_PASSENGERS, passengerList, passengerRow, passengersOn, type Rider, riderKey, ridersEdit, ridersFrom, ridersInput,
  ridersLine, removeRider, sameRiders, typedRider,
} from '../src/office/trip/passengersLogic';
import { bookInput, editFields, updateRequestInput, validateNewRequest } from '../src/office/trip/requestLogic';
import { newStop } from '../src/office/trip/stopsLogic';
import { isPassengerTrip, tripRoute } from '../src/office/tripsLogic';
import type { CreatedTaskCard, PassengerTrip, RequestCard, TaskDetail } from '../src/office/types';

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

// The server's own rules, loaded as they are.
const load = createRequire(import.meta.url);
const server = load(join(ROOT, 'supabase', 'functions', '_shared', 'fleet', 'passengers.ts')) as {
  MAX_PASSENGERS: number;
  countWith: (count: number | null | undefined, names: number) => number | null;
  passengerRows: (list: { person?: string; name?: string; phone?: string }[], people: Map<string, { name: string; phone: string | null }>) => { rows: unknown[] } | { error: string };
};
const checksTool = readFileSync(join(ROOT, 'supabase', 'functions', '_shared', 'fleet', 'tools', 'checks.ts'), 'utf8');

const asha: Rider = { person: 'e1', name: 'Asha Fernando', label: 'Office', photo_url: 'https://x/asha.jpg' };
const ruwan: Rider = { name: 'Ruwan', phone: '+94771234567' };

console.log('\nThe rules match the server');
{
  check(MAX_PASSENGERS === server.MAX_PASSENGERS, `at most ${MAX_PASSENGERS} by name, as the server`);
  const cases: [number | null, number][] = [[5, 2], [1, 3], [null, 0], [null, 2], [0, 0], [4, 4]];
  check(cases.every(([c, n]) => countWithNames(c, n) === server.countWith(c, n)), 'the count never under the names: the same as the server\'s countWith', cases.map(([c, n]) => [countWithNames(c, n), server.countWith(c, n)]));
  const people = new Map([['e1', { name: 'Asha Fernando', phone: '+94770000001' }]]);
  const sent = passengerList([asha, ruwan, { name: 'Nimal' }]);
  check('rows' in server.passengerRows(sent, people), 'what the forms send is what the server takes (a person, a name with a phone, a name alone)', sent);
  const typed = typedRider('Ruwan', '077 123 4567');
  check('rider' in typed && 'rows' in server.passengerRows(passengerList([typed.rider]), people), 'a typed Sri Lankan number passes the server\'s check');
  check(same(typedRider('', ''), { error: 'name' }) && same(typedRider('Ruwan', '12'), { error: 'phone' }) && same(typedRider(' Ruwan  Silva ', ''), { rider: { name: 'Ruwan Silva' } }), 'the name needed; a phone optional and Sri Lankan (else "phone")');
}

console.log('\nThe field: chips, never twice, back from an answer');
{
  const list = addRider(addRider([asha], asha), ruwan);
  check(list.length === 2 && addRider(list, { name: 'ruwan', phone: '0771234567' }).length === 2, 'the same person or the same name and number only once');
  check(removeRider(list, riderKey(asha)).length === 1 && removeRider(list, riderKey(asha))[0].name === 'Ruwan', '✕ takes one off');
  const many = Array.from({ length: MAX_PASSENGERS }, (_, i) => ({ name: `P${i}` }));
  check(addRider(many, ruwan).length === MAX_PASSENGERS, 'never over the limit');
  const back = ridersFrom([{ name: 'Asha Fernando', registered: true, employee_id: 'e1' }, { name: 'Ruwan', registered: false, phone: '+94771234567' }]);
  check(sameRiders(back, list) && same(passengerList(back), [{ person: 'e1' }, { name: 'Ruwan', phone: '+94771234567' }]), 'an answer\'s passengers_list read back as the riders it was');
  check(ridersLine(['Asha', 'Kamal'], 5) === 'Asha, Kamal +3' && ridersLine(['Asha', 'Kamal', 'Nimal'], null) === 'Asha, Kamal +1' && ridersLine([], 3) === '', '"Asha, Kamal +3"');
  check(passengersOn(undefined) && passengersOn({ settings: {} as never }) && !passengersOn({ settings: { passengers: false } as never }), 'the switch passengers: absent = on');
  check(same(passengerRow({ name: 'Asha', registered: true, call: 'tel:+9477' }), { registered: true }), 'a registered person: the photo row (no Call / Share)');
  check(same(passengerRow({ name: 'Ruwan', registered: false, phone: '+94771234567', phone_display: '077 123 4567', call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567', share: 'https://wa.me/94771234567?text=x' }),
    { registered: false, call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567', share: 'https://wa.me/94771234567?text=x', phone: '077 123 4567' }), 'someone without an account: Call, WhatsApp, Share trip');
}

console.log('\nThe trip calls carry passenger_list');
{
  const stops = [{ ...newStop('drop'), place: 'Kandy' }];
  const d = newDraft('request', '2026-10-23');
  const fields = { ...d.fields, leaveBy: '08:00', stops, pax: '5', riders: [asha] };
  const rf = requestFieldsOf({ fields, req: d.req });
  check(same(rf.riders, [asha]), 'the draft\'s riders reach the request fields (requestFieldsOf)');
  const v = validateNewRequest(rf);
  check('input' in v && same(v.input.passenger_list, [{ person: 'e1' }]) && v.input.pax === 5, 'create_request: passenger_list and the count', v);
  const b = bookInput(rf, { vehicle: 'WP CAB-4521', driver: 'kamal', defaultVehicle: 'WP CAB-4521' });
  check('input' in b && same(b.input.passenger_list, [{ person: 'e1' }]), 'book_vehicle: passenger_list', b);
  check(!('passenger_list' in ridersInput([])) && !('passenger_list' in ridersInput(undefined)), 'nobody named: no passenger_list');
  const task = validateAssign({ ...emptyAssign('2026-10-23'), title: 'Team drop', driver: 'kamal', vehicle: 'WP CAB-4521', leaveBy: '08:00', stops, riders: [ruwan] }, []);
  check('input' in task && same(task.input.passenger_list, [{ name: 'Ruwan', phone: '+94771234567' }]), 'create_task: passenger_list', task);
  // An edit of a request: the names alone go with the ids only (no re-approval on the server).
  const card = { fields: { date: '2026-10-23', time: '08:00', pax: 5 }, passengers_list: [{ name: 'Asha Fernando', registered: true, employee_id: 'e1' }] } as Pick<RequestCard, 'fields' | 'passengers_list'>;
  const was = editFields(card);
  check(same(was.riders, [{ person: 'e1', name: 'Asha Fernando' }]), 'the edit form starts from the request\'s names');
  const now = { ...was, riders: [...(was.riders ?? []), ruwan] };
  check(same(updateRequestInput('r1', 4, now, was), { input: { request_id: 'r1', version: 4, passenger_list: [{ person: 'e1' }, { name: 'Ruwan', phone: '+94771234567' }] } }), 'update_request: the names alone with request_id and version', updateRequestInput('r1', 4, now, was));
  const withNote = updateRequestInput('r1', 4, { ...now, note: 'Bring the keys' }, was);
  check('input' in withNote && withNote.input.pax === 5 && withNote.input.note === 'Bring the keys', 'with another change the count as it was goes too (the server never takes the names\' number for it)', withNote);
  check('error' in updateRequestInput('r1', 4, { ...was, riders: undefined }, was), 'the field off (riders undefined): nothing about the names, nothing changed');
  // Change the task.
  const t = { title: 'Team drop', passengers: 5, status: 'assigned', passengers_list: [{ name: 'Asha Fernando', registered: true, employee_id: 'e1' }] } as unknown as TaskDetail['task'];
  const f = changeFieldsOf(t);
  check(same(f.riders, [{ person: 'e1', name: 'Asha Fernando' }]), 'Change the task starts from the task\'s names');
  check(same(changeTaskInput('t1', 3, { ...f, riders: [] }, t), { input: { task_id: 't1', plan_version: 3, passenger_list: [] } }), 'update_task: everyone off = an empty list with the ids only');
  const titled = changeTaskInput('t1', 3, { ...f, title: 'New', riders: [asha, ruwan] }, t);
  check('input' in titled && titled.input.passengers === 5 && same(titled.input.passenger_list, [{ person: 'e1' }, { name: 'Ruwan', phone: '+94771234567' }]), 'update_task with a new title: the names and the count as it was', titled);
  check(same(ridersEdit({ task_id: 't1', plan_version: 3 }, [asha], [asha], { key: 'passengers', was: 5 }, ['task_id', 'plan_version']), { task_id: 't1', plan_version: 3 }), 'the same names in any order: nothing sent');
}

console.log('\nMy trips: a trip the person rides in');
{
  const ride = { source: 'task', role: 'passenger', id: 't9', task_id: 't9', title: 'Site visit', when: 'x', status: 'assigned', live: { state: 'approved', text: 'x' }, created: 'x' } as CreatedTaskCard;
  check(isPassengerTrip(ride) && tripRoute(ride) === '/office/my-trip/t9', 'tagged Passenger; it opens its view (office/my-trip/[id])');
  check(!isPassengerTrip({ ...ride, role: undefined }) && tripRoute({ ...ride, role: undefined }) === null, 'a task the person created stays as it was');
  check(routeForUrl('/my-trips/0f8fad5b-d9cb-469f-a165-70867728950e', ['view']) === '/office/my-trip/0f8fad5b-d9cb-469f-a165-70867728950e', 'the passenger notifications\' link (/my-trips/<task>) opens the trip for any office permission');
  const view: PassengerTrip = {
    viewer: 'passenger', task_id: 't9', title: 'Site visit', date: '2026-10-23', leave_at: '08:00', status: 'in_progress', live_text: 'On the way · 08:10', vehicle: 'WP CAB-4521',
    stops: [{ n: 1, type: 'pickup', place: 'Head office', status: 'done', arrived: '08:05' }, { n: 2, type: 'drop', place: 'Kandy', status: 'pending', planned: '10:30' }, { n: 3, type: 'visit', place: 'Matale', status: 'skipped' }],
    seen_at: '09:12',
  };
  check(isPassengerView(view) && !isPassengerView({ task_id: 't1' } as never) && !isPassengerView(null), 'my_trip\'s passenger view is told apart from a no-app trip');
  const server = [...checksTool.matchAll(/"((?:On the way|Completed|Cancelled|Driver accepted|Sent to the driver)[^"$]*)"/g)].map((m) => m[1]);
  check(server.length >= 3, 'the server\'s live words found in tools/checks.ts', server);
  for (const text of ['On the way · 07:40', 'On the way', 'Completed · 10:00', 'Completed', 'Cancelled', 'Driver accepted', 'Sent to the driver']) {
    const w = liveWords(text);
    check('key' in w && en(w.key, w.vars) === text, `"${text}" in the person's language (and the same in English)`, w);
  }
  check(same(liveWords('Something new'), { text: 'Something new' }), 'an unknown line as it came');
  check(view.stops.map((s) => { const w = stopWords(s); return w ? en(w.key, w.vars) : ''; }).join(' | ') === 'Done 08:05 | Planned 10:30 | Skipped', 'the stops as they go: Done 08:05, Planned 10:30, Skipped');
  check(passengerTone('in_progress') === 'blue' && passengerTone('completed') === 'green' && passengerTone('cancelled') === 'red' && passengerTone('assigned') === 'muted', 'the state\'s tone');
}

console.log('\nThe screens (read as text)');
{
  const who = read('app/office/trip/who.tsx');
  const review = read('app/office/trip/review.tsx');
  const time = read('app/office/task/[id]/time.tsx');
  const task = read('app/office/task/[id].tsx');
  const request = read('app/office/request/[id].tsx');
  const trips = read('app/office/(tabs)/trips.tsx');
  const myTrip = read('app/office/my-trip/[id].tsx');
  const parts = read('components/office/Passengers.tsx');
  check((who.match(/\{riding && <PassengersField value=\{f\.riders \?\? \[\]\} onChange=\{\(riders\) => setF\(\{ riders \}\)\} count=\{f\.pax\} \/>\}/g) ?? []).length === 2 && who.includes('passengersOn(settings.data)'), 'Who: Who rides under the passenger count on Assign a task and on a request, hidden with the switch off');
  check(review.includes('...noNames') && (review.match(/\.\.\.noNames/g) ?? []).length === 3 && review.includes('ridersLine(f.riders.map((r) => r.name)'), 'Review: no names with the switch off (task, request, Book now); "Asha, Kamal +3" in the chips');
  check(time.includes('<PassengersField value={f.riders ?? []} onChange={(riders) => set({ riders })} count={f.passengers} />') && (time.match(/\.\.\.noNames/g) ?? []).length === 2, 'Change the task: Who rides, the names through changeTaskInput');
  check(task.includes('<PassengerRows list={task.passengers_list} />') && task.includes('countWithNames(task.passengers'), 'Task detail: the count never under the names and a row each');
  check(request.includes('<PassengerRows list={card.passengers_list} />'), 'A request: Who rides');
  check(trips.includes("isPassengerTrip(trip) && <View style={{ flexDirection: 'row' }}><Pill text={t('office.passengers.tag')}"), 'My trips: the Passenger tag');
  check(myTrip.includes('isPassengerView(answer)') && myTrip.includes('<PassengerTripCard trip={riding} />') && myTrip.includes("{trip && mode === 'check'"), 'My trip: the passenger view, and none of the trip\'s own jobs for it');
  check(parts.includes("useTool<FoundPeople>('find_people', { text: query }, { enabled: !!query && mayFind })") && parts.includes('<Sheet') && parts.includes('<SelectableRow') && parts.includes("testID=\"passenger-share\""), 'the field: find_people as typed, the one sheet for someone without an account, the people as pick-many rows; Share trip on a row');
  const roleWord = /'(admin|fleet_admin|office|viewer|staff)'/;
  check(![parts, read('office/passengerView.ts')].some((s) => roleWord.test(s)), 'no role names');
}

console.log('\nStrings in both languages');
{
  const code = ['components/office/Passengers.tsx', 'app/office/trip/who.tsx', 'app/office/trip/review.tsx', 'app/office/task/[id]/time.tsx', 'app/office/task/[id].tsx', 'app/office/request/[id].tsx', 'app/office/(tabs)/trips.tsx', 'app/office/my-trip/[id].tsx', 'office/passengerView.ts'].map(read).join('\n');
  const keys = Array.from(new Set(Array.from(code.matchAll(/'(office\.passengers\.[A-Za-z_]+)'/g)).map((m) => m[1])));
  const families = ['onTheWay', 'onTheWayNoTime', 'completed', 'completedNoTime'].map((k) => `office.passengers.live_${k}`);
  const all = [...keys, ...families];
  const missing = all.filter((k) => typeof lookup('en', k) !== 'string' || typeof lookup('si', k) !== 'string');
  check(keys.length > 25 && missing.length === 0, `every office.passengers key exists in en and si (${keys.length})`, missing);
  const ph = (s: unknown) => (String(s).match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const badPh = all.filter((k) => ph(lookup('en', k)) !== ph(lookup('si', k)));
  check(badPh.length === 0, 'the same placeholders in both languages', badPh);
  check(!/[෦-෯]/.test(all.map((k) => String(lookup('si', k) ?? '')).join(' ')), 'Latin digits only in Sinhala');
  const sidecar = JSON.parse(read('i18n/parts/office-2.json')) as { en: Tree; si: Tree };
  check(!!sidecar.en && !!sidecar.si && typeof (sidecar.en as { office?: { passengers?: unknown } }).office?.passengers === 'object', 'the sidecar is shaped { en, si } from the root');
}

console.log(failures === 0 ? '\nAll passenger checks passed.' : `\n${failures} passenger check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
