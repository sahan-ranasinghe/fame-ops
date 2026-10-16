// Overview. Everyone with view: the counts (on the road, free, in garage,
// tasks today) and who is on the road. The requests queue belongs to approve,
// the needs-attention list to issues (everything) and assign_tasks (the task
// items; the server already filters), the driver links to assign_tasks or
// vehicles. Phase 7 (§19): the red "Needs a driver" block first, for approve or
// assign_tasks, while any task needs a driver.
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { homeAction, ROUTES_NEED } from "../app/nav";
import { useEntry, useWatch } from "../data/hooks";
import type { Overview as OverviewData, RequestsList } from "../data/types";
import { statusLine, statusTone } from "../data/live";
import { attIcon, joinDots, levelTone, longDate, today } from "../lib/format";
import { can } from "../transport/types";
import { Avatar, Empty, ErrBox, IconLink, Loading, Notice, Pill, Plate, StaleNote, Tile } from "../ui/basics";
import { Icon } from "../ui/icons";
import { NeedsDriverList } from "./NeedsDriverList";

export function Overview() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const ov = useEntry<OverviewData>("overview");
  const approves = can(me, "approve");
  const attention = can(me, "issues", "assign_tasks");
  const routes = can(me, ...ROUTES_NEED);
  const dispatch = can(me, "approve", "assign_tasks");
  const rq = useWatch<RequestsList>("reqWaiting", "list_requests", { status: "waiting" }, 60000, approves && !noConnector);
  const o = ov.data;
  const free = o ? Math.max(0, (o.vehicles.parked ?? 0) - (o.vehicles.in_garage ?? 0)) : 0;

  // An approver's big action depends on how many requests wait: shown once the overview is in, so it never changes under the thumb.
  const big = o || !can(me, "approve") ? homeAction(me, o?.requests?.waiting ?? 0) : null;

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">{longDate(today())}</div><h1>Overview</h1></div>
        <div className="ph-actions">
          {me.tools.includes("create_request") && (
            <Link className="btn desktop-only" to="/requests/new">New request</Link>
          )}
          {me.tools.includes("create_task") && (
            <Link className="btn primary desktop-only" to="/tasks/new"><Icon name="plus" />Assign task</Link>
          )}
        </div>
      </div>
      {big && <Link className="btn primary home-action phone-only" to={big.path} data-testid="home-action" style={{ marginBottom: 18 }}>{big.label}</Link>}

      {!o && !noConnector && (
        <>
          <ErrBox entry={ov} onRetry={() => void store.load("overview", "fleet_overview", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!ov.err && <Loading>Loading the fleet…</Loading>}
        </>
      )}

      {o && (
        <div className="stack">
          <StaleNote entry={ov} />
          {dispatch && (o.needs_driver?.count ?? 0) > 0 && <NeedsDriverList tasks={o.needs_driver?.tasks ?? []} linked={can(me, "assign_tasks")} />}
          <div className="tiles">
            <Tile label="Vehicles on the road" value={o.vehicles.on_the_road ?? 0} unit={`of ${o.vehicles.total ?? 0}`} sub={`${o.tasks.in_progress ?? 0} task${o.tasks.in_progress === 1 ? "" : "s"} in progress`} />
            <Tile label="Free now" value={free} unit="vehicles" sub="not on a task, not in the garage" />
            <Tile label="In garage" value={o.vehicles.in_garage ?? 0} unit="vehicles" sub={o.vehicles.in_garage ? "off the road" : "none"} tone={o.vehicles.in_garage ? "warn" : ""} />
            <Tile label="Tasks today" value={o.tasks.total ?? 0} unit="jobs" sub={`${o.tasks.in_progress ?? 0} in progress · ${o.tasks.done ?? 0} done`} />
            {approves && (
              <Tile label="Requests to approve" value={o.requests.waiting ?? 0} unit="open" sub={o.requests.oldest ? `Oldest waiting ${o.requests.oldest}` : "Nothing waiting"} tone={o.requests.waiting ? "warn" : ""} />
            )}
            {attention && (
              <Tile label="Reminders due" value={o.reminders.count ?? 0} unit={`in ${o.reminders.window_days ?? 14} days`} sub={o.reminders.red ? `${o.reminders.red} need action now` : "Nothing urgent"} tone={o.reminders.red ? "bad" : ""} />
            )}
          </div>

          <div className={attention ? "two" : ""}>
            <div className="card">
              <div className="card-h"><h2>On the road</h2>{me.tools.includes("live_drivers") && <Link to="/live">All live locations</Link>}</div>
              <div className="rows">
                {o.on_the_road.length ? o.on_the_road.map((d, i) => (
                  <div className="row" key={d.username ?? i}>
                    <Avatar name={d.driver} />
                    <div className="grow">
                      <div className="name">{d.username && routes ? <Link to={`/drivers/${d.username}`}>{d.driver}</Link> : d.driver} <Plate v={d.vehicle} /></div>
                      <div className="sub">{joinDots([d.task, d.going_to && "to " + d.going_to, d.near && "near " + d.near])}</div>
                    </div>
                    <Pill tone={statusTone(d.status, d.location?.toLowerCase().includes("not sharing") ? "not_sharing" : d.location?.toLowerCase().startsWith("live") ? "sharing" : "stale")}>{statusLine({ status_text: d.status_text, location: d.location, state: undefined })}</Pill>
                    <div className="acts">
                      <IconLink href={d.links?.maps} icon="pin" label="Open in Google Maps" />
                      <IconLink href={d.links?.whatsapp} icon="chat" label="WhatsApp" />
                      <IconLink href={d.links?.call} icon="phone" label="Call" />
                    </div>
                  </div>
                )) : <Empty>No vehicle is on the road right now.</Empty>}
              </div>
            </div>
            {attention && (
              <div className="card">
                <div className="card-h"><h2>Needs attention</h2><span className="muted">Next {o.reminders.window_days ?? 14} days</span></div>
                <div className="rows">
                  {o.needs_attention.length ? o.needs_attention.map((a, i) => (
                    <div className="row" key={i}>
                      <span className={`att-ic ${levelTone(a.level)}`}><Icon name={attIcon(a.what)} /></span>
                      <div className="grow"><div className="name">{a.issue_id ? <Link to={`/issues/${a.issue_id}`}>{a.what}</Link> : a.what}</div><div className="sub">{a.subject || ""}</div></div>
                      <span className={`due ${levelTone(a.level)}`}>{a.due || ""}</span>
                    </div>
                  )) : <Empty>{can(me, "issues") ? "Nothing needs attention. Documents, services and km allowances are in order." : "No task needs attention right now."}</Empty>}
                </div>
              </div>
            )}
          </div>

          {approves && (
            <div className="card">
              <div className="card-h"><h2>Requests awaiting approval</h2><span className="muted">{rq.data?.requests.length ?? 0} open</span></div>
              {rq.err && !rq.data ? (
                <div className="card-b"><ErrBox entry={rq} onRetry={() => void store.load("reqWaiting", "list_requests", { status: "waiting" })} /></div>
              ) : rq.data?.requests.length ? (
                <div className="tbl-wrap">
                  <table>
                    <thead><tr><th>Requested by</th><th>Project</th><th>When</th><th>Route</th><th>Need</th><th className="r">Action</th></tr></thead>
                    <tbody>
                      {rq.data.requests.map((q) => (
                        <tr key={q.id}>
                          <td data-label="Requested by"><b>{q.requested_by}</b></td><td data-label="Project">{q.project || "—"}</td><td data-label="When">{q.when}</td><td data-label="Route" className="muted">{q.route || "—"}</td><td data-label="Need">{q.need || "—"}</td>
                          <td className="r">
                            <div className="acts" style={{ justifyContent: "flex-end" }}>
                              <Link className="btn small" to={`/requests/${q.id}/decide?mode=decline`}>Decline</Link>
                              <Link className="btn small dark" to={`/requests/${q.id}/decide`}>Approve &amp; assign</Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : rq.data ? <Empty>No requests are waiting.</Empty> : <Loading>Loading requests…</Loading>}
            </div>
          )}
          {!approves && can(me, "request") && (
            <Notice tone="info">Need a vehicle? <Link to="/requests/new">New request</Link> sends it to the fleet office; you are told when it is decided.</Notice>
          )}
        </div>
      )}
    </section>
  );
}
