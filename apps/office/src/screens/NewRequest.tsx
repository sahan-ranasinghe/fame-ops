// The new-request page (/requests/new): everyone asks in their own name, "On
// behalf of" names the person it is for when that is someone else (Phase 6).
// The trip is the trip editor of Assign a task, for everyone (Phase 7, §34):
// the day, the leave-by time (typed, or planned from the stops' arrive-by
// times), back by, Start from with "Passengers get in here", the stops with
// their times there, and the plan with its map. Requesters never see a driver,
// a vehicle or who is available. For someone who books, the "Assign now"
// section: the driver first and the vehicle they bring (or one picked from the
// free vehicles for that day and time in four groups), who's available with
// the best match, one call that makes the request and its task together with
// the same trip. Kept as a draft; a refresh never resets a pick (§10).
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import type { BookResult, Suggestions } from "../data/types";
import { useQuery } from "../data/useQuery";
import { hhmm, joinDots, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import { can } from "../transport/types";
import type { FleetError } from "../transport/types";
import { Empty, Notice, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { availabilityArgs, floorTo5 } from "./availabilityLogic";
import { AvailabilityPanel, useAvailability, vehicleFor } from "./AvailabilityPanel";
import { basePlace, useFleetSettings, VehicleChoiceRadios, vehicleOnTheDay } from "./dispatchParts";
import { bookInput, emptyRequest, type RequestFields, suggestInput, validateNewRequest } from "./requestLogic";
import { VehicleGroups } from "./requestParts";
import { firstStopOf } from "./stopsLogic";
import { TripEditor, useTrip } from "./TripEditor";
import { tripPlanInput } from "./tripLogic";
import { knownDef, ON_THE_DAY, shownVehicle, vehicleArg, vehicleDefault } from "./vehicleChoiceLogic";
import { SkeletonRows } from "../ui/ListKit";

interface Form extends RequestFields {
  /** The vehicle picked; "" = the one the driver brings. */
  vehicle: string;
  pickedDriver: string;
}

/** book_vehicle's answer with the Phase 7 fields (the vehicle the driver brought). */
type Booked = BookResult;

export function NewRequest() {
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  // Someone who can neither approve nor assign asks in their own name (the server does the same).
  const staff = !can(me, "approve", "assign_tasks");
  const books = me.tools.includes("book_vehicle");
  // Phase 7 (§4): an approver may give the phone of a requester without an account (Tell requester).
  const approver = can(me, "approve");
  // The draft's key changed with the trip (§34): an older draft (From and To) is not offered.
  const [f, setF, draft] = useFormDraft<Form>("request-trip-new", null, () => ({ ...emptyRequest(today()), vehicle: "", pickedDriver: "" }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booked, setBooked] = useState<Booked | null>(null);
  const settings = useFleetSettings();
  // The fleet switch: with self-drive off every booking needs a driver, and the box is not shown.
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const base = basePlace(settings.data);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const fields: Form = selfDrive ? f : { ...f, driver: true };

  // The trip: plan_task 1.5 s after the last change (or Plan now); an empty leave-by is filled in from the plan.
  const trip = useTrip(f, setF, { base, settings: settings.data, planInput: tripPlanInput(f, base) });
  const leave = f.leaveBy || hhmm(trip.preview?.leave_by);

  // The free vehicles for that day and time, a moment after the fields settle; the groups stay while new ones come.
  const sugArgs = books ? suggestInput(f, leave) : null;
  const sugQ = useQuery<Suggestions>("suggest", "suggest_vehicles", sugArgs, { debounce: 400, keep: true, every: 60_000 });
  const sug = sugQ.data;
  const sugErr = sugQ.err ? errText(sugQ.err)[0] : null;
  // Who's available from the leave-by rounded down to 5 minutes, near the first stop (the start when passengers get in there).
  const first = firstStopOf(f.stops, f.startPax ? { name: f.start || base?.name || "", lat: f.startLat, lng: f.startLng } : null);
  const availArgs = books ? availabilityArgs(f.date, leave ? floorTo5(leave) : "", f.end, f.need, f.pax, first) : null;
  const avail = useAvailability(availArgs);

  const def = f.pickedDriver ? vehicleFor(avail.data, f.pickedDriver) : null;
  // Hotfix 2 (J): with vehicle_on_the_day on, a later day (or a driver who brings none today) leaves the vehicle to the day.
  const onDay = books && vehicleOnTheDay(settings.data);
  const dflt = vehicleDefault({ on: onDay, date: f.date, today: today(), driver: f.pickedDriver, def: knownDef(def, !!avail.data || !me.tools.includes("availability")) });
  const dayDefault = dflt?.kind === "on_the_day";
  const vehicle = shownVehicle(f.vehicle, dflt);
  const all = sug ? (sug.groups ? Object.values(sug.groups).flat() : sug.vehicles) : [];
  const picked = all.find((v) => v.reg_no === vehicle);
  const custodianDrives = selfDrive && !f.driver && !!picked?.assigned_to;
  const freeDrivers = sug?.drivers_free ?? sug?.drivers.filter((d) => /free/.test(d.availability)).map((d) => ({ name: d.name, username: d.username })) ?? [];
  const pickedName = avail.data?.drivers.find((d) => d.username === f.pickedDriver)?.name;
  const driverOptions = f.pickedDriver && !freeDrivers.some((d) => d.username === f.pickedDriver)
    ? [...freeDrivers, { username: f.pickedDriver, name: pickedName ?? f.pickedDriver }]
    : freeDrivers;
  // A driver picked in the list keeps a vehicle picked by hand; Use suggestion and a row of Who's available take the
  // driver with the vehicle they bring.
  const pickDriver = (username: string) => setF((x) => ({ ...x, pickedDriver: username }));
  const takeSuggestion = (username: string) => setF((x) => ({ ...x, pickedDriver: username, vehicle: "" }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = validateNewRequest(fields, base);
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
      navigate("/requests", { replace: true });
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  async function book() {
    const known = def?.reg_no ?? (avail.data || !me.tools.includes("availability") ? null : undefined);
    const v = bookInput(fields, { vehicle: custodianDrives ? f.vehicle : vehicleArg(f.vehicle, dflt), driver: custodianDrives ? "" : f.pickedDriver, hasCustodian: !!picked?.assigned_to, defaultVehicle: known }, base);
    if ("error" in v) {
      setErr(v.error);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await transport.call<Booked>("book_vehicle", v.input);
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
          {(booked.vehicle_changed || booked.vehicle_used) && (
            <p className="muted small" style={{ margin: 0 }} data-testid="vehicle-used">
              {booked.vehicle_changed ?? `${booked.vehicle_used!.reg_no} · ${booked.vehicle_used!.why === "chosen" ? "as picked" : booked.vehicle_used!.why}`}
            </p>
          )}
          <WarningsNote warnings={warnList(booked)} />
          <div className="acts">
            {booked.task_id && can(me, "assign_tasks") && <Link className="btn" to={`/tasks/${booked.task_id}`}>Open task →</Link>}
            <Link className="btn dark" to="/requests" replace>Done</Link>
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
          {approver && (
            <div className="field">
              <label htmlFor="nr-phone">Requester's phone</label>
              <input id="nr-phone" maxLength={30} inputMode="tel" placeholder="077 123 4567" value={f.requesterPhone ?? ""} onChange={(e) => set("requesterPhone", e.target.value)} />
              <span className="hint">Optional. For someone without a Fame Fleet account: Tell requester sends them the news on WhatsApp.</span>
            </div>
          )}
          <div className="field"><label htmlFor="nr-project">Project or team</label><input id="nr-project" maxLength={200} placeholder="Job no., DU ID, or e.g. HR" value={f.project} onChange={(e) => set("project", e.target.value)} /></div>
        </div>

        <TripEditor trip={trip} prefix="nr" />

        <div className="card card-b form">
          <div className="grid2">
            <div className="field"><label htmlFor="nr-need">Vehicle</label>
              <select id="nr-need" value={f.need} onChange={(e) => set("need", e.target.value)}>
                <option value="">Any</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
              </select>
            </div>
            <div className="field"><label htmlFor="nr-pax">Passengers</label><input type="number" id="nr-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
          </div>
          <div className="field" style={{ gap: 8 }}>
            <span className="check"><input type="checkbox" id="nr-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="nr-tools">Tools or equipment go too</label></span>
            {selfDrive && <span className="check"><input type="checkbox" id="nr-driver" checked={f.driver} onChange={(e) => set("driver", e.target.checked)} /> <label htmlFor="nr-driver">A driver is needed</label></span>}
          </div>
          {selfDrive && <p className="hint" style={{ margin: "-8px 0 0" }}>Untick "A driver is needed" when the person drives a vehicle assigned to them.</p>}
          <div className="field"><label htmlFor="nr-note">Note</label><textarea id="nr-note" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>

        {books && (
          <div className="card card-b form" data-testid="assign-now">
            <div className="section-t" style={{ marginBottom: 10 }}>
              Assign now{sugQ.updating ? <span className="updated" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · Updating…</span> : null}
            </div>
            {!sugArgs && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the leave-by time (or an arrive-by time on a stop) to see which vehicles are free.</p>}
            {sugArgs && sugQ.loading && <SkeletonRows rows={3} label="Finding free vehicles…" />}
            {sugErr && <Notice tone="bad">{sugErr}</Notice>}
            {sug && (
              <div className="form">
                <div className="field">
                  <label htmlFor="nr-driver-pick">Driver</label>
                  {custodianDrives
                    ? <p className="muted small" style={{ margin: 0 }} id="nr-driver-pick">{picked?.assigned_to} drives it (no driver needed).</p>
                    : (
                      <select id="nr-driver-pick" value={f.pickedDriver} onChange={(e) => pickDriver(e.target.value)}>
                        <option value="">Pick a free driver</option>
                        {driverOptions.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}
                      </select>
                    )}
                </div>
                <div className="lab" id="nr-vehicles">Vehicle</div>
                {(f.pickedDriver || dayDefault) && !custodianDrives && (
                  <p className="hint" style={{ margin: 0 }} data-testid="vehicle-default">
                    {dayDefault
                      ? (f.vehicle && f.vehicle !== ON_THE_DAY
                        ? <>Instead of the driver's vehicle on the day. <button type="button" className="linkish" onClick={() => set("vehicle", "")}>Leave it to the day</button></>
                        : <>The driver's vehicle on the day: they confirm it at Start task. Pick another below to change it.</>)
                      : f.vehicle && def && f.vehicle !== def.reg_no
                      ? <>Instead of {def.why} {def.reg_no}. <button type="button" className="linkish" onClick={() => set("vehicle", "")}>Use {def.reg_no}</button></>
                      : def ? <>{def.reg_no} · {def.why}. Pick another below to change it.</>
                      : <>This driver holds no vehicle today and has no regular one: pick one below.</>}
                  </p>
                )}
                {onDay && !custodianDrives && <VehicleChoiceRadios name="nr-veh" value={vehicle} dayDefault={dayDefault} onPick={(v) => set("vehicle", v)} />}
                <VehicleGroups sug={sug} name="nr-veh" vehicle={vehicle} onPick={(reg) => set("vehicle", reg)} greyGarage />
                {sug.vehicles.length === 0 && <Empty>No vehicles registered yet.</Empty>}
              </div>
            )}
          </div>
        )}
        {books && !custodianDrives && (
          <AvailabilityPanel args={availArgs} picked={f.pickedDriver} onPick={(d) => { if (d.username) takeSuggestion(d.username); }}
            onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />
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
