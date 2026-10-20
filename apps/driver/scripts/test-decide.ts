// Stage 1 (O3 row 1): Approve's Change time and Tell requester (office/decideLogic.ts, the screens).
//
//   npm run test:decide          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { askedOf, asksFromTo, availabilityAt, decideTimes, DWELL_CHOICES, hasChange, redecideTimes, shownOf, timeProblem } from '../src/office/decideLogic';
import type { RequestCard } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

const card = { fields: { date: '2026-10-21', time: '08:00', back_by: '17:00', route_from: 'Head office', route_to: 'Kurunegala site', to_dwell_min: 60 }, trip: { leave_by: '07:40' } } as unknown as RequestCard;

console.log('\nThe times');
{
  const a = askedOf(card);
  check(same(a, { date: '2026-10-21', leaveBy: '07:40', back: '17:00', fromDwell: null, toDwell: 60 }), "as asked: the plan's leave-by first", a);
  check(asksFromTo(card) && !asksFromTo({ fields: { ...card.fields!, stops: [{ type: 'pickup' }] } } as unknown as RequestCard), 'From / To minutes only for a request asked as From / To');
  check(same(decideTimes({ date: '2026-10-21', leaveBy: '07:40' }, a), {}) && !hasChange({ date: '2026-10-21' }, a), 'the same values send nothing (no plan for nothing)');
  check(same(decideTimes({ date: '2026-10-22', leaveBy: '09:15', back: '18:00', fromDwell: 30, toDwell: 60 }, a), { date: '2026-10-22', leave_by: '09:15', back_by: '18:00', from_dwell_min: 30 }),
    'only what differs: the day, the leave-by, the back-by, a minutes change');
  check(same(decideTimes({ date: '21/10', leaveBy: '9', back: '' }, a), {}), 'nothing malformed is sent');
  check(same(decideTimes({ start: { name: ' Kandy depot ', placeId: 'p1', pinned: true } }, a), { start: { place_id: 'p1', place: 'Kandy depot' } })
    && same(decideTimes({ start: { name: 'Pin', lat: 7.1, lng: 80.2, pinned: true } }, a), { start: { place: 'Pin', lat: 7.1, lng: 80.2 } }), 'the start: a place, or a pin');
  check(same(redecideTimes({ date: '2026-10-22', leaveBy: '09:15', back: '18:00', fromDwell: 5 }, a), { date: '2026-10-22', time: '09:15', back_by: '18:00' }), 'a changed booking: the day, time and back-by only');
  check(same(shownOf({ leaveBy: '09:00', toDwell: null }, a), { date: '2026-10-21', leaveBy: '09:00', back: '17:00', fromDwell: null, toDwell: null }), 'shown: changed, else as asked');
  check(timeProblem({ leaveBy: '09:00', back: '08:30' }) === 'backBeforeLeave' && timeProblem({ leaveBy: '09:00', back: '' }) === null, 'a back-by before the leave is refused here');
  const av = availabilityAt({ at: '2026-10-21 07:40', until: '17:00', need_type: 'van' }, { ...a, date: '2026-10-22', leaveBy: '09:15', back: '08:00' });
  check(same(av, { at: '2026-10-22 09:15', need_type: 'van' }), "Who's available at the new time (a back-by before it dropped)", av);
  check(DWELL_CHOICES[0] === 0 && DWELL_CHOICES.includes(60), 'the minutes offered');
}

console.log('\nThe screens');
{
  const approve = src('app/office/request/[id].tsx');
  check(approve.includes("pathname: '/office/request/[id]/time'") && approve.includes("me.tools.includes(card.status === 'changed' ? 'redecide_request' : 'decide_request')"), 'Change time from Approve, only with the deciding tool');
  check(approve.includes('availabilityAt(availabilityArgs(card), shown)') && approve.includes('...decideTimes(change, asked)') && approve.includes("decision: 'change', ...redecideTimes(change, asked)"), "Who's available at the new time; the new time sent with the decision");
  check(approve.includes('testID="decide-changed"') && approve.includes('decideStore.set(id, null)') && approve.includes('testID="decide-undo"'), 'the new time shown with Undo; cleared once decided');
  check(approve.includes('setOutcome({ title, warnings })') && !approve.includes('Alert.alert(title') && approve.includes('<TellRequester'), 'after a decision the page stays: the outcome, the warnings, Tell requester');
  const time = src('app/office/request/[id]/time.tsx');
  check(time.includes('<TripDayPicker') && (time.match(/<TimeField/g) ?? []).length === 2 && time.includes('<PlaceSearch') && time.includes('<StickyActions>') && time.includes('disabled={!!block}'),
    'the Change time screen: the day, the two times on the time sheet, the start, Use these times disabled with its reason');
  check(!/TextInput|YYYY|HH:MM/.test(time), 'no typed date or time');
  const tell = src('components/office/TellRequester.tsx');
  check(tell.includes('Linking.openURL(tell.whatsapp)') && tell.includes("api.call('update_request', { request_id: q.id, version: q.version, requester_phone: next || null })") && tell.includes("has(me.permissions, 'approve') && me.tools.includes('update_request')"),
    "Tell requester: WhatsApp with the server's message; the phone saved with the version (empty clears), only for an approver");
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  for (const ns of ['decide', 'tell'] as const) {
    const keys = Object.keys(en.office[ns]);
    check(keys.length > 5 && keys.every((k) => typeof si.office[ns]?.[k] === 'string'), `office.${ns} in both languages`, keys.filter((k) => typeof si.office[ns]?.[k] !== 'string'));
  }
  const used = [approve, time, tell].join('\n');
  const asked = [...used.matchAll(/office\.(decide|tell)\.([a-zA-Z_]+)/g)].filter((m) => !m[2].endsWith('_')).map((m) => [m[1], m[2]] as const);
  check(asked.every(([ns, k]) => k in en.office[ns]), 'every key asked for exists', asked.filter(([ns, k]) => !(k in en.office[ns])));
  check(['approved', 'driver_changed', 'on_the_way', 'arrived', 'cancelled'].every((m) => `moment_${m}` in si.office.tell), 'every moment the server names');
}

console.log(failures === 0 ? '\nAll decide checks passed.' : `\n${failures} decide check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
