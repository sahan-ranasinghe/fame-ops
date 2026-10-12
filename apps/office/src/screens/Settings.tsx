// Sign-in and security (web build only): 2-step sign-in, on or off, per person.
import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { verifiedTotpFactor } from "../auth/AuthProvider";
import { supabase } from "../auth/supabase";
import { type Enrolment, startTotpEnrol, TotpEnrol } from "../auth/TotpEnrol";
import { Loading, Notice, Pill } from "../ui/basics";
import { useToast } from "../ui/Toast";

type State = { kind: "loading" } | { kind: "off" } | { kind: "on"; factorId: string } | { kind: "enrolling"; enrol: Enrolment };

export default function Settings() {
  const { me } = useFleet();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const factor = await verifiedTotpFactor();
    setState(factor ? { kind: "on", factorId: factor.id } : { kind: "off" });
  }
  useEffect(() => { void refresh(); }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    const r = await startTotpEnrol();
    setBusy(false);
    if ("error" in r) setError(r.error);
    else setState({ kind: "enrolling", enrol: r.enrol });
  }

  async function turnOff() {
    if (!supabase || state.kind !== "on") return;
    setBusy(true);
    const { error: err } = await supabase.auth.mfa.unenroll({ factorId: state.factorId });
    setBusy(false);
    if (err) {
      setError(/aal2|assurance/i.test(err.message) ? "Sign out and in again (with your code) before turning 2-step off." : err.message);
      return;
    }
    toast("2-step sign-in is off");
    await refresh();
  }

  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Sign-in and security</div><h1>Settings</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="card card-b" style={{ display: "grid", gap: 14 }}>
          <div className="row" style={{ padding: 0 }}>
            <div className="grow">
              <h2>2-step sign-in</h2>
              <p className="muted" style={{ margin: "4px 0 0" }}>A code from an authenticator app on your phone, asked at every sign-in. Optional; recommended for admins.</p>
            </div>
            {state.kind === "on" && <Pill tone="ok">On</Pill>}
            {state.kind === "off" && <Pill>Off</Pill>}
          </div>
          {state.kind === "loading" && <Loading>Checking…</Loading>}
          {state.kind === "off" && <div><button type="button" className="btn primary" disabled={busy} onClick={() => void turnOn()}>{busy ? "Starting…" : "Turn on 2-step sign-in"}</button></div>}
          {state.kind === "enrolling" && (
            <TotpEnrol
              enrol={state.enrol}
              onDone={() => { toast("2-step sign-in is on"); void refresh(); }}
              onCancel={() => void refresh()}
            />
          )}
          {state.kind === "on" && (
            <div className="acts">
              <button type="button" className="btn" disabled={busy} onClick={() => void turnOff()}>Turn off</button>
              {me.mfa_required && <span className="hint">Your role must keep 2-step on.</span>}
            </div>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
        <div className="card card-b">
          <h2>Password</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>Forgot it? The fleet admin sends you a new set-password link. Passwords have at least 12 characters.</p>
        </div>
      </div>
    </section>
  );
}
