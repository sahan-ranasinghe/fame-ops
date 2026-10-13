import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Driver, DriversList } from "../data/types";
import { locTone } from "../lib/format";
import { ROUTES_NEED } from "../app/nav";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { Avatar, Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { DrawerTop, useDirty, useDraft, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { emptyDriver, isPin, randomPin, validateNewDriver } from "./driverLogic";
import { docTone } from "./vehicleLogic";

export function Drivers() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const [inactive, setInactive] = useState(false);
  const entry = useEntry<DriversList>("drivers");
  const canManage = me.tools.includes("update_driver");
  const routes = can(me, ...ROUTES_NEED);

  useEffect(() => {
    if (noConnector) return;
    store.reset("drivers");
    store.watch("drivers", "list_drivers", { include_inactive: inactive }, 60000);
    return () => store.unwatch("drivers");
  }, [store, inactive, noConnector]);

  const d = entry.data;
  const list = d?.drivers ?? [];
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Fame Driver sign-ins</div><h1>Drivers</h1></div>
        <div className="ph-actions">
          <span className="check"><input type="checkbox" id="drv-inactive" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> <label htmlFor="drv-inactive">Show switched-off drivers</label></span>
          {me.tools.includes("create_driver") && <button type="button" className="btn primary" onClick={() => drawer.open(<NewDriverDrawer />)}>Add driver</button>}
        </div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("drivers", "list_drivers", { include_inactive: inactive })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading drivers…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card">
            {list.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Driver</th><th>Code</th><th>Username</th><th>Phone</th><th>Licence expires</th><th>Vehicle</th><th>Location</th><th>Last 30 days</th><th className="r"></th></tr></thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.username}>
                        <td><div className="name"><Avatar name={x.name} small />{x.username && routes ? <Link to={`/drivers/${x.username}`}>{x.name}</Link> : x.name}</div>{x.active === false && <Pill tone="bad">Switched off</Pill>}</td>
                        <td className="mono">{x.code || "—"}</td>
                        <td className="mono">{x.username || "—"}</td>
                        <td>{x.phone || "—"}</td>
                        <td>{x.licence?.expiry ? <span className={`doc ${docTone(x.licence.chip)}`}>{x.licence.expiry}</span> : "—"}</td>
                        <td>{x.current_vehicle ? <Plate v={x.current_vehicle} /> : "—"}</td>
                        <td>{x.location ? <Pill tone={locTone(x.location)}>{x.location}</Pill> : "—"}</td>
                        <td className="small">{x.last_30_days ? <>{x.last_30_days.accepted} accepted{x.last_30_days.declined ? <span className="status bad"> · {x.last_30_days.declined} declined</span> : " · 0 declined"}</> : "—"}</td>
                        <td className="r">{canManage && <button type="button" className="btn small" onClick={() => drawer.open(<DriverDrawer driver={x} />)}>Manage</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No drivers yet. Add the first one with Add driver.</Empty>}
          </div>
        </>
      )}
    </section>
  );
}

function NewDriverDrawer() {
  const { store, transport } = useFleet();
  const [f, setF, markClean] = useDraft(emptyDriver());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ username: string; pin: string } | null>(null);
  const toast = useToast();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

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
      markClean();
      setDone({ username: String(v.input.username), pin: String(v.input.pin) });
      void store.invalidate();
      void store.load("lists.drivers", "list_drivers", {});
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <DrawerTop title="Driver added" sub={f.name} />
        <div className="card card-b">
          <p>Give these to {f.name} for the Fame Driver app:</p>
          <dl className="kv">
            <div><dt>Username</dt><dd className="mono" style={{ fontSize: 20 }}>{done.username}</dd></div>
            <div><dt>PIN</dt><dd className="mono" style={{ fontSize: 20 }} data-testid="shown-pin">{done.pin}</dd></div>
          </dl>
          <p className="muted small">This is the only time the PIN is shown. If it is lost, set a new one from Manage.</p>
          <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(done.pin).then(() => toast("Copied")); }}>Copy PIN</button>
        </div>
      </>
    );
  }
  return (
    <>
      <DrawerTop title="Add driver" sub="New Fame Driver sign-in" />
      <form className="card card-b form" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="nd-name">Full name</label><input id="nd-name" maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} data-focus /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="nd-code">Employee code</label><input id="nd-code" maxLength={30} placeholder="E0123" value={f.code} onChange={(e) => set("code", e.target.value)} /></div>
          <div className="field"><label htmlFor="nd-phone">Mobile</label><input id="nd-phone" maxLength={30} inputMode="tel" placeholder="0771234567" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        </div>
        <div className="grid2">
          <div className="field"><label htmlFor="nd-user">Username</label><input id="nd-user" maxLength={40} placeholder="nuwan.p" autoComplete="off" value={f.username} onChange={(e) => set("username", e.target.value)} /><span className="hint">Letters, numbers, dot, dash, underscore.</span></div>
          <div className="field"><label htmlFor="nd-pin">6-digit PIN</label>
            <div style={{ display: "flex", gap: 8 }}><input id="nd-pin" maxLength={6} inputMode="numeric" autoComplete="off" className="mono" value={f.pin} onChange={(e) => set("pin", e.target.value)} /><button type="button" className="btn" onClick={() => set("pin", randomPin())}>New</button></div>
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>The PIN is shown only now. Give it to the driver straight away.</p>
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn primary" type="submit" disabled={busy}>Add driver</button>
      </form>
    </>
  );
}

function DriverDrawer({ driver: x }: { driver: Driver }) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const off = x.active === false;
  const [phone, setPhone] = useState(x.phone ?? "");
  const [lic, setLic] = useState(x.licence?.expiry ?? "");
  const [edMsg, setEdMsg] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [armed, setArmed] = useState(false);
  const [saMsg, setSaMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useDirty(phone !== (x.phone ?? "") || lic !== (x.licence?.expiry ?? "") || pin.trim() !== "");

  const after = () => {
    void store.invalidate();
    void store.load("lists.drivers", "list_drivers", {});
  };

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      await transport.call("update_driver", { username: x.username, phone: phone.trim() || null, licence_expiry: lic || null });
      toast("Driver updated");
      after();
      drawer.close();
    } catch (e) {
      setEdMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }
  async function setNewPin(ev: FormEvent) {
    ev.preventDefault();
    if (!isPin(pin.trim())) {
      setPinMsg({ tone: "bad", text: "The PIN must be exactly 6 digits." });
      return;
    }
    try {
      await transport.call("reset_pin", { username: x.username, pin: pin.trim() });
      setPinMsg({ tone: "ok", text: `New PIN ${pin.trim()} is active. Tell the driver now.` });
      setPin("");
    } catch (e) {
      setPinMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
  }
  async function toggle() {
    const want = off;
    if (!want && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      const out = await transport.call<{ notes?: string[] }>("set_driver_active", { username: x.username, active: want });
      toast(want ? "Driver switched on" : "Driver switched off");
      if (out.notes?.length) toast(out.notes[0]);
      after();
      drawer.close();
    } catch (e) {
      setSaMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <>
      <DrawerTop title={x.name} sub={<><span className="mono">{x.username}</span> · {x.code || ""}</>} />
      <form className="card card-b form" onSubmit={save}>
        <h2>Contact and licence</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="ed-phone">Mobile</label><input id="ed-phone" maxLength={30} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field"><label htmlFor="ed-lic">Driving licence expires</label><input type="date" id="ed-lic" value={lic} onChange={(e) => setLic(e.target.value)} /></div>
        </div>
        {edMsg && <Notice tone="bad">{edMsg}</Notice>}
        <button className="btn dark" type="submit" disabled={busy}>Save</button>
      </form>
      {me.tools.includes("reset_pin") && (
        <form className="card card-b form" onSubmit={setNewPin}>
          <h2>New PIN</h2>
          <p className="muted small" style={{ margin: 0 }}>The old PIN stops working at once.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input maxLength={6} inputMode="numeric" autoComplete="off" className="mono" style={{ flex: "1 1 140px" }} aria-label="New 6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button type="button" className="btn" onClick={() => setPin(randomPin())}>New</button>
            <button className="btn dark" type="submit">Set PIN</button>
          </div>
          {pinMsg && <Notice tone={pinMsg.tone}>{pinMsg.text}</Notice>}
        </form>
      )}
      {me.tools.includes("set_driver_active") && (
        <div className="confirm" style={off ? { borderColor: "var(--line)" } : undefined}>
          <div>
            <b>{off ? "Switch this driver back on" : "Switch off this driver"}</b>
            <p className="muted small" style={{ margin: "4px 0 0" }}>{off ? "They can sign in again." : "They can no longer sign in, and location sharing ends. Nothing is deleted."}</p>
          </div>
          {saMsg && <Notice tone="bad">{saMsg}</Notice>}
          <button type="button" className={`btn ${off ? "dark" : "danger"}`} disabled={busy} onClick={() => void toggle()}>{off ? "Switch on" : armed ? "Yes, switch off" : "Switch off"}</button>
        </div>
      )}
    </>
  );
}
