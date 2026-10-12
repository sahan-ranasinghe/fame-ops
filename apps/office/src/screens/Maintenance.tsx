import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Overview, VehicleReport, VehicleReports } from "../data/types";
import { attIcon, cap, levelTone } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Chips, Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { TaskDrawer } from "./TaskDrawer";

type Filter = "not_closed" | "open" | "in_garage" | "closed" | "all";
const FILTERS: [Filter, string][] = [["not_closed", "Not closed"], ["open", "Open"], ["in_garage", "In garage"], ["closed", "Closed"], ["all", "All"]];

function ReportCard({ r }: { r: VehicleReport }) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
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
        <div className="grow"><div className="name">{cap(r.category)} <Plate v={r.vehicle} /></div><div className="sub">{r.driver || ""} · reported {r.reported}</div></div>
        <Pill tone={r.status === "open" ? "bad" : r.status === "in_garage" ? "warn" : "ok"}>{cap(r.status)}</Pill>
      </div>
      {r.note && <p style={{ margin: 0 }}>{r.note}</p>}
      {r.office_note && <p className="muted" style={{ margin: 0 }}>Office: {r.office_note}</p>}
      <div className="photos">
        {r.photos.map((u, i) => <a key={i} className="btn small" href={u} target="_blank" rel="noopener">Photo {i + 1}</a>)}
        {r.task_id && me.tools.includes("task_detail") && <button type="button" className="btn small" onClick={() => drawer.open(<TaskDrawer id={r.task_id!} />)}>Open task</button>}
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

export function Maintenance() {
  const { store, noConnector, managePermissions } = useFleet();
  const [filter, setFilter] = useState<Filter>("not_closed");
  const entry = useEntry<VehicleReports>("reports");
  const overview = useEntry<Overview>("overview");

  useEffect(() => {
    if (noConnector) return;
    store.reset("reports");
    store.watch("reports", "list_vehicle_reports", { status: filter }, 60000);
    return () => store.unwatch("reports");
  }, [store, filter, noConnector]);

  const d = entry.data && entry.data.status === filter ? entry.data : undefined;
  const att = (overview.data?.needs_attention ?? []).filter((a) => !/problem/i.test(a.what || ""));
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Problems reported by drivers, service and documents</div><h1>Maintenance</h1></div>
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </div>
      <div className="stack">
        {d && <StaleNote entry={entry} />}
        <div className="section-t">Problems reported by drivers</div>
        {!d && !noConnector && (
          <>
            <ErrBox entry={entry} onRetry={() => void store.load("reports", "list_vehicle_reports", { status: filter })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!entry.err && <Loading>Loading reports…</Loading>}
          </>
        )}
        {d && (d.reports.length ? d.reports.map((r) => <ReportCard key={r.id} r={r} />) : <div className="card"><Empty>No problem reports here.</Empty></div>)}
        <div className="section-t">Service and documents</div>
        <div className="card">
          <div className="rows">
            {att.length ? att.map((a, i) => (
              <div className="row" key={i}>
                <span className={`att-ic ${levelTone(a.level)}`}><Icon name={attIcon(a.what)} /></span>
                <div className="grow"><div className="name">{a.what}</div><div className="sub">{a.subject || ""}</div></div>
                <span className={`due ${levelTone(a.level)}`}>{a.due || ""}</span>
              </div>
            )) : <Empty>No service or document reminders in the next 14 days. Add dates on each vehicle to get reminders.</Empty>}
          </div>
        </div>
      </div>
    </section>
  );
}
