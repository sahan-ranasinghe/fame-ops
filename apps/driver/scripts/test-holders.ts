// Round 4–7, feature 7 (Sahan, 22 October 2026): someone else has that driver or vehicle, Office mode and /m/. The rules
// of src/office/holderLogic.ts with made-up holders, asks and timelines; the strings in both languages; and the screens read
// as text: every action each changed screen had before is still there (kept behaviour), the holder parts are wired where
// they belong, and nothing is built for a holder the server did not send (the switch holder_contact off). Pure code:
//   npx tsx scripts/test-holders.ts          (from apps/driver)
// The strings are read from en.json / si.json deep-merged with src/i18n/parts/*.json when that folder exists (the lead
// merges the sidecar into en.json / si.json and removes it; this script works before and after).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionWords, answeredAsk, answeredLabel, askArgs, askChip, askedSnack, askMeta, askSentence, asksEmptyKey, asksFor, asksTab, asksTabs, askTitle, barOf,
  bookingTime, bookingTone, busyWords, byLine, canAnswer, conflictResource, firstName, forgetAnswers, holderAsksRoute, holderOf, holderTitle, hourTicks,
  hhmmOf, inboxRoute, isMe, mayAsk, nowAt, reachOf, rememberAnswer, roleWords, rowLine, timelineOrder, wantedOfWindow, wantedWords, windowWords,
} from '../src/office/holderLogic';
import { moreFor, MORE_SECTION, routeForUrl } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import { setSavedNotice, savedNotice, dismissSavedNotice } from '../src/office/savedNotice';
import { bookOutcome } from '../src/office/trip/formsLogic';
import type { Conflict, DayTimeline, Holder, HolderAsks } from '../src/office/types';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// The strings: en / si, deep-merged with the sidecars while they exist
// ---------------------------------------------------------------------------

type Tree = { [k: string]: string | string[] | Tree };
function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const was = out[k];
    out[k] = was && typeof was === 'object' && !Array.isArray(was) && typeof v === 'object' && !Array.isArray(v) ? merge(was, v) : v;
  }
  return out;
}
const lang: Record<'en' | 'si', Tree> = {
  en: JSON.parse(read('i18n/en.json')) as Tree,
  si: JSON.parse(read('i18n/si.json')) as Tree,
};
const partsDir = join(SRC, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const f of readdirSync(partsDir).filter((x) => x.endsWith('.json'))) {
    const part = JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (part.en) lang.en = merge(lang.en, part.en);
    if (part.si) lang.si = merge(lang.si, part.si);
  }
}
const lookup = (tree: Tree, key: string): unknown => key.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Tree)[k] : undefined), tree);
const tFor = (l: 'en' | 'si') => (key: string, vars?: Record<string, string | number>): string => {
  const found = lookup(lang[l], key) ?? lookup(lang.en, key);
  if (typeof found !== 'string') throw new Error(`No text for "${key}"`);
  let s = found;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};
const t = tFor('en');
const si = tFor('si');

// ---------------------------------------------------------------------------
// Made-up rows
// ---------------------------------------------------------------------------

const TASK = '1b2c3d4e-0000-4000-8000-00000000abcd';
const anoja: Holder = {
  task_id: TASK, employee_id: 'e1', name: 'Anoja Perera', label: 'Fleet admin', by: 'asked', window: '08:00–11:00', from: '08:00', to: '11:00',
  phone: '+94771234567', phone_display: '077 123 4567', call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567',
};
const open: Holder = { ...anoja, by: 'assigned', window: 'from 08:00', from: '08:00', to: undefined, label: 'Staff' };

console.log('== The holder (Google Calendar\'s room booking) ==');
{
  check(holderTitle(anoja, 'Kamal Silva', t) === 'Anoja Perera · Fleet admin' && holderTitle(anoja, 'anoja perera', t) === 'You', 'the name and the role; "You" for the person themselves (by name)');
  check(holderTitle({ name: 'Nimali' }, 'X', t) === 'Nimali' && roleWords('Something new', t) === 'Something new', 'no role: the name alone; an unknown role word as the server sent it');
  check(roleWords('Fleet admin', si) === 'වාහන පරිපාලක' && roleWords('Staff', si) !== 'Staff', 'the role in Sinhala');
  check(windowWords(anoja, t) === '08:00–11:00' && windowWords(open, t) === 'from 08:00' && windowWords(open, si) === '08:00 සිට' && windowWords({ window: 'from 09:15' }, t) === 'from 09:15' && windowWords({}, t) === '', 'the window: from–to, or "from" when the trip has no end (never the server\'s English in Sinhala)');
  check(byLine(anoja, t) === 'Asked for it · 08:00–11:00' && byLine(open, t) === 'Assigned it · from 08:00', 'who it is to them: asked for the trip, or assigned it');
  check(busyWords(anoja, 'Kamal', t) === "Anoja's · 08:00–11:00" && busyWords(anoja, 'Anoja Perera', t) === 'Yours · 08:00–11:00' && busyWords(anoja, 'Kamal', si) === 'Anojaගේ · 08:00–11:00', 'a busy row: "Anoja\'s · 08:00–11:00" (first name), "Yours" for oneself, Sinhala ගේ');
  check(firstName('  Anoja   Perera ') === 'Anoja' && isMe({ name: 'Anoja Perera' }, ' anoja perera ') && !isMe({ name: 'Anoja' }, undefined), 'first names and "is it me"');
  check(conflictResource({ kind: 'driver' }) === 'driver' && conflictResource({ kind: 'vehicle' }) === 'vehicle' && conflictResource({ kind: 'garage' }) === null, 'a garage conflict has nobody to ask');
  check(mayAsk(anoja, ['ask_for_it'], 'Kamal') && !mayAsk(anoja, ['task_board'], 'Kamal') && !mayAsk(anoja, ['ask_for_it'], 'Anoja Perera') && !mayAsk({ name: 'X' }, ['ask_for_it'], 'Kamal'), 'Ask for it only with the tool, never to oneself, only with the trip');
  check(same(reachOf(anoja, 'Kamal'), { call: anoja.call, whatsapp: anoja.whatsapp }) && same(reachOf(anoja, 'Anoja Perera'), {}) && same(reachOf({ name: 'N' }, 'K'), {}), 'Call and WhatsApp for someone else only, and only when the server gave them');
  check(holderOf({ holder: anoja }) === anoja && holderOf({}) === undefined && holderOf(null) === undefined && holderOf({ holder: { name: 'x' } }) === undefined, 'a row\'s holder only when the server sent one (holder_contact off: none)');
}

console.log('\n== Ask for it ==');
{
  check(same(askArgs(TASK, 'vehicle', undefined, ''), { task_id: TASK, resource: 'vehicle' }), 'no window, no note: the busy trip and the vehicle only (the server takes that trip\'s time)');
  check(same(askArgs(TASK, 'driver', { date: '2026-10-24', from: 'Leave 07:30', until: '12:00' }, '  site visit  '), { task_id: TASK, resource: 'driver', date: '2026-10-24', from: '07:30', until: '12:00', note: 'site visit' }), 'the wanted window (the time read out of words) and the trimmed note');
  check(same(askArgs(TASK, 'driver', { from: '07:30' }, ''), { task_id: TASK, resource: 'driver' }) && same(askArgs(TASK, 'driver', { date: '24 Oct', from: '07:30' }, ''), { task_id: TASK, resource: 'driver' }), 'a time without a real day is left out (the tool needs the day with it)');
  check(same(askArgs(TASK, 'driver', { date: '2026-10-24', from: '12:00', until: '09:00' }, ''), { task_id: TASK, resource: 'driver', date: '2026-10-24', from: '12:00' }) && same(askArgs(TASK, 'driver', { date: '2026-10-24', until: '09:00' }, ''), { task_id: TASK, resource: 'driver', date: '2026-10-24' }), 'an end before the start, or an end alone, is left out');
  check((askArgs(TASK, 'driver', undefined, 'x'.repeat(400)).note as string).length === 300, 'the note at most 300 characters (the tool\'s limit)');
  check(hhmmOf('Fri 24 Oct 09:00') === '09:00' && hhmmOf('end of the day') === undefined && hhmmOf('25:00') === undefined, 'a time read from the server\'s words');
  check(same(wantedOfWindow({ day: '2026-10-24', from: 'Fri 24 Oct 09:00', until: '12:00' }), { date: '2026-10-24', from: '09:00', until: '12:00' }) && same(wantedOfWindow({ day: '2026-10-24', from: 'Fri 24 Oct 09:00', until: 'end of the day' }), { date: '2026-10-24', from: '09:00' }) && wantedOfWindow(null) === undefined, 'the window availability answered for (Who\'s available)');
  check(askedSnack({ asked: 'Anoja Perera' }, t) === "Asked Anoja. You'll hear their answer." && askedSnack({ asked: null }, t).startsWith('They have no account') && askedSnack({ asked: 'Anoja' }, si).includes('Anoja'), 'the snackbar in the person\'s language (not the server\'s English next)');
  check(askSentence(anoja, 'vehicle', 'WP CAB-4521', t) === 'Anoja has WP CAB-4521 08:00–11:00.' && askSentence(anoja, 'driver', undefined, t) === 'Anoja has the driver 08:00–11:00.', 'the sheet\'s sentence names what and when');
}

console.log('\n== The notification centre\'s buttons ==');
{
  check(actionWords('Yes', t) === 'Yes' && actionWords('No', si) === 'නැත' && actionWords('yes', si) === 'ඔව්' && actionWords('Later', si) === 'Later', 'Yes / No in the person\'s language; another label as it is');
  forgetAnswers();
  check(answeredLabel(7) === undefined, 'nothing answered yet');
  rememberAnswer(7, 'Yes');
  check(answeredLabel(7) === 'Yes' && answeredLabel(8) === undefined, 'an answer is kept for its item (the buttons stay "You said Yes" while the app runs)');
  rememberAnswer(7, 'No');
  check(answeredLabel(7) === 'No', 'the last answer wins (as on the server)');
  const fa = PRESETS.fleet_admin.permissions;
  const req = PRESETS.requester.permissions;
  check(inboxRoute({ url: `/tasks/${TASK}`, event: 'holder.asked' }, fa) === `/office/task/${TASK}`, 'a holder.asked item opens its task for who may open tasks');
  check(inboxRoute({ url: `/tasks/${TASK}`, event: 'holder.asked' }, req) === '/office/holder-asks?which=to_me' && inboxRoute({ url: `/tasks/${TASK}`, event: 'holder.answered' }, req) === '/office/holder-asks?which=by_me', 'a requester (no tasks) opens the Asks page instead: To me for an ask, By me for an answer');
  check(inboxRoute({ url: '/nowhere', event: 'request.decided' }, req) === null && holderAsksRoute({ event: 'issue.opened' }) === null, 'any other item without a screen: no route, as before');
}

console.log('\n== The Asks page ==');
{
  const ask = (over: Partial<HolderAsks['asks'][number]>): HolderAsks['asks'][number] => ({ id: 'a1', task_id: TASK, trip: 'Team drop', resource: 'vehicle', what: 'WP CAB-4521', wanted: 'Fri 24 Oct 09:00–12:00', asked_by: 'Kamal', holder: 'Anoja', asked_at: 'Thu 23 Oct 10:00', ...over });
  check(same(asksTabs(PRESETS.fleet_admin.permissions), ['to_me', 'by_me', 'all']) && same(asksTabs(PRESETS.dispatcher.permissions), ['to_me', 'by_me']) && same(asksTabs(PRESETS.requester.permissions), ['to_me', 'by_me']), 'To me · By me, and All only for the people who approve (the tool refuses All to anyone else)');
  check(asksTab('all', PRESETS.dispatcher.permissions) === 'to_me' && asksTab('by_me', PRESETS.dispatcher.permissions) === 'by_me' && asksTab(undefined, PRESETS.fleet_admin.permissions) === 'to_me', 'a link\'s tab when the person has it, else To me');
  check(askTitle(ask({}), t) === 'WP CAB-4521 · Team drop' && askTitle(ask({ what: undefined, resource: 'driver', trip: undefined }), t) === 'the driver', 'the title: what, on which trip');
  const when = (s: string) => `[${s}]`;
  check(askMeta(ask({ note: 'site visit' }), 'to_me', t, when) === '[Fri 24 Oct 09:00]–12:00 · asked by Kamal · “site visit”', 'To me: when (the day in words), who asked, the note');
  check(askMeta(ask({}), 'by_me', t) === 'Fri 24 Oct 09:00–12:00 · held by Anoja' && askMeta(ask({}), 'all', t) === 'Fri 24 Oct 09:00–12:00 · asked by Kamal · held by Anoja', 'By me: who holds it; All: both');
  check(wantedWords('Fri 24 Oct 22:00–Sat 25 Oct 01:00', when) === '[Fri 24 Oct 22:00]–[Sat 25 Oct 01:00]' && wantedWords('', when) === '', 'a window across midnight says both days');
  check(same(askChip({ answer: 'yes' }, t), { text: 'Yes', tone: 'green' }) && same(askChip({ answer: 'no' }, t), { text: 'No', tone: 'red' }) && same(askChip({}, t), { text: 'Waiting', tone: 'amber' }), 'the answer chip: Yes green, No red, Waiting amber');
  check(canAnswer({}, 'to_me') && !canAnswer({ answer: 'no' }, 'to_me') && !canAnswer({}, 'by_me') && !canAnswer({}, 'all'), 'Yes / No only on an ask to the person not answered yet');
  const list: HolderAsks = { which: 'to_me', count: 2, asks: [ask({}), ask({ id: 'a2', task_id: 'other' })] };
  check(asksFor(list.asks, TASK).length === 1 && asksFor(list.asks, undefined).length === 2, 'a task page\'s link shows that trip\'s asks only');
  check(answeredAsk(list, 'a1', 'yes').asks[0].answer === 'yes' && answeredAsk(list, 'a1', 'yes').asks[1].answer === undefined, 'an answer given here shows at once on its row only');
  check(asksEmptyKey('to_me') !== asksEmptyKey('by_me') && t(asksEmptyKey('all')).length > 0, 'each tab says what its empty list means');
}

console.log('\n== The day\'s timeline (Google Calendar\'s resource view) ==');
{
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const b1 = barOf('08:00', '11:00')!;
  check(near(b1.left, 2 / 16) && near(b1.width, 3 / 16) && !b1.cutLeft && !b1.cutRight, '08:00–11:00 on 06:00–22:00');
  const b2 = barOf('05:00', '07:00')!;
  check(near(b2.left, 0) && near(b2.width, 1 / 16) && b2.cutLeft, 'a booking from before 06:00 starts at the edge');
  const b3 = barOf('21:00', '01:00')!;
  check(near(b3.left, 15 / 16) && near(b3.width, 1 / 16) && b3.cutRight, 'one past midnight runs to the edge');
  const b4 = barOf('09:00', undefined)!;
  check(near(b4.width, 1 / 16), 'no end: an hour long');
  check(barOf('23:00', undefined) === null && barOf('04:00', '05:30') === null && barOf('nine', '10:00') === null, 'wholly outside the day, or unreadable: no bar');
  check(barOf('10:00', '10:00')!.width > 0, 'a zero-length booking still shows (to the edge)');
  const ticks = hourTicks();
  check(ticks.length === 9 && ticks[0].label === '06:00' && ticks[8].label === '22:00' && near(ticks[4].at, 0.5), 'the hour marks every 2 h, 06:00 to 22:00');
  check(near(nowAt('14:00')!, 0.5) && nowAt('23:10') === null, 'now on today\'s track');
  check(bookingTone('in_progress') === 'blue' && bookingTone('completed') === 'muted' && bookingTone('assigned') === 'amber', 'under way blue, done grey, to come amber');
  check(bookingTime({ from: '08:00', to: '11:00' }, t) === '08:00–11:00' && bookingTime({ from: '08:00' }, si) === '08:00 සිට', 'the booking\'s time');
  const row = (over: Partial<DayTimeline['rows'][number]>): DayTimeline['rows'][number] => ({ id: 'r', name: 'Kamal', bookings: [], ...over });
  const bk = (from: string) => ({ task_id: from, title: 'T', from, status: 'assigned' });
  check(rowLine(row({}), t) === 'Free all day' && rowLine(row({ bookings: [bk('08:00')] }), t) === '1 trip' && rowLine(row({ bookings: [bk('08:00'), bk('13:00')], not_available: [{ from: '15:00', to: '18:00' }] }), t) === '2 trips · Not available 15:00–18:00' && rowLine(row({ in_garage: true }), t) === 'In garage', 'a row\'s line: trips, not available, free all day, in garage');
  const order = timelineOrder([row({ id: 'free' }), row({ id: 'late', bookings: [bk('13:00')] }), row({ id: 'early', bookings: [bk('07:00')] })]).map((r) => r.id);
  check(same(order, ['early', 'late', 'free']), 'the busy rows first, by their first booking; the free ones after, as the server gave them');
}

console.log('\n== Navigation: More, the site\'s links ==');
{
  check(moreFor(PRESETS.fleet_admin.permissions).includes('timeline') && moreFor(PRESETS.fleet_admin.permissions).includes('holder_asks'), 'a fleet admin finds Timeline and Asks under More');
  check(moreFor(PRESETS.viewer.permissions).includes('timeline') && !moreFor(PRESETS.viewer.permissions).includes('holder_asks'), 'a viewer: the Timeline (view), no Asks (they neither ask nor hold a trip)');
  check(moreFor(PRESETS.requester.permissions).includes('holder_asks'), 'a requester holds trips: Asks');
  check(!moreFor([]).includes('timeline') && !moreFor([]).includes('holder_asks'), 'no permissions: neither');
  check(MORE_SECTION.timeline === 'work' && MORE_SECTION.holder_asks === 'work', 'both under Work');
  check(routeForUrl('/schedule', ['view']) === '/office/timeline' && routeForUrl('/schedule?date=2026-10-24&kind=vehicles', ['view']) === '/office/timeline' && routeForUrl('/schedule', []) === null, 'the site\'s /schedule opens the Timeline (view)');
  check(routeForUrl('/tasks/asks', ['request']) === '/office/holder-asks' && routeForUrl(`/tasks/asks?task=${TASK}`, ['assign_tasks']) === '/office/holder-asks', 'the site\'s /tasks/asks opens Asks (never read as a task\'s ?task=)');
  check(routeForUrl(`/tasks/${TASK}`, ['assign_tasks']) === `/office/task/${TASK}` && routeForUrl(`/tasks?task=${TASK}`, ['assign_tasks']) === `/office/task/${TASK}`, 'the task links as before');
}

console.log('\n== A save\'s conflicts on the screen landed on ==');
{
  const withHolder: Conflict = { kind: 'vehicle', text: 'WP CAB-4521 is on task Team drop 08:00–11:00 for Anoja', task: { id: TASK, title: 'Team drop', window: '08:00–11:00' }, holder: anoja };
  const plain: Conflict = { kind: 'driver', text: 'Kamal is on task Site visit 09:00–10:00', task: { id: 'x', title: 'Site visit', window: '09:00–10:00' } };
  const garage: Conflict = { kind: 'garage', text: 'WP KL-1 is in the garage', holder: anoja };
  setSavedNotice('task:t1', ['Over the km allowance', withHolder.text, plain.text], undefined, [withHolder, plain, garage]);
  const n = savedNotice('task:t1');
  check(!!n && same(n.lines, ['Over the km allowance', plain.text]) && n.conflicts?.length === 1 && n.conflicts[0] === withHolder, 'a conflict with its holder is a card (its sentence not repeated); one without (holder_contact off) or the garage stays a line');
  setSavedNotice('task:t2', [], undefined, [withHolder]);
  check(savedNotice('task:t2')?.conflicts?.length === 1 && savedNotice('task:t2')?.lines.length === 0, 'a notice with only a holder card is still shown');
  setSavedNotice('task:t3', ['A warning']);
  check(same(savedNotice('task:t3'), { lines: ['A warning'] }), 'without conflicts the notice is as before');
  setSavedNotice('task:t4', [], 'Title', []);
  check(savedNotice('task:t4') === null, 'nothing to say: no notice, as before');
  dismissSavedNotice('task:t1');
  check(savedNotice('task:t1') === null, 'OK puts it away, as before');
  check(bookOutcome({ task_id: 't', conflicts: [withHolder] }).conflicts.length === 1 && bookOutcome({ task_id: 't' }).conflicts.length === 0, 'Book now\'s conflicts (book_vehicle answers them now) reach the notice like Assign\'s');
}

console.log('\n== The screens as text: the holder parts, and every action kept ==');
{
  const parts = read('components/office/HolderParts.tsx');
  check(/reach\.call \?/.test(parts) && /reach\.whatsapp \?/.test(parts) && /office\.holders\.askForIt/.test(parts) && /<AskForItSheet/.test(parts), 'HolderLine: Call, WhatsApp and Ask for it');
  check(/api\.call<AskedForIt>\('ask_for_it', askArgs\(holder\.task_id, resource, wanted, note\)\)/.test(parts) && /showSnackbar\(\{ text: askedSnack\(out, t\) \}\)/.test(parts) && /<ErrorNotice error=\{problem\} onRetry=\{\(\) => void send\(\)\}/.test(parts) && /<Sheet/.test(parts) && /<Field/.test(parts) && /maxLength=\{300\}/.test(parts), 'the sheet: the shared Sheet and Field, ask_for_it, the snackbar, an error in words with Try again (never sent again by itself)');
  check(/if \(busy\) return;/.test(parts) && /busy=\{busy\}/.test(parts), 'Send shows its own spinner and cannot be pressed twice');
  check(/await api\.call\(a\.tool, a\.args\)/.test(parts) && /onRead\(item\)/.test(parts) && /rememberAnswer\(item\.id, a\.label\)/.test(parts) && /office\.holders\.youSaid/.test(parts) && /<ErrorNotice error=\{state\.error\} onRetry=\{\(\) => void press\(state\.last\)\}/.test(parts) && /if \(!a \|\| state\.busy\) return;/.test(parts), 'InboxActions: the tool with its args as they are, the item read, "You said Yes", a failed answer with Try again (the same press), never twice at once');
  check(/if \(!actions\.length\) return null;/.test(parts), 'no actions (holder_contact off, any other item): no buttons');
  check(/c\.holder && resource \? <HolderLine/.test(parts) && /office\.trip\.openThatTask/.test(parts), 'ConflictCard: its sentence, the holder only when sent, Open that task');

  const review = read('app/office/trip/review.tsx');
  check(/office\.trip\.openThatTask/.test(review) && /reach\(c\.requester\)/.test(review) && /reach\(c\.driver\)/.test(review) && /office\.trip\.callName/.test(review) && /office\.trip\.whatsappName/.test(review) && /office\.trip\.pickAnotherDriver/.test(review) && /office\.trip\.pickAnotherVehicle/.test(review), 'Review\'s conflict card keeps Open that task, Call / WhatsApp the requester and the driver, Pick another driver / vehicle');
  check(/c\.holder && conflictResource\(c\) \? <HolderLine holder=\{c\.holder\}/.test(review) && /wanted=\{tripWanted\(\)\}/.test(review), 'Review\'s conflict card adds the holder (only when sent) with Ask for it for this trip\'s day and times');
  check(/setSavedNotice\(s\.noticeKey, notice, undefined, o\.conflicts\)/.test(review), 'Review: the save\'s conflicts wait on the screen landed on, with their holders');

  const alerts = read('app/office/(tabs)/alerts.tsx');
  check(/onPress=\{\(\) => open\(item\)\}/.test(alerts) && /routeForUrl\(item\.url, me\.permissions\)/.test(alerts) && /api\.call\('mark_inbox_read', \{ ids: \[item\.id\] \}\)/.test(alerts) && /api\.call\('mark_inbox_read', \{ all: true \}\)/.test(alerts) && /office\.alerts\.markAllRead/.test(alerts) && /<LoadMore/.test(alerts) && /<FilterBar/.test(alerts) && /office\.alerts\.open/.test(alerts), 'Alerts keeps: open (its screen), mark read (one, put back if refused), Mark all read, the search and Filter, Load more, the Open pill');
  check(/item\.actions\?\.length \? <InboxActions item=\{item\} onRead=\{markItemRead\} \/> : null/.test(alerts) && /markItemRead\(item\);\s*\n\s*if \(route\) router\.push/.test(alerts), 'Alerts adds the item\'s buttons; open and answer share the same mark-read');

  const rows = read('components/office/DriverRows.tsx');
  check(/onPress=\{\(\) => onPick\(x\)\}/.test(rows) && /office\.ask\.open/.test(rows) && /<ListFailed/.test(rows) && /<SkeletonRows/.test(rows) && /<ListEmpty/.test(rows), 'Who\'s available keeps picking a driver, Ask drivers, the skeleton, error and empty states');
  check(/holder && !x\.free && holder\.task_id !== ignoreTask \? <HolderStrip/.test(rows), 'Who\'s available: a busy driver\'s holder under the row (outside the pick row; never the task being changed)');
  const groups = read('components/office/VehicleGroups.tsx');
  check(/<ChoiceRow selected=\{selected\} onPress=\{onPick\}/.test(groups) && /v\.call \?/.test(groups) && /v\.whatsapp \?/.test(groups) && /office\.trip\.assignedTo/.test(groups) && /disabledReason=\{reason\}/.test(groups), 'the vehicle groups keep picking, the custodian\'s Call / WhatsApp, "Assigned to", the garage greyed with its reason');
  check(/holder && holder\.task_id !== ignoreTask \? <HolderStrip holder=\{holder\} resource="vehicle"/.test(groups), 'the vehicle groups: a busy vehicle\'s holder under its row');

  const give = read('app/office/task/[id]/driver.tsx');
  check(/'reassign_task'/.test(give) && /'cancel_task'/.test(give) && /<AskDriversSheet/.test(give) && /give-move-time/.test(give) && /onPress=\{\(\) => setPicked\(d\.username \?\? ''\)\}/.test(give), 'Give it a driver keeps Give to, Cancel task, Ask drivers, Move the time, picking a driver');
  check(/setSavedNotice\(`task:\$\{task\.id\}`, \[\.\.\.\(out\.warnings \?\? \[\]\), \.\.\.\(out\.conflicts \?\? \[\]\)\.map\(\(c\) => c\.text\)\], undefined, out\.conflicts\)/.test(give) && /holder\.task_id !== task\.id \? <HolderStrip/.test(give), 'Give it a driver: reassign_task\'s conflicts wait on the task with their holders; a busy driver\'s holder under the row');

  const change = read('app/office/task/[id]/time.tsx');
  check(/'update_task'/.test(change) && /<DriverRows/.test(change) && /<AskDriversSheet/.test(change) && /office\.trip\.choose/.test(change) && /<MoreDetails/.test(change), 'Change the task keeps update_task, Who\'s available, Ask drivers, the vehicle choice, More details');
  check(/ignoreTask=\{task\.id\}/.test(change) && /setSavedNotice\(`task:\$\{id\}`, \[\.\.\.warnings, \.\.\.\(conflicts \?\? \[\]\)\.map\(\(c\) => c\.text\)\], undefined, conflicts\)/.test(change) && /vehicleHolder\(v\)/.test(change), 'Change the task: update_task\'s conflicts wait on the task; the busy rows\' holders (never this task\'s own)');

  const approve = read('app/office/request/[id].tsx');
  check(/decide\('approve'|void decide\('approve'\)|decide\(\s*'approve'/.test(approve) && /office\.decide\.changeTime/.test(approve) && /<VehicleGroups/.test(approve) && /<DriverChoiceRow/.test(approve) && /<TellRequester/.test(approve) && /cancel-booking/.test(approve), 'Approve keeps deciding, Change time, the vehicle groups, Who\'s available, Tell requester, Cancel booking');
  check(/setSavedNotice\(`request:\$\{id\}`, warnings, undefined, \(out as DecideResult\)\.conflicts\)/.test(approve) && /<ConflictCard key=/.test(approve) && /approve-holder-/.test(approve), 'Approve: the proposal\'s conflicts as cards with their holders; the decision\'s conflicts wait with theirs; busy drivers\' holders');

  const notice = read('components/office/SavedNotice.tsx');
  check(/dismissSavedNotice\(noticeKey\)/.test(notice) && /notice\.lines\.map/.test(notice) && /notice\.conflicts\?\.map\(\(c, i\) => <ConflictCard/.test(notice), 'the saved notice keeps its lines and OK, and adds the holder cards');

  const task = read('app/office/task/[id].tsx');
  check(/<TaskAsksLink taskId=\{task\.id\} \/>/.test(task) && /<SavedNotice noticeKey=\{`task:\$\{id\}`\} \/>/.test(task), 'the task page: the save\'s notice as before, and "Asks about this trip" when there are any');

  const asks = read('app/office/holder-asks.tsx');
  check(/useTool<HolderAsks>\('holder_asks', \{ which \}/.test(asks) && /api\.call\('answer_holder_ask', \{ ask_id: id, answer: value \}\)/.test(asks) && /<SkeletonRows/.test(asks) && /<ListFailed/.test(asks) && /<ListEmpty/.test(asks) && /onRefresh=/.test(asks) && /<Segmented/.test(asks), 'Asks: holder_asks per tab, Yes / No through answer_holder_ask, skeleton, error with Try again, empty, pull to refresh');
  check(/if \(answering\?\.busy\) return;/.test(asks) && /<ErrorNotice error=\{mine\.error\} onRetry=\{\(\) => void answer\(a\.id, mine\.answer\)\}/.test(asks) && /onPress=\{opensTasks \?/.test(asks), 'Asks: one answer at a time; a failed one with Try again; a row opens its trip for who may open tasks');
  const tl = read('app/office/timeline.tsx');
  check(/useTool<DayTimeline>\('day_timeline', \{ date, kind \}/.test(tl) && /<DayStrip value=\{date\} onChange=\{setDate\}/.test(tl) && !/max=/.test(tl.split('<DayStrip')[1].split('/>')[0]) && /<Segmented<Kind>/.test(tl) && /q\.data\.date === date && q\.data\.kind === kind/.test(tl), 'Timeline: day_timeline by day and kind, the week strip (days ahead too), Drivers | Vehicles, never another day\'s rows');
  // Review of Round 4–7: the holder also only with the switch holder_contact on (office/switches.ts), the Asks link too.
  check(/x\.holder && holders \? \(/.test(tl) && /const holders = useSwitch\('holder_contact'\);/.test(tl) && /const mayAsks = holders && /.test(tl), 'Timeline: no holder and no Asks link while holder_contact is off');
  check(/x\.holder && holders \? \(/.test(tl) && /onOpen \? \(/.test(tl) && /<SkeletonRows/.test(tl) && /<ListFailed/.test(tl) && /<ListEmpty/.test(tl), 'Timeline: the holder only when sent, a booking opens its task for who may, the list states');
  const more = read('app/office/(tabs)/more.tsx');
  check(/timeline: \{ icon: Calendar, label: 'office\.holders\.timelineTitle', path: '\/office\/timeline' \}/.test(more) && /holder_asks: \{ icon: User, label: 'office\.holders\.asksTitle', path: '\/office\/holder-asks' \}/.test(more) && /me\.tools\.includes\('day_timeline'\)/.test(more) && /me\.tools\.includes\('holder_asks'\)/.test(more), 'More: Timeline and Asks, each only with its tool');
  check(existsSync(join(SRC, 'web-app', 'office', 'timeline.tsx')) && existsSync(join(SRC, 'web-app', 'office', 'holder-asks.tsx')), '/m/ has both screens (npm run web:routes)');
}

console.log('\n== The strings in both languages ==');
{
  // Every office.holders key named by the screens and the rules, plus the role keys and the tab / status keys built at run time.
  const files = ['office/holderLogic.ts', 'components/office/HolderParts.tsx', 'app/office/holder-asks.tsx', 'app/office/timeline.tsx', 'app/office/(tabs)/more.tsx'];
  const named = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/'(office\.[a-zA-Z]+\.[a-zA-Z_]+)'/g)) named.add(m[1]);
  for (const r of ['admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer']) named.add(`office.holders.role_${r}`);
  for (const s of ['assigned', 'in_progress', 'completed']) named.add(`office.holders.st_${s}`);
  const missing = [...named].filter((k) => typeof lookup(lang.en, k) !== 'string' || typeof lookup(lang.si, k) !== 'string');
  check(named.size > 50 && missing.length === 0, `every key the screens name has text in both (${named.size})`, missing);
  const en = lookup(lang.en, 'office.holders') as Record<string, string>;
  const sin = lookup(lang.si, 'office.holders') as Record<string, string>;
  const onlyOne = [...Object.keys(en).filter((k) => !(k in sin)), ...Object.keys(sin).filter((k) => !(k in en))];
  check(onlyOne.length === 0, 'the same keys in en and si', onlyOne);
  const vars = Object.keys(en).filter((k) => !same((en[k].match(/\{\w+\}/g) ?? []).sort(), (sin[k]?.match(/\{\w+\}/g) ?? []).sort()));
  check(vars.length === 0, 'the same {placeholders} in both', vars);
  const untranslated = Object.keys(en).filter((k) => en[k] === sin[k]);
  check(untranslated.length === 0, 'every Sinhala string is Sinhala', untranslated);
  const digits = Object.keys(sin).filter((k) => /[෦-෯]/.test(sin[k]));
  check(digits.length === 0, 'Latin digits only (times and numbers)', digits);
}

console.log('\nA push tap');
{
  const layout = read('app/_layout.tsx');
  const notif = read('lib/notifications.ts');
  check(/event: typeof data\?\.event === 'string'/.test(notif), 'a push carries its event to the tap (tapData)');
  check(layout.includes("routeForUrl(data.url, officeMe.permissions) ?? holderAsksRoute({ event: data.event ?? '' })"),
    'a holder.* push the person cannot open as a task opens the Asks page, as the same item in Alerts does');
  check(holderAsksRoute({ event: 'holder.asked' }) === '/office/holder-asks?which=to_me' && holderAsksRoute({ event: 'task.declined' }) === null,
    'an ask opens To me; any other event is left to its link');
}

console.log(failed ? `\n${failed} FAILED` : '\nAll holder checks passed.');
process.exit(failed ? 1 : 0);
