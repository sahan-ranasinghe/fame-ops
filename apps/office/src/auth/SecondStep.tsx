import { type FormEvent, useState } from "react";
import { Notice } from "../ui/basics";
import { AuthPage } from "./AuthPage";
import { useAuth } from "./AuthProvider";
import { type Enrolment, startTotpEnrol, TotpEnrol } from "./TotpEnrol";

export function SecondStep() {
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  if (auth.state.step !== "second_step") return null;

  if (auth.state.mode === "enrol") {
    const start = async () => {
      setBusy(true);
      const r = await startTotpEnrol();
      setBusy(false);
      if ("error" in r) setError(r.error);
      else setEnrol(r.enrol);
    };
    return (
      <AuthPage eyebrow="Second sign-in step" title="Set up your authenticator">
        <div className="card card-b">
          <Notice tone="info">Your role must use 2-step sign-in. Set it up once; it takes a minute.</Notice>
          {enrol
            ? <TotpEnrol enrol={enrol} onDone={() => void auth.recheck()} confirmLabel="Continue" />
            : <div><button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? "Starting…" : "Set up now"}</button></div>}
          {error && <Notice tone="bad">{error}</Notice>}
          <button type="button" className="linkish" onClick={() => void auth.signOut()}>Sign out</button>
        </div>
      </AuthPage>
    );
  }

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
    <AuthPage eyebrow="Second sign-in step" title="Enter your code">
      <form className="card card-b form" onSubmit={submit} noValidate>
        <p style={{ margin: 0 }}>You turned on 2-step sign-in. Open your authenticator app and type the code for Fame Fleet.</p>
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
