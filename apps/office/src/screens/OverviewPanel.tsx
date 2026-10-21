// Phase 7 (§16): the side panel beside the Overview on a desktop (/?open=road|free|garage|tasks|requests|reminders): the
// list a tile counts, with an X (and Esc) to close it and a link to the full page. The vehicles on the road and the
// reminders come from the overview already on screen; Free now and In garage read list_vehicles, Tasks today the day's
// board, Requests the first page of the waiting queue (Hotfix 3: 25, with how many there are). Each list keeps its
// answer on screen while it refreshes.
import { type ReactNode, useEffect } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import { statusLine, statusTone } from "../data/live";
import type { Entry } from "../data/store";
import type { Board, BoardCard, Overview, RequestsList, RoadDriver, VehiclesList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { joinDots, plateOf, today, vehicleAvailabilityTone } from "../lib/format";
import { can } from "../transport/types";
import { Avatar, Empty, ErrBox, IconLink, Pill, Plate, VehicleThumb } from "../ui/basics";
import { Icon } from "../ui/icons";
import { PAGE_SIZE, SkeletonRows } from "../ui/ListKit";
import { LATE_BADGE } from "./approvalLogic";
import { requestsLine } from "./overview/overviewLogic";
import { FULL_PATH, OPEN_TEXT, type OverviewOpen, VEHICLE_FILTER_WORDS } from "./overviewLinks";
import { ReminderList } from "./Reminders";
import { TripTags } from "./TripPurpose";
import { vehiclePath } from "./Vehicles";
import { dayWords } from "../lib/when";

/** The drivers on the road now: the Overview's card and the panel. */
export function RoadRows({ rows }: { rows: RoadDriver[] }) {
  const { me } = useFleet();
  const routes = can(me, ...ROUTES_NEED);
  if (!rows.length) return <Empty>No vehicle is on the road right now.</Empty>;
  return (
    <>
      {rows.map((d, i) => (
        <div className="row" key={d.username ?? i} data-testid="road-row">
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
      ))}
    </>
  );
}

/** A query's first load or its error (with Try again); nothing once an answer is shown. */
function QueryState<T>({ q, what }: { q: { data: T | undefined; err?: Entry["err"]; loading: boolean; refetch: () => void }; what: string }) {
  if (q.data !== undefined) return null;
  if (q.err) return <div className="card-b"><ErrBox entry={{ data: undefined, err: q.err, loading: false }} onRetry={q.refetch} /></div>;
  return <SkeletonRows label={`Loading ${what}…`} />;
}

/** Free now (available) and In garage: the vehicles, each to its page on the board with the same filter. */
function VehicleRows({ filter }: { filter: "available" | "in_garage" }) {
  const q = useQuery<VehiclesList>("overview.vehicles", "list_vehicles", { filter }, { every: 60000 });
  const list = q.data?.vehicles ?? [];
  const word = VEHICLE_FILTER_WORDS[filter];
  return (
    <>
      <QueryState q={q} what="vehicles" />
      {q.data && (list.length ? (
        <div className="rows">
          {list.map((v) => (
            <Link key={v.reg_no} className="row link-row" to={`${vehiclePath(v.reg_no)}${word ? `?filter=${word}` : ""}`} data-testid="panel-row">
              <VehicleThumb src={v.thumb_url} />
              <span className="grow">
                <span className="name"><span className="plate">{v.reg_no}</span>{v.make_model && <span>{v.make_model}</span>}</span>
                <span className="sub" style={{ display: "block" }}>
                  {joinDots([v.seats ? `${v.seats} seats` : null, v.assigned_to ? `assigned to ${v.assigned_to}` : "pool", filter === "in_garage" && v.garage_booked ? `garage ${dayWords(v.garage_booked, { inline: true })}` : null])}
                </span>
              </span>
              {v.availability && <span className={`sub status ${vehicleAvailabilityTone(v.availability)}`}>{v.availability}</span>}
            </Link>
          ))}
        </div>
      ) : <Empty>{filter === "available" ? "No vehicle is free right now." : "No vehicle is in the garage."}</Empty>)}
    </>
  );
}

const TASK_GROUPS: [keyof Pick<Board, "in_progress" | "assigned" | "declined" | "completed">, string][] = [
  ["in_progress", "In progress"],
  ["assigned", "Assigned"],
  ["declined", "Needs a driver"],
  ["completed", "Completed"],
];

function TaskRow({ t }: { t: BoardCard }) {
  return (
    <Link className="row link-row" to={`/tasks/${t.id}`} data-testid="panel-row">
      <span className="mono" style={{ fontWeight: 700 }}>{t.time}</span>
      <span className="grow">
        <span className="name">{t.title}<TripTags t={t} /></span>
        <span className="sub" style={{ display: "block" }}>{joinDots([t.driver, plateOf(t.vehicle), t.status])}</span>
      </span>
    </Link>
  );
}

/** Tasks today: the day's board by status, each task to its page. */
function TaskRows() {
  const q = useQuery<Board>("overview.board", "task_board", { date: today() }, { every: 30000 });
  const b = q.data;
  const any = b ? TASK_GROUPS.some(([k]) => (b[k] ?? []).length > 0) : false;
  return (
    <>
      <QueryState q={q} what="today's tasks" />
      {b && (any ? (
        <div>
          {TASK_GROUPS.map(([k, label]) => (b[k]?.length ? (
            <div key={k}>
              <div className="panel-group">{label} · {b[k]!.length}</div>
              <div className="rows">{b[k]!.map((t) => <TaskRow key={t.id} t={t} />)}</div>
            </div>
          ) : null))}
          {b.waiting_approval?.length ? <p className="muted small" style={{ margin: "10px 22px" }}>{b.waiting_approval.length} proposed for today wait for an approver.</p> : null}
        </div>
      ) : <Empty>No tasks today.</Empty>)}
    </>
  );
}

/** Requests to approve: the first page of the waiting queue (Hotfix 3: 25), each to its request; the rest on Requests. */
function RequestRows() {
  const rq = useQuery<RequestsList>("overview.requests", "list_requests", { status: "waiting", limit: PAGE_SIZE }, { every: 60000 });
  const list = rq.data?.requests ?? [];
  if (!rq.data) {
    return rq.err
      ? <div className="card-b"><ErrBox entry={{ data: undefined, err: rq.err, loading: false }} onRetry={rq.refetch} /></div>
      : <SkeletonRows label="Loading requests…" />;
  }
  if (!list.length) return <Empty>No requests are waiting.</Empty>;
  const total = rq.data.total ?? list.length;
  return (
    <div className="rows">
      {total > list.length && <p className="muted small" style={{ margin: "10px 22px" }} data-testid="panel-more">Showing {list.length} of {total}: the rest are on Requests.</p>}
      {list.slice(0, PAGE_SIZE).map((q) => (
        <Link key={q.id} className="row link-row" to={`/requests/${q.id}`} data-testid="panel-row">
          <span className="grow">
            <span className="name">
              {q.kind === "task" ? <><Pill tone="live">Task</Pill> {q.title || "Proposed task"}</> : q.requested_by}
              {q.late && <Pill tone="bad">{LATE_BADGE}</Pill>}
            </span>
            <span className="sub" style={{ display: "block" }}>{joinDots([q.when, q.route, q.need])}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function OverviewPanel({ open, overview, onClose }: { open: OverviewOpen; overview: Overview | undefined; onClose: () => void }) {
  const { me } = useFleet();
  // Esc closes the panel (not while typing in a field), like a detail panel beside a list.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const o = overview;
  const text = OPEN_TEXT[open];
  let eyebrow = "";
  let body: ReactNode;
  switch (open) {
    case "road":
      eyebrow = o ? `${o.vehicles.on_the_road ?? 0} of ${o.vehicles.total ?? 0} vehicles · now` : "Now";
      body = o ? <div className="rows"><RoadRows rows={o.on_the_road} /></div> : <SkeletonRows label="Loading the fleet…" />;
      break;
    case "free":
      eyebrow = "Not on a task, not in the garage";
      body = <VehicleRows filter="available" />;
      break;
    case "garage":
      eyebrow = "Off the road";
      body = <VehicleRows filter="in_garage" />;
      break;
    case "tasks":
      eyebrow = o ? `${o.tasks.in_progress ?? 0} in progress · ${o.tasks.done ?? 0} done` : "Today";
      body = <TaskRows />;
      break;
    case "requests":
      eyebrow = o ? requestsLine(o.requests) : "Waiting for a decision";
      body = <RequestRows />;
      break;
    case "reminders":
      eyebrow = `Due in the next ${o?.reminders.window_days ?? 14} days`;
      body = o ? <ReminderList items={o.needs_attention} issues={can(me, "issues")} /> : <SkeletonRows label="Loading the reminders…" />;
      break;
  }
  return (
    <>
      <div className="panel-top">
        <div className="grow">
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="page-title">{text.title}</h2>
        </div>
        <button type="button" className="btn icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {open === "reminders" ? body : <div className="card">{body}</div>}
      <div><Link className="btn" to={FULL_PATH[open]}>Open {text.page}</Link></div>
    </>
  );
}
