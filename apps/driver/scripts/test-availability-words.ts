// Round 4–7 (unify): a vehicle's availability line in the person's language (src/office/availabilityWords.ts): the server's
// English sentences read back into keys, an unknown one shown as sent. The sentences are made from the server's own source
// (supabase/functions/_shared/fleet, read as text: the files import Deno's packages, so tsx cannot load them): list_vehicles'
// availabilityOf (tools/vehicles.ts), suggest_vehicles' and availability's availabilityFor and a busy vehicle's `back`
// (tools/requests.ts), a task's window (fleet.ts taskWindow). A form the server adds, or words it changes, fail here first.
// Then: English reads back unchanged, Sinhala has no English word left and keeps Latin digits, an unknown sentence stays as
// sent, the keys are in both languages (en.json / si.json deep-merged with the sidecars src/i18n/parts/*.json while they
// wait for the lead's merge), and every Office mode screen that shows the line says it through availabilityText.
//   npx tsx scripts/test-availability-words.ts          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { availabilityText, availabilityWords } from '../src/office/availabilityWords';
import { vehicleRowShown } from '../src/office/lists2Logic';
import { sentenceText } from '../src/office/statusWords';
import { vehicleLine } from '../src/office/trip/formsLogic';
import type { SuggestedVehicle } from '../src/office/types';

type Tree = { [k: string]: string | Tree | string[] };
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const FLEET = join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fleet');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const server = (p: string) => readFileSync(join(FLEET, p), 'utf8');

const merge = (into: Tree, from: Tree): Tree => {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur, v);
    else into[k] = v;
  }
  return into;
};
const dicts = { en: JSON.parse(read('i18n/en.json')) as Tree, si: JSON.parse(read('i18n/si.json')) as Tree };
const partsDir = join(SRC, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const f of readdirSync(partsDir).filter((x) => x.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (p.en) merge(dicts.en, p.en);
    if (p.si) merge(dicts.si, p.si);
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
/** Sinhala with no English word left (times and numbers stay Latin). */
const noEnglish = (s: string) => !/[A-Za-z]{2,}/.test(s);
const sinhalaDigits = /[෦-෯]/;

// ---------------------------------------------------------------------------------------------------------------------
console.log('The server\'s availability sentences, made from its own source');
// A slice of a server file: from a marker to the end of its function (or statement).
function slice(text: string, from: string, end: string): string {
  const at = text.indexOf(from);
  if (at < 0) return '';
  const stop = text.indexOf(end, at);
  return text.slice(at, stop < 0 ? undefined : stop + end.length);
}
/** The string and template literals in a piece of code: "Free", `On a task · back ~${colomboTime(live)} (live)`. */
const literals = (code: string, after = ''): string[] =>
  [...code.matchAll(new RegExp(`${after}(?:"([^"\\n]*)"|\`([^\`\\n]*)\`)`, 'g'))].map((m) => m[1] ?? m[2]);

const TIMES = ['14:30', '09:05'];
const TITLE = 'Team drop · Kurunegala';
const SI_TITLE = 'කණ්ඩායම් ගමන';

const vehiclesTs = server('tools/vehicles.ts');
const requestsTs = server('tools/requests.ts');
const fleetTs = server('fleet.ts');
const listForms = literals(slice(vehiclesTs, 'export function availabilityOf(', '\n}\n'), 'availability: ');
const thenForms = literals(slice(requestsTs, 'const availability = v.in_garage', ';\n'));
const backLine = requestsTs.match(/back: clash\.end_by \? `([^`]*)` : "([^"]*)"/);
const backForms = backLine ? [backLine[1], backLine[2]] : [];
// The body only (its signature names fields in quotes).
const windowForms = literals(slice(fleetTs, 'export function taskWindow(', '\n}\n').split('return ')[1] ?? '');

check(same(listForms, ['In garage', 'On a task · back ~${colomboTime(live)} (live)', 'On a task · back ~${colomboTime(running.end_by)} (planned)', 'On a task · end time not set',
  'Booked later today · ${colomboTime(booked.start_at)}', 'Booked · ${colomboTime(booked.start_at)} (not started yet)', 'Free']), 'list_vehicles (tools/vehicles.ts availabilityOf): the seven forms', listForms);
check(same(thenForms, ['in garage', 'booked ${taskWindow(clash)} · ${clash.title}', 'over km allowance', 'free all day', 'free at that time (other task ${taskWindow(mine[0])})']),
  'suggest_vehicles / availability (tools/requests.ts availabilityFor): the five forms', thenForms);
check(same(backForms, ['back ~${colomboTime(clash.end_by)}', 'end time not set']), 'a busy vehicle\'s way back (suggest_vehicles\' busy group): two forms', backForms);
check(same(windowForms, ['${colomboTime(t.start_at)}–${colomboTime(t.end_by)}', 'from ${colomboTime(t.start_at)}']), 'a task\'s window (fleet.ts taskWindow): two forms', windowForms);

/** Every sentence a template makes: its times, each window form, a task's title. */
function made(template: string, title: string): string[] {
  const windows = windowForms.map((w, i) => w.replace(/\$\{[^}]*\}/g, () => TIMES[i % 2]).replace(/^(\d{2}:\d{2})–\d{2}:\d{2}$/, '$1–12:00'));
  let out = [template];
  if (/\$\{taskWindow\([^}]*\)\}/.test(template)) out = windows.map((w) => template.replace(/\$\{taskWindow\([^}]*\)\}/, w));
  return out.map((s) => s.replace(/\$\{[^}]*title[^}]*\}/, title).replace(/\$\{[^}]*\}/g, TIMES[0]));
}
const templates = [...listForms, ...thenForms, ...backForms];
const sentences = templates.flatMap((x) => made(x, TITLE));
const sentencesSi = templates.flatMap((x) => made(x, SI_TITLE));
check(sentences.length === 7 + 5 + 2 + 2 && sentences.includes('booked 14:30–12:00 · Team drop · Kurunegala') && sentences.includes('free at that time (other task from 09:05)'),
  `the sentences (${sentences.length}), the windows both ways`, sentences);

for (const [i, s] of sentences.entries()) {
  const w = availabilityWords(s);
  const back = availabilityText(en, s);
  const said = availabilityText(si, sentencesSi[i]);
  const times = s.match(/\d{2}:\d{2}/g) ?? [];
  check(!!w && back === s && said !== sentencesSi[i] && noEnglish(said) && !sinhalaDigits.test(said) && times.every((x) => said.includes(x)),
    `"${s}" → ${w?.key ?? 'unknown'} → "${said}"`, { key: w?.key, back, said });
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('\nThe words');
{
  check(availabilityText(si, 'Free') === 'නිදහස්' && availabilityText(si, 'In garage') === 'ගරාජයේ' && availabilityText(si, 'free all day') === 'මුළු දවසම නිදහස්', '"Free", "In garage", "free all day"');
  check(availabilityText(si, 'On a task · back ~14:30 (live)') === 'කාර්යයක · ~14:30 ට ආපසු (සජීවී)' && availabilityText(si, 'On a task · back ~14:30 (planned)') === 'කාර්යයක · ~14:30 ට ආපසු (සැලසුම්)', 'on a task: back ~14:30, live or planned');
  check(availabilityText(si, 'Booked later today · 16:00') === 'අද පසුව වෙන් කර ඇත · 16:00' && availabilityText(si, 'Booked · 09:00 (not started yet)') === 'වෙන් කර ඇත · 09:00 (තවම ආරම්භ කර නැත)', 'booked later today; booked, not started yet');
  check(availabilityText(si, 'booked from 09:00 · Team drop') === '09:00 සිට වෙන් කර ඇත · Team drop', 'a task\'s title stays as the office wrote it; "from 09:00" in words');
  check(availabilityText(si, 'free at that time (other task 09:00–12:00)') === 'එම වේලාවට නිදහස් (වෙනත් කාර්යය 09:00–12:00)', 'free then, the other task\'s window as it is');
  check(availabilityText(si, ' Free ') === 'නිදහස්', 'spaces around the sentence do not matter');
}

console.log('\nAn unknown sentence stays as the server sent it');
{
  for (const s of ['Parked at the yard', 'Booked · 9:00 (not started yet)', 'On a task · back ~14:30 (soon)', 'free', 'booked 09:00 · Team drop', 'In the garage', 'back 14:30']) {
    check(availabilityWords(s) === null && availabilityText(si, s) === s && availabilityText(en, s) === s, `"${s}"`);
  }
  check(availabilityText(si, '') === '' && availabilityText(si, null) === '' && availabilityText(si, undefined) === '', 'nothing: nothing');
  check(sentenceText(en, 'Free') === 'Free' && sentenceText(si, 'Free') === 'Free', 'statusWords\' own sentences unchanged (it does not read availability)');
}

console.log('\nThe keys');
{
  const keys = Object.keys(get(dicts.en, 'office.avail') as Tree);
  const missing = keys.filter((k) => typeof get(dicts.si, `office.avail.${k}`) !== 'string');
  // 15 vehicle lines, plus Round 48's nine trip-chip keys (freeToday … dayTomorrow, read by statusWords, not here).
  check(keys.length === 24 && missing.length === 0, `office.avail in both languages (${keys.length})`, missing);
  const used = new Set([...read('office/availabilityWords.ts').matchAll(/'office\.avail\.([A-Za-z_]+)'|`office\.avail\.([A-Za-z]+)_\$\{/g)].map((m) => m[1] ?? `${m[2]}_`));
  const unknown = [...used].filter((k) => (k.endsWith('_') ? !keys.some((x) => x.startsWith(k)) : !keys.includes(k)));
  check(unknown.length === 0 && used.size >= 14, `every key the rules ask for exists (${used.size})`, unknown);
  const ph = (s: string) => (s.match(/\{[a-z]+\}/gi) ?? []).sort().join(',');
  const differ = keys.filter((k) => ph(en(`office.avail.${k}`)) !== ph(si(`office.avail.${k}`)));
  check(differ.length === 0, 'the same placeholders in both', differ);
  const siWords = keys.map((k) => si(`office.avail.${k}`));
  check(siWords.every((s) => /[඀-෿]/.test(s) && noEnglish(s.replace(/\{[a-z]+\}/gi, ''))) && !sinhalaDigits.test(siWords.join(' ')), 'real Sinhala, Latin digits');
}

console.log('\nThe rules that show it');
{
  const v = { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', type: 'van', seats: 14, status: 'On a task', availability: 'On a task · back ~14:30 (live)', active: true };
  check(vehicleRowShown(v, en).availability === 'On a task · back ~14:30 (live)' && vehicleRowShown(v, si).availability === 'කාර්යයක · ~14:30 ට ආපසු (සජීවී)', 'the vehicles list\'s line (lists2Logic vehicleRowShown): English as sent, Sinhala in words');
  check(vehicleRowShown({ ...v, status: 'In garage', availability: 'In garage' }, si).availability === '', 'In garage: the pill says it, the line stays empty (as before)');
  const sv: SuggestedVehicle = { reg_no: 'WP C-3', make_model: 'Toyota HiAce', seats: 12, availability: 'booked 09:00–12:00 · Team drop', pick: 'no', back: 'back ~12:00', but: 'only 4 seats' };
  check(vehicleLine(sv, (n) => `${n} seats`) === 'Toyota HiAce · 12 seats · booked 09:00–12:00 · Team drop · only 4 seats · back ~12:00', 'a suggested vehicle\'s line without words: as the server sent it (as before)');
  check(vehicleLine(sv, (n) => `${n} seats`, (line) => availabilityText(si, line)) === 'Toyota HiAce · 12 seats · 09:00–12:00 වෙන් කර ඇත · Team drop · only 4 seats · ~12:00 ට ආපසු', 'with the words: the availability and the way back in Sinhala');
}

console.log('\nThe screens say it through availabilityText (read as text)');
{
  const says = /\(line\) => availabilityText\(t, line\)/;
  const files: [string, RegExp][] = [
    ['office/lists2Logic.ts', /availability: garage && \/garage\/i\.test\(line\) \? '' : availabilityText\(t, line\)/],
    ['app/office/vehicles/[reg].tsx', /\{v\.availability \? <Txt variant="muted" size=\{15\}>\{availabilityText\(t, v\.availability\)\}<\/Txt> : null\}/],
    ['components/office/VehicleGroups.tsx', says],
    ['app/office/task/[id]/time.tsx', says],
    ['app/office/trip/who.tsx', says],
    ['app/office/task/[id]/swap.tsx', /r\.booked \? availabilityText\(t, r\.booked\) : ''/],
    ['app/office/move/[username].tsx', /r\.booked \? availabilityText\(t, r\.booked\) : ''/],
  ];
  for (const [f, re] of files) check(re.test(read(f)), f);
  const vehicles = read('app/office/vehicles/index.tsx');
  check(/const shown = vehicleRowShown\(v, t\);/.test(vehicles) && /line=\{\[shown\.availability,/.test(vehicles), 'app/office/vehicles/index.tsx: the row\'s line from vehicleRowShown');
  // No screen prints the server's availability or way back as it came.
  const screens = ['app', 'components'].flatMap((d) => readdirSync(join(SRC, d), { recursive: true }).map((f) => `${d}/${String(f)}`)).filter((f) => f.endsWith('.tsx'));
  const raw = screens.filter((f) => /\{v\.availability\}|\{x\.availability\}|, v\.back\]|\[base, r\.booked\]/.test(read(f)));
  check(raw.length === 0, 'no screen shows the raw availability line', raw);
}

console.log(failures === 0 ? '\nAll availability words checks passed.' : `\n${failures} availability words check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
