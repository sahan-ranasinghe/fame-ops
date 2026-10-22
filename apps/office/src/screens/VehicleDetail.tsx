// One vehicle, read only (/vehicles/:reg): what the board knows about it, with
// Edit (/vehicles/:reg/edit) for someone who may change it. Phase 7 (§6, §28):
// the photo large (Upload photo / Replace photo on the web) and the Documents
// section. Round 4–7 (4): the vehicle check (Today's check and the last 7 days); a notification's ?check=<id> scrolls to it.
import { useContext, useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { DocKind, VehicleCard, VehiclesList } from "../data/types";
import { joinDots, num, vehicleAvailabilityTone } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { PageTop } from "../ui/Page";
import { VehiclePhotoCard } from "./PhotoUpload";
import { VehicleChecksSection } from "./VehicleChecks";
import { VehicleDocumentsSection } from "./VehicleDocs";
import { DocChip, MissingDocs, vehiclePath, VehiclesShown } from "./Vehicles";
import { dayWords } from "../lib/when";

/**
 * The vehicle from the board's rows on screen (followed as the board refreshes, so an edit shows at once), else found by
 * list_vehicles' search (one page; the active vehicles, then the returned ones) once the board is not loading. Hotfix 3
 * (L3): the board shows a page at a time, so the whole list is never asked for one vehicle.
 */
export function useVehicle(reg: string): { v: VehicleCard | undefined; err: string | null } {
  const { transport } = useFleet();
  const board = useContext(VehiclesShown);
  const fromBoard = board?.rows.find((x) => x.reg_no === reg);
  const [v, setV] = useState<VehicleCard | undefined>(fromBoard);
  const [err, setErr] = useState<string | null>(null);
  const boardLoading = !!board?.loading;
  useEffect(() => {
    if (fromBoard) {
      setV(fromBoard);
      setErr(null);
      return;
    }
    if (boardLoading) return; // the board's answer arrives through fromBoard
    let alive = true;
    const find = async (filter: "all" | "inactive") =>
      (await transport.call<VehiclesList>("list_vehicles", { filter, search: reg, limit: 25 })).vehicles.find((x) => x.reg_no === reg);
    void (async () => (await find("all")) ?? (await find("inactive")))()
      .then((found) => {
        if (!alive) return;
        setV(found);
        setErr(found ? null : `No vehicle has the plate ${reg}.`);
      })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
  }, [reg, transport, fromBoard, boardLoading]);
  return { v, err };
}

/** The vehicle's own dates, where the Documents section's expiry inputs start when no document carries one yet. */
export function vehicleDates(v: VehicleCard): Partial<Record<DocKind, string>> {
  return {
    revenue_licence: v.documents?.lic?.expiry ?? undefined,
    insurance: v.documents?.ins?.expiry ?? undefined,
    emission: v.documents?.emi?.expiry ?? undefined,
    lease: v.rent_until ?? undefined,
  };
}

export function VehicleDetail() {
  const { reg = "" } = useParams();
  const plate = decodeURIComponent(reg);
  const { me } = useFleet();
  const { v, err } = useVehicle(plate);
  const canEdit = me.tools.includes("update_vehicle");
  // Round 4–7 (4): a check to scroll to (a pre-trip problem's notification links /vehicles/<plate>?check=<id>).
  const [params] = useSearchParams();
  const focus = params.get("check");
  // Back to the board with its filter (Phase 7, §16: the filter is in the URL), without the check.
  const backParams = new URLSearchParams(useLocation().search);
  backParams.delete("check");
  const backQuery = backParams.toString();
  const back = `/vehicles${backQuery ? `?${backQuery}` : ""}`;
  if (err) return <><PageTop title={plate} backTo={back} /><Notice tone="bad">{err}</Notice></>;
  if (!v) return <><PageTop title={plate} backTo={back} /><Loading>Loading the vehicle…</Loading></>;
  const docs = v.documents ?? {};
  const used = Number(v.km_this_month) || 0, allow = Number(v.km_allowance) || 0;
  return (
    <div className="vehicle-detail" data-testid="vehicle-detail">
      <PageTop title={<span className="plate" style={{ fontSize: 22 }}>{v.reg_no}</span>} sub={v.make_model || "Vehicle"} backTo={back}
        actions={canEdit ? <Link className="btn small dark" to={`${vehiclePath(v.reg_no)}/edit`}>Edit</Link> : undefined} />
      <VehiclePhotoCard key={v.reg_no} reg={v.reg_no} photoUrl={v.photo_url} />
      <div className="card card-b">
        <dl className="kv">
          <div><dt>Status</dt><dd><Pill tone={/task/i.test(String(v.status)) ? "live" : /garage/i.test(String(v.status)) ? "warn" : ""}>{v.status || "—"}</Pill>{v.availability && <div className={`sub status ${vehicleAvailabilityTone(v.availability)}`}>{v.availability}</div>}</dd></div>
          <div><dt>Type · seats</dt><dd>{joinDots([v.type, v.seats ? `${v.seats} seats` : ""]) || "—"}</dd></div>
          <div><dt>Rented from</dt><dd>{v.rented_from || "—"}{v.rent_until && <div className="sub">until {dayWords(v.rent_until, { inline: true })}</div>}</dd></div>
          <div><dt>Monthly rent</dt><dd>{v.monthly_rent_lkr != null ? `LKR ${num(v.monthly_rent_lkr)}` : "—"}</dd></div>
          <div><dt>Regular driver</dt><dd>{v.regular_driver || "—"}</dd></div>
          <div><dt>Assigned to</dt><dd>{v.assigned_to ? <>{v.assigned_to}{v.custodian_note && <div className="sub">{v.custodian_note}</div>}</> : <span className="muted">Pool</span>}</dd></div>
          <div><dt>Km this month</dt><dd className="num">{num(used)} km{allow ? ` / ${num(allow)}` : ""}{!allow && v.km_allowance_note && <div className="sub" data-testid="km-allowance-note">{v.km_allowance_note}</div>}</dd></div>
          <div><dt>Odometer</dt><dd className="num">{v.odometer_km != null ? `${num(v.odometer_km)} km` : "—"}</dd></div>
          <div><dt>Next service</dt><dd>{v.next_service || "—"}{v.service_state && <div className="sub">{v.service_state}</div>}</dd></div>
          <div><dt>Garage booked</dt><dd>{v.garage_booked ? dayWords(v.garage_booked) : "—"}</dd></div>
          <div style={{ gridColumn: "1/-1" }}><dt>Documents</dt><dd><DocChip name="Lic" d={docs.lic} /><DocChip name="Ins" d={docs.ins} /><DocChip name="Emi" d={docs.emi} />{[docs.lic, docs.ins, docs.emi].some((x) => x?.expiry) && <div className="sub">{joinDots([docs.lic?.expiry && `licence ${dayWords(docs.lic.expiry, { inline: true })}`, docs.ins?.expiry && `insurance ${dayWords(docs.ins.expiry, { inline: true })}`, docs.emi?.expiry && `emission ${dayWords(docs.emi.expiry, { inline: true })}`])}</div>}<MissingDocs v={v} /></dd></div>
        </dl>
      </div>
      <VehicleChecksSection key={`checks-${v.reg_no}`} plate={v.reg_no} today={v.check_today} focus={focus} />
      <VehicleDocumentsSection key={`docs-${v.reg_no}`} reg={v.reg_no} rented={!!v.rented_from} dates={vehicleDates(v)} />
      {canEdit && <div className="acts"><Link className="btn dark" to={`${vehiclePath(v.reg_no)}/edit`}>Edit vehicle</Link></div>}
    </div>
  );
}
