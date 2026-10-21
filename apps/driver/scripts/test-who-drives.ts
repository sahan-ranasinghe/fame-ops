// Round 3 (docs/phase8-plan.md §30), the pure rules: "Who drives?" and the inputs it gives create_request, book_vehicle,
// create_task and update_request; Approve for a request with no driver asked; the driver-first card's vehicle chip; last
// seen said once; the Activity log's include_routine; the server's sentences said in Sinhala (the listed ones translated,
// an unknown one as it came, numbers in Latin digits); and every new key in both languages with the same placeholders.
//   npm run test:who-drives          (from apps/driver)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activityArgs, quietRow } from '../src/office/activityLogic';
import { approveProblem, decideCall, driverParts, firstPick, presenceLine, vehicleChip, vehicleChipText } from '../src/office/approveLogic';
import { rowLines } from '../src/office/driversLogic';
import { datesInWords } from '../src/lib/dateWords';
import { sentenceText, sentenceWords, taskChip, taskRowLine } from '../src/office/statusWords';
import { tripLine } from '../src/office/tripsLogic';
import { validateAssign } from '../src/office/trip/assignLogic';
import { newDraft, requestFieldsOf } from '../src/office/trip/draftLogic';
import { bookInput, editFields, type RequestFields, updateRequestInput, validateNewRequest } from '../src/office/trip/requestLogic';
import { newStop } from '../src/office/trip/stopsLogic';
import {
  askedWords, asksNoDriver, defaultWho, drivenByKey, isPlate, WHO_NEED_NAME, WHO_NEED_PHONE, WHO_NEED_PLATE, whoChanges, whoChoices, whoFromFields, whoInput, whoOf, whoProblem,
} from '../src/office/trip/whoDrivesLogic';
import { reasonText } from '../src/office/trip/words';
import type { AvailableDriver, RequestCard } from '../src/office/types';

const here = dirname(fileURLToPath(import.meta.url));
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const check = (ok: unknown, name: string, got?: unknown) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === undefined ? '' : `   ${JSON.stringify(got)}`}`);
  if (!ok) failures++;
};

console.log('Who drives? (office/trip/whoDrivesLogic.ts)');
{
  check(same(whoOf(undefined), defaultWho()) && whoOf({ driverRequired: false }).choice === 'custodian' && whoOf({ driverRequired: true }).choice === 'driver', 'a draft from before Round 3: the switch read (off = the custodian drives)');
  check(whoOf({ who: { choice: 'self', name: '', phone: '' }, driverRequired: false }).choice === 'self', 'the choice wins over the old switch');
  check(same(whoChoices(true), ['driver', 'self', 'other']) && same(whoChoices(false), ['driver']), 'three choices while self_drive_allowed is on; a driver only when off');
  check(same(whoInput(defaultWho()), {}), 'a driver: nothing sent (the default)');
  check(same(whoInput({ choice: 'self', name: 'x', phone: 'y' }), { driven_by: 'self' }), 'I\'ll drive myself: driven_by self, no name or phone');
  check(same(whoInput({ choice: 'other', name: ' Other Person ', phone: ' 077 123 4567 ' }), { driven_by: 'other', driver_name: 'Other Person', driver_phone: '077 123 4567' }), 'someone else: driven_by other with the name and the phone, trimmed');
  check(same(whoInput({ choice: 'custodian', name: '', phone: '' }), { driver_required: false }), 'the custodian (an older request): driver_required false');
  check(whoProblem({ choice: 'other', name: '', phone: '0771234567' }) === WHO_NEED_NAME && whoProblem({ choice: 'other', name: 'A', phone: '123' }) === WHO_NEED_PHONE && whoProblem({ choice: 'other', name: 'A', phone: '077 123 4567' }) === null, 'someone else: a name, and a Sri Lankan phone');
  check(whoProblem({ choice: 'self', name: '', phone: '' }, { needsPlate: true, plate: '' }) === WHO_NEED_PLATE && whoProblem({ choice: 'self', name: '', phone: '' }, { needsPlate: true, plate: 'on the day' }) === WHO_NEED_PLATE && whoProblem({ choice: 'self', name: '', phone: '' }, { needsPlate: true, plate: 'any van' }) === WHO_NEED_PLATE, 'no app: a plate, never "on the day" or "any van"');
  check(whoProblem({ choice: 'self', name: '', phone: '' }, { needsPlate: true, plate: 'WP CAB-4521' }) === null && whoProblem({ choice: 'self', name: '', phone: '' }) === null && whoProblem(defaultWho(), { needsPlate: true, plate: '' }) === null, 'a plate given; a request without Book now needs none; a driver needs none');
  check(isPlate('WP CAB-4521') && !isPlate('on the day') && !isPlate('any double cab') && !isPlate(' '), 'a plate is a specific vehicle');
  check(same(whoChanges(defaultWho(), defaultWho()), {}) && same(whoChanges({ choice: 'self', name: '', phone: '' }, defaultWho()), { driven_by: 'self' }) && same(whoChanges(defaultWho(), { choice: 'self', name: '', phone: '' }), { driven_by: 'driver' }), 'update_request: only a change (a driver again is driven_by driver)');
  check(same(whoChanges({ choice: 'other', name: 'B', phone: '0771234567' }, { choice: 'other', name: 'A', phone: '0771234567' }), { driven_by: 'other', driver_name: 'B', driver_phone: '0771234567' }) && same(whoChanges({ choice: 'other', name: 'A', phone: '0771234567' }, { choice: 'other', name: 'A ', phone: '0771234567' }), {}), 'someone else renamed: sent; the same (spaces aside): not');
  check(same(whoFromFields({ driven_by: 'other', driver_name: 'A', driver_phone: '+94771234567' }), { choice: 'other', name: 'A', phone: '+94771234567' }) && whoFromFields({ driver_required: false }).choice === 'custodian' && whoFromFields({}).choice === 'driver' && same(whoFromFields({ driven_by: 'self', driver_name: 'x' }), { choice: 'self', name: '', phone: '' }), 'the edit form reads driven_by (an older card: driver_required)');
  check(drivenByKey('self') === 'office.who.drivesThemselves' && drivenByKey('other') === 'office.who.someoneElse' && drivenByKey(undefined) === null, 'the small word under the name');
  const q = (o: Partial<RequestCard>) => ({ requested_by: 'Asker', ...o }) as RequestCard;
  check(same(askedWords(q({ driven_by: 'self' })), { key: 'office.who.askedSelf', vars: { name: 'Asker' } }) && same(askedWords(q({ driven_by: 'other', driver_name: 'B', driver_phone: '+94771234567' })), { key: 'office.who.askedOtherPhone', vars: { name: 'B', phone: '077 123 4567' } }) && askedWords(q({ driver_required: false }))?.key === 'office.who.askedCustodian' && askedWords(q({})) === null, 'Approve says what was asked (the phone as people write it)');
  check(asksNoDriver({ driven_by: 'self' }) && asksNoDriver({ driven_by: 'other' }) && asksNoDriver({ driven_by: 'custodian' }) && asksNoDriver({ driver_required: false }) && !asksNoDriver({ driver_required: true }), 'no driver asked: self, someone else, the custodian');
}

console.log('\nThe forms\' inputs (requestLogic, assignLogic, the draft)');
{
  const trip = { date: '2026-10-22', leaveBy: '08:00', stops: [{ ...newStop('drop'), place: 'Kandy' }], returnToBase: false, avoidExpressway: false, end: '', start: '', startPax: false };
  const rf: RequestFields = { ...trip, behalf: '', project: '', need: '', pax: '', tools: false, note: '', driver: true, requesterPhone: '' };
  const self = { choice: 'self' as const, name: '', phone: '' };
  const other = { choice: 'other' as const, name: 'Other Person', phone: '077 123 4567' };
  const r1 = validateNewRequest({ ...rf, who: self, driver: false });
  check('input' in r1 && r1.input.driven_by === 'self' && !('driver_required' in r1.input), 'create_request: I\'ll drive myself (driven_by self, never the old driver_required false)', r1);
  const r2 = validateNewRequest({ ...rf, who: { ...other, phone: '12' }, driver: false });
  check('error' in r2 && r2.error === WHO_NEED_PHONE, 'create_request: someone else needs a Sri Lankan phone', r2);
  const r3 = validateNewRequest({ ...rf, who: other, driver: false });
  check('input' in r3 && r3.input.driver_name === 'Other Person' && r3.input.driver_phone === '077 123 4567' && r3.input.driven_by === 'other', 'create_request: someone else with the name and the phone');
  const r4 = validateNewRequest({ ...rf, driver: false });
  check('input' in r4 && r4.input.driver_required === false && !('driven_by' in r4.input), 'an older draft (the switch off): the custodian path as before');
  const b1 = bookInput({ ...rf, who: self, driver: false }, { vehicle: '', driver: '', hasCustodian: false, defaultVehicle: null });
  check('error' in b1 && b1.error === WHO_NEED_PLATE, 'Book now, I\'ll drive myself: the plate first', b1);
  const b2 = bookInput({ ...rf, who: self, driver: false }, { vehicle: 'WP CAB-4521', driver: 'kamal', hasCustodian: false, defaultVehicle: null });
  check('input' in b2 && b2.input.vehicle === 'WP CAB-4521' && b2.input.driven_by === 'self' && !('driver' in b2.input) && b2.input.title === 'Trip · Kandy', 'Book now, I\'ll drive myself: the plate, no driver (a leftover pick is never sent)', b2);
  const b3 = bookInput({ ...rf, who: other, driver: false }, { vehicle: 'on the day', driver: '', hasCustodian: false });
  check('error' in b3 && b3.error === WHO_NEED_PLATE, 'Book now, someone else: "on the day" is not a plate');
  const b4 = bookInput({ ...rf, who: defaultWho() }, { vehicle: '', driver: '', hasCustodian: true, defaultVehicle: null });
  check('error' in b4 && b4.error === 'Pick a driver.', 'Book now with a driver: a driver first (no "untick A driver is needed" any more)');
  const was = editFields({ fields: { date: '2026-10-22', time: '08:00', driver_required: false, driven_by: 'custodian' } });
  check(was.who?.choice === 'custodian' && was.driver === false, 'the edit form: the custodian as asked');
  const u1 = updateRequestInput('r1', 3, { ...was, who: self }, was);
  check('input' in u1 && u1.input.driven_by === 'self' && u1.input.version === 3, 'update_request: the change of who drives, with the version', u1);
  const u2 = updateRequestInput('r1', 3, was, was);
  check('error' in u2, 'update_request: nothing changed is refused before sending');
  const u3 = updateRequestInput('r1', 3, { ...was, who: { ...other, name: '' } }, was);
  check('error' in u3 && u3.error === WHO_NEED_NAME, 'update_request: someone else without a name is refused before sending');
  const d = { ...newDraft('request', '2026-10-22'), req: { behalf: '', project: '', need: '', tools: false, note: '', driverRequired: false, requesterPhone: '', who: other } };
  const fromDraft = requestFieldsOf(d);
  check(fromDraft.who?.choice === 'other' && fromDraft.driver === false, 'the draft hands its choice to the request\'s fields');
  const task = { ...newDraft('task', '2026-10-22').fields, ...trip, title: 'Site visit', driver: '', vehicle: '' };
  const a1 = validateAssign(task, [], 'Me', { who: self });
  check('error' in a1 && a1.error === WHO_NEED_PLATE, 'Assign a task, I\'ll drive myself: the plate first', a1);
  const a2 = validateAssign({ ...task, vehicle: 'WP CAB-4521' }, [], 'Me', { who: self });
  check('input' in a2 && a2.input.driven_by === 'self' && a2.input.vehicle === 'WP CAB-4521' && !('driver' in a2.input) && a2.input.title === 'Site visit', 'create_task, I\'ll drive myself: no driver, the plate', a2);
  const a3 = validateAssign({ ...task, vehicle: 'WP CAB-4521' }, [], 'Me', { who: other });
  check('input' in a3 && a3.input.driven_by === 'other' && a3.input.driver_name === 'Other Person' && !('driver' in a3.input), 'create_task, someone else: their name and phone, no driver');
  const a4 = validateAssign({ ...task, title: '', vehicle: 'WP CAB-4521' }, [], 'Me', { who: self });
  check('error' in a4 && /the task/.test(a4.error), 'create_task, I\'ll drive myself: the title is still needed');
  const a5 = validateAssign({ ...task, driver: 'kamal', vehicle: 'WP CAB-4521' }, [], 'Me', { who: defaultWho() });
  check('input' in a5 && a5.input.driver === 'kamal' && !('driven_by' in a5.input), 'create_task with a driver: as before (no driven_by)');
}

console.log('\nApprove with no driver asked (approveLogic.ts)');
{
  const avail = { best: { name: 'Kamal', username: 'kamal', why: '' }, drivers: [] };
  check(firstPick({ driven_by: 'self' }, avail) === '' && firstPick({ driven_by: 'other' }, avail) === '' && firstPick({ driver_required: false }, avail) === '' && firstPick({}, avail) === 'kamal', 'no driver picked first when none was asked (the best match otherwise)');
  check(approveProblem({ driven_by: 'self' }, { asAsked: true, driver: '', vehicle: '' }) === 'office.who.pickVehicle', 'as asked with no vehicle: "Pick the vehicle." (never sent with neither)');
  check(approveProblem({ driven_by: 'self' }, { asAsked: true, driver: '', vehicle: 'WP A-1' }) === null && approveProblem({ driven_by: 'other', kind: 'task', proposed: { vehicle: 'WP A-1' } }, { asAsked: true, driver: '', vehicle: '' }) === null, 'a vehicle picked, or a proposal\'s own');
  check(approveProblem({ driven_by: 'self', status: 'changed' }, { asAsked: true, driver: '', vehicle: '' }) === null, 'a changed booking kept as asked keeps its vehicle');
  check(approveProblem({ driven_by: 'self' }, { asAsked: false, driver: '', vehicle: '' }) === 'office.trip.needDriver' && approveProblem({}, { asAsked: false, driver: 'kamal', vehicle: '' }) === null, 'a driver given instead: a driver is needed');
  const call = decideCall({ id: 'r1', status: 'waiting', version: 2 }, 'approve', { vehicle: 'WP A-1' });
  check(same(call, { tool: 'decide_request', input: { request_id: 'r1', decision: 'approve', version: 2, vehicle: 'WP A-1' } }), 'decide_request with the vehicle alone');
}

console.log('\nThe driver-first card: the vehicle chip, the lines, last seen once');
{
  check(same(vehicleChip({ vehicle: { reg_no: 'WP A-1', source: 'on_duty' } }, true), { kind: 'plate', plate: 'WP A-1', regular: false }) && same(vehicleChip({ vehicle: { reg_no: 'WP A-1', source: 'regular' } }, false), { kind: 'plate', plate: 'WP A-1', regular: true }), 'the plate held today; the regular one marked regular');
  check(same(vehicleChip({}, true), { kind: 'on_the_day' }) && same(vehicleChip({ vehicle: null }, false), { kind: 'none' }), 'none known: on the day (the setting on), else no vehicle yet');
  check(vehicleChipText({ kind: 'plate', plate: 'X', regular: true }, en) === 'regular' && vehicleChipText({ kind: 'plate', plate: 'X', regular: false }, en) === '' && vehicleChipText({ kind: 'on_the_day' }, en) === 'Vehicle: on the day' && vehicleChipText({ kind: 'none' }, en) === 'No vehicle yet', 'the chip\'s words (English)');
  check(!/[A-Za-z]/.test(vehicleChipText({ kind: 'none' }, si) + vehicleChipText({ kind: 'on_the_day' }, si) + vehicleChipText({ kind: 'plate', plate: 'X', regular: true }, si)), 'the chip\'s words in Sinhala');
  const d: AvailableDriver = { name: 'Kamal', username: 'kamal', state: 'on_duty', status_text: 'On duty since 07:12', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true, vehicle_note: 'no vehicle yet · regular: WP KV-7788', last_seen: 'Last seen 17:42 near Kadawatha', usual_start: '07:40' };
  check(same(driverParts(d, en), ['On duty since 07:12']) && !driverParts(d, si).join(' ').includes('vehicle'), 'the state line, never the server\'s English vehicle_note');
  check(presenceLine(d, en) === 'Last seen 17:42 near Kadawatha · usually starts 07:40' && !/Last seen Last seen/.test(presenceLine(d, en)), 'last seen said once (no "Last seen Last seen")');
  check(!/Last seen/.test(presenceLine(d, si)) && presenceLine(d, si).includes('17:42') && presenceLine(d, si).includes('Kadawatha'), 'last seen in Sinhala, the time in Latin digits, the town as it is');
  check(driverParts({ ...d, match_why: 'On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today' }, si)[0] === sentenceText(si, 'On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today'), 'the best match\'s reason said in the person\'s language');
  const board = { status: { kind: 'not_available' as const, text: 'Not available, back 13:00' }, last_seen: 'Last seen 09:10 near Kadawatha', vehicle: { reg_no: 'WP A-1', source: 'regular' as const } };
  const lines = rowLines(board, si);
  check(!/Not available|Last seen|regular/.test(lines.join(' ')) && lines[0].includes('13:00'), 'the Drivers tab\'s lines in Sinhala; the regular vehicle is the chip, not a line', lines);
}

console.log('\nWho drives on the rows (statusWords taskChip / taskRowLine, tripsLogic tripLine)');
{
  check(taskChip('assigned', { driven_by: 'self', status: 'Drives themselves · no app' }).key === 'selfDrive' && taskChip('assigned', { driven_by: 'other' }).key === 'someoneElse', 'the chip from driven_by (Self-drive, Someone else)');
  check(taskChip('assigned', { status: 'Driven by Nimal (custodian · no app)' }).key === 'sent', 'never read from the old sentence any more');
  check(taskChip('in_progress', { driven_by: 'self' }).key === 'underWay', 'under way stays under way');
  check(taskRowLine(en, { driver: 'Nimali', driven_by: 'self', status: 'Drives themselves · no app' }) === 'Nimali · Drives themselves · no app', 'the row: the name, then the no-app line (once)');
  check(taskRowLine(en, { driver: 'Other Person', driven_by: 'other', status: 'Done 11:40 · 42 km logged' }) === 'Other Person · Someone else · Done 11:40 · 42 km logged', 'a later line: the small word after the name');
  check(taskRowLine(en, { driver: 'Kamal', status: 'Seen by driver 16:06' }) === 'Kamal · Seen by driver 16:06', 'a driver: as before');
  const trip = { id: 'r', requested_by: 'A', when: 'Thu 22 Oct 08:00', status: 'approved', assigned: { driver: 'Other Person', driven_by: 'other', vehicle: 'WP A-1' } } as RequestCard;
  check(tripLine(trip, 'back by', { self: 'Drives themselves', other: 'Someone else' }) === 'Thu 22 Oct 08:00 · Other Person · Someone else · WP A-1', 'My trips: who drives after the name');
}

console.log('\nThe Activity log (activityLogic.ts)');
{
  check(!('include_routine' in activityArgs({ from: '2026-10-15', to: '2026-10-21' })) && !('include_routine' in activityArgs({ from: 'a', to: 'b', routine: false })), 'off by default: include_routine not sent');
  check(activityArgs({ from: 'a', to: 'b', routine: true }).include_routine === true, 'the switch on: include_routine true');
  check(same(activityArgs({ from: 'a', to: 'b', person: ' kamal ', routine: true, cursor: 'c2' }), { from: 'a', to: 'b', limit: 50, person: 'kamal', include_routine: true, cursor: 'c2' }), 'with the person, the page, 50 at a time');
  check(quietRow({ routine: true, outcome: 'done' }) && !quietRow({ routine: true, outcome: 'refused' }) && !quietRow({ outcome: 'done' }), 'a routine row is quieter, unless refused or failed');
}

console.log('\nThe server\'s sentences on a Sinhala screen');
{
  // [the server's sentence, what must stay in Latin digits / as data in the Sinhala]
  const sentences: [string, string[]][] = [
    ['Drives themselves · no app', []],
    ['Someone else drives · no app', []],
    ['Missed · not started (leave by 08:30)', ['08:30']],
    ['WP CAB-4521 is booked 08:00–11:00 at the same time (Team drop).', ['WP CAB-4521', '08:00–11:00', 'Team drop']],
    ['WP CAB-4521 is booked from 14:00 the same day (Airport run).', ['WP CAB-4521', '14:00', 'Airport run']],
    ['Kamal Perera has another task 08:00–11:00 at the same time (Team drop).', ['Kamal Perera', '08:00–11:00', 'Team drop']],
    ['Kamal Perera has another task from 15:00 the same day (Bank).', ['Kamal Perera', '15:00', 'Bank']],
    ['WP CAB-4521 is marked as in the garage.', ['WP CAB-4521']],
    ['WP CAB-4521 is over its monthly km allowance (3,120 of 3,000 km).', ['WP CAB-4521', '3,120', '3,000']],
    // Round 3 A4: the date in words ("Thu 1 Oct"), never "2026-10-01", in both languages.
    ['WP CAB-4521: revenue licence expired on 2026-10-01.', ['WP CAB-4521', '1']],
    ['WP CAB-4521: insurance expired on 2026-10-01.', ['WP CAB-4521', '1']],
    ['WP CAB-4521: emission test expired on 2026-10-01.', ['WP CAB-4521', '1']],
    ["Kamal Perera's driving licence expired on 2026-09-30.", ['Kamal Perera', '30']],
    ['Nimali Fernando has no driving licence on file (self-drive).', ['Nimali Fernando']],
    ['Expired · nobody decided it in time', []],
    ['Kamal is not available then · half day, back 13:00', ['Kamal', '13:00']],
    ['Kamal is not available that day · leave until Thu 22 Oct', ['Kamal', '22']],
    ['Kamal is not available then · personal, from 13:00', ['Kamal', '13:00']],
    ['Kamal is not available that day · other, 09:30–11:00', ['Kamal', '09:30', '11:00']],
    ['Kamal is not available then · leave, all day', ['Kamal']],
    ['WP CAB-4521 is a car, not a van.', ['WP CAB-4521']],
    ['WP CAB-4521 has 4 seats for 6 passengers.', ['WP CAB-4521', '4', '6']],
    ['The leave-by time is already in the past.', []],
    ['The time is already in the past.', []],
    ['The leave-by time is already past.', []],
    ['No base place set — add it in Settings', []],
    ['Head office: no map pin, so its leg counts as 0 minutes. Save the place with a pin, or type a town name.', ['Head office', '0']],
    ['Leaving now, the earliest arrival at Stop 2 is 04:30 UTC; the deadline cannot be met with the buffer.', ['2', '04:30']],
    ['A long day: 10 h 30 min from leaving to the end.', ['10', '30']],
    ['WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)', ['WP CAB-4521', 'Team drop', 'Dilini', 'Kamal']],
    ['Kamal is on task Bank run from 09:00', ['Kamal', 'Bank run', '09:00']],
    ['WP CAB-4521 is in the garage', ['WP CAB-4521']],
    ['WP CAB-4521 is booked 08:00–11:00 at the same time (Team drop). (saved by Palitha)', ['WP CAB-4521', 'Team drop', 'Palitha']],
    ['Not available, back 13:00', ['13:00']],
    ['Not available today', []],
    ['Not available until Thu 22 Oct', ['22']],
    ['Not available until Thu 22 Oct 13:00', ['13:00']],
    ['Not available · half day, back 13:00', ['13:00']],
    ['Running late 15 min · said 09:12', ['15', '09:12']],
    ['Running late 15 min · said Thu 22 Oct', ['15', '22']],
    ['Last seen 17:42 near Kadawatha', ['17:42', 'Kadawatha']],
    ['Last seen Fri 16 Oct 17:42', ['17:42']],
    ['On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today', ['08:00', '3.2']],
    ['On duty · free 09:00–end of day · 0.4 km from the first stop · 3 tasks today', ['09:00', '0.4', '3']],
    ['On duty · free 09:00–17:00 · 0 tasks today', ['09:00', '17:00']],
  ];
  const strip = (text: string, keep: string[]) => keep.reduce((s, k) => s.split(k).join(''), text).replace(/\b(km|UTC)\b/g, '').replace(/Fame Fleet/g, '');
  for (const [server, keep] of sentences) {
    const words = sentenceWords(server);
    const e = sentenceText(en, server);
    const s = sentenceText(si, server);
    check(words !== null, `known: "${server}"`);
    check(e === datesInWords(en, server), `English as the server says it (a date in words): "${server}"`, e);
    check(!/\d{4}-\d{2}-\d{2}/.test(e) && !/\d{4}-\d{2}-\d{2}/.test(s), `no raw date on screen: "${server}"`);
    check(s !== server && !/[A-Za-z]{2,}/.test(strip(s, keep)) && keep.every((k) => s.includes(k)), `Sinhala, the values as they are: "${server}"`, s);
    check(!/[෦-෯]/.test(s), `Latin digits: "${server}"`);
  }
  check(sentenceText(en, 'Same as the start: Stop 1 (Head office) is a pickup where the trip starts. Tick "Passengers get in here" instead (start.passengers: true).') === 'Same as the start: Stop 1 (Head office) is a pickup where the trip starts. Tick "Passengers get in here" instead.', 'the start note without its code name (start.passengers)');
  for (const unknown of ['The vehicle is in the garage', 'Something new from the server.', 'Kamal is not available then · a new kind of reason', 'On duty · free 08:00–12:00 · something else', 'WP CAB-4521 is booked tomorrow (x).']) {
    check(sentenceText(si, unknown) === unknown, `unknown: as the server said it: "${unknown}"`);
  }
  check(reasonText(en, WHO_NEED_PLATE) === en('office.who.needPlate') && reasonText(si, WHO_NEED_NAME) === si('office.who.needName') && reasonText(si, WHO_NEED_PHONE) === si('office.who.needPhone'), 'the Who reasons in the person\'s language');
  check(reasonText(si, 'The leave-by time is already in the past.') === si('office.warn.leavePast') && reasonText(si, 'Pick a driver.') === si('office.trip.needDriver'), 'the plan\'s reasons fall back to the server\'s sentences');
}

console.log('\nEvery new key in both languages');
{
  const sections = ['office.who', 'office.warn', 'office.away', 'office.why', 'office.when'];
  const extra = ['office.line.noAppSelf', 'office.line.noAppOther', 'office.line.missed', 'office.line.notAvailableBack', 'office.line.notAvailableToday', 'office.line.notAvailableUntil', 'office.line.notAvailable', 'office.line.runningLate', 'office.line.lastSeen', 'office.line.lastSeenNear', 'office.chip.someoneElse', 'office.saved.taskNoApp', 'office.activity.showRoutine', 'office.activity.showRoutineHint'];
  const keys = [...sections.flatMap((s) => Object.keys(lookup('en', s) as Record<string, string>).map((k) => `${s}.${k}`)), ...extra];
  const ph = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const missing = keys.filter((k) => typeof lookup('si', k) !== 'string' || typeof lookup('en', k) !== 'string');
  check(keys.length > 90 && missing.length === 0, `every key in en and si (${keys.length})`, missing);
  const drift = keys.filter((k) => ph(lookup('en', k) as string) !== ph((lookup('si', k) as string) ?? ''));
  check(drift.length === 0, 'the same {placeholders} in both languages', drift);
  check(!keys.some((k) => /[෦-෯]/.test(lookup('si', k) as string)), 'Latin digits in Sinhala');
  check(keys.filter((k) => !/^office\.(when|away\.hours)/.test(k)).every((k) => lookup('si', k) !== lookup('en', k)), 'every text said in Sinhala (only the pure-placeholder ones are the same)');
  check(lookup('en', 'office.trip.driverNeeded') === undefined && lookup('si', 'office.trip.driverNeeded') === undefined && lookup('en', 'office.trip.lastSeen') === undefined, 'the old switch\'s words and the doubled "Last seen {when}" are gone');
}

console.log(failures === 0 ? '\nAll who-drives checks passed.' : `\n${failures} who-drives check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
