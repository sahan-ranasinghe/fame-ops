// One time field for every form (Hotfix 2, C): the leave time, the arrive-by on
// a stop, back by, the time needed, the request's times. The browser's time
// field changes its value with every part typed (the hours, the minutes, then
// AM/PM: "02:00", then "14:00"), so the form would plan and warn for every step.
// Here the value counts only when it is done: on blur, on Enter, or 1 s after
// the last change when it is a whole valid HH:MM. Until then the field shows
// what is typed and the form (its plan, its warnings) keeps the value before.
// A value set from outside (Use 07:24, a draft resumed, the plan's own time)
// shows at once, unless the person is typing another one.
import { type InputHTMLAttributes, type KeyboardEvent, useEffect, useRef, useState } from "react";

/** A typed time counts this long after its last change, when it is whole and valid. */
export const TIME_SETTLE_MS = 1000;

/** "07:05", "23:59": a whole time as the field gives it (no seconds). */
export const isWholeTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "defaultValue"> & {
  /** The value the form holds: "HH:MM", or "" for none. */
  value: string;
  /** The finished value: "HH:MM", or "" when the field was emptied. Called once per finished change. */
  onCommit: (value: string) => void;
};

export function TimeInput({ value, onCommit, onBlur, onKeyDown, ...rest }: Props) {
  const [text, setText] = useState(value);
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
  const commit = (v: string) => {
    stop();
    if (v !== "" && !isWholeTime(v)) {
      // Not a time (the browser never gives one, but a test or an old browser might): back to what the form holds.
      typed.current = held.current;
      setText(held.current);
      return;
    }
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
    <input
      {...rest}
      type="time"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        typed.current = v;
        setText(v);
        stop();
        if (isWholeTime(v)) timer.current = setTimeout(() => commit(typed.current), TIME_SETTLE_MS);
      }}
      onBlur={(e) => {
        commit(typed.current);
        onBlur?.(e);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        // Enter finishes the time here; it does not send the form with the value before it.
        if (e.key === "Enter") {
          e.preventDefault();
          commit(typed.current);
        }
        onKeyDown?.(e);
      }}
    />
  );
}
