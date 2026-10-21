// Settings → My profile (/settings/profile, everyone; Hotfix 2, F): the
// person's own phone number, so drivers and requesters can call them ("Call
// the fleet admin"). Saved with update_my_profile, which takes 07…, 7…, 94…
// or +94… and keeps +94…; shown "077 123 4567". Needed by everyone who
// approves or assigns tasks: the banner on every page goes once it is saved
// (/me is asked again).
// Round 3 (5a): my photo, the initials until there is one, with Change photo (choose a photo, or take one on a phone);
// resized like a driver's photo (the centred square at 512 × 512) and saved through my own folder (data/myPhoto.ts). The
// web build only: the artifact shows the photo and no button.
// Round 3 Part A (A5; Zipcar for Business / Enterprise CarShare: the member's driving licence on file): the Driving
// licence card for the trips the person drives themselves ("I'll drive myself"): the number and the expiry (saved with
// update_my_profile licence_no / licence_expiry; an emptied field clears it), the state from /me (on file, not on file,
// expired) and the front and back photos (take or choose one; web build only: my own <employee id>/licence/ folder, a
// photos row of kind licence, set_my_licence_photo). The approver sees "Self-drive · licence on file ✓" on the request.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { asFleetError, errText } from "../../transport/errors";
import { ROLE_LABEL } from "../../transport/types";
import { Avatar, Notice, Pill } from "../../ui/basics";
import { DateField } from "../../ui/DayPicker";
import { LicenceSides } from "../DriverProfileParts";
import { licencePhoto, profilePhoto } from "../imageCanvas";
import { FilePick } from "../PhotoUpload";
import { phoneDisplay } from "../../ui/ContactButtons";
import { PageTop } from "../../ui/Page";
import { useToast } from "../../ui/Toast";
import { dayWords } from "../../lib/when";
import { licenceInput, licenceStateText, profileInput } from "./profileLogic";

/** The person's number as the page shows it. */
const shownPhone = (me: { phone?: string; phone_display?: string }) => me.phone_display ?? (me.phone ? phoneDisplay(me.phone) : "");

/** The words after a photo was saved, or why it was not. */
export const PHOTO_WORDS: Record<"ok" | "failed" | "network", { tone: "ok" | "bad"; text: string }> = {
  ok: { tone: "ok", text: "Photo saved. Drivers and the office see it beside your name." },
  failed: { tone: "bad", text: "The photo was not saved. Try again." },
  network: { tone: "bad", text: "No connection: the photo did not go up. Try again." },
};

/** My photo with Change photo (the web build only). */
function MyPhotoCard() {
  const { me, transport, refreshMe, myPhoto } = useFleet();
  const toast = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const canChange = !!myPhoto && transport.kind === "api";
  // The picture just saved is shown at once (a local copy) until the page goes.
  useEffect(() => () => { if (shown) URL.revokeObjectURL(shown); }, [shown]);
  const src = shown ?? me.photo_url;

  async function pick(file: File) {
    if (!myPhoto) return;
    setBusy(true);
    setMsg(null);
    try {
      const jpeg = await profilePhoto(file);
      const out = await myPhoto.save(jpeg);
      setMsg(PHOTO_WORDS[out]);
      if (out === "ok") {
        if (typeof URL.createObjectURL === "function") setShown(URL.createObjectURL(jpeg));
        toast("Photo saved");
        await refreshMe?.().catch(() => undefined);
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(false);
  }

  return (
    <div className="card card-b form" data-testid="my-photo">
      <h2>My photo</h2>
      <div className="profile-photo">
        <Avatar name={me.name} src={src} large />
        <p className="grow muted small" style={{ margin: 0 }}>Shown beside your name to drivers and the office. A clear photo of your face: it is cut to a square in the middle.</p>
        {canChange && <FilePick label={src ? "Change photo" : "Add photo"} busy={busy} busyLabel="Saving…" accept="image/*" onFile={(f) => void pick(f)} />}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

/** The words after a licence photo was saved, or why it was not. */
export const LICENCE_PHOTO_WORDS: Record<"ok" | "failed" | "network", { tone: "ok" | "bad"; text: string }> = {
  ok: { tone: "ok", text: "Licence photo saved." },
  failed: { tone: "bad", text: "The photo was not saved. Try again." },
  network: { tone: "bad", text: "No connection: the photo did not go up. Try again." },
};

/** My driving licence: the number, the expiry and the photos of the front and the back (Round 3, A5). */
export function MyLicenceCard() {
  const { me, transport, refreshMe, myLicence } = useFleet();
  const toast = useToast();
  const lic = me.licence;
  const [number, setNumber] = useState(lic?.number ?? "");
  const [expiry, setExpiry] = useState(lic?.expiry ?? "");
  // What is saved: from /me, then from the answer to a save.
  const [saved, setSaved] = useState<{ number?: string; expiry?: string }>({ number: lic?.number, expiry: lic?.expiry });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<"front" | "back" | null>(null);
  const [shown, setShown] = useState<{ front?: string; back?: string }>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const canSave = me.tools.includes("update_my_profile");
  const canPhoto = canSave && !!myLicence && transport.kind === "api";
  // The pictures just saved are shown at once (local copies) until the page goes; each is let go then.
  const made = useRef<string[]>([]);
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);
  if (!lic) return null;
  const state = licenceStateText(lic.state);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const v = licenceInput({ number, expiry }, saved);
    if ("nothing" in v) {
      setMsg({ tone: "ok", text: "That is what is saved." });
      return;
    }
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<{ licence_no?: string | null; licence_expiry?: string | null }>("update_my_profile", v.input);
      const next = { number: r.licence_no ?? undefined, expiry: r.licence_expiry ?? undefined };
      setSaved(next);
      setNumber(next.number ?? "");
      setExpiry(next.expiry ?? "");
      toast(next.number || next.expiry ? "Driving licence saved" : "Driving licence cleared");
      // The state (on file, expired) comes from /me: ask it again.
      await refreshMe?.().catch(() => undefined);
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(false);
  }

  async function pick(side: "front" | "back", file: File) {
    if (!myLicence) return;
    setPhotoBusy(side);
    setMsg(null);
    try {
      const jpeg = await licencePhoto(file);
      const out = await myLicence.savePhoto(side, jpeg);
      setMsg(LICENCE_PHOTO_WORDS[out]);
      if (out === "ok") {
        if (typeof URL.createObjectURL === "function") {
          const url = URL.createObjectURL(jpeg);
          made.current.push(url);
          setShown((x) => ({ ...x, [side]: url }));
        }
        toast(`Licence ${side} saved`);
        await refreshMe?.().catch(() => undefined);
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setPhotoBusy(null);
  }

  return (
    <form className="card card-b form" onSubmit={(e) => void save(e)} noValidate data-testid="my-licence">
      <div className="pf-h">
        <h2>Driving licence</h2>
        <span data-testid="my-licence-state"><Pill tone={state.tone}>{state.text}</Pill></span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        For the trips you drive yourself (I'll drive myself). The fleet admin sees whether it is on file and valid when deciding them.
        {lic.state === "expired" && lic.expiry ? ` It expired on ${dayWords(lic.expiry, { inline: true })}.` : ""}
      </p>
      <div className="grid2">
        <div className="field">
          <label htmlFor="mp-licence-no">Licence number</label>
          <input id="mp-licence-no" className="mono" maxLength={40} autoComplete="off" autoCapitalize="characters" placeholder="e.g. B1234567" value={number}
            onChange={(e) => { setNumber(e.target.value); setMsg(null); }} disabled={!canSave} />
        </div>
        <div className="field">
          <label htmlFor="mp-licence-expiry">Expires</label>
          <DateField id="mp-licence-expiry" label="Licence expires" value={expiry} onChange={(d) => { setExpiry(d); setMsg(null); }} disabled={!canSave} />
          <span className="hint">Empty and Save clears it.</span>
        </div>
      </div>
      <LicenceSides src={{ front: shown.front ?? lic.front_url, back: shown.back ?? lic.back_url }} can={canPhoto} busy={photoBusy}
        onPick={(side, f) => void pick(side, f)} testId="my-licence-photos" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {canSave && <div><button className="btn dark" type="submit" disabled={busy}>{busy ? "Saving…" : "Save licence"}</button></div>}
    </form>
  );
}

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
        <MyPhotoCard />
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
        <MyLicenceCard />
      </div>
    </section>
  );
}
