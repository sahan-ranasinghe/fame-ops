// Office mode (Phase 8, O2, item 7): the management screens under More, no phone: the Vehicles list's input and pages,
// the vehicle form's input (only filled-in fields; the refusals), the reports' days and inputs, the mileage view, the
// fuel and duty words, More's rows by permission, and the screens read as text (each tool behind its button, every key
// in both languages, no role names).
//
//   npm run test:manage          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendDuty, appendFuel, appendVehicles, clockOf, clockOut, companyInput, docTone, dutyArgs, emptyVehicle, filterCounts, heldLine, hoursText, isDate, kmLine, megabytes, mileageView, mondayOf,
  monthOf, outsideKm, rangeArgs, rangeDates, reportSections, rowCells, vehicleFormDirty, vehicleInput, vehiclesArgs, vehicleTone, videoChip, videoLine, wholeMonth,
} from '../src/office/manageLogic';
import { MORE_SECTION, moreFor } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import type { DutyLog, FuelList, MileageSummary, VehiclesList } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

console.log('\nVehicles: the list');
{
  check(same(vehiclesArgs('all', ''), { filter: 'all', limit: 25 }) && same(vehiclesArgs('in_garage', ' cab ', 'c2'), { filter: 'in_garage', search: 'cab', limit: 25, cursor: 'c2' }), 'list_vehicles: the filter, the search trimmed, the page');
  check(same(filterCounts({ all: 6, on_task: 2, available: 3, in_garage: 1, documents_expiring: 2 }), { all: 6, on_task: 2, available: 3, in_garage: 1, documents_expiring: 2, inactive: undefined }) && same(filterCounts(undefined), {}), 'the chips\' counts (none for Returned)');
  const list: VehiclesList = { filter: 'all', counts: { all: 3, on_task: 0, available: 3, in_garage: 0, documents_expiring: 0 }, vehicles: [{ reg_no: 'A' }, { reg_no: 'B' }], next: 'c1', total: 3 };
  const grown = appendVehicles(list, { ...list, vehicles: [{ reg_no: 'B' }, { reg_no: 'C' }], next: undefined });
  check(grown.vehicles.map((v) => v.reg_no).join('') === 'ABC' && !('next' in grown), 'the next page appended, never a plate twice, the cursor gone at the end');
  check(vehicleTone({ status: 'On a task' }) === 'blue' && vehicleTone({ status: 'In garage' }) === 'amber' && vehicleTone({ status: 'Available' }) === 'green' && vehicleTone({ status: 'Available', active: false }) === 'muted', 'the status tones');
  check(docTone('red') === 'red' && docTone('expired 3 days ago') === 'red' && docTone('orange') === 'amber' && docTone('soon') === 'amber' && docTone(undefined) === 'muted' && docTone('ok') === 'green', 'the document chip tones');
  check(same(kmLine({ km_this_month: 2100, km_allowance: 2000 }), { used: 2100, allow: 2000, over: true }) && same(kmLine({ km_this_month: 10 }), { used: 10, allow: 0, over: false }), 'km this month against the allowance');
}

console.log('\nVehicles: the form');
{
  const f = emptyVehicle();
  check(!vehicleFormDirty(f) && vehicleFormDirty({ ...f, model: 'x' }), 'the leave guard knows a typed field');
  const r0 = vehicleInput(f, null);
  check('error' in r0 && r0.error === 'plate', 'a new vehicle needs its plate');
  const r1 = vehicleInput({ ...f, reg: ' wp cab-4521 ', model: 'Toyota HiAce', type: 'van', seats: '14', allow: '2,000', rent: '150000', company: 'Nimal Rentals', until: '2027-03-31', driver: 'kamal', lic: '2027-01-15' }, null);
  check('input' in r1 && r1.tool === 'register_vehicle' && same(r1.input, { reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', vehicle_type: 'van', seats: 14, monthly_km_allowance: 2000, monthly_rent_lkr: 150000, rental_company: 'Nimal Rentals', rent_until: '2027-03-31', regular_driver: 'kamal', licence_expiry: '2027-01-15' }), 'register_vehicle: the plate upper-case, numbers as numbers, only the fields filled', r1);
  const r2 = vehicleInput(f, 'WP CAB-4521');
  check('error' in r2 && r2.error === 'nothing', 'an update with nothing filled is refused');
  const r3 = vehicleInput({ ...f, ingarage: 'true', active: 'false', custodian: 'none', custodianNote: 'NONE' }, 'WP CAB-4521');
  check('input' in r3 && r3.tool === 'update_vehicle' && same(r3.input, { reg_no: 'WP CAB-4521', in_garage: true, active: false, custodian: null, custodian_note: null }), 'update_vehicle: the switches and "none" clears the custodian', r3);
  const r4 = vehicleInput({ ...f, seats: 'ten' }, 'WP CAB-4521');
  check('error' in r4 && r4.error === 'number' && r4.field === 'seats', 'a number field refuses words');
  const r5 = vehicleInput({ ...f, ins: '15/01/2027' }, 'WP CAB-4521');
  check('error' in r5 && r5.error === 'date' && r5.field === 'ins', 'a date must be YYYY-MM-DD');
  check(isDate('2027-02-28') && !isDate('2027-2-28') && !isDate('2027-13-01'), 'the date rule');
  check(same(companyInput(' Nimal Rentals ', ' 0112 345 678 '), { name: 'Nimal Rentals', phone: '0112 345 678' }) && companyInput('  ', '1') === null && same(companyInput('X', ''), { name: 'X' }), 'add_rental_company: the name needed, the phone when given');
}

console.log('\nReports: the days');
{
  check(mondayOf('2026-10-19') === '2026-10-19' && mondayOf('2026-10-25') === '2026-10-19' && mondayOf('2026-10-18') === '2026-10-12', 'the Monday of the week');
  check(same(monthOf('2026-10-19'), { from: '2026-10-01', to: '2026-10-31' }) && same(monthOf('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' }) && same(monthOf('2026-12-05'), { from: '2026-12-01', to: '2026-12-31' }), 'the month\'s first and last day (February, December)');
  check(same(rangeDates('today', '2026-10-19'), { from: '2026-10-19', to: '2026-10-19' }) && same(rangeDates('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-21' }) && same(rangeDates('month', '2026-10-19'), { from: '2026-10-01', to: '2026-10-19' }) && same(rangeDates('last_month', '2026-10-19'), { from: '2026-09-01', to: '2026-09-30' }), 'today, this week, this month, last month');
  check(same(rangeDates('last_month', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' }), 'last month across the year');
  check(wholeMonth('2026-09-01', '2026-09-30') === '2026-09' && wholeMonth('2026-10-01', '2026-10-19') === undefined, 'a whole calendar month is asked as month');
  check(same(rangeArgs('2026-09-01', '2026-09-30'), { month: '2026-09' }) && same(rangeArgs('2026-10-01', '2026-10-19', { limit: 25 }), { from: '2026-10-01', to: '2026-10-19', limit: 25 }), 'mileage_summary / list_fuel input');
  check(same(dutyArgs('2026-10-19', '2026-10-19'), { date: '2026-10-19' }) && same(dutyArgs('2026-10-12', '2026-10-19', { cursor: 'x' }), { from: '2026-10-12', to: '2026-10-19', cursor: 'x' }), 'duty_log input: one day as date, a range as from/to');
}

console.log('\nReports: mileage, fuel, duty');
{
  const totals = { tasks: 12, task_km: 840, fuel_litres: 310, fuel_lkr: 120500, unlogged_km_flags: 1, check_odometer: 2, between_tasks_km: 20, overnight_km: 15 };
  const month: MileageSummary = { month: '2026-10', totals, vehicles: [{ vehicle: 'WP CAB-4521', task_km: 500, odometer_km: 540, km_allowance: 2000, over_allowance: undefined }], biggest_gaps: [], unlogged_km: [], check_odometer: [] };
  const v1 = mileageView(month);
  check(same(v1.days, { month: '2026-10' }) && v1.month === undefined && v1.vehicles.length === 1, 'a whole month: its own rows, no allowance block');
  const range: MileageSummary = { ...month, range: { from: '2026-10-12', to: '2026-10-18', totals: { ...totals, tasks: 3 }, vehicles: [{ vehicle: 'WP CAB-4521', task_km: 120 }], biggest_gaps: [], unlogged_km: [], check_odometer: [] } };
  const v2 = mileageView(range);
  check(same(v2.days, { from: '2026-10-12', to: '2026-10-18' }) && v2.totals.tasks === 3 && v2.month?.month === '2026-10' && same(v2.month?.rows, [{ vehicle: 'WP CAB-4521', task_km: 500, odometer_km: 540, km_allowance: 2000 }]), 'a shorter range: its rows, and the month with the allowance columns beside it', v2.month);
  check(outsideKm(totals) === 35, 'km outside tasks = between tasks + overnight');
  const cells = rowCells({ task_km: 500, vehicle: 'WP CAB-4521', task_id: 'x', photo: 'http://…', over_allowance: true, note: '', ratio: 1.25 });
  check(same(cells, [{ key: 'vehicle', value: 'WP CAB-4521' }, { key: 'task_km', value: '500' }, { key: 'over_allowance', value: 'yes' }, { key: 'ratio', value: '1.3' }]), 'a row\'s cells: the vehicle first, ids and links and empties left out, numbers formatted', cells);
  check(megabytes(16 * 1024 * 1024) === '16 MB' && megabytes(1.5 * 1024 * 1024) === '1.5 MB' && clockOf(47) === '0:47' && clockOf(312) === '5:12', 'sizes and lengths');
  check(same(videoChip({ status: 'uploaded' }), { key: 'uploaded', tone: 'green' }) && same(videoChip({ status: 'uploaded', interrupted: true }), { key: 'interrupted', tone: 'green' }) && videoChip({ status: 'uploading' }).tone === 'amber' && videoChip({ status: 'none' }).tone === 'red' && videoChip({ status: 'pruned' }).tone === 'muted', 'the video chip by state');
  check(videoLine({ status: 'uploaded', duration_s: 47, bytes: 16 * 1024 * 1024 }) === '0:47 · 16 MB' && videoLine({ status: 'recorded' }) === '', 'the line under an uploaded video');
  const fuel: FuelList = { month: '2026-10', totals: { entries: 2, litres: 60, lkr: 24000, videos: 2, videos_waiting: 0, videos_missing: 0, bytes: 0 }, entries: [{ id: 'a', at: '09:00', litres: 30, lkr: 12000, video: { status: 'uploaded' } }], next: 'n' } as FuelList;
  const f2 = appendFuel(fuel, { ...fuel, entries: [{ id: 'a', at: '09:00', litres: 30, lkr: 12000, video: { status: 'uploaded' } }, { id: 'b', at: '10:00', litres: 30, lkr: 12000, video: { status: 'none' } }] as FuelList['entries'], next: undefined });
  check(f2.entries.map((e) => e.id).join('') === 'ab' && !('next' in f2), 'the next page of fills appended');
  check(same(clockOut({ clock_out: 'on duty' }), { onDuty: true }) && same(clockOut({ clock_out: '17:40', out_how: 'driver' }), { onDuty: false, time: '17:40', how: 'driver' }) && same(clockOut({ clock_out: '21:00', out_how: 'auto at the cut-off' }), { onDuty: false, time: '21:00', how: 'auto' }), 'the clock-out cell');
  check(heldLine({ vehicle: 'WP CAB-4521 · Toyota HiAce', from: '08:12', to: '12:40', how: 'clock_in', by: 'Kamal' }, 'now') === 'WP CAB-4521 08:12–12:40' && heldLine({ vehicle: 'WP CAB-4521', from: '08:12', how: 'clock_in', by: 'Kamal' }, 'now') === 'WP CAB-4521 08:12–now', 'a vehicle held in the period');
  check(hoursText(7.46) === '7.5 h' && hoursText(8) === '8 h', 'hours');
  const duty: DutyLog = { from: '2026-10-19', to: '2026-10-19', periods: [{ username: 'kamal', day: '2026-10-19', clock_in: '08:00', clock_out: 'on duty', hours: 2, vehicles: [], tasks: [], task_km: 0 }], totals: { periods: 1, hours: 2, task_km: 0 }, next: 'n' };
  const d2 = appendDuty(duty, { ...duty, periods: [...duty.periods, { username: 'nuwan', day: '2026-10-19', clock_in: '07:00', clock_out: '12:00', hours: 5, vehicles: [], tasks: [], task_km: 10 }], next: undefined });
  check(d2.periods.length === 2 && !('next' in d2), 'the next page of duty periods appended, never a period twice');
  check(same(reportSections(['mileage_summary', 'duty_log']), ['mileage', 'duty']) && same(reportSections([]), []), 'the report sections by tool');
}

console.log('\nMore: the rows by permission');
{
  const fa = moreFor(PRESETS.fleet_admin.permissions);
  const di = moreFor(PRESETS.dispatcher.permissions);
  const re = moreFor(PRESETS.requester.permissions);
  const vi = moreFor(PRESETS.viewer.permissions);
  const admin = moreFor(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']);
  check(fa.includes('vehicles') && re.includes('vehicles') && vi.includes('vehicles') && !moreFor([]).includes('vehicles'), 'Vehicles with view (the list and the page are read; Register / Edit by their tools)');
  check(di.includes('reports') && !re.includes('reports') && !vi.includes('reports'), 'Reports with assign_tasks (the duty log) or vehicles, never for a requester or a viewer');
  check(admin.includes('people_drivers') && admin.includes('people_users') && admin.includes('settings') && !di.includes('people_users') && !di.includes('settings') && !re.includes('people_drivers'), 'People and Quick settings with users (drivers also with vehicles)');
  check(moreFor(['vehicles']).includes('people_drivers') && !moreFor(['vehicles']).includes('people_users'), 'vehicles alone: the drivers\' management (decision 1), not the office users');
  check(MORE_SECTION.vehicles === 'work' && MORE_SECTION.reports === 'work' && MORE_SECTION.people_drivers === 'people' && MORE_SECTION.people_users === 'people' && MORE_SECTION.settings === 'settings', 'the sections of design 19');
  check(moreFor([]).every((k) => ['alerts'].includes(k)), 'no permissions: only Alerts');
}

console.log('\nThe screens as text');
{
  const list = read('app/office/vehicles/index.tsx');
  const page = read('app/office/vehicles/[reg].tsx');
  const form = read('app/office/vehicles/form.tsx');
  const reports = read('app/office/reports/index.tsx');
  const more = read('app/office/(tabs)/more.tsx');
  check(list.includes("me.tools.includes('register_vehicle') &&") && list.includes("useTool<VehiclesList>('list_vehicles', vehiclesArgs(filter, search)") && list.includes('appendVehicles(p, page)'), 'the list: list_vehicles with the filter and the search, Register only with its tool, Load more');
  check(page.includes("const canEdit = me.tools.includes('update_vehicle');") && page.includes("me.tools.includes('vehicle_documents')") && page.includes("'list_vehicles', { filter, search: reg, limit: 25 }"), 'the page: Edit only with update_vehicle, the files only with vehicle_documents, found by search');
  check(form.includes('vehicleInput(f, plate)') && form.includes('await api.call<{ registered?: { reg_no?: string } }>(v.tool, v.input)') && form.includes("me.tools.includes('add_rental_company') &&") && form.includes("api.call('add_rental_company', input)") && form.includes('useLeaveGuard('), 'the form: register_vehicle / update_vehicle by the rule, the rental company only with its tool, the leave guard');
  check(reports.includes("useTool<MileageSummary>('mileage_summary', rangeArgs(from, to))") && reports.includes("useTool<FuelList>('list_fuel', rangeArgs(from, to, { limit: 25 }))") && reports.includes("useTool<DutyLog>('duty_log', dutyArgs(from, to, { limit: 25 }))") && reports.includes('reportSections(me.tools)'), 'Reports: the three tools, each section by its tool');
  check(!reports.includes('update_') && !reports.includes('register_') && !reports.includes('set_'), 'Reports is read-only');
  check(more.includes('MORE_SECTION[key] === s.key') && more.includes("path: '/office/vehicles'") && more.includes("path: '/office/reports'") && more.includes("path: '/office/people/drivers'") && more.includes("path: '/office/people/users'") && more.includes("path: '/office/people/settings'"), 'More: the rows by section and their routes');
  const roleWord = /'(admin|fleet_admin|office|viewer|staff)'/;
  check(![list, page, form, reports, more].some((s) => roleWord.test(s)), 'no role names in the screens');
}

console.log('\nStrings in both languages');
{
  type Tree = { [k: string]: string | Tree };
  const en = JSON.parse(read('i18n/en.json')) as { office: Tree };
  const si = JSON.parse(read('i18n/si.json')) as { office: Tree };
  const get = (tree: Tree, path: string): string | undefined => {
    let cur: string | Tree | undefined = tree;
    for (const k of path.split('.')) {
      if (!cur || typeof cur === 'string') return undefined;
      cur = cur[k];
    }
    return typeof cur === 'string' ? cur : undefined;
  };
  const code = [read('app/office/vehicles/index.tsx'), read('app/office/vehicles/[reg].tsx'), read('app/office/vehicles/form.tsx'), read('app/office/reports/index.tsx'), read('app/office/(tabs)/more.tsx')].join('\n');
  const keys = Array.from(new Set(Array.from(code.matchAll(/'office\.(vehicles|reports|more)\.([A-Za-z_]+)'/g)).map((m) => `${m[1]}.${m[2]}`)));
  const missing = keys.filter((k) => get(en.office, k) === undefined || get(si.office, k) === undefined);
  check(keys.length > 60 && missing.length === 0, `every office.vehicles / reports / more key the screens name exists in en and si (${keys.length})`, missing);
  // The families built at run time: the filters, the types, the form's fields, the ranges, the sections, the video states, the clock-out words.
  const families = [
    ...['all', 'on_task', 'available', 'in_garage', 'documents_expiring', 'inactive'].map((k) => `vehicles.filter_${k}`),
    ...['car', 'van', 'double_cab', 'lorry', 'other'].map((k) => `vehicles.type_${k}`),
    ...['lic', 'ins', 'emi'].map((k) => `vehicles.doc_${k}`),
    ...Object.keys(emptyVehicle()).map((k) => `vehicles.f_${k}`),
    ...['today', 'week', 'month', 'last_month'].map((k) => `reports.range_${k}`),
    ...['mileage', 'fuel', 'duty'].map((k) => `reports.${k}`),
    ...['uploaded', 'interrupted', 'recorded', 'uploading', 'failed', 'none', 'pruned'].map((k) => `reports.video_${k}`),
    ...['driver', 'office', 'auto', 'other'].map((k) => `reports.out_${k}`),
    ...['vehicle', 'driver', 'task_km', 'personal_km', 'odometer_km', 'km_allowance', 'over_allowance', 'km_outside_tasks', 'between_tasks_km', 'overnight_km', 'fuel_litres', 'fuel_lkr', 'tasks', 'at', 'task', 'last_logged_km', 'start_km', 'unlogged_km', 'kind', 'reading_km', 'photo_reading', 'photo_status', 'entry', 'reason', 'from', 'to', 'type', 'km', 'from_reading_km', 'to_reading_km', 'from_task', 'to_task', 'from_near', 'to_near'].map((k) => `reports.col_${k}`),
  ];
  const famMissing = families.filter((k) => get(en.office, k) === undefined || get(si.office, k) === undefined);
  check(famMissing.length === 0, 'the run-time families exist in both languages', famMissing);
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const badPh = [...keys, ...families].filter((k) => { const a = get(en.office, k); const b = get(si.office, k); return a && b && ph(a) !== ph(b); });
  check(badPh.length === 0, 'the same placeholders in both languages', badPh);
  const siText = [...keys, ...families].map((k) => get(si.office, k) ?? '').join(' ');
  check(!/[෦-෯]/.test(siText), 'Latin digits only in Sinhala');
}

console.log(failures === 0 ? '\nAll management checks passed.' : `\n${failures} management check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
