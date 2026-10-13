import { useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import type { RequestsList } from "../data/types";
import { cap, requestTone } from "../lib/format";
import { can } from "../transport/types";
import { Chips, Empty, ErrBox, Loading, Pill, StaleNote } from "../ui/basics";
import { useDrawer } from "../ui/Drawer";
import { NewRequestDrawer } from "./NewRequestDrawer";
import { RequestDrawer } from "./RequestDrawer";

type Filter = "waiting" | "approved" | "declined" | "all";
const FILTERS: [Filter, string][] = [["waiting", "Waiting"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];

export function Requests() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const [filter, setFilter] = useState<Filter>("waiting");
  const reqs = useWatch<RequestsList>("reqs", "list_requests", { status: filter }, 60000, !noConnector);
  const d = reqs.data && reqs.data.status === filter ? reqs.data : undefined;
  // Without the view permission the list holds only this person's own requests.
  const staff = !can(me, "view");
  const decides = me.tools.includes("decide_request");

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">{staff ? "Vehicles you asked for" : "Vehicle requests from staff"}</div><h1>{staff ? "My requests" : "Requests"}</h1></div>
        <div className="ph-actions">
          <Chips options={FILTERS} value={filter} onChange={(k) => { store.reset("reqs"); setFilter(k); }} />
          {me.tools.includes("create_request") && <button type="button" className="btn primary" onClick={() => drawer.open(<NewRequestDrawer />)}>New request</button>}
        </div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={reqs} onRetry={() => void store.load("reqs", "list_requests", { status: filter })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!reqs.err && <Loading>Loading requests…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={reqs} />
          <div className="card">
            {d.requests.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Requested by</th><th>Project</th><th>When</th><th>Route</th><th>Need</th><th>Status</th><th className="r"></th></tr></thead>
                  <tbody>
                    {d.requests.map((q) => (
                      <tr key={q.id} className="click" onClick={() => drawer.open(<RequestDrawer id={q.id} />)}>
                        <td><b>{q.requested_by}</b>{q.asked && <div className="sub">{q.asked}</div>}</td>
                        <td>{q.project || "—"}</td>
                        <td>{q.when}{q.back_by && <div className="sub">back by {q.back_by}</div>}</td>
                        <td className="muted">{q.route || "—"}</td>
                        <td>{q.need || "—"}</td>
                        <td><Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill></td>
                        <td className="r">{q.status === "waiting" && decides ? <span className="btn small dark">Review</span> : q.task_id ? <span className="btn small">Task</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{filter === "waiting" ? (staff ? "You have no request waiting. Add one with New request." : "No requests are waiting. Add one with New request when someone asks for a vehicle.") : "No requests here."}</Empty>
            )}
          </div>
        </>
      )}
    </section>
  );
}
