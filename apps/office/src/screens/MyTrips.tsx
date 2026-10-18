// My trips (/my-trips, Hotfix 2, A; request or assign_tasks, the tool my_trips): every request and proposed task
// the person made, newest first, over the chosen days (default this month), with a status filter (Waiting, Approved,
// Under way, Completed, Declined, Cancelled, All; All by default, so nothing disappears after a decision), both in the
// URL. Each row: when, where, the trip's live state as a pill (from its task: Driver accepted, On the way, Arrived,
// Completed), the driver and the vehicle with their photos once approved, Call and WhatsApp driver, and who decided it
// ("Approved by Palitha · 10:42", "Declined by … · reason", "Cancelled by … · reason") with their Call. A row opens
// the request page beside the list (/my-trips/:id; full screen on a phone). Refreshed every minute while the days
// reach today; an unchanged answer re-renders nothing, a changed filter keeps the old rows dimmed until the new come.
import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { MyTrips as MyTripsData, RequestCard } from "../data/types";
import { useQuery } from "../data/useQuery";
import { errText } from "../transport/errors";
import { Avatar, Chips, Empty, Loading, Notice, Pill, Plate, VehicleThumb } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { DateRange } from "../ui/DateRange";
import { colomboDay } from "../ui/dateRange";
import { Icon } from "../ui/icons";
import { ListWithDetail } from "../ui/Page";
import { decisionLines, driverPhone, emptyText, liveOf, liveTone, officePhoneOf, personPhone, TRIP_STATUS_OPTIONS, totalsLine, vehicleOf } from "./myTripsLogic";
import { TRIPS_KEY, TRIPS_PATH, useMyTripsArgs } from "./myTripsQuery";

/** A button or link inside a clickable row: it does its own thing, the row does not open. */
const Inside = ({ children }: { children: ReactNode }) => <span onClick={(e: MouseEvent) => e.stopPropagation()}>{children}</span>;

function DriverCell({ q }: { q: RequestCard }) {
  const a = q.assigned;
  if (!a) {
    const waiting = q.status === "waiting" || q.status === "changed";
    return <span className="muted">{waiting ? "Not assigned yet" : "—"}</span>;
  }
  const v = vehicleOf(a);
  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="trip-driver">
      <div className="name"><Avatar name={a.driver} src={a.photo_url} small />{a.driver}</div>
      <div className="sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <VehicleThumb src={a.vehicle_thumb_url ?? a.vehicle_photo_url} plate={v.plate} />
        {v.plate ? <Plate v={v.plate} /> : <span>{v.text}</span>}
        {a.make_model && <span>{a.make_model}</span>}
      </div>
      <Inside><ContactButtons phone={driverPhone(a)} label="Call driver" testId="call-driver" /></Inside>
    </div>
  );
}

function StatusCell({ q }: { q: RequestCard }) {
  const live = liveOf(q);
  const lines = decisionLines(q);
  // The person who approved, to call about the trip (Call office instead when they have no number).
  const approver = q.approved_by && !q.cancelled_by && !q.declined_by ? personPhone(q.approved_by) : null;
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <Pill tone={liveTone(live.state)}><span data-testid="trip-live">{live.text}</span></Pill>
      {lines.map((l) => <div key={l} className="sub" data-testid="trip-decision">{l}</div>)}
      {approver && <Inside><ContactButtons phone={approver} label="Call fleet admin" testId="call-approver" /></Inside>}
    </div>
  );
}

export function MyTrips() {
  const { me, noConnector, managePermissions } = useFleet();
  const navigate = useNavigate();
  const { search } = useLocation();
  const { dates, status, setStatus, args } = useMyTripsArgs();
  const allowed = me.tools.includes("my_trips");
  const asks = me.tools.includes("create_request");
  const today = colomboDay();
  const q = useQuery<MyTripsData>(TRIPS_KEY, "my_trips", args, {
    keep: true,
    enabled: !noConnector && allowed,
    // Days that reach today change while trips move: fetched again every minute; past days once.
    every: dates.to >= today ? 60000 : undefined,
  });
  const d = q.data;
  const trips = d?.trips ?? [];
  const office = officePhoneOf(trips);
  const updating = q.updating || q.stale;

  return (
    <section className="view" data-testid="my-trips">
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">The vehicles you asked for and the tasks you proposed</div><h1>My trips</h1></div>
          {asks && <div className="ph-actions"><Link className="btn primary desktop-only" to="/requests/new">New request</Link></div>}
        </div>
        {asks && <Link className="btn primary home-action phone-only" to="/requests/new" style={{ marginBottom: 18 }}><Icon name="plus" />New request</Link>}
        <div className="stack">
          <div className="card card-b" style={{ display: "grid", gap: 12 }}>
            <DateRange value={dates} />
            <div role="group" aria-label="Status">
              <Chips options={TRIP_STATUS_OPTIONS} value={status} onChange={setStatus} />
            </div>
          </div>

          {!allowed ? (
            <Notice tone="bad">My trips needs the my_trips tool, which your account does not have yet. Ask an admin.</Notice>
          ) : dates.error || noConnector ? null : !d ? (
            q.err ? (
              <Notice
                tone="bad"
                action={errText(q.err)[1] === "perms" && managePermissions
                  ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
                  : <button type="button" className="btn small" onClick={q.refetch}>Try again</button>}
              >
                {errText(q.err)[0]}
              </Notice>
            ) : <Loading>Loading your trips…</Loading>
          ) : q.err && q.stale ? (
            // The rows on screen are other days' or another filter's: say what went wrong instead.
            <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
          ) : (
            <div style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
              <div className="muted small" style={{ paddingBottom: 10 }} data-testid="trips-totals">
                {totalsLine(d.count ?? trips.length, d.from ?? dates.from, d.to ?? dates.to)}{updating ? <span className="updated"> · Updating…</span> : null}
              </div>
              <div className="card">
                {trips.length ? (
                  <div className="tbl-wrap">
                    <table data-testid="trips-table">
                      <thead><tr><th>When</th><th>Trip</th><th>Status</th><th>Driver and vehicle</th></tr></thead>
                      <tbody>
                        {trips.map((t) => (
                          <tr key={t.id} className="click" onClick={() => navigate(`${TRIPS_PATH}/${t.id}${search}`)} data-testid="trip-row" data-kind={t.kind}>
                            <td data-label="When">
                              <div><span className="mono">{t.when}</span>{t.back_by && <div className="sub">back by {t.back_by}</div>}</div>
                            </td>
                            <td data-label="Trip">
                              <div>
                                {t.kind === "task" && <div className="name"><Pill tone="live">Task</Pill>{t.title || "Proposed task"}</div>}
                                <div className={t.kind === "task" ? "sub" : undefined}>
                                  <Link to={`${TRIPS_PATH}/${t.id}${search}`} onClick={(e) => e.stopPropagation()}>{t.route || "Route not given"}</Link>
                                </div>
                                {t.stops_count && t.stops_count > 2 ? <div className="sub">{t.stops_count} stops</div> : null}
                                {t.on_behalf_of && <div className="sub">for {t.on_behalf_of}</div>}
                                {t.project && <div className="sub">{t.project}</div>}
                              </div>
                            </td>
                            <td data-label="Status"><StatusCell q={t} /></td>
                            <td data-label="Driver"><DriverCell q={t} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>{q.stale ? "Loading…" : emptyText(status, asks)}</Empty>
                )}
              </div>
            </div>
          )}

          {office && (
            <div className="card card-b" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-testid="call-office-card">
              <div className="grow"><b>The fleet office</b><div className="sub">Questions about a trip</div></div>
              <ContactButtons phone={office} label="Call office" testId="call-office" />
            </div>
          )}
        </div>
      </ListWithDetail>
    </section>
  );
}
