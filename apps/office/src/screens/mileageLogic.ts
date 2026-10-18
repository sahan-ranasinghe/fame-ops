// Mileage and Fuel over the date-range control (Phase 7 §8), pure: what to ask
// (a whole calendar month as `month`, any other days as `from`/`to`) and what
// to show: the chosen days' rows and totals, and beside a range the month that
// contains To with the allowance (the allowance is monthly).
import type { FuelList, MileageSummary, MileageTotals, Row } from "../data/types";
import { num } from "../lib/format";
import { monthOf, rangeText } from "../ui/dateRange";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" → "October 2026". */
export const monthName = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

/** The days are one whole calendar month: its YYYY-MM (asked as `month`, so the server adds up one span, not two). */
export function wholeMonth(from: string, to: string): string | undefined {
  const m = monthOf(from);
  return m.from === from && m.to === to ? from.slice(0, 7) : undefined;
}

/** mileage_summary's and list_fuel's input: a whole month as `month`, other days as `from`/`to`; the filters chosen. */
export function rangeArgs(from: string, to: string, filters: { vehicle?: string; driver?: string } = {}): Record<string, unknown> {
  const month = wholeMonth(from, to);
  return {
    ...(month ? { month } : { from, to }),
    ...(filters.vehicle ? { vehicle: filters.vehicle } : {}),
    ...(filters.driver ? { driver: filters.driver } : {}),
  };
}

/** The monthly columns: shown with a whole month, kept for the month's own table beside a shorter range. */
export const ALLOWANCE_KEYS = ["km_allowance", "over_allowance"];

export interface MileageView {
  /** The chosen days in words: "October 2026", "Mon 12 Oct – Sun 18 Oct 2026". */
  label: string;
  totals: MileageTotals;
  vehicles: Row[];
  biggest_gaps: Row[];
  unlogged_km: Row[];
  check_odometer: Row[];
  /** Days shorter than a month: the month that contains To, its totals and each vehicle against its allowance. */
  month?: { label: string; totals: MileageTotals; rows: Row[] };
}

/** Each vehicle against its monthly allowance: the columns that matter for it, those the answer has. */
export function allowanceRows(vehicles: Row[]): Row[] {
  const keys = ["vehicle", "task_km", "personal_km", "odometer_km", "km_allowance", "over_allowance"];
  return vehicles.map((v) => Object.fromEntries(keys.filter((k) => v[k] !== undefined).map((k) => [k, v[k]])));
}

export function mileageView(d: MileageSummary): MileageView {
  if (!d.range) {
    const m = monthOf(`${d.month}-01`);
    return {
      label: wholeMonth(m.from, m.to) ? monthName(d.month) : rangeText(m.from, m.to),
      totals: d.totals,
      vehicles: d.vehicles,
      biggest_gaps: d.biggest_gaps,
      unlogged_km: d.unlogged_km,
      check_odometer: d.check_odometer,
    };
  }
  const r = d.range;
  return {
    label: rangeText(r.from, r.to),
    totals: r.totals,
    vehicles: r.vehicles,
    biggest_gaps: r.biggest_gaps,
    unlogged_km: r.unlogged_km,
    check_odometer: r.check_odometer,
    month: { label: monthName(d.month), totals: d.totals, rows: allowanceRows(d.vehicles) },
  };
}

/** "Personal km: 42 km, never charged to a job." (none when nobody drove a personal trip). */
export function personalLine(t: Pick<MileageTotals, "personal_km">): string | undefined {
  return t.personal_km ? `Personal km: ${num(t.personal_km)} km, never charged to a job.` : undefined;
}

/** The month's figures in one line: "12 tasks · 840 task km · 35 km outside tasks · 310 litres · LKR 120,500". */
export function monthLine(t: MileageTotals): string {
  return [
    `${num(t.tasks)} task${t.tasks === 1 ? "" : "s"}`,
    `${num(t.task_km)} task km`,
    t.personal_km ? `${num(t.personal_km)} personal km` : "",
    `${num(t.between_tasks_km + t.overnight_km)} km outside tasks`,
    `${num(t.fuel_litres)} litres`,
    `LKR ${num(t.fuel_lkr)}`,
  ].filter(Boolean).join(" · ");
}

/**
 * The Fuel page's link from Mileage (Hotfix 3): the same days and filters. Mileage opens on this month and Fuel on this
 * week, so Mileage's default is named in the link ("?range=month").
 */
export function fuelSearch(search: string): string {
  const p = new URLSearchParams(search);
  if (!p.get("range")) p.set("range", "month");
  return `?${p.toString()}`;
}

/** Fuel: the chosen days in words, from the answer. */
export function fuelLabel(d: Pick<FuelList, "month" | "from" | "to">): string {
  if (d.from && d.to) return rangeText(d.from, d.to);
  return monthName(d.month);
}

/** Fuel beside a range: "October 2026: 12 fills · 310 litres · LKR 120,500". */
export function fuelMonthLine(d: Pick<FuelList, "month" | "month_totals">): string | undefined {
  const m = d.month_totals;
  if (!m) return undefined;
  return `${monthName(d.month)}: ${num(m.entries)} fill${m.entries === 1 ? "" : "s"} · ${num(m.litres)} litres · LKR ${num(m.lkr)}`;
}
