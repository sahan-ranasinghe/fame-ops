// Signed in, but Fame Fleet did not answer /me (Sahan, 19 October 2026): the session is kept and Try again asks again.
// Never the sign-in page for this: only a 401 or 403 means signed out (AuthProvider).
import { useState } from "react";
import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

export function Unreachable() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  if (auth.state.step !== "unreachable") return null;

  async function again() {
    setBusy(true);
    await auth.recheck();
    setBusy(false);
  }

  return (
    <AuthPage eyebrow="Fame Global Solutions" title="Not reachable">
      <div className="card card-b" style={{ display: "grid", gap: 14 }} data-testid="unreachable">
        <Notice tone="bad">{auth.state.message}</Notice>
        <p className="muted" style={{ margin: 0 }}>You are still signed in. Check the connection, then try again.</p>
        <button type="button" className="btn primary wide" disabled={busy} onClick={() => void again()}>
          {busy ? "Trying…" : "Try again"}
        </button>
        <button type="button" className="linkish" onClick={() => void auth.signOut()}>Sign out</button>
      </div>
    </AuthPage>
  );
}
