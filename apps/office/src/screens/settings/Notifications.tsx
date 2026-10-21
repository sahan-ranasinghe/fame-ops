// Settings → Notifications (web only; Hotfix O2-H2 Part 2, GitHub's and Gmail's settings pages, the app's Notifications
// screen in the site's look): "Pause all notifications" on top, then one row per group with its summary ("4 of 5 on")
// opening the group's own page (/settings/notifications/:group, NotificationGroup.tsx), then this browser's push state
// with one button, the sounds as one row (/settings/notifications/sounds) and the browsers notifications are on in.
// Only the groups this person's permissions can bring (notificationGroups.ts, the same file as the app's). The server
// honours the toggles at queue time; notify-office pushes to every device. The artifact has no service worker: it
// points to the web app.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { NotificationSettings } from "../../data/types";
import { currentSubscription, endpointHash, pushState } from "../../push";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Empty, Loading, Notice, Pill, SwitchLine } from "../../ui/basics";
import { useToast } from "../../ui/Toast";
import { removeDevice, turnOffHere, turnOnHere } from "./notificationsActions";
import { DEVICE_NOTE, type PushState, stateText } from "./notificationsLogic";
import { soundPrefs } from "../../data/sounds";
import { groupSummaryText, NOTIF_GROUPS, NOTIF_TEXT, OTHER_GROUP } from "./notificationGroups";
import { useNotifSettings } from "./useNotifSettings";

/** A group's title and second line on the site. */
export function groupWords(key: string): { title: string; sub?: string } {
  const g = NOTIF_GROUPS.find((x) => x.key === key);
  return g ? { title: g.title, sub: g.sub } : { title: OTHER_GROUP.title };
}

/** The Sounds row's one line. */
export const soundLine = (s: NotificationSettings["sound"]) => {
  const p = soundPrefs(s);
  return p.on ? `On · ${p.volume} %` : "Off";
};

export function NotifHead({ title = NOTIF_TEXT.title }: { title?: string }) {
  return <div className="ph"><div><div className="eyebrow">Settings</div><h1>{title}</h1></div></div>;
}

export default function Notifications() {
  const { transport } = useFleet();
  const toast = useToast();
  const n = useNotifSettings();
  const { data, setData, err } = n;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<PushState>("off");
  const [myHash, setMyHash] = useState("");

  async function refreshBrowser() {
    const s = await pushState();
    setState(s);
    const sub = s === "on" ? await currentSubscription().catch(() => null) : null;
    setMyHash(sub ? await endpointHash(sub.endpoint) : "");
  }
  useEffect(() => {
    void refreshBrowser();
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
      await n.reload(); // back to what the server has
    }
    await refreshBrowser();
    setBusy(false);
  }
  const turnOn = () => run(() => turnOnHere(transport, data!.push.public_key!), "Notifications are on in this browser");
  const turnOff = () => run(() => turnOffHere(transport), "Notifications are off in this browser");
  const remove = (id: string) => run(() => removeDevice(transport, id), "Removed");

  if (__BUILD__ !== "web") return <section className="view"><NotifHead /><WebAppOnly /></section>;
  if (err && !data) {
    return (
      <section className="view" data-testid="notifications-failed">
        <NotifHead />
        <Notice tone="bad">{err}</Notice>
        <div className="acts" style={{ marginTop: 12 }}><button type="button" className="btn" onClick={() => void n.reload()}>Try again</button></div>
      </section>
    );
  }
  if (!data) return <section className="view"><NotifHead /><Loading>Loading…</Loading></section>;

  const registered = !!myHash && data.devices.some((d) => d.endpoint_hash === myHash);
  const line = stateText(state, data.push.configured, registered);

  return (
    <section className="view" data-testid="notifications">
      <NotifHead />
      <div className="stack" style={{ maxWidth: 640 }}>
        {n.groups.length === 0 && <Empty>{NOTIF_TEXT.noEvents}</Empty>}
        {n.groups.length > 0 && (
          <>
            <div className="card card-b">
              <SwitchLine
                title={NOTIF_TEXT.pause}
                text={NOTIF_TEXT.pauseText}
                on={n.paused}
                onChange={(on) => void (on ? n.pause() : n.resume())}
                testId="notif-pause"
              />
            </div>
            <div className="card card-b" style={{ display: "grid", gap: 6 }}>
              <h2>{NOTIF_TEXT.tellMe}</h2>
              {n.paused && <p className="muted small" style={{ margin: 0 }}>{NOTIF_TEXT.pausedNote}</p>}
              <div className="set-rows">
                {n.groups.map((g) => {
                  const w = groupWords(g.key);
                  const summary = n.paused ? NOTIF_TEXT.statePaused : groupSummaryText(g.on, g.total);
                  const line = w.sub ? `${w.sub} · ${summary}` : summary;
                  return n.paused
                    ? <div key={g.key} className="set-link off" data-testid={`notif-group-${g.key}`}><span className="grow"><span className="name">{w.title}</span><span className="sub">{line}</span></span></div>
                    : (
                      <Link key={g.key} className="set-link" to={`/settings/notifications/${g.key}`} data-testid={`notif-group-${g.key}`}>
                        <span className="grow"><span className="name">{w.title}</span><span className="sub">{line}</span></span>
                        <span aria-hidden="true" className="chev">›</span>
                      </Link>
                    );
                })}
              </div>
            </div>
          </>
        )}

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

        <div className="card card-b">
          <Link className="set-link" to="/settings/notifications/sounds" data-testid="notif-sounds">
            <span className="grow"><span className="name">Sounds while Fame Fleet is open</span><span className="sub">{soundLine(data.sound)}</span></span>
            <span aria-hidden="true" className="chev">›</span>
          </Link>
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

/** The artifact's word for the pages that need the web app (no service worker, no browser push). */
export function WebAppOnly() {
  return <Notice tone="info">Notifications are set in the web app (fame-fleet.pages.dev): sign in there, Settings → Notifications.</Notice>;
}

/** One switch (ui/basics SwitchLine, shared with the Activity log since Round 3). */
export { SwitchLine };
