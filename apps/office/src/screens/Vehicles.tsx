// Vehicles (/vehicles): the board with its filters; a vehicle's detail beside
// it (/vehicles/:reg); Register at /vehicles/new, Edit at /vehicles/:reg/edit.
// Phase 7 (§16): the filter is in the URL (?filter=free | garage | on_task | documents | returned; none = All), so the
// Overview's "Free now" and "In garage" open it, a reload keeps it, and a chip changes it in place.
// Hotfix 3 (L3): one list pattern. A search box (?q=: plate, make, regular driver, custodian, holder; on the server), 25
// at a time (page numbers on a desktop, Load more and cards on a phone), the count in the header; the chips' counts stay
// the whole fleet's. A vehicle with no allowance says "no km allowance set" (no allowance check then).
import { createContext } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { VehicleCard, VehiclesList } from "../data/types";
import { joinDots, num, vehicleAvailabilityTone } from "../lib/format";
import { Chips, Pill, VehicleThumb } from "../ui/basics";
import { EmptyLine, ListHeader, usePagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "./listLocal";
import { filterFromWord, VEHICLE_FILTER_WORDS, VEHICLE_FILTERS as FILTERS, type VehicleFilter as Filter, withParam } from "./overviewLinks";
import { docTone } from "./vehicleLogic";

export function DocChip({ name, d }: { name: string; d?: { chip?: string; expiry?: string } }) {
  const title = d?.expiry ? `${name} expires ${d.expiry}` : `${name}: ${d?.chip ?? "not set"}`;
  return <span className={`doc ${docTone(d?.chip)}`} title={title}>{name}</span>;
}

/** Phase 7 (§28): a grey "no document" chip and what is missing ("3 documents missing: insurance, emission test, CR"). */
export function MissingDocs({ v }: { v: Pick<VehicleCard, "documents_missing" | "documents_missing_text"> }) {
  if (!v.documents_missing?.length) return null;
  return (
    <>
      <span className="doc nofile" title={v.documents_missing_text}>no document</span>
      {v.documents_missing_text && <div className="sub" data-testid="docs-missing-text">{v.documents_missing_text}</div>}
    </>
  );
}

export const vehiclePath = (reg: string) => `/vehicles/${encodeURIComponent(reg)}`;

/** The list's query key. */
export const VEHICLES_QUERY = "vehicles";

/** The rows the board shows, for the vehicle page beside it (it follows the board's refreshes, so an edit shows at once). */
export const VehiclesShown = createContext<{ rows: VehicleCard[]; loading: boolean } | null>(null);

/** list_vehicles' filters (the page asks with limit and cursor on top). */
export function vehiclesArgs(filter: Filter, search: string): Record<string, unknown> {
  return { filter, ...(search ? { search } : {}) };
}

const FILTER_WORDS: Record<Filter, string> = {
  all: "vehicles",
  on_task: "vehicles on a task",
  available: "available vehicles",
  in_garage: "vehicles in the garage",
  documents_expiring: "vehicles with documents expiring",
  inactive: "returned vehicles",
};

/** What an empty list means, in words. */
export function vehiclesEmpty(filter: Filter, search: string, canRegister: boolean): string {
  if (search) return `No ${FILTER_WORDS[filter]} match "${search}" (plate, make, regular driver, custodian or holder).`;
  if (filter === "all") return canRegister ? "No vehicles yet. Register the first one with Register vehicle." : "No vehicles yet.";
  return `No ${FILTER_WORDS[filter]} right now.`;
}

/** "1,240 km / 2,500" and its bar; with no allowance set (null or 0), the server's words instead of a bar. */
export function KmThisMonth({ v }: { v: Pick<VehicleCard, "km_this_month" | "km_allowance" | "km_allowance_note"> }) {
  const used = Number(v.km_this_month) || 0, allow = Number(v.km_allowance) || 0, over = allow > 0 && used > allow;
  return (
    <span>
      <span className="num"><b className={over ? "status bad" : ""}>{num(used)} km</b>{allow ? ` / ${num(allow)}` : ""}</span>
      {allow > 0 && <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${Math.min(100, used / allow * 100).toFixed(1)}%` }} /></div>}
      {!allow && v.km_allowance_note && <div className="sub" data-testid="km-allowance-note">{v.km_allowance_note}</div>}
    </span>
  );
}

export function Vehicles() {
  const { me, noConnector } = useFleet();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = filterFromWord<Filter>(VEHICLE_FILTER_WORDS, params.get("filter"), "all");
  const setFilter = (f: Filter) => setParams((p) => withParam(p, "filter", VEHICLE_FILTER_WORDS[f]), { replace: true });
  const box = useSearchBox();
  const canRegister = me.tools.includes("register_vehicle");
  const list = usePagedList<VehicleCard, VehiclesList>(VEHICLES_QUERY, "list_vehicles", vehiclesArgs(filter, box.search), (d) => d.vehicles,
    { every: 60000, enabled: !noConnector });
  const q = list.query;
  const d = q.data;
  // The chips' counts are the whole fleet's whatever the filter (none for Returned).
  const c = d?.counts;
  const label = FILTERS.find(([k]) => k === filter)?.[1] ?? "All";

  return (
    <section className="view">
      <VehiclesShown.Provider value={{ rows: list.items, loading: q.loading }}>
        <ListWithDetail>
          <div className="ph">
            <div><div className="eyebrow">{c ? `${c.all} vehicles` : "Rented vehicles"}</div><h1>Vehicles</h1></div>
            <div className="ph-actions">
              {canRegister && <Link className="btn primary" to="/vehicles/new">Register vehicle</Link>}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Chips options={FILTERS} value={filter} onChange={setFilter} counts={c ? { all: c.all, on_task: c.on_task, available: c.available, in_garage: c.in_garage, documents_expiring: c.documents_expiring, inactive: c.inactive } : undefined} />
          </div>
          <div className="list-tools">
            <SearchBox label="Find a vehicle" placeholder="Plate, make, driver or custodian" value={box.text} onChange={box.setText} />
          </div>
          {!noConnector && <ListWaiting q={q} loading="Loading vehicles…" />}
          {d && (
            <div className="card" style={{ marginBottom: 12, ...(q.stale ? { opacity: 0.6 } : {}) }} aria-busy={q.updating || q.stale || undefined} data-testid="vehicles-list">
              <ListHeader title={filter === "all" ? "Vehicles" : label} count={list.total} updating={q.updating || q.stale} />
              <ListStale q={q} />
              {list.items.length ? (
                <div className="tbl-wrap">
                  <table data-testid="vehicles-table">
                    <thead><tr><th>Vehicle</th><th>Rented from</th><th>Regular driver</th><th>Assigned to</th><th>Km this month</th><th>Next service</th><th>Documents</th><th>Status</th></tr></thead>
                    <tbody>
                      {list.items.map((v) => {
                        const svc = String(v.service_state || "").toLowerCase();
                        const docs = v.documents ?? {};
                        const st = String(v.status || "");
                        return (
                          <tr key={v.reg_no} className="click" data-testid="vehicle-row" onClick={() => navigate({ pathname: vehiclePath(v.reg_no), search: params.toString() ? `?${params}` : "" })}>
                            <td data-label="Vehicle"><span><span className="with-photo"><VehicleThumb src={v.thumb_url} /><span className="plate">{v.reg_no}</span></span><div className="sub" style={{ marginTop: 6 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.type && !v.make_model ? v.type : ""])}</div></span></td>
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
                            <td data-label="Km this month"><KmThisMonth v={v} /></td>
                            <td data-label="Next service"><span className={svc.includes("overdue") ? "status bad" : svc.includes("soon") || svc.includes("due") ? "status warn" : ""}>{v.next_service || "—"}</span></td>
                            <td data-label="Documents"><span><DocChip name="Lic" d={docs.lic} /><DocChip name="Ins" d={docs.ins} /><DocChip name="Emi" d={docs.emi} /><MissingDocs v={v} /></span></td>
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
              ) : <EmptyLine>{q.stale ? "Loading…" : vehiclesEmpty(filter, box.search, canRegister)}</EmptyLine>}
              <ListFooter list={list} />
            </div>
          )}
          <p className="muted small">Document chips: Lic = revenue licence, Ins = insurance, Emi = emission test. Orange = expires within 30 days, red = within 7 days or expired. Grey "no document" = a paper the vehicle should have is not uploaded.</p>
        </ListWithDetail>
      </VehiclesShown.Provider>
    </section>
  );
}
