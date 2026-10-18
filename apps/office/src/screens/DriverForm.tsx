// Add a driver (/drivers/new): name, code, mobile, username and the one-time
// PIN, shown once after the account is made. Kept as a draft.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { type DriverFields, emptyDriver, randomPin, validateNewDriver } from "./driverLogic";

export function DriverForm() {
  const { store, transport } = useFleet();
  const toast = useToast();
  const [f, setF, draft] = useFormDraft<DriverFields>("driver-new", null, emptyDriver);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ username: string; pin: string; name: string } | null>(null);
  const set = <K extends keyof DriverFields>(k: K, v: DriverFields[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewDriver(f);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      await transport.call("create_driver", v.input);
      draft.clear();
      setDone({ username: String(v.input.username), pin: String(v.input.pin), name: f.name });
      void store.invalidate();
      void store.load("lists.drivers", "list_drivers", {});
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <section className="view">
        <PageTop title="Driver added" sub={done.name} backTo="/drivers" />
        <div className="card card-b" style={{ maxWidth: 560 }}>
          <p>Give these to {done.name} for the Fame Driver app:</p>
          <dl className="kv">
            <div><dt>Username</dt><dd className="mono" style={{ fontSize: 20 }}>{done.username}</dd></div>
            <div><dt>PIN</dt><dd className="mono" style={{ fontSize: 20 }} data-testid="shown-pin">{done.pin}</dd></div>
          </dl>
          <p className="muted small">This is the only time the PIN is shown. If it is lost, set a new one from Manage.</p>
          <div className="acts">
            <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(done.pin).then(() => toast("Copied")); }}>Copy PIN</button>
            <Link className="btn dark" to="/drivers">Done</Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="view" data-testid="driver-form">
      <PageTop title="Add driver" sub="New Fame Driver sign-in" backTo="/drivers" />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        <div className="card card-b form">
          <div className="field"><label htmlFor="nd-name">Full name</label><input id="nd-name" maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} data-focus /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="nd-code">Employee code</label><input id="nd-code" maxLength={30} placeholder="E0123" value={f.code} onChange={(e) => set("code", e.target.value)} /></div>
            <div className="field"><label htmlFor="nd-phone">Mobile (needed)</label><input id="nd-phone" maxLength={30} inputMode="tel" placeholder="0771234567" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="nd-user">Username</label><input id="nd-user" maxLength={40} placeholder="nuwan.p" autoComplete="off" value={f.username} onChange={(e) => set("username", e.target.value)} /><span className="hint">Letters, numbers, dot, dash, underscore.</span></div>
            <div className="field"><label htmlFor="nd-pin">6-digit PIN</label>
              <div style={{ display: "flex", gap: 8 }}><input id="nd-pin" maxLength={6} inputMode="numeric" autoComplete="off" className="mono" value={f.pin} onChange={(e) => set("pin", e.target.value)} /><button type="button" className="btn" onClick={() => set("pin", randomPin())}>New</button></div>
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>The PIN is shown only now. Give it to the driver straight away.</p>
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
        <StickyActions><button className="btn primary" type="submit" disabled={busy}>Add driver</button></StickyActions>
      </form>
    </section>
  );
}
