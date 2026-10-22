// Part B, M5: the server's relative words ("2 h ago", "in 45 min", "Fri 16 Oct 09:00 (2 days ago)", a length "1 h 15 min",
// "20 min late") and an issue's due words ("reported 2 h ago", "waiting 3 h", "leave by Thu 22 Oct 08:30 · in 3 h") said in
// the person's language on Office mode's screens (lib/dateWords.ts relativeKey / relativeWords / whenWords,
// office/issuesLogic.ts dueWords, office/statusWords.ts "Last seen …"). The phrases come from the server's own
// @fleet/durations (supabase/functions/_shared/fleet/durations.ts), so a change of its words fails here first.
//   npm run test:relative-words          (from apps/driver)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { relativeKey, relativeWords, whenWords } from '../src/lib/dateWords';
import { dueWords } from '../src/office/issuesLogic';
import { sentenceText } from '../src/office/statusWords';

const here = dirname(fileURLToPath(import.meta.url));
// The server's own file, loaded as it is (its Deno-style "./time.ts" import is fine for tsx, not for the app's typecheck).
const server = createRequire(import.meta.url)(join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fleet', 'durations.ts')) as {
  duration: (minutes: number) => string;
  whenText: (at: Date, now: Date) => string;
};
const { duration, whenText } = server;
const load = (lang: string) => JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${lang}.json`), 'utf8'));
const dicts = { en: load('en'), si: load('si') };
const lookup = (lang: 'en' | 'si', key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(lang, key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const en = tr('en');
const si = tr('si');

let failures = 0;
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};
/** Sinhala with no English word left (numbers, times and the 24 h clock stay Latin; ETA is the server's own abbreviation). */
const noEnglish = (s: string) => !/[A-Za-z]{2,}/.test(s);

console.log('The server\'s relative words, as @fleet/durations says them');
{
  const now = new Date('2026-10-22T04:30:00Z'); // 10:00 Colombo, a Thursday
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  const offsets = [0, 5, 45, 59, 60, 75, 120, 200, 600, 1300, 1500, 3000, 4500, -5, -45, -60, -75, -200, -600, -1300, -1500, -3000, -4500];
  for (const min of offsets) {
    const phrase = whenText(at(min), now);
    const key = relativeKey(phrase);
    const s = relativeWords(si, phrase, now) ?? '';
    check(!!key && s !== phrase && noEnglish(s), `whenText ${min} min: "${phrase}" → "${s}"`);
    check(relativeWords(en, phrase, now) === phrase || /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(phrase), `the English reads back the same: "${phrase}"`, relativeWords(en, phrase, now));
  }
  for (const m of [1, 45, 60, 75, 120, 1440, 1500, 3000]) {
    const phrase = duration(m);
    const s = relativeWords(si, phrase) ?? '';
    check(s !== phrase && noEnglish(s), `duration ${m}: "${phrase}" → "${s}"`);
  }
  check(relativeWords(si, '20 min late') === si('dur.late', { dur: si('dur.minutes', { n: 20 }) }) && relativeWords(si, '1 h 15 min late') === si('dur.late', { dur: si('dur.hours', { h: 1, m: 15 }) }), 'a time late: "20 min late" → "මිනිත්තු 20 ප්‍රමාදයි"');
  check(relativeWords(si, 'Kandy late') === null && relativeKey('08:30') === null && relativeKey('Thu 22 Oct') === null && relativeKey('Someone else') === null, 'anything else is not a relative phrase');
  const earlier = whenWords(si, 'Fri 16 Oct 09:00 (6 days ago)', now);
  check(earlier.includes(si('days.5')) && earlier.includes(si('months.9')) && earlier.includes('09:00') && noEnglish(earlier), 'a farther time keeps its day and month, in the language\'s names', earlier);
  check(whenWords(si, 'Tue 20 Oct 11:42 (2 days ago)', now) !== 'Tue 20 Oct 11:42 (2 days ago)' && whenWords(si, '48 min ago', now) === si('dur.agoMin', { n: 48 }), 'a request\'s "asked" and the notification centre\'s "ago" through whenWords');
  check(whenWords(en, 'tomorrow 13:07', now) === `${en('date.tomorrow')} 13:07`, 'the day words before it keep their own rule ("Tomorrow 13:07")');
}

console.log('\nAn issue\'s due words (the server\'s issues.ts)');
{
  const now = new Date('2026-10-22T04:30:00Z');
  const cases: [string, string][] = [
    ['today', si('date.today')],
    ['tomorrow', si('date.tomorrow')],
    ['in 5 days', si('office.issues.dueInDays', { n: 5 })],
    ['3 d overdue', si('office.issues.dueOverdue', { n: 3 })],
    ['now', si('dur.now')],
    ['soon', si('office.issues.dueSoon')],
    ['reported 2 h ago', si('office.issues.dueReported', { when: si('dur.agoHoursOnly', { h: 2 }) })],
    ['logged yesterday 09:00', si('office.issues.dueLogged', { when: si('dur.yesterday', { time: '09:00' }) })],
    ['ended 45 min ago', si('office.issues.dueEnded', { when: si('dur.agoMin', { n: 45 }) })],
    ['for 20 min', si('office.issues.dueFor', { dur: si('dur.minutes', { n: 20 }) })],
    ['waiting 3 h', si('office.issues.dueWaiting', { dur: si('dur.hoursOnly', { h: 3 }) })],
    ['since 09:10', si('office.issues.dueSince', { time: '09:10' })],
    ['final ETA 11:40', si('office.issues.dueFinalEta', { time: '11:40' })],
  ];
  for (const [due, want] of cases) check(dueWords(si, due, now) === want, `"${due}" → "${want}"`, dueWords(si, due, now));
  const leave = dueWords(si, 'leave by Thu 22 Oct 08:30 · in 3 h', now);
  check(leave.split(' · ')[1] === si('dur.inHoursOnly', { h: 3 }) && leave.includes('08:30') && noEnglish(leave), 'leave by a day and time · how far: both parts said', leave);
  const needs = dueWords(si, 'leave by Thu 22 Oct 08:30 · needs a driver', now);
  check(needs.endsWith(si('office.issues.dueNeedsDriver')) && noEnglish(needs), 'leave by … · needs a driver', needs);
  for (const due of ['was to leave Wed 21 Oct 08:30', 'completed Wed 21 Oct 17:02', 'arrived Thu 22 Oct 09:41']) {
    const s = dueWords(si, due, now);
    check(s !== due && noEnglish(s), `"${due}" → "${s}"`);
  }
  check(dueWords(si, 'Sat 31 Oct', now) !== 'Sat 31 Oct' && noEnglish(dueWords(si, 'Sat 31 Oct', now)), 'a date in the language\'s names');
  check(dueWords(si, 'something new', now) === 'something new' && dueWords(si, undefined, now) === '', 'anything else as it came; nothing is nothing');
  check(dueWords(en, 'reported 2 h ago', now) === 'reported 2 h ago' && dueWords(en, 'leave by Thu 22 Oct 08:30 · in 3 h', now).endsWith('in 3 h'), 'English reads as the server said it');
}

console.log('\nPresence: "Last seen" with the server\'s relative words');
{
  const s = sentenceText(si, 'Last seen 3 h 20 min ago near Kadawatha');
  check(s.includes(si('dur.agoHours', { h: 3, m: 20 })) && s.includes('Kadawatha'), 'Last seen 3 h 20 min ago near Kadawatha', s);
  const y = sentenceText(si, 'Last seen yesterday 17:42');
  check(y.includes(si('dur.yesterday', { time: '17:42' })), 'Last seen yesterday 17:42', y);
}

console.log('\nEvery new key in both languages with the same placeholders');
{
  const keys = ['dur.late', ...['dueOverdue', 'dueInDays', 'dueSoon', 'dueReported', 'dueLogged', 'dueEnded', 'dueFor', 'dueWaiting', 'dueFinalEta', 'dueLeaveBy', 'dueNeedsDriver', 'dueWasToLeave', 'dueCompleted', 'dueArrived', 'dueSince'].map((k) => `office.issues.${k}`)];
  const holes = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of keys) {
    const e = lookup('en', k), s = lookup('si', k);
    check(typeof e === 'string' && typeof s === 'string' && holes(e) === holes(s) && /[඀-෿]/.test(String(s)), `${k}: both, the same {placeholders}, Sinhala in Sinhala`);
  }
}

if (failures) {
  console.log(`\n${failures} relative-words check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll relative-words checks passed.');
