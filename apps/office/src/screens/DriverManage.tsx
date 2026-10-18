// Manage a driver (/drivers/:username/edit): the driver's profile (Part 3b, G), a new PIN, switching the account off or on.
// Phase 7 (§5): the photo with Replace photo (the web app).
// Part 3b (G): driver_profile, watched: Contact, Emergency contact, Driving licence (with the front and back photos), This
// month and the app version, Not available, Changes, and a banner for what is missing. Each section's Edit saves through
// update_driver with only what changed; the open section's fields are kept as a draft. Without driver_profile the page
// shows the driver list's mobile and licence expiry, as before.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import type { Driver, DriverProfile, DriversList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { isPin, randomPin } from "./driverLogic";
import { missingText, profileFields } from "./driverProfileLogic";
import { type ProfileDraft, ProfileSections } from "./DriverProfileParts";
import { DriverPhotoCard } from "./PhotoUpload";

/** The profile is fetched again this often while the page is open. */
export const PROFILE_REFRESH_MS = 60_000;

export function DriverManage() {
  const { username = "" } = useParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const [x, setX] = useState<Driver | undefined>();
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // Hotfix 3 (L3): the driver found by the list's search (one page), not the whole list.
    void transport.call<DriversList>("list_drivers", { include_inactive: true, search: username, limit: 25 })
      .then((p) => {
        if (!alive) return;
        const found = p.drivers.find((d) => d.username === username);
        setX(found);
        if (!found) setLoadErr(`No driver has the username ${username}.`);
      })
      .catch((e) => { if (alive) setLoadErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, transport]);

  const profileQ = useQuery<DriverProfile>("driverProfile", "driver_profile", username ? { driver: username } : null, {
    every: PROFILE_REFRESH_MS,
    enabled: me.tools.includes("driver_profile"),
  });
  const p = profileQ.data;
  const [draft, setDraft, controls] = useFormDraft<ProfileDraft>("driver-profile", username, () => ({ section: null, f: profileFields(undefined, null) }));

  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [armed, setArmed] = useState(false);
  const [saMsg, setSaMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const after = () => {
    void store.invalidate();
    void store.load("lists.drivers", "list_drivers", {});
  };

  if (loadErr) return <section className="view"><PageTop title="Driver" backTo="/drivers" /><Notice tone="bad">{loadErr}</Notice></section>;
  if (!x) return <section className="view"><PageTop title="Driver" backTo="/drivers" /><Loading>Loading the driver…</Loading></section>;
  const off = x.active === false;
  const missing = missingText(p?.missing);

  async function setNewPin(ev: FormEvent) {
    ev.preventDefault();
    if (!isPin(pin.trim())) {
      setPinMsg({ tone: "bad", text: "The PIN must be exactly 6 digits." });
      return;
    }
    try {
      await transport.call("reset_pin", { username, pin: pin.trim() });
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
      const out = await transport.call<{ notes?: string[] }>("set_driver_active", { username, active: want });
      toast(want ? "Driver switched on" : "Driver switched off");
      if (out.notes?.length) toast(out.notes[0]);
      after();
      navigate("/drivers", { replace: true });
    } catch (e) {
      setSaMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  return (
    <section className="view" data-testid="driver-manage">
      <PageTop title={x.name} sub={<><span className="mono">{x.username}</span> · {x.code || ""}</>} backTo="/drivers" />
      <DraftBanner draft={controls} />
      <div className="page-form">
        {missing && <div data-testid="pf-missing"><Notice>{missing}</Notice></div>}
        {profileQ.err && !p && <Notice tone="bad">{errText(profileQ.err)[0]}</Notice>}
        <DriverPhotoCard key={username} username={username} name={x.name} photoUrl={p?.driver.photo_url ?? x.photo_url} onSaved={() => void store.load("lists.drivers", "list_drivers", {})} />
        {me.tools.includes("driver_profile") && !p && !profileQ.err ? <Loading>Loading the profile…</Loading> : (
          <ProfileSections username={username} name={x.name} p={p} row={x} draft={draft} setDraft={setDraft} controls={controls} />
        )}
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
      </div>
    </section>
  );
}
