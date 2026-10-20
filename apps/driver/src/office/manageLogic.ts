// Office mode (Phase 8, O2, item 7): the rules of the management screens under More (design 19): the Vehicles list and
// its form (the site's vehicleLogic.ts and Vehicles.tsx: only filled-in fields are sent, an update keeps everything
// else; the exact register_vehicle / update_vehicle inputs), and the read-only Reports (Mileage, Fuel, the Duty log over
// a range of days: the site's mileageLogic.ts, fuelLogic.ts and dutyLogic.ts). Pure: no react-native, no i18n; the
// screens turn the keys into words.

import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';

import type { DutyLog, DutyPeriod, FuelList, MileageSummary, MileageTotals, Row, VehicleCard, VehiclesList, VideoCard } from './types';

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type VehicleFilter = 'all' | 'on_task' | 'available' | 'in_garage' | 'documents_expiring' | 'inactive';
export const VEHICLE_FILTERS: readonly VehicleFilter[] = ['all', 'on_task', 'available', 'in_garage', 'documents_expiring', 'inactive'];
export const VEHICLE_TYPES = ['car', 'van', 'double_cab', 'lorry', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLES_LIMIT = 25;

/** list_vehicles' input: the filter, the search when typed, the page. */
export function vehiclesArgs(filter: VehicleFilter, search: string, cursor?: string): Record<string, unknown> {
  const s = search.trim();
  return { filter, ...(s ? { search: s } : {}), limit: VEHICLES_LIMIT, ...(cursor ? { cursor } : {}) };
}

/** The chips' counts from the answer (none for Returned). */
export function filterCounts(c: VehiclesList['counts'] | undefined): Partial<Record<VehicleFilter, number>> {
  if (!c) return {};
  return { all: c.all, on_task: c.on_task, available: c.available, in_garage: c.in_garage, documents_expiring: c.documents_expiring, inactive: c.inactive };
}

/** The Filter sheet's one section (docs/ui-patterns.md §1): list_vehicles' own `filter`, with the fleet's counts beside each choice. */
export function vehicleFilterDefs(c: VehiclesList['counts'] | undefined, tr: (key: string) => string): FilterDef[] {
  const counts = filterCounts(c);
  return [{
    key: 'filter',
    label: tr('office.vehicles.filterLabel'),
    kind: 'single',
    default: 'all',
    options: VEHICLE_FILTERS.map((k) => ({ value: k, label: tr(`office.vehicles.filter_${k}`), ...(counts[k] !== undefined ? { count: counts[k] } : {}) })),
  }];
}

/** The filter chosen in the sheet (anything unknown is All). */
export function vehicleChoice(values: FilterValues): VehicleFilter {
  const v = values.filter;
  return (VEHICLE_FILTERS as readonly unknown[]).includes(v) ? (v as VehicleFilter) : 'all';
}

/** What an empty list says: the search found nothing, the filter has nothing, or no vehicle yet (Register one when allowed). */
export function vehiclesEmpty(filter: VehicleFilter, search: string, mayRegister: boolean): 'noneMatch' | 'noneInFilter' | 'noneRegister' | 'none' {
  if (search.trim()) return 'noneMatch';
  if (filter !== 'all') return 'noneInFilter';
  return mayRegister ? 'noneRegister' : 'none';
}

/** The next page's rows after the ones on screen (never a plate twice). */
export function appendVehicles(list: VehiclesList, page: VehiclesList): VehiclesList {
  const seen = new Set(list.vehicles.map((v) => v.reg_no));
  const more = page.vehicles.filter((v) => !seen.has(v.reg_no));
  const out: VehiclesList = { ...list, vehicles: [...list.vehicles, ...more] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

/** The status pill's tone: on a task blue, in the garage amber, returned muted, else green. */
export function vehicleTone(v: Pick<VehicleCard, 'status' | 'active'>): 'blue' | 'amber' | 'muted' | 'green' {
  if (v.active === false) return 'muted';
  const s = String(v.status ?? '').toLowerCase();
  if (s.includes('task')) return 'blue';
  if (s.includes('garage')) return 'amber';
  return 'green';
}

/** Lic / Ins / Emi chip tone from the tool's chip word. */
export function docTone(chip?: string): 'red' | 'amber' | 'green' | 'muted' {
  const c = String(chip || 'not set').toLowerCase();
  if (c === 'red' || c.includes('expired')) return 'red';
  if (c === 'orange' || c.includes('soon')) return 'amber';
  if (c === 'not set') return 'muted';
  return 'green';
}

/** "1,240 / 2,000 km" for the month, or "1,240 km" with no allowance. */
export function kmLine(v: Pick<VehicleCard, 'km_this_month' | 'km_allowance'>): { used: number; allow: number; over: boolean } {
  const used = Number(v.km_this_month) || 0;
  const allow = Number(v.km_allowance) || 0;
  return { used, allow, over: allow > 0 && used > allow };
}

export interface VehicleFields {
  reg: string;
  model: string;
  type: '' | VehicleType;
  seats: string;
  allow: string;
  odo: string;
  rent: string;
  company: string;
  until: string;
  driver: string;
  svcint: string;
  svclast: string;
  svcdate: string;
  garage: string;
  lic: string;
  ins: string;
  emi: string;
  ingarage: '' | 'true' | 'false';
  active: '' | 'true' | 'false';
  /** The custodian: an office person's name or e-mail; "none" clears it. */
  custodian: string;
  custodianNote: string;
}

export const emptyVehicle = (): VehicleFields => ({
  reg: '', model: '', type: '', seats: '', allow: '', odo: '', rent: '', company: '', until: '', driver: '',
  svcint: '', svclast: '', svcdate: '', garage: '', lic: '', ins: '', emi: '', ingarage: '', active: '', custodian: '', custodianNote: '',
});

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * regNo null = register a new vehicle; otherwise update that plate. Only filled-in fields go (an update keeps the rest).
 * Errors are keys: plate (no plate), date (a date not YYYY-MM-DD, with the field), nothing (an update with no field).
 */
export function vehicleInput(f: VehicleFields, regNo: string | null): { error: 'plate' | 'date' | 'number' | 'nothing'; field?: keyof VehicleFields } | { input: Record<string, unknown>; tool: 'register_vehicle' | 'update_vehicle' } {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = {};
  if (regNo === null) {
    if (!t(f.reg)) return { error: 'plate' };
    input.reg_no = t(f.reg).toUpperCase();
  } else {
    input.reg_no = regNo;
  }
  for (const k of ['seats', 'allow', 'odo', 'svcint', 'svclast'] as const) {
    if (t(f[k]) !== '' && !/^\d+$/.test(t(f[k]).replace(/[\s,]/g, ''))) return { error: 'number', field: k };
  }
  if (t(f.rent) !== '' && !/^\d+(\.\d+)?$/.test(t(f.rent).replace(/[\s,]/g, ''))) return { error: 'number', field: 'rent' };
  for (const k of ['until', 'svcdate', 'garage', 'lic', 'ins', 'emi'] as const) {
    if (t(f[k]) && !isDate(t(f[k]))) return { error: 'date', field: k };
  }
  const intv = (k: string, v: string) => { if (t(v) !== '') input[k] = parseInt(t(v).replace(/[\s,]/g, ''), 10); };
  if (t(f.model)) input.make_model = t(f.model);
  if (f.type) input.vehicle_type = f.type;
  intv('seats', f.seats);
  intv('monthly_km_allowance', f.allow);
  intv('current_odometer_km', f.odo);
  if (t(f.rent) !== '') input.monthly_rent_lkr = Number(t(f.rent).replace(/[\s,]/g, ''));
  if (t(f.company)) input.rental_company = t(f.company);
  if (t(f.until)) input.rent_until = t(f.until);
  if (t(f.driver)) input.regular_driver = t(f.driver);
  intv('service_interval_km', f.svcint);
  intv('last_service_odometer_km', f.svclast);
  if (t(f.svcdate)) input.next_service_date = t(f.svcdate);
  if (t(f.garage)) input.garage_booked_date = t(f.garage);
  if (t(f.lic)) input.licence_expiry = t(f.lic);
  if (t(f.ins)) input.insurance_expiry = t(f.ins);
  if (t(f.emi)) input.emission_expiry = t(f.emi);
  if (f.ingarage) input.in_garage = f.ingarage === 'true';
  if (f.active) input.active = f.active === 'true';
  if (t(f.custodian)) input.custodian = t(f.custodian).toLowerCase() === 'none' ? null : t(f.custodian);
  if (t(f.custodianNote)) input.custodian_note = t(f.custodianNote).toLowerCase() === 'none' ? null : t(f.custodianNote);
  if (regNo !== null && Object.keys(input).length === 1) return { error: 'nothing' };
  return { input, tool: regNo === null ? 'register_vehicle' : 'update_vehicle' };
}

/** add_rental_company's input, or null with no name. */
export function companyInput(name: string, phone: string): Record<string, unknown> | null {
  const n = name.trim();
  if (!n) return null;
  return { name: n, ...(phone.trim() ? { phone: phone.trim() } : {}) };
}

/** The form has something typed (the leave guard). */
export const vehicleFormDirty = (f: VehicleFields) => JSON.stringify(f) !== JSON.stringify(emptyVehicle());

// ---------------------------------------------------------------------------
// Reports: the days
// ---------------------------------------------------------------------------

const dayOf = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (s: string, n: number) => iso(new Date(dayOf(s).getTime() + n * 86_400_000));

/** The Monday of the week that holds the day. */
export function mondayOf(day: string): string {
  const d = dayOf(day);
  const back = (d.getUTCDay() + 6) % 7;
  return plusDays(day, -back);
}

/** The first and the last day of the month that holds the day. */
export function monthOf(day: string): { from: string; to: string } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const last = iso(new Date(Date.UTC(y, m, 0)));
  return { from: `${day.slice(0, 8)}01`, to: last };
}

/** The Reports' sections (each by its tool) and the days each may cover at a time (the servers' limits: 366, the duty log 62). */
export type ReportSection = 'mileage' | 'fuel' | 'duty';
export const REPORT_MAX_DAYS: Record<ReportSection, number> = { mileage: 366, fuel: 366, duty: 62 };

/** How many days a range covers (both ends counted). */
export const rangeDayCount = (from: string, to: string): number => Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / 86_400_000) + 1;

/** Whether a section may be asked for these days (the duty log's 62 days: a longer range says so instead of asking). */
export const rangeFits = (section: ReportSection, from: string, to: string): boolean => rangeDayCount(from, to) <= REPORT_MAX_DAYS[section];

/** The days are one whole calendar month: its YYYY-MM (asked as `month`, so the server adds up one span, not two). */
export function wholeMonth(from: string, to: string): string | undefined {
  const m = monthOf(from);
  return m.from === from && m.to === to ? from.slice(0, 7) : undefined;
}

/** mileage_summary's and list_fuel's input: a whole month as `month`, other days as `from`/`to`. */
export function rangeArgs(from: string, to: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  const month = wholeMonth(from, to);
  return { ...(month ? { month } : { from, to }), ...more };
}

/**
 * O3 rows 7 and 10: Reports' Filter (under the date range): the vehicle (Mileage, Fuel) and the driver (all three), as
 * mileage_summary / list_fuel / duty_log take them (a plate; a username). Options from list_vehicles and list_drivers.
 */
export function reportFilterDefs(section: ReportSection, plates: readonly string[], drivers: readonly { username: string; name: string }[], tr: (key: string) => string): FilterDef[] {
  const defs: FilterDef[] = [];
  if (section !== 'duty' && plates.length) defs.push({ key: 'vehicle', label: tr('office.reports.filterVehicle'), kind: 'single', default: 'all', options: [{ value: 'all', label: tr('office.common.all') }, ...plates.map((p) => ({ value: p, label: p }))] });
  if (drivers.length) defs.push({ key: 'driver', label: tr('office.reports.filterDriver'), kind: 'single', default: 'all', options: [{ value: 'all', label: tr('office.common.all') }, ...drivers.map((d) => ({ value: d.username, label: d.name }))] });
  return defs;
}

/** The chosen vehicle and driver for a section's tool (Duty log: the driver only). */
export function reportFilterArgs(values: FilterValues, section: ReportSection): { vehicle?: string; driver?: string } {
  const out: { vehicle?: string; driver?: string } = {};
  if (section !== 'duty' && typeof values.vehicle === 'string' && values.vehicle && values.vehicle !== 'all') out.vehicle = values.vehicle;
  if (typeof values.driver === 'string' && values.driver && values.driver !== 'all') out.driver = values.driver;
  return out;
}

/** duty_log's input: one day as `date`, a range as `from`/`to`. */
export function dutyArgs(from: string, to: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(from === to ? { date: from } : { from, to }), ...more };
}

// ---------------------------------------------------------------------------
// Reports: Mileage
// ---------------------------------------------------------------------------

export interface MileageView {
  /** The days shown: a whole month (YYYY-MM) or the range. */
  days: { month: string } | { from: string; to: string };
  totals: MileageTotals;
  vehicles: Row[];
  biggest_gaps: Row[];
  unlogged_km: Row[];
  check_odometer: Row[];
  /** Days shorter than a month: the month that contains To, its totals and each vehicle against its allowance. */
  month?: { month: string; totals: MileageTotals; rows: Row[] };
}

const ALLOWANCE_KEYS = ['vehicle', 'task_km', 'personal_km', 'odometer_km', 'km_allowance', 'over_allowance'];

/** Each vehicle against its monthly allowance: the columns that matter for it, those the answer has. */
export function allowanceRows(vehicles: Row[]): Row[] {
  return vehicles.map((v) => Object.fromEntries(ALLOWANCE_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])));
}

export function mileageView(d: MileageSummary): MileageView {
  if (!d.range) {
    return { days: { month: d.month }, totals: d.totals, vehicles: d.vehicles, biggest_gaps: d.biggest_gaps, unlogged_km: d.unlogged_km, check_odometer: d.check_odometer };
  }
  const r = d.range;
  return {
    days: { from: r.from, to: r.to },
    totals: r.totals,
    vehicles: r.vehicles,
    biggest_gaps: r.biggest_gaps,
    unlogged_km: r.unlogged_km,
    check_odometer: r.check_odometer,
    month: { month: d.month, totals: d.totals, rows: allowanceRows(d.vehicles) },
  };
}

/** Km outside tasks: between tasks and overnight added up. */
export const outsideKm = (t: Pick<MileageTotals, 'between_tasks_km' | 'overnight_km'>) => (Number(t.between_tasks_km) || 0) + (Number(t.overnight_km) || 0);

/** A row's cells in order, the keys the screen names apart (vehicle first, links and ids left out). */
export function rowCells(r: Row, hide: readonly string[] = []): { key: string; value: string }[] {
  const skip = new Set(['task_id', 'log_id', 'photo', 'photo_url', 'maps', 'from_maps', 'to_maps', ...hide]);
  const keys = Object.keys(r).filter((k) => !skip.has(k) && r[k] !== undefined && r[k] !== null && r[k] !== '');
  const first = keys.indexOf('vehicle');
  if (first > 0) keys.splice(0, 0, ...keys.splice(first, 1));
  return keys.map((key) => {
    const v = r[key];
    const value = typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1)) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    return { key, value };
  });
}

// ---------------------------------------------------------------------------
// Reports: Fuel
// ---------------------------------------------------------------------------

/** "16 MB" (one decimal under 10 MB). */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "0:47" */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The video chip: its key (the screen's word) and tone; uploaded = green, on the way = amber, failed or missing = red. */
export function videoChip(v: Pick<VideoCard, 'status' | 'interrupted'>): { key: string; tone: 'green' | 'amber' | 'red' | 'muted' } {
  const tone = v.status === 'uploaded' ? 'green' : v.status === 'recorded' || v.status === 'uploading' ? 'amber' : v.status === 'failed' || v.status === 'none' ? 'red' : 'muted';
  return { key: v.status === 'uploaded' && v.interrupted ? 'interrupted' : v.status, tone };
}

/** "0:47 · 16 MB" under an uploaded video; nothing otherwise. */
export function videoLine(v: Pick<VideoCard, 'status' | 'duration_s' | 'bytes'>): string {
  if (v.status !== 'uploaded') return '';
  return [v.duration_s != null ? clockOf(v.duration_s) : '', v.bytes ? megabytes(v.bytes) : ''].filter(Boolean).join(' · ');
}

/** Stage 1 (O3 item 4): a fill's video as the pieces to watch, each with its 1-hour link (an uninterrupted recording is one
 * piece; only the pieces whose file is there). The phone's browser plays them: no player in the 1.3.0 build. */
export function videoPieces(v: Pick<VideoCard, 'status' | 'url' | 'segments' | 'duration_s'>): { n: number; url: string; duration_s?: number }[] {
  if (v.status !== 'uploaded') return [];
  const segs = (v.segments ?? []).map((x, i) => ({ n: i + 1, url: x.url ?? '', duration_s: x.duration_s })).filter((x) => /^https:\/\//.test(x.url));
  if (segs.length) return segs;
  return v.url && /^https:\/\//.test(v.url) ? [{ n: 1, url: v.url, duration_s: v.duration_s }] : [];
}

/** The links last an hour: a list read over 50 minutes ago is read again before a link opens. */
export const VIDEO_LINK_FRESH_MS = 50 * 60_000;
export const linksStale = (loadedAt: number, now: number) => now - loadedAt > VIDEO_LINK_FRESH_MS;

/** The next page's fills after the ones on screen. */
export function appendFuel(list: FuelList, page: FuelList): FuelList {
  const seen = new Set(list.entries.map((e) => e.id));
  const more = page.entries.filter((e) => !seen.has(e.id));
  const out: FuelList = { ...list, entries: [...list.entries, ...more] };
  if (page.next) out.next = page.next;
  else delete out.next;
  return out;
}

// ---------------------------------------------------------------------------
// Reports: the Duty log
// ---------------------------------------------------------------------------

/** The clock-out cell: on duty still, or the time with how it ended (driver | office | auto, as the server words it). */
export function clockOut(p: Pick<DutyPeriod, 'clock_out' | 'out_how'>): { onDuty: true } | { onDuty: false; time: string; how?: 'driver' | 'office' | 'auto' | string } {
  if (p.clock_out === 'on duty') return { onDuty: true };
  const how = p.out_how ? (p.out_how.startsWith('auto') ? 'auto' : p.out_how) : undefined;
  return { onDuty: false, time: p.clock_out, how };
}

/** The clock-out word's key: by the driver, by the office, auto at the cut-off, or the server's own words. */
export const outHowKey = (how?: string): 'driver' | 'office' | 'auto' | 'other' => (how === 'driver' || how === 'office' || how === 'auto' ? how : 'other');

/** "08:12–12:40" for each vehicle held in the period (a vehicle still held: "08:12–now"). */
export function heldLine(v: DutyPeriod['vehicles'][number], nowWord: string): string {
  return `${v.vehicle.split(' · ')[0]} ${v.from}–${v.to ?? nowWord}`;
}

/** The next page's periods after the ones on screen (a period is one driver and one clock-in). */
export function appendDuty(list: DutyLog, page: DutyLog): DutyLog {
  const key = (p: DutyPeriod) => `${p.username ?? p.driver ?? ''}|${p.day}|${p.clock_in}`;
  const seen = new Set(list.periods.map(key));
  const more = page.periods.filter((p) => !seen.has(key(p)));
  const out: DutyLog = { ...list, periods: [...list.periods, ...more] };
  if (page.next) out.next = page.next;
  else delete out.next;
  return out;
}

/** Hours as "7.5 h". */
export const hoursText = (h: number) => `${(Math.round(h * 10) / 10).toLocaleString('en-US')} h`;

// ---------------------------------------------------------------------------
// More: what the management rows need
// ---------------------------------------------------------------------------

/** Reports is shown when any of its three tools is allowed; each section by its own tool. */
export function reportSections(tools: readonly string[]): ReportSection[] {
  const out: ReportSection[] = [];
  if (tools.includes('mileage_summary')) out.push('mileage');
  if (tools.includes('list_fuel')) out.push('fuel');
  if (tools.includes('duty_log')) out.push('duty');
  return out;
}
