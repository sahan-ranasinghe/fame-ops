// Round 4–7, item 8 (docs/phase8-plan.md §33.7) on the driver's Report tab: Gmail's rows. "My reports" shows the last
// RECENT_REPORTS (5) with "See all" (app/my-reports.tsx: the phone's reports, then the server's older ones, 20 at a time
// with Load more). Each row: an icon for the category, ONE specific line ("Tyre · Front left flat"), ONE grey meta line
// (the plate · when in words · "Vehicle check" for a check's report) with the status chip; the office's reply under it in
// blue when there is one. Never the category or a word repeated. Pure, so scripts/test-fuel-card.ts runs it.

import { dateWords, type Translate } from './dateWords';
import type { ReportCategory, VehicleReport } from './types';

/** Rows the Report tab shows before "See all". */
export const RECENT_REPORTS = 5;

/** The icon of each category (components/icons.ts names). */
export const REPORT_ICON: Record<ReportCategory, 'Wrench' | 'Siren' | 'CircleDot' | 'TriangleAlert' | 'Car' | 'MessageCircle'> = {
  breakdown: 'Wrench',
  accident: 'Siren',
  tyre: 'CircleDot',
  warning_light: 'TriangleAlert',
  damage: 'Car',
  other: 'MessageCircle',
};

export function reportIcon(category: string): (typeof REPORT_ICON)[ReportCategory] {
  return REPORT_ICON[category as ReportCategory] ?? 'MessageCircle';
}

type Row = Pick<VehicleReport, 'category' | 'note' | 'needs_vehicle' | 'created_at' | 'check_id' | 'office_note' | 'status'>;

/** The one specific line: the category and what the driver wrote (else "I need another vehicle" when asked). */
export function reportTitle(t: Translate, r: Row): string {
  const note = r.note?.trim().replace(/\s+/g, ' ') || null;
  return [t(`report.${r.category}`), note ?? (r.needs_vehicle ? t('report.needVehicle') : null)].filter(Boolean).join(' · ');
}

/**
 * The grey meta line: the plate · when in words · "Vehicle check" (a check's report) · "I need another vehicle" when it was
 * asked and the line above has the driver's words (else the line above says it). The status is its chip.
 */
export function reportMeta(t: Translate, r: Row, plate: string | null, now: Date | string | number = Date.now()): string {
  const askedAbove = !r.note?.trim();
  return [
    plate,
    dateWords(t, r.created_at, now),
    r.check_id ? t('vehicleCheck.title') : null,
    r.needs_vehicle && !askedAbove ? t('report.needVehicle') : null,
  ].filter(Boolean).join(' · ');
}

/** "See all" on the Report tab: when the phone holds more than the rows shown. */
export function reportsSeeAll(held: number): boolean {
  return held > RECENT_REPORTS;
}
