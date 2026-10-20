// Stage 1 (O3 row 6): Issues' kind / vehicle / opened filters and Maintenance (office/issuesLogic.ts additions,
// office/maintenanceLogic.ts, the screens).
//
//   npm run test:maintenance          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { issuesArgs, issuesExtra, issuesExtraDefs, ISSUE_KINDS, kindsFor, TASK_ISSUE_KINDS } from '../src/office/issuesLogic';
import { appendReports, canTakeOffRoad, categoryKey, reportSaveCalls, reportsArgs, reportsChoice, reportsFilterDefs, reportTone } from '../src/office/maintenanceLogic';
import type { VehicleReports } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const tr = (k: string) => k;

console.log('\nIssues: the kind, the vehicle, when opened');
{
  const server = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', '_shared', 'fleet', 'issues.ts'), 'utf8');
  const kindsBlock = /export const KIND_TEXT[\s\S]*?\n\};/.exec(server)?.[0] ?? '';
  const serverKinds = [...kindsBlock.matchAll(/^\s+([a-z_]+): "/gm)].map((m) => m[1]);
  check(serverKinds.length > 20 && same([...serverKinds].sort(), [...ISSUE_KINDS].sort()), "the kinds are the server's (KIND_TEXT)", serverKinds.filter((k) => !(ISSUE_KINDS as readonly string[]).includes(k)));
  const taskBlock = /export const TASK_KINDS = new Set\(\[([\s\S]*?)\]\)/.exec(server)?.[1] ?? '';
  const serverTask = [...taskBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  check(same([...serverTask].sort(), [...TASK_ISSUE_KINDS].sort()), "assign_tasks alone reads the server's task kinds", serverTask);
  check(kindsFor(['issues']).length === ISSUE_KINDS.length && kindsFor(['assign_tasks']).length === TASK_ISSUE_KINDS.length && kindsFor(['view']).length === 0, 'the kinds by permission');
  const defs = issuesExtraDefs(TASK_ISSUE_KINDS, ['WP CAB-1'], tr);
  check(defs.map((d) => d.key).join() === 'kind,vehicle,opened' && defs.every((d) => d.kind === 'single'), 'kind, vehicle and opened in the same Filter sheet');
  check(issuesExtraDefs([], [], tr).map((d) => d.key).join() === 'opened', 'no kind or vehicle section with nothing to pick');
  const range = (p: string) => ({ from: `from-${p}`, to: `to-${p}` });
  check(same(issuesExtra({ kind: 'late_start', vehicle: 'WP CAB-1', opened: 'last7' }, range as never), { kind: 'late_start', vehicle: 'WP CAB-1', from: 'from-last7', to: 'to-last7' })
    && same(issuesExtra({ kind: 'all', vehicle: 'all', opened: 'any' }, range as never), {}) && same(issuesExtra({ kind: 'drop' }, range as never), {}), 'only what is chosen (an unknown kind is ignored)');
  const args = issuesArgs('active', '', undefined, undefined, { kind: 'km_gap', from: '2026-10-01', to: '2026-10-20' });
  check(args.kind === 'km_gap' && args.from === '2026-10-01' && args.to === '2026-10-20' && !('vehicle' in args), "list_issues' own kind / vehicle / from / to");
  const screen = src('app/office/issues/index.tsx');
  check(screen.includes('issuesExtraDefs(kinds, plateList, t)') && (screen.match(/sortPick \?\? undefined, extra\)/g) ?? []).length === 2 && screen.includes('testID="issues-maintenance"'),
    'the Issues screen: the extra filters on every page, the link to Maintenance with its tool');
}

console.log('\nMaintenance');
{
  const defs = reportsFilterDefs(tr);
  check(defs[0].default === 'not_closed' && defs[0].options.length === 5 && reportsChoice({ status: 'closed' }) === 'closed' && reportsChoice({ status: 'x' }) === 'not_closed', 'one Filter: Not closed by default');
  check(same(reportsArgs('open', ' tyre '), { status: 'open', limit: 25, search: 'tyre' }) && same(reportsArgs('all', '', 'c'), { status: 'all', limit: 25, cursor: 'c' }), 'list_vehicle_reports: status, search, 25 a page');
  const a = { status: 'all', count: 1, reports: [{ id: '1' }], next: 'n' } as unknown as VehicleReports;
  check(appendReports(a, { status: 'all', count: 2, reports: [{ id: '1' }, { id: '2' }] } as unknown as VehicleReports).reports.length === 2, 'Load more: never a report twice');
  const r = { id: 'r1', vehicle: 'WP CAB-1', vehicle_in_garage: false, status: 'open' as const };
  check(reportSaveCalls(r, { status: 'open', note: ' ', offRoad: false }, []).length === 0, 'nothing changed: nothing sent (Save waits with its reason)');
  check(same(reportSaveCalls(r, { status: 'in_garage', note: ' Garage tomorrow ', offRoad: true }, ['update_vehicle']), [
    { tool: 'update_vehicle_report', input: { id: 'r1', status: 'in_garage', office_note: 'Garage tomorrow' } },
    { tool: 'update_vehicle', input: { reg_no: 'WP CAB-1', in_garage: true } },
  ]), 'the report, then the vehicle off the road');
  check(reportSaveCalls(r, { status: 'open', note: '', offRoad: true }, []).length === 0 && !canTakeOffRoad(r, []) && !canTakeOffRoad({ ...r, vehicle_in_garage: true }, ['update_vehicle']) && canTakeOffRoad(r, ['update_vehicle']),
    'off the road only with update_vehicle, for a vehicle not in the garage');
  check(reportTone('open') === 'red' && reportTone('in_garage') === 'amber' && categoryKey('tyre') === 'office.maint.cat_tyre' && categoryKey('weird') === 'office.maint.cat_other', 'tones and the category words');
  const list = src('app/office/maintenance/index.tsx');
  const page = src('app/office/maintenance/[id].tsx');
  check(list.includes('<FilterBar') && list.includes('<LoadMore') && list.includes("pathname: '/office/maintenance/[id]'"), 'the list: search, the filter, Load more, a row to its report');
  check(page.includes("for (const c of calls) await api.call(c.tool, c.input);") && page.includes('disabled={calls.length === 0}') && page.includes("has(me.permissions, 'assign_tasks')") && page.includes('testID="report-photo"'),
    'the report: photos, Open task by permission, Call, Save sticky with its reason');
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  check(Object.keys(en.office.maint).every((k) => typeof si.office.maint[k] === 'string'), 'office.maint in both languages');
  const asked = [...(list + page).matchAll(/office\.maint\.([a-zA-Z_]+)/g)].map((m) => m[1]).filter((k) => !k.endsWith('_'));
  check(asked.every((k) => k in en.office.maint), 'every key asked for exists', asked.filter((k) => !(k in en.office.maint)));
  check(['not_closed', 'open', 'in_garage', 'closed', 'all'].every((k) => `filter_${k}` in si.office.maint && `none_${k}` in si.office.maint), 'every filter has its words and its empty state');
  check(['filterKind', 'filterVehicle', 'filterOpened', 'openedAny'].every((k) => k in si.office.issues) && ['this_month', 'last_month', 'last7', 'today'].every((k) => `preset_${k}` in en.patterns), "the Issues filter words; the presets' words exist");
}

console.log('\nStage 1 review');
{
  const list = src('app/office/maintenance/index.tsx');
  const page = src('app/office/maintenance/[id].tsx');
  check(list.includes('handReport(r);') && page.includes('handedReport(id)') && page.includes('reportPageArgs(handed?.vehicle)'), "the list hands its row to the page; the page reads that vehicle's reports (never lost past the newest 200)");
}

console.log(failures === 0 ? '\nAll maintenance checks passed.' : `\n${failures} maintenance check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
