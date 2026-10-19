// Settings → Notifications (web only): which events reach this person, this
// browser's push state with one button, and the browsers notifications are on in.
// The server honours the toggles at queue time; notify-office pushes to every
// device. The artifact has no service worker: it points to the web app.
import { useEffect, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import type { NotificationSettings } from "../../data/types";
import { currentSubscription, endpointHash, pushState } from "../../push";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Empty, Loading, Notice, Pill } from "../../ui/basics";
import { useToast } from "../../ui/Toast";
import { removeDevice, setEvent, turnOffHere, turnOnHere } from "./notificationsActions";
import { DEVICE_NOTE, type PushState, stateText } from "./notificationsLogic";
import { callWithRetry } from "../../transport/retryRule";
import { SoundCard } from "./SoundCard";

const TOOL_ARGS = {};

export default function Notifications() {
  const { transport } = useFleet();
  const toast = useToast();
  const [data, setData] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<PushState>("off");
  const [myHash, setMyHash] = useState("");

  async function load() {
    try {
      setData(await callWithRetry<NotificationSettings>(transport, "my_notification_settings", TOOL_ARGS));
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  async function refreshBrowser() {
    const s = await pushState();
    setState(s);
    const sub = s === "on" ? await currentSubscription() : null;
    setMyHash(sub ? await endpointHash(sub.endpoint) : "");
  }
  useEffect(() => {
    void load();
    void refreshBrowser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<NotificationSettings | void>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      if (next) setData(next);
      toast(done);
    } catch (e) {
      setMsg(e instanceof Error && !("code" in e) ? e.message : errText(e as FleetError)[0]);
      await load(); // back to what the server has
    }
    await refreshBrowser();
    setBusy(false);
  }
  // The box flips at once; the server's answer (or an error) settles it.
  const toggle = (event: string, enabled: boolean) => {
    setData((d) => d && { ...d, events: d.events.map((e) => (e.event === event ? { ...e, enabled } : e)) });
    return run(() => setEvent(transport, event, enabled), "Saved");
  };
  const turnOn = () => run(() => turnOnHere(transport, data!.push.public_key!), "Notifications are on in this browser");
  const turnOff = () => run(() => turnOffHere(transport), "Notifications are off in this browser");
  const remove = (id: string) => run(() => removeDevice(transport, id), "Removed");

  if (__BUILD__ !== "web") {
    return (
      <section className="view"><div className="ph"><div><div className="eyebrow">Settings</div><h1>Notifications</h1></div></div>
        <Notice tone="info">Notifications are set in the web app (fame-fleet.pages.dev): sign in there, Settings → Notifications.</Notice>
      </section>
    );
  }
  if (err) return <section className="view"><div className="ph"><div><div className="eyebrow">Settings</div><h1>Notifications</h1></div></div><Notice tone="bad">{err}</Notice></section>;
  if (!data) return <section className="view"><div className="ph"><div><div className="eyebrow">Settings</div><h1>Notifications</h1></div></div><Loading>Loading…</Loading></section>;

  const registered = !!myHash && data.devices.some((d) => d.endpoint_hash === myHash);
  const line = stateText(state, data.push.configured, registered);

  return (
    <section className="view" data-testid="notifications">
      <div className="ph"><div><div className="eyebrow">Settings</div><h1>Notifications</h1></div></div>
      <div className="stack" style={{ maxWidth: 640 }}>
        <div className="card card-b" style={{ display: "grid", gap: 14 }}>
          <h2>This browser</h2>
          <Notice tone={line.tone}>{line.text}</Notice>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div className="acts">
            {line.can === "on" && <button type="button" className="btn dark" disabled={busy} onClick={() => void turnOn()}>Turn on in this browser</button>}
            {line.can === "off" && <button type="button" className="btn" disabled={busy} onClick={() => void turnOff()}>Turn off in this browser</button>}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{DEVICE_NOTE}</p>
        </div>

        <SoundCard data={data} onSaved={setData} />

        <div className="card card-b" style={{ display: "grid", gap: 14 }}>
          <h2>Tell me when</h2>
          {data.events.length === 0 && <Empty>Your permissions bring no notifications yet.</Empty>}
          {data.events.map((e) => (
            <label key={e.event} className="row" style={{ padding: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={e.enabled} disabled={busy} onChange={(ev) => void toggle(e.event, ev.target.checked)} />
              <span className="grow"><span className="name">{e.label}</span><span className="sub" style={{ display: "block" }}>{e.text}</span></span>
            </label>
          ))}
        </div>

        <div className="card card-b" style={{ display: "grid", gap: 14 }}>
          <h2>Browsers with notifications on</h2>
          {data.devices.length === 0 && <Empty>None yet. Turn them on above.</Empty>}
          {data.devices.map((d) => (
            <div key={d.id} className="row" style={{ padding: 0 }}>
              <span className="grow">
                <span className="name">{d.device} {d.endpoint_hash === myHash && <Pill tone="ok">this one</Pill>}</span>
                <span className="sub" style={{ display: "block" }}>since {d.since}{d.last_ok ? ` · last delivered ${d.last_ok}` : " · nothing delivered yet"}</span>
              </span>
              <button type="button" className="btn small" disabled={busy} onClick={() => void remove(d.id)}>Remove</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
