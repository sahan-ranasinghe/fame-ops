// Register a vehicle (/vehicles/new) or change one (/vehicles/:reg/edit): the
// same form; an update sends only the fields filled in. Kept as a draft.
// Phase 7 (§28): after the first save Register vehicle stays on the page with
// the Documents section (/vehicles/new?registered=<plate>): the files need the
// vehicle saved first.
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions, useAfterSave } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { useVehicle, vehicleDates } from "./VehicleDetail";
import { VehicleDocumentsSection } from "./VehicleDocs";
import { emptyVehicle, type VehicleFields, vehicleInput } from "./vehicleLogic";
import { vehiclePath } from "./Vehicles";
import { DateField } from "../ui/DayPicker";

export function VehicleForm() {
  const { reg } = useParams();
  const plate = reg ? decodeURIComponent(reg) : null;
  const isNew = plate === null;
  const { store, transport, me } = useFleet();
  const navigate = useNavigate();
  const afterSave = useAfterSave();
  const toast = useToast();
  const lists = useLists();
  const [params] = useSearchParams();
  const registered = isNew ? params.get("registered") : null;
  const [f, setF, draft] = useFormDraft<VehicleFields>(isNew ? "vehicle-new" : "vehicle-edit", plate, emptyVehicle);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [company, setCompany] = useState<{ open: boolean; name: string; phone: string; msg: string | null }>({ open: false, name: "", phone: "", msg: null });
  const set = <K extends keyof VehicleFields>(k: K, v: VehicleFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const field = (id: keyof VehicleFields, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`vf-${id}`}>{label}</label>
      {/* A plain date (Rented until, an expiry): one field and the calendar (docs/ui-patterns.md §3). */}
      {type === "date"
        ? <DateField id={`vf-${id}`} label={label} value={String(f[id] ?? "")} onChange={(d) => set(id, d as VehicleFields[typeof id])} />
        : <input id={`vf-${id}`} type={type} value={f[id]} onChange={(e) => set(id, e.target.value as VehicleFields[typeof id])} {...extra} />}
    </div>
  );
  const backTo = isNew ? "/vehicles" : vehiclePath(plate);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = vehicleInput(f, plate);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      const out = await transport.call<{ registered?: { reg_no?: string } }>(v.tool, v.input);
      draft.clear();
      toast(isNew ? "Vehicle registered" : "Vehicle updated");
      void store.invalidate();
      void store.load("lists.vehicles", "list_vehicles", { filter: "all" });
      // A new vehicle: the same page with its Documents section (when this person may add them), else the vehicle.
      if (isNew && me.tools.includes("vehicle_documents")) {
        navigate(`/vehicles/new?registered=${encodeURIComponent(out?.registered?.reg_no ?? String(v.input.reg_no))}`, { replace: true });
        setBusy(false);
      } else if (isNew) navigate(vehiclePath(String(v.input.reg_no)), { replace: true });
      else afterSave(backTo);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  async function saveCompany() {
    if (!company.name.trim()) {
      setCompany({ ...company, msg: "Add the name." });
      return;
    }
    try {
      const input: Record<string, unknown> = { name: company.name.trim() };
      if (company.phone.trim()) input.phone = company.phone.trim();
      await transport.call("add_rental_company", input);
      set("company", company.name.trim());
      setCompany({ open: false, name: "", phone: "", msg: `Added ${company.name.trim()}.` });
    } catch (e) {
      setCompany({ ...company, msg: errText(e as FleetError)[0] });
    }
  }

  if (registered) return <Registered reg={registered} />;
  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  return (
    <section className="view" data-testid="vehicle-form">
      <PageTop title={isNew ? "Register vehicle" : plate} sub={isNew ? "New rented vehicle" : "Change the vehicle"} backTo={backTo} />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        <div className="card card-b form">
          {isNew
            ? field("reg", "Number plate", "text", { maxLength: 20, placeholder: "WP CAB-4521", "data-focus": true })
            : <p className="muted small" style={{ margin: 0 }}>Fill in only what you want to change. Empty fields keep their current value.</p>}
          <div className="grid2">
            {field("model", "Make and model", "text", { maxLength: 80, placeholder: "Toyota HiAce" })}
            <div className="field">
              <label htmlFor="vf-type">Type</label>
              <select id="vf-type" value={f.type} onChange={(e) => set("type", e.target.value)}>
                <option value="">{isNew ? "Choose" : "Keep"}</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
              </select>
            </div>
            {field("seats", "Seats", "number", { min: 1, max: 80, inputMode: "numeric" })}
            {field("allow", "Km allowed per month", "number", { min: 0, inputMode: "numeric" })}
            {field("odo", "Odometer now (km)", "number", { min: 0, inputMode: "numeric" })}
            {field("rent", "Monthly rent (LKR)", "number", { min: 0, inputMode: "decimal" })}
          </div>
          <div className="grid2">
            {field("company", "Rental company", "text", { maxLength: 120 })}
            {field("until", "Rented until", "date")}
          </div>
          {me.tools.includes("add_rental_company") && (
            <div>
              <p className="hint" style={{ margin: "-8px 0 0" }}>A new rental company must be added first: <button type="button" className="linkish" onClick={() => setCompany({ ...company, open: true, msg: null })}>add a rental company</button>.</p>
              {company.open && (
                <div style={{ marginTop: 8 }}>
                  <div className="grid2" style={{ alignItems: "end" }}>
                    <div className="field"><label htmlFor="rc-name">Rental company</label><input id="rc-name" maxLength={120} value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></div>
                    <div className="field"><label htmlFor="rc-phone">Phone</label><input id="rc-phone" maxLength={30} inputMode="tel" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></div>
                  </div>
                  <div style={{ marginTop: 8 }}><button type="button" className="btn small dark" onClick={() => void saveCompany()}>Add company</button></div>
                </div>
              )}
              {company.msg && <p className="status live small" style={{ margin: "6px 0 0" }}>{company.msg}</p>}
            </div>
          )}
          <div className="field">
            <label htmlFor="vf-driver">Regular driver</label>
            <select id="vf-driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}>
              <option value="">{isNew ? "None" : "Keep"}</option>
              {drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid2">
            {field("custodian", "Assigned to (custodian)", "text", { maxLength: 120, placeholder: isNew ? "An office person's name or e-mail" : "Name or e-mail · none to clear" })}
            {field("custodianNote", "Custody note", "text", { maxLength: 200, placeholder: "e.g. Keeps it at Rajagiriya" })}
          </div>
          <p className="hint" style={{ margin: "-8px 0 0" }}>A vehicle assigned to someone shows "ask first" when the office books it; with no driver needed, that person drives.</p>
          <div className="grid2">
            {field("svcint", "Service every (km)", "number", { min: 1, inputMode: "numeric" })}
            {field("svclast", "Last service at (km)", "number", { min: 0, inputMode: "numeric" })}
            {field("svcdate", "Next service date", "date")}
            {!isNew && field("garage", "Garage booked for", "date")}
          </div>
          <div className="grid2">
            {field("lic", "Revenue licence expires", "date")}
            {field("ins", "Insurance expires", "date")}
            {field("emi", "Emission test expires", "date")}
          </div>
          {!isNew && (
            <div className="grid2">
              <div className="field"><label htmlFor="vf-ingarage">In the garage now</label>
                <select id="vf-ingarage" value={f.ingarage} onChange={(e) => set("ingarage", e.target.value as VehicleFields["ingarage"])}><option value="">Keep</option><option value="true">Yes</option><option value="false">No</option></select></div>
              <div className="field"><label htmlFor="vf-active">Still rented</label>
                <select id="vf-active" value={f.active} onChange={(e) => set("active", e.target.value as VehicleFields["active"])}><option value="">Keep</option><option value="true">Yes</option><option value="false">No, returned</option></select></div>
            </div>
          )}
          {msg && <Notice tone="bad">{msg}</Notice>}
        </div>
        {isNew && me.tools.includes("vehicle_documents") && (
          <div className="card card-b form" data-testid="documents-after-save">
            <h2>Documents</h2>
            <p className="muted small" style={{ margin: 0 }}>The revenue licence, insurance, emission test, CR and the rent or lease agreement are added here after Register vehicle: the files need the vehicle saved first.</p>
          </div>
        )}
        <StickyActions><button className="btn primary" type="submit" disabled={busy}>{isNew ? "Register vehicle" : "Save changes"}</button></StickyActions>
      </form>
    </section>
  );
}

/** Register vehicle after the first save: the vehicle is in, its documents can go up now. */
function Registered({ reg }: { reg: string }) {
  const { v } = useVehicle(reg);
  return (
    <section className="view" data-testid="vehicle-registered">
      <PageTop title="Register vehicle" sub="New rented vehicle" backTo="/vehicles" />
      <div className="page-form">
        <Notice tone="ok"><b>{reg} is registered.</b> Add its documents now, or later on the vehicle's page.</Notice>
        <VehicleDocumentsSection key={reg} reg={reg} rented={!!v?.rented_from} dates={v ? vehicleDates(v) : {}} />
        <StickyActions>
          <Link className="btn primary" to={vehiclePath(reg)}>Open the vehicle</Link>
          <Link className="btn" to="/vehicles/new">Register another</Link>
        </StickyActions>
      </div>
    </section>
  );
}
