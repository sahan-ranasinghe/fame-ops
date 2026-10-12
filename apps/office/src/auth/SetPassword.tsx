import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

export const MIN_PASSWORD = 10;

export function SetPassword() {
  const auth = useAuth();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (p1.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
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
          <input id="sp-1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} autoFocus />
          <span className="hint">At least {MIN_PASSWORD} characters. A sentence is easy to remember and hard to guess.</span>
        </div>
        <div className="field">
          <label htmlFor="sp-2">Again</label>
          <input id="sp-2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary wide" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthPage>
  );
}
