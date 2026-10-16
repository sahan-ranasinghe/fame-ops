// The date-range control (Phase 7 §8): Today / Yesterday / This week / This
// month / Last month / Custom, kept in the URL (?range=&from=&to=) so a link or
// a reload shows the same dates. Custom opens From–To date fields in the page
// (never a dialog); on a phone the chips wrap. One-day mode (Today, Yesterday,
// Custom day) is for the Route. The date maths are in dateRange.ts.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Chips } from "./basics";
import { colomboDay, customRange, daysIn, ONE_DAY_OPTIONS, RANGE_OPTIONS, type RangeKey, rangeText, readRange, tooLong, writeRange } from "./dateRange";

export interface DateRangeValue {
  range: RangeKey;
  /** Colombo dates, YYYY-MM-DD; in one-day mode to = from. */
  from: string;
  to: string;
  oneDay: boolean;
  /** Over the page's limit (maxDays): the sentence to show instead of loading. */
  error?: string;
  setRange: (range: RangeKey) => void;
  /** A custom range (From after To is swapped); answers the sentence when a date is not a date. */
  setCustom: (from: string, to?: string) => string | undefined;
}

/** The range in the URL, the page's default when there is none. Other parameters (driver=, …) are kept. */
export function useDateRange(defaultRange: RangeKey = "today", opts: { oneDay?: boolean; maxDays?: number } = {}): DateRangeValue {
  const oneDay = !!opts.oneDay;
  const [params, setParams] = useSearchParams();
  const { range, from, to } = readRange(params, defaultRange, colomboDay(), oneDay);
  const write = (next: { range: RangeKey; from?: string; to?: string }) =>
    setParams((p) => writeRange(p, next, defaultRange, oneDay), { replace: true });
  return {
    range,
    from,
    to,
    oneDay,
    error: tooLong(from, to, opts.maxDays),
    // Custom starts from the dates on screen.
    setRange: (k) => write(k === "custom" ? { range: k, from, to } : { range: k }),
    setCustom: (f, t) => {
      const c = customRange(f, oneDay ? f : t ?? f);
      if ("error" in c) return c.error;
      write({ range: "custom", ...c });
      return undefined;
    },
  };
}

export function DateRange({ value, label = "Dates" }: { value: DateRangeValue; label?: string }) {
  const { range, from, to, oneDay } = value;
  // What is typed in the date fields: a half-typed date is kept here, not pushed into the URL.
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [msg, setMsg] = useState<string | undefined>();
  useEffect(() => setF(from), [from]);
  useEffect(() => setT(to), [to]);
  const apply = (nf: string, nt: string) => {
    setF(nf);
    setT(nt);
    // An empty field while typing waits quietly; a full date applies at once.
    if (!nf || !nt) return;
    setMsg(value.setCustom(nf, nt));
  };
  const note = msg ?? value.error;
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gap: 10 }} data-testid="date-range">
      <Chips options={oneDay ? ONE_DAY_OPTIONS : RANGE_OPTIONS} value={range} onChange={(k) => { setMsg(undefined); value.setRange(k); }} />
      {range === "custom" && (
        <div className="filters" style={{ marginBottom: 0 }}>
          {oneDay ? (
            <label className="field"><span>Day</span><input type="date" value={f} onChange={(e) => apply(e.target.value, e.target.value)} /></label>
          ) : (
            <>
              <label className="field"><span>From</span><input type="date" value={f} onChange={(e) => apply(e.target.value, t)} /></label>
              <label className="field"><span>To</span><input type="date" value={t} onChange={(e) => apply(f, e.target.value)} /></label>
            </>
          )}
        </div>
      )}
      <div className="muted small">{rangeText(from, to)}{from !== to ? ` · ${daysIn(from, to)} days` : ""}</div>
      {note && <div className="status warn" role="alert">{note}</div>}
    </div>
  );
}
