// Round 50 (29 October 2026, phase8-plan.md §37.5): /m/ driver-lite and the office's views of a self trip, as rules (no
// phone, no browser): what the drive page asks next and what it may send (office/webTripLogic.ts webStep, actionAllowed),
// the one position per action or none (positionInput, noPositionWords, webPosition.ts askOnePosition with a fake
// geolocation), one client id per action (clientIdFor, idsAfterFailure), the start and finish forms and their inputs for
// web_trip_action, the web trip's straight dashed line and its marks for the route views (webLinePoints, webMarks,
// driversLogic.webTripLines, liveRouteLogic.drawingOf), Live's "Web trip · last seen at …", "Self-drive" on the task rows,
// Can drive and Driving mode, the words in both languages, and the screens wired as the contract says (read as text).
//   npm run test:web-trip          (from apps/driver)
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeLines, webTripLines } from '../src/office/driversLogic';
import { drawingOf, routeOf } from '../src/office/liveRouteLogic';
import { rowLine } from '../src/office/liveLogic';
import { canDriveHintKey, canDriveInput, QUICK_SETTINGS, switchValue, withCanDrive } from '../src/office/peopleLogic';
import { mapInfo } from '../src/office/routeInfo';
import { taskLineText, taskRowLine } from '../src/office/statusWords';
import type { DriverRoute, LiveDriver, MyTripWeb, OfficeUsers, WebPoint } from '../src/office/types';
import { askOnePosition } from '../src/office/webPosition';
import {
  actionAllowed, actionKey, browserOffline, clientIdFor, doneWords, emptyStart, emptyWebFinish, fuelEstimateWords, hasWebTrip, idsAfterFailure, isSelfDriveTrip,
  noPositionWords, OFFLINE, offerWebDrive, positionFailure, positionInput, startInput, startReason, stopInput, stopsLeft, webFinishInput, webFinishReason, webKm,
  webLinePoints, webMarks, webMarkWords, webStep, webTripSeenWords,
} from '../src/office/webTripLogic';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const ROOT = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
/** The code without its // comments (the comments name what is left out on purpose). */
const code = (txt: string) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- The words ----
type Tree = { [k: string]: string | Tree };
const dicts: Record<'en' | 'si', Tree> = { en: JSON.parse(read('i18n/en.json')), si: JSON.parse(read('i18n/si.json')) };
const lookup = (lang: 'en' | 'si', key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(lang, key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const en = tr('en');
const si = tr('si');

const stops: MyTripWeb['stops'] = [
  { id: 's2', n: 2, type: 'drop', place: 'Kurunegala site', status: 'pending' },
  { id: 's1', n: 1, type: 'pickup', place: 'Head office', status: 'pending' },
];
const web = (patch: Partial<MyTripWeb> = {}): MyTripWeb => ({ allowed: true, started: false, check_needed: true, last_km: 45210, stops, ...patch });

console.log('\n== What comes next (webStep) and what may be sent (actionAllowed) ==');
{
  check(webStep(null).kind === 'closed' && webStep(web(), true).kind === 'done', 'no trip: closed; finished: done');
  check(webStep(web({ allowed: false, why: 'Driving mode is off' })).kind === 'closed' && (webStep(web({ allowed: false, why: 'x' })) as { why?: string }).why === 'x', 'not allowed: closed with the server\'s sentence');
  check(webStep(web({ allowed: false, driven_in: 'app', started: true })).kind === 'inApp', 'started in the app: the app\'s');
  check(webStep(web()).kind === 'start', 'not started: Start');
  const s1 = webStep(web({ started: true }));
  check(s1.kind === 'arrive' && s1.stop.id === 's1', 'started: the first stop by its number (not the answer\'s order), its Arrived slide', s1);
  const s2 = webStep(web({ started: true, stops: [{ ...stops[1], status: 'arrived', arrived_at: '08:10' }, stops[0]] }));
  check(s2.kind === 'leave' && s2.stop.id === 's1', 'arrived at a stop: its Done slide');
  const s3 = webStep(web({ started: true, stops: [{ ...stops[1], status: 'done' }, stops[0]] }));
  check(s3.kind === 'arrive' && s3.stop.id === 's2', 'done: the next stop\'s Arrived');
  check(webStep(web({ started: true, stops: [{ ...stops[1], status: 'done' }, { ...stops[0], status: 'skipped' }] })).kind === 'finish', 'every stop done or skipped: Finish');
  check(webStep(web({ started: true, stops: [] })).kind === 'finish', 'no stops: Finish after Start');
  check(actionAllowed(web(), 'start') && !actionAllowed(web(), 'arrive', 's1') && !actionAllowed(web(), 'finish'), 'before the start: only start');
  const w = web({ started: true });
  check(actionAllowed(w, 'arrive', 's1') && !actionAllowed(w, 'arrive', 's2') && !actionAllowed(w, 'leave', 's1') && !actionAllowed(w, 'start'), 'arrive at the next stop only; no leave before arriving; no second start');
  check(actionAllowed(w, 'finish') && stopsLeft(w) === 2, 'finish any time after the start (the stops left as not visited: 2)');
  check(!actionAllowed(web({ allowed: false }), 'start'), 'nothing when not allowed');
  check(offerWebDrive('web', web()) && !offerWebDrive('android', web()) && !offerWebDrive('web', web({ allowed: false })) && !offerWebDrive('web', null), 'the offer: a browser only, and only when allowed');
}

console.log('\n== One position per action, or none ==');
{
  check(same(positionInput({ ok: true, lat: 7.4863981234, lng: 80.3623451234, accuracy_m: 12.6 }), { lat: 7.486398, lng: 80.362345, accuracy_m: 13 }), 'a fix: 6 decimals, the accuracy in whole metres');
  check(same(positionInput({ ok: true, lat: 7.48, lng: 80.36 }), { lat: 7.48, lng: 80.36 }), 'no accuracy: left out');
  check(positionInput({ ok: false, reason: 'denied' }) === undefined && positionInput(null) === undefined && positionInput({ ok: true, lat: NaN, lng: 80 }) === undefined && positionInput({ ok: true, lat: 95, lng: 80 }) === undefined, 'refused, none or nonsense: no position (the action still saves)');
  check(noPositionWords({ ok: true, lat: 7, lng: 80 }) === null, 'with a position: nothing to say');
  check(noPositionWords({ ok: false, reason: 'denied' })?.key === 'office.webTrip.noPosition.denied' && noPositionWords(null)?.key === 'office.webTrip.noPosition.unavailable', 'without: why, in words');
  check(positionFailure(1) === 'denied' && positionFailure(2) === 'unavailable' && positionFailure(3) === 'timeout' && positionFailure(undefined) === 'unavailable', 'the browser\'s error codes');
}

console.log('\n== The browser asked once (a fake geolocation) ==');
const asked = (async () => {
  let calls = 0;
  const ok = await askOnePosition({ getCurrentPosition: (yes, _no, opts) => { calls += 1; check(opts.timeout === 10_000 && opts.enableHighAccuracy && opts.maximumAge === 30_000, 'asked with a 10 s timeout, high accuracy, a fix up to 30 s old'); yes({ coords: { latitude: 7.1, longitude: 80.2, accuracy: 9 } }); } });
  check(ok.ok && ok.lat === 7.1 && ok.lng === 80.2 && calls === 1, 'one call, one position (getCurrentPosition, never a watch)', ok);
  const no = await askOnePosition({ getCurrentPosition: (_yes, nope) => nope({ code: 1 }) });
  check(!no.ok && no.reason === 'denied', 'refused: denied');
  const none = await askOnePosition(null);
  check(!none.ok && none.reason === 'unsupported', 'no geolocation: unsupported');
  const hung = await askOnePosition({ getCurrentPosition: () => undefined }, 10);
  check(!hung.ok && hung.reason === 'timeout', 'a browser that never answers: the guard ends the wait');
  const thrown = await askOnePosition({ getCurrentPosition: () => { throw new Error('blocked'); } });
  check(!thrown.ok && thrown.reason === 'unavailable', 'a geolocation that throws: unavailable, never a crash');
})();

console.log('\n== One client id per action (a retry never doubles) ==');
{
  let n = 0;
  const make = () => `id-${++n}`;
  check(actionKey('arrive', 's1') === 'arrive:s1' && actionKey('leave', 's1') === 'leave:s1' && actionKey('start') === 'start' && actionKey('finish', 'x') === 'finish', 'one key per start, per stop\'s arrive and leave, per finish');
  const a = clientIdFor({}, 'start', make);
  const b = clientIdFor(a.ids, 'start', make);
  check(a.id === 'id-1' && b.id === 'id-1' && n === 1, 'the same action again (Try again): the same id');
  const c = clientIdFor(b.ids, 'arrive:s1', make);
  check(c.id === 'id-2' && c.ids.start === 'id-1', 'another action: its own id');
  check(idsAfterFailure(c.ids, 'start', { code: 'network' }).start === 'id-1' && idsAfterFailure(c.ids, 'start', { code: 'timeout' }).start === 'id-1' && idsAfterFailure(c.ids, 'start', { code: 'upstream_error' }).start === 'id-1', 'no answer (it may have saved): the id stays for Try again');
  const refused = idsAfterFailure(c.ids, 'start', { code: 'tool_error' });
  check(refused.start === undefined && refused['arrive:s1'] === 'id-2', 'refused (409): the id goes, so the corrected action is a new one');
  check(browserOffline(false) && !browserOffline(true) && !browserOffline(undefined), 'offline only when the browser says so');
  check(OFFLINE.code === 'network' && OFFLINE.write === true, 'offline: the "No connection" error (Try again), nothing queued');
}

console.log('\n== Start: the check, the fuel card, the odometer photo and reading ==');
{
  const w = web({ fuel_card: { asked: true, estimate_text: 'About 180 km · roughly 13–17 L diesel (approx.)' } });
  const f = emptyStart(w);
  check(f.odometer === '45210', 'the vehicle\'s last reading prefilled');
  check(startReason(w, f)?.key === 'office.webTrip.why.check', 'the check first');
  check(startReason(w, { ...f, check: 'problem' })?.key === 'office.myTrip.why.category', 'a problem: what it is');
  check(startReason(w, { ...f, check: 'problem', category: 'tyre' })?.key === 'office.myTrip.why.photo', 'a problem: a photo');
  check(startReason(w, { ...f, check: 'ok' })?.key === 'office.webTrip.why.fuel', 'the fuel card\'s question when it asks');
  check(startReason(w, { ...f, check: 'ok', fuel: 'enough' })?.key === 'office.webTrip.why.odoPhoto', 'the odometer photo');
  check(startReason(w, { ...f, check: 'ok', fuel: 'enough', odoPhoto: 'p1', uploading: 1 })?.key === 'office.myTrip.why.uploading', 'a photo still going up');
  check(startReason(w, { ...f, check: 'ok', fuel: 'enough', odoPhoto: 'p1', odometer: '45100' })?.key === 'office.myTrip.why.underLast', 'never under the last reading');
  const ready = { ...f, check: 'ok' as const, fuel: 'enough' as const, odoPhoto: 'p1', odometer: '45230', sides: [{ photo_id: 'f1', side: 'front' as const }] };
  check(startReason(w, ready) === null, 'ready');
  check(startReason(web({ check_needed: false }), { ...emptyStart(web()), odoPhoto: 'p1' }) === null, 'the switch off: the odometer alone');
  check(same(startInput('t1', 'c1', w, ready, { lat: 7, lng: 80 }), { task_id: 't1', client_id: 'c1', action: 'start', position: { lat: 7, lng: 80 }, odometer_km: 45230, odometer_photo_id: 'p1', check: { result: 'ok', sides: [{ photo_id: 'f1', side: 'front' }] }, fuel_answer: 'enough' }), 'start\'s input (the check, the fuel answer, the photo, the position)');
  const problem = startInput('t1', 'c1', w, { ...ready, check: 'problem', category: 'tyre', note: ' flat ', photos: ['a', 'b'] });
  check(same(problem.check, { result: 'problem', category: 'tyre', note: 'flat', photos: ['a', 'b'] }) && problem.position === undefined, 'a problem\'s check; no position = left out');
  check(startInput('t1', 'c1', web({ check_needed: false }), { ...ready, check: null }).check === undefined && startInput('t1', 'c1', web(), ready).fuel_answer === undefined, 'no check when not needed; no fuel answer when not asked');
  check(same(stopInput('t1', 'c2', 'arrive', 's1'), { task_id: 't1', client_id: 'c2', action: 'arrive', stop_id: 's1' }), 'a stop\'s input');
  const est = fuelEstimateWords('About 180 km · roughly 13–17 L diesel (approx.)');
  check(est && 'key' in est && est.key === 'office.fuel.estimate' && est.vars?.km === '180' && est.vars?.litres === '13–17' && est.fuel === 'office.fuel.word_diesel', 'the fuel card\'s estimate in the person\'s words', est);
  const elec = fuelEstimateWords('About 60 km · check the battery');
  check(elec && 'key' in elec && elec.key === 'office.fuel.estimateElectric', 'electric');
  const other = fuelEstimateWords('Something new');
  check(other && 'text' in other && other.text === 'Something new' && fuelEstimateWords(undefined) === null, 'anything else as it came');
}

console.log('\n== Finish: the odometer, the fuel with its receipt; no video ==');
{
  const f = emptyWebFinish();
  check(webFinishReason(45230, f)?.key === 'office.webTrip.why.odoPhoto', 'the odometer photo first');
  check(webFinishReason(45230, { ...f, odoPhoto: 'p', odometer: '45200' })?.key === 'office.myTrip.why.underStart', 'never under the start');
  check(webFinishReason(45230, { ...f, odoPhoto: 'p', odometer: '45272' }) === null, 'ready without fuel');
  check(webFinishReason(45230, { ...f, odoPhoto: 'p', odometer: '45272', lkr: '5000' })?.key === 'office.webTrip.why.litresFirst', 'an amount needs the litres');
  check(webFinishReason(45230, { ...f, odoPhoto: 'p', odometer: '45272', litres: '0' })?.key === 'office.myTrip.why.litres', 'litres over 0');
  check(webKm(45230, '45272') === 42 && webKm(45230, '45000') === null && webKm(null, '45272') === null, 'the km as typed');
  check(same(webFinishInput('t1', 'c9', { ...f, odoPhoto: 'p', odometer: '45272', litres: '12.5', lkr: '4,500', receipt: 'r' }), { task_id: 't1', client_id: 'c9', action: 'finish', odometer_km: 45272, odometer_photo_id: 'p', fuel: { litres: 12.5, lkr: 4500, receipt_photo_id: 'r' } }), 'finish\'s input with the fuel and its receipt');
  check(webFinishInput('t1', 'c9', { ...f, odoPhoto: 'p', odometer: '45272' }).fuel === undefined, 'no fuel when no litres');
  check(same(doneWords('finish', { km: 1042 }), { key: 'office.webTrip.done.finished', vars: { km: '1,042' } }) && doneWords('finish', {}).key === 'office.webTrip.done.finishedNoKm', 'Trip finished · 1,042 km');
  check(same(doneWords('arrive', { stop: { at: '10:42' } }, 'Kurunegala site'), { key: 'office.webTrip.done.arrived', vars: { place: 'Kurunegala site', time: '10:42' } }), 'Arrived at Kurunegala site · 10:42');
}

console.log('\n== The web trip on the office\'s maps (straight dashed lines, never a GPS line, never km) ==');
const points: WebPoint[] = [
  { at: '2026-10-29T03:10:00Z', time: '08:40', lat: 6.91, lng: 79.86, action: 'arrive', stop: 'Head office' },
  { at: '2026-10-29T02:42:00Z', time: '08:12', lat: 6.90, lng: 79.85, action: 'start' },
  { at: '2026-10-29T03:15:00Z', time: '08:45', lat: 6.91, lng: 79.86, action: 'leave', stop: 'Head office' },
  { at: '2026-10-29T05:42:00Z', time: '11:12', lat: 7.49, lng: 80.36, action: 'arrive', stop: 'Kurunegala site' },
  { at: 'bad', time: '?', lat: NaN, lng: 80, action: 'finish' },
];
{
  check(same(webLinePoints(points), [{ lat: 6.90, lng: 79.85 }, { lat: 6.91, lng: 79.86 }, { lat: 7.49, lng: 80.36 }]), 'one line in time order, a repeated place once, an unusable point left out');
  check(same(webLinePoints([points[0]]), []) && same(webLinePoints(undefined), []), 'one point: no line');
  const lines = webTripLines({ web_points: points });
  check(lines.length === 1 && lines[0].band === 'web' && lines[0].dashed && lines[0].points.length === 3, 'the route views\' line: band web, dashed');
  const day = routeLines({ route: undefined, date: '2026-10-29', estimated: [], web_points: points });
  check(day.length === 1 && day[0].band === 'web', 'routeLines: a web trip\'s day is that line alone (no GPS line)');
  const marks = webMarks(points);
  check(marks.length === 4 && marks[0].action === 'start' && en(marks[0].words.key, marks[0].words.vars) === 'Started · 08:12', 'the marks in time order: Started · 08:12');
  check(en(marks[1].words.key, marks[1].words.vars) === 'Arrived · Head office · 08:40' && en(webMarkWords({ action: 'finish', time: '16:31' }).key, webMarkWords({ action: 'finish', time: '16:31' }).vars) === 'Finished · 16:31', 'Arrived · Head office · 08:40; Finished · 16:31');
  check(si(marks[1].words.key, marks[1].words.vars).includes('Head office') && si(marks[1].words.key, marks[1].words.vars).includes('08:40') && si(marks[1].words.key, marks[1].words.vars) !== en(marks[1].words.key, marks[1].words.vars), 'in Sinhala too (the place and the time in Latin letters and digits)');
  const answer: DriverRoute = { driver: 'nimali', date: '2026-10-29', recorded_points: 0, web_trip: true, web_points: points };
  check(hasWebTrip(answer) && !hasWebTrip({ ...answer, web_points: [] }) && !hasWebTrip(null), 'a web trip with something to draw');
  const d = drawingOf(routeOf('nimali', answer), en);
  check(!!d && d.runs.length === 0 && d.web.length === 1 && d.web[0].points.length === 3 && d.stops.length === 4 && d.ends === null && d.gaps.length === 0, 'Live\'s shown route: no runs, the straight line, the actions as dots', d && { runs: d.runs.length, web: d.web.length, stops: d.stops.length });
  check(drawingOf(routeOf('nimali', { ...answer, web_points: [] }), en) === null, 'nothing to draw: no drawing (as before)');
  const info = mapInfo({ googleMap: false, estimated: false, estimatedGaps: 0, webTrip: true }, en);
  check(info.legend.some((e) => e.key === 'web' && e.mark === 'dashed' && e.text === 'No live route · web trip') && info.notes.some((n) => /straight dashed lines/.test(n)), 'the ⓘ sheet: "No live route · web trip" and why');
  check(!mapInfo({ googleMap: false, estimated: false, estimatedGaps: 0 }, en).legend.some((e) => e.key === 'web'), 'no web line, no legend row');
}

console.log('\n== Live: "Web trip · last seen at …", Self-drive ==');
{
  const card = { driver: 'Nimali', username: 'nimali', state: 'not_sharing', duty: 'on_task', task: 'Site visit', self_drive: true, web_trip: true, last_seen: { at: '10:42', stop: 'Kurunegala site' } } as LiveDriver;
  check(same(webTripSeenWords(card), { key: 'office.selfDrive.webTripAt', vars: { stop: 'Kurunegala site', time: '10:42' } }), 'the words with the stop');
  check(webTripSeenWords({ web_trip: true, last_seen: { at: '10:42' } })?.key === 'office.selfDrive.webTripSeen' && webTripSeenWords({ web_trip: true })?.key === 'office.selfDrive.webTripNone' && webTripSeenWords({}) === null, 'without a stop, without a time; not a web trip: nothing');
  check(rowLine(card, en) === 'Site visit · Web trip · last seen at Kurunegala site 10:42', 'the row\'s line', rowLine(card, en));
  check(rowLine(card, si).includes('Kurunegala site 10:42') || rowLine(card, si).includes('Kurunegala site හි 10:42'), 'the row\'s line in Sinhala', rowLine(card, si));
  check(!/Live/.test(rowLine(card, en)), 'never the Live state');
}

console.log('\n== Self-drive on the task rows and the task page ==');
{
  check(isSelfDriveTrip({ driven_in: 'app' }) && isSelfDriveTrip({ driven_in: 'web' }) && isSelfDriveTrip({ self_drive: true }) && !isSelfDriveTrip({ self_drive: true, driven_in: 'office' }) && !isSelfDriveTrip({ driven_by: 'self' }), 'app or web (or a self-drive trip not started yet): Self-drive; the office path or no app: not');
  check(taskRowLine(en, { driver: 'Nimali', driven_by: 'self', status: 'Drives themselves · no app', self_drive: true, driven_in: 'web' }) === 'Nimali · Self-drive', 'the row: "Nimali · Self-drive", not "Drives themselves · no app"');
  check(taskRowLine(en, { driver: 'Nimali', driven_by: 'self', status: 'Drives themselves · no app' }) === 'Nimali · Drives themselves · no app', 'a trip with no app keeps its words (unchanged)');
  check(taskLineText(en, { status_line: 'Drives themselves · no app', driven_by: 'self', driven_in: 'app' }) === 'Self-drive' && taskLineText(en, { status_line: 'Drives themselves · no app', driven_by: 'self' }) === 'Drives themselves · no app', 'the task page\'s line likewise');
  check(taskRowLine(si, { driver: 'Nimali', driven_by: 'self', status: 'Drives themselves · no app', self_drive: true }) === `Nimali · ${si('office.chip.selfDrive')}`, 'in Sinhala');
}

console.log('\n== Can drive (Users) and Driving mode (Quick settings) ==');
{
  check(canDriveHintKey({ can_drive: true }) === 'office.people.canDriveHintOn' && canDriveHintKey({ can_drive: false }) === 'office.people.canDriveHintOff' && canDriveHintKey({}) === 'office.people.canDriveHintUnset', 'the line under the switch: on, taken away, never decided');
  check(same(canDriveInput('n@fame.lk', true), { email: 'n@fame.lk', can_drive: true }), 'update_office_user with the e-mail and can_drive only');
  const list: OfficeUsers = { count: 2, users: [{ name: 'N', email: 'N@fame.lk', role: 'office', active: true }, { name: 'K', email: 'k@fame.lk', role: 'office', active: true, can_drive: true }] };
  const after = withCanDrive(list, 'n@fame.lk', true);
  check(after.users[0].can_drive === true && after.users[1].can_drive === true && list.users[0].can_drive === undefined, 'the row patched (the e-mail in any case), the list itself untouched');
  check(QUICK_SETTINGS.some((r) => r.key === 'self_drive_mode' && r.kind === 'switch') && switchValue('self_drive_mode', {}, {}) === true, 'Driving mode: a switch, on by default');
}

console.log('\n== The words, in both languages ==');
{
  const keys = [
    'office.webTrip.title', 'office.webTrip.above', 'office.webTrip.offerTitle', 'office.webTrip.offer', 'office.webTrip.offerHint', 'office.webTrip.noTracking', 'office.webTrip.inApp',
    'office.webTrip.closed', 'office.webTrip.doneLine', 'office.webTrip.back', 'office.webTrip.startTitle', 'office.webTrip.startButton', 'office.webTrip.checkTitle', 'office.webTrip.fuelTitle',
    'office.webTrip.fuelEnough', 'office.webTrip.fuelFill', 'office.webTrip.odoTitle', 'office.webTrip.odoPhoto', 'office.webTrip.odoReading', 'office.webTrip.stopOf', 'office.webTrip.nextStop',
    'office.webTrip.atStop', 'office.webTrip.finishTitle', 'office.webTrip.finishButton', 'office.webTrip.finishNow', 'office.webTrip.finishNowHint', 'office.webTrip.fuelAdded',
    'office.webTrip.receipt', 'office.webTrip.noVideo', 'office.webTrip.kmSoFar', 'office.webTrip.startWas', 'office.webTrip.locating',
    'office.webTrip.noPosition.denied', 'office.webTrip.noPosition.unavailable', 'office.webTrip.noPosition.timeout', 'office.webTrip.noPosition.unsupported',
    'office.webTrip.why.check', 'office.webTrip.why.fuel', 'office.webTrip.why.odoPhoto', 'office.webTrip.why.litresFirst',
    'office.webTrip.done.started', 'office.webTrip.done.arrived', 'office.webTrip.done.left', 'office.webTrip.done.finished', 'office.webTrip.done.finishedNoKm',
    'office.webTrip.stop.done', 'office.webTrip.stop.arrived', 'office.webTrip.stop.skipped', 'office.webTrip.stop.next', 'office.webTrip.stop.here',
    'office.selfDrive.webTripAt', 'office.selfDrive.webTripSeen', 'office.selfDrive.webTripNone', 'office.selfDrive.webLine', 'office.selfDrive.webLineNote',
    'office.selfDrive.mark.start', 'office.selfDrive.mark.finish', 'office.selfDrive.mark.arrive', 'office.selfDrive.mark.arriveAt', 'office.selfDrive.mark.leave', 'office.selfDrive.mark.leaveAt',
    'office.people.canDriveTitle', 'office.people.canDrive', 'office.people.canDriveHintOn', 'office.people.canDriveHintOff', 'office.people.canDriveHintUnset', 'office.people.canDriveModeOff',
    'office.settings.selfDriveMode', 'office.settings.selfDriveModeHint',
    // Used again from before: the slides, the Self-drive chip, the fuel card's words.
    'task.slideArrive', 'task.slideLeave', 'office.chip.selfDrive', 'office.fuel.estimate', 'office.fuel.word_diesel',
  ];
  const missing = keys.flatMap((k) => (['en', 'si'] as const).filter((l) => typeof lookup(l, k) !== 'string').map((l) => `${l}:${k}`));
  check(missing.length === 0, `${keys.length} keys in both languages`, missing);
  const latin = keys.filter((k) => typeof lookup('si', k) === 'string' && lookup('si', k) === lookup('en', k));
  check(latin.length === 0, 'every Sinhala text is Sinhala (none the same as the English)', latin);
  const vars = (s: unknown) => (typeof s === 'string' ? (s.match(/\{\w+\}/g) ?? []).sort().join(',') : '');
  const varsDiffer = keys.filter((k) => vars(lookup('en', k)) !== vars(lookup('si', k)));
  check(varsDiffer.length === 0, 'the same {values} in both languages', varsDiffer);
  check(en('office.webTrip.noTracking').includes('Live tracking needs the Fame Fleet app') && en('office.webTrip.noVideo') === 'Fuel video needs the Fame Fleet app.' && en('office.selfDrive.webLine') === 'No live route · web trip', 'the contract\'s sentences, word for word');
  check(en('office.webTrip.inApp') === 'This trip is being driven in the Fame Fleet app.', 'started in the app: the server\'s own sentence');
  const used = (txt: string) => [...txt.matchAll(/t\('((?:office\.(?:webTrip|selfDrive|settings)|office\.people\.canDrive)[\w.]*)'/g)].map((m) => m[1]);
  const files = ['app/office/my-trip/[id]/drive.tsx', 'components/office/WebDriveOffer.tsx', 'components/office/DayRoute.tsx', 'app/office/(tabs)/live.tsx', 'app/office/people/user/[email].tsx', 'app/office/people/settings.tsx'];
  const unknown = files.flatMap((f) => used(read(f)).filter((k) => typeof lookup('en', k) !== 'string' || typeof lookup('si', k) !== 'string').map((k) => `${f}: ${k}`));
  check(unknown.length === 0, 'every key the screens use exists in both languages', unknown);
}

console.log('\n== The screens, wired as the contract says (read as text) ==');
{
  const drive = read('app/office/my-trip/[id]/drive.tsx');
  const page = read('app/office/my-trip/[id].tsx');
  const offer = read('components/office/WebDriveOffer.tsx');
  check(existsSync(join(SRC, 'web-app', 'office', 'my-trip', '[id]', 'drive.tsx')), 'the web build has the drive page\'s route (make-web-routes)');
  check(/Platform\.OS === 'web' && trip && <WebDriveOffer trip=\{trip\} \/>/.test(page) && /Platform\.OS !== 'web'/.test(offer) && /offerWebDrive\(Platform\.OS, trip\.web\)/.test(offer), 'the trip page: one block, web only, when my_trip allows it');
  check(/'web_trip_action'/.test(drive) && /askOnePosition\(\)/.test(drive) && /clientIdFor\(ids\.current/.test(drive) && /idsAfterFailure\(/.test(drive), 'each action: one position, a client id kept for Try again, web_trip_action');
  check(/browserOffline\(browserOnline\(\)\)/.test(drive) && /OFFLINE/.test(drive), 'offline: refused at once with Try again (no queue)');
  check(!/watchPosition|setInterval/.test(code(drive) + code(read('office/webPosition.ts'))), 'no continuous tracking: no watch, no timer');
  check(/office\.webTrip\.noTracking/.test(drive) && /office\.webTrip\.noVideo/.test(drive) && !/MediaRecorder|record-video/.test(code(drive)), '"Live tracking needs the Fame Fleet app"; no video, said so');
  check(/SlideToConfirm[^>]*task\.slideArrive/.test(drive) && /SlideToConfirm tone="dark"[^>]*task\.slideLeave/.test(drive), 'the stops: the driver app\'s Arrived and Done slides');
  check(/up\.add\('odometer'/.test(drive) && /up\.add\('fuel_receipt'/.test(drive) && /up\.add\('vehicle_report'/.test(drive) && /up\.add\('vehicle_check'/.test(drive), 'the photos into the person\'s own folder (odometer, receipt, problem, sides)');
  const users = read('app/office/people/user/[email].tsx');
  check(/'update_office_user', canDriveInput\(email, on\)/.test(users) && /testID="can-drive"/.test(users), 'Users: the Can drive switch (update_office_user can_drive)');
  check(/switchRow\('self_drive_mode'/.test(read('app/office/people/settings.tsx')), 'Quick settings: Driving mode');
  check(/selfDrive=\{isSelfDriveTrip\(task\)\}/.test(read('app/office/task/[id].tsx')) && /taskLineText\(t, task\)/.test(read('app/office/task/[id].tsx')), 'the task page: Self-drive on the driver card and the banner');
  const engines = ['components/DriversMap.web.tsx', 'components/GoogleDriversMap.tsx', 'components/OpenDriversMap.tsx'];
  check(engines.every((f) => /WEB_TRIP_COLOR/.test(read(f)) && /route\?\.web/.test(read(f))), 'Live\'s shown route: the web line on every engine (the web map, Google\'s, the free map)');
  check(/l\.band === 'web'/.test(read('components/RouteMap.tsx')) && /l\.band === 'web'/.test(read('components/RouteMap.web.tsx')), 'the day route\'s maps draw the web band (both engines read BAND_COLORS and dashed)');
  check(/testID="web-trip-line"/.test(read('components/office/DayRoute.tsx')) && /!webTrip && <ListEmpty/.test(read('components/office/DayRoute.tsx')), 'DayRoute: "No live route · web trip" under the map, not "no route"');
}

// ---- The site's twin (apps/office/src/data/webTrip.ts): the same line and the same Self-drive rule ----
{
  const load = createRequire(import.meta.url);
  const twin = join(ROOT, 'apps', 'office', 'src', 'data', 'webTrip.ts');
  if (existsSync(twin)) {
    const site = load(twin) as { webLinePoints: typeof webLinePoints; isSelfDriveTrip: typeof isSelfDriveTrip };
    console.log('\n== The site\'s twin ==');
    check(same(site.webLinePoints(points), webLinePoints(points)), 'the same straight line from the same points');
    const cases = [{ driven_in: 'app' }, { driven_in: 'web' }, { driven_in: 'office', self_drive: true }, { self_drive: true }, {}];
    check(cases.every((c) => site.isSelfDriveTrip(c) === isSelfDriveTrip(c)), 'the same Self-drive rule');
  } else check(false, 'the site\'s twin exists (apps/office/src/data/webTrip.ts)');
}

void asked.then(() => {
  console.log(failures ? `\n${failures} web-trip check(s) FAILED.` : '\nAll web-trip checks passed.');
  process.exit(failures ? 1 : 0);
});
