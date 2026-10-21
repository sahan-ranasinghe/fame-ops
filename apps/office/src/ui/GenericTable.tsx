// A table from flat rows (the mileage tables): columns from the keys,
// numbers right-aligned, plates as chips, links as buttons.
import type { Row } from "../data/types";
import { cap, num } from "../lib/format";
import { Plate } from "./basics";
import { datesInWords } from "../lib/when";

const LABELS: Record<string, string> = {
  task_km: "Task km", fuel_lkr: "Fuel (LKR)", fuel_litres: "Fuel (litres)", fuel_entries: "Fuel entries", km_allowance: "Allowance (km)",
  km_outside_tasks: "Km outside tasks", between_tasks_km: "Between tasks (km)", overnight_km: "Overnight (km)", odometer_km: "Odometer (km)",
  reg_no: "Vehicle", unlogged_km: "Unlogged km", last_logged_km: "Last logged (km)", start_km: "Start (km)", from_reading_km: "From (km)",
  to_reading_km: "To (km)", to_task: "Next task", reading_km: "Reading (km)", photo_reading: "Photo shows", photo_status: "Photo",
  over_allowance: "Over allowance", task_id: "Task id",
};
export const human = (k: string) => LABELS[k] ?? cap(k);

export function GenericTable({ rows, hide = [] }: { rows: Row[]; hide?: string[] }) {
  if (!rows.length) return null;
  const keys: string[] = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => {
    const v = r[k];
    if ((v === null || typeof v !== "object") && !keys.includes(k) && !hide.includes(k)) keys.push(k);
  }));
  const isNum = (k: string) => rows.every((r) => r[k] == null || typeof r[k] === "number");
  const cell = (k: string, v: Row[string]) => {
    if (isNum(k)) return num(v);
    if (k === "reg_no" || k === "vehicle") return <Plate v={String(v ?? "")} />;
    if (typeof v === "string" && /^https?:\/\//.test(v)) return <a className="btn small" href={v} target="_blank" rel="noopener">Open</a>;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    // Round 3 (A4): a date the server sends ("2026-10-12 08:00") in words ("Mon 12 Oct 08:00").
    return v == null || v === "" ? "—" : datesInWords(String(v));
  };
  return (
    <div className="tbl-wrap">
      <table>
        <thead><tr>{keys.map((k) => <th key={k} className={isNum(k) ? "r" : ""}>{human(k)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{keys.map((k) => <td key={k} className={isNum(k) ? "r num" : ""}>{cell(k, r[k])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
