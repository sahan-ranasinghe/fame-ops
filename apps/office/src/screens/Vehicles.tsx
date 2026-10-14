// Vehicles (/vehicles): the board with its filters; a vehicle's detail beside
// it (/vehicles/:reg); Register at /vehicles/new, Edit at /vehicles/:reg/edit.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { VehiclesList } from "../data/types";
import { joinDots, num, vehicleAvailabilityTone } from "../lib/format";
import { Chips, Empty, ErrBox, Loading, Pill, StaleNote } from "../ui/basics";
import { ListWithDetail } from "../ui/Page";
import { docTone } from "./vehicleLogic";

type Filter = "all" | "on_task" | "available" | "in_garage" | "documents_expiring" | "inactive";
const FILTERS: [Filter, string][] = [["all", "All"], ["on_task", "On a task"], ["available", "Available"], ["in_garage", "In garage"], ["documents_expiring", "Documents expiring"], ["inactive", "Returned"]];

export function DocChip({ name, d }: { name: string; d?: { chip?: string; expiry?: string } }) {
  const title = d?.expiry ? `${name} expires ${d.expiry}` : `${name}: ${d?.chip ?? "not set"}`;
  return <span className={`doc ${docTone(d?.chip)}`} title={title}>{name}</span>;
}

export const vehiclePath = (reg: string) => `/vehicles/${encodeURIComponent(reg)}`;

export function Vehicles() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const entry = useEntry<VehiclesList>("vehicles");

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
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">{c ? `${c.all} vehicles` : "Rented vehicles"}</div><h1>Vehicles</h1></div>
          <div className="ph-actions">
            {me.tools.includes("register_vehicle") && <Link className="btn primary" to="/vehicles/new">Register vehicle</Link>}
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
                    <thead><tr><th>Vehicle</th><th>Rented from</th><th>Regular driver</th><th>Assigned to</th><th>Km this month</th><th>Next service</th><th>Documents</th><th>Status</th></tr></thead>
                    <tbody>
                      {list.map((v) => {
                        const used = Number(v.km_this_month) || 0, allow = Number(v.km_allowance) || 0, over = allow > 0 && used > allow;
                        const svc = String(v.service_state || "").toLowerCase();
                        const docs = v.documents ?? {};
                        const st = String(v.status || "");
                        return (
                          <tr key={v.reg_no} className="click" onClick={() => navigate(vehiclePath(v.reg_no))}>
                            <td data-label="Vehicle"><span><span className="plate">{v.reg_no}</span><div className="sub" style={{ marginTop: 6 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.type && !v.make_model ? v.type : ""])}</div></span></td>
                            <td data-label="Rented from"><span>{v.rented_from || "—"}{v.rent_until && <div className="sub">Until {v.rent_until}</div>}</span></td>
                            <td data-label="Regular driver">{v.regular_driver || "—"}</td>
                            <td data-label="Assigned to">
                              {v.assigned_to
                                ? (
                                  <span>
                                    <b>{v.assigned_to}</b>
                                    {v.custodian_note && <div className="sub">{v.custodian_note}</div>}
                                    {(v.assigned_to_links?.call || v.assigned_to_links?.whatsapp) && (
                                      <div className="sub" onClick={(e) => e.stopPropagation()}>
                                        {v.assigned_to_links?.call && <a href={v.assigned_to_links.call}>Call</a>}
                                        {v.assigned_to_links?.call && v.assigned_to_links?.whatsapp && " · "}
                                        {v.assigned_to_links?.whatsapp && <a href={v.assigned_to_links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
                                      </div>
                                    )}
                                  </span>
                                )
                                : <span className="muted">Pool</span>}
                            </td>
                            <td data-label="Km this month">
                              <span><span className="num"><b className={over ? "status bad" : ""}>{num(used)} km</b>{allow ? ` / ${num(allow)}` : ""}</span>
                                {allow > 0 && <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${Math.min(100, used / allow * 100).toFixed(1)}%` }} /></div>}</span>
                            </td>
                            <td data-label="Next service"><span className={svc.includes("overdue") ? "status bad" : svc.includes("soon") || svc.includes("due") ? "status warn" : ""}>{v.next_service || "—"}</span></td>
                            <td data-label="Documents"><span><DocChip name="Lic" d={docs.lic} /><DocChip name="Ins" d={docs.ins} /><DocChip name="Emi" d={docs.emi} /></span></td>
                            <td data-label="Status">
                              <span><Pill tone={/task/i.test(st) ? "live" : /garage/i.test(st) ? "warn" : ""}>{st || "—"}</Pill>
                                {v.availability && <div className={`sub status ${vehicleAvailabilityTone(v.availability)}`} style={{ marginTop: 4 }}>{v.availability}</div>}</span>
                            </td>
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
      </ListWithDetail>
    </section>
  );
}
