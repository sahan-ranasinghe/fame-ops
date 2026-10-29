import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { SecretField } from "../ui/SecretField";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

/**
 * Office passwords (Sahan, 29 October 2026): at least 6 characters, any characters and spaces, nothing forced; the server's
 * rule (passwordLinks.ts) and Auth's own minimum are the same 6. Counted as characters (a Sinhala letter is one).
 */
export const MIN_PASSWORD = 6;
/** bcrypt reads 72 bytes; Auth refuses more. */
export const MAX_PASSWORD_BYTES = 72;
/** Characters, not UTF-16 units. */
export const passwordLength = (p: string) => Array.from(p).length;

export function SetPassword() {
  const auth = useAuth();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (passwordLength(p1) < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (new TextEncoder().encode(p1).length > MAX_PASSWORD_BYTES) {
      setError("Too long: use at most 72 English letters or numbers (a Sinhala letter counts as 3).");
      return;
    }
    if (p1 !== p2) {
      setError("The two passwords differ.");
      return;
    }
    setBusy(true);
    setError(await auth.setPassword(p1));
    setBusy(false);
  }

  return (
    <AuthPage eyebrow="Your Fame Fleet account" title="Choose a password">
      <form className="card card-b form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="sp-1">New password</label>
          <SecretField id="sp-1" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus />
          <span className="hint">At least {MIN_PASSWORD} characters. Longer is safer.</span>
        </div>
        <div className="field">
          <label htmlFor="sp-2">Again</label>
          <SecretField id="sp-2" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary wide" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthPage>
  );
}
