import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry, useWatch } from "../data/hooks";
import type { Overview as OverviewData, RequestsList } from "../data/types";
import { statusLine, statusTone } from "../data/live";
import { attIcon, joinDots, levelTone, longDate, today } from "../lib/format";
import { Avatar, Empty, ErrBox, IconLink, Loading, Notice, Pill, Plate, StaleNote, Tile } from "../ui/basics";
import { useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { NewRequestDrawer } from "./NewRequestDrawer";
import { RequestDrawer } from "./RequestDrawer";

export function Overview() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const drawer = useDrawer();
  const navigate = useNavigate();
  const ov = useEntry<OverviewData>("overview");
  const canRequests = me.tools.includes("list_requests");
  const rq = useWatch<RequestsList>("reqWaiting", "list_requests", { status: "waiting" }, 60000, canRequests && !noConnector);
  const o = ov.data;

  const openRequest = (id: string, mode?: "decline") => drawer.open(<RequestDrawer id={id} mode={mode} />);

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">{longDate(today())}</div><h1>Overview</h1></div>
        <div className="ph-actions">
          {me.tools.includes("create_request") && (
            <button type="button" className="btn" onClick={() => drawer.open(<NewRequestDrawer />)}>New request</button>
          )}
          {me.tools.includes("create_task") && (
            <button type="button" className="btn primary" onClick={() => navigate("/tasks", { state: { focus: "title" } })}>
              <Icon name="plus" />Assign task
            </button>
          )}
        </div>
      </div>

      {!o && !noConnector && (
        <>
          <ErrBox entry={ov} onRetry={() => void store.load("overview", "fleet_overview", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!ov.err && <Loading>Loading the fleet…</Loading>}
        </>
      )}

      {o && (
        <div className="stack">
          <StaleNote entry={ov} />
          <div className="tiles">
            <Tile label="Vehicles on the road" value={o.vehicles.on_the_road ?? 0} unit={`of ${o.vehicles.total ?? 0}`} sub={`${o.vehicles.parked ?? 0} parked${o.vehicles.in_garage ? ` · ${o.vehicles.in_garage} in garage` : ""}`} />
            <Tile label="Tasks today" value={o.tasks.total ?? 0} unit="jobs" sub={`${o.tasks.in_progress ?? 0} in progress · ${o.tasks.done ?? 0} done`} />
            <Tile label="Requests to approve" value={o.requests.waiting ?? 0} unit="open" sub={o.requests.oldest ? `Oldest waiting ${o.requests.oldest}` : "Nothing waiting"} tone={o.requests.waiting ? "warn" : ""} />
            <Tile label="Reminders due" value={o.reminders.count ?? 0} unit={`in ${o.reminders.window_days ?? 14} days`} sub={o.reminders.red ? `${o.reminders.red} need action now` : "Nothing urgent"} tone={o.reminders.red ? "bad" : ""} />
          </div>

          <div className="two">
            <div className="card">
              <div className="card-h"><h2>On the road</h2>{me.tools.includes("live_drivers") && <Link to="/live">All live locations</Link>}</div>
              <div className="rows">
                {o.on_the_road.length ? o.on_the_road.map((d, i) => (
                  <div className="row" key={d.username ?? i}>
                    <Avatar name={d.driver} />
                    <div className="grow">
                      <div className="name">{d.driver} <Plate v={d.vehicle} /></div>
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
            <div className="card">
              <div className="card-h"><h2>Needs attention</h2><span className="muted">Next {o.reminders.window_days ?? 14} days</span></div>
              <div className="rows">
                {o.needs_attention.length ? o.needs_attention.map((a, i) => (
                  <div className="row" key={i}>
                    <span className={`att-ic ${levelTone(a.level)}`}><Icon name={attIcon(a.what)} /></span>
                    <div className="grow"><div className="name">{a.what}</div><div className="sub">{a.subject || ""}</div></div>
                    <span className={`due ${levelTone(a.level)}`}>{a.due || ""}</span>
                  </div>
                )) : <Empty>Nothing needs attention. Documents, services and km allowances are in order.</Empty>}
              </div>
            </div>
          </div>

          {canRequests && (
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
                          <td><b>{q.requested_by}</b></td><td>{q.project || "—"}</td><td>{q.when}</td><td className="muted">{q.route || "—"}</td><td>{q.need || "—"}</td>
                          <td className="r">
                            <div className="acts" style={{ justifyContent: "flex-end" }}>
                              {me.tools.includes("decide_request") && <button type="button" className="btn small" onClick={() => openRequest(q.id, "decline")}>Decline</button>}
                              <button type="button" className="btn small dark" onClick={() => openRequest(q.id)}>{me.tools.includes("decide_request") ? "Approve & assign" : "Open"}</button>
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
          {!canRequests && <Notice tone="info">Requests are handled by the fleet office. <Link to="/tasks">See today’s tasks</Link>.</Notice>}
        </div>
      )}
    </section>
  );
}
