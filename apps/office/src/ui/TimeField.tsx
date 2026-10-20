// One time field for every form (Hotfix 2, C; docs/ui-patterns.md §4): the leave time, an arrive-by, back by, a day off's
// hours. It shows HH:MM (mono) or a dash.
// - On a desktop it can be typed (the site's typed rule: the value counts on blur, on Enter, or 1 s after the last change
//   when it is a whole HH:MM; "9", "930", "9.30" mean 09:00 and 09:30 when the field is left), and a click (or ↓) drops
//   the time list under it: the suggested time ("Planned 07:24"), Now (rounded up to 5 min), the common times, then every
//   5 minutes scrolled to the value. Until a value counts the form (its plan, its warnings) keeps the one before.
// - On a phone it is never typed: a tap opens the time sheet with the same chips and list, Clear and Done.
// A value set from outside (Use 07:24, a draft resumed, the plan's own time) shows at once, unless the person is typing
// another one. Replaces ui/TimeInput.tsx; the rules are in timeLogic.ts.
import { type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { useIsPhone } from "./phone";
import { Sheet } from "./Sheet";
import { isWholeTime, nearestStep, nowRounded, parseTyped, sheetChips, TIME_SETTLE_MS, timeSteps } from "./timeLogic";

export { isWholeTime, TIME_SETTLE_MS } from "./timeLogic";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "defaultValue"> & {
  /** The value the form holds: "HH:MM", or "" for none. */
  value: string;
  /** The finished value: "HH:MM", or "" when the field was emptied. Called once per finished change. */
  onCommit: (value: string) => void;
  /** A suggested time, the first chip ("Planned 07:24"). */
  suggested?: string;
  /** The suggested chip's word (default "Planned"). */
  suggestedLabel?: string;
};

const STEPS = timeSteps();

/** The chips and the 5-minute list, shared by the desktop drop-down and the phone sheet. */
function TimeChoices({ value, suggested, suggestedLabel, onPick, listRef, mouseKeepsFocus }: {
  value: string;
  suggested?: string;
  suggestedLabel?: string;
  onPick: (t: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
  mouseKeepsFocus?: boolean;
}) {
  const now = nowRounded();
  const chips = sheetChips(now, suggested).map((c) => (c.kind === "suggested" && suggestedLabel ? { ...c, label: `${suggestedLabel} ${c.time}` } : c));
  const target = nearestStep(value, now);
  // The desktop list keeps the focus in the field (a press would blur it and count what is typed first).
  const keep = mouseKeepsFocus ? { onMouseDown: (e: MouseEvent) => e.preventDefault() } : {};
  return (
    <div className="tf-choices">
      <div className="chips tf-chips" role="group" aria-label="Quick times">
        {chips.map((c) => (
          <button key={c.kind + c.time} type="button" className={`chip${c.kind === "suggested" ? " suggested" : ""}`} aria-pressed={value === c.time}
            data-time={c.time} onClick={() => onPick(c.time)} {...keep}>
            {c.kind === "now" ? <>Now <span className="mono">{c.time}</span></> : c.kind === "suggested" ? c.label : <span className="mono">{c.time}</span>}
          </button>
        ))}
      </div>
      <div className="tf-list" ref={listRef} role="listbox" aria-label="Every 5 minutes">
        {STEPS.map((t) => (
          <button key={t} type="button" role="option" className="tf-opt mono" aria-selected={t === value} data-time={t} data-near={t === target || undefined}
            onClick={() => onPick(t)} {...keep}>{t}</button>
        ))}
      </div>
    </div>
  );
}

/** Scrolls the list to the value's step (or now) when it opens. */
function useScrollToNear(open: boolean, listRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const near = list?.querySelector<HTMLElement>("[data-near]");
    if (list && near) list.scrollTop = Math.max(0, near.offsetTop - list.clientHeight / 2 + near.offsetHeight / 2);
  }, [open, listRef]);
}

export function TimeField(props: Props) {
  const phone = useIsPhone();
  return phone ? <PhoneTime {...props} /> : <DesktopTime {...props} />;
}

function PhoneTime({ value, onCommit, suggested, suggestedLabel, id, disabled, className, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollToNear(open, listRef);
  const pick = (t: string) => {
    if (t !== value) onCommit(t);
    setOpen(false);
  };
  const label = rest["aria-label"];
  return (
    <>
      <button ref={btn} id={id} type="button" className={`timefield-btn ${className ?? ""}`} disabled={disabled} aria-haspopup="dialog" aria-label={label}
        data-value={value || undefined} onClick={() => setOpen(true)}>
        <span className={value ? "mono" : "muted"}>{value || "–"}</span>
        <Icon name="clock" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pick a time" anchor={btn} testId="time-sheet"
        footer={(
          <>
            <button type="button" className="btn" onClick={() => pick("")} disabled={!value}>Clear</button>
            <button type="button" className="btn primary" onClick={() => setOpen(false)}>Done</button>
          </>
        )}>
        <TimeChoices value={value} suggested={suggested} suggestedLabel={suggestedLabel} onPick={pick} listRef={listRef} />
      </Sheet>
    </>
  );
}

function DesktopTime({ value, onCommit, onBlur, onKeyDown, onFocus, suggested, suggestedLabel, className, ...rest }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // What the form holds as far as this field knows (its value, or the last value handed to it).
  const held = useRef(value);
  const typed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useScrollToNear(open, listRef);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const commit = (raw: string) => {
    stop();
    const v = parseTyped(raw);
    if (v === null) {
      // Not a time: back to what the form holds.
      typed.current = held.current;
      setText(held.current);
      return;
    }
    typed.current = v;
    setText(v);
    if (v === held.current) return;
    held.current = v;
    commitRef.current(v);
  };

  // A value set from outside: shown, unless the person is typing a different one (theirs counts when they finish).
  useEffect(() => {
    if (value === held.current) return;
    const editing = typed.current !== held.current;
    held.current = value;
    if (!editing) {
      typed.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => stop, []);

  return (
    <span className="timefield">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={rest.placeholder ?? "HH:MM"}
        className={`mono ${className ?? ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="none"
        maxLength={5}
        value={text}
        onFocus={onFocus}
        onClick={() => { if (!rest.readOnly && !rest.disabled) setOpen(true); }}
        onChange={(e) => {
          const v = e.target.value;
          typed.current = v;
          setText(v);
          stop();
          if (v === "" || isWholeTime(v)) {
            if (isWholeTime(v)) timer.current = setTimeout(() => commit(typed.current), TIME_SETTLE_MS);
          }
        }}
        onBlur={(e) => {
          setOpen(false);
          commit(typed.current);
          onBlur?.(e);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          // Enter finishes the time here; it does not send the form with the value before it.
          if (e.key === "Enter") {
            e.preventDefault();
            setOpen(false);
            commit(typed.current);
          } else if (e.key === "Escape" && open) {
            // The list closes first; the next Esc is the page's.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown" && !open) setOpen(true);
          onKeyDown?.(e);
        }}
      />
      {open && (
        <div className="tf-drop" id={listId} data-testid="time-list">
          <TimeChoices value={text} suggested={suggested} suggestedLabel={suggestedLabel} listRef={listRef} mouseKeepsFocus
            onPick={(t) => { setOpen(false); commit(t); }} />
        </div>
      )}
    </span>
  );
}
