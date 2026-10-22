// Part B (docs/design-pass.md §3, §4.5): the RouteStepper's steps from a plan's timeline and from a task's stops
// (office/stepsLogic.ts), and the one vocabulary for a task's and a request's state (office/taskLogic.ts taskStateChip,
// office/requestsLogic.ts requestStateChip), in both languages.
//   npm run test:steps          (from apps/driver)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestStateChip } from '../src/office/requestsLogic';
import { planSteps, stopType, taskSteps } from '../src/office/stepsLogic';
import { taskStateChip } from '../src/office/taskLogic';
import type { Stop, TimelineItem } from '../src/office/types';

const here = dirname(fileURLToPath(import.meta.url));
const load = (lang: string) => JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${lang}.json`), 'utf8'));
const dicts = { en: load('en'), si: load('si') };
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const en = tr('en');
const si = tr('si');

let failures = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

console.log('A plan\'s timeline as steps (Review, a request)');
{
  const items: TimelineItem[] = [
    { kind: 'leave', at: '07:00', source: 'manual' },
    { kind: 'leg', from_n: 'start', to_n: 1, km: 4.7, minutes: 9, source: 'estimate' },
    { kind: 'stop', n: 1, label: 'Stop 1', place: 'Kelaniya', planned_arrive: '07:09', planned_leave: '07:14', dwell_min: 5 },
    { kind: 'leg', from_n: 1, to_n: 2, km: 85, minutes: 126, source: 'google' },
    { kind: 'stop', n: 2, label: 'Stop 2', place: 'Maliyadeva College', planned_arrive: '09:20', planned_leave: '11:20', dwell_min: 120, arrive_by: '09:00', late_min: 20 },
    { kind: 'leg', from_n: 2, to_n: 'base', km: 86, minutes: 136, source: 'google' },
  ];
  const s = planSteps(en, items, { startName: 'Head office', back: { place: 'Head office', time: '13:36', line: en('office.request.backBy', { time: '14:00' }) } });
  check(same(s.map((x) => x.mark), ['S', '1', '2', 'B']), 'S, the stops in order, B', s.map((x) => x.mark));
  check(s[0].place === 'Head office' && s[0].time === '07:00' && s.every((x) => x.state === 'todo'), 'the start from the leave time; nothing driven yet');
  check(!!s[0].legAfter?.includes('4.7') && !!s[1].legAfter?.includes('85') && !!s[2].legAfter?.includes('86'), 'each leg with the step before it (the way back with the last stop)', s.map((x) => x.legAfter));
  check(s[2].delta?.tone === 'late' && s[2].delta.text === en('office.task.minLate', { min: 20 }) && s[2].note === en('office.request.arriveBy', { time: '09:00' }), 'an arrive-by missed: the late chip and the deadline');
  check(s[3].time === '13:36' && s[3].times === en('office.request.backBy', { time: '14:00' }), 'the way back with its time and its line');
  const r = planSteps(si, items, { reached: 2, startName: 'ප්‍රධාන කාර්යාලය' });
  check(r[1].mark === '3' && r[2].mark === '4' && r.length === 3, 'stops already reached keep their numbers (a running task\'s new stops); no way back unless asked');
}

console.log('\nA task\'s stops as steps (the task page)');
{
  const stops = [
    { id: 'a', seq: 1, n: 1, type: 'pickup', what: 'people', place: 'Office', status: 'done', progress: { planned_arrive: '09:00', arrived: '09:01', left: '09:06', arrive_delta_min: 1 } },
    { id: 'b', seq: 2, n: 2, type: 'drop', place: 'Wariyapola', status: 'arrived', progress: { planned_arrive: '10:30', arrived: '10:52', arrive_delta_min: 22, current: true } },
    { id: 'c', seq: 3, n: 3, type: 'visit', place: 'Depot', status: 'pending', progress: { planned_arrive: '12:00', estimate: { arrive: '12:20', updated: '10:52' } } },
    { id: 'd', seq: 4, n: 4, type: 'visit', place: 'Closed shop', status: 'skipped', skip_reason: 'closed' },
  ] as unknown as Stop[];
  const s = taskSteps(en, stops, { started: true, start: { place: 'Head office', planned: '08:30', left: '08:31' }, back: { place: 'Head office', time: '15:00' } });
  check(same(s.map((x) => x.state), ['done', 'done', 'here', 'todo', 'skipped', 'todo']), 'left = done, at the stop = here, still to come, skipped; the start left', s.map((x) => x.state));
  check(same(s.map((x) => x.mark), ['S', '1', '2', '3', '4', 'B']), 'S, 1…n, B', s.map((x) => x.mark));
  check(s[1].time === '09:00' && s[1].actual === '09:01' && !s[1].times?.includes(en('office.timeline.planned', { time: '09:00' })), 'the planned time is the time column, never repeated in the line', s[1].times);
  check(s[2].delta?.tone === 'late' && s[2].type === stopType(en, 'drop'), 'late 22 min, the type in words');
  check(s[3].noteTone === 'blue' && !!s[3].note?.includes('12:20'), 'a stop to come: its new estimate in blue');
  const notStarted = taskSteps(si, stops, { started: false });
  check(notStarted.every((x) => x.state === 'todo'), 'a task not started: every step still to come');
  const next = taskSteps(en, [{ ...stops[2], progress: { ...stops[2].progress, current: true } }] as Stop[], { started: true });
  check(next[0].state === 'next', 'the stop being driven to is "next" (ringed)');
  check(stopType(si, 'pickup', 'people') === `${si('office.trip.type_pickup')} · ${si('office.trip.what_people')}`, 'the type and what in Sinhala');
}

console.log('\nOne vocabulary (docs/design-pass.md §3)');
{
  const chip = (t: Parameters<typeof taskStateChip>[0]) => taskStateChip(t);
  check(same(chip({ status: 'assigned' }), { key: 'office.chip.sent', tone: 'muted' }) && chip({ status: 'assigned', seen: '08:00' }).key === 'office.chip.seen', 'Sent, Seen (grey)');
  check(same(chip({ status: 'assigned', accepted: '08:02' }), { key: 'office.chip.accepted', tone: 'blue' }) && same(chip({ status: 'in_progress' }), { key: 'office.chip.underWay', tone: 'blue' }), 'Accepted, On the way (blue)');
  check(same(chip({ status: 'completed' }), { key: 'office.chip.done', tone: 'green' }) && same(chip({ status: 'cancelled' }), { key: 'office.chip.cancelled', tone: 'muted' }), 'Done (green), Cancelled (grey)');
  check(same(chip({ status: 'assigned', needs_driver: { since: 'x' } as never }), { key: 'office.chip.needsDriver', tone: 'red' }) && same(chip({ status: 'missed' }), { key: 'office.chip.missed', tone: 'red' }), 'Needs a driver, Missed (red)');
  check(en('office.chip.underWay') === 'On the way' && en('office.chip.needsDriver') === 'Needs a driver' && si('office.chip.needsDriver') === si('office.status.declined'), 'the chip says the same words as the rest ("On the way", never "Under way")');
  check(same(requestStateChip('waiting'), { key: 'office.requests.status_waiting', tone: 'amber' }) && requestStateChip('changed').tone === 'amber' && requestStateChip('approved').tone === 'green' && requestStateChip('expired').tone === 'muted' && requestStateChip('declined').tone === 'muted', 'a request: Waiting and Changed amber, Approved green, the rest grey');
  for (const k of ['sent', 'seen', 'accepted', 'underWay', 'done', 'cancelled', 'needsDriver', 'missed']) check(/[඀-෿]/.test(si(`office.chip.${k}`)), `office.chip.${k} in Sinhala`);
}

if (failures) {
  console.log(`\n${failures} steps check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll steps checks passed.');
