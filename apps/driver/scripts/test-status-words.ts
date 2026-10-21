// The server's sentences read back into the person's language (Round 1, 21 October 2026): task sentences (task_board's
// status, task_detail's status_line) and a driver's presence (status_text). Never a key, never the English in Sinhala
// when the sentence is known; an unknown sentence as the server said it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { humanReason } from '../src/lib/humanReason';
import { sentenceText, sentenceWords } from '../src/office/statusWords';

const here = dirname(fileURLToPath(import.meta.url));
const load = (lang: string) => JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${lang}.json`), 'utf8'));
const dicts = { en: load('en'), si: load('si') };
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};

let failures = 0;
const check = (ok: boolean, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

console.log('Task sentences');
check(sentenceText(tr('en'), 'Sent · not opened yet') === 'Sent · not opened yet', 'Sent · not opened yet');
check(sentenceText(tr('en'), 'Seen by driver 16:06') === tr('en')('office.line.seen', { time: '16:06' }), 'Seen by driver 16:06');
check(sentenceText(tr('si'), 'Seen by driver 16:06').includes('16:06') && !/Seen by driver/.test(sentenceText(tr('si'), 'Seen by driver 16:06')), 'in Sinhala, with the time in Latin digits');

console.log('\nPresence sentences (status_text)');
const cases: [string, string][] = [
  ['Live · now', 'Live · now'],
  ['Live · 2 min ago', 'Live · 2 min ago'],
  ['Live · 3 h ago', 'Live · 3 h ago'],
  ['Location off since 09:10', 'Location off since 09:10'],
  ['Location off', 'Location off'],
  ['Location permission removed since 09:10', 'Location permission removed since 09:10'],
  ['No signal since 09:10', 'No signal since 09:10'],
  ['Off duty', 'Off duty'],
  ['On duty since 07:12', 'On duty since 07:12'],
  ['Off duty since 07:40', 'Off duty since 07:40'],
  ['On a task until ~10:40 (live)', 'On a task until ~10:40 (live)'],
  ['On a task until ~10:30 (planned)', 'On a task until ~10:30 (planned)'],
  ['On a task until ~10:30', 'On a task until ~10:30'],
  ['On a task · end time not set', 'On a task · end time not set'],
  ['Live · 2 min ago · 3 points refused', 'Live · 2 min ago · 3 points refused'],
];
for (const [server, en] of cases) {
  check(sentenceWords(server) !== null && sentenceText(tr('en'), server) === en, `read back: "${server}"`, sentenceText(tr('en'), server));
  const si = sentenceText(tr('si'), server);
  check(!/[A-Za-z]{3,}/.test(si.replace(/~/g, '')), `in Sinhala, no English words: "${server}"`, si);
}
check(sentenceText(tr('si'), 'Something new from the server') === 'Something new from the server', 'an unknown sentence: as the server said it (never a key)');
check(sentenceText(tr('en'), undefined) === '', 'nothing: nothing');

console.log('\nA refusal shown to a driver');
check(humanReason('Finish the trip you are on first.') === 'Finish the trip you are on first.', 'a sentence for people is shown');
for (const bad of ['not_on_duty', 'HTTP 500', '{"error":"x"}', 'trip.failed is missing', 'Task 3f2a9c1e-1234-4abc-9def-000000000000 not found', 'PGRST116 no rows', 'TypeError: undefined', '', null]) {
  check(humanReason(bad) === null, `never shown: ${JSON.stringify(bad)}`);
}

console.log('\nEvery text in en.json and si.json is for people');
{
  const leaks: string[] = [];
  const walk = (o: unknown, path: string, lang: string) => {
    if (typeof o === 'string') {
      const words = o.replace(/\{[^}]*\}/g, '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/g, '');
      const m = words.match(/\b[a-z]+_[a-z_]+\b|\b[a-z]+\.[a-z][A-Za-z]+\.[A-Za-z_]\w*\b|HTTP \d/);
      if (m) leaks.push(`${lang} ${path}: ${m[0]}`);
    } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, lang);
  };
  walk(dicts.en, '', 'en');
  walk(dicts.si, '', 'si');
  check(leaks.length === 0, 'no code names, keys or HTTP codes inside any text', leaks);
}

console.log(failures === 0 ? '\nAll status-words checks passed.' : `\n${failures} status-words check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
