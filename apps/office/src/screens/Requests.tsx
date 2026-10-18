// Requests (/requests): the queue for someone who approves, one's own for
// everyone else; the detail beside the list (a panel on a desktop, a full
// screen on a phone); New request at /requests/new. Phase 7 (§33): a task
// proposed by someone without approve is a card among them ("Task" and "Task
// for Kamal · WP CAB-4521 · proposed by Nimal"); a late one is marked
// "Leave-by passed" and stays in the queue.
// Hotfix 3 (L3): Waiting by default (soonest first; the others newest first),
// 25 at a time ("Load more" on a phone, page numbers on a desktop), the count
// in the header, a search box, the status and the search in the URL
// (?status=&q=), an empty line that says what the filter means. The list is the
// store's "reqs" entry, watched every minute: the request pages opened from it
// find their card there.
import { Link, useLocation, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { RequestCard, RequestsList } from "../data/types";
import { cap, requestTone } from "../lib/format";
import { can } from "../transport/types";
import { Chips, ErrBox, Loading, Pill, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, useUrlFilter, useUrlSearch, useWatchedPagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { LATE_BADGE, proposalLine, requestView } from "./approvalLogic";
import { ReviewingLine } from "./approvers";
import { timelineSteps } from "./requestLogic";
import { DEFAULT_REQUESTS_FILTER, filterTitle, REQUEST_FILTER_KEYS, REQUEST_FILTERS, requestsArgs, requestsEmptyText, REQUESTS_KEY, type RequestsFilter } from "./requestsListLogic";

export function Requests() {
  const { me, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const { search: query } = useLocation();
  const [filter, setFilter] = useUrlFilter<RequestsFilter>("status", DEFAULT_REQUESTS_FILTER, REQUEST_FILTER_KEYS);
  const [search, setSearch] = useUrlSearch();
  const list = useWatchedPagedList<RequestCard, RequestsList>(REQUESTS_KEY, "list_requests", requestsArgs(filter, search), (a) => a.requests ?? [], {
    every: 60000,
    enabled: !noConnector,
  });
  const reqs = list.entry;
  const d = list.query.data;
  const updating = list.query.updating;
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
            <Chips options={REQUEST_FILTERS} value={filter} onChange={setFilter} />
            {asks && <Link className="btn primary desktop-only" to="/requests/new">New request</Link>}
          </div>
        </div>
        {asks && staff && <Link className="btn primary home-action phone-only" to="/requests/new" style={{ marginBottom: 18 }}><Icon name="plus" />New request</Link>}
        {asks && !staff && <Link className="btn primary phone-only" to="/requests/new" style={{ marginBottom: 18 }}>New request</Link>}
        {!d && !noConnector && (
          <>
            <ErrBox entry={reqs} onRetry={list.query.refetch} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!reqs.err && <Loading>Loading requests…</Loading>}
          </>
        )}
        {d && (
          <>
            <StaleNote entry={reqs} />
            <div className="card" data-testid="requests-list" aria-busy={updating || undefined}>
              <ListHeader
                title={filterTitle(filter)}
                count={list.total}
                updating={updating}
                right={<SearchBox value={search} onChange={setSearch} placeholder="Name, project or place" />}
              />
              <div style={list.query.stale ? { opacity: 0.6 } : undefined}>
                {list.items.length ? (
                  <div className="tbl-wrap">
                    <table>
                      <thead><tr><th>Requested by</th><th>Project</th><th>When</th><th>Route</th><th>Need</th><th>Status</th><th className="r"></th></tr></thead>
                      <tbody>
                        {list.items.map((q) => (
                          <tr key={q.id} className="click" onClick={() => navigate(`/requests/${q.id}${query}`)} data-kind={q.kind} data-testid="request-row">
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
                  <EmptyLine>{list.query.stale ? "Loading…" : requestsEmptyText(filter, search, staff)}</EmptyLine>
                )}
              </div>
              <LoadMore list={list} />
              <Pager list={list} />
            </div>
          </>
        )}
      </ListWithDetail>
    </section>
  );
}
