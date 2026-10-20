// Hotfix O2-H2, Part 2: the notification settings' rules (office/notificationGroups.ts, the same file as the site's) and
// the app's words for them (office/notifLogic.ts, office.notif.* in en.json and si.json). Pure code, no phone:
//
//   npm run test:notif          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyChanges,
  canGet,
  eventId,
  groupsFor,
  groupSummary,
  groupSummaryText,
  NOTIF_GROUPS,
  NOTIF_TEXT,
  notifState,
  notifStateText,
  pauseChanges,
  resumeChanges,
  type ServerEvent,
  undoChanges,
  visibleEvents,
} from '../src/office/notificationGroups';
import { eventText, eventTitle, groupSub, groupSummaryLine, groupTitle, isGroupKey, pauseKey, STATE_KEY } from '../src/office/notifLogic';
import { routeForUrl } from '../src/office/nav';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// The server's EVENTS, read from its source: each event's name and needs, in order.
function serverEvents(): { event: string; needs: string[] }[] {
  const src = read('supabase/functions/_shared/fleet/notifications.ts');
  const block = src.slice(src.indexOf('export const EVENTS'), src.indexOf('];', src.indexOf('export const EVENTS')));
  const out: { event: string; needs: string[] }[] = [];
  const re = /event:\s*"([^"]+)"[\s\S]*?needs:\s*\[([^\]]*)\]/g;
  for (let m = re.exec(block); m; m = re.exec(block)) out.push({ event: m[1], needs: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]) });
  return out;
}

// What my_notification_settings answers for a person: the server's relevantEvents (any one of needs; none = everyone).
function answerFor(permissions: string[], off: string[] = []): ServerEvent[] {
  return serverEvents()
    .filter((e) => e.needs.length === 0 || e.needs.some((p) => permissions.includes(p)))
    .map((e) => ({ event: e.event, label: `Server label ${e.event}`, text: `Server text ${e.event}`, enabled: !off.includes(e.event) }));
}

const ALL = ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'];
const en = JSON.parse(read('apps/driver/src/i18n/en.json'));
const si = JSON.parse(read('apps/driver/src/i18n/si.json'));
const t = (k: string, v?: Record<string, string | number>) => {
  let node: unknown = en;
  for (const part of k.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  let s = typeof node === 'string' ? node : k;
  for (const [n, x] of Object.entries(v ?? {})) s = s.replaceAll(`{${n}}`, String(x));
  return s;
};

console.log('\n== One definition for the app and the site ==');
{
  const app = read('apps/driver/src/office/notificationGroups.ts');
  const site = read('apps/office/src/screens/settings/notificationGroups.ts');
  check(app === site, 'apps/driver/src/office/notificationGroups.ts and apps/office/src/screens/settings/notificationGroups.ts are byte-identical');
}

console.log('\n== The groups against the server ==');
{
  const server = serverEvents();
  check(server.length >= 20, `the server's EVENTS read from its source (${server.length})`);
  const inGroups = NOTIF_GROUPS.flatMap((g) => g.events.map((e) => e.event));
  const dupes = inGroups.filter((e, i) => inGroups.indexOf(e) !== i);
  check(dupes.length === 0, 'every event is in one group only', dupes);
  const missing = server.filter((s) => !inGroups.includes(s.event)).map((s) => s.event);
  check(missing.length === 0, "every event of the server's EVENTS is in a group", missing);
  const extra = inGroups.filter((e) => !server.some((s) => s.event === e));
  check(extra.length === 0, 'no group names an event the server does not have', extra);
  const needs = server.filter((s) => {
    const def = NOTIF_GROUPS.flatMap((g) => g.events).find((e) => e.event === s.event);
    return def && !same([...def.needs].sort(), [...s.needs].sort());
  }).map((s) => s.event);
  check(needs.length === 0, "each event's needs are the server's needs", needs);
  check(same(NOTIF_GROUPS.map((g) => g.key), ['requests', 'tasks', 'drivers', 'issues', 'vehicles', 'mine']), 'the six groups in the asked order');
  const long = NOTIF_GROUPS.flatMap((g) => g.events).filter((e) => e.title.length > 34 || (e.text?.length ?? 0) > 48).map((e) => e.event);
  check(long.length === 0, 'every title fits one line (34 characters) and every description one line (48)', long);
}

console.log('\n== Who sees what ==');
{
  const requester = groupsFor(answerFor(['view', 'request']), ['view', 'request']);
  check(!requester.some((g) => g.key === 'issues'), 'a requester sees no Issues group');
  check(!requester.flatMap((g) => g.events).some((e) => e.event === 'request.created'), 'a requester never sees "New vehicle request" (approve only)');
  check(requester.some((g) => g.key === 'mine' && g.events.some((e) => e.event === 'request.on_the_way')), 'a requester sees My trips with "Driver on the way"');
  check(requester.some((g) => g.key === 'vehicles' && g.total === 3), 'everyone sees Vehicles and bookings (a custodian may be anyone)');

  const viewer = groupsFor(answerFor(['view']), ['view']);
  check(same(viewer.map((g) => g.key), ['vehicles']), 'view alone: only Vehicles and bookings', viewer.map((g) => g.key));

  const approver = groupsFor(answerFor(['view', 'approve']), ['view', 'approve']);
  const req = approver.find((g) => g.key === 'requests');
  check(req?.total === 4, 'an approver sees the four request events', req?.events.map((e) => e.event));
  check(!approver.flatMap((g) => g.events).some((e) => e.event === 'task.stop_skipped'), 'an approver without assign_tasks never sees "Driver skips a stop"');
  check(!approver.some((g) => g.key === 'mine' && g.events.some((e) => e.event === 'request.on_the_way')), 'an approver without request never sees "Driver on the way"');

  const admin = groupsFor(answerFor(ALL), ALL);
  check(admin.reduce((n, g) => n + g.total, 0) === serverEvents().length, 'every permission: every event, once');

  // The server answered an event the person's permissions do not allow (an old answer): not shown.
  const stale = [...answerFor(['request'])].concat([{ event: 'request.created', label: 'x', text: 'y', enabled: true }]);
  check(!visibleEvents(stale, ['request']).some((e) => e.event === 'request.created'), 'an event the permissions do not allow is never shown');
  check(canGet('some.new_event', []), 'an event no group knows: the server decided');
  const other = groupsFor([...answerFor(['request']), { event: 'some.new_event', label: 'Something new', text: 'Its line', enabled: true }], ['request']);
  check(other[other.length - 1]?.key === 'other' && other[other.length - 1].events[0].event === 'some.new_event', 'an unknown event goes to Other, last, never left out');
  check(groupsFor([], ALL).length === 0, 'no events: no groups');
}

console.log('\n== Summaries ==');
{
  check(same(groupSummary(5, 5), { kind: 'all_on' }) && groupSummaryText(5, 5) === 'All on', '5 of 5: All on');
  check(same(groupSummary(0, 5), { kind: 'off' }) && groupSummaryText(0, 5) === 'Off', '0 of 5: Off');
  check(groupSummaryText(4, 5) === '4 of 5 on', '4 of 5: "4 of 5 on"');
  check(groupSummaryLine(t, 4, 5) === '4 of 5 on' && groupSummaryLine(t, 2, 2) === 'All on' && groupSummaryLine(t, 0, 3) === 'Off', "the app's words are the site's");
  const perms = ['request'];
  check(notifState(answerFor(perms), perms) === 'on', 'all on: On');
  check(notifState(answerFor(perms, ['request.arrived']), perms) === 'some_off', 'one off: Some off');
  check(notifState(answerFor(perms).map((e) => ({ ...e, enabled: false })), perms) === 'paused', 'all off: Paused');
  check(notifState([], perms) === 'none', 'nothing for this person: none');
  // A hidden event that is off does not make the shown ones "Some off".
  const hiddenOff = [...answerFor(perms), { event: 'request.created', label: '', text: '', enabled: false }];
  check(notifState(hiddenOff, perms) === 'on', 'a hidden event that is off does not count');
  check(notifStateText('paused') === 'Paused' && t(STATE_KEY.some_off) === 'Some off', 'the state words');
}

console.log('\n== Pause all and Resume ==');
{
  const perms = ['request', 'issues'];
  const before = answerFor(perms, ['request.arrived', 'issue.assigned']);
  const { record, changes } = pauseChanges(before, perms, '2026-10-20T08:00:00.000Z');
  check(Object.values(changes).every((v) => v === false) && !('request.arrived' in changes), 'Pause switches off only the events that are on');
  check(record.saved['request.arrived'] === false && record.saved['request.on_the_way'] === true && record.at === '2026-10-20T08:00:00.000Z', 'the record keeps each shown event as it was');
  check(!('request.created' in record.saved), 'a hidden event is not in the record (it keeps its saved value)');
  const paused = applyChanges(before, changes);
  check(notifState(paused, perms) === 'paused', 'after Pause: Paused');
  const back = resumeChanges(record, paused, perms);
  const resumed = applyChanges(paused, back);
  check(same(resumed.map((e) => e.enabled), before.map((e) => e.enabled)), 'Resume puts every event back as it was');
  check(!('request.arrived' in back), 'Resume names only the events that change');
  const noRecord = applyChanges(paused, resumeChanges(null, paused, perms));
  check(noRecord.every((e) => e.enabled), 'Resume with no record (another phone, the site): everything on');
  const allOffRecord = { at: 'x', saved: Object.fromEntries(before.map((e) => [e.event, false])) };
  check(applyChanges(paused, resumeChanges(allOffRecord, paused, perms)).every((e) => e.enabled), 'a record of all off: Resume turns everything on (never stays paused)');
  const undo = undoChanges(before, { 'request.arrived': true, 'request.on_the_way': false });
  check(Object.keys(undo).length === 2 && undo['request.arrived'] === false && undo['request.on_the_way'] === true, 'a failed save puts back exactly what it changed', undo);
  check(pauseKey({ email: 'A@Fame.lk', name: 'A' }) === 'office.notifPause.a@fame.lk', 'the pause is kept per person on the phone');
}

console.log("\n== The app's words ==");
{
  const missing: string[] = [];
  const differs: string[] = [];
  for (const g of NOTIF_GROUPS) {
    if (en.office.notif.group[g.key]?.title !== g.title) differs.push(`group.${g.key}.title`);
    if ((en.office.notif.group[g.key]?.sub ?? undefined) !== g.sub) differs.push(`group.${g.key}.sub`);
    for (const e of g.events) {
      const k = en.office.notif.ev[eventId(e.event)];
      if (!k) missing.push(e.event);
      else if (k.title !== e.title || k.text !== e.text) differs.push(e.event);
    }
  }
  for (const [k, v] of Object.entries(NOTIF_TEXT)) if (en.office.notif[k] !== v) differs.push(k);
  check(missing.length === 0, 'every event has its en.json words', missing);
  check(differs.length === 0, "en.json's office.notif words are the shared file's words", differs);

  const flat = (o: unknown, p = ''): [string, string][] =>
    Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v] as [string, string]] : flat(v, `${p}${k}.`)));
  const E = flat(en.office.notif);
  const S = new Map(flat(si.office.notif));
  const noSi = E.filter(([k]) => !S.has(k)).map(([k]) => k);
  const sameWords = E.filter(([k, v]) => S.get(k) === v).map(([k]) => k);
  const digits = [...S].filter(([, v]) => /[෦-෯]/.test(v)).map(([k]) => k);
  const vars = E.filter(([k, v]) => !same((v.match(/\{\w+\}/g) ?? []).sort(), (S.get(k)?.match(/\{\w+\}/g) ?? []).sort())).map(([k]) => k);
  const extraSi = [...S.keys()].filter((k) => !E.some(([e]) => e === k));
  check(noSi.length === 0 && extraSi.length === 0, 'en and si carry the same office.notif keys', [...noSi, ...extraSi]);
  check(sameWords.length === 0, 'every Sinhala string differs from the English', sameWords);
  check(digits.length === 0, 'Latin digits only in the Sinhala strings', digits);
  check(vars.length === 0, 'the same {placeholders} in both languages', vars);

  const ev = { event: 'request.arrived', label: 'L', text: 'T', enabled: true };
  check(eventTitle(t, ev) === 'Driver arrived' && eventText(t, ev) === 'At the first pickup', "a known event shows our words, not the server's");
  check(eventText(t, { ...ev, event: 'request.on_the_way' }) === undefined, 'an event without a description shows no second line');
  check(eventTitle(t, { ...ev, event: 'x.y' }) === 'L' && eventText(t, { ...ev, event: 'x.y' }) === 'T', "an unknown event shows the server's words");
  check(groupTitle(t, 'mine') === 'My trips' && groupSub(t, 'mine') === 'Things I asked for' && groupSub(t, 'issues') === undefined, 'group titles and the My trips line');
  check(isGroupKey('requests') && isGroupKey('other') && !isGroupKey('nope') && !isGroupKey(undefined), 'only known groups open a group screen');
  check(routeForUrl('https://fame-fleet.pages.dev/settings/notifications', []) === '/office/notifications' && routeForUrl('/settings/notifications/mine', ['request']) === '/office/notifications/mine', "the site's Notifications links open the app's screens");
  check(routeForUrl('/settings/notifications/sounds', []) === null, "the site's Sounds page has no app screen (the phone's sounds are Android's)");
  check(!('notifications' in en.office.profile) && !('noEvents' in en.office.profile), "the Profile's old notification keys are gone");
}

console.log(failed ? `\n${failed} FAILED` : '\nAll notification settings checks passed.');
process.exit(failed ? 1 : 0);
