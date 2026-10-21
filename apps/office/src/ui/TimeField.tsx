// One time field for every form (Hotfix 2, C; docs/ui-patterns.md §4): the leave time, an arrive-by, back by, a day off's
// hours. It shows HH:MM (mono) or a dash.
// - On a desktop it can be typed (the site's typed rule: the value counts on blur, on Enter, or 1 s after the last change
//   when it is a whole HH:MM; "9", "930", "9.30" mean 09:00 and 09:30 when the field is left), and a click (or ↓) drops
//   the clock under it (21 October 2026: Material 3's time picker, any minute, with its keyboard toggle; TimeDial.tsx;
//   no quick-time chips since the boss's review), which fills the field as typing does. Until a value counts the form
//   (its plan, its warnings) keeps the one before. A suggestion (the planner's) is the grey placeholder.
// - On a phone it is never typed: a tap opens the time sheet with the clock, Clear and Done.
// A value set from outside (Use 07:24, a draft resumed, the plan's own time) shows at once, unless the person is typing
// another one. Replaces ui/TimeInput.tsx; the rules are in timeLogic.ts.
import { type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { useIsPhone } from "./phone";
import { Sheet } from "./Sheet";
import { TimeDial } from "./TimeDial";
import { isWholeTime, nowExact, parseTyped, TIME_SETTLE_MS } from "./timeLogic";

export { isWholeTime, TIME_SETTLE_MS } from "./timeLogic";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "defaultValue"> & {
  /** The value the form holds: "HH:MM", or "" for none. */
  value: string;
  /** The finished value: "HH:MM", or "" when the field was emptied. Called once per finished change. */
  onCommit: (value: string) => void;
  /** A suggested time (the planner's): shown in grey in the empty field ("07:24 · suggested"), where the clock starts. */
  suggested?: string;
};

/** The clock, shared by the desktop drop-down and the phone sheet (21 October 2026: only the dial with its keyboard
 *  toggle; the quick-time chips are gone). It starts at the value, else the suggestion, else now. */
function TimeChoices({ value, dial, onDial, suggested, mouseKeepsFocus }: {
  value: string;
  dial: string;
  onDial: (t: string) => void;
  suggested?: string;
  mouseKeepsFocus?: boolean;
}) {
  // The desktop chooser keeps the focus in the field (a press would blur it and count what is typed first).
  const keep = mouseKeepsFocus ? { onMouseDown: (e: MouseEvent) => e.preventDefault() } : {};
  return (
    <div className="tf-choices" {...keep}>
      <TimeDial value={isWholeTime(dial) ? dial : isWholeTime(value) ? value : suggested && isWholeTime(suggested) ? suggested : nowExact()} onChange={onDial} />
    </div>
  );
}

export function TimeField(props: Props) {
  const phone = useIsPhone();
  return phone ? <PhoneTime {...props} /> : <DesktopTime {...props} />;
}

function PhoneTime({ value, onCommit, suggested, id, disabled, className, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [dial, setDial] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const pick = (t: string) => {
    if (t !== value) onCommit(t);
    setOpen(false);
  };
  const label = rest["aria-label"];
  return (
    <>
      <button ref={btn} id={id} type="button" className={`timefield-btn ${className ?? ""}`} disabled={disabled} aria-haspopup="dialog" aria-label={label}
        data-value={value || undefined} onClick={() => { setDial(""); setOpen(true); }}>
        {value ? <span className="mono">{value}</span> : <span className="muted">{suggested && isWholeTime(suggested) ? <><span className="mono">{suggested}</span> · suggested</> : "–"}</span>}
        <Icon name="clock" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Pick a time" anchor={btn} testId="time-sheet"
        footer={(
          <>
            <button type="button" className="btn" onClick={() => pick("")} disabled={!value}>Clear</button>
            <button type="button" className="btn primary" onClick={() => { const t = isWholeTime(dial) ? dial : !value && suggested && isWholeTime(suggested) ? suggested : ""; if (t) pick(t); else setOpen(false); }}>Done</button>
          </>
        )}>
        <TimeChoices value={value} dial={dial} onDial={setDial} suggested={suggested} />
      </Sheet>
    </>
  );
}

function DesktopTime({ value, onCommit, onBlur, onKeyDown, onFocus, suggested, className, ...rest }: Props) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const listId = useId();
  // What the form holds as far as this field knows (its value, or the last value handed to it).
  const held = useRef(value);
  const typed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

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
        placeholder={rest.placeholder ?? (suggested && isWholeTime(suggested) ? suggested : "HH:MM")}
        title={!text && suggested && isWholeTime(suggested) ? `${suggested} · suggested` : rest.title}
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
          <TimeChoices value={text} dial={text} suggested={suggested} mouseKeepsFocus
            onDial={(t) => { typed.current = t; setText(t); stop(); timer.current = setTimeout(() => commit(typed.current), TIME_SETTLE_MS); }} />
        </div>
      )}
    </span>
  );
}
