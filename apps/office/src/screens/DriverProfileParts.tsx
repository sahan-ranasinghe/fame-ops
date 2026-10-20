// Part 3b (G): the driver's profile on the manage page (/drivers/:username/edit), in sections: Contact (mobile, WhatsApp,
// Call and WhatsApp), Emergency contact (name, relationship, phone), Driving licence (number, expiry with its chip, the
// front and back photos with Replace), This month (tasks · km) with the app version, Not available (the entries ahead,
// added, changed or removed in the page), and Changes (what, from → to, "changed by the driver" emphasised, when).
// Each section's Edit opens its fields in place; Save sends update_driver with only what changed (an emptied field sends
// null; the phone cannot be emptied). The private part (the emergency contact, the licence number and photos, the changes)
// is shown only when the answer has it (people with users or vehicles); others see the server's one muted line.
import { type FormEvent, type ReactNode, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { DraftControls } from "../data/drafts";
import type { DriverProfile, UnavailableEntry, UploadTicket } from "../data/types";
import { asFleetError, errText } from "../transport/errors";
import { Notice } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { firstName, toPhoneLinks } from "../ui/driverRowLogic";
import { useToast } from "../ui/Toast";
import { FIELD_LABEL, type ProfileFields, type ProfileSection, profileFields, profilePatch, SECTION_FIELDS, seesPrivate, updateDriverArgs, changeText, monthText } from "./driverProfileLogic";
import { licencePhoto } from "./imageCanvas";
import { canSetLicencePhoto } from "./mediaLogic";
import { FilePick } from "./PhotoUpload";
import { UnavailabilityEditor } from "./UnavailabilityEditor";
import { entryDays } from "./unavailabilityLogic";
import { docTone } from "./vehicleLogic";
import { DateField } from "../ui/DayPicker";

/** The editing state the page keeps as its draft: the section open and its fields. */
export interface ProfileDraft {
  section: ProfileSection | null;
  f: ProfileFields;
}

type Row = { phone?: string; licence?: { chip?: string; expiry?: string } };

/** The fields a section edits for this person: WhatsApp only with the profile, the licence number only with the private part. */
export function visibleFields(section: ProfileSection, p: DriverProfile | undefined): (keyof ProfileFields)[] {
  const priv = seesPrivate(p);
  return SECTION_FIELDS[section].filter((k) => {
    if (k === "whatsapp") return !!p;
    if (k === "licence_no") return priv;
    if (section === "emergency") return priv;
    return true;
  });
}

const INPUT: Partial<Record<keyof ProfileFields, { type?: string; inputMode?: "tel"; max: number }>> = {
  phone: { inputMode: "tel", max: 30 },
  whatsapp: { inputMode: "tel", max: 30 },
  emergency_name: { max: 120 },
  emergency_relation: { max: 60 },
  emergency_phone: { inputMode: "tel", max: 30 },
  licence_no: { max: 40 },
  licence_expiry: { type: "date", max: 10 },
};

/**
 * The sections. `draft` / `setDraft` / `controls` are the page's form draft (one per driver); `row` is the driver list's
 * row (the phone and the licence expiry when there is no profile).
 */
export function ProfileSections({ username, name, p, row, draft, setDraft, controls }: {
  username: string;
  name: string;
  p: DriverProfile | undefined;
  row: Row;
  draft: ProfileDraft;
  setDraft: (d: ProfileDraft) => void;
  controls: DraftControls<ProfileDraft>;
}) {
  const { me, store, transport } = useFleet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canEdit = me.tools.includes("update_driver");
  const priv = seesPrivate(p);
  const shown = profileFields(p, row);
  const first = firstName(name);

  const open = (section: ProfileSection) => {
    setMsg(null);
    controls.reset({ section, f: profileFields(p, row) });
  };
  const close = () => {
    setMsg(null);
    controls.reset({ section: null, f: profileFields(p, row) });
  };
  const setField = (k: keyof ProfileFields, v: string) => setDraft({ ...draft, f: { ...draft.f, [k]: v } });

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const section = draft.section;
    if (!section) return;
    const r = profilePatch(profileFields(p, row), draft.f, visibleFields(section, p));
    if ("error" in r) {
      setMsg(r.error);
      return;
    }
    if (Object.keys(r.patch).length === 0) {
      controls.clear();
      close();
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("update_driver", updateDriverArgs(username, r.patch));
      toast("Driver updated");
      controls.clear();
      close();
      void store.invalidate();
      void store.load("lists.drivers", "list_drivers", {});
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
    }
    setBusy(false);
  }

  /** A section's head with its Edit button (none while it is open or for people who cannot edit). */
  const head = (section: ProfileSection, title: string) => (
    <div className="pf-h">
      <h2>{title}</h2>
      {canEdit && draft.section !== section && (
        <button type="button" className="btn small" onClick={() => open(section)} aria-label={`Edit ${title.toLowerCase()}`}>Edit</button>
      )}
    </div>
  );

  /** The open section's fields with Save and Cancel. */
  const editor = (section: ProfileSection) => (
    <form className="form" onSubmit={(e) => void save(e)} data-testid={`pf-edit-${section}`}>
      <div className="grid2">
        {visibleFields(section, p).map((k) => {
          const spec = INPUT[k] ?? { max: 120 };
          return (
            <div className="field" key={k}>
              <label htmlFor={`pf-${k}`}>{FIELD_LABEL[k]}{k === "whatsapp" ? <span className="muted small"> (if not the mobile)</span> : null}</label>
              {spec.type === "date"
                ? <DateField id={`pf-${k}`} label={FIELD_LABEL[k]} value={draft.f[k]} onChange={(d) => setField(k, d)} />
                : (
                  <input id={`pf-${k}`} type={spec.type ?? "text"} inputMode={spec.inputMode} maxLength={spec.max} value={draft.f[k]}
                    onChange={(e) => setField(k, e.target.value)} />
                )}
            </div>
          );
        })}
      </div>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <div className="acts">
        <button type="submit" className="btn dark" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { controls.clear(); close(); }}>Cancel</button>
      </div>
    </form>
  );

  const fact = (label: string, value: ReactNode, testId?: string) => (
    <div><dt>{label}</dt><dd data-testid={testId}>{value || "—"}</dd></div>
  );

  return (
    <>
      <div className="card card-b form" data-testid="pf-contact">
        {head("contact", "Contact")}
        {draft.section === "contact" ? editor("contact") : (
          <>
            <dl className="facts pf-facts">
              {fact("Mobile", shown.phone ? <span className="num">{shown.phone}</span> : null, "pf-phone")}
              {p && fact("WhatsApp", shown.whatsapp ? <span className="num">{shown.whatsapp}</span> : <span className="muted">the mobile</span>, "pf-whatsapp")}
            </dl>
            <ContactButtons phone={toPhoneLinks(p?.driver.links)} label={`Call ${first}`} testId="pf-call" />
          </>
        )}
      </div>

      {priv && (
        <div className="card card-b form" data-testid="pf-emergency">
          {head("emergency", "Emergency contact")}
          {draft.section === "emergency" ? editor("emergency") : p?.emergency ? (
            <>
              <dl className="facts pf-facts">
                {fact("Name", p.emergency.name)}
                {fact("Relationship", p.emergency.relation)}
                {fact("Phone", p.emergency.phone_display ?? p.emergency.phone)}
              </dl>
              <ContactButtons phone={toPhoneLinks(p.emergency.links)} label={`Call ${p.emergency.name?.split(" ")[0] ?? "them"}`} whatsapp={false} />
            </>
          ) : <p className="muted small" style={{ margin: 0 }}>No emergency contact yet.</p>}
        </div>
      )}

      <div className="card card-b form" data-testid="pf-licence">
        {head("licence", "Driving licence")}
        {draft.section === "licence" ? editor("licence") : (
          <dl className="facts pf-facts">
            {priv && fact("Number", p?.licence?.number ? <span className="mono">{p.licence.number}</span> : null, "pf-licence-no")}
            {fact("Expires", shown.licence_expiry
              ? <span className={`doc ${docTone(p?.licence?.chip ?? p?.driver.licence_chip?.chip ?? row.licence?.chip)}`}>{shown.licence_expiry}</span>
              : null, "pf-licence-expiry")}
          </dl>
        )}
        {priv && p?.licence && <LicencePhotos username={username} front={p.licence.front_url} back={p.licence.back_url} />}
      </div>

      {p && !priv && p.private_hidden && <p className="muted small" style={{ margin: 0 }} data-testid="pf-private-hidden">{p.private_hidden}</p>}

      {p && (
        <div className="card card-b" data-testid="pf-month">
          <dl className="facts pf-facts" style={{ margin: 0 }}>
            {fact("This month", monthText(p.this_month), "pf-this-month")}
            {fact("App version", p.driver.app_version ? <span className="mono">{p.driver.app_version}</span> : null, "pf-app")}
            {fact("Vehicle now", p.driver.current_vehicle ? <span className="plate">{p.driver.current_vehicle}</span> : null)}
            {fact("Language", p.driver.language === "si" ? "සිංහල" : p.driver.language === "en" ? "English" : p.driver.language)}
          </dl>
        </div>
      )}

      {p && <NotAvailableSection username={username} name={name} entries={p.not_available} />}

      {p?.changes && (
        <div className="card card-b form" data-testid="pf-changes">
          <h2>Changes</h2>
          {p.changes.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No changes yet.</p> : (
            <ul className="pf-changes">
              {p.changes.map((c, i) => (
                <li key={`${c.at}-${c.field}-${i}`} data-testid="pf-change">
                  <span>{changeText(c)}</span>
                  <span className="sub"> · {c.by_driver ? <b className="pf-by-driver">{c.by}</b> : c.by} · {c.at}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/** The licence's front and back: each photo (a 1-hour link, opened large in a new tab) with Replace (web app only). */
function LicencePhotos({ username, front, back }: { username: string; front?: string; back?: string }) {
  const { me, store, transport, files } = useFleet();
  const toast = useToast();
  const [saved, setSaved] = useState<{ front?: string; back?: string }>({});
  const [busy, setBusy] = useState<"front" | "back" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const can = !!files && canSetLicencePhoto(me.tools, true);
  const src = { front: saved.front ?? front, back: saved.back ?? back };

  async function pick(side: "front" | "back", file: File) {
    if (!files) return;
    setBusy(side);
    setMsg(null);
    try {
      const jpeg = await licencePhoto(file);
      const { upload } = await transport.call<{ upload: UploadTicket }>("photo_upload_url", { kind: "driver_licence", target: username });
      await files.upload(upload, jpeg, "image/jpeg");
      const r = await transport.call<{ photo_url?: string }>("set_driver_licence_photo", { driver: username, side, path: upload.path });
      setSaved((s) => ({ ...s, [side]: r.photo_url }));
      toast(`Licence ${side} saved. The old photo is kept.`);
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(asFleetError(e))[0] });
    }
    setBusy(null);
  }

  return (
    <>
      <div className="pf-photos" data-testid="pf-licence-photos">
        {(["front", "back"] as const).map((side) => (
          <figure key={side} className="pf-photo">
            {src[side]
              ? <a href={src[side]} target="_blank" rel="noopener"><img src={src[side]} alt={`Driving licence, ${side}`} loading="lazy" decoding="async" /></a>
              : <div className="pf-photo-none muted small">No photo of the {side} yet</div>}
            <figcaption>
              <span className="small">{side === "front" ? "Front" : "Back"}</span>
              {can && <FilePick label={`${src[side] ? "Replace" : "Add"} ${side}`} busy={busy === side} accept="image/*" className="btn small" onFile={(f) => void pick(side, f)} />}
            </figcaption>
          </figure>
        ))}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </>
  );
}

/** The days ahead the driver is not available, each opened to change or remove it in the page; Add for a new one. */
function NotAvailableSection({ username, name, entries }: { username: string; name: string; entries: UnavailableEntry[] }) {
  const { me } = useFleet();
  const [open, setOpen] = useState<string | null>(null);
  const canSet = me.tools.includes("set_unavailability");
  return (
    <div className="card card-b form" data-testid="pf-unavailable">
      <div className="pf-h">
        <h2>Not available</h2>
        {canSet && open !== "new" && <button type="button" className="btn small" onClick={() => setOpen("new")}>Add</button>}
      </div>
      {open === "new" && <UnavailabilityEditor driver={username} driverName={name} onDone={() => setOpen(null)} />}
      {entries.length === 0 && open !== "new" && <p className="muted small" style={{ margin: 0 }}>Available every day in the next 30 days.</p>}
      {entries.length > 0 && (
        <ul className="pf-off">
          {entries.map((e) => (
            <li key={e.id} data-testid="pf-off">
              {open === e.id
                ? <UnavailabilityEditor driver={username} driverName={name} entry={e} onDone={() => setOpen(null)} />
                : (
                  <div className="pf-off-row">
                    <span className="grow">
                      <b>{entryDays(e)}</b> · {e.text}
                      {e.note && <span className="sub" style={{ display: "block" }}>{e.note}</span>}
                      <span className="sub" style={{ display: "block" }}>Added by {e.added_by} · {e.added}</span>
                    </span>
                    {canSet && <button type="button" className="btn small" onClick={() => setOpen(e.id)}>Change</button>}
                  </div>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
