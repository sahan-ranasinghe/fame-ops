// Overview. Hotfix 3 (L1): action first, by what the person may do (overview/overviewLogic.ts: overviewSections):
// an approver sees Requests to approve, Needs a driver, Critical issues, the tiles, On the road and Needs attention; a
// dispatcher the same without the requests; a requester My trips and the tiles; a viewer the tiles and On the road.
// Every section shows at most 5 rows (3 on a phone) and "View all (N)" to its page; its title collapses it (the count
// stays), and the collapsed sections are remembered per person (app/prefs.ts). L2: Needs attention is the server's
// groups (one row per kind, expanding in place), Critical issues the critical ones; each row has Snooze and Dismiss.
// Phase 7 (§16): each tile opens its list: on a desktop a panel beside the Overview (/?open=road …, with an X and Esc; a
// reload or a shared link opens it again); on a phone, and in a shared link opened on one, the full page
// (/live?filter=road, /vehicles?filter=free …), Back returning here. A tile the person has no list for stays a number.
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { homeAction, ISSUES_NEED } from "../app/nav";
import { usePrefs } from "../app/prefs";
import { useEntry, useWatch } from "../data/hooks";
import type { MyTrips, Overview as OverviewData, RequestsList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { longDate, today } from "../lib/format";
import { can } from "../transport/types";
import { Empty, ErrBox, Loading, Notice, StaleNote, Tile, type TileLink } from "../ui/basics";
import { Icon } from "../ui/icons";
import { useIsPhone } from "../ui/phone";
import { NEEDS_DRIVER_LIST, sortNeedsDriver } from "./needsDriverLogic";
import { IssueLine, useIssueAction } from "./overview/IssueRows";
import {
  attentionOf,
  criticalOf,
  inLines,
  itemRow,
  myTripsArgs,
  type OverviewSection,
  overviewSections,
  requestsLine,
  rowsFor,
  SECTION_ROWS,
  SECTION_TITLE,
  tripRow,
  viewAll,
} from "./overview/overviewLogic";
import { NeedsDriverLine, RequestLine, TripLine } from "./overview/rows";
import { Section } from "./overview/Section";
import { canOpen, FULL_PATH, OPEN_TEXT, openFrom, type OverviewOpen, tileTarget, withParam } from "./overviewLinks";
import { OverviewPanel, RoadRows } from "./OverviewPanel";

/** The waiting queue on the Overview: the first page (the section shows 5, the count is the answer's total). */
export const REQ_WAITING_ARGS = { status: "waiting", limit: SECTION_ROWS.desktop };

export function Overview() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const ov = useEntry<OverviewData>("overview");
  const phone = useIsPhone();
  const rows = rowsFor(phone);
  const { isCollapsed, setCollapsed } = usePrefs();
  const sections = overviewSections(me);
  const approves = can(me, "approve");
  const rq = useWatch<RequestsList>("reqWaiting", "list_requests", REQ_WAITING_ARGS, 60000, approves && !noConnector);
  const wantTrips = sections.includes("my_trips") && !noConnector;
  const trips = useQuery<MyTrips>("overview.myTrips", "my_trips", wantTrips ? myTripsArgs(today(), SECTION_ROWS.desktop) : null, { every: 60000 });
  const act = useIssueAction();
  const canAct = me.tools.includes("update_issue");
  const issuesPage = can(me, ...ISSUES_NEED);
  const o = ov.data;
  const free = o ? Math.max(0, (o.vehicles.parked ?? 0) - (o.vehicles.in_garage ?? 0)) : 0;

  // The open list (§16): in the URL, so a reload or a shared link opens it again.
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = openFrom(params, me);
  // Opened by a tile here (one history entry added): closing goes back. Opened by a link or a reload: closing replaces.
  const pushed = !!(location.state as { panel?: boolean } | null)?.panel;
  const close = () => {
    if (pushed) navigate(-1);
    else setParams((p) => withParam(p, "open", null), { replace: true });
  };
  const linkOf = (k: OverviewOpen): TileLink | undefined => {
    if (!canOpen(me, k)) return undefined;
    if (phone) return { to: tileTarget(k, true) };
    // From the plain Overview a tile adds one history entry; from another open panel it replaces it.
    return { to: tileTarget(k, false), replace: !!open, state: !open || pushed ? { panel: true } : undefined, current: open === k };
  };

  // An approver's big action depends on how many requests wait: shown once the overview is in, so it never changes under the thumb.
  const big = o || !can(me, "approve") ? homeAction(me, o?.requests?.waiting ?? 0) : null;

  // A panel's link opened on a phone: the full page instead.
  if (open && phone) return <Navigate to={FULL_PATH[open]} replace />;

  const folded = (id: OverviewSection) => isCollapsed("overview_collapsed", id);
  const fold = (id: OverviewSection) => ({ collapsed: folded(id), onToggle: () => setCollapsed("overview_collapsed", id, !folded(id)) });

  /** One section, or null when it has nothing to show here (Needs a driver and Critical issues only while any). */
  const section = (id: OverviewSection, d: OverviewData): ReactNode => {
    switch (id) {
      case "requests": {
        const list = rq.data?.requests ?? [];
        const total = rq.data?.total ?? d.requests.waiting ?? list.length;
        return (
          <Section key={id} id={id} title={SECTION_TITLE.requests} count={total} tone={total ? "warn" : undefined} {...fold(id)}
            viewAll={{ to: "/requests", label: viewAll(total) }} summary={requestsLine(d.requests)}>
            {rq.err && !rq.data ? (
              <div className="card-b"><ErrBox entry={rq} onRetry={() => void store.load("reqWaiting", "list_requests", REQ_WAITING_ARGS)} /></div>
            ) : !rq.data ? <Loading>Loading requests…</Loading>
            : list.length ? <div className="rows">{list.slice(0, rows).map((q) => <RequestLine key={q.id} q={q} decide={me.tools.includes("decide_request")} />)}</div>
            : <Empty>No requests are waiting.</Empty>}
          </Section>
        );
      }
      case "needs_driver": {
        const count = d.needs_driver?.count ?? 0;
        if (!count) return null;
        const linked = can(me, "assign_tasks");
        const list = sortNeedsDriver(d.needs_driver?.tasks).slice(0, rows);
        return (
          <Section key={id} id={id} testid="needs-driver" title={SECTION_TITLE.needs_driver} count={count} tone="bad" {...fold(id)}
            viewAll={linked ? { to: NEEDS_DRIVER_LIST, label: viewAll(count) } : null}
            summary={count === 1 ? "1 task needs a driver" : `${count} tasks need a driver`}>
            <div className="rows">{list.map((t) => <NeedsDriverLine key={t.task_id} t={t} linked={linked} />)}</div>
          </Section>
        );
      }
      case "critical": {
        const c = criticalOf(d);
        if (!c.count) return null;
        return (
          <Section key={id} id={id} title={SECTION_TITLE.critical} count={c.count} tone="bad" {...fold(id)}
            viewAll={issuesPage ? { to: "/issues?severity=critical", label: viewAll(c.count) } : null}>
            <div className="rows">
              {c.items.slice(0, rows).map((a, i) => <IssueLine key={a.issue_id ?? i} row={itemRow(a, i)} canAct={canAct} onAct={act} testid="critical-row" />)}
            </div>
          </Section>
        );
      }
      case "tiles":
        return (
          <Section key={id} id={id} title={SECTION_TITLE.tiles} {...fold(id)}
            summary={`${d.vehicles.on_the_road ?? 0} of ${d.vehicles.total ?? 0} on the road · ${free} free · ${d.tasks.total ?? 0} tasks today`}>
            <div className="tiles">
              <Tile label="Vehicles on the road" value={d.vehicles.on_the_road ?? 0} unit={`of ${d.vehicles.total ?? 0}`} sub={`${d.tasks.in_progress ?? 0} task${d.tasks.in_progress === 1 ? "" : "s"} in progress`} link={linkOf("road")} />
              <Tile label="Free now" value={free} unit="vehicles" sub="not on a task, not in the garage" link={linkOf("free")} />
              <Tile label="In garage" value={d.vehicles.in_garage ?? 0} unit="vehicles" sub={d.vehicles.in_garage ? "off the road" : "none"} tone={d.vehicles.in_garage ? "warn" : ""} link={linkOf("garage")} />
              <Tile label="Tasks today" value={d.tasks.total ?? 0} unit="jobs" sub={`${d.tasks.in_progress ?? 0} in progress · ${d.tasks.done ?? 0} done`} link={linkOf("tasks")} />
              {approves && (
                <Tile label="Requests to approve" value={d.requests.waiting ?? 0} unit="open" sub={requestsLine(d.requests)} tone={d.requests.waiting ? "warn" : ""} link={linkOf("requests")} />
              )}
              {issuesPage && (
                <Tile label="Reminders due" value={d.reminders.count ?? 0} unit={`in ${d.reminders.window_days ?? 14} days`} sub={d.reminders.red ? `${d.reminders.red} need action now` : "Nothing urgent"} tone={d.reminders.red ? "bad" : ""} link={linkOf("reminders")} />
              )}
            </div>
          </Section>
        );
      case "road": {
        const road = d.on_the_road ?? [];
        return (
          <Section key={id} id={id} title={SECTION_TITLE.road} count={road.length} {...fold(id)}
            viewAll={me.tools.includes("live_drivers") ? { to: "/live", label: viewAll(road.length) } : null}>
            <div className="rows"><RoadRows rows={road.slice(0, rows)} /></div>
          </Section>
        );
      }
      case "attention": {
        const a = attentionOf(d);
        return (
          <Section key={id} id={id} title={SECTION_TITLE.attention} count={a.count} {...fold(id)}
            viewAll={issuesPage ? { to: "/issues", label: viewAll(a.count) } : null}>
            <div className="rows">
              {a.rows.length
                ? a.rows.slice(0, rows).map((r) => <IssueLine key={r.key} row={r} canAct={canAct} onAct={act} />)
                : <Empty>{can(me, "issues") ? "Nothing needs attention. Documents, services and km allowances are in order." : "No task needs attention right now."}</Empty>}
            </div>
          </Section>
        );
      }
      case "my_trips": {
        const list = trips.data?.trips ?? [];
        const total = trips.data?.total ?? trips.data?.count ?? list.length;
        return (
          <Section key={id} id={id} title={SECTION_TITLE.my_trips} count={trips.data ? total : undefined} {...fold(id)}
            viewAll={{ to: "/my-trips", label: viewAll(trips.data ? total : undefined) }}>
            {trips.err && !trips.data ? (
              <div className="card-b"><ErrBox entry={{ data: undefined, err: trips.err, loading: false }} onRetry={trips.refetch} /></div>
            ) : !trips.data ? <Loading>Loading your trips…</Loading>
            : list.length ? <div className="rows">{list.slice(0, rows).map((t) => { const r = tripRow(t); return <TripLine key={r.key} r={r} />; })}</div>
            : <Empty>No trips in the last 30 days or the next 30.{can(me, "request") && <> <Link to="/requests/new">New request</Link></>}</Empty>}
          </Section>
        );
      }
    }
  };

  const shown = o ? sections.map((id) => [id, section(id, o)] as const).filter(([, node]) => node !== null) : [];
  const nodeOf = new Map(shown);

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

      <div className={open ? "split has-detail" : "split"}>
        <div className="split-list">
          {o && (
            <div className="stack ov-stack" data-testid="overview-sections">
              <StaleNote entry={ov} />
              {inLines(shown.map(([id]) => id)).map((line) => (line.length === 2
                ? <div className="two ov-two" key={line.join("+")}>{nodeOf.get(line[0])}{nodeOf.get(line[1])}</div>
                : nodeOf.get(line[0])))}
              {!approves && can(me, "request") && !sections.includes("my_trips") && (
                <Notice tone="info">Need a vehicle? <Link to="/requests/new">New request</Link> sends it to the fleet office; you are told when it is decided.</Notice>
              )}
            </div>
          )}
        </div>
        {open && (
          <aside className="split-detail" aria-label={OPEN_TEXT[open].title} data-testid="overview-panel" data-open={open}>
            <OverviewPanel open={open} overview={o} onClose={close} />
          </aside>
        )}
      </div>
    </section>
  );
}
