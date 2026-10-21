// Round 2: the live stop timeline's words (office/stopTimelineLogic.ts) and the shared progress rule (lib/stopProgress.ts,
// a byte-identical copy of the server's _shared/fleet/stopProgress.ts).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deltaKind, stopProgress } from '../src/lib/stopProgress';
import { deltaOf, skipWords, stopLine } from '../src/office/stopTimelineLogic';
import type { Stop } from '../src/office/types';

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

console.log('The shared rule');
check(readFileSync(join(here, '..', 'src', 'lib', 'stopProgress.ts'), 'utf8') === readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', '_shared', 'fleet', 'stopProgress.ts'), 'utf8'),
  'lib/stopProgress.ts is the same file as the server\'s');
const at = (h: string) => `2026-10-21T${h}:00+05:30`;
const p = stopProgress([
  { id: 'a', seq: 1, status: 'arrived', planned_arrive_at: at('10:30'), planned_depart_at: at('11:30'), arrived_at: at('10:52'), done_at: null },
  { id: 'b', seq: 2, status: 'pending', planned_arrive_at: at('12:00'), planned_depart_at: at('12:10'), arrived_at: null, done_at: null },
], new Date(at('10:55')));
check(p[0].arrive_delta_min === 22 && p[1].estimate?.arrive === new Date(at('12:22')).toISOString(), 'arrived 22 min late: the next stop about 12:22', p);
check(deltaKind(-8)?.kind === 'early' && deltaOf(-8)?.tone === 'early' && deltaOf(1)?.tone === 'on_time', 'the delta in words matches the server\'s rule');

console.log('\nThe rows');
const en = tr('en');
const si = tr('si');
const here1: Stop = { seq: 2, n: 2, place: 'Wariyapola', status: 'arrived', progress: { planned_arrive: '10:30', planned_leave: '11:30', arrived: '10:52', arrive_delta_min: 22, current: true } } as Stop;
const l1 = stopLine(here1, en);
check(l1.times === 'Planned 10:30 · Arrived 10:52' && l1.delta?.text === '22 min late' && l1.delta.tone === 'late' && l1.current && l1.state === 'here', 'arrived late: "Planned 10:30 · Arrived 10:52", "22 min late" (amber), the current stop', l1);
const left: Stop = { seq: 1, n: 1, place: 'Office', status: 'done', progress: { planned_arrive: '09:00', arrived: '09:01', left: '09:06', arrive_delta_min: 1, leave_delta_min: 1 } } as Stop;
const l2 = stopLine(left, en);
check(l2.times === 'Planned 09:00 · Arrived 09:01 · Left 09:06' && l2.delta?.text === 'On time' && l2.state === 'left', 'left on time', l2);
const next: Stop = { seq: 3, n: 3, place: 'Kurunegala', status: 'pending', arrive_by: '12:30', progress: { planned_arrive: '12:00', estimate: { arrive: '12:22', leave: '12:32', updated: '10:52' } } } as Stop;
const l3 = stopLine(next, en);
check(l3.estimate === 'About 12:22 (updated 10:52)' && l3.arriveBy === 'Arrive by 12:30' && l3.delta === null && l3.state === 'next', 'a stop to come: "About 12:22 (updated 10:52)" and its deadline', l3);
const early = stopLine({ ...next, status: 'arrived', progress: { ...next.progress, arrived: '11:52', arrive_delta_min: -8, estimate: undefined } } as Stop, en);
check(early.delta?.text === '8 min early' && early.delta.tone === 'early' && early.estimate === null, 'arrived early: "8 min early" (green), no estimate any more', early);
const skipped = stopLine({ seq: 4, n: 4, place: 'Site', status: 'skipped', skip_reason: 'nobody_there', progress: { planned_arrive: '13:00' } } as Stop, en);
check(skipped.times === 'Planned 13:00 · Skipped · Nobody there' && skipped.state === 'skipped', 'a skipped stop says why in words (never the code)', skipped);
check(skipWords(en, 'not_visited') === 'Not visited' && skipWords(en, 'whatever') === '', 'every skip code has words; an unknown one shows nothing');
const old = stopLine({ seq: 1, n: 1, place: 'Office', status: 'done', planned_arrive: '09:00', arrived: '09:02', done: '09:10' } as Stop, en);
check(old.times === 'Planned 09:00 · Arrived 09:02 · Left 09:10', 'an older server with no progress: its own times', old);
// Round 2b (Sahan, 21 October 2026): a stop driven past and confirmed later by the driver.
const untimed = stopLine({ seq: 2, n: 2, place: 'Wariyapola', status: 'done', progress: { planned_arrive: '10:30', confirmed_later: true, time_not_recorded: true } } as Stop, en);
check(untimed.times === 'Planned 10:30 · Visited · time not recorded' && untimed.delta === null && untimed.confirmed === 'Confirmed later by the driver' && untimed.state === 'left',
  'confirmed later with no location points: "Visited · time not recorded", no difference, "Confirmed later by the driver"', untimed);
const timedLater = stopLine({ seq: 2, n: 2, place: 'Wariyapola', status: 'done', progress: { planned_arrive: '10:30', arrived: '10:38', left: '10:41', arrive_delta_min: 8, confirmed_later: true } } as Stop, en);
check(timedLater.times === 'Planned 10:30 · Arrived 10:38 · Left 10:41' && timedLater.delta?.text === '8 min late' && timedLater.confirmed !== null,
  'confirmed later with the points\' times: the times, the difference and the mark', timedLater);
check(l1.confirmed === null && skipped.confirmed === null, 'other stops: no mark');
const untimedSi = stopLine({ seq: 2, n: 2, place: 'Wariyapola', status: 'done', progress: { planned_arrive: '10:30', confirmed_later: true, time_not_recorded: true } } as Stop, si);
check(!/[A-Za-z]{3,}/.test([untimedSi.times, untimedSi.confirmed].join(' ')), 'in Sinhala too', untimedSi);
const s1 = stopLine(here1, si);
check(!/[A-Za-z]{3,}/.test([s1.times, s1.delta?.text].join(' ')) && s1.times.includes('10:52'), 'in Sinhala: no English words, Latin digits', s1);

console.log(failures === 0 ? '\nAll stop timeline checks passed.' : `\n${failures} stop timeline check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
