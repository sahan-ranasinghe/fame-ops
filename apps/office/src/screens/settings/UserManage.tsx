// Manage an office user (/settings/users/:email/edit): name, phone and
// permissions (kept as a draft), a new set-password link, personal connector
// keys, switching the account off or on.
import { accountChangeProblem } from "@fleet/accountGuards";
import { normalisePermissions, PERMISSION_TEXT } from "@fleet/permissions";
import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { useFormDraft } from "../../data/drafts";
import type { CreateKeyResult, OfficeUser, OfficeUsers, SetPasswordLinkResult, UpdateOfficeUserResult } from "../../data/types";
import { errText } from "../../transport/errors";
import { type FleetError, ROLE_LABEL, type Role } from "../../transport/types";
import { Avatar, Loading, Notice, Pill } from "../../ui/basics";
import { phoneDisplay } from "../../ui/ContactButtons";
import { DraftBanner } from "../../ui/DraftBanner";
import { PageTop, useAfterSave } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { PermissionChips, PermissionPicker, Secret } from "./userParts";
import { updateInput, type UserFields } from "./usersLogic";

export function UserManage() {
  const { email: raw = "" } = useParams();
  const email = decodeURIComponent(raw);
  const { me, store, transport } = useFleet();
  const afterSave = useAfterSave();
  const toast = useToast();
  const [u, setU] = useState<OfficeUser | undefined>();
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Hotfix 3 (L3): the person found by the list's search (one page), not the whole list.
    void transport.call<OfficeUsers>("list_office_users", { search: email, limit: 25 })
      .then((p) => {
        if (!alive) return;
        const found = p.users.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
        setU(found);
        if (!found) setLoadErr(`No office user has the e-mail ${email}.`);
      })
      .catch((e) => { if (alive) setLoadErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, transport]);

  const [f, setF, draft] = useFormDraft<UserFields | null>("user-edit", email, null);
  useEffect(() => {
    // The number as it is shown (077 123 4567; stored +94…).
    if (u && f === null) setF({ name: u.name, email, phone: u.phone_display ?? (u.phone ? phoneDisplay(u.phone) : ""), permissions: normalisePermissions(u.permissions) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u]);
  const [edMsg, setEdMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string; hint: string } | null>(null);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Round 1 (21 October 2026): the driver's Me lists only the people chosen here; saved at once (a switch).
  async function setContact(on: boolean) {
    await run(async () => {
      const r = await transport.call<UpdateOfficeUserResult>("update_office_user", { email, driver_contact: on });
      setU({ ...u!, driver_contact: r.updated.driver_contact === true });
    });
  }

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

  if (loadErr) return <section className="view"><PageTop title="Office user" backTo="/settings/users" /><Notice tone="bad">{loadErr}</Notice></section>;
  if (!u || f === null) return <section className="view"><PageTop title="Office user" backTo="/settings/users" /><Loading>Loading the account…</Loading></section>;
  const before = { email, name: u.name, phone: u.phone, permissions: normalisePermissions(u.permissions) };

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!f) return;
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
      draft.clear();
      toast("User updated");
      setEdMsg({ tone: "ok", text: `Saved. ${r.updated.name} now has: ${normalisePermissions(r.updated.permissions).map((p) => PERMISSION_TEXT[p].label).join(", ") || "no permissions"}. It applies to their next call.` });
      const phone = r.updated.phone === undefined ? u!.phone : r.updated.phone;
      setU({ ...u!, name: r.updated.name, permissions: r.updated.permissions, phone, phone_display: phone ? phoneDisplay(phone) : undefined });
      if (phone !== undefined) draft.reset({ ...f, phone: phone ? phoneDisplay(phone) : "" });
      void store.invalidate();
    } catch (e) {
      setEdMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }
  const newLink = () => run(async () => {
    const r = await transport.call<SetPasswordLinkResult>("reset_office_password", { email });
    setSecret({ label: "Set-password link", value: r.set_password_link, hint: `Valid for ${r.link_valid_for ?? "1 hour"}. Send it to ${u!.name} only.` });
  });
  const newKey = () => run(async () => {
    const input: Record<string, unknown> = { email };
    if (label.trim()) input.label = label.trim();
    const r = await transport.call<CreateKeyResult>("create_office_key", input);
    setLabel("");
    setSecret({ label: "Personal connector URL", value: r.connector_url, hint: "Shown once. They add it in their own Claude: Settings → Connectors → Add custom connector. Treat it like a password." });
    void store.invalidate();
  });
  const revoke = (id: string) => run(async () => {
    await transport.call("revoke_office_key", { key_id: id });
    toast("Key revoked");
    void store.invalidate();
    setU({ ...u!, connector_keys: (u!.connector_keys ?? []).filter((k) => k.id !== id) });
  });
  const toggle = () => {
    if (u!.active && !armed) {
      setArmed(true);
      return;
    }
    void run(async () => {
      await transport.call("set_office_user_active", { email, active: !u!.active });
      toast(u!.active ? "Account switched off" : "Account switched on");
      void store.invalidate();
      afterSave("/settings/users");
    });
  };

  // Round 2b: the same rule as the server (accountGuards.ts): an account holding a permission this person could not give
  // (an admin's, a Fleet admin's for a Coordinator) is shown, not changed; the reason says who can.
  const self = !!me.email && me.email.toLowerCase() === email.toLowerCase();
  const locked = accountChangeProblem(
    { employeeId: self ? "me" : "someone", permissions: normalisePermissions(me.permissions) },
    { kind: "password_link", target: { id: self ? "me" : "them", permissions: normalisePermissions(u.permissions) } },
  );
  if (locked && !self) {
    return (
      <section className="view" data-testid="user-manage">
        <PageTop title={u.name} sub={<>{email} · {ROLE_LABEL[u.role as Role] ?? u.role}</>} backTo="/settings/users" />
        <div className="page-form">
          <Notice tone="info">{locked}</Notice>
          <div className="card card-b"><PermissionChips permissions={u.permissions} /></div>
        </div>
      </section>
    );
  }

  return (
    <section className="view" data-testid="user-manage">
      <PageTop title={u.name} sub={<>{email} · {ROLE_LABEL[u.role as Role] ?? u.role}{!u.active && <> · <Pill tone="bad">Switched off</Pill></>}</>} backTo="/settings/users" />
      <DraftBanner draft={draft} />
      <div className="page-form">
        {/* Round 3: their photo (the initials until there is one; each person changes their own on My profile). */}
        <div className="card card-b person" data-testid="user-photo"><Avatar name={u.name} src={u.photo_url} large /><span className="muted small">{u.photo_url ? "Their photo." : "No photo yet: they add one on My profile."}</span></div>
        {secret && <Secret {...secret} />}
        {u.active && (
          <form className="card card-b form" onSubmit={save}>
            <h2>Name, phone and permissions</h2>
            <div className="grid2">
              <div className="field"><label htmlFor="eu-name">Full name</label><input id="eu-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="eu-phone">Mobile</label><input id="eu-phone" maxLength={30} inputMode="tel" placeholder="077 123 4567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /><span className="hint">Drivers and requesters see it with Call and WhatsApp. Empty and Save clears it.</span></div>
            </div>
            <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} idPrefix="eu" holder={me.permissions} />
            {edMsg && <Notice tone={edMsg.tone}>{edMsg.text}</Notice>}
            <div><button className="btn dark" type="submit" disabled={busy}>Save</button></div>
          </form>
        )}
        {me.tools.includes("update_office_user") && (
          <div className="card card-b" style={{ display: "grid", gap: 8 }} data-testid="driver-contact-card">
            <label className="row" style={{ padding: 0, cursor: "pointer" }}>
              <input type="checkbox" role="switch" checked={u.driver_contact === true} disabled={busy || (!u.phone && u.driver_contact !== true)}
                onChange={(e) => void setContact(e.target.checked)} />
              <span className="grow">
                <span className="name">Show as a contact for drivers</span>
                <span className="sub" style={{ display: "block" }}>
                  {u.phone
                    ? `Drivers see ${u.name} on the app's Me with Call and WhatsApp, as ${normalisePermissions(u.permissions).includes("approve") ? "Fleet admin" : "Office"}.`
                    : "Add a mobile number first."}
                </span>
              </span>
            </label>
          </div>
        )}
        {u.active && (
          <div className="card card-b" style={{ display: "grid", gap: 12 }}>
            <h2>Sign-in</h2>
            <p className="muted small" style={{ margin: 0 }}>Forgot the password, or the first link expired: make a new one-time set-password link.</p>
            <div><button type="button" className="btn" disabled={busy} onClick={() => void newLink()}>New set-password link</button></div>
          </div>
        )}
        {/* Round 2b: the keys only for the people who make them (a Coordinator never sees them). */}
        {u.active && me.tools.includes("create_office_key") && (
          <div className="card card-b" style={{ display: "grid", gap: 12 }}>
            <h2>Claude connector keys</h2>
            <p className="muted small" style={{ margin: 0 }}>For their own Claude account, with their permissions. The Teams workspace uses the shared "Fame Fleet" connector.</p>
            {u.connector_keys?.length ? (
              <div className="rows" style={{ border: "1px solid var(--line)", borderRadius: 12 }}>
                {(u.connector_keys ?? []).map((k) => (
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
      </div>
    </section>
  );
}
