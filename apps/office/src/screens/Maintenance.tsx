// Maintenance (the vehicles permission): problems drivers reported (shown with
// the issues permission, which the reports tool needs) and the service and
// documents of every vehicle.
// Hotfix 3 (L3): the reports' status is in the URL (?status=, default Not closed), newest first, 25 at a time with the
// count in the header.
// Round 4–7 (item 8, §33.7; Fleetio): "Service and documents" is ONE card per vehicle (list_vehicles): the service due by
// km and by date with its bar, the documents' expiries as chips (ok / expiring / expired / missing; the rental's end),
// the summary first, the ones that need attention first (?show=all: every vehicle), 25 at a time; a card opens the
// vehicle. What the old reminder rows also carried (the drivers' licences, the km allowance, missed tasks, odometer checks
// and the rest of the overview's list) is in Issues: one line counts it and opens Issues (the licences are on Reminders
// too). The vehicles list failing shows its error with Try again, never a skeleton for ever.
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { Overview, VehicleCard, VehicleReport, VehicleReports } from "../data/types";
import { cap, today } from "../lib/format";
import { errText } from "../transport/errors";
import { can, canOpenTask, type FleetError } from "../transport/types";
import { Notice, Pill, Plate, Segmented } from "../ui/basics";
import { Icon } from "../ui/icons";
import { FilterBar } from "../ui/FilterBar";
import { pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, SearchBox, SkeletonRows, usePagedList, useUrlFilter, useUrlSearch } from "../ui/ListKit";
import { useToast } from "../ui/Toast";
import { ListFooter, ListStale, ListWaiting } from "./listLocal";
import { CARE_KINDS } from "./overviewLinks";
import { CareList, CareSummary } from "./VehicleCare";
import { careCards, careCounts } from "./vehicleCareLogic";
import { whenText } from "../lib/when";

type Filter = "not_closed" | "open" | "in_garage" | "closed" | "all";
const FILTERS: [Filter, string][] = [["not_closed", "Not closed"], ["open", "Open"], ["in_garage", "In garage"], ["closed", "Closed"], ["all", "All"]];

function ReportCard({ r }: { r: VehicleReport }) {
  const { me, store, transport } = useFleet();
  const toast = useToast();
  const [status, setStatus] = useState<VehicleReport["status"]>(r.status);
  const [note, setNote] = useState("");
  const [garage, setGarage] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = me.tools.includes("update_vehicle_report");

  async function save(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      const input: Record<string, unknown> = { id: r.id, status };
      if (note.trim()) input.office_note = note.trim();
      await transport.call("update_vehicle_report", input);
      if (garage && r.vehicle && me.tools.includes("update_vehicle")) await transport.call("update_vehicle", { reg_no: r.vehicle, in_garage: true });
      toast("Report updated");
      setNote("");
      setGarage(false);
      void store.invalidate();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  return (
    <div className="card rep">
      <div className="row" style={{ padding: 0 }}>
        <span className={`att-ic ${r.status === "closed" ? "" : r.status === "in_garage" ? "warn" : "bad"}`}><Icon name="alert" /></span>
        <div className="grow"><div className="name">{cap(r.category)} <Plate v={r.vehicle} /></div><div className="sub">{r.driver || ""} · reported {whenText(r.reported, { inline: true })}</div></div>
        <Pill tone={r.status === "open" ? "bad" : r.status === "in_garage" ? "warn" : "ok"}>{cap(r.status)}</Pill>
      </div>
      {r.note && <p style={{ margin: 0 }}>{r.note}</p>}
      {r.office_note && <p className="muted" style={{ margin: 0 }}>Office: {r.office_note}</p>}
      <div className="photos">
        {r.photos.map((u, i) => <a key={i} className="btn small" href={u} target="_blank" rel="noopener">Photo {i + 1}</a>)}
        {r.task_id && canOpenTask(me) && <Link className="btn small" to={`/tasks/${r.task_id}`}>Open task →</Link>}
        {r.driver_links?.call && <a className="btn small" href={r.driver_links.call}>Call driver</a>}
      </div>
      {canEdit && (
        <form className="form" onSubmit={save}>
          <div className="grid2">
            <div className="field"><label htmlFor={`rs-${r.id}`}>Status</label>
              <select id={`rs-${r.id}`} value={status} onChange={(e) => setStatus(e.target.value as VehicleReport["status"])}><option value="open">Open</option><option value="in_garage">In garage</option><option value="closed">Closed</option></select></div>
            <div className="field"><label htmlFor={`rn-${r.id}`}>Note for the driver</label><input id={`rn-${r.id}`} maxLength={500} placeholder="e.g. Take it to City Wheels tomorrow" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          {r.vehicle && !r.vehicle_in_garage && me.tools.includes("update_vehicle") && (
            <span className="check"><input type="checkbox" id={`rg-${r.id}`} checked={garage} onChange={(e) => setGarage(e.target.checked)} /> <label htmlFor={`rg-${r.id}`}>Also take {r.vehicle} off the road (in garage)</label></span>
          )}
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div><button className="btn dark small" type="submit" disabled={busy}>Save</button></div>
        </form>
      )}
    </div>
  );
}

/** The list's query key. */
export const REPORTS_QUERY = "reports";

/** Service and documents: the vehicles that need attention (the default) or every vehicle. */
type CareShow = "attention" | "all";
const CARE_SHOW: [CareShow, string][] = [["attention", "Need attention"], ["all", "All vehicles"]];

const FILTER_WORDS: Record<Filter, string> = {
  not_closed: "No problem reports waiting: every report is closed.",
  open: "No open problem reports.",
  in_garage: "No reported vehicle is in the garage.",
  closed: "No closed problem reports yet.",
  all: "No driver has reported a problem yet.",
};

/** What an empty list of reports means, in words. */
export const reportsEmpty = (filter: Filter): string => FILTER_WORDS[filter];

export function Maintenance() {
  const { me, store, noConnector } = useFleet();
  const [filter, setFilter] = useUrlFilter<Filter>("status", "not_closed", FILTERS.map(([k]) => k));
  const [search, setSearch] = useUrlSearch();
  const canReports = me.tools.includes("list_vehicle_reports");
  const fromOverview = can(me, "issues");
  const overview = useEntry<Overview>("overview");
  const lists = useLists(!noConnector);
  const vehiclesEntry = useEntry<{ vehicles: VehicleCard[] }>("lists.vehicles");
  // Hotfix 3 (L3): the newest reports first, 25 at a time (Load more on a phone, page numbers on a desktop).
  const list = usePagedList<VehicleReport, VehicleReports>(REPORTS_QUERY, "list_vehicle_reports", { status: filter, ...(search ? { search } : {}) }, (d) => d.reports,
    { every: 60000, enabled: !noConnector && canReports });
  const q = list.query;
  const d = q.data;

  // Round 4–7 (item 8): the service and documents of every vehicle, one card each, the ones that need attention first.
  const [show, setShow] = useUrlFilter<CareShow>("show", "attention", CARE_SHOW.map(([k]) => k));
  const cards = careCards((lists.vehicles ?? []) as VehicleCard[], today());
  const shown = show === "all" ? cards : cards.filter((c) => c.level > 0);
  // What the overview lists besides the vehicles' service and documents (the cards) and the drivers' problems (above): in
  // Issues, counted here. The drivers' licences are counted too (they are no vehicle's card; Reminders lists them).
  const elsewhere = fromOverview ? (overview.data?.needs_attention ?? []).filter((a) => !CARE_KINDS.has(a.kind ?? "") && a.kind !== "vehicle_report" && !/problem/i.test(a.what || "")).length : 0;
  const label = FILTERS.find(([k]) => k === filter)?.[1] ?? "";
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Problems reported by drivers, service and documents</div><h1>Maintenance</h1></div>
      </div>
      <div className="stack">
        <div className="section-t">Problems reported by drivers</div>
        {!canReports && <Notice tone="info">Problem reports need the Issues permission. Ask an admin for access if you handle them.</Notice>}
        {canReports && (
          <FilterBar
            search={<SearchBox value={search} onChange={setSearch} placeholder="Plate, driver, problem or note" />}
            filters={[pairsDef("status", "Status", FILTERS, "not_closed")]}
            values={{ status: filter }}
            onChange={(v) => setFilter(((v.status as string) || "not_closed") as Filter)}
          />
        )}
        {canReports && !noConnector && <ListWaiting q={q} loading="Loading reports…" />}
        {canReports && d && (
          <div className="stack" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="reports-list">
            <div className="card">
              <ListHeader title={label} count={list.total} updating={q.updating || q.stale} />
              <ListStale q={q} />
              {!list.items.length && (q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{search ? `No report matches "${search}".` : reportsEmpty(filter)}</EmptyLine>)}
            </div>
            {list.items.map((r) => <ReportCard key={r.id} r={r} />)}
            {list.total > list.items.length || list.pages > 1 ? <div className="card"><ListFooter list={list} /></div> : null}
          </div>
        )}
        <div className="section-t">Service and documents</div>
        {!lists.vehicles && !noConnector ? (
          vehiclesEntry.err && !vehiclesEntry.loading
            ? (
              <Notice tone="bad" action={<button type="button" className="btn small" onClick={() => void store.load("lists.vehicles", "list_vehicles", { filter: "all" })}>Try again</button>}>
                <span data-testid="care-error">{errText(vehiclesEntry.err)[0]}</span>
              </Notice>
            )
            : <div className="card"><SkeletonRows rows={3} label="Loading the vehicles…" /></div>
        ) : (
          <>
            <div className="card card-b" style={{ display: "grid", gap: 12 }}>
              <CareSummary counts={careCounts(cards)} />
              <Segmented label="Vehicles shown" options={CARE_SHOW} value={show} onChange={setShow} />
            </div>
            <CareList
              title={show === "all" ? "All vehicles" : "Need attention"}
              cards={shown}
              resetKey={show}
              testId="care-list"
              empty={show === "all" ? "No vehicles yet." : "Every service and document is in order. Add the dates on each vehicle to get reminders."}
            />
          </>
        )}
        {elsewhere > 0 && (
          <Link className="card row link-row" to="/issues" data-testid="maintenance-issues">
            <span className="grow">
              <span className="name" style={{ display: "block" }}>{elsewhere === 1 ? "1 more thing needs attention" : `${elsewhere} more things need attention`}</span>
              <span className="sub" style={{ display: "block" }}>Driver licences, km allowances, missed tasks, odometer checks and the rest are in Issues</span>
            </span>
            <span className="btn small">Open Issues</span>
          </Link>
        )}
      </div>
    </section>
  );
}
