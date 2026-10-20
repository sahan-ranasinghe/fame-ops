// The one month calendar of the site (docs/ui-patterns.md §2, §3): one or two months side by side, ‹ › month by month,
// Monday first, today marked, the chosen day or range filled and the days between shaded, the days out of reach greyed.
// The date-range picker, the week strip's jump and the trip day all draw this. The rules are in dateRange.ts.
import { useState } from "react";
import { addMonths, dayDisabled, dayRole, dayText, monthGrid, monthTitle, type Picking, WEEK_HEAD } from "./dateRange";

export interface CalendarProps {
  /** The first month shown, "YYYY-MM". */
  initialMonth: string;
  /** How many months side by side (two on a desktop range picker). */
  months?: number;
  /** What is chosen: one day (from = to) or a range, or the start being picked (to null). */
  picking: Picking;
  onTap: (day: string) => void;
  min?: string;
  max?: string;
  /** The page's limit while the end is picked. */
  maxDays?: number;
  today: string;
  /** Why a greyed day cannot be picked (its title). */
  disabledWhy?: string;
}

export function Calendar({ initialMonth, months = 1, picking, onTap, min, max, maxDays, today, disabledWhy }: CalendarProps) {
  const [ym, setYm] = useState(initialMonth);
  const shown = Array.from({ length: months }, (_, i) => addMonths(ym, i));
  const canBack = !min || ym > min.slice(0, 7);
  const canOn = !max || shown[shown.length - 1] < max.slice(0, 7);
  return (
    <div className="cal" data-testid="calendar">
      <div className="cal-nav">
        <button type="button" className="btn small icon-btn" aria-label="Previous month" disabled={!canBack} onClick={() => setYm(addMonths(ym, -1))}>‹</button>
        <span className="cal-titles">{shown.map((m) => <b key={m}>{monthTitle(m)}</b>)}</span>
        <button type="button" className="btn small icon-btn" aria-label="Next month" disabled={!canOn} onClick={() => setYm(addMonths(ym, 1))}>›</button>
      </div>
      <div className="cal-months">
        {shown.map((m) => (
          <table key={m} className="cal-grid" aria-label={monthTitle(m)}>
            <thead><tr>{WEEK_HEAD.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {monthGrid(m).map((week, i) => (
                <tr key={i}>
                  {week.map((d, j) => {
                    if (!d) return <td key={j} />;
                    const role = dayRole(d, picking);
                    const off = dayDisabled(d, { min, max, maxDays, picking });
                    return (
                      <td key={d} className={role ? `in-${role}` : undefined}>
                        <button
                          type="button"
                          className={`cal-day${d === today ? " today" : ""}${role ? ` ${role}` : ""}`}
                          data-day={d}
                          aria-label={dayText(d, true)}
                          aria-pressed={role === "single" || role === "start" || role === "end" ? true : picking.from === d ? true : undefined}
                          aria-current={d === today ? "date" : undefined}
                          disabled={off}
                          title={off && disabledWhy ? disabledWhy : undefined}
                          onClick={() => onTap(d)}
                        >
                          {Number(d.slice(8, 10))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
