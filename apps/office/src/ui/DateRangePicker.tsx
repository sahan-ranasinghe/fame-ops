// The date range (Phase 7 §8; docs/ui-patterns.md §2): ONE button that says the range in words ("This month · 1–31 Oct")
// and opens one calendar with the presets: on a desktop a popover with the presets as a list on the left and two months
// side by side, on a phone a bottom sheet with the presets as chips above one month. A preset applies at once; on the
// calendar the first tap is the start and the second the end (the days between shaded), one day twice is that day, and
// Apply closes it. A page's limit (maxDays) greys the days past it and says why. The range stays in the URL
// (?range=&from=&to=), so a link or a reload shows the same dates and the pages' calls do not change. Replaces
// ui/DateRange.tsx (its chips row and its From / To fields).
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Calendar } from "./Calendar";
import { addMonths, colomboDay, customRange, daysIn, type Picking, pickedRange, pickerText, PRESETS, type RangeKey, rangeText, readRange, tapDay, tooLong, writeRange, yesterdayOf } from "./dateRange";
import { Icon } from "./icons";
import { useIsPhone } from "./phone";
import { Sheet } from "./Sheet";

export interface DateRangeValue {
  range: RangeKey;
  /** Colombo dates, YYYY-MM-DD; in one-day mode to = from. */
  from: string;
  to: string;
  oneDay: boolean;
  /** The page's limit in days (none = no limit). */
  maxDays?: number;
  /** Over the page's limit (maxDays): the sentence to show instead of loading. */
  error?: string;
  setRange: (range: RangeKey) => void;
  /** A custom range (From after To is swapped); answers the sentence when a date is not a date. */
  setCustom: (from: string, to?: string) => string | undefined;
  /** One day (the week strip): Today and Yesterday keep their names in the URL, any other day is custom. */
  setDay: (day: string) => void;
}

/** The range in the URL, the page's default when there is none. Other parameters (driver=, …) are kept. */
export function useDateRange(defaultRange: RangeKey = "today", opts: { oneDay?: boolean; maxDays?: number } = {}): DateRangeValue {
  const oneDay = !!opts.oneDay;
  const [params, setParams] = useSearchParams();
  const today = colomboDay();
  const { range, from, to } = readRange(params, defaultRange, today, oneDay);
  const write = (next: { range: RangeKey; from?: string; to?: string }) =>
    setParams((p) => writeRange(p, next, defaultRange, oneDay), { replace: true });
  const setCustom = (f: string, t?: string) => {
    const c = customRange(f, oneDay ? f : t ?? f);
    if ("error" in c) return c.error;
    write({ range: "custom", ...c });
    return undefined;
  };
  return {
    range,
    from,
    to,
    oneDay,
    maxDays: opts.maxDays,
    error: tooLong(from, to, opts.maxDays),
    // Custom starts from the dates on screen.
    setRange: (k) => write(k === "custom" ? { range: k, from, to } : { range: k }),
    setCustom,
    setDay: (d) => {
      if (d === today) write({ range: "today" });
      else if (d === yesterdayOf(today)) write({ range: "yesterday" });
      else setCustom(d, d);
    },
  };
}

export function DateRangePicker({ value, label = "Dates" }: { value: DateRangeValue; label?: string }) {
  const { range, from, to, maxDays } = value;
  const phone = useIsPhone();
  const today = colomboDay();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<Picking>({ from, to });
  const [msg, setMsg] = useState<string | undefined>();
  const text = pickerText(range, from, to, today);
  const presets = value.oneDay ? PRESETS.filter(([k]) => k === "today" || k === "yesterday") : PRESETS;

  const show = () => {
    setPicking({ from, to });
    setMsg(undefined);
    setOpen(true);
  };
  const preset = (k: Exclude<RangeKey, "custom">) => {
    value.setRange(k);
    setOpen(false);
  };
  const apply = () => {
    const r = pickedRange(picking);
    if (!r) return setOpen(false);
    const err = value.setCustom(r.from, r.to);
    if (err) return setMsg(err);
    setOpen(false);
  };
  const picked = pickedRange(picking);
  const months = phone ? 1 : 2;
  // Two months: the later one is To's (history reads backwards); one month: To's.
  const toMonth = to.slice(0, 7);
  const initialMonth = months === 2 ? (from.slice(0, 7) !== toMonth ? from.slice(0, 7) : addMonths(toMonth, -1)) : toMonth;
  const limit = maxDays ? `At most ${maxDays} days at a time.` : undefined;

  return (
    <div className="dr" data-testid="date-range">
      <button ref={btn} type="button" className="btn dr-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${text}`}
        title={rangeText(from, to)} onClick={() => (open ? setOpen(false) : show())} data-testid="date-range-button">
        <Icon name="calendar" />
        <span>{text}</span>
        <Icon name="down" />
      </button>
      {value.error && <div className="status warn" role="alert">{value.error}</div>}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        anchor={btn}
        width={value.oneDay ? 360 : 640}
        quietTitle
        testId="date-range-sheet"
        footer={(
          <>
            <span className="muted small grow" data-testid="date-range-picked">
              {picked ? `${rangeText(picked.from, picked.to)}${picked.from !== picked.to ? ` · ${daysIn(picked.from, picked.to)} days` : ""}` : "Tap a start day"}
              {picking.from && !picking.to ? " · now tap the end day (or the same day again)" : ""}
            </span>
            <button type="button" className="btn primary" onClick={apply} data-testid="date-range-apply">Apply</button>
          </>
        )}
      >
        <div className={`dr-body${phone ? " phone" : ""}`}>
          <div className={phone ? "chips dr-presets" : "dr-presets list"} role="group" aria-label="Presets">
            {presets.map(([k, l]) => (
              <button key={k} type="button" className={phone ? "chip" : "dr-preset"} aria-pressed={range === k} onClick={() => preset(k)}>{l}</button>
            ))}
          </div>
          <div className="dr-cal">
            <Calendar
              initialMonth={initialMonth}
              months={months}
              picking={picking}
              onTap={(d) => { setMsg(undefined); setPicking(value.oneDay ? { from: d, to: d } : tapDay(picking, d)); }}
              maxDays={maxDays}
              today={today}
              disabledWhy={limit}
            />
            {limit && <p className="hint" style={{ margin: "6px 0 0" }} data-testid="date-range-limit">{limit} Days further than that are greyed out.</p>}
            {msg && <div className="status warn" role="alert">{msg}</div>}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
