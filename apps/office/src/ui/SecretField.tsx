// A password or PIN field: Material's password field with the visibility toggle (docs/ui-patterns.md §19). The eye at
// the right of the field shows the typed value as plain text and hides it again; hidden by default; the button says
// "Show password" / "Hide password" (a PIN: "Show PIN" / "Hide PIN") and carries aria-pressed, is reachable by keyboard
// and keeps the page's focus ring. Everything else (id, autoComplete, maxLength, inputMode, value) is the input's own, so
// a label's htmlFor and a form's rules stay as they were. The value is never logged (the error report sends only a
// message, a screen and a stack: transport/report.ts).
import { type CSSProperties, type InputHTMLAttributes, useState } from "react";
import { Icon } from "./icons";

export type SecretKind = "password" | "pin";

/** The eye's words, by what the field holds. */
export const SECRET_WORDS: Record<SecretKind, { show: string; hide: string }> = {
  password: { show: "Show password", hide: "Hide password" },
  pin: { show: "Show PIN", hide: "Hide PIN" },
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "style"> & {
  /** What the field holds: the eye's words. */
  kind?: SecretKind;
  /** The wrapper's style (the field sits in a flex row in some forms). */
  style?: CSSProperties;
};

export function SecretField({ kind = "password", style, ...input }: Props) {
  const [shown, setShown] = useState(false);
  const words = SECRET_WORDS[kind];
  return (
    <div className="secret" style={style}>
      <input {...input} type={shown ? "text" : "password"} />
      <button
        type="button"
        className="secret-eye"
        aria-label={shown ? words.hide : words.show}
        aria-pressed={shown}
        title={shown ? words.hide : words.show}
        onClick={() => setShown((v) => !v)}
      >
        <Icon name={shown ? "eye_off" : "eye"} />
      </button>
    </div>
  );
}
