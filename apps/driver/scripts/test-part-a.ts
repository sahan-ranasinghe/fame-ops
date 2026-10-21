// Round 3 Part A (docs/phase8-plan.md §30, Sahan 21 October 2026), the app's side (Office mode, /m/ and the driver app):
//   A1 the day timeline's icons, A2 no language switch on an office header, A3 every map light, A4 dates in words (the one
//   formatter, lib/dateWords.ts, and the screens that use it), A5 the office person's driving licence and the approver's
//   line, A6 expired requests (the badge, the filters, Request again's copied fields); every new key in both languages.
//   npm run test:part-a          (from apps/driver)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dateParts, dateWords, datesInWords, dayWords, monthWords, shortWhen, spanWords } from '../src/lib/dateWords';
import { segmentIcon } from '../src/office/driversLogic';
import { licenceInput, licenceStateWords, selfDriveLine } from '../src/office/licenceLogic';
import { canRequestAgain, expiredText, isExpired, REQUEST_STATUSES, requestsChoice, requestsFilterDefs, statusTone } from '../src/office/requestsLogic';
import { sentenceText, tripChip } from '../src/office/statusWords';
import { requestAgainDraft } from '../src/office/trip/draftLogic';
import { bucketOf, TRIP_BUCKETS, tripsFilterDefs } from '../src/office/tripsLogic';
import type { RequestCard } from '../src/office/types';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');
const load = (lang: string) => JSON.parse(read(`i18n/${lang}.json`));
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
/** Every .ts / .tsx file under a folder of src (relative paths). */
const filesUnder = (dir: string): string[] => readdirSync(join(src, dir)).flatMap((name) => {
  const p = join(dir, name);
  return statSync(join(src, p)).isDirectory() ? filesUnder(p) : /\.tsx?$/.test(name) ? [p] : [];
});

// "Now" for the formatter: Wednesday 21 October 2026, 10:00 in Colombo (04:30 UTC).
const NOW = Date.parse('2026-10-21T04:30:00Z');

console.log('A4: one formatter, dates in words (lib/dateWords.ts)');
{
  check(dateWords(en, '2026-10-21 20:47', NOW) === 'Today 20:47', 'today: "Today 20:47"', dateWords(en, '2026-10-21 20:47', NOW));
  check(dateWords(en, '2026-10-20 20:47', NOW) === 'Yesterday 20:47', 'yesterday: "Yesterday 20:47"');
  check(dateWords(en, '2026-10-22 09:00', NOW) === 'Tomorrow 09:00', 'tomorrow: "Tomorrow 09:00"');
  check(dateWords(en, '2026-10-19 20:47', NOW) === 'Mon 19 Oct 20:47', 'this year: "Mon 19 Oct 20:47" (no year)', dateWords(en, '2026-10-19 20:47', NOW));
  check(dateWords(en, '2025-12-12 09:05', NOW) === 'Fri 12 Dec 2025 09:05', 'another year: the year after the month', dateWords(en, '2025-12-12 09:05', NOW));
  check(dateWords(en, '2027-03-12', NOW) === 'Fri 12 Mar 2027', 'a date alone, next year: no time', dateWords(en, '2027-03-12', NOW));
  check(dateWords(en, '2026-10-21', NOW) === 'Today' && dateWords(en, '2026-10-20', NOW) === 'Yesterday' && dateWords(en, '2026-11-02', NOW) === 'Mon 2 Nov', 'a date alone: Today, Yesterday, "Mon 2 Nov"');
  // Colombo midnight: 18:31 UTC on the 20th is 00:01 on the 21st in Colombo; 18:29 UTC is still the 20th (23:59).
  check(dateWords(en, '2026-10-20T18:31:00Z', NOW) === 'Today 00:01' && dateWords(en, '2026-10-20T18:29:00.000Z', NOW) === 'Yesterday 23:59', 'an instant is said in Colombo time (midnight is +05:30)', [dateWords(en, '2026-10-20T18:31:00Z', NOW), dateWords(en, '2026-10-20T18:29:00.000Z', NOW)]);
  check(dateWords(en, '2026-10-21 00:00', Date.parse('2026-10-20T18:30:00Z')) === 'Today 00:00' && dateWords(en, '2026-10-20 23:59', Date.parse('2026-10-20T18:30:00Z')) === 'Yesterday 23:59', 'at Colombo midnight "today" is the new day');
  check(dateWords(en, new Date('2026-10-21T04:00:00+05:30'), NOW) === 'Today 04:00' && dateWords(en, Date.parse('2026-10-19T03:00:00Z'), NOW) === 'Mon 19 Oct 08:30', 'a Date and epoch ms too');
  check(dateWords(si, '2026-10-21 20:47', NOW) === 'අද 20:47' && dateWords(si, '2026-10-20 20:47', NOW) === 'ඊයේ 20:47' && dateWords(si, '2026-10-22 09:00', NOW) === 'හෙට 09:00', 'Sinhala: අද, ඊයේ, හෙට with the time in Latin digits');
  check(dateWords(si, '2026-10-19 20:47', NOW) === `${si('days.1')} 19 ${si('months.9')} 20:47` && !/[෦-෯]/.test(dateWords(si, '2025-12-12 09:05', NOW)) && dateWords(si, '2025-12-12 09:05', NOW).includes('2025'), 'Sinhala day and month words, Latin digits, the year when not this year', dateWords(si, '2026-10-19 20:47', NOW));
  check(dateWords(en, 'never', NOW) === 'never' && dateWords(en, '5 min ago', NOW) === '5 min ago' && dateWords(en, null, NOW) === '' && dateWords(en, '2026-02-30', NOW) === '2026-02-30' && dateWords(en, '2026-10-20T10:00', NOW) === 'Yesterday 10:00', 'not a date: as it is (an impossible day too); a bare "T" time is Colombo\'s wall clock');
  check(dateParts('2026-10-20 25:00') === null && same(dateParts('2026-10-20'), { day: '2026-10-20', time: null }), 'the parts: an impossible time is not a date');
  check(datesInWords(en, '2026-10-21 08:15 by Palitha', NOW) === 'Today 08:15 by Palitha', 'inside a sentence: "2026-10-21 08:15 by Palitha" → "Today 08:15 by Palitha"');
  check(datesInWords(en, 'Expires 2027-01-31; checked 2026-10-20 20:47.', NOW) === 'Expires Sun 31 Jan 2027; checked Yesterday 20:47.', 'every date in the sentence', datesInWords(en, 'Expires 2027-01-31; checked 2026-10-20 20:47.', NOW));
  check(datesInWords(en, 'id 2026-10-20T15:17:00Z kept', NOW) === 'id 2026-10-20T15:17:00Z kept' && datesInWords(en, '', NOW) === '' && datesInWords(en, undefined, NOW) === '', 'an ISO stamp inside text is left alone (never half-replaced)');
  check(dayWords(en, '2026-10-21', '2026-10-21') === 'Today' && dayWords(en, '2026-01-01', '2025-12-31') === 'Tomorrow' && dayWords(en, '2025-12-31', '2026-01-01') === 'Yesterday', 'across a year: tomorrow and yesterday still in words');
}

console.log('\nA4: the screens use it (no raw server date on screen)');
{
  // Each place a server date reaches the screen goes through dateWords / datesInWords (the audit's list).
  const uses: [string, RegExp][] = [
    ['app/office/request/[id].tsx', /dateWords\(t, e\.at\)/],
    ['app/office/request/[id]/time.tsx', /day: dateWords\(t, asked\.date\)/],
    ['office/statusWords.ts', /isoDate/],
    ['app/office/profile.tsx', /dateWords\(t, lic\.expiry\)/],
    ['app/office/driver/[username].tsx', /dateWords\(t, licence\.expiry\)[\s\S]*dateWords\(t, e\.added\)/],
    ['app/office/issues/[id].tsx', /when: \(at\) => dateWords\(t, at\)[\s\S]*dateWords\(t, snooze\.until\)[\s\S]*dateWords\(t, h\.report\.reported\)[\s\S]*dateWords\(t, e\.at\)/],
    ['app/office/issues/index.tsx', /opened: \(at\) => t\('office\.issues\.opened', \{ at: dateWords\(t, at\)[\s\S]*dateWords\(t, snooze\.until\)/],
    ['app/office/maintenance/index.tsx', /dateWords\(t, r\.reported\)/],
    ['app/office/maintenance/[id].tsx', /dateWords\(t, r\.reported\)\]/],
    ['app/office/people/activity.tsx', /dateWords\(t, e\.at\.slice\(0, 10\)\)/],
    ['app/office/places/[id].tsx', /datesInWords\(t, p\.removed\)[\s\S]*dateWords\(t, p\.updated_at\)/],
    ['app/office/places/index.tsx', /datesInWords\(t, p\.removed\)/],
    ['app/office/reports/index.tsx', /datesInWords\(t, c\.value\)[\s\S]*monthWords\(t, v\.month\.month\)[\s\S]*monthWords\(t, d\.month\)[\s\S]*dateWords\(t, e\.at\)[\s\S]*dateWords\(t, p\.day\)/],
    ['app/office/task/[id].tsx', /dateWords\(t, task\.needs_driver\.since\)[\s\S]*shortWhen\(t, s\.time\)[\s\S]*shortWhen\(t, task\.started\)/],
    ['app/office/task/[id]/driver.tsx', /dateWords\(t, task\.needs_driver\.since\)/],
    ['app/office/task/[id]/plan.tsx', /dateWords\(t, plan\.computed_at\)/],
    ['app/office/task/[id]/route.tsx', /spanWords\(t, route\.data\?\.task\?\.started, route\.data\?\.task\?\.completed\)/],
    ['app/office/vehicles/[reg].tsx', /dateWords\(t, v\.rent_until\)[\s\S]*dateWords\(t, v\.garage_booked\)[\s\S]*dateWords\(t, dc\.expiry\)[\s\S]*dateWords\(t, r\.doc\.expiry\)[\s\S]*datesInWords\(t, r\.doc\.uploaded\)/],
    ['app/office/vehicles/doc.tsx', /dateWords\(t, doc\.expiry\)[\s\S]*datesInWords\(t, doc\.uploaded\)/],
    ['app/office/vehicles/form.tsx', /value: datesInWords\(t, String\(opts\.now\)\)/],
    ['components/office/TaskDetailParts.tsx', /datesInWords\(t, unloggedText[\s\S]*datesInWords\(t, x\.line\)[\s\S]*dateWords\(t, f\.at\)[\s\S]*dateWords\(t, r\.at\)[\s\S]*dateWords\(t, h\.at\)/],
    ['components/patterns/Calendar.tsx', /accessibilityLabel=\{dateWords\(t, d\)\}/],
  ];
  for (const [file, re] of uses) check(re.test(read(file)), `${file} says its dates in words`);
  // No screen prints a server date field as it came: {x.at}, {x.since}, {x.expiry} … straight into the text.
  const screens = [...filesUnder('app'), ...filesUnder('components')].filter((f) => f.endsWith('.tsx'));
  const raw = screens.filter((f) => /<(Txt|Mono)[^>]*>\{[a-z]+\.(at|since|sent|created|updated|opened|reported|expiry|added|until|day|uploaded|removed|started|completed|decided|seen|last_used|updated_at)\}<\//.test(read(f)));
  // A plan's timeline row ({x.at} / {leave.at}) is HH:MM, not a date.
  check(same(raw.sort(), ['app/office/task/[id]/plan.tsx', 'app/office/trip/review.tsx'].sort()), 'no raw date field printed on a screen (only the plans\' HH:MM rows)', raw);
  check(monthWords(en, '2026-10', NOW) === 'Oct' && monthWords(en, '2025-12', NOW) === 'Dec 2025' && monthWords(si, '2026-10', NOW) === si('months.9') && monthWords(en, 'x', NOW) === 'x', 'a month: "Oct", "Dec 2025"');
  check(shortWhen(en, '2026-10-21 08:31', NOW) === '08:31' && shortWhen(en, '2026-10-20 08:31', NOW) === 'Yesterday 08:31' && shortWhen(en, '—', NOW) === '—' && shortWhen(en, '~10:38', NOW) === '~10:38', "a step's time: alone today, with its day otherwise");
  check(spanWords(en, '2026-10-21 08:31', '2026-10-21 11:40', NOW) === 'Today 08:31–11:40' && spanWords(en, '2026-10-19 22:10', '2026-10-20 01:05', NOW) === 'Mon 19 Oct 22:10 – Yesterday 01:05' && spanWords(en, '2026-10-21 08:31', undefined, NOW) === 'Today 08:31', 'a span on one day, across two, still running');
}

console.log('\nA1: the day timeline (components/office/DayRoute.tsx)');
{
  check(segmentIcon('driving') === 'car' && segmentIcon('stopped') === 'pin' && segmentIcon('no_gps') === 'warning' && segmentIcon('no_data') === 'warning', 'a car, a pin, a warning');
  const day = read('components/office/DayRoute.tsx');
  check(!/segDot|toneColor|segmentTone/.test(day), 'no coloured bar or dot beside a row');
  check(/<SegIcon kind=\{segmentIcon\(seg\.kind\)\} \/>/.test(day) && /Car : kind === 'pin' \? MapPin : TriangleAlert/.test(day), 'one small icon per row');
}

console.log('\nA2: no language switch on an office header');
{
  const office = [...filesUnder('app/office'), ...filesUnder('web-app/office'), ...filesUnder('components/office'), 'office/ui.tsx'];
  const withSwitch = office.filter((f) => /LanguageSwitch|LanguagePill/.test(read(f)));
  check(same(withSwitch, ['app/office/profile.tsx']), 'only My profile has it (Office mode and /m/)', withSwitch);
  check(!/LanguagePill/.test(read('app/office/(tabs)/live.tsx')), 'Live: no language pill on its bar');
  check(/<LanguagePill \/>/.test(read('app/(tabs)/index.tsx')), "the driver app's Today keeps its සිංහල switch (the boss's design)");
}

console.log('\nA3: every map light');
{
  const googleMaps = ['components/GoogleTaskMap.tsx', 'components/GoogleDriversMap.tsx', 'components/GoogleRouteMap.tsx', 'components/office/PinAdjust.tsx'];
  for (const f of googleMaps) {
    const text = read(f);
    // Each JSX <GoogleMapView …> (not useRef<GoogleMapView>): its props up to the first callback.
    const views = text.split('<GoogleMapView').slice(1).filter((s) => /^\s/.test(s)).map((s) => s.slice(0, s.indexOf('=>')));
    check(views.length > 0 && views.every((v) => /userInterfaceStyle="light"/.test(v)), `${f}: Google's map in the light scheme, whatever the phone's dark mode`);
  }
  const every = [...filesUnder('components'), ...filesUnder('app')].filter((f) => /from 'react-native-maps'/.test(read(f)));
  check(same(every.sort(), [...googleMaps].sort()), 'every react-native-maps map is one of those', every);
  check(/colorScheme: api\.ColorScheme\?\.LIGHT \?\? 'LIGHT'/.test(read('components/web/googleWeb.ts')), "the browser's Google map (/m/): colorScheme LIGHT");
  const free = [...filesUnder('components'), ...filesUnder('lib')].filter((f) => /tiles\.openfreemap\.org\/styles\//.test(read(f)));
  check(free.length > 0 && free.every((f) => !/styles\/(dark|fiord)/.test(read(f))), 'the free map: the light Liberty style only', free);
}

console.log('\nA5: the driving licence (office/licenceLogic.ts)');
{
  const was = { number: 'B1234567', expiry: '2028-05-01', state: 'on_file' as const };
  check(same(licenceInput({ number: ' B1234567 ', expiry: '2028-05-01' }, was), { input: {}, problem: null }), 'nothing changed: nothing sent');
  check(same(licenceInput({ number: 'B7654321', expiry: '2028-05-01' }, was).input, { licence_no: 'B7654321' }), 'the number only');
  check(same(licenceInput({ number: '', expiry: '' }, was).input, { licence_no: null, licence_expiry: null }), 'cleared: null clears both');
  check(same(licenceInput({ number: 'X1', expiry: '2029-01-31' }, undefined).input, { licence_no: 'X1', licence_expiry: '2029-01-31' }), 'a first licence: both');
  check(licenceInput({ number: 'X1', expiry: '2029-02-30' }, undefined).problem === 'office.profile.licenceDateBad' && licenceInput({ number: 'X1', expiry: '31/01/2029' }, undefined).problem === 'office.profile.licenceDateBad', 'an expiry that is not a day: the reason, nothing sent');
  check(same(licenceStateWords('on_file'), { key: 'office.profile.licenceOnFile', tone: 'green' }) && licenceStateWords('expired').tone === 'red' && licenceStateWords('none').tone === 'amber' && licenceStateWords(undefined).key === 'office.profile.licenceNone', 'the state: on file green, none amber, expired red');
  check(same(selfDriveLine({ driven_by: 'self', self_drive_licence: 'on_file' }), { key: 'office.who.licenceOnFile', warn: false }), 'the approver: "Self-drive · licence on file ✓"');
  check(same(selfDriveLine({ driven_by: 'self', self_drive_licence: 'none' }), { key: 'office.who.licenceNone', warn: true }) && same(selfDriveLine({ driven_by: 'self', self_drive_licence: 'expired' }), { key: 'office.who.licenceExpired', warn: true }), 'none / expired: amber (a warning, never a block)');
  check(selfDriveLine({ driven_by: 'other', self_drive_licence: 'none' }) === null && selfDriveLine({}) === null && selfDriveLine({ driven_by: 'self' }) === null, 'not self-drive, or an older card: no line');
  check(en('office.who.licenceOnFile') === 'Self-drive · licence on file ✓' && en('office.who.licenceNone') === 'Self-drive · no licence on file' && en('office.who.licenceExpired') === 'Self-drive · licence expired', 'the words as asked');
  check(sentenceText(si, 'Nimali Fernando has no driving licence on file (self-drive).') === si('office.warn.noLicence', { name: 'Nimali Fernando' }) && sentenceText(en, 'Nimali Fernando has no driving licence on file (self-drive).') === 'Nimali Fernando has no driving licence on file (self-drive).', 'the warning "X has no driving licence on file (self-drive)." in Sinhala');
  const profile = read('app/office/profile.tsx');
  check(/update_my_profile', input\)/.test(profile) && /saveMyLicencePhoto\(side, uri\)/.test(profile) && /use="driver_licence"/.test(profile), 'My profile: update_my_profile with only the change, the photos as the driver\'s own');
  const photo = read('office/myPhoto.ts');
  check(/licencePhotoPath\(id, photoId\)/.test(photo) && /kind: 'licence'/.test(photo) && /set_my_licence_photo', \{ p_side: side, p_photo_id: photoId \}/.test(photo), "the photo: <employee_id>/licence/, a photos row of kind licence, set_my_licence_photo");
  check(/selfDriveLine\(card\)/.test(read('app/office/request/[id].tsx')) && /selfDriveLine\(r\)/.test(read('app/office/(tabs)/approve.tsx')), "the approver's line on the request's page and the Approve tab's row");
  const who = read('components/office/WhoDrivesChoice.tsx');
  check(/WHO_CHOICES\.map/.test(who) && !/permissions|can\(/.test(who), "I'll drive myself is offered to anyone who can request (no permission check on the choice)");
}

console.log('\nA6: expired requests');
{
  const card = (patch: Partial<RequestCard> = {}): RequestCard => ({ id: 'r1', requested_by: 'Nimali', when: 'Tue 20 Oct 11:00', status: 'expired', ...patch });
  check(REQUEST_STATUSES.includes('expired') && requestsChoice({ status: 'expired' }) === 'expired', 'the Approve tab\'s filter has Expired (list_requests status expired)');
  const opt = requestsFilterDefs(en)[0].options.find((o) => o.value === 'expired');
  check(opt?.label === 'Expired' && requestsFilterDefs(si)[0].options.find((o) => o.value === 'expired')?.label === si('office.requests.status_expired'), 'its label in both languages');
  check(statusTone('expired') === 'muted' && isExpired(card()) && isExpired({ live: { state: 'expired' } }) && !isExpired(card({ status: 'waiting' })), 'its own badge: grey with the icon');
  check(same(tripChip('expired'), { key: 'expired', tone: 'muted' }) && en('office.chip.expired') === 'Expired', "My trips' chip");
  check(TRIP_BUCKETS.includes('expired') && bucketOf(card({ live: { state: 'expired', text: 'Expired · nobody decided it in time' } })) === 'expired', "Trips' filter and section: Expired, never Waiting");
  check(tripsFilterDefs([card({ live: { state: 'expired', text: '' } })], en)[0].options.some((o) => o.value === 'expired' && o.count === 1), "the Trips filter's Expired with its count");
  check(sentenceText(si, 'Expired · nobody decided it in time') === si('office.line.expired'), 'the live state in Sinhala');
  check(expiredText(card({ expired: '2026-10-21 00:15' }), en, (at) => dateWords(en, at, NOW)) === 'Nobody decided it in time · expired Today 00:15' && expiredText(card(), en, (at) => at) === 'Nobody decided it in time', 'the line, with the time in words');
  check(canRequestAgain(card(), ['create_request'], true) && !canRequestAgain(card(), ['create_request'], false) && !canRequestAgain(card(), [], true) && !canRequestAgain(card({ status: 'waiting' }), ['create_request'], true) && !canRequestAgain(card({ kind: 'task' }), ['create_request'], true), 'Request again: the person who asked, an expired request, create_request');

  const expired = card({
    project: 'TRKAN1',
    note: 'Bring the ladder',
    fields: {
      date: '2026-10-20', time: '', back_by: '17:00', need_type: 'van', pax: 4, tools: true, note: 'Bring the ladder', driver_required: false,
      driven_by: 'self', on_behalf_of: 'Kamal', leave_by: '08:30', return_to_base: true,
      stops: [{ type: 'pickup', place: 'Head office' }, { type: 'drop', place: 'Kurunegala site', arrive_by: '11:00' }],
      start: { place: 'Fame yard' },
    },
  });
  const d = requestAgainDraft(expired, '2026-10-21');
  check(d.mode === 'request' && d.againOf === 'r1' && d.fields.date === '2026-10-22', 'Request again: a new request for tomorrow (editable), made from this one');
  check(same(d.fields.stops.map((s) => [s.type, s.place, s.arriveBy]), [['pickup', 'Head office', ''], ['drop', 'Kurunegala site', '11:00']]) && d.fields.start === 'Fame yard' && d.fields.leaveBy === '08:30' && d.fields.end === '17:00' && d.fields.returnToBase, 'the route, the start and the times copied', d.fields.stops);
  check(d.fields.pax === '4' && d.req.need === 'van' && d.req.tools && d.req.note === 'Bring the ladder' && d.req.behalf === 'Kamal' && d.req.project === 'TRKAN1' && d.req.who?.by === 'self', 'passengers, vehicle type, tools, the note, on behalf of, the project, who drives', d.req);
  const old = requestAgainDraft(card({ fields: { date: '2026-10-19', time: '09:00', route_from: 'Colombo', route_to: 'Galle', pax: 2 } }), '2026-10-21');
  check(same(old.fields.stops.map((s) => s.place), ['Colombo', 'Galle']) && old.fields.leaveBy === '09:00' && old.fields.date === '2026-10-22' && old.req.who?.by === 'driver', 'an older request (From and To): the route as two stops, its time; a driver');
  check(/again: card\.id/.test(read('app/office/request/[id].tsx')) && /again: trip\.id/.test(read('app/office/(tabs)/trips.tsx')) && /requestAgainDraft\(card, colomboDate\(\)\)/.test(read('app/office/trip/where.tsx')), "Request again on the request's page and its Trips row; a link straight to Where reads the request");
}

console.log('\nEvery new key in both languages');
{
  const keys = [
    'date.today', 'date.yesterday', 'date.tomorrow',
    ...['licence', 'licenceNo', 'licenceExpires', 'licenceNoExpiry', 'licenceExpiryLabel', 'licenceOnFile', 'licenceNone', 'licenceExpired', 'licenceDateBad'].map((k) => `office.profile.${k}`),
    ...['licenceOnFile', 'licenceNone', 'licenceExpired', 'myLicenceNone', 'myLicenceExpired', 'addLicence'].map((k) => `office.who.${k}`),
    'office.warn.noLicence', 'office.requests.status_expired', 'office.requests.expiredLine', 'office.requests.expiredLineNoTime', 'office.requests.requestAgain',
    'office.chip.expired', 'office.trips.expired', 'office.line.expired',
  ];
  const ph = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const missing = keys.filter((k) => typeof lookup('si', k) !== 'string' || typeof lookup('en', k) !== 'string');
  check(missing.length === 0, `every key in en and si (${keys.length})`, missing);
  check(keys.filter((k) => ph(lookup('en', k) as string) !== ph((lookup('si', k) as string) ?? '')).length === 0, 'the same {placeholders} in both languages');
  check(keys.every((k) => lookup('si', k) !== lookup('en', k) && !/[෦-෯]/.test(lookup('si', k) as string)), 'every text said in Sinhala, Latin digits');
}

// The server's own day words (colomboDayTime / whenText) read in words too (Round 3, A4 and C3).
{
  const { whenWords, datesInWords: inText } = require('../src/lib/dateWords') as typeof import('../src/lib/dateWords');
  const now = new Date('2026-10-21T10:00:00+05:30');
  const enT = (k: string) => String(k.split('.').reduce<unknown>((o, x) => (o as Record<string, unknown>)?.[x], JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', 'en.json'), 'utf8'))));
  const siT = (k: string) => String(k.split('.').reduce<unknown>((o, x) => (o as Record<string, unknown>)?.[x], JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', 'si.json'), 'utf8'))));
  check(whenWords(enT, 'Thu 22 Oct 08:30', now) === 'Tomorrow 08:30' && whenWords(enT, 'Mon 19 Oct 08:30', now) === 'Mon 19 Oct 08:30'
    && whenWords(enT, 'tomorrow 13:07', now) === 'Tomorrow 13:07' && whenWords(enT, '2026-10-21 09:00', now) === 'Today 09:00' && whenWords(enT, '08:30', now) === '08:30',
    'a when-field: the server\'s day words, its "tomorrow", a raw date, a time alone', [whenWords(enT, 'Thu 22 Oct 08:30', now), whenWords(enT, 'tomorrow 13:07', now)]);
  check(whenWords(siT, 'Thu 22 Oct 08:30', now) === `${siT('date.tomorrow')} 08:30` && !/[A-Za-z]/.test(whenWords(siT, 'Mon 19 Oct 08:30', now)) && /19/.test(whenWords(siT, 'Mon 19 Oct 08:30', now)),
    'in Sinhala: no English day or month words, Latin digits', whenWords(siT, 'Mon 19 Oct 08:30', now));
  check(inText(enT, 'booked Thu 22 Oct 08:00–10:00', now) === 'booked Thu 22 Oct 08:00–10:00' && !/Thu|Oct/.test(inText(siT, 'booked Thu 22 Oct 08:00–10:00', now)),
    'inside a sentence: never made relative; Sinhala names in Sinhala', inText(siT, 'booked Thu 22 Oct 08:00–10:00', now));
}

console.log(failures === 0 ? '\nAll Part A checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
