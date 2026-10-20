// Hotfix O2-H2, Part 3: ONE set of selection controls for the site, the web form of the app's
// (apps/driver/src/components/patterns/Select.tsx), so a picked thing always looks picked (Gmail, WhatsApp's "Forward to",
// Google Contacts; Material 3's selection controls):
// - SelectableRow (pick many): an empty circle in front when not picked, a filled blue check circle when picked; the row
//   turns blue-chip tinted with a 2 px blue border. A click anywhere on the row toggles it (a label around a native
//   checkbox: role checkbox and its checked state come with it; Space toggles it).
// - ChoiceRow (pick one, a native radio of a named group) and ChoiceCard (pick one, a button with role radio and
//   aria-checked): a radio circle plus the same tint and border.
// - ChoiceChip: a chip (a toggle button, aria-pressed) with the check before its words when picked (the CSS draws it).
// - Checkbox / Radio: form basics; every native box and radio on the site is drawn the same way (styles.css, "Selection").
// Never colour alone: every picked state has its mark. A disabled one is greyed, not clickable, and says why when the page
// knows ("On a task"). The rules: docs/ui-patterns.md, "Selection".
import type { CSSProperties, ReactNode, Ref } from "react";

/** The mark alone: an empty circle / a filled check circle (check), an empty ring / a ring with a dot (radio), an empty box /
 *  a filled check box (box). Hidden from screen readers: the control around it says the state. */
export function SelectMark({ kind, on }: { kind: "check" | "radio" | "box"; on: boolean }) {
  return <span className={`sel-mark ${kind}${on ? " on" : ""}`} aria-hidden="true" data-testid={on ? "sel-mark-on" : "sel-mark-off"} />;
}

interface RowBase {
  disabled?: boolean;
  /** Why it cannot be picked: under the words, and in the box's description. */
  disabledReason?: string;
  children: ReactNode;
  /** After the words (a pill); never a button: the whole row is the control. */
  after?: ReactNode;
  /** The box's name for screen readers ("Ask Kamal Perera"). */
  label: string;
  testId?: string;
  className?: string;
}

const why = (disabled: boolean | undefined, reason: string | undefined) => (disabled && reason ? <span className="sub sel-why">{reason}</span> : null);

/** Pick many: a click anywhere toggles; the circle in front is the state, the row tints and borders. */
export function SelectableRow({ selected, onToggle, disabled, disabledReason, children, after, label, testId, className }: RowBase & {
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`sel-row${selected ? " on" : ""}${disabled ? " off" : ""}${className ? ` ${className}` : ""}`} data-testid={testId} title={disabled ? disabledReason : undefined}>
      <input type="checkbox" className="sel-input" checked={selected} disabled={disabled} onChange={() => onToggle()} aria-label={label} />
      <SelectMark kind="check" on={selected} />
      <span className="grow sel-body">{children}{why(disabled, disabledReason)}</span>
      {after}
    </label>
  );
}

/** Pick one of a named group (a native radio): the radio circle, the same tint and border when picked. */
export function ChoiceRow({ selected, onPick, name, value, disabled, disabledReason, children, after, label, testId, className }: RowBase & {
  selected: boolean;
  onPick: () => void;
  name: string;
  value: string;
}) {
  return (
    <label className={`sel-row${selected ? " on" : ""}${disabled ? " off" : ""}${className ? ` ${className}` : ""}`} data-testid={testId} title={disabled ? disabledReason : undefined}>
      <input type="radio" className="sel-input" name={name} value={value} checked={selected} disabled={disabled} onChange={() => onPick()} aria-label={label} />
      <SelectMark kind="radio" on={selected} />
      <span className="grow sel-body">{children}{why(disabled, disabledReason)}</span>
      {after}
    </label>
  );
}

/** Pick one, as a card (the question type): a button with role radio and aria-checked inside a role="radiogroup". */
export function ChoiceCard({ selected, onPick, disabled, children, testId, className, ref }: {
  /** The first card takes the focus when a sheet opens (React 19: ref as a prop). */
  ref?: Ref<HTMLButtonElement>;
  selected: boolean;
  onPick: () => void;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <button ref={ref} type="button" role="radio" aria-checked={selected} disabled={disabled} className={`sel-card${selected ? " on" : ""}${className ? ` ${className}` : ""}`} onClick={onPick} data-testid={testId}>
      <SelectMark kind="radio" on={selected} />
      <span className="sel-body">{children}</span>
    </button>
  );
}

/** A chip: a toggle button (aria-pressed); picked = the check before the words, the tint and the 2 px border (styles.css). */
export function ChoiceChip({ selected, onClick, children, disabled, title, testId, className, style }: {
  style?: CSSProperties;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
  testId?: string;
  className?: string;
}) {
  return (
    <button type="button" className={`chip${className ? ` ${className}` : ""}`} aria-pressed={selected} disabled={disabled} title={title} style={style} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

/** A form tick box with its words (the native box, drawn as the app's: styles.css). */
export function Checkbox({ checked, onChange, children, disabled, id, testId }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  id?: string;
  testId?: string;
}) {
  return (
    <label className={`check${disabled ? " off" : ""}`} data-testid={testId}>
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> <span>{children}</span>
    </label>
  );
}

/** A form radio with its words (one of a named group). */
export function Radio({ checked, onPick, name, value, children, disabled, testId }: {
  checked: boolean;
  onPick: () => void;
  name: string;
  value: string;
  children: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className={`check${disabled ? " off" : ""}`} data-testid={testId}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onPick()} /> <span>{children}</span>
    </label>
  );
}
