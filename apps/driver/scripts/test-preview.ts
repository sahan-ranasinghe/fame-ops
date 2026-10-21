// Tests of Hotfix 2 in the driver app (B, D, F, I, J, K): the one duration formatter in English and Sinhala (59 min,
// 60 min, the same day, tomorrow morning, across midnight, 2 days, ago), the card's stops (four and "Show all"), the preview's data
// (totals, the vehicle words, what changed: fields, stops matched across the office's re-made rows, the push's
// changes and when they count), who to call (which buttons show, the fallbacks, one button per number), the vehicle
// confirm (the type rules, the words of each refusal, the queue: task_vehicle before the start's ops, a refusal kept),
// and the "New tasks" channel (a sound that is in the 1.2.0 build). Pure code, no stack needed:
//
//   npm run test:preview          (from apps/driver)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as realApi from '../src/lib/api';
import {
  channelsToRegister, hasPart6Sounds, isRinging, NEW_TASK_TITLES, NEW_TASKS_CHANNEL, NEW_TASKS_SOUND, NEW_TASKS_VIBRATION, newTasksChannel, officeIssuesChannel, officeRequestsChannel, remindersChannel, replacedChannels,
  officeAsksChannel, ringChannel, updatesChannel,
} from '../src/lib/channels';
import { channelFor as pushChannelFor, DAY_KINDS as PUSH_DAY_KINDS, TASK_KINDS as PUSH_TASK_KINDS } from '../../../supabase/functions/push-task/channels';
import { approvedBy, askedBy, officeCalls, parseOfficeContacts, parseTaskContacts, phoneDisplay, taskCalls, whatsappLink } from '../src/lib/contacts';
import { colomboDayDiff, durationText, relativeTime, type Translate } from '../src/lib/durations';
import {
  CARD_STOPS,
  cardStops,
  hasChanges,
  planTotals,
  pushChangeFields,
  pushChanges,
  seenCopy,
  taskChanges,
  typeWord,
  vehicleLine,
  vehicleWords,
} from '../src/lib/taskPreview';
import type { TaskStop, TaskWithStops, Vehicle } from '../src/lib/types';
import { candidates, heldFits, needsVehicle, refusalWords, refusedAnswer, taskVehicleOp, vehicleFits, wantedType } from '../src/lib/vehicleConfirm';
import { createSync, type Op, type QueueStore, type StoredOp } from '../src/sync/engine';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The strings, as the app reads them (src/i18n/index.ts needs the phone, so its lookup is repeated here).
const here = dirname(fileURLToPath(import.meta.url));
const lang = (code: string) => JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${code}.json`), 'utf8')) as Record<string, unknown>;
const strings = { en: lang('en'), si: lang('si') };
const lookup = (source: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), source);
const tr = (language: 'en' | 'si'): Translate => (key, vars) => {
  const found = lookup(strings[language], key) ?? lookup(strings.en, key);
  let text = typeof found === 'string' ? found : key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const en = tr('en');
const si = tr('si');
const names = (language: 'en' | 'si') => ({ days: lookup(strings[language], 'days') as string[], months: lookup(strings[language], 'months') as string[] });

const MIN = 60_000;
/** Sunday 18 October 2026, 09:00 in Colombo. */
const NOW = Date.parse('2026-10-18T09:00:00+05:30');
const at = (minutes: number) => NOW + minutes * MIN;

async function main() {
  // --- 1. D: the duration formatter --------------------------------------------------------------------------------
  console.log('Durations (D):');
  const rel = (minutes: number, language: 'en' | 'si' = 'en', now = NOW) => relativeTime(tr(language), names(language), now + minutes * MIN, now);
  check(rel(0.4) === 'now' && rel(-0.4) === 'now', 'under half a minute either way: "now"', [rel(0.4), rel(-0.4)]);
  check(rel(45) === 'in 45 min', '45 min ahead: "in 45 min"', rel(45));
  check(rel(59) === 'in 59 min', '59 min: still minutes', rel(59));
  check(rel(60) === 'in 1 h' && rel(59.6) === 'in 1 h', '60 min (and 59.6, rounded): "in 1 h"', [rel(60), rel(59.6)]);
  check(rel(200) === 'in 3 h 20 min', '200 min: "in 3 h 20 min"', rel(200));
  check(rel(10 * 60 + 15) === 'in 10 h 15 min', 'later the same day: hours', rel(10 * 60 + 15));
  check(rel(23 * 60 + 59) === 'tomorrow 08:59', '23 h 59 ahead is tomorrow morning: "tomorrow 08:59", not "in 23 h 59 min"', rel(23 * 60 + 59));
  check(rel(-(5 * 60)) === '5 h ago' && rel(-(15 * 60)) === 'yesterday 18:00', 'back in time: hours the same day, else yesterday', [rel(-(5 * 60)), rel(-(15 * 60))]);
  const lateEvening = Date.parse('2026-10-18T23:50:00+05:30');
  check(rel(20, 'en', lateEvening) === 'in 20 min', 'across midnight under an hour: minutes, not "tomorrow"', rel(20, 'en', lateEvening));
  check(rel(5 * 60, 'en', lateEvening) === 'in 5 h', 'across midnight under 6 h: hours', rel(5 * 60, 'en', lateEvening));
  check(rel(24 * 60) === 'tomorrow 09:00', '24 h ahead, the next day: "tomorrow 09:00"', rel(24 * 60));
  check(rel(24 * 60 + 30, 'en', Date.parse('2026-10-18T23:00:00+05:30')) === 'tomorrow 23:30', 'the next day late: "tomorrow 23:30"');
  check(rel(48 * 60) === 'Tue 20 Oct 09:00 (in 2 days)', 'two days: "Tue 20 Oct 09:00 (in 2 days)"', rel(48 * 60));
  check(rel(-45) === '45 min ago' && rel(-120) === '2 h ago' && rel(-200) === '3 h 20 min ago', 'ago: minutes, whole hours, hours and minutes', [rel(-45), rel(-120), rel(-200)]);
  check(rel(-24 * 60) === 'yesterday 09:00' && rel(-48 * 60) === 'Fri 16 Oct 09:00 (2 days ago)', 'ago: yesterday, then the date and the days', [rel(-24 * 60), rel(-48 * 60)]);
  check(rel(45, 'si') === 'මිනිත්තු 45 කින්' && rel(200, 'si') === 'පැය 3 මිනිත්තු 20 කින්', 'Sinhala: minutes and hours ahead', [rel(45, 'si'), rel(200, 'si')]);
  check(rel(24 * 60, 'si') === 'හෙට 09:00' && rel(48 * 60, 'si') === 'අඟහරුවාදා 20 ඔක් 09:00 (දින 2 කින්)', 'Sinhala: tomorrow, and the date in two days', [rel(24 * 60, 'si'), rel(48 * 60, 'si')]);
  check(rel(-45, 'si') === 'මිනිත්තු 45 කට පෙර' && rel(-24 * 60, 'si') === 'ඊයේ 09:00', 'Sinhala: ago, yesterday', [rel(-45, 'si'), rel(-24 * 60, 'si')]);
  const siAll = [45, 200, 24 * 60, 48 * 60, -45, -200, -48 * 60].map((m) => rel(m, 'si')).join(' ');
  check(/\d/.test(siAll) && !/[෦-෯]/.test(siAll), 'Latin digits in Sinhala too (no Sinhala digits)', siAll);
  check(durationText(en, 45) === '45 min' && durationText(en, 90) === '1 h 30 min' && durationText(en, 120) === '2 h' && durationText(en, 0) === '0 min',
    'a length of time: "45 min", "1 h 30 min", "2 h"', [durationText(en, 90), durationText(en, 120)]);
  check(durationText(si, 90) === 'පැය 1 මිනිත්තු 30' && durationText(si, 45) === 'මිනිත්තු 45', 'a length of time in Sinhala', durationText(si, 90));
  check(durationText(en, 26 * 60 + 10) === '1 d 2 h' && durationText(en, 48 * 60) === '2 d' && durationText(si, 26 * 60) === 'දින 1 පැය 2',
    'a day or more: "1 d 2 h", "2 d" (the server says it the same way)', [durationText(en, 26 * 60 + 10), durationText(si, 26 * 60)]);
  check(colomboDayDiff(Date.parse('2026-10-18T23:59:00+05:30'), Date.parse('2026-10-19T00:01:00+05:30')) === 1, 'the calendar day is Colombo\'s (23:59 → 00:01 is the next day)');

  // --- 2. I: the card's stops ----------------------------------------------------------------------------------------
  console.log('\nThe card\'s stops (I):');
  const five = [1, 2, 3, 4, 5];
  check(CARD_STOPS === 4 && same(cardStops(five, false), { shown: [1, 2, 3, 4], hidden: 1 }), 'five stops: the first four and one behind "Show all"');
  check(same(cardStops([1, 2, 3, 4], false), { shown: [1, 2, 3, 4], hidden: 0 }), 'four stops: all of them, no "Show all"');
  check(same(cardStops(five, true), { shown: five, hidden: 0 }), 'after "Show all": every stop');
  check(en('preview.showAll', { n: 5 }) === 'Show all 5 stops' && si('preview.showAll', { n: 5 }) === 'නැවතුම් 5 ම පෙන්වන්න', '"Show all 5 stops" in both languages');

  // --- 3. I, J: the preview's data -----------------------------------------------------------------------------------
  console.log('\nThe preview (I, J):');
  check(same(planTotals({ total_km: 42.4, total_drive_min: 75 }), { km: 42.4, driveMin: 75 }), 'totals from the plan');
  check(same(planTotals({ legs: [{ km: 10, minutes: 20 }, { km: 5.5, minutes: 10 }] }), { km: 15.5, driveMin: 30 }), 'no totals: the legs added up');
  check(same(planTotals({ legs: [{ km: 10 }, { km: null }] }), { km: null, driveMin: null }) && same(planTotals(null), { km: null, driveMin: null }), 'a leg without km, or no plan: nothing said');
  check(en('preview.totals', { km: '42', drive: durationText(en, 75) }) === '42 km · 1 h 15 min driving', '"42 km · 1 h 15 min driving"');
  const van: Vehicle = { id: 'v1', reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', vehicle_type: 'van', seats: 14, current_odometer_km: 1000, monthly_km_allowance: null, in_garage: false, active: true, photo_path: null, photo_thumb_path: null };
  const car: Vehicle = { ...van, id: 'v2', reg_no: 'CAR-1234', vehicle_type: 'car' };
  const vt = (vehicle_id: string | null, vehicle_mode: string, vehicle_type_wanted: string | null = null) => ({ vehicle_id, vehicle_mode, vehicle_type_wanted });
  check(vehicleLine(vt('v1', 'specific'), [van]).kind === 'vehicle', 'a vehicle set: its plate');
  check(vehicleWords(en, vehicleLine(vt(null, 'driver_day'), [van])) === 'Your vehicle on the day', 'driver_day: "Your vehicle on the day"');
  check(vehicleWords(en, vehicleLine(vt(null, 'any_type', 'van'), [van])) === 'Any van' && vehicleWords(si, vehicleLine(vt(null, 'any_type', 'double_cab'), [])) === 'ඕනෑම ඩබල් කැබ්',
    'any_type: "Any van" / "ඕනෑම ඩබල් කැබ්"', vehicleWords(si, vehicleLine(vt(null, 'any_type', 'double_cab'), [])));
  check(typeWord(en, 'double_cab') === 'double cab' && typeWord(en, 'spaceship') === 'vehicle', 'a type the strings do not know reads "vehicle", never the raw value');
  check(vehicleLine(vt('v9', 'any_type', 'van'), [van]).kind === 'unknown', 'a vehicle the phone does not know: no words (not "any van" for a set vehicle)');

  // What changed.
  const stop = (fields: Partial<TaskStop>): TaskStop => ({
    address: null, arrival_accuracy_m: null, arrival_at: null, arrival_distance_m: null, arrival_flag: null, arrival_lat: null,
    arrival_lng: null, arrive_by: null, arrived_at: null, auto_detected_at: null, confirmed_later_at: null, done_at: null, dwell_min: null, dwell_source: null,
    google_fetched_at: null, google_place_id: null, id: 's', is_start: false, lat: null, lng: null, note: null, place_id: null,
    place_name: 'Kurunegala site', planned_arrive_at: null, planned_depart_at: null, removed_at: null, saved_place_id: null,
    seq: 1, skip_note: null, skip_reason: null, status: 'pending', task_id: 't', type: 'drop', what: null,
    ...fields,
  });
  const task = (fields: Partial<TaskWithStops>): TaskWithStops => ({
    id: 't', title: 'Team drop', leave_by: '2026-10-18T04:00:00Z', start_at: '2026-10-18T04:00:00Z', end_by: null, vehicle_id: 'v1',
    vehicle_mode: 'specific', vehicle_type_wanted: null, passengers: 4, contact_name: 'Ashan', contact_phone: '0771234567', notes: null,
    status: 'assigned', accepted_at: null, approved_at: null, plan_json: null,
    task_stops: [
      stop({ id: 'a1', seq: 1, type: 'pickup', place_id: 'p-office', place_name: 'Head office' }),
      stop({ id: 'a2', seq: 2, type: 'drop', place_name: 'Kurunegala site' }),
      stop({ id: 'a3', seq: 3, type: 'visit', place_name: 'Kandy store' }),
    ],
    ...fields,
  } as TaskWithStops);
  const v1 = task({});
  const copy = seenCopy(v1, NOW);
  check(!hasChanges(taskChanges(copy, v1, null)), 'the same task: nothing marked');
  check(!hasChanges(taskChanges(null, v1, null)), 'a task never seen and no push: nothing marked');
  const moved = task({ leave_by: '2026-10-18T04:30:00Z', passengers: 5, accepted_at: '2026-10-18T03:00:00Z', seen_at: '2026-10-18T03:00:00Z' } as Partial<TaskWithStops>);
  check(same(taskChanges(copy, moved, null).fields.sort(), ['leave', 'passengers']), 'leave time and passengers marked; accepting or seeing it is not a change', taskChanges(copy, moved, null).fields);
  // The office's stop edit makes new rows: Kurunegala (now with a deadline), a new Galle stop, Kandy removed.
  const edited = task({
    task_stops: [
      stop({ id: 'b1', seq: 1, type: 'pickup', place_id: 'p-office', place_name: 'Head office' }),
      stop({ id: 'b2', seq: 2, type: 'drop', place_name: 'Kurunegala site', arrive_by: '2026-10-18T06:00:00Z' }),
      stop({ id: 'b3', seq: 3, type: 'drop', place_name: 'Galle site' }),
    ],
  });
  const c = taskChanges(copy, edited, null);
  check(c.stops.b1 === undefined && c.stops.b2 === 'changed' && c.stops.b3 === 'added', 'the re-made rows matched by place: unchanged, changed (a deadline), added', c.stops);
  check(same(c.removed, [{ place: 'Kandy store', type: 'visit' }]) && c.fields.includes('stops'), 'the stop that is gone is listed as removed', c.removed);
  const swapped = task({ task_stops: [v1.task_stops[0], { ...v1.task_stops[2], seq: 2 }, { ...v1.task_stops[1], seq: 3 }] });
  check(same(taskChanges(copy, swapped, null).stops, { a3: 'moved', a2: 'moved' }), 'two stops swapped: both moved');
  check(same(pushChangeFields({ time: 'Thu 15 Oct 09:30', vehicle: 'WP KL-1234', stops: true, notes: false, title: null }).sort(), ['leave', 'stops', 'vehicle']),
    'the push\'s changes: time → leave, vehicle, stops; false and null name nothing');
  check(same(pushChangeFields({ vehicle_day: true }), ['vehicle']) && same(pushChangeFields({ vehicle_any: 'van' }), ['vehicle']), 'vehicle_day / vehicle_any mark the vehicle');
  const push = pushChanges({ time: 'x', stops: [{ n: 2, change: 'changed', place: 'Kurunegala site' }, { n: 3, change: 'removed', place: 'Kandy store' }] }, NOW + 5 * MIN);
  const fromPush = taskChanges(null, v1, push);
  check(same(fromPush.fields.sort(), ['leave', 'stops']) && fromPush.stops.a2 === 'changed' && same(fromPush.removed, [{ place: 'Kandy store', type: '' }]),
    'a never-seen task opened from the push: its fields and named stops marked', fromPush);
  check(same(pushChanges({ stops: { list: [{ n: 1, change: 'added', place: 'X' }], more: 2 } }, NOW)?.stops, [{ n: 1, change: 'added', place: 'X' }]), 'the stops as {list, more} (the older shape) read too');
  check(hasChanges(taskChanges(seenCopy(v1, NOW + 10 * MIN, false), v1, push)), 'a copy kept when the task was first on Today: the push still counts (not read yet)');
  check(!hasChanges(taskChanges(seenCopy(v1, NOW + 10 * MIN, true), v1, push)), 'a copy kept when the driver opened the task after the push: the push was read');
  check(pushChanges({ notes: false }, NOW) === null, 'a push naming nothing is not kept');

  // --- 4. F, K: who to call ---------------------------------------------------------------------------------------------
  console.log('\nWho to call (F, K):');
  const full = parseTaskContacts({
    requester: { name: 'Nimal', phone: '+94771111111' },
    assigner: { name: 'Charuka', phone: '+94772222222' },
    approver: { name: 'Palitha', phone: '+94773333333', at: '2026-10-18T05:12:00Z' },
    approvers: [{ name: 'Palitha', phone: '+94773333333' }, { name: 'Sahan', phone: '+94774444444' }],
    office_phone: '+94112345678',
  });
  const calls = taskCalls({ contact_name: 'Ashan', contact_phone: '0775555555' }, full);
  check(same(calls.map((x) => x.kind), ['contact', 'requester', 'fleetAdmin', 'office']), 'every number known: contact, requester, fleet admin, office, in that order', calls.map((x) => x.kind));
  check(calls[0].tel === 'tel:+94775555555' && calls[0].whatsapp === 'https://wa.me/94775555555' && calls[0].display === '077 555 5555', 'a local number: tel:+94…, wa.me/94…, shown 077 555 5555', calls[0]);
  check(calls[2].name === 'Palitha' && calls[3].display === '011 234 5678', 'the fleet admin is who approved it; the office landline shown 011 234 5678');
  check(taskCalls({ contact_name: null, contact_phone: null }, null).length === 0, 'no numbers at all: no buttons');
  const noAsker = parseTaskContacts({ requester: { name: 'Nimal' }, assigner: { name: 'Charuka', phone: '+94772222222' }, approvers: [{ name: 'Sahan', phone: '+94774444444' }, { name: 'Palitha', phone: '+94773333333' }] });
  const fallback = taskCalls({ contact_name: null, contact_phone: null }, noAsker);
  check(fallback[0]?.kind === 'requester' && fallback[0].name === 'Charuka', 'the requester has no number: Call requester calls who assigned it', fallback[0]);
  check(same(fallback.filter((x) => x.kind === 'fleetAdmin').map((x) => x.name), ['Sahan', 'Palitha']) && !fallback.some((x) => x.kind === 'office'),
    'no approver named: the approvers with a number; no office number: no Call office', fallback.map((x) => [x.kind, x.name]));
  const samePerson = taskCalls({ contact_name: null, contact_phone: null }, parseTaskContacts({ requester: { name: 'Palitha', phone: '+94773333333' }, approver: { name: 'Palitha', phone: '+94773333333' } }));
  check(samePerson.length === 1 && samePerson[0].kind === 'requester', 'the same number twice (asked and approved by Palitha): one button');
  check(same(askedBy(full), { key: 'preview.askedBy', name: 'Nimal' }) && same(askedBy(parseTaskContacts({ assigner: { name: 'Charuka' } })), { key: 'preview.assignedBy', name: 'Charuka' }),
    '"Asked by Nimal", else "Given by Charuka"');
  const approved = approvedBy(full);
  check(approved?.name === 'Palitha' && approved.at === '2026-10-18T05:12:00Z' && approved.call?.tel === 'tel:+94773333333', '"Approved by Palitha · 10:42" calls Palitha');
  const noPhone = approvedBy(parseTaskContacts({ approver: { name: 'Palitha', at: '2026-10-18T05:12:00Z' }, office_phone: '+94112345678' }));
  check(noPhone?.call?.kind === 'office', 'the approver has no number: the line\'s Call is the office', noPhone?.call);
  check(approvedBy(parseTaskContacts({ approvers: [{ name: 'Sahan', phone: '+94774444444' }] })) === null, 'no approver named: no "Approved by" line');
  check(en('preview.approvedBy', { name: 'Palitha', time: '10:42' }) === 'Approved by Palitha · 10:42', 'the line reads "Approved by Palitha · 10:42"');
  const me = officeCalls(parseOfficeContacts({ office_phone: '+94112345678', approvers: [{ name: 'Palitha', phone: '+94773333333' }] }));
  check(same(me.map((x) => x.kind), ['fleetAdmin', 'office']), 'Me (a server before Round 1): the approvers, then Call office');
  // Round 1 (21 October 2026): only the chosen contacts, each once; "fleet admin" only for one who approves.
  const chosen = officeCalls(parseOfficeContacts({ office_phone: '+94112345678', contacts: [
    { name: 'Palitha', phone: '+94773333333', fleet_admin: true }, { name: 'Kumari', phone: '+94775555555', fleet_admin: false },
    { name: 'Palitha', phone: '+94773333333', fleet_admin: true },
  ], approvers: [{ name: 'Palitha', phone: '+94773333333' }, { name: 'Sahan', phone: '+94774444444' }] }));
  check(same(chosen.map((x) => `${x.kind}:${x.name ?? ''}`), ['fleetAdmin:Palitha', 'office:Kumari', 'office:']),
    'Me: the chosen contacts each once (Palitha as fleet admin, Kumari as office), then the office number; an approver not chosen is not shown', chosen);
  check(same(officeCalls(parseOfficeContacts({ office_phone: '+94112345678', contacts: [] })).map((x) => x.kind), ['office']), 'nobody chosen: the office number only');
  check(officeCalls(parseOfficeContacts(null)).length === 0 && parseTaskContacts('nope') === null, 'nothing from the server: no buttons, nothing parsed');
  check(phoneDisplay('+94771234567') === '077 123 4567' && phoneDisplay('0771234567') === '077 123 4567' && whatsappLink('+94 77 123 4567') === 'https://wa.me/94771234567',
    'numbers read 077 123 4567; WhatsApp gets the international digits');

  // --- 5. J: the vehicle confirm ---------------------------------------------------------------------------------------
  console.log('\nThe vehicle at Start task (J):');
  const anyVan = task({ vehicle_id: null, vehicle_mode: 'any_type', vehicle_type_wanted: 'van' });
  const onDay = task({ vehicle_id: null, vehicle_mode: 'driver_day' });
  check(needsVehicle(anyVan) && needsVehicle(onDay) && !needsVehicle(v1) && !needsVehicle({ ...anyVan, status: 'in_progress' }),
    'a task chosen on the day asks at Start task; one with the office\'s vehicle, or under way, does not');
  check(needsVehicle({ ...onDay, vehicle_id: 'v-confirmed-before' }),
    'asked again at the next Start task although a vehicle was confirmed before (the driver backed out, or it came from another driver)');
  check(wantedType(anyVan) === 'van' && wantedType(onDay) === null, 'any_type wants its type; on the day any vehicle');
  check(vehicleFits(anyVan, van) === 'ok' && vehicleFits(anyVan, car) === 'wrong_type' && vehicleFits(onDay, car) === 'ok', 'the type rule');
  check(vehicleFits(onDay, { ...van, in_garage: true }) === 'in_garage', 'a vehicle in the garage never fits');
  check(heldFits(anyVan, van) === van && heldFits(anyVan, car) === null && heldFits(anyVan, null) === null, '"Use <plate>" only for the held vehicle when it fits');
  const list = candidates(anyVan, [{ ...van, id: 'g', in_garage: true }, car, van]);
  check(same(list.map((v) => v.id), ['v1', 'g']), 'Any van: vans only, the ones that fit first, the garage one last', list.map((v) => v.id));
  check(candidates(onDay, [car, van]).length === 2, 'on the day: every vehicle');
  check(refusalWords(en, 'wrong_type', 'CAR-1234', 'van') === 'CAR-1234 is not a van.' && refusalWords(en, 'in_garage', 'WP CAB-4521', null) === 'WP CAB-4521 is in the garage.',
    'the refusals in words: wrong type, in the garage');
  check(refusalWords(en, 'not_yours', '', null) === en('task.alreadyReassigned') && refusalWords(en, 'started', '', null) === en('task.alreadyStarted'), 'given to another driver, started already: the words the app has');
  check(en('vehicleConfirm.failed', { reason: refusalWords(si, 'in_garage', 'WP CAB-4521', null) }).includes('WP CAB-4521'), 'the reason goes into "Couldn\'t set the vehicle: …"');
  check(refusedAnswer('task vehicle: wrong_type') === 'wrong_type', 'the refused op\'s word is read back from its message');

  // The queue: an offline confirm goes before the start's ops; a refusal is kept and the start behind it too.
  const TASK = 'aaaaaaaa-0000-4000-8000-000000000001';
  const odometer: Op = { kind: 'odometer_log', row: { id: 'o1', vehicle_id: 'v1', employee_id: 'e1', task_id: TASK, reading_km: 1000, kind: 'task_start', logged_at: '2026-10-18T04:00:00Z' } };
  const startOp: Op = { kind: 'task_patch', id: TASK, patch: { status: 'in_progress', start_odometer_km: 1000, started_at: '2026-10-18T04:00:00Z' } };
  const confirmOp = taskVehicleOp(TASK, 'v1', '2026-10-18T03:59:00Z');
  check(same(confirmOp, { kind: 'task_vehicle', id: TASK, vehicle_id: 'v1', at: '2026-10-18T03:59:00Z' }), 'the op: {kind task_vehicle, id = the task, vehicle_id, at}');
  const run = async (answer: string | 'network') => {
    const q = memoryStore();
    const calls: string[] = [];
    const refused: string[] = [];
    let vehicleSet = false;
    const api = {
      ...realApi,
      confirmTaskVehicle: async (_c: unknown, id: string, vehicle: string) => {
        calls.push(`vehicle:${id === TASK}:${vehicle}`);
        if (answer === 'network') throw new realApi.ApiError('task vehicle: Network request failed', false);
        if (answer === 'ok') vehicleSet = true;
        return answer;
      },
      insertOdometerLog: async () => void calls.push('odometer'),
      // The database refuses a start with no vehicle (tasks_vehicle_present_check).
      patchTask: async (_c: unknown, _id: string, patch: realApi.TaskPatch) => {
        calls.push(`task:${patch.status}`);
        if (!vehicleSet) throw new realApi.ApiError('task: violates check constraint "tasks_vehicle_present_check"', true, '23514', 400);
      },
      fetchTaskStatus: async () => 'assigned',
    } as unknown as typeof realApi;
    const sync = createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => undefined,
      removeFile: () => undefined,
      api,
      now: () => NOW,
      onRefused: (op, message) => refused.push(`${op.kind}:${message}`),
    });
    q.add(confirmOp, odometer, startOp);
    const result = await sync.flush({ force: true });
    return { q, calls, refused, result };
  };
  {
    const { q, calls, result } = await run('ok');
    check(calls.join() === 'vehicle:true:v1,odometer,task:in_progress' && result.sent === 3 && q.waiting().length === 0, "'ok': the vehicle first, then the reading and the start", calls);
  }
  {
    const { q, calls, refused, result } = await run('in_garage');
    check(calls.join() === 'vehicle:true:v1,odometer,task:in_progress' && result.failed === 2, 'refused (in the garage): the start behind it is refused too', { calls, result });
    check(same(q.failed().map((f) => f.kind), ['task_vehicle', 'task_patch']) && q.failed()[0].error === 'task vehicle: in_garage', 'both kept on the phone as failed (Me can try them again)', q.failed());
    check(refused[0] === 'task_vehicle:task vehicle: in_garage' && refusedAnswer(refused[0].slice('task_vehicle:'.length)) === 'in_garage', 'the screens hear the refusal and its word (said in words on Today and the task)', refused);
  }
  {
    const { q, calls, result } = await run('started');
    check(calls[0] === 'vehicle:true:v1' && !q.failed().some((f) => f.kind === 'task_vehicle') && result.sent >= 1, "'started' (the task is under way already): done, not an error", { calls, failed: q.failed() });
  }
  {
    const { q, calls, result } = await run('network');
    check(result.offline && calls.length === 1 && q.waiting().join() === 'task_vehicle,odometer_log,task_patch', 'no connection: everything waits, the vehicle first', q.waiting());
  }

  // --- 6. B: the "New tasks" channel -------------------------------------------------------------------------------------
  console.log('\nThe "New tasks" channel (B):');
  const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8')) as { expo: { plugins: unknown[]; version: string } };
  const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [string, { sounds?: string[] }] | undefined;
  const bundled = (plugin?.[1].sounds ?? []).map((path) => path.split('/').pop());
  const spec = newTasksChannel(en);
  check(spec.id === 'new-tasks' && NEW_TASKS_CHANNEL === 'new-tasks', 'a new channel id: new-tasks (Android fixes a channel\'s settings when it is made)');
  check(bundled.includes(NEW_TASKS_SOUND) && existsSync(join(here, '..', 'assets', 'sounds', NEW_TASKS_SOUND)) && appJson.expo.version === '1.3.0',
    `its sound ${NEW_TASKS_SOUND} is one the build bundles (app.json's expo-notifications sounds)`, bundled);
  // Part 6 (the 1.3.0 build): three channels with sounds of their own, bundled, and registered with the token once made.
  const part6 = [ringChannel(en), updatesChannel(en), officeAsksChannel(en)];
  check(part6.map((c) => `${c.id}:${c.sound}`).join(' ') === 'task-ring:task_ring.ogg task-updates:task_update.ogg office-asks:office_ask.ogg'
    && part6.every((c) => bundled.includes(c.sound) && existsSync(join(here, '..', 'assets', 'sounds', c.sound)) && c.name && !c.name.startsWith('channel.')),
    'Part 6: task-ring, task-updates and office-asks, each with its own bundled sound and a name in the language', part6.map((c) => c.id));
  check(channelsToRegister({ newTasks: true, asks: true, ring: true, updates: true, officeAsks: true }).join(',') === 'new-tasks,driver-asks,task-ring,task-updates,office-asks'
    && channelsToRegister({ newTasks: true, asks: true }).join(',') === 'new-tasks,driver-asks',
    'the phone registers each channel it has made (a 1.2.0 app: the two it had)');
  check(channelsToRegister({ newTasks: false, asks: false, ring: true, updates: true, officeAsks: true, reminders: true }).join(',') === 'task-ring,task-updates,office-asks,task-reminders',
    'a 1.3.0 phone registers its four (it no longer makes the 1.2.0 ones)');
  // Office mode's own channels (21 October 2026): a bundled 1.3.0 sound each, a name in each language, registered, and made
  // only with an office person signed in.
  const office = [officeRequestsChannel(en), officeIssuesChannel(en)];
  check(office.map((c) => `${c.id}:${c.sound}`).join(' ') === 'office-requests:office_ask.ogg office-issues:new_task.wav'
    && office.every((c) => bundled.includes(c.sound) && c.importance === 'max' && c.vibrationPattern.length > 1)
    && office.map((c) => c.name).join('|') === 'Requests and approvals|Issues'
    && officeRequestsChannel(si).name !== office[0].name && officeIssuesChannel(si).name !== office[1].name,
    'the office channels: Requests and approvals, Issues, each a sound in the build, loud, named in each language', office.map((c) => c.id));
  check(channelsToRegister({ newTasks: false, asks: false, ring: true, updates: true, officeAsks: true, reminders: true, officeRequests: true, officeIssues: true }).join(',') === 'task-ring,task-updates,office-asks,task-reminders,office-requests,office-issues',
    'an office phone registers the office channels too');
  check(/if \(getOfficeMe\(\) && hasPart6Sounds/.test(readFileSync(join(here, '..', 'src/lib/notifications.ts'), 'utf8')), 'the office channels are made only with an office person signed in (never for a driver)');
  const source = (file: string) => readFileSync(join(here, '..', file), 'utf8');
  const reminders = remindersChannel(en);
  check(reminders.id === 'task-reminders' && bundled.includes(reminders.sound) && reminders.name === 'Task reminders' && remindersChannel(si).name !== reminders.name,
    'Part 6: task-reminders (leave in 30, leave now, accept, the arrival nudge) with a bundled sound and a name in each language');
  // Every kind push-task sends, for every set a phone may register: never on a channel that phone has deleted.
  const kinds = [...PUSH_TASK_KINDS, ...PUSH_DAY_KINDS];
  const sets: string[][] = [
    [], ['new-tasks'], ['new-tasks', 'driver-asks'],
    ['task-ring', 'task-updates', 'office-asks'],
    ['task-ring', 'task-updates', 'office-asks', 'task-reminders'],
    channelsToRegister({ newTasks: false, asks: false, ring: true, updates: true, officeAsks: true, reminders: true }),
  ];
  const onDeleted = sets.flatMap((set) => kinds.map((k) => [set.join('+') || 'none', k, pushChannelFor(k, set)] as const)
    .filter(([, , ch]) => replacedChannels(set).includes(ch)));
  check(onDeleted.length === 0, 'push-task never sends a kind on a channel the phone deleted (every registered set, every kind)', onDeleted);
  check(same(replacedChannels(channelsToRegister({ newTasks: false, asks: false, ring: true, updates: true, officeAsks: true, reminders: true })),
    ['new-tasks', 'driver-asks', 'tasks-new', 'tasks-changed']) && replacedChannels(['new-tasks', 'driver-asks']).length === 0,
    'a 1.3.0 phone deletes new-tasks, driver-asks, tasks-new ("New tasks") and tasks-changed; a 1.2.0 phone deletes nothing');
  const setNames = [ringChannel(en), updatesChannel(en), officeAsksChannel(en), remindersChannel(en)].map((c) => c.name);
  check(new Set(setNames).size === 4 && setNames.filter((n) => /new tasks/i.test(n)).length === 1 && !setNames.includes('Task changes'),
    'on 1.3.0 one "New tasks" in the phone\'s settings (the ring), and no "Task changes" beside "Changed and cancelled tasks"', setNames);
  const pushTs = source('src/lib/push.ts');
  check(/if \(named\) await removeReplacedChannels\(channels\)/.test(pushTs) && /named = false/.test(pushTs),
    'the old channels go only after the server took the token with the new ones (not on a server without p_channels)');
  check(hasPart6Sounds('1.3.0') && hasPart6Sounds('1.10.2') && hasPart6Sounds('2.0.0') && !hasPart6Sounds('1.2.0') && !hasPart6Sounds('1.1.0')
    && !hasPart6Sounds(null) && !hasPart6Sounds(''),
    'the three channels only on a 1.3.0 build (an older build would fix them to the default sound)');
  const pushSource = readFileSync(join(here, '..', '..', '..', 'supabase', 'functions', 'push-task', 'index.ts'), 'utf8');
  const newTitles = [...pushSource.matchAll(/^\s+new: \{ title: "([^"{]+?) ?\{when\}"/gm)].map((m) => m[1]);
  check(same(newTitles, NEW_TASK_TITLES), 'the app knows push-task\'s new-task titles in both languages', newTitles);
  check(isRinging({ title: 'New task Sat 09:30', data: { 'android.title': 'New task Sat 09:30' } })
    && isRinging({ title: 'නව කාර්යය අද 14:00', data: {} }) && isRinging({ title: 'x', data: { kind: 'new' } }) && isRinging({ data: { kind: 'test' } })
    && !isRinging({ title: 'Task changed Sat 09:30', data: {} }) && !isRinging({ title: 'Sharing my location', data: {} })
    && !isRinging({ title: 'Free for a trip?', data: { kind: 'ask' } }) && !isRinging({ title: null, data: null }),
    'the ring stops for a new task shown by the app (its data) or by Android in the background (its title), and the sound test; nothing else');
  check(spec.importance === 'max' && spec.lockscreen === 'public', 'maximum importance (heads-up) and the whole notification on the lock screen');
  check(NEW_TASKS_VIBRATION.length >= 6 && NEW_TASKS_VIBRATION.filter((_, i) => i % 2 === 1).every((ms) => ms >= 800), 'a long vibration: three pulses of 800 ms', NEW_TASKS_VIBRATION);
  check(spec.name === 'New tasks' && newTasksChannel(si).name === 'නව කාර්යයන්' && newTasksChannel(si).description !== '', 'the name and description in the driver\'s language');
  check(same(channelsToRegister(true), ['new-tasks']) && same(channelsToRegister(false), []), 'the token names the channel only once it exists (register_device_token p_channels)');
  const notifications = source('src/lib/notifications.ts');
  check(/notifyNewTask[\s\S]*?ready\.ring \? RING_CHANNEL : ready\.newTasks \? CHANNELS\.newTasks/.test(notifications)
    && /showTestNotification[\s\S]*?ready\.ring \? RING_CHANNEL : ready\.newTasks \? CHANNELS\.newTasks/.test(notifications),
    'the local new-task notification (no push token) and the sound test use it too (on 1.3.0 the ring)');
  check(/channelsToRegister\(await ensureChannels\(\)\)/.test(source('src/lib/push.ts')), 'the channels are made before the token is registered with them');

  // --- 7. Strings and screens --------------------------------------------------------------------------------------------
  console.log('\nStrings and screens:');
  const files = [
    'src/components/TaskPreview.tsx', 'src/components/CallButtons.tsx', 'src/components/VehicleConfirm.tsx', 'src/components/task.tsx',
    'src/app/(tabs)/index.tsx', 'src/app/task/[id].tsx', 'src/app/(tabs)/me.tsx', 'src/lib/contacts.ts', 'src/lib/taskPreview.ts',
    'src/lib/vehicleConfirm.ts', 'src/lib/durations.ts', 'src/lib/channels.ts',
  ];
  const keys = new Set<string>();
  for (const file of files) for (const m of source(file).matchAll(/'((?:preview|call|vehicleConfirm|channel|dur|vehicleType|task|today|common)\.[A-Za-z.]+)'/g)) keys.add(m[1]);
  const optional = new Set(['vehicleConfirm.hasVehicle', 'vehicleConfirm.inactive', 'preview.backBy']); // used when the strings have them
  const missing = [...keys].filter((k) => !optional.has(k) && (typeof lookup(strings.en, k) !== 'string' || typeof lookup(strings.si, k) !== 'string'));
  check(missing.length === 0 && keys.has('preview.lastCopy') && keys.has('call.whatsapp'), `every key the new screens use is in en and si (${keys.size} keys)`, missing);
  const types = ['car', 'van', 'double_cab', 'lorry', 'other'];
  check(types.every((k) => typeof lookup(strings.en, `vehicleType.${k}`) === 'string' && typeof lookup(strings.si, `vehicleType.${k}`) === 'string'), 'vehicleType.* in both languages');
  const today = source('src/app/(tabs)/index.tsx');
  const layout = source('src/app/_layout.tsx');
  check(/pathname: '\/task\/\[id\]'/.test(today) && /onPress=\{openCard\}/.test(today), 'Today: the card opens the whole task (pushed: back returns to Today)');
  check(/if \(task\.status === 'assigned'\) return <TaskPreview task=\{task\} \/>/.test(source('src/app/task/[id].tsx')), 'a task still to start opens as the preview');
  check(/rememberPush\(data\);[\s\S]*router\.navigate\('\/'\);[\s\S]*router\.push\(\{ pathname: '\/task\/\[id\]'/.test(layout), 'a notification tap keeps the push\'s changes, puts Today underneath and opens the task');
  check(/useEffect\(\(\) => \(\) => markPreviewed\(latest\.current\)/.test(source('src/components/TaskPreview.tsx')), 'leaving the preview keeps the task as seen (its marks stay while it is open)');

  console.log(failures === 0 ? '\nAll Hotfix 2 driver tests passed.' : `\n${failures} Hotfix 2 driver test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** The queue in memory (as test-sync.ts), with the failed marks the phone's SQLite keeps. */
function memoryStore() {
  let seq = 0;
  const ops: (StoredOp & { failed?: string })[] = [];
  const store: QueueStore = {
    nextOps: (limit) => ops.filter((item) => item.failed === undefined).slice(0, limit),
    removeOp: (id) => void ops.splice(ops.findIndex((item) => item.seq === id), 1),
    updateOp: (id, op) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.op = op;
    },
    failOp: (id, error) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.failed = error;
    },
    nextPoints: () => [],
    removePoints: () => undefined,
    rejectPoints: () => undefined,
    nextHeartbeats: () => [],
    removeHeartbeats: () => undefined,
    rejectHeartbeats: () => undefined,
  };
  return {
    store,
    add: (...list: Op[]) => list.forEach((op) => ops.push({ seq: ++seq, op })),
    waiting: () => ops.filter((item) => item.failed === undefined).map((item) => item.op.kind),
    failed: () => ops.filter((item) => item.failed !== undefined).map((item) => ({ kind: item.op.kind, error: item.failed })),
  };
}

void main();
