import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { VehicleCard, VehiclesList } from "../data/types";
import { joinDots, num } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Chips, Empty, ErrBox, Loading, Notice, Pill, StaleNote } from "../ui/basics";
import { DrawerTop, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { docTone, emptyVehicle, type VehicleFields, vehicleInput } from "./vehicleLogic";

type Filter = "all" | "on_task" | "available" | "in_garage" | "documents_expiring" | "inactive";
const FILTERS: [Filter, string][] = [["all", "All"], ["on_task", "On a task"], ["available", "Available"], ["in_garage", "In garage"], ["documents_expiring", "Documents expiring"], ["inactive", "Returned"]];

function DocChip({ name, d }: { name: string; d?: { chip?: string; expiry?: string } }) {
  const title = d?.expiry ? `${name} expires ${d.expiry}` : `${name}: ${d?.chip ?? "not set"}`;
  return <span className={`doc ${docTone(d?.chip)}`} title={title}>{name}</span>;
}

export function Vehicles() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const [filter, setFilter] = useState<Filter>("all");
  const entry = useEntry<VehiclesList>("vehicles");
  const canEdit = me.tools.includes("update_vehicle");

  useEffect(() => {
    if (noConnector) return;
    store.reset("vehicles");
    store.watch("vehicles", "list_vehicles", { filter }, 60000);
    return () => store.unwatch("vehicles");
  }, [store, filter, noConnector]);

  const d = entry.data && entry.data.filter === filter ? entry.data : undefined;
  const c = d?.counts;
  const list = d?.vehicles ?? [];

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">{c ? `${c.all} vehicles` : "Rented vehicles"}</div><h1>Vehicles</h1></div>
        <div className="ph-actions">
          {me.tools.includes("register_vehicle") && <button type="button" className="btn primary" onClick={() => drawer.open(<VehicleDrawer vehicle={null} />)}>Register vehicle</button>}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <Chips options={FILTERS} value={filter} onChange={setFilter} counts={c ? { all: c.all, on_task: c.on_task, available: c.available, in_garage: c.in_garage, documents_expiring: c.documents_expiring, inactive: c.inactive } : undefined} />
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("vehicles", "list_vehicles", { filter })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading vehicles…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card" style={{ marginBottom: 12 }}>
            {list.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Vehicle</th><th>Rented from</th><th>Regular driver</th><th>Km this month</th><th>Next service</th><th>Documents</th><th>Status</th></tr></thead>
                  <tbody>
                    {list.map((v) => {
                      const used = Number(v.km_this_month) || 0, allow = Number(v.km_allowance) || 0, over = allow > 0 && used > allow;
                      const svc = String(v.service_state || "").toLowerCase();
                      const docs = v.documents ?? {};
                      const st = String(v.status || "");
                      return (
                        <tr key={v.reg_no} className={canEdit ? "click" : ""} onClick={canEdit ? () => drawer.open(<VehicleDrawer vehicle={v} />) : undefined}>
                          <td><span className="plate">{v.reg_no}</span><div className="sub" style={{ marginTop: 6 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.type && !v.make_model ? v.type : ""])}</div></td>
                          <td>{v.rented_from || "—"}{v.rent_until && <div className="sub">Until {v.rent_until}</div>}</td>
                          <td>{v.regular_driver || "—"}</td>
                          <td>
                            <span className="num"><b className={over ? "status bad" : ""}>{num(used)} km</b>{allow ? ` / ${num(allow)}` : ""}</span>
                            {allow > 0 && <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${Math.min(100, used / allow * 100).toFixed(1)}%` }} /></div>}
                          </td>
                          <td><span className={svc.includes("overdue") ? "status bad" : svc.includes("soon") || svc.includes("due") ? "status warn" : ""}>{v.next_service || "—"}</span></td>
                          <td><DocChip name="Lic" d={docs.lic} /><DocChip name="Ins" d={docs.ins} /><DocChip name="Emi" d={docs.emi} /></td>
                          <td><Pill tone={/task/i.test(st) ? "live" : /garage/i.test(st) ? "warn" : ""}>{st || "—"}</Pill></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No vehicles in this group. Register the first one with Register vehicle.</Empty>}
          </div>
        </>
      )}
      <p className="muted small">Document chips: Lic = revenue licence, Ins = insurance, Emi = emission test. Orange = expires within 30 days, red = within 7 days or expired.</p>
    </section>
  );
}

export function VehicleDrawer({ vehicle }: { vehicle: VehicleCard | null }) {
  const { store, transport, me } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const lists = useLists();
  const isNew = vehicle === null;
  const [f, setF] = useState<VehicleFields>(emptyVehicle);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [company, setCompany] = useState<{ open: boolean; name: string; phone: string; msg: string | null }>({ open: false, name: "", phone: "", msg: null });
  const set = <K extends keyof VehicleFields>(k: K, v: VehicleFields[K]) => setF((x) => ({ ...x, [k]: v }));
  const field = (id: keyof VehicleFields, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={`vf-${id}`}>{label}</label>
      <input id={`vf-${id}`} type={type} value={f[id]} onChange={(e) => set(id, e.target.value as VehicleFields[typeof id])} {...extra} />
    </div>
  );

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const v = vehicleInput(f, isNew ? null : vehicle.reg_no);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      await transport.call(v.tool, v.input);
      toast(isNew ? "Vehicle registered" : "Vehicle updated");
      drawer.close();
      void store.invalidate();
      void store.load("lists.vehicles", "list_vehicles", { filter: "all" });
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

  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  return (
    <>
      <DrawerTop title={isNew ? "Register vehicle" : vehicle.reg_no} sub={isNew ? "New rented vehicle" : vehicle.make_model || "Vehicle"} />
      <form className="card card-b form" onSubmit={submit} noValidate>
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
        <button className="btn primary" type="submit" disabled={busy}>{isNew ? "Register vehicle" : "Save changes"}</button>
      </form>
    </>
  );
}
