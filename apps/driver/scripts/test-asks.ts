// Tests of Part 3b in the driver app (G, H1, H3, H4; docs/phase7-plan.md "Part 3b"): the office's questions (the words,
// the answers each takes, the banner, the time choices and a typed time, the queue's op and which replies are final), the
// "driver-asks" channel, the availability lines and the form's rules, the phone prompt's rule, the profile's patch of
// changed fields, Running late and Can't make it, the screens' navigation (read as text) and the strings in English
// and Sinhala. Pure code, no stack needed:
//
//   npm run test:asks          (from apps/driver)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  answerComplete,
  answersFor,
  answerWords,
  askAnswerOp,
  type AskRow,
  bannerAsk,
  isOpen,
  mergeAsk,
  needsAnswer,
  parseAskRow,
  questionKey,
  replyDone,
  timeChoices,
  tripWhen,
  typedTime,
  withAnswer,
} from '../src/lib/asks';
import {
  addedByOther,
  availArgs,
  availDirty,
  availLine,
  dayChoices,
  formFromRow,
  lastDayChoices,
  newAvailForm,
  parseAvailAnswer,
  partKey,
  reasonKey,
  type UnavailabilityRow,
  upcomingEntries,
  validTime,
} from '../src/lib/availability';
import { ASKS_CHANNEL, ASKS_SOUND, ASKS_VIBRATION, asksChannel, channelsToRegister, NEW_TASKS_VIBRATION } from '../src/lib/channels';
import { canReportLate, declineKey, LATE_CHOICES, lateLine, lateMinutes } from '../src/lib/late';
import {
  licencePhotoId,
  licencePhotoPath,
  monthTotals,
  needsPhonePrompt,
  phoneE164,
  phoneLocal,
  profileDirty,
  profileForm,
  profilePatch,
  validDate,
} from '../src/lib/profile';
import { colomboParts } from '../src/lib/time';

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
type T = (key: string, vars?: Record<string, string | number>) => string;
const tr = (language: 'en' | 'si'): T => (key, vars) => {
  const found = lookup(strings[language], key) ?? lookup(strings.en, key);
  let text = typeof found === 'string' ? found : key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const en = tr('en');
const si = tr('si');
/** "Tue 20 Oct" as components/task.tsx useDateLabel makes it. */
const dayLabel = (language: 'en' | 'si') => (at: Date | string) => {
  const { weekday, day, month } = colomboParts(at);
  return `${(lookup(strings[language], 'days') as string[])[weekday]} ${day} ${(lookup(strings[language], 'months') as string[])[month]}`;
};
const enDay = dayLabel('en');

const at = (local: string) => Date.parse(`${local}+05:30`);
const iso = (local: string) => new Date(at(local)).toISOString();
/** Monday 19 October 2026, 08:52 in Colombo. */
const NOW = at('2026-10-19T08:52:00');

// --- 1. H3: the office's questions -----------------------------------------------------------------------------------
console.log('Questions from the office (H3):');
const raw = {
  ask_id: 'a1', sent_at: iso('2026-10-19T08:40:00'), seen_at: null, answer: null, answer_at: null, answered_at: null,
  driver_asks: { kind: 'free_for_trip', trip_from: iso('2026-10-20T09:00:00'), trip_to: iso('2026-10-20T12:00:00'), note: 'Kandy team',
    asked_by_name: 'Palitha Perera', created_at: iso('2026-10-19T08:40:00'), expires_at: iso('2026-10-20T09:00:00') },
};
const trip = parseAskRow(raw) as AskRow;
check(trip !== null && trip.kind === 'free_for_trip' && trip.asked_by_name === 'Palitha Perera' && trip.note === 'Kandy team' && trip.answer === null,
  'the joined row (driver_ask_answers with its ask) is read', trip);
check(parseAskRow({ ...raw, driver_asks: [raw.driver_asks] })?.ask_id === 'a1', 'the ask as a one-row array is read too');
check(parseAskRow({ ...raw, driver_asks: { ...raw.driver_asks, kind: 'chat' } }) === null && parseAskRow(null) === null && parseAskRow({ ask_id: 'x' }) === null,
  'a kind the phone does not know, or no ask: left out');
check(parseAskRow({ ...raw, answer: 'maybe' })?.answer === null, 'an answer the phone does not know reads as none');
check(questionKey('free_for_trip') === 'ask.freeForTrip' && questionKey('office_time') === 'ask.officeTime' && questionKey('where_now') === 'ask.whereNow',
  'each kind has its question');
check(same(answersFor('free_for_trip'), ['yes', 'no', 'call_me']) && same(answersFor('office_time'), ['time', 'call_me']) && same(answersFor('where_now'), ['location', 'call_me']),
  'trip → Yes / No / Call me; office time → a time or Call me; where now → the location or Call me (as answer_ask takes them)');
check(tripWhen(enDay, trip) === 'Tue 20 Oct · 09:00–12:00', 'the trip asked about: "Tue 20 Oct · 09:00–12:00"', tripWhen(enDay, trip));
check(tripWhen(enDay, { ...trip, trip_to: null }) === 'Tue 20 Oct · 09:00' && tripWhen(enDay, { ...trip, kind: 'office_time' }) === null,
  'no end time: the start only; the other questions have no trip line');
check(tripWhen(dayLabel('si'), trip)?.endsWith('09:00–12:00') === true && /\d/.test(tripWhen(dayLabel('si'), trip) ?? ''), 'Sinhala: the day in Sinhala, the times in Latin digits');

const office: AskRow = { ...trip, ask_id: 'a2', kind: 'office_time', trip_from: null, trip_to: null, expires_at: iso('2026-10-19T10:40:00') };
const where: AskRow = { ...trip, ask_id: 'a3', kind: 'where_now', trip_from: null, trip_to: null, expires_at: iso('2026-10-19T10:30:00') };
const closed: AskRow = { ...trip, ask_id: 'a4', expires_at: iso('2026-10-19T08:00:00') };
check(isOpen(office, NOW) && !isOpen(closed, NOW), 'open until it expires');
check(bannerAsk([trip, office, where, closed], NOW)?.ask_id === 'a3', "Today's banner: the open one not answered that closes soonest");
check(bannerAsk([{ ...where, answered_at: iso('2026-10-19T08:50:00'), answer: 'location' }, closed], NOW) === null && !needsAnswer(closed, NOW),
  'answered or closed: no banner');

check(answerWords(en, { answer: 'yes', answer_at: null }) === 'Yes' && answerWords(en, { answer: 'call_me', answer_at: null }) === 'Call me'
  && answerWords(en, { answer: 'location', answer_at: null }) === 'Location shared' && answerWords(en, { answer: null, answer_at: null }) === null,
  'the answer in words');
check(answerWords(en, { answer: 'time', answer_at: iso('2026-10-19T09:15:00') }, enDay, NOW) === 'At the office at 09:15', 'a time today: "At the office at 09:15"');
check(answerWords(en, { answer: 'time', answer_at: iso('2026-10-20T07:30:00') }, enDay, NOW) === 'At the office at Tue 20 Oct 07:30', 'a time tomorrow names the day');
check(answerWords(si, { answer: 'time', answer_at: iso('2026-10-19T09:15:00') }, dayLabel('si'), NOW)?.includes('09:15') === true, 'Sinhala keeps the time in Latin digits');

const choices = timeChoices(NOW);
check(choices.length === 8 && same(choices.map((c) => c.label), ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45']),
  'the time buttons: the next 8 quarter hours after now (08:52 → 09:00 … 10:45)', choices.map((c) => c.label));
check(timeChoices(at('2026-10-19T09:00:00'))[0].label === '09:15' && choices[0].at === iso('2026-10-19T09:00:00'), 'exactly on a quarter hour: the next one; each is an instant');
check(typedTime('14:30', NOW) === iso('2026-10-19T14:30:00') && typedTime('9.15', NOW) === iso('2026-10-19T09:15:00') && typedTime('0930', NOW) === iso('2026-10-19T09:30:00'),
  'a typed time later today: today');
check(typedTime('07:30', at('2026-10-19T20:00:00')) === iso('2026-10-20T07:30:00'), 'a typed time that has passed: tomorrow (asked in the evening, 07:30 is tomorrow morning)');
check(typedTime('25:00', NOW) === null && typedTime('9:7', NOW) === null && typedTime('abc', NOW) === null && typedTime('', NOW) === null, 'not a time: none');

const op = askAnswerOp('a2', 'c1', { answer: 'time', answer_at: iso('2026-10-19T09:15:00'), lat: 7, lng: 80 }, iso('2026-10-19T08:53:00'));
check(op.kind === 'ask_answer' && op.id === 'a2' && op.client_id === 'c1' && op.answer_at === iso('2026-10-19T09:15:00') && op.lat === null && op.at === iso('2026-10-19T08:53:00'),
  "the queue's op: the ask, the time picked, the phone's time; nothing a time answer does not carry", op);
const loc = askAnswerOp('a3', 'c2', { answer: 'location', lat: 6.93, lng: 79.86, accuracy_m: 9, answer_at: 'x' }, iso('2026-10-19T08:54:00'));
check(loc.lat === 6.93 && loc.lng === 79.86 && loc.accuracy_m === 9 && loc.answer_at === null, 'a location answer carries the one point (and no time)', loc);
check(answerComplete('office_time', { answer: 'time', answer_at: 'x' }) && !answerComplete('office_time', { answer: 'time' })
  && !answerComplete('where_now', { answer: 'location', lat: 1 }) && !answerComplete('free_for_trip', { answer: 'time', answer_at: 'x' })
  && answerComplete('where_now', { answer: 'call_me' }), 'an answer is sent only when it has what its question needs');
check(replyDone('ok') && replyDone('expired') && !replyDone('bad') && !replyDone('not_yours'), "'ok' and 'expired' are done; 'bad' and 'not_yours' are refusals (kept failed, never retried)");
const answered = withAnswer([trip, office], 'a2', { answer: 'time', answer_at: iso('2026-10-19T09:15:00') }, iso('2026-10-19T08:53:00'));
check(answered[1].answer === 'time' && answered[1].answered_at === iso('2026-10-19T08:53:00') && answered[1].answer_at === iso('2026-10-19T09:15:00')
  && answered[1].seen_at === iso('2026-10-19T08:53:00'), "the phone's copy takes the answer at once (offline too), and counts as seen", answered[1]);
check(bannerAsk(answered, NOW)?.ask_id === 'a1' && answered[0] === trip, 'the banner goes for the question answered; the others stay as they were');
const merged = mergeAsk([trip, office], { ...office, seen_at: 'now' });
check(merged.length === 2 && merged.find((a) => a.ask_id === 'a2')?.seen_at === 'now', "a question read again replaces the phone's copy");

// --- 2. The "driver-asks" channel -------------------------------------------------------------------------------------
console.log('\nThe "driver-asks" channel (H3):');
const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
const plugin = appJson.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as [string, { sounds?: string[] }] | undefined;
const bundled = (plugin?.[1].sounds ?? []).map((path) => path.split('/').pop());
const spec = asksChannel(en);
check(spec.id === 'driver-asks' && ASKS_CHANNEL === 'driver-asks' && spec.importance === 'max' && spec.lockscreen === 'public', 'its own channel id (push-task sends asks on it), maximum importance');
check(ASKS_SOUND === 'general.wav' && bundled.includes(ASKS_SOUND) && existsSync(join(here, '..', 'assets', 'sounds', ASKS_SOUND)), 'the sound is general.wav, in the 1.2.0 build (no native change)', bundled);
const pulses = ASKS_VIBRATION.filter((_, i) => i % 2 === 1);
check(pulses.length === 4 && pulses.every((ms) => ms < 400) && !same(ASKS_VIBRATION, NEW_TASKS_VIBRATION), 'its own vibration: four short pulses (a new task has three long ones)', ASKS_VIBRATION);
check(spec.name === 'Questions from the office' && asksChannel(si).name !== spec.name && asksChannel(si).description !== '', "the name and description in the driver's language");
check(same(channelsToRegister({ newTasks: true, asks: true }), ['new-tasks', 'driver-asks']) && same(channelsToRegister({ newTasks: true, asks: false }), ['new-tasks'])
  && same(channelsToRegister({ newTasks: false, asks: true }), ['driver-asks']) && same(channelsToRegister(true), ['new-tasks']),
  'the token names each channel once it exists (register_device_token p_channels; "new-tasks" kept)');

// --- 3. H1: availability -----------------------------------------------------------------------------------------------
console.log('\nAvailability (H1):');
const entry = (fields: Partial<UnavailabilityRow>): UnavailabilityRow => ({
  id: 'u1', starts_at: iso('2026-10-20T00:00:00'), ends_at: iso('2026-10-21T00:00:00'), part: 'full_day', reason: 'leave', note: null,
  created_by_name: 'Kamal Silva', created_by_employee_id: 'me', channel: 'driver', removed_at: null, ...fields,
});
check(availLine(en, enDay, entry({})) === 'Tue 20 Oct · full day · Leave', 'a full day', availLine(en, enDay, entry({})));
check(availLine(en, enDay, entry({ ends_at: iso('2026-10-24T00:00:00') })) === 'Tue 20 Oct – Fri 23 Oct · Leave', 'several days: the first and the last day');
check(availLine(en, enDay, entry({ part: 'morning', reason: 'half_day', ends_at: iso('2026-10-20T13:00:00') })) === 'Tue 20 Oct · until 13:00 · Half day',
  'the morning: "Tue 20 Oct · until 13:00 · Half day"');
check(availLine(en, enDay, entry({ part: 'afternoon', reason: 'personal', starts_at: iso('2026-10-20T13:00:00') })) === 'Tue 20 Oct · from 13:00 · Personal', 'the afternoon');
check(availLine(en, enDay, entry({ part: 'hours', reason: 'other', starts_at: iso('2026-10-20T10:00:00'), ends_at: iso('2026-10-20T12:30:00') })) === 'Tue 20 Oct · 10:00–12:30 · Other',
  'from–to');
check(/13:00/.test(availLine(si, dayLabel('si'), entry({ part: 'morning', ends_at: iso('2026-10-20T13:00:00') }))), 'Sinhala keeps the times in Latin digits');
check(addedByOther(entry({}), 'me') === null && addedByOther(entry({ channel: 'web', created_by_employee_id: 'boss', created_by_name: 'Palitha' }), 'me') === 'Palitha'
  && en('avail.addedBy', { name: 'Palitha' }) === 'Added by Palitha', 'the office\'s entries say who added them; the driver\'s own do not');
const rows = [entry({ id: 'later', starts_at: iso('2026-10-25T00:00:00'), ends_at: iso('2026-10-26T00:00:00') }), entry({ id: 'past', starts_at: iso('2026-10-10T00:00:00'), ends_at: iso('2026-10-11T00:00:00') }),
  entry({ id: 'removed', removed_at: iso('2026-10-18T10:00:00') }), entry({ id: 'soon' }), entry({ id: 'now', starts_at: iso('2026-10-19T00:00:00'), ends_at: iso('2026-10-22T00:00:00') })];
check(same(upcomingEntries(rows, NOW).map((r) => r.id), ['now', 'soon', 'later']), 'the entries ahead (or running now), soonest first; never a past or removed one');

check(same(formFromRow(entry({ ends_at: iso('2026-10-24T00:00:00') })), { from: '2026-10-20', to: '2026-10-23', part: 'full_day', start: '', end: '', reason: 'leave', note: '' }),
  'changing several days: the first and the last day');
check(same(formFromRow(entry({ part: 'hours', reason: 'other', note: 'Doctor', starts_at: iso('2026-10-20T10:00:00'), ends_at: iso('2026-10-20T12:30:00') })),
  { from: '2026-10-20', to: null, part: 'hours', start: '10:00', end: '12:30', reason: 'other', note: 'Doctor' }), 'changing from–to: the two times');
const form = newAvailForm('2026-10-19');
check(same(availArgs(form, null), { args: { p_id: null, p_from: '2026-10-19', p_to: null, p_part: 'full_day', p_start: null, p_end: null, p_reason: 'leave', p_note: null } }),
  'a full day: set_my_unavailability\'s arguments (null where there is nothing)');
check(same(availArgs({ ...form, to: '2026-10-22', note: '  Wedding  ' }, 'u9'), { args: { p_id: 'u9', p_from: '2026-10-19', p_to: '2026-10-22', p_part: 'full_day', p_start: null, p_end: null, p_reason: 'leave', p_note: 'Wedding' } }),
  'several days, a change (the id), the note trimmed');
check((availArgs({ ...form, part: 'morning', to: '2026-10-22' }, null) as { args: { p_to: unknown } }).args.p_to === null
  && (availArgs({ ...form, to: '2026-10-19' }, null) as { args: { p_to: unknown } }).args.p_to === null, 'a last day only for full days, and only after the first day');
check(same(availArgs({ ...form, part: 'hours', start: '9:00', end: '12.30' }, null), { args: { p_id: null, p_from: '2026-10-19', p_to: null, p_part: 'hours', p_start: '09:00', p_end: '12:30', p_reason: 'leave', p_note: null } }),
  'from–to: the times as HH:MM');
check('problem' in availArgs({ ...form, part: 'hours', start: '12:00', end: '09:00' }, null) && 'problem' in availArgs({ ...form, part: 'hours', start: '', end: '10:00' }, null)
  && (availArgs({ ...form, part: 'hours', start: 'x', end: '10:00' }, null) as { problem: string }).problem === 'common.badTime',
  'from–to needs two times, the second after the first (else "Enter the time as HH:MM")');
check(validTime('9:05') === '09:05' && validTime('0905') === '09:05' && validTime('24:00') === null && validTime('9') === null, 'times typed loosely are read as HH:MM');
check(dayChoices('2026-10-19').length === 60 && dayChoices('2026-10-19')[0] === '2026-10-19' && dayChoices('2026-10-19')[13] === '2026-11-01', 'the day buttons: today and the next 59 days');
check(lastDayChoices('2026-10-19').length === 30 && lastDayChoices('2026-10-19')[0] === '2026-10-20' && lastDayChoices('2026-10-19')[29] === '2026-11-18',
  'the last-day buttons: up to 31 days in all (the server\'s limit)');
check(!availDirty(form, { ...form }) && availDirty(form, { ...form, note: 'x' }), '"Discard changes?" only when something changed');
check(same(parseAvailAnswer({ result: 'ok', id: 'u1' }), { result: 'ok', id: 'u1' }) && same(parseAvailAnswer({ result: 'refused', reason: 'That day has passed.' }), { result: 'refused', reason: 'That day has passed.' })
  && parseAvailAnswer(null).result === 'refused', "the server's answer: ok with the id, or the refusal's words");
check(partKey('morning') === 'avail.morning' && en(partKey('morning'), { time: '13:00' }) === 'Morning (until 13:00)' && reasonKey('half_day') === 'avail.halfDay',
  'the "when" choices name the split (13:00, the setting half_day_split)');

// --- 4. G: the phone prompt and the profile -------------------------------------------------------------------------
console.log('\nThe phone prompt and the profile (G):');
check(needsPhonePrompt({ phone: null }, { fresh: true, taskRunning: false }) && needsPhonePrompt({ phone: '  ' }, { fresh: true, taskRunning: false }),
  'no number on the server: the prompt shows');
check(!needsPhonePrompt({ phone: '+94771234567' }, { fresh: true, taskRunning: false }), 'a number: no prompt');
check(!needsPhonePrompt({ phone: null }, { fresh: false, taskRunning: false }), 'only once the server said so in this run (an old copy on the phone does not)');
check(!needsPhonePrompt({ phone: null }, { fresh: true, taskRunning: true }), 'never over a task in progress');
check(!needsPhonePrompt({ phone: null }, { fresh: true, taskRunning: false, deferred: true }) && !needsPhonePrompt(null, { fresh: true, taskRunning: false }),
  'after Continue with no connection: not again until the next start');

check(phoneE164('077 123 4567') === '+94771234567' && phoneE164('771234567') === '+94771234567' && phoneE164('+94 77 123 4567') === '+94771234567'
  && phoneE164('011-234-5678') === '+94112345678' && phoneE164('12345') === null && phoneE164('') === null, 'numbers are stored +94… (the office\'s rule)');
check(phoneLocal('+94771234567') === '077 123 4567' && phoneLocal(null) === '', 'numbers read "077 123 4567"');
const me = {
  phone: '+94771234567', whatsapp: null, emergency_name: 'Nimali', emergency_relation: 'wife', emergency_phone: '+94712223334',
  licence_no: 'B1234567', licence_expiry: '2027-03-12',
};
const start = profileForm(me);
check(start.phone === '077 123 4567' && start.whatsapp === '' && start.emergency_phone === '071 222 3334' && start.licence_expiry === '2027-03-12', 'the form opens with the values as they read');
check(same(profilePatch(me, start), { patch: {}, problem: null }) && !profileDirty(me, start), 'nothing changed: nothing to send');
check(same(profilePatch(me, { ...start, phone: '0771234567' }), { patch: {}, problem: null }), 'the same number typed another way is not a change');
check(same(profilePatch(me, { ...start, whatsapp: '076 555 1234', emergency_relation: ' sister ' }).patch, { whatsapp: '+94765551234', emergency_relation: 'sister' }),
  'only the fields that changed, the numbers +94…, the words trimmed');
check(same(profilePatch(me, { ...start, emergency_name: '', emergency_phone: '' }).patch, { emergency_name: null, emergency_phone: null }), 'an emptied field is null (clears it)');
check(same(profilePatch(me, { ...start, phone: '' }).problem, { key: 'profile.badPhone', field: 'phone' }), 'the phone cannot be emptied');
check(same(profilePatch(me, { ...start, whatsapp: '12345' }).problem, { key: 'profile.badPhone', field: 'whatsapp' }), 'a number that is not Sri Lankan: said under its field');
check(same(profilePatch(me, { ...start, licence_expiry: '2027-02-30' }).problem, { key: 'profile.badDate', field: 'licence_expiry' })
  && same(profilePatch(me, { ...start, licence_expiry: '12/03/2027' }).problem?.key, 'profile.badDate'), 'the expiry must be a real YYYY-MM-DD date');
check(same(profilePatch(me, { ...start, licence_expiry: '' }).patch, { licence_expiry: null }) && validDate('2028-02-29') && !validDate('2027-02-29'), 'an emptied expiry clears it; leap days are real');
check(same(profilePatch({ phone: null }, { ...profileForm(null), phone: '0771234567' }).patch, { phone: '+94771234567' }), 'the phone prompt\'s patch: the phone only');
check(profileDirty(me, { ...start, licence_no: 'B7654321' }), 'a changed field asks "Discard changes?"');
check(licencePhotoPath('e1', 'p1') === 'e1/licence/p1.jpg' && licencePhotoId({ licence_front_photo_id: 'f', licence_back_photo_id: null }, 'front') === 'f'
  && licencePhotoId({ licence_front_photo_id: 'f', licence_back_photo_id: null }, 'back') === null, 'the licence photos go to <employee_id>/licence/ (set_my_licence_photo checks it)');
check(same(monthTotals([{ km: 12.4 }, { km: null }, { km: 30 }]), { tasks: 3, km: 42 }), 'this month: the completed tasks and their km (a task with no km counts as a task)');

// --- 5. H4: Running late and Can't make it -----------------------------------------------------------------------------
console.log("\nRunning late and Can't make it (H4):");
check(same([...LATE_CHOICES], [10, 15, 30]), 'the choices: 10, 15, 30 minutes, or Other');
check(lateMinutes('5') === 5 && lateMinutes('180') === 180 && lateMinutes('4') === null && lateMinutes('181') === null && lateMinutes('1.5') === null && lateMinutes('') === null,
  'Other: a whole number from 5 to 180');
const dispatch = { status: 'assigned', kind: 'dispatch', accepted_at: null } as const;
check(canReportLate(dispatch) && canReportLate({ ...dispatch, status: 'in_progress' }) && !canReportLate({ ...dispatch, status: 'completed' })
  && !canReportLate({ ...dispatch, kind: 'self' }) && !canReportLate(null), 'Running late: before or during a dispatched task, never on a trip the driver started');
check(declineKey(dispatch) === 'task.cantDo' && declineKey({ ...dispatch, accepted_at: iso('2026-10-19T08:00:00') }) === 'task.cantMakeIt',
  '"Can\'t do this task" before accepting, "Can\'t make it" after');
check(declineKey({ ...dispatch, status: 'in_progress', accepted_at: 'x' }) === null && declineKey({ ...dispatch, kind: 'self' }) === null,
  'none once the task is under way, none on a trip the driver started');
check(lateLine(en, { late_report_min: 15, late_report_at: iso('2026-10-19T08:52:00') }) === 'You said 15 min late at 08:52' && lateLine(en, { late_report_min: null, late_report_at: null }) === null,
  'the task says the last report: "You said 15 min late at 08:52"');

// --- 6. The screens, read as text (they need React Native). The back rules of CLAUDE.md. -------------------------------
console.log('\nNavigation (the screens as text):');
const src = join(here, '..', 'src');
const code = (path: string) => (existsSync(join(src, path)) ? readFileSync(join(src, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') : '');
const tabs = code('app/(tabs)/_layout.tsx');
const prompt = code('app/phone-prompt.tsx');
const meScreen = code('app/(tabs)/me.tsx');
const edit = code('app/profile-edit.tsx');
const avail = code('app/availability.tsx');
const availEdit = code('app/availability-edit.tsx');
const askScreen = code('app/ask/[id].tsx');
const layout = code('app/_layout.tsx');
const today = code('app/(tabs)/index.tsx');
const taskScreen = code('app/task/[id].tsx');
const preview = code('components/TaskPreview.tsx');
const appState = code('state/app.tsx');
check(/needsPhonePrompt\([\s\S]*?\}\)\) return <Redirect href="\/phone-prompt" \/>/.test(tabs) && tabs.indexOf('needsPhonePrompt(') < tabs.indexOf('needsProfilePhoto('),
  'the phone prompt replaces the tabs (Redirect, like the photo step), before the photo step');
check(/router\.replace\('\/'\)/.test(prompt) && !/router\.(push|back|navigate)\(/.test(prompt) && /deferPhonePrompt\(\)/.test(prompt) && !/useLeaveGuard/.test(prompt),
  'the prompt: no skip; after Save or Continue (no connection) it goes on where the app would have gone (replace, never pushed)');
check(/t\('phonePrompt\.offline'\)/.test(prompt) && /t\('phonePrompt\.continue'\)/.test(prompt) && /\(noConnection \|\| stuck\) && <Button/.test(prompt),
  'with no connection it says so and offers Continue; a save the server refuses offers Continue too (never trapped)');
check(/setStuck\(true\)/.test(prompt), 'a refused save sets the way on (Continue)');
check(/router\.push\('\/profile-edit'\)/.test(meScreen) && /router\.push\('\/availability'\)/.test(meScreen) && /router\.push\('\/documents'\)/.test(meScreen)
  && /router\.push\('\/phone-setup'\)/.test(meScreen), 'Me pushes Edit, Availability, Phone setup and Documents (back returns to Me)');
check(/disabled=\{signOutBlocked !== null\}/.test(meScreen) && /t\('me\.thisMonth'\)/.test(meScreen) && /useLicencePhotos\(\)/.test(meScreen), 'Me keeps Sign out\'s rule; shows this month and the licence photos');
check(/useLeaveGuard\(dirty, busy === 'save'\)/.test(edit) && /allowLeave\(\);[\s\S]*router\.back\(\)/.test(edit) && !/router\.(replace|navigate|dismissAll)\(/.test(edit),
  'Edit: "Discard changes?" with unsaved input, nothing while saving; after Save back to Me');
check(/t\('profile\.noConnection'\)/.test(edit) && /takePhoto\(\)/.test(edit), 'Edit: online only (says so); the licence photos from the camera');
check(/router\.push\('\/availability-edit'\)/.test(avail) && /pathname: '\/availability-edit', params: \{ id: row\.id \}/.test(avail) && /useFocusEffect/.test(avail),
  'Availability pushes the form (add, or change with the id) and reads the list again when it comes back');
check(/t\('avail\.removeConfirm'\)/.test(avail) && /removeMyUnavailability\(/.test(avail), 'Remove asks first');
check(/useLeaveGuard\(availDirty\(start, form\), busy\)/.test(availEdit) && /allowLeave\(\);\s*router\.back\(\)/.test(availEdit) && !/router\.(replace|navigate|dismissAll)\(/.test(availEdit),
  'the form: "Discard changes?" when changed; after Save back to the list');
check(/data\.kind === 'ask' && askId/.test(layout) && /router\.navigate\('\/'\);\s*\}\s*router\.push\(\{ pathname: '\/ask\/\[id\]', params: \{ id: askId \} \}\)/.test(layout),
  'a question\'s notification opens the question with Today underneath (a form with unsaved input stays underneath instead)');
check(/router\.push\(\{ pathname: '\/ask\/\[id\]', params: \{ id: ask\.ask_id \} \}\)/.test(today) && /bannerAsk\(app\.asks, now\)/.test(today), "Today's banner pushes the question (back returns to Today)");
check(/useLeaveGuard\(dirty, busy !== null\)/.test(askScreen) && /markAskSeen\(id\)/.test(askScreen) && /oneFix\(\)/.test(askScreen) && !/startSharing|startLocationUpdates/.test(askScreen),
  'the question: marked seen when opened; Share my location takes one fix (never starts recording); a time picked asks "Discard changes?"');
check(/table: 'driver_ask_answers', filter: `employee_id=eq\.\$\{myId\}`/.test(appState) && /kind === 'ask'\) void loadAsksRef\.current\(\)/.test(appState),
  'the banner follows Realtime (driver_ask_answers) and the question\'s push');
check(/canReportLate\(task\) && <RunningLate task=\{task\} \/>/.test(taskScreen) && /accepted && canReportLate\(task\) && <RunningLate task=\{task\} \/>/.test(preview),
  'Running late on the task screen under way and on the preview once accepted');
check(/next\.accepted_at && canReportLate\(next\)/.test(today) && /<DeclineSheet /.test(preview) && /<DeclineSheet /.test(today), "Today's card has it too; Can't make it opens the existing reasons sheet");

// --- 7. Strings (en and si) ------------------------------------------------------------------------------------------
console.log('\nStrings (en and si):');
const files = [
  'app/(tabs)/me.tsx', 'app/profile-edit.tsx', 'app/phone-prompt.tsx', 'app/availability.tsx', 'app/availability-edit.tsx', 'app/ask/[id].tsx',
  'components/LateSheet.tsx', 'components/TaskPreview.tsx', 'app/(tabs)/index.tsx', 'app/task/[id].tsx', 'lib/asks.ts', 'lib/late.ts',
  'lib/availability.ts', 'lib/profile.ts', 'lib/channels.ts',
];
const keys = new Set<string>();
for (const file of files) {
  for (const m of readFileSync(join(src, file), 'utf8').matchAll(/'((?:ask|late|avail|profile|phonePrompt|me|channel|common|gate|task|docs|phoneSetup)\.[A-Za-z.]+)'/g)) keys.add(m[1]);
}
const missing = [...keys].filter((k) => typeof lookup(strings.en, k) !== 'string' || typeof lookup(strings.si, k) !== 'string');
check(missing.length === 0 && keys.has('ask.otherTime') && keys.has('late.failed') && keys.has('common.badTime'), `every key the new screens use is in en and si (${keys.size} keys)`, missing);
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const sections = ['me', 'profile', 'phonePrompt', 'avail', 'ask', 'late'];
const drift: string[] = [];
for (const section of sections) {
  const enSection = lookup(strings.en, section) as Record<string, string>;
  for (const [key, text] of Object.entries(enSection)) {
    const other = lookup(strings.si, `${section}.${key}`);
    if (typeof other !== 'string' || placeholders(other) !== placeholders(text)) drift.push(`${section}.${key}`);
  }
}
check(drift.length === 0, 'every Part 3b key has its Sinhala, with the same {placeholders} (the numbers are filled in Latin digits)', drift);
check(!/[෦-෯]/.test(JSON.stringify(strings.si)), 'no Sinhala digits anywhere (numbers stay Latin)');

console.log(failures === 0 ? '\nAll Part 3b driver tests passed.' : `\n${failures} Part 3b driver test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
