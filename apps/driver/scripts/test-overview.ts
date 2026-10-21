// Stage 1 (O3 row 5): the Overview's lists on the phone (office/overviewLogic.ts, Home, Reminders, Vehicles' ?filter=).
//
//   npm run test:overview          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { attentionCount, attentionGroups, chipTarget, levelTone, reminderGroups, snoozeCalls, vehicleFilterParam, withoutGroups } from '../src/office/overviewLogic';
import { PRESETS } from '../src/office/permissions';
import type { Attention, AttentionGroup, Overview } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

console.log('\nThe chips open their lists');
{
  const all = { permissions: ['view', 'approve', 'assign_tasks', 'vehicles', 'issues'], tools: ['list_vehicles', 'list_requests', 'fleet_overview'] };
  check(chipTarget('road', all) === '/office/(tabs)/live' && chipTarget('free', all) === '/office/vehicles?filter=available' && chipTarget('garage', all) === '/office/vehicles?filter=in_garage'
    && chipTarget('waiting', all) === '/office/(tabs)/approve?status=waiting' && chipTarget('reminders', all) === '/office/reminders', 'each chip to its list (the waiting count to the waiting ones)');
  check(chipTarget('waiting', { permissions: ['view'], tools: ['list_requests'] }) === null && chipTarget('free', { permissions: ['view'], tools: [] }) === null
    && chipTarget('reminders', { permissions: ['view'], tools: ['fleet_overview'] }) === null, 'a chip stays a number for someone who may not open its list');
  for (const [name, p] of Object.entries(PRESETS)) {
    const me = { permissions: p.permissions, tools: ['list_vehicles', 'list_requests', 'fleet_overview'] };
    const opens = (['road', 'free', 'waiting', 'garage', 'reminders'] as const).filter((c) => chipTarget(c, me));
    check(opens.length >= 1, `${name}: ${opens.join(', ') || 'none'}`);
  }
  check(vehicleFilterParam('free') === 'available' && vehicleFilterParam('garage') === 'in_garage' && vehicleFilterParam('in_garage') === 'in_garage' && vehicleFilterParam('x') === 'all' && vehicleFilterParam(undefined) === 'all',
    "Vehicles' ?filter=: its own keys and the website's words");
}

console.log('\nReminders');
{
  const items: Attention[] = [
    { what: 'Insurance expires', subject: 'WP CAB-4521 · Toyota HiAce', kind: 'document', due: '24 Oct', level: 'red', issue_id: 'i1' },
    { what: 'Service due', vehicle: 'NB-1234', subject: 'in 300 km', kind: 'service_due', level: 'orange', issue_id: 'i2' },
    { what: 'Odometer typed by hand', subject: 'Kamal', kind: 'odometer_flag', issue_id: 'i3' },
    { what: 'Licence expires', subject: 'Nimal', kind: 'licence', issue_id: 'i4' },
  ];
  const g = reminderGroups(items);
  check(g.due.map((r) => r.key).join() === 'i1,i2,i4' && g.other.map((r) => r.key).join() === 'i3', 'documents, services and licences first; the rest apart');
  check(same(g.due[0].to, { pathname: '/office/vehicles/[reg]', params: { reg: 'WP CAB-4521' } }) && g.due[0].plate === 'WP CAB-4521' && g.due[0].subject === 'Toyota HiAce', "a vehicle's row to its vehicle (the plate out of the subject)");
  check(same(g.due[1].to, { pathname: '/office/vehicles/[reg]', params: { reg: 'NB-1234' } }) && same(g.due[2].to, { pathname: '/office/issues/[id]', params: { id: 'i4' } }), 'the server\'s plate; a licence to its issue');
  check(levelTone('red') === 'red' && levelTone('orange') === 'amber' && levelTone(undefined) === 'muted', 'the due date\'s tone');
}

console.log('\nNeeds attention');
{
  const group = (key: string, ids: string[]): AttentionGroup => ({ key, kind: 'odometer_flag', title: key, count: ids.length, severity: 'warning', issue_ids: ids, items: ids.map((id) => ({ what: id, issue_id: id })) });
  const ov = { attention: { count: 3, groups: [group('a', ['1', '2']), group('b', ['3'])] } } as Pick<Overview, 'attention' | 'critical'>;
  check(attentionGroups(ov).length === 2 && attentionCount(ov) === 3, "the server's groups and count");
  const old = { critical: { count: 1, items: [{ what: 'Breakdown', issue_id: 'x', kind: 'vehicle_report' }] } } as Pick<Overview, 'attention' | 'critical'>;
  check(attentionGroups(old)[0].issue_ids[0] === 'x' && attentionCount(old) === 1, 'an older answer: each critical item a group');
  check(same(snoozeCalls({ issue_ids: ['1', '2', '1'] }, 'week'), [{ id: '1', snooze: 'week' }, { id: '2', snooze: 'week' }]), 'Snooze: every issue behind the group, once each');
  const after = withoutGroups(ov as Pick<Overview, 'attention'>, ['a']);
  check(after.attention?.groups.length === 1 && after.attention?.count === 1, 'a snoozed group leaves the list at once');
}

console.log('\nThe screens');
{
  const home = src('app/office/(tabs)/index.tsx');
  check((home.match(/onPress: go\('/g) ?? []).length === 3 && /onPress=\{go\('reminders'\)\}/.test(home) && home.includes('<StatTiles'), 'the three header tiles and the reminders row open through chipTarget');
  check(home.includes("for (const call of snoozeCalls(group, when)) await api.call('update_issue', call);") && home.includes('withoutGroups(prev, [group.key])') && home.includes('testID="attention-snooze"') && home.includes("me.tools.includes('update_issue')"),
    'Snooze on a group, with update_issue only');
  check(home.includes('attentionGroups(ov).slice(0, ROWS)') && home.includes("pathname: '/office/issues/[id]'"), 'the groups expand; each item opens its issue');
  const rem = src('app/office/reminders.tsx');
  check(rem.includes("useTool<Overview>('fleet_overview'") && rem.includes('reminderGroups(q.data.needs_attention)') && rem.includes('router.push(r.to as never)'), 'Reminders from fleet_overview, each row to its place');
  check(src('app/office/vehicles/index.tsx').includes('vehicleFilterParam(params.filter)'), "Vehicles opens on the chip's filter");
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  check(Object.keys(en.office.reminders).every((k) => typeof si.office.reminders[k] === 'string'), 'office.reminders in both languages');
  const homeKeys = ['reminders', 'attention', 'noAttention', 'attentionN', 'sev_critical', 'sev_warning', 'snooze', 'snoozeTitle', 'snooze_tomorrow', 'snooze_week'];
  check(homeKeys.every((k) => typeof en.office.home[k] === 'string' && typeof si.office.home[k] === 'string'), 'the new Home words in both languages');
}

console.log('\nStage 1 review');
{
  const home = src('app/office/(tabs)/index.tsx');
  check(home.includes("api.call('update_issue', { id, snooze: null })") && /showSnackbar\(\{ text: t\('office\.home\.snoozedLine'[\s\S]*?label: t\('office\.decide\.undo'\)/.test(home) && !home.includes('snooze-undo-line'), 'Snooze has Undo in the snackbar (update_issue snooze null on the same issues), no inline line');
}

console.log(failures === 0 ? '\nAll overview checks passed.' : `\n${failures} overview check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
