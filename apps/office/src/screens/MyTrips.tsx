// My trips (/my-trips, Hotfix 2, A; request or assign_tasks, the tool my_trips): every request and proposed task
// the person made, newest first, over the chosen days (default this month), with a status filter (Waiting, Approved,
// Under way, Completed, Declined, Cancelled, All; All by default, so nothing disappears after a decision), both in the
// URL. Each row: when, where, the trip's live state as a pill (from its task: Driver accepted, On the way, Arrived,
// Completed), the driver and the vehicle with their photos once approved, Call and WhatsApp driver, and who decided it
// ("Approved by Palitha · 10:42", "Declined by … · reason", "Cancelled by … · reason") with their Call. A row opens
// the request page beside the list (/my-trips/:id; full screen on a phone). Refreshed every minute while the days
// reach today; an unchanged answer re-renders nothing, a changed filter keeps the old rows dimmed until the new come.
// Hotfix 3 (Hotfix 2's decision 2): All · Requests · Tasks I created (?show=, my_trips' include); a task the person
// created directly is a row with its title, when, route, live state and the driver with Call, and opens the task
// (/tasks/:id). L3: 25 at a time ("Load more" on a phone, page numbers on a desktop), the count in the header, a search
// box (?q=), an empty line that says what the filters mean.
// Round 4–7 (6): a trip the person rides in (role passenger) is tagged Passenger and opens its view only page beside the
// list (/my-trips/<task>: the time, the stops, the driver with Call / WhatsApp, the plate, where it is now).
import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { CreatedTaskCard, MyTrips as MyTripsData, RequestCard, TripLive } from "../data/types";
import { errText } from "../transport/errors";
import { Segmented, Notice, Pill, VehicleThumb } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { DriverLine } from "../ui/DriverRow";
import { firstName, vehicleChipWords } from "../ui/driverRowLogic";
import { DateRangePicker } from "../ui/DateRangePicker";
import { colomboDay } from "../ui/dateRange";
import { Icon } from "../ui/icons";
import { FilterBar } from "../ui/FilterBar";
import { pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, SkeletonRows, usePagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import {
  createdLive,
  createdTaskLink,
  decisionLines,
  driverPhone,
  emptyText,
  isCreatedTask,
  isPassengerCard,
  isRequestTrip,
  liveOf,
  liveTone, liveWord,
  officePhoneOf,
  personPhone,
  TRIP_SHOW_OPTIONS,
  TRIP_STATUS_OPTIONS,
  totalsLine,
  type TripShow,
  type TripStatus,
  vehicleOf,
} from "./myTripsLogic";
import { TripCardsContext, TRIPS_KEY, TRIPS_PATH, useMyTripsArgs } from "./myTripsQuery";
import { ExpiredBadge, RequestAgain } from "./requestParts";
import { TRIP_ACTION_TEXT, tripTaskId } from "./myTripLogic";
import { createdTagShown, tripStatusShown } from "./lists2Logic";

type Trip = RequestCard | CreatedTaskCard;

/** A button or link inside a clickable row: it does its own thing, the row does not open. */
const Inside = ({ children }: { children: ReactNode }) => <span onClick={(e: MouseEvent) => e.stopPropagation()}>{children}</span>;

/**
 * Round 4–7 (4): a trip nobody drives with the app, on the person's own account, says what it asks now (my_trips'
 * trip_action): Vehicle check before setting off, Trip finished?, or Enter the odometer for one closed without it. The
 * button opens the trip's page (/my-trips/<task>) beside the list.
 */
function TripActionButton({ t, search }: { t: Trip; search: string }) {
  const task = tripTaskId(t);
  if (!t.trip_action || !task) return null;
  return (
    <Inside>
      <Link className={`btn small${t.trip_action === "check" ? " primary" : " dark"}`} to={`${TRIPS_PATH}/${task}${search}`} data-testid="trip-action">
        {TRIP_ACTION_TEXT[t.trip_action]}
      </Link>
    </Inside>
  );
}

function DriverCell({ a, waiting }: { a: RequestCard["assigned"]; waiting: boolean }) {
  if (!a) return <span className="muted">{waiting ? "Not assigned yet" : "—"}</span>;
  const v = vehicleOf(a);
  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="trip-driver">
      {/* Round 3: the driver card with the vehicle chip; a trip with no app says "Drives themselves" or "Someone else". */}
      <DriverLine name={a.driver} photo={a.photo_url} drivenBy={a.driven_by} vehicle={vehicleChipWords(v.plate, { text: v.text })}
        extra={v.plate ? <VehicleThumb src={a.vehicle_thumb_url ?? a.vehicle_photo_url} plate={v.plate} /> : undefined} />
      {a.make_model && <span className="sub">{a.make_model}</span>}
      <Inside><ContactButtons phone={driverPhone(a)} label={a.driven_by === "other" ? `Call ${firstName(a.driver)}` : "Call driver"} testId="call-driver" /></Inside>
    </div>
  );
}

/**
 * Round 4–7 (item 8): the trip's status said once (Uber's trip list): the pill, what the live text adds ("14:20" after
 * Done, nothing after Waiting), and the decision with the pill's verb beside it ("by Palitha · 10:42" after Approved; the
 * verb is read to the screen reader). "Approved" was up to three times.
 */
function TripStatus({ live, decisions, badge }: { live: TripLive; decisions: string[]; badge: ReactNode }) {
  const word = live.state === "expired" ? "Expired" : liveWord(live.state);
  const s = tripStatusShown(word, live, decisions);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} data-testid="trip-live">
        {badge}
        {s.merged.map((d) => <span key={d.text} className="sub" data-testid="trip-decision"><span className="sr-only">{d.verb}</span>{d.text}</span>)}
        {s.rest && <span className="sub" data-testid="trip-live-rest">{s.rest}</span>}
      </div>
      {s.lines.map((l) => <div key={l} className="sub" data-testid="trip-decision">{l}</div>)}
    </>
  );
}

function StatusCell({ q, search }: { q: RequestCard; search: string }) {
  const live = liveOf(q);
  const lines = decisionLines(q);
  // The person who approved, to call about the trip (Call office instead when they have no number).
  const approver = q.approved_by && !q.cancelled_by && !q.declined_by ? personPhone(q.approved_by) : null;
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <TripStatus live={live} decisions={lines} badge={live.state === "expired" ? <ExpiredBadge /> : <Pill tone={liveTone(live.state)}>{liveWord(live.state)}</Pill>} />
      {approver && <Inside><ContactButtons phone={approver} label="Call fleet admin" testId="call-approver" /></Inside>}
      {/* Round 3 (A6): an expired request is asked again from its row (everything copied but the day). */}
      <Inside><RequestAgain q={q} className="btn small" /></Inside>
      <TripActionButton t={q} search={search} />
    </div>
  );
}

/** A request or a proposal: it opens the request page beside the list. */
function RequestRow({ t, search }: { t: RequestCard; search: string }) {
  const navigate = useNavigate();
  const to = `${TRIPS_PATH}/${t.id}${search}`;
  return (
    <tr className="click" onClick={() => navigate(to)} data-testid="trip-row" data-kind={t.kind} data-source="request">
      <td data-label="When">
        <div><span className="mono">{t.when}</span>{t.back_by && <div className="sub">back by {t.back_by}</div>}</div>
      </td>
      <td data-label="Trip">
        <div>
          {t.kind === "task" && <div className="name"><Pill tone="live">Task</Pill>{t.title || "Proposed task"}</div>}
          {t.kind === "change" && <div className="name"><Pill tone="warn">Change</Pill>{t.title || "Proposed change"}{t.change?.summary ? <span className="muted"> · {t.change.summary}</span> : null}</div>}
          <div className={t.kind === "task" || t.kind === "change" ? "sub" : undefined}>
            <Link to={to} onClick={(e) => e.stopPropagation()}>{t.route || "Route not given"}</Link>
          </div>
          {t.stops_count && t.stops_count > 2 ? <div className="sub">{t.stops_count} stops</div> : null}
          {t.on_behalf_of && <div className="sub">for {t.on_behalf_of}</div>}
          {t.project && <div className="sub">{t.project}</div>}
        </div>
      </td>
      <td data-label="Status"><StatusCell q={t} search={search} /></td>
      <td data-label="Driver"><DriverCell a={t.assigned} waiting={t.status === "waiting" || t.status === "changed"} /></td>
    </tr>
  );
}

/** A task the person created directly: its title, when, route, live state and driver; it opens the task. */
function CreatedTaskRow({ t, search, show }: { t: CreatedTaskCard; search: string; show: TripShow }) {
  const navigate = useNavigate();
  const riding = isPassengerCard(t);
  const to = createdTaskLink(t, search);
  const live = createdLive(t);
  return (
    <tr className="click" onClick={() => navigate(to)} data-testid="trip-row" data-kind="task" data-source="task" data-role={riding ? "passenger" : undefined}>
      <td data-label="When">
        <div><span className="mono">{t.when}</span>{t.back_by && <div className="sub">back by {t.back_by}</div>}</div>
      </td>
      <td data-label="Trip">
        <div>
          {/* Round 4–7 (item 8): "Task I created" only where the list mixes it with requests (not under that filter); Passenger always. */}
          <div className="name">{riding ? <Pill tone="live">Passenger</Pill> : createdTagShown(show) ? <Pill tone="">Task I created</Pill> : null}<Link to={to} onClick={(e) => e.stopPropagation()}>{t.title}</Link></div>
          {t.route && <div className="sub">{t.route}</div>}
          {t.stops_count && t.stops_count > 2 ? <div className="sub">{t.stops_count} stops</div> : null}
          {t.label && <div className="sub">{t.label}</div>}
        </div>
      </td>
      <td data-label="Status">
        <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
          <TripStatus live={live} decisions={t.approved_by ? decisionLines({ approved_by: t.approved_by }) : []} badge={<Pill tone={liveTone(live.state)}>{liveWord(live.state)}</Pill>} />
          <TripActionButton t={t} search={search} />
        </div>
      </td>
      <td data-label="Driver"><DriverCell a={t.assigned} waiting={false} /></td>
    </tr>
  );
}

export function MyTrips() {
  const { me, noConnector, managePermissions } = useFleet();
  const { search: query } = useLocation();
  const { dates, status, setStatus, show, setShow, search, setSearch, args } = useMyTripsArgs();
  const allowed = me.tools.includes("my_trips");
  const asks = me.tools.includes("create_request");
  const today = colomboDay();
  const on = !noConnector && allowed && !!args;
  const list = usePagedList<Trip, MyTripsData>(TRIPS_KEY, "my_trips", args, (a) => a.trips ?? [], {
    enabled: on,
    // Days that reach today change while trips move: fetched again every minute; past days once.
    every: dates.to >= today ? 60000 : undefined,
  });
  const q = list.query;
  const d = q.data;
  const trips = list.items;
  const requests = trips.filter(isRequestTrip);
  const office = officePhoneOf(requests);
  const updating = q.updating || q.stale;

  return (
    <TripCardsContext.Provider value={{ cards: requests, waiting: on && d === undefined && !q.err }}>
      <section className="view" data-testid="my-trips">
        <ListWithDetail>
          <div className="ph">
            <div><div className="eyebrow">The vehicles you asked for and the tasks you proposed or created</div><h1>My trips</h1></div>
            {asks && <div className="ph-actions"><Link className="btn primary desktop-only" to="/requests/new">New request</Link></div>}
          </div>
          {asks && <Link className="btn primary home-action phone-only" to="/requests/new" style={{ marginBottom: 18 }}><Icon name="plus" />New request</Link>}
          <div className="stack">
            <div className="card card-b" style={{ display: "grid", gap: 12 }}>
              {/* All · Requests · Tasks I created switches the view; the status is the Filter (docs/ui-patterns.md §1, §8). */}
              <Segmented label="Show" options={TRIP_SHOW_OPTIONS} value={show} onChange={setShow} />
              <DateRangePicker value={dates} future />
              <FilterBar
                search={<SearchBox value={search} onChange={setSearch} placeholder="Place, title, driver or plate" />}
                filters={[pairsDef("status", "Status", TRIP_STATUS_OPTIONS, "all")]}
                values={{ status }}
                onChange={(v) => setStatus(((v.status as string) || "all") as TripStatus)}
              />
            </div>

            {!allowed ? (
              <Notice tone="bad">Your account can't see My trips yet. Ask an admin for the Request or Assign tasks permission.</Notice>
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
              ) : <div className="card"><SkeletonRows label="Loading your trips…" /></div>
            ) : q.err && q.stale ? (
              // The rows on screen are other days' or another filter's: say what went wrong instead.
              <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
            ) : (
              <div style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
                <div className="muted small" style={{ paddingBottom: 10 }} data-testid="trips-totals">
                  {totalsLine(list.total, d.from ?? dates.from, d.to ?? dates.to)}{updating ? <span className="updated"> · Updating…</span> : null}
                </div>
                <div className="card">
                  <ListHeader title={show === "all" ? "Trips" : show === "requests" ? "Requests" : "Tasks I created"} count={list.total} />
                  {trips.length ? (
                    <div className="tbl-wrap">
                      <table data-testid="trips-table">
                        <thead><tr><th>When</th><th>Trip</th><th>Status</th><th>Driver and vehicle</th></tr></thead>
                        <tbody>
                          {trips.map((t) => isCreatedTask(t) ? <CreatedTaskRow key={`task:${t.id}`} t={t} search={query} show={show} /> : <RequestRow key={t.id} t={t} search={query} />)}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{emptyText(status, asks, show, search)}</EmptyLine>
                  )}
                  <LoadMore list={list} />
                  <Pager list={list} />
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
    </TripCardsContext.Provider>
  );
}
