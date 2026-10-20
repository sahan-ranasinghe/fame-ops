// One day (docs/ui-patterns.md §3), three ways, all on the one calendar (Calendar.tsx):
// - DayStrip, a day of history (the Tasks board, the driver's day): a week strip of seven days, today marked and the
//   chosen day filled; ‹ › week by week, Today, and a calendar icon to jump to any date (past only where only the past
//   makes sense).
// - TripDayPicker, a trip's date (New request, Assign a task, Change the task, the decide pages, Ask drivers): Today and
//   Tomorrow chips and Pick a date (the calendar, any date from today); another day shows on its chip ("Thu 23 Oct").
// - DateField, a plain date (a document's expiry, Rented until, a day off): one field that opens the calendar, with Clear.
// The week maths are in dateRange.ts.
import { type RefObject, useEffect, useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { colomboDay, dayText, mondayOf, shiftWeek, stripCell, tripDayText, weekDays, weekTitle } from "./dateRange";
import { addDays } from "../lib/format";
import { Icon } from "./icons";
import { Sheet } from "./Sheet";

/** The calendar in a sheet: one tap picks the day and closes it. */
function PickSheet({ open, onClose, title, value, onPick, min, max, anchor }: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string;
  onPick: (day: string) => void;
  min?: string;
  max?: string;
  anchor: RefObject<HTMLElement | null>;
}) {
  const today = colomboDay();
  const start = (value || (min && min > today ? min : max && max < today ? max : today)).slice(0, 7);
  return (
    <Sheet open={open} onClose={onClose} title={title} anchor={anchor} width={320} testId="day-sheet">
      <Calendar
        initialMonth={start}
        picking={{ from: value || null, to: value || null }}
        onTap={(d) => { onPick(d); onClose(); }}
        min={min}
        max={max}
        today={today}
        disabledWhy={max === today ? "Only days up to today" : min === today ? "Only days from today" : undefined}
      />
    </Sheet>
  );
}

export function DayStrip({ value, onChange, pastOnly, label = "Day", testId = "day-strip" }: {
  value: string;
  onChange: (day: string) => void;
  /** Only today and the days before it (a driver's day: nothing is recorded tomorrow). */
  pastOnly?: boolean;
  label?: string;
  testId?: string;
}) {
  const today = colomboDay();
  const [monday, setMonday] = useState(() => mondayOf(value || today));
  const [open, setOpen] = useState(false);
  const cal = useRef<HTMLButtonElement>(null);
  // A day set from outside (Back, a link, Today) brings its week.
  useEffect(() => setMonday(mondayOf(value || today)), [value, today]);
  const days = weekDays(monday);
  const canOn = !pastOnly || shiftWeek(monday, 1) <= today;
  return (
    <div className="daystrip" role="group" aria-label={label} data-testid={testId}>
      <div className="daystrip-h">
        <b className="daystrip-t">{weekTitle(monday)}</b>
        <span className="daystrip-acts">
          <button type="button" className="btn small icon-btn" aria-label="Previous week" onClick={() => setMonday(shiftWeek(monday, -1))}>‹</button>
          <button type="button" className="btn small icon-btn" aria-label="Next week" disabled={!canOn} onClick={() => setMonday(shiftWeek(monday, 1))}>›</button>
          <button type="button" className="btn small" aria-pressed={value === today} onClick={() => onChange(today)}>Today</button>
          <button ref={cal} type="button" className="btn small icon-btn" aria-label="Pick a date" aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}><Icon name="calendar" /></button>
        </span>
      </div>
      <div className="daystrip-days">
        {days.map((d) => {
          const c = stripCell(d);
          const off = !!pastOnly && d > today;
          return (
            <button key={d} type="button" className={`daystrip-day${d === today ? " today" : ""}`} data-day={d} aria-label={dayText(d, true)}
              aria-pressed={d === value} aria-current={d === today ? "date" : undefined} disabled={off} onClick={() => onChange(d)}>
              <span className="wd">{c.weekday}</span>
              <span className="dn">{c.date}</span>
            </button>
          );
        })}
      </div>
      <PickSheet open={open} onClose={() => setOpen(false)} title={`${label}: pick a date`} value={value} onPick={onChange} max={pastOnly ? today : undefined} anchor={cal} />
    </div>
  );
}

export function TripDayPicker({ value, onChange, label = "Day", id, min, disabled }: {
  /** YYYY-MM-DD, or "" for none yet. */
  value: string;
  onChange: (day: string) => void;
  label?: string;
  /** The group's id (a form's label points at it). */
  id?: string;
  /** The first day that can be picked (default today). */
  min?: string;
  disabled?: boolean;
}) {
  const today = colomboDay();
  const tomorrow = addDays(today, 1);
  const [open, setOpen] = useState(false);
  const pick = useRef<HTMLButtonElement>(null);
  const other = !!value && value !== today && value !== tomorrow;
  return (
    <div className="tripday" role="group" aria-label={label} id={id} data-testid={id ? `${id}-picker` : "trip-day"} data-value={value || undefined}>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={value === today} disabled={disabled} onClick={() => onChange(today)}>Today</button>
        <button type="button" className="chip" aria-pressed={value === tomorrow} disabled={disabled} onClick={() => onChange(tomorrow)}>Tomorrow</button>
        <button ref={pick} type="button" className="chip with-ic" aria-pressed={other} aria-haspopup="dialog" disabled={disabled} onClick={() => setOpen((o) => !o)}
          aria-label={other ? `${label}: ${dayText(value, true)} · pick another date` : "Pick a date"} data-value={value || undefined}>
          <Icon name="calendar" />{other ? tripDayText(value, today) : "Pick a date"}
        </button>
      </div>
      <PickSheet open={open} onClose={() => setOpen(false)} title={`${label}: pick a date`} value={value} onPick={onChange} min={min ?? today} anchor={pick} />
    </div>
  );
}

export function DateField({ value, onChange, id, label, min, max, clearable = true, disabled, placeholder = "Pick a date" }: {
  /** YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (day: string) => void;
  /** The field's id (its <label htmlFor> names it). */
  id?: string;
  /** The sheet's title (the field's label). */
  label: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const today = colomboDay();
  const start = (value || today).slice(0, 7);
  return (
    <span className="datefield">
      <button ref={btn} id={id} type="button" className="datefield-btn" aria-haspopup="dialog" disabled={disabled} data-value={value || undefined}
        title={value ? dayText(value, true) : undefined} onClick={() => setOpen((o) => !o)}>
        <span className={value ? "mono" : "muted"}>{value ? dayText(value, true) : placeholder}</span>
        <Icon name="calendar" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label} anchor={btn} width={320} testId="date-field-sheet"
        footer={clearable && value ? <button type="button" className="btn" onClick={() => { onChange(""); setOpen(false); }}>Clear</button> : undefined}>
        <Calendar
          key={start}
          initialMonth={value ? start : min && min > today ? min.slice(0, 7) : max && max < today ? max.slice(0, 7) : start}
          picking={{ from: value || null, to: value || null }}
          onTap={(d) => { onChange(d); setOpen(false); }}
          min={min}
          max={max}
          today={today}
        />
      </Sheet>
    </span>
  );
}
