// Office accounts (admin only): who can sign in to the web app, set-password
// links, switching people off, personal connector keys for Claude.
import { type FormEvent, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import type { CreateKeyResult, CreateOfficeUserResult, OfficeUser, OfficeUsers, SetPasswordLinkResult } from "../data/types";
import { waLink } from "../lib/format";
import { errText } from "../transport/errors";
import { type FleetError, ROLE_LABEL, type Role } from "../transport/types";
import { Avatar, Empty, ErrBox, Loading, Notice, Pill, StaleNote } from "../ui/basics";
import { DrawerTop, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";

const ROLES: Role[] = ["admin", "fleet_admin", "office", "staff", "viewer"];

function Secret({ label, value, hint }: { label: string; value: string; hint: string }) {
  const toast = useToast();
  return (
    <div className="card card-b" style={{ display: "grid", gap: 10 }}>
      <b>{label}</b>
      <span className="secret" data-testid="secret">{value}</span>
      <div className="acts">
        <button type="button" className="btn small dark" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast("Copied")); }}>Copy</button>
        <a className="btn small" href={waLink("", `${label}: ${value}`).replace("https://wa.me/", "https://wa.me/?text=").replace("?text=&text=", "?text=") || `https://wa.me/?text=${encodeURIComponent(value)}`} target="_blank" rel="noopener">Share by WhatsApp</a>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );
}

function NewUserDrawer() {
  const { store, transport } = useFleet();
  const [f, setF] = useState({ name: "", email: "", role: "office" as Role, phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<CreateOfficeUserResult | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!f.name.trim() || !f.email.trim()) {
      setErr("Add the name and the e-mail.");
      return;
    }
    setBusy(true);
    try {
      const input: Record<string, unknown> = { name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role };
      if (f.phone.trim()) input.phone = f.phone.trim();
      setDone(await transport.call<CreateOfficeUserResult>("create_office_user", input));
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <DrawerTop title="Account created" sub={`${done.created.name} · ${ROLE_LABEL[done.created.role as Role] ?? done.created.role}`} />
        <Secret label="Set-password link" value={done.set_password_link} hint={`Valid for ${done.link_valid_for ?? "1 hour"}. The person opens it, chooses a password and signs in. Never share it in a group chat.`} />
      </>
    );
  }
  return (
    <>
      <DrawerTop title="Add office user" sub="A sign-in for the web app (not a driver)" />
      <form className="card card-b form" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="nu-name">Full name</label><input id="nu-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-focus /></div>
        <div className="field"><label htmlFor="nu-email">E-mail</label><input id="nu-email" type="email" maxLength={160} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="nu-role">Role</label>
            <select id="nu-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div className="field"><label htmlFor="nu-phone">Mobile</label><input id="nu-phone" maxLength={30} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <p className="hint" style={{ margin: 0 }}>Admin runs everything including accounts; fleet admin runs the fleet; office assigns tasks and requests; staff only ask for vehicles; viewer reads.</p>
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn primary" type="submit" disabled={busy}>Create account</button>
      </form>
    </>
  );
}

function UserDrawer({ user: u }: { user: OfficeUser }) {
  const { store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const [secret, setSecret] = useState<{ label: string; value: string; hint: string } | null>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const email = u.email ?? "";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }
  const newLink = () => run(async () => {
    const r = await transport.call<SetPasswordLinkResult>("reset_office_password", { email });
    setSecret({ label: "Set-password link", value: r.set_password_link, hint: `Valid for ${r.link_valid_for ?? "1 hour"}. Send it to ${u.name} only.` });
  });
  const newKey = () => run(async () => {
    const input: Record<string, unknown> = { email };
    if (label.trim()) input.label = label.trim();
    const r = await transport.call<CreateKeyResult>("create_office_key", input);
    setSecret({ label: "Personal connector URL", value: r.connector_url, hint: "Shown once. They add it in their own Claude: Settings → Connectors → Add custom connector. Treat it like a password." });
    void store.invalidate();
  });
  const revoke = (id: string) => run(async () => {
    await transport.call("revoke_office_key", { key_id: id });
    toast("Key revoked");
    void store.invalidate();
    drawer.close();
  });
  const toggle = () => {
    if (u.active && !armed) {
      setArmed(true);
      return;
    }
    void run(async () => {
      await transport.call("set_office_user_active", { email, active: !u.active });
      toast(u.active ? "Account switched off" : "Account switched on");
      void store.invalidate();
      drawer.close();
    });
  };

  return (
    <>
      <DrawerTop title={u.name} sub={<>{email} · {ROLE_LABEL[u.role as Role] ?? u.role}{!u.active && <> · <Pill tone="bad">Switched off</Pill></>}</>} />
      {secret && <Secret {...secret} />}
      {u.active && (
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <h2>Sign-in</h2>
          <p className="muted small" style={{ margin: 0 }}>Forgot the password, or the first link expired: make a new one-time set-password link.</p>
          <div><button type="button" className="btn" disabled={busy} onClick={() => void newLink()}>New set-password link</button></div>
        </div>
      )}
      {u.active && (
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
          <h2>Claude connector keys</h2>
          <p className="muted small" style={{ margin: 0 }}>For their own Claude account. The Teams workspace uses the shared "Fame Fleet" connector.</p>
          {u.connector_keys.length ? (
            <div className="rows" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
              {u.connector_keys.map((k) => (
                <div className="row" key={k.id}>
                  <div className="grow"><div className="name">{k.label || "Key"}</div><div className="sub">made {k.created} · last used {k.last_used}</div></div>
                  <button type="button" className="btn small danger" disabled={busy} onClick={() => void revoke(k.id)}>Revoke</button>
                </div>
              ))}
            </div>
          ) : <p className="muted small" style={{ margin: 0 }}>No key yet.</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder='Label, e.g. "Boss laptop"' maxLength={60} style={{ flex: "1 1 160px" }} value={label} onChange={(e) => setLabel(e.target.value)} />
            <button type="button" className="btn dark" disabled={busy} onClick={() => void newKey()}>New key</button>
          </div>
        </div>
      )}
      {msg && <Notice tone="bad">{msg}</Notice>}
      <div className="confirm" style={u.active ? undefined : { borderColor: "var(--line)" }}>
        <div>
          <b>{u.active ? "Switch off this account" : "Switch this account back on"}</b>
          <p className="muted small" style={{ margin: "4px 0 0" }}>{u.active ? "They can no longer sign in; their sessions end and their connector keys stop working. Nothing is deleted." : "They can sign in again (keys stay revoked)."}</p>
        </div>
        <button type="button" className={`btn ${u.active ? "danger" : "dark"}`} disabled={busy} onClick={toggle}>{u.active ? (armed ? "Yes, switch off" : "Switch off") : "Switch on"}</button>
      </div>
    </>
  );
}

export function Accounts() {
  const { store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const entry = useWatch<OfficeUsers>("officeUsers", "list_office_users", {}, 60000, !noConnector);
  const d = entry.data;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Who can use the web app and Claude</div><h1>Accounts</h1></div>
        <div className="ph-actions"><button type="button" className="btn primary" onClick={() => drawer.open(<NewUserDrawer />)}>Add office user</button></div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("officeUsers", "list_office_users", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading accounts…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card">
            {d.users.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Person</th><th>E-mail</th><th>Role</th><th>Since</th><th>Claude keys</th><th className="r"></th></tr></thead>
                  <tbody>
                    {d.users.map((u) => (
                      <tr key={u.email ?? u.name}>
                        <td><div className="name"><Avatar name={u.name} small />{u.name}</div>{!u.active && <Pill tone="bad">Switched off</Pill>}</td>
                        <td>{u.email || "—"}</td>
                        <td>{ROLE_LABEL[u.role as Role] ?? u.role}</td>
                        <td>{u.since || "—"}</td>
                        <td>{u.connector_keys.length || "—"}</td>
                        <td className="r"><button type="button" className="btn small" onClick={() => drawer.open(<UserDrawer user={u} />)}>Manage</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No office accounts yet.</Empty>}
          </div>
          <p className="muted small">Drivers are not here: they sign in to the Fame Driver app with a username and PIN (Drivers page).</p>
        </>
      )}
    </section>
  );
}
