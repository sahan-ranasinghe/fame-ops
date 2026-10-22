// Stage 1 (O3 row 6): Issues' kind / vehicle / opened filters and Maintenance (office/issuesLogic.ts additions,
// office/maintenanceLogic.ts, the screens).
//
//   npm run test:maintenance          (from apps/driver)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { issuesArgs, issuesExtra, issuesExtraDefs, ISSUE_KINDS, kindsFor, TASK_ISSUE_KINDS } from '../src/office/issuesLogic';
import { appendReports, canTakeOffRoad, categoryKey, reportSaveCalls, reportsArgs, reportsChoice, reportsFilterDefs, reportTone } from '../src/office/maintenanceLogic';
import type { VehicleCard, VehicleReports } from '../src/office/types';
import { careCards, careCounts, docsOf, docWords, isDue, readService, serviceOf, serviceWords, summaryChips } from '../src/office/vehicleCareLogic';
// The website's twin, read at run time (its types import the site's own aliases, which this project does not resolve).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const site = require('../../office/src/screens/vehicleCareLogic') as { careCards: typeof careCards };

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


console.log('\nRound 4–7, item 8: Maintenance as service and documents per vehicle (Fleetio)');
{
  const TODAY = '2026-10-22';
  const van = (over: Partial<VehicleCard> = {}): VehicleCard => ({
    reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', next_service: 'In 1,120 km or 2 Nov', service_state: 'due soon',
    documents: { lic: { chip: 'ok', expiry: '2027-03-01', days_left: 130 }, ins: { chip: 'orange', expiry: '2026-11-10', days_left: 19 }, emi: { chip: 'not set' } },
    documents_missing: ['emission'], ...over,
  });
  check(same(readService('In 1,120 km or 2 Nov', TODAY), { km: 1120, date: '2026-11-02' }) && same(readService('320 km over', TODAY), { km: -320 }) && same(readService('Not set', TODAY), {}), "the server's service words read back");
  const svc = serviceOf({ next_service: 'In 1,120 km or 2 Nov', service_state: 'due soon' }, TODAY);
  check(svc.state === 'due_soon' && svc.days === 11 && svc.fill > 0.8 && svc.fill < 1 && serviceOf({ next_service: '320 km over', service_state: 'overdue' }, TODAY).fill === 1, 'the bar fills towards the service, full when overdue');
  check(same(docsOf(van(), TODAY).map((d) => [d.kind, d.state]), [['revenue_licence', 'ok'], ['insurance', 'expiring'], ['emission', 'missing']]), 'the documents: ok / expiring / missing (and expired)');
  const fleet = [van({ reg_no: 'A-OK', next_service: 'In 9,000 km', service_state: 'ok', documents: { lic: { expiry: '2027-05-01', days_left: 190 } }, documents_missing: [] }), van({ reg_no: 'B-SOON' }), van({ reg_no: 'C-OVER', next_service: '320 km over', service_state: 'overdue' }), van({ reg_no: 'D', active: false })];
  const cards = careCards(fleet, TODAY);
  check(same(cards.map((c) => c.reg_no), ['C-OVER', 'B-SOON', 'A-OK']), 'one card per active vehicle, the most urgent first');
  check(same(JSON.stringify(site.careCards(fleet as never, TODAY)), JSON.stringify(cards)), "the app's rules give the website's answer (screens/vehicleCareLogic.ts)");
  check(isDue(cards[1]) && !isDue(cards[2]), 'due for the reminders: the service soon, a document missing');
  const tr = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ''}`;
  check(summaryChips(careCounts(cards), tr).map((c) => c.key).join() === 'overdue,soon,expiring,missing', 'the summary as chips (only what is there)');
  check(docWords({ kind: 'insurance', state: 'expiring', days: 19 }, tr, (d) => d) === 'office.care.expiresIn{"name":"office.care.doc.insurance","n":19}' && serviceWords(svc, tr, (d) => `<${d}>`) === 'office.care.serviceOr{"a":"office.care.serviceIn{\\"km\\":\\"1,120\\"}","b":"<2026-11-02>"}',
    "the words as keys (km in Latin digits, the day in words)");

  const list = src('app/office/maintenance/index.tsx');
  check(list.includes('<CareSummary') && list.includes('<CareCard') && list.includes("pathname: '/office/vehicles/[reg]'") && list.includes("t('office.care.show.all')") && list.includes('testID="maintenance-issues"'),
    'Maintenance: the summary, a card per vehicle to the vehicle, All vehicles, the line to Issues');
  check(list.includes("params.view === 'reports'") && list.includes("me.tools.includes('list_vehicle_reports')") && (list.match(/<Segmented/g) ?? []).length >= 2 && list.includes('<LoadMore shown={cardsShown}'),
    'the problem reports are the second view (with their tool; the Issues header opens them); the cards 25 at a time');
  const card = src('components/office/VehicleCare.tsx');
  check(card.includes("accessibilityRole=\"progressbar\"") && card.includes('accessibilityValue={{ min: 0, max: 100, now }}') && card.includes("t('office.care.openVehicle'"), 'the bar says how near the service is to the screen reader; a card names its vehicle');
  const rem = src('app/office/reminders.tsx');
  check(rem.includes('remindersByVehicle(') && rem.includes('<CareCard') && rem.includes('testID="reminders-issues"') && rem.includes('row(r, i, true)'), 'Reminders: one card per vehicle (its rows without the plate again), the line to Issues');

  const dir = join(__dirname, '..', 'src', 'i18n');
  const words = { en: JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')), si: JSON.parse(readFileSync(join(dir, 'si.json'), 'utf8')) };
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) merge((a[k] ??= {}) as Record<string, unknown>, v as Record<string, unknown>);
      else a[k] = v;
    }
  };
  if (existsSync(join(dir, 'parts'))) for (const f of readdirSync(join(dir, 'parts')).filter((n) => n.endsWith('.json'))) {
    const part = JSON.parse(readFileSync(join(dir, 'parts', f), 'utf8'));
    merge(words.en, part.en ?? {});
    merge(words.si, part.si ?? {});
  }
  const lookup = (o: unknown, k: string) => k.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), o);
  const asked = [...(list + card + rem + src('office/vehicleCareLogic.ts')).matchAll(/t\(\s*'(office\.(?:care|reminders)\.[A-Za-z_.]+)'/g)].map((m) => m[1]);
  const dyn = ['revenue_licence', 'insurance', 'emission', 'registration', 'lease', 'other', 'rental'].map((k) => `office.care.doc.${k}`).concat(['attention', 'all'].flatMap((k) => [`office.care.title.${k}`, `office.care.empty.${k}`]));
  const all = [...new Set([...asked, ...dyn])];
  check(asked.length > 15 && all.every((k) => typeof lookup(words.en, k) === 'string' && typeof lookup(words.si, k) === 'string'), 'every office.care / reminders word in English and Sinhala', all.filter((k) => typeof lookup(words.si, k) !== 'string'));
}

console.log(failures === 0 ? '\nAll maintenance checks passed.' : `\n${failures} maintenance check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
