// The new-request page (/requests/new): everyone asks in their own name, "On
// behalf of" names the person it is for when that is someone else (Phase 6);
// for someone who approves the "Assign now" section (the free vehicles for that
// day and time in four groups, who's available, one call that makes the request
// and its task together). Kept as a draft.
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import type { BookResult, SettingsResult, Suggestions } from "../data/types";
import { joinDots, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { LocationSearch } from "../ui/LocationSearch";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { availabilityArgs } from "./availabilityLogic";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { bookInput, emptyRequest, type RequestFields, suggestInput, validateNewRequest } from "./requestLogic";
import { VehicleGroups } from "./requestParts";

interface Form extends RequestFields {
  vehicle: string;
  pickedDriver: string;
}

export function NewRequest() {
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  // Someone who can neither approve nor assign asks in their own name (the server does the same).
  const staff = !can(me, "approve", "assign_tasks");
  const books = me.tools.includes("book_vehicle");
  const [f, setF, draft] = useFormDraft<Form>("request-new", null, () => ({ ...emptyRequest(today()), vehicle: "", pickedDriver: "" }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [sugErr, setSugErr] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookResult | null>(null);
  // The fleet switch: with self-drive off every booking needs a driver, and the box is not shown.
  const [selfDrive, setSelfDrive] = useState(true);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!me.tools.includes("get_settings")) return;
    let alive = true;
    void transport.call<SettingsResult>("get_settings", {}).then((s) => {
      if (!alive || s.settings.self_drive_allowed !== false) return;
      setSelfDrive(false);
      setF((x) => ({ ...x, driver: true }));
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  // The free vehicles for that day and time, fetched a moment after the fields settle.
  const sugArgs = books ? suggestInput(f) : null;
  const sugKey = JSON.stringify(sugArgs);
  useEffect(() => {
    if (!sugArgs) {
      setSug(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const p = await transport.call<Suggestions>("suggest_vehicles", sugArgs);
          if (!alive) return;
          setSug(p);
          setSugErr(null);
        } catch (e) {
          if (alive) setSugErr(errText(e as FleetError)[0]);
        }
      })();
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugKey, transport]);

  const picked = sug ? [...(sug.groups ? Object.values(sug.groups).flat() : sug.vehicles)].find((v) => v.reg_no === f.vehicle) : undefined;
  const custodianDrives = selfDrive && !f.driver && !!picked?.assigned_to;
  const freeDrivers = sug?.drivers_free ?? sug?.drivers.filter((d) => /free/.test(d.availability)).map((d) => ({ name: d.name, username: d.username })) ?? [];

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewRequest(f);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    try {
      const r = await transport.call<{ next?: string }>("create_request", v.input);
      draft.clear();
      toast(staff ? r.next ?? "Sent to the fleet admin · you'll be notified" : "Request saved");
      void store.invalidate();
      navigate("/requests");
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  async function book() {
    const v = bookInput(f, { vehicle: f.vehicle, driver: f.pickedDriver, hasCustodian: !!picked?.assigned_to });
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await transport.call<BookResult>("book_vehicle", v.input);
      draft.clear();
      setBooked(r);
      toast("Booked");
      void store.invalidate();
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  if (booked) {
    return (
      <section className="view">
        <PageTop title="Booked" sub={joinDots([booked.vehicle, booked.driver])} backTo="/requests" />
        <div className="card card-b" style={{ display: "grid", gap: 12, maxWidth: 720 }} data-testid="booked">
          <Notice tone="ok"><b>Booked.</b> {booked.request.on_behalf_of ?? booked.request.requested_by} has {booked.vehicle} on {booked.when}{booked.leave_by ? ` · leave by ${booked.leave_by}` : ""}.</Notice>
          <WarningsNote warnings={warnList(booked)} />
          <div className="acts">
            {booked.task_id && me.tools.includes("task_detail") && <Link className="btn" to={`/tasks/${booked.task_id}`}>Open task</Link>}
            <Link className="btn dark" to="/requests">Done</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view" data-testid="new-request">
      <PageTop title="New vehicle request" sub={staff ? "Ask the fleet office for a vehicle" : books ? "Someone needs a vehicle · book it now or leave it waiting" : "Someone needs a vehicle"} backTo="/requests" />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        <div className="card card-b form">
          <div className="field"><label htmlFor="nr-behalf">On behalf of</label><input id="nr-behalf" maxLength={120} value={f.behalf} onChange={(e) => set("behalf", e.target.value)} placeholder="Only when the vehicle is for someone else" /></div>
          <div className="field"><label htmlFor="nr-project">Project or team</label><input id="nr-project" maxLength={200} placeholder="Job no., DU ID, or e.g. HR" value={f.project} onChange={(e) => set("project", e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="nr-date">Day</label><input type="date" id="nr-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="field"><label htmlFor="nr-time">Time</label><input type="time" id="nr-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
            <div className="field"><label htmlFor="nr-back">Back by</label><input type="time" id="nr-back" value={f.back} onChange={(e) => set("back", e.target.value)} /></div>
            <div className="field"><label htmlFor="nr-need">Vehicle</label>
              <select id="nr-need" value={f.need} onChange={(e) => set("need", e.target.value)}>
                <option value="">Any</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="nr-from">From</label><LocationSearch id="nr-from" value={f.from} onText={(text) => set("from", text)} onPick={(p) => set("from", p.name)} /></div>
            <div className="field"><label htmlFor="nr-to">To</label><LocationSearch id="nr-to" value={f.to} onText={(text) => set("to", text)} onPick={(p) => set("to", p.name)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="nr-pax">Passengers</label><input type="number" id="nr-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
            <div className="field" style={{ alignContent: "end", gap: 8 }}>
              <span className="check"><input type="checkbox" id="nr-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="nr-tools">Tools or equipment go too</label></span>
              {selfDrive && <span className="check"><input type="checkbox" id="nr-driver" checked={f.driver} onChange={(e) => set("driver", e.target.checked)} /> <label htmlFor="nr-driver">A driver is needed</label></span>}
            </div>
          </div>
          {selfDrive && <p className="hint" style={{ margin: "-8px 0 0" }}>Untick "A driver is needed" when the person drives a vehicle assigned to them.</p>}
          <div className="field"><label htmlFor="nr-note">Note</label><textarea id="nr-note" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>

        {books && (
          <div className="card card-b form" data-testid="assign-now">
            <div className="section-t" style={{ marginBottom: 10 }}>Assign now</div>
            {!sugArgs && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the time to see which vehicles are free.</p>}
            {sugArgs && !sug && !sugErr && <Loading>Finding free vehicles…</Loading>}
            {sugErr && <Notice tone="bad">{sugErr}</Notice>}
            {sug && (
              <div className="form">
                <VehicleGroups sug={sug} name="nr-veh" vehicle={f.vehicle} onPick={(reg) => set("vehicle", reg)} greyGarage />
                {sug.vehicles.length === 0 && <Empty>No vehicles registered yet.</Empty>}
                <div className="field">
                  <label htmlFor="nr-driver-pick">Driver</label>
                  {custodianDrives
                    ? <p className="muted small" style={{ margin: 0 }} id="nr-driver-pick">{picked?.assigned_to} drives it (no driver needed).</p>
                    : (
                      <select id="nr-driver-pick" value={f.pickedDriver} onChange={(e) => set("pickedDriver", e.target.value)}>
                        <option value="">Pick a free driver</option>
                        {freeDrivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}
                      </select>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
        {books && !custodianDrives && (
          <AvailabilityPanel args={availabilityArgs(f.date, f.time, f.back, f.need, f.pax)} picked={f.pickedDriver} onPick={(d) => { if (d.username) set("pickedDriver", d.username); }} />
        )}
        {err && <Notice tone="bad">{err}</Notice>}
        <StickyActions>
          <button className={`btn ${books ? "" : "primary"}`} type="submit" disabled={busy}>{busy ? "Saving…" : books ? "Save as waiting" : "Save request"}</button>
          {books && <button type="button" className="btn primary" disabled={busy || !sug} onClick={() => void book()}>Book now</button>}
        </StickyActions>
      </form>
    </section>
  );
}
