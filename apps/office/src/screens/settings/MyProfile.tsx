// Settings → My profile (/settings/profile, everyone; Hotfix 2, F): the
// person's own phone number, so drivers and requesters can call them ("Call
// the fleet admin"). Saved with update_my_profile, which takes 07…, 7…, 94…
// or +94… and keeps +94…; shown "077 123 4567". Needed by everyone who
// approves or assigns tasks: the banner on every page goes once it is saved
// (/me is asked again).
import { type FormEvent, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { asFleetError, errText } from "../../transport/errors";
import { ROLE_LABEL } from "../../transport/types";
import { Notice } from "../../ui/basics";
import { phoneDisplay } from "../../ui/ContactButtons";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { profileInput } from "./profileLogic";

/** The person's number as the page shows it. */
const shownPhone = (me: { phone?: string; phone_display?: string }) => me.phone_display ?? (me.phone ? phoneDisplay(me.phone) : "");

export function MyProfile() {
  const { me, transport, refreshMe } = useFleet();
  const toast = useToast();
  const [text, setText] = useState(() => shownPhone(me));
  // What is saved: from /me, then from the answer to a save.
  const [saved, setSaved] = useState<string>(me.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const canSave = me.tools.includes("update_my_profile");

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const v = profileInput(text, saved);
    if ("nothing" in v) {
      setMsg({ tone: "ok", text: saved ? "That is the number saved." : "No number to save yet." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<{ phone?: string | null; phone_display?: string }>("update_my_profile", v.input);
      const phone = r.phone ?? "";
      setSaved(phone);
      setText(r.phone_display ?? (phone ? phoneDisplay(phone) : ""));
      setMsg({ tone: "ok", text: phone ? `Saved: ${r.phone_display ?? phoneDisplay(phone)}.` : "Your number is cleared." });
      toast(phone ? "Phone number saved" : "Phone number cleared");
      // The banner and the pages read the number from /me: ask it again (the page stays as it is).
      await refreshMe?.().catch(() => undefined);
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(false);
  }

  return (
    <section className="view" data-testid="my-profile">
      <PageTop title="My profile" sub="Settings" backTo="/settings" />
      <div className="page-form">
        <div className="card card-b">
          <dl className="kv">
            <div><dt>Name</dt><dd>{me.name || "—"}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd></div>
            {me.email && <div><dt>E-mail</dt><dd>{me.email}</dd></div>}
          </dl>
        </div>
        <form className="card card-b form" onSubmit={save} noValidate>
          <h2>My phone number</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Drivers and the people who ask for vehicles see it with Call and WhatsApp on the trips you approve or assign. Nothing dials by itself.
          </p>
          {me.phone_required && !saved && (
            <Notice tone="info">You approve or assign tasks: add your number so drivers can call you.</Notice>
          )}
          <div className="field">
            <label htmlFor="mp-phone">My phone number</label>
            <input id="mp-phone" maxLength={30} inputMode="tel" autoComplete="tel" placeholder="077 123 4567" value={text}
              onChange={(e) => { setText(e.target.value); setMsg(null); }} disabled={!canSave} />
            <span className="hint">A mobile or a landline, e.g. 077 123 4567. Empty and Save clears it.</span>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {canSave
            ? <div><button className="btn dark" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
            : <Notice tone="info">Your number is saved on the Fame Fleet web app, under Settings → My profile.</Notice>}
        </form>
      </div>
    </section>
  );
}
