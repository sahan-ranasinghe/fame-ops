// Office mode (Stage 1, O3 row 6): Maintenance, the drivers' vehicle problem reports, the rules only (pure). As the
// website's Maintenance page: list_vehicle_reports (Not closed by default, Open, In garage, Closed, All; the search box;
// 25 a page), a report's page with its photos, Open task, Call the driver, and the update: the status, a note the driver
// reads, and "Also take <plate> off the road" (update_vehicle in_garage, only with that tool and while the vehicle is not
// in the garage already). update_vehicle_report mirrors onto the report's issue on the server.

import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';
import type { VehicleReport, VehicleReports } from './types';

export type ReportFilter = 'not_closed' | 'open' | 'in_garage' | 'closed' | 'all';
export const REPORT_FILTERS: readonly ReportFilter[] = ['not_closed', 'open', 'in_garage', 'closed', 'all'];
export const REPORTS_PAGE = 25;
export const REPORT_STATUSES: readonly VehicleReport['status'][] = ['open', 'in_garage', 'closed'];

type Words = (key: string) => string;

export function reportsFilterDefs(tr: Words): FilterDef[] {
  return [{ key: 'status', label: tr('office.maint.filterStatus'), kind: 'single', default: 'not_closed', options: REPORT_FILTERS.map((f) => ({ value: f, label: tr(`office.maint.filter_${f}`) })) }];
}

export function reportsChoice(v: FilterValues): ReportFilter {
  return typeof v.status === 'string' && (REPORT_FILTERS as readonly string[]).includes(v.status) ? (v.status as ReportFilter) : 'not_closed';
}

export function reportsArgs(status: ReportFilter, search: string, cursor?: string): Record<string, unknown> {
  return { status, limit: REPORTS_PAGE, ...(search.trim() ? { search: search.trim().slice(0, 80) } : {}), ...(cursor ? { cursor } : {}) };
}

export function appendReports(list: VehicleReports, page: VehicleReports): VehicleReports {
  const seen = new Set(list.reports.map((r) => r.id));
  const out: VehicleReports = { ...list, reports: [...list.reports, ...page.reports.filter((r) => !seen.has(r.id))] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

export const reportTone = (s: string): 'red' | 'amber' | 'green' | 'muted' => (s === 'open' ? 'red' : s === 'in_garage' ? 'amber' : s === 'closed' ? 'green' : 'muted');

/** The calls Save makes: the report (always, with the note when written), then the vehicle off the road when ticked. */
export function reportSaveCalls(r: Pick<VehicleReport, 'id' | 'vehicle' | 'vehicle_in_garage' | 'status'>, f: { status: VehicleReport['status']; note: string; offRoad: boolean }, tools: readonly string[]):
  { tool: string; input: Record<string, unknown> }[] {
  const calls: { tool: string; input: Record<string, unknown> }[] = [];
  const note = f.note.trim().slice(0, 500);
  if (f.status !== r.status || note) calls.push({ tool: 'update_vehicle_report', input: { id: r.id, status: f.status, ...(note ? { office_note: note } : {}) } });
  if (f.offRoad && r.vehicle && !r.vehicle_in_garage && tools.includes('update_vehicle')) calls.push({ tool: 'update_vehicle', input: { reg_no: r.vehicle, in_garage: true } });
  return calls;
}

/** "Also take it off the road" shows only with update_vehicle, for a vehicle not in the garage already. */
export const canTakeOffRoad = (r: Pick<VehicleReport, 'vehicle' | 'vehicle_in_garage'>, tools: readonly string[]) => !!r.vehicle && !r.vehicle_in_garage && tools.includes('update_vehicle');

/** The category's words key (breakdown, accident, tyre, warning_light, other). */
export const categoryKey = (c: string) => `office.maint.cat_${['breakdown', 'accident', 'tyre', 'warning_light'].includes(c) ? c : 'other'}`;
