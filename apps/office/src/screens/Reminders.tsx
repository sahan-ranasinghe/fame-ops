// Reminders (/reminders, Phase 7 §16): what the Overview's "Reminders due" tile counts, from fleet_overview (no tool of
// its own). First the documents and services due (and the rental ends, garage bookings, km allowances and driver
// licences): what, the vehicle and the date, each row to the vehicle's page; then everything else the tile counts, each
// row to its issue. The server's order: the soonest due first, overdue at the top. The same list is the Overview's
// side panel on a desktop.
import { useEffect } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Attention, Overview } from "../data/types";
import { attIcon, levelTone } from "../lib/format";
import { can } from "../transport/types";
import { Empty, ErrBox, Loading, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { PageTop } from "../ui/Page";
import { type ReminderRow, reminderGroups } from "./overviewLinks";

function Row({ r }: { r: ReminderRow }) {
  const inner = (
    <>
      <span className={`att-ic ${levelTone(r.level)}`}><Icon name={attIcon(r.what)} /></span>
      <span className="grow">
        <span className="name" style={{ display: "block" }}>{r.what}</span>
        <span className="sub" style={{ display: "block" }}>
          {r.plate && <span className="plate">{r.plate}</span>}
          {r.plate && r.subject ? " " : null}
          {r.subject}
        </span>
      </span>
      <span className={`due ${levelTone(r.level)}`}>{r.due || ""}</span>
    </>
  );
  return r.to
    ? <Link className="row link-row" to={r.to} data-testid="reminder-row">{inner}</Link>
    : <div className="row" data-testid="reminder-row">{inner}</div>;
}

/** The reminders in two groups; `issues` = the person reads every kind (else only the task kinds reach them). */
export function ReminderList({ items, issues }: { items: Attention[]; issues: boolean }) {
  const g = reminderGroups(items);
  if (!g.due.length && !g.other.length) {
    return <div className="card"><Empty>{issues ? "Nothing is due. Documents, services and km allowances are in order." : "No task needs attention right now."}</Empty></div>;
  }
  return (
    <div className="stack" data-testid="reminders">
      {g.due.length > 0 && (
        <div className="card">
          <div className="card-h"><h2>Documents and services due</h2><span className="muted">{g.due.length}</span></div>
          <div className="rows">{g.due.map((r) => <Row key={r.key} r={r} />)}</div>
        </div>
      )}
      {g.other.length > 0 && (
        <div className="card">
          <div className="card-h"><h2>{g.due.length ? "Also needs attention" : "Needs attention"}</h2><span className="muted">{g.other.length}</span></div>
          <div className="rows">{g.other.map((r) => <Row key={r.key} r={r} />)}</div>
        </div>
      )}
    </div>
  );
}

export function Reminders() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const ov = useEntry<Overview>("overview");
  // The shell watches the overview for everyone with view; anyone else gets it once here.
  useEffect(() => {
    if (noConnector || store.isWatching("overview")) return;
    void store.load("overview", "fleet_overview", {});
  }, [store, noConnector]);
  const o = ov.data;
  return (
    <section className="view" data-testid="reminders-page">
      <PageTop title="Reminders" sub={`Due in the next ${o?.reminders.window_days ?? 14} days`} backTo="/" />
      {!o && !noConnector && (
        <>
          <ErrBox entry={ov} onRetry={() => void store.load("overview", "fleet_overview", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!ov.err && <Loading>Loading the reminders…</Loading>}
        </>
      )}
      {o && (
        <div className="stack">
          <StaleNote entry={ov} />
          <ReminderList items={o.needs_attention} issues={can(me, "issues")} />
          {can(me, "issues", "assign_tasks") && <p className="muted small" style={{ margin: 0 }}>Every issue, with its history and who has it: <Link to="/issues">Issues</Link>.</p>}
        </div>
      )}
    </section>
  );
}
