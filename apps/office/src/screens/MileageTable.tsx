// Mileage's tables (Hotfix 3, L3): mileage_summary is one answer, not a list tool, so each of its tables (by vehicle, the
// month's allowance, biggest gaps, unlogged km, odometer checks) is paged here in the browser the same way as every list:
// the count in the header, 25 rows at a time, page numbers on a desktop and "Load more" on a phone, where each row is a
// card with its labels. The columns come from every row, so they stay the same from page to page.
import type { ReactNode } from "react";
import type { Row } from "../data/types";
import { num } from "../lib/format";
import { Plate } from "../ui/basics";
import { human } from "../ui/GenericTable";
import { EmptyLine, ListHeader } from "../ui/ListKit";
import { ListFooter, useLocalPages } from "./listLocal";
import { datesInWords } from "../lib/when";

/** The columns of a set of rows: every plain key in the order first seen, less the hidden ones. */
export function columnsOf(rows: readonly Row[], hide: readonly string[] = []): { keys: string[]; numeric: Set<string> } {
  const keys: string[] = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => {
    const v = r[k];
    if ((v === null || typeof v !== "object") && !keys.includes(k) && !hide.includes(k)) keys.push(k);
  }));
  const numeric = new Set(keys.filter((k) => rows.every((r) => r[k] == null || typeof r[k] === "number")));
  return { keys, numeric };
}

function cell(k: string, v: Row[string], numeric: boolean): ReactNode {
  if (numeric) return num(v);
  if (k === "reg_no" || k === "vehicle") return <Plate v={String(v ?? "")} />;
  if (typeof v === "string" && /^https?:\/\//.test(v)) return <a className="btn small" href={v} target="_blank" rel="noopener">Open</a>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  // Round 3 (A4): a date the server sends ("2026-10-12 08:00") in words ("Mon 12 Oct 08:00").
  return v == null || v === "" ? "—" : datesInWords(String(v));
}

/** One of Mileage's tables in its card: the header with the count and a note, the page of rows, the paging controls. */
export function MileageTable({ title, note, intro, rows, hide = [], empty, resetKey, testId, action }: {
  title: ReactNode;
  note?: ReactNode;
  /** A line under the header (the month's figures). */
  intro?: ReactNode;
  rows: readonly Row[];
  hide?: readonly string[];
  /** The empty state in words. */
  empty: ReactNode;
  /** The filters the rows belong to: the page goes back to the first when they change. */
  resetKey: string;
  testId?: string;
  /** Round 52: a control at the end of a row (Delete… on a wrong reading), or nothing for that row. */
  action?: (row: Row) => ReactNode;
}) {
  const list = useLocalPages(rows, resetKey);
  const { keys, numeric } = columnsOf(rows, hide);
  return (
    <div className="card" data-testid={testId}>
      <ListHeader title={title} count={rows.length} right={note ? <span className="muted small">{note}</span> : undefined} />
      {intro && <div className="card-b" style={{ paddingTop: 0 }}>{intro}</div>}
      {rows.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr>{keys.map((k) => <th key={k} className={numeric.has(k) ? "r" : ""}>{human(k)}</th>)}{action && <th className="r"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {list.items.map((r, i) => (
                <tr key={i}>{keys.map((k) => <td key={k} data-label={human(k)} className={numeric.has(k) ? "r num" : ""}>{cell(k, r[k], numeric.has(k))}</td>)}{action && <td className="r">{action(r)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyLine>{empty}</EmptyLine>}
      <ListFooter list={list} />
    </div>
  );
}
