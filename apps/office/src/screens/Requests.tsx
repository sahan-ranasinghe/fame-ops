// Requests (/requests): the queue for someone who approves, one's own for
// everyone else; the detail beside the list (a panel on a desktop, a full
// screen on a phone); New request at /requests/new. Phase 7 (§33): a task
// proposed by someone without approve is a card among them ("Task" and "Task
// for Kamal · WP CAB-4521 · proposed by Nimal"); a late one is marked
// "Leave-by passed" and stays in the queue.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import type { RequestsList } from "../data/types";
import { cap, requestTone } from "../lib/format";
import { can } from "../transport/types";
import { Chips, Empty, ErrBox, Loading, Pill, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { ListWithDetail } from "../ui/Page";
import { LATE_BADGE, proposalLine, requestView } from "./approvalLogic";
import { ReviewingLine } from "./approvers";
import { timelineSteps } from "./requestLogic";

type Filter = "waiting" | "changed" | "approved" | "declined" | "cancelled" | "all";
const FILTERS: [Filter, string][] = [["waiting", "Waiting"], ["changed", "Changed"], ["approved", "Approved"], ["declined", "Declined"], ["cancelled", "Cancelled"], ["all", "All"]];

export function Requests() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("waiting");
  const reqs = useWatch<RequestsList>("reqs", "list_requests", { status: filter }, 60000, !noConnector);
  const d = reqs.data && reqs.data.status === filter ? reqs.data : undefined;
  // The queue (everyone's requests) is the approver's; everyone else sees their own.
  const staff = !can(me, "approve");
  const decides = me.tools.includes("decide_request");
  const asks = me.tools.includes("create_request");

  return (
    <section className="view">
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">{staff ? "Vehicles you asked for" : "Vehicle requests from staff"}</div><h1>{staff ? "My requests" : "Requests"}</h1></div>
          <div className="ph-actions">
            <Chips options={FILTERS} value={filter} onChange={(k) => { store.reset("reqs"); setFilter(k); }} />
            {asks && <Link className="btn primary desktop-only" to="/requests/new">New request</Link>}
          </div>
        </div>
        {asks && staff && <Link className="btn primary home-action phone-only" to="/requests/new" style={{ marginBottom: 18 }}><Icon name="plus" />New request</Link>}
        {asks && !staff && <Link className="btn primary phone-only" to="/requests/new" style={{ marginBottom: 18 }}>New request</Link>}
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
                        <tr key={q.id} className="click" onClick={() => navigate(`/requests/${q.id}`)} data-kind={q.kind}>
                          <td data-label="Requested by">
                            {q.kind === "task"
                              ? (
                                <>
                                  <Pill tone="live">Task</Pill> <b>{q.title || "Proposed task"}</b>
                                  <div className="sub" data-testid="proposal-line">{requestView(q, me).proposal ? proposalLine(q) : `proposed by ${q.requested_by}`}</div>
                                </>
                              )
                              : <><b>{q.requested_by}</b>{q.on_behalf_of && <span className="muted"> · for {q.on_behalf_of}</span>}</>}
                            {q.asked && <div className="sub">{q.asked}</div>}
                          </td>
                          <td data-label="Project">{q.project || "—"}</td>
                          <td data-label="When">{q.when}{q.back_by && <div className="sub">back by {q.back_by}</div>}</td>
                          <td data-label="Route" className="muted">{q.route || "—"}{q.stops_count && q.stops_count > 2 ? <div className="sub">{q.stops_count} stops</div> : null}</td>
                          <td data-label="Need">{q.kind === "task" ? (q.proposed?.passengers != null ? `${q.proposed.passengers} passengers` : "—") : q.need || "—"}{q.driver_required === false && <div className="sub">no driver · custodian drives</div>}</td>
                          <td data-label="Status">
                            <Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>
                            {q.late && <> <Pill tone="bad">{LATE_BADGE}</Pill></>}
                            {(() => {
                              const last = timelineSteps(q).filter((s) => s.done).pop();
                              const words = q.one_step ? "booked directly" : last && last.label !== "Sent" ? `${last.label}${last.at ? ` · ${last.at}` : ""}` : last?.at ? `sent ${last.at}` : "";
                              return words ? <div className="sub" style={{ marginTop: 4 }}>{words}</div> : null;
                            })()}
                            {/* Hotfix 2 (K): another approver has its decide page open. */}
                            {(q.status === "waiting" || q.status === "changed") && <ReviewingLine list={q.reviewing} block />}
                          </td>
                          <td className="r">
                            {(q.status === "waiting" || q.status === "changed") && decides
                              ? <Link className="btn small dark" to={`/requests/${q.id}/decide`} onClick={(e) => e.stopPropagation()}>Review</Link>
                              : q.task_id ? <Link className="btn small" to={`/tasks/${q.task_id}`} onClick={(e) => e.stopPropagation()}>Task</Link> : null}
                          </td>
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
      </ListWithDetail>
    </section>
  );
}
