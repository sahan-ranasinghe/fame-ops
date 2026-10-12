import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";

/** The QR code from Supabase: raw SVG or a data URL; either way an <img> can show it. */
export function qrSrc(qr?: string): string | undefined {
  if (!qr) return undefined;
  if (qr.startsWith("data:")) return qr;
  return "data:image/svg+xml;utf8," + encodeURIComponent(qr);
}

export function SecondStep() {
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (auth.state.step !== "second_step") return null;
  const { mode, secret, qr } = auth.state;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      setError("Type the 6-digit code from the app.");
      return;
    }
    setBusy(true);
    setError(await auth.verifyCode(code));
    setBusy(false);
  }

  return (
    <AuthPage eyebrow="Second sign-in step" title={mode === "enrol" ? "Set up your authenticator" : "Enter your code"}>
      <form className="card card-b form" onSubmit={submit} noValidate>
        {mode === "enrol" && (
          <>
            <p style={{ margin: 0 }}>
              Your role needs a second step at every sign-in. Install Google Authenticator (or any authenticator app), scan this code, then type the 6 digits it shows.
            </p>
            <div className="qr">
              {qrSrc(qr) ? <img src={qrSrc(qr)} alt="QR code for the authenticator app" /> : null}
              <span className="hint">Can’t scan? Add the key by hand:</span>
              <span className="secret" data-testid="totp-secret">{secret}</span>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="ss-code">6-digit code</label>
          <input id="ss-code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary wide" type="submit" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
        <button type="button" className="linkish" onClick={() => void auth.signOut()}>Sign out</button>
      </form>
    </AuthPage>
  );
}
