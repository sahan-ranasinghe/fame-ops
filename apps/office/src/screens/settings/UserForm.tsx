// Add an office user (/settings/users/new): name, e-mail, mobile and the
// permissions (with the presets); the one-time set-password link is shown once.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { useFormDraft } from "../../data/drafts";
import type { CreateOfficeUserResult } from "../../data/types";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Notice } from "../../ui/basics";
import { DraftBanner } from "../../ui/DraftBanner";
import { PageTop, StickyActions } from "../../ui/Page";
import { PermissionChips, PermissionPicker, Secret } from "./userParts";
import { emptyUser, type UserFields, validateNewUser } from "./usersLogic";

export function UserForm() {
  const { store, transport } = useFleet();
  const [f, setF, draft] = useFormDraft<UserFields>("user-new", null, emptyUser);
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
      draft.clear();
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <section className="view" data-testid="user-created">
        <PageTop title="Account created" sub={<>{done.created.name} · <PermissionChips permissions={done.created.permissions} /></>} backTo="/settings/users" />
        <div className="page-form">
          <Secret label="Set-password link" value={done.set_password_link} hint={`Valid for ${done.link_valid_for ?? "1 hour"}. The person opens it, chooses a password and signs in. Never share it in a group chat.`} />
          <div><Link className="btn dark" to="/settings/users">Done</Link></div>
        </div>
      </section>
    );
  }
  return (
    <section className="view" data-testid="user-form">
      <PageTop title="Add office user" sub="A sign-in for the web app (not a driver)" backTo="/settings/users" />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        <div className="card card-b form">
          <div className="field"><label htmlFor="nu-name">Full name</label><input id="nu-name" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-focus /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="nu-email">E-mail</label><input id="nu-email" type="email" maxLength={160} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="nu-phone">Mobile</label><input id="nu-phone" maxLength={30} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          </div>
          <PermissionPicker value={f.permissions} onChange={(permissions) => setF({ ...f, permissions })} idPrefix="nu" />
          <p className="hint" style={{ margin: 0 }}>Every other permission brings View with it. Fleet admin = everything but Users; Dispatcher assigns tasks; Requester asks for vehicles and sees what a viewer sees; Viewer only reads.</p>
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
        <StickyActions><button className="btn primary" type="submit" disabled={busy}>Create account</button></StickyActions>
      </form>
    </section>
  );
}
