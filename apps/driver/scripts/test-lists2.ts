// Round 4–7 (item 8, the lists cleaned up, second part): Office mode's list rules (src/office/lists2Logic.ts) said in both
// languages, the strings (en.json / si.json deep-merged with the sidecars src/i18n/parts/*.json while they wait for the
// lead's merge: every key in both, Sinhala its own words with Latin digits and the same {placeholders}), and the screens
// using the rules with every key action still there (the source as text). `npx tsx scripts/test-lists2.ts`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendTrips, approveRowShown, docQuiet, driverStateShown, inboxWithUnread, requestChipShown, SECTION_FIRST, SECTION_PAGE, sectionNext, sectionShown,
  statusRest, taskChipShown, tripChipShown, TRIPS_PAGE, vehicleRowShown,
} from '../src/office/lists2Logic';
import type { MyTrips, RequestCard } from '../src/office/types';

type Tree = { [k: string]: string | Tree | string[] };
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const merge = (into: Tree, from: Tree): Tree => {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur, v);
    else into[k] = v;
  }
  return into;
};
const dicts = { en: JSON.parse(read('i18n/en.json')) as Tree, si: JSON.parse(read('i18n/si.json')) as Tree };
const parts: { en: Tree; si: Tree } = { en: {}, si: {} };
const partsDir = join(SRC, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const f of readdirSync(partsDir).filter((x) => x.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (p.en) { merge(dicts.en, p.en); if (f === 'lists2.json') merge(parts.en, p.en); }
    if (p.si) { merge(dicts.si, p.si); if (f === 'lists2.json') merge(parts.si, p.si); }
  }
}
const get = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Tree)[k] : undefined), tree);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = get(dicts[lang], key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`));
};
const en = tr('en');
const si = tr('si');

let failures = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

console.log('Vehicles: the plate once, one status, quiet valid documents');
{
  const v = { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', seats: 14, status: 'Available', availability: 'Free', active: true };
  check(same(vehicleRowShown(v, en), { title: 'Toyota HiAce · 14 seats', availability: 'Free', pill: null }), 'Available: the line "Free", no pill', vehicleRowShown(v, en));
  const garage = vehicleRowShown({ ...v, status: 'In garage', availability: 'In garage' }, en);
  check(garage.pill?.text === en('office.vehicles.filter_in_garage') && garage.pill.tone === 'amber' && garage.availability === '', 'In garage: the pill, the line without it again', garage);
  check(vehicleRowShown({ ...v, active: false }, en).pill?.text === en('office.vehicles.returned'), 'Returned: its pill');
  check(vehicleRowShown({ ...v, availability: undefined }, en).pill?.text === 'Available', 'an older answer without the line keeps the status pill');
  check(vehicleRowShown({ reg_no: 'WP X-1', type: 'van' }, en).title === en('office.vehicles.type_van'), 'no make: the type in words, never the plate again');
  check(vehicleRowShown({ reg_no: 'WP X-1', type: 'van' }, si).title === si('office.vehicles.type_van'), 'in Sinhala too');
  check(vehicleRowShown({ reg_no: 'WP X-1', type: 'tractor' }, en).title === en('office.lists2.vehicles.noMake'), 'an unknown type: "Make not set"');
  check(docQuiet('green') && !docQuiet('amber') && !docQuiet('red') && !docQuiet('muted'), 'only a valid document is quiet (expiring, expired and not set keep their colour)');
}

console.log('\nMy trips: the chip against its section and the Approved-by line; 25 at a time');
{
  check(!tripChipShown('waiting', 'waiting', false) && !tripChipShown('done', 'done', false) && !tripChipShown('expired', 'expired', false), 'never Waiting in WAITING, Done in DONE, Expired in EXPIRED');
  check(tripChipShown('declined', 'done', false) && tripChipShown('cancelled', 'done', false) && tripChipShown('missed', 'done', false), 'Declined, Cancelled, Missed in DONE stay');
  check(!tripChipShown('approved', 'coming', true) && tripChipShown('approved', 'coming', false), 'Approved: not beside "Approved by …", kept without it');
  check(tripChipShown('accepted', 'coming', true) && tripChipShown('onTheWay', 'coming', true), 'Accepted and On the way stay beside "Approved by …"');
  check(TRIPS_PAGE === 25, 'a page of 25');
  const card = (id: string, task = false) => (task ? { source: 'task', id } : { id }) as unknown as MyTrips['trips'][number];
  const list = { from: 'a', to: 'b', count: 2, total: 4, next: 'x', trips: [card('1'), card('1', true)] } as MyTrips;
  const out = appendTrips(list, { from: 'a', to: 'b', count: 2, total: 4, trips: [card('1'), card('2')] } as MyTrips);
  check(out.trips.length === 3 && out.next === undefined && out.total === 4, 'Load more appends the next page (never one twice; a request and a task may share an id); no next at the end', out);
}

console.log('\nApprove: the requester once, the chip against its section');
{
  const r = { requested_by: 'Nimali', title: 'Team drop', need: 'any van' } as RequestCard;
  check(same(approveRowShown(r, 'Tomorrow 09:00'), { title: 'Team drop', line: 'Nimali · Tomorrow 09:00 · any van' }), 'the trip as the title, the name in the line', approveRowShown(r, 'Tomorrow 09:00'));
  const bare = { requested_by: 'Sunil', need: 'car', proposed: { driver: 'Kamal', vehicle: 'WP CAB-4521' } } as RequestCard;
  check(same(approveRowShown(bare, 'Today 10:00'), { title: 'Sunil', line: 'Today 10:00 · car · Kamal · WP CAB-4521' }), 'no trip words: the name as the title, not in the line again', approveRowShown(bare, 'Today 10:00'));
  check(!requestChipShown('waiting', 'waiting') && requestChipShown('waiting', 'changed') && requestChipShown('all', 'waiting') && !requestChipShown('expired', 'expired'), 'no chip the section says; Changed under Waiting; every chip under All');
}

console.log('\nAlerts: Unread asked of the server');
check(same(inboxWithUnread({ limit: 50 }, 'unread'), { limit: 50, unread: true }) && same(inboxWithUnread({ limit: 50 }, 'all'), { limit: 50 }), 'unread: true only under Unread');

console.log('\nMileage: 5 rows, Show all 25, Load more 25');
check(SECTION_FIRST === 5 && SECTION_PAGE === 25 && sectionNext(5) === 25 && sectionNext(25) === 50 && sectionShown(32, 50) === 32 && sectionShown(3, 5) === 3, 'the steps');

console.log('\nDrivers: the state said once');
{
  const rest = (lang: 'en' | 'si', s: string) => statusRest(tr(lang), s);
  check(rest('en', 'On a task until ~15:40 (live)') === en('office.lists2.rest.untilLive', { time: '15:40' }), 'On a task until ~15:40 (live) → "Until ~15:40 (live)"', rest('en', 'On a task until ~15:40 (live)'));
  check(rest('en', 'On a task · end time not set') === en('office.lists2.rest.noEnd'), '"End time not set"');
  check(rest('en', 'Off duty') === '' && rest('en', 'Off duty since 07:40') === 'Since 07:40', 'Off duty: nothing; since 07:40: "Since 07:40"');
  check(rest('en', 'Not available, back 13:00') === 'Back 13:00' && rest('en', 'Not available today') === 'Today', 'Not available: "Back 13:00", "Today"');
  check(rest('en', 'Not available until Thu 22 Oct') === `Until ${en('office.when.day', { day: en('days.4'), date: '22', month: en('months.9') })}`, 'Not available until a day: the day in words', rest('en', 'Not available until Thu 22 Oct'));
  check(rest('en', 'Not available · leave, all day') === en('office.away.allDay', { reason: en('office.away.reasonLeave') }), 'Not available · a detail: the detail alone', rest('en', 'Not available · leave, all day'));
  check(rest('en', 'Off duty since 07:40 · 3 points refused') === `Since 07:40 · ${en('office.line.refused', { n: 3 })}`, 'the refused points kept');
  check(rest('en', 'Something new') === null && rest('en', 'On duty since 07:12') === null, 'a sentence the rule does not shorten: null (shown whole)');
  for (const s of ['On a task until ~15:40 (live)', 'Off duty since 07:40', 'Not available, back 13:00', 'Not available until Thu 22 Oct']) {
    const w = rest('si', s) ?? '';
    check(w !== '' && !/[A-Za-z]{3,}/.test(w) && !/[෦-෯]/.test(w), `in Sinhala, Latin digits: "${s}"`, w);
  }
  const d = (kind: string) => ({ status: { kind, text: '' } }) as Parameters<typeof driverStateShown>[0];
  check(same(driverStateShown(d('not_available'), 'all'), { pill: true, restOnly: true }), 'Not available under All: the pill, the line its rest');
  check(same(driverStateShown(d('not_available'), 'not_available'), { pill: false, restOnly: true }), 'under Not available: no pill (the filter says it)');
  check(same(driverStateShown(d('on_task'), 'on_task'), { pill: false, restOnly: true }) && same(driverStateShown(d('off_duty'), 'off_duty'), { pill: false, restOnly: true }), 'under On a task / Off duty: the rest');
  check(same(driverStateShown(d('on_duty'), 'free_now'), { pill: false, restOnly: false }) && same(driverStateShown(d('on_task'), 'all'), { pill: false, restOnly: false }), 'Free now and All: the whole sentence');
}

console.log('\nTasks: the chip only when neither the section nor the line says it');
{
  check(!taskChipShown('completed', 'done', {}) && taskChipShown('completed', 'notConfirmed', {}), 'DONE: no Done; Not confirmed stays');
  check(!taskChipShown('in_progress', 'underWay', {}) && taskChipShown('in_progress', 'late', {}), 'On the way: no Under way; Late stays');
  check(!taskChipShown('assigned', 'sent', { status: 'Sent · not opened yet' }) && !taskChipShown('assigned', 'seen', { status: 'Seen by driver 16:06' }) && !taskChipShown('assigned', 'accepted', { status: 'Accepted 16:10' }), 'Sent / Seen / Accepted beside the same sentence: no chip');
  check(taskChipShown('assigned', 'accepted', { status: 'Seen by driver 16:06' }) && taskChipShown('assigned', 'sent', { status: 'Something new' }), 'a chip the line does not say stays');
  check(!taskChipShown('assigned', 'selfDrive', {}) && !taskChipShown('assigned', 'someoneElse', {}), 'Self-drive / Someone else: the line names who drives');
  check(taskChipShown('declined', 'needsDriver', {}), 'Needs driver stays');
}

console.log('\nThe strings (office.lists2 in both languages)');
{
  const keys: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (typeof o === 'string') keys.push(path);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(parts.en, '');
  const siKeys: string[] = [];
  const walkSi = (o: unknown, path: string) => {
    if (typeof o === 'string') siKeys.push(path);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkSi(v, path ? `${path}.${k}` : k);
  };
  walkSi(parts.si, '');
  check(keys.length >= 12 && same([...keys].sort(), [...siKeys].sort()), 'every key in both languages', { en: keys.length, si: siKeys.length });
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  const bad = keys.filter((k) => {
    const e = get(dicts.en, k) as string;
    const s = get(dicts.si, k) as string;
    return !s || s === e || /[෦-෯]/.test(s) || ph(s) !== ph(e);
  });
  check(bad.length === 0, 'Sinhala its own words, Latin digits, the same {placeholders}', bad);
  const code = ['app/office/(tabs)/trips.tsx', 'app/office/(tabs)/approve.tsx', 'app/office/(tabs)/alerts.tsx', 'app/office/(tabs)/drivers.tsx', 'app/office/(tabs)/tasks.tsx',
    'app/office/reports/index.tsx', 'app/office/task-history.tsx', 'app/office/people/activity.tsx', 'app/office/vehicles/index.tsx', 'office/lists2Logic.ts'].map(read).join('\n');
  const used = [...new Set([...code.matchAll(/'(office\.lists2\.[\w.]+)'/g)].map((m) => m[1]))];
  const missing = used.filter((k) => typeof get(dicts.en, k) !== 'string' || typeof get(dicts.si, k) !== 'string');
  check(used.length >= 10 && missing.length === 0, `every office.lists2 key the screens use has text in both (${used.length})`, missing);
}

console.log('\nThe screens use the rules and keep every key action');
{
  const trips = read('app/office/(tabs)/trips.tsx');
  check(/tripChipShown\(k\.key, group, !!approved\)/.test(trips) && /q\.patch\(\(p\) => appendTrips\(p, page\), k, true\)/.test(trips) && /<LoadMore/.test(trips) && /const LIMIT = TRIPS_PAGE;/.test(trips)
    && /office\.passengers\.tag/.test(trips) && /canWithdraw\(trip\)/.test(trips) && /office\.trips\.callName/.test(trips) && /trip-request-again/.test(trips) && /trip-action/.test(trips) && /<FilterBar/.test(trips),
  'My trips: the chip rule, 25 with Load more; Passenger, Withdraw, Call, Request again, the trip action, Edit and the Filter kept');
  const approve = read('app/office/(tabs)/approve.tsx');
  check(/approveRowShown\(r, whenWords\(t, r\.when\)\)/.test(approve) && /requestChipShown\(status, r\.status\)/.test(approve) && /<LoadMore/.test(approve) && /testID="new-requests"/.test(approve) && /office\.approve\.reviewing/.test(approve) && /<FilterBar/.test(approve),
    'Approve: the requester once, the chip rule; Load more, New requests ↑, reviewing, the Filter kept');
  const alerts = read('app/office/(tabs)/alerts.tsx');
  check(!/styles\.open/.test(alerts) && /testID="alert-chevron"/.test(alerts) && /accessibilityHint=\{route \? t\('office\.alerts\.open'\)/.test(alerts) && /inboxWithUnread\(inboxArgs\(LIMIT, search, archived, q\.data\.next\), filter\)/.test(alerts)
    && /office\.alerts\.markAllRead/.test(alerts) && /<InboxActions/.test(alerts) && /<LoadMore/.test(alerts),
  'Alerts: the chevron alone ("Open" the hint), Unread asked of the server on every page; Mark all read, the item\'s buttons, Load more kept');
  const reports = read('app/office/reports/index.tsx');
  check((reports.match(/<MileageSection /g) ?? []).length === 5 && /link=\{shown <= SECTION_FIRST && rows\.length > SECTION_FIRST/.test(reports) && /<LoadMore shown=\{n\} total=\{rows\.length\}/.test(reports) && /key=\{`mileage-vehicles:\$\{k\}`\}/.test(reports),
    'Mileage: the five sections with 5 rows, Show all, Load more; another range starts again');
  const drivers = read('app/office/(tabs)/drivers.tsx');
  check(/driverStateShown\(d, filter\)/.test(drivers) && /statusRest\(t, d\.status\.text\)/.test(drivers) && /state\.pill \|\| line/.test(drivers) && /<AskBar/.test(drivers) && /openURL\(call\)/.test(drivers),
    'Drivers: the state once; Call, Ask drivers kept');
  const tasks = read('app/office/(tabs)/tasks.tsx');
  check(/taskChipShown\(column, k\.key, c\)/.test(tasks) && /office\.trip\.assignTask/.test(tasks) && /testID="tasks-history"/.test(tasks) && /office\.home\.giveDriver/.test(tasks) && /<LoadMore/.test(tasks),
    'Tasks: the chip rule; Assign a task, History, Give a driver, Load more kept');
  const vehicles = read('app/office/vehicles/index.tsx');
  check(/vehicleRowShown\(v, t\)/.test(vehicles) && /docQuiet\(tone\)/.test(vehicles) && /office\.lists2\.vehicles\.docValid/.test(vehicles) && /office\.vehicles\.register/.test(vehicles) && /<LoadMore/.test(vehicles) && /<FilterBar/.test(vehicles),
    'Vehicles: one status, quiet valid documents; Register, the Filter, Load more kept');
  check(/office\.lists2\.history\.section/.test(read('app/office/task-history.tsx')) && /office\.lists2\.activity\.section/.test(read('app/office/people/activity.tsx')),
    'Task history and Activity log: the section names what it holds (the header keeps the title)');
  const words = read('office/statusWords.ts');
  check(/export function taskChip\(/.test(words) && /export function tripChip\(/.test(words), 'statusWords.ts unchanged (shared with Home and the task page): its chips still made there');
}

console.log(failures === 0 ? '\nAll list (item 8, part 2) checks passed.' : `\n${failures} list check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
