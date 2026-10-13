// Office users (Settings → Users, the users permission): who can sign in to
// the web app and Claude, what each may do (permissions, with the four
// presets), set-password links, switching people off, personal connector keys.
import { normalisePermissions, type Permission, PERMISSION_TEXT, PERMISSIONS, PRESETS } from "@fleet/permissions";
import { type FormEvent, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useWatch } from "../../data/hooks";
import type { CreateKeyResult, CreateOfficeUserResult, OfficeUser, OfficeUsers, SetPasswordLinkResult, UpdateOfficeUserResult } from "../../data/types";
import { waLink } from "../../lib/format";
import { errText } from "../../transport/errors";
import { type FleetError, ROLE_LABEL, type Role } from "../../transport/types";
import { Avatar, Empty, ErrBox, Loading, Notice, Pill, StaleNote } from "../../ui/basics";
import { DrawerTop, useDrawer } from "../../ui/Drawer";
import { useToast } from "../../ui/Toast";
import { emptyUser, type Preset, presetOf, togglePermission, updateInput, type UserFields, validateNewUser } from "./usersLogic";

const PRESET_KEYS = Object.keys(PRESETS) as Preset[];

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

/** The permission chips of a user, in the table's order. */
export function PermissionChips({ permissions }: { permissions?: string[] }) {
  const list = normalisePermissions(permissions);
  if (!list.length) return <span className="muted">None</span>;
  return <>{list.map((p) => <span key={p} className="perm">{PERMISSION_TEXT[p].label}</span>)}</>;
}

/** The preset buttons and the tick boxes, shared by the create and the edit forms. */
function PermissionPicker({ value, onChange, idPrefix }: { value: Permission[]; onChange: (p: Permission[]) => void; idPrefix: string }) {
  const current = presetOf(value);
  return (
    <div className="field">
      <span className="lab">Permissions</span>
      <div className="presets" role="group" aria-label="Presets">
        {PRESET_KEYS.map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={current === k} onClick={() => onChange([...PRESETS[k].permissions])}>{PRESETS[k].label}</button>
        ))}
        <button type="button" className="chip" aria-pressed={current === "admin"} onClick={() => onChange([...PERMISSIONS])}>Admin (everything)</button>
      </div>
      <div className="perm-list">
        {PERMISSIONS.map((p) => (
          <label key={p} htmlFor={`${idPrefix}-${p}`}>
            <input type="checkbox" id={`${idPrefix}-${p}`} checked={value.includes(p)} onChange={() => onChange(togglePermission(value, p))} />
            <span className="grow"><b>{PERMISSION_TEXT[p].label}</b><span>{PERMISSION_TEXT[p].text}</span></span>
          </label>
        ))}
      </div>
    </div>
  );
}

function NewUserDrawer() {
  const { store, transport } = useFleet();
  const [f, setF] = useState<UserFields>(emptyUser);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<CreateOfficeUserResult | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewUser(f);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      setDone(await transport.call<CreateOfficeUserResult>("create_office_user", v.input));
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <DrawerTop title="Account created" sub={<>{done.created.name} · <PermissionChips permissions={done.created.permissions} /></>} />
        <Secret label="Set-password link" value={done.set_password_link} hint={`Valid for ${done.link_valid_for ?? "1 hour"}. The person opens it, chooses a password and signs in. Never share it in a group chat.`} />
      </>
    );
  }
  return (
    <>
      <DrawerTop title="Add office user" sub="A sign-in for the web app (not a driver)" />
      <form className="card card-b form" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="nu-name">Full name</label><input id="nu-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-focus /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="nu-email">E-mail</label><input id="nu-email" type="email" maxLength={160} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="nu-phone">Mobile</label><input id="nu-phone" maxLength={30} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} idPrefix="nu" />
        <p className="hint" style={{ margin: 0 }}>Every office user sees the fleet (View) unless you untick it. Fleet admin = everything but Users; Dispatcher assigns tasks; Requester only asks for vehicles; Viewer only reads.</p>
        {err && <Notice tone="bad">{err}</Notice>}
        <button className="btn primary" type="submit" disabled={busy}>Create account</button>
      </form>
    </>
  );
}

function UserDrawer({ user: u }: { user: OfficeUser }) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const email = u.email ?? "";
  const before = { email, name: u.name, phone: u.phone, permissions: normalisePermissions(u.permissions) };
  const [f, setF] = useState<UserFields>({ name: u.name, email, phone: u.phone ?? "", permissions: before.permissions });
  const [edMsg, setEdMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string; hint: string } | null>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

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
  async function save(ev: FormEvent) {
    ev.preventDefault();
    const v = updateInput(before, f, me.email);
    if ("error" in v) {
      setEdMsg({ tone: "bad", text: v.error });
      return;
    }
    if ("nothing" in v) {
      setEdMsg({ tone: "bad", text: "Nothing changed yet." });
      return;
    }
    setBusy(true);
    try {
      const r = await transport.call<UpdateOfficeUserResult>("update_office_user", v.input);
      toast("User updated");
      setEdMsg({ tone: "ok", text: `Saved. ${r.updated.name} now has: ${normalisePermissions(r.updated.permissions).map((p) => PERMISSION_TEXT[p].label).join(", ") || "no permissions"}. It applies to their next call.` });
      void store.invalidate();
    } catch (e) {
      setEdMsg({ tone: "bad", text: errText(e as FleetError)[0] });
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
        <form className="card card-b form" onSubmit={save}>
          <h2>Name, phone and permissions</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="eu-name">Full name</label><input id="eu-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="eu-phone">Mobile</label><input id="eu-phone" maxLength={30} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          </div>
          <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} idPrefix="eu" />
          {edMsg && <Notice tone={edMsg.tone}>{edMsg.text}</Notice>}
          <div><button className="btn dark" type="submit" disabled={busy}>Save</button></div>
        </form>
      )}
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
          <p className="muted small" style={{ margin: 0 }}>For their own Claude account, with their permissions. The Teams workspace uses the shared "Fame Fleet" connector.</p>
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

export function Users() {
  const { store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const entry = useWatch<OfficeUsers>("officeUsers", "list_office_users", {}, 60000, !noConnector);
  const d = entry.data;
  return (
    <section className="view" data-testid="users">
      <div className="ph">
        <div><div className="eyebrow">Settings · who can use the web app and Claude</div><h1>Users</h1></div>
        <div className="ph-actions"><button type="button" className="btn primary" onClick={() => drawer.open(<NewUserDrawer />)}>Add office user</button></div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("officeUsers", "list_office_users", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading users…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card">
            {d.users.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Person</th><th>E-mail</th><th>Permissions</th><th>Since</th><th>Claude keys</th><th className="r"></th></tr></thead>
                  <tbody>
                    {d.users.map((u) => (
                      <tr key={u.email ?? u.name}>
                        <td><div className="name"><Avatar name={u.name} small />{u.name}</div>{!u.active && <Pill tone="bad">Switched off</Pill>}</td>
                        <td>{u.email || "—"}</td>
                        <td><PermissionChips permissions={u.permissions} /></td>
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
