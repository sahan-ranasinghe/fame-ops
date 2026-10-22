// Reminders (/reminders, Phase 7 §16): what the Overview's "Reminders due" tile counts, from fleet_overview (no tool of
// its own). Round 4–7 (item 8, §33.7; Fleetio): only service and documents, ONE card per vehicle, in the server's order
// (the soonest due first, overdue at the top): the plate (to the vehicle's page), the service's bar from list_vehicles,
// and the vehicle's reminders, each row to the vehicle; then the driver licences as rows (ReminderList); everything else
// the overview lists (the km allowance, missed tasks, odometer checks, late starts…) is counted in one line that opens
// Issues, where each of them is. Without the issues permission (no vehicle reminders reach the person) the cards come
// from list_vehicles: the vehicles whose service or documents are due in the window. The same view is the Overview's
// side panel on a desktop. Hotfix 3 (L3): 25 at a time, paged on the page (the overview's list is whole).
import { useEffect } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { Attention, Overview, VehicleCard } from "../data/types";
import { attIcon, levelTone, today } from "../lib/format";
import { datesInWords, dayWords } from "../lib/when";
import { can } from "../transport/types";
import { ErrBox, Plate, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { EmptyLine, ListHeader, LoadMore, Pager, useLocalPagedList, SkeletonRows } from "../ui/ListKit";
import { PageTop } from "../ui/Page";
import { isReminderKind, type ReminderRow, reminderGroups } from "./overviewLinks";
import { careCards, docTone, docWords, isDue, serviceTone, serviceWords, type VehicleCare } from "./vehicleCareLogic";

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

/**
 * One group of reminders (Hotfix 3, L3): its count in the header, 25 at a time ("Load more" on a phone, page numbers
 * on a desktop), paged here: the rows come with the overview (fleet_overview has no paging of its own).
 */
function ReminderGroup({ title, rows, testId }: { title: string; rows: ReminderRow[]; testId: string }) {
  const list = useLocalPagedList(rows);
  return (
    <div className="card" data-testid={testId}>
      <ListHeader title={title} count={rows.length} />
      <div className="rows">{list.items.map((r) => <Row key={r.key} r={r} />)}</div>
      <LoadMore list={list} />
      <Pager list={list} />
    </div>
  );
}

/** The reminders in two groups; `issues` = the person reads every kind (else only the task kinds reach them). */
export function ReminderList({ items, issues }: { items: Attention[]; issues: boolean }) {
  const g = reminderGroups(items);
  if (!g.due.length && !g.other.length) {
    return <div className="card"><EmptyLine>{issues ? "Nothing is due. Documents, services and km allowances are in order." : "No task needs attention right now."}</EmptyLine></div>;
  }
  return (
    <div className="stack" data-testid="reminders">
      {g.due.length > 0 && <ReminderGroup title="Documents and services due" rows={g.due} testId="reminders-due" />}
      {g.other.length > 0 && <ReminderGroup title={g.due.length ? "Also needs attention" : "Needs attention"} rows={g.other} testId="reminders-other" />}
    </div>
  );
}

/** A vehicle's reminders: the plate (to its page), the service's bar when known, its reminder rows (each to the vehicle). */
function ReminderCard({ plate, care, rows }: { plate: string; care?: VehicleCare; rows: ReminderRow[] }) {
  const to = `/vehicles/${encodeURIComponent(plate)}`;
  const svc = care && (care.service.state === "overdue" || care.service.state === "due_soon") ? care.service : undefined;
  // Without the server's rows (no issues permission): the documents that are not in order, as chips.
  const chips = !rows.length && care ? care.docs.filter((d) => d.state !== "ok" && d.state !== "no_date") : [];
  return (
    <div className="card care-card" data-testid="reminder-card" data-plate={plate}>
      <div className="care-head">
        <Link to={to} className="plate-link" aria-label={`Open ${plate}`}><Plate v={plate} /></Link>
        <span className="grow sub clip">{care?.make_model ?? ""}</span>
      </div>
      {svc && (
        <div className="care-service">
          <span className="sub">Service · {serviceWords(svc, (d) => dayWords(d))}</span>
          <div className={`bar ${serviceTone(svc.state)}`} role="meter" aria-label="How near the service is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(svc.fill * 100)}><i style={{ width: `${Math.round(svc.fill * 100)}%` }} /></div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="rows">
          {rows.map((r) => (
            <Link key={r.key} className="row link-row" to={to} data-testid="reminder-row" style={{ padding: "8px 0" }}>
              <span className={`att-ic sm ${levelTone(r.level)}`}><Icon name={attIcon(r.what)} /></span>
              <span className="grow">
                <span className="name" style={{ display: "block" }}>{r.what}</span>
                {r.subject && <span className="sub" style={{ display: "block" }}>{r.subject}</span>}
              </span>
              <span className={`due ${levelTone(r.level)}`}>{datesInWords(r.due ?? "")}</span>
            </Link>
          ))}
        </div>
      )}
      {chips.length > 0 && <div className="doc-chips">{chips.map((d) => <span key={d.kind} className={`doc-chip ${docTone(d.state)}`}>{docWords(d, (x) => dayWords(x))}</span>)}</div>}
    </div>
  );
}

/**
 * The reminders as cards, one per vehicle (Round 4–7, item 8): the server's service and document reminders grouped by
 * plate in its order; the vehicles list adds the service's bar (and, without the issues permission, is the source).
 * The licences as rows; the rest counted in one line to Issues.
 */
export function ReminderCards({ items, vehicles, issues, windowDays }: { items: Attention[]; vehicles?: VehicleCard[]; issues: boolean; windowDays?: number }) {
  const mine = items.filter((a) => isReminderKind(a.kind));
  const g = reminderGroups(mine);
  const others = items.length - mine.length;
  const cards = careCards(vehicles ?? [], today());
  const careOf = new Map(cards.map((c) => [c.reg_no, c]));
  const byPlate = new Map<string, ReminderRow[]>();
  const loose: Attention[] = [];
  g.due.forEach((r, i) => {
    if (r.plate) byPlate.set(r.plate, [...(byPlate.get(r.plate) ?? []), r]);
    else loose.push(mine[i]);
  });
  // No vehicle reminders reach the person (no issues permission): the vehicles list says what is due.
  if (!issues) for (const c of cards) if (isDue(c, windowDays) && !byPlate.has(c.reg_no)) byPlate.set(c.reg_no, []);
  const plates = [...byPlate.keys()];
  const list = useLocalPagedList(plates);
  if (!plates.length && !loose.length) {
    return (
      <div className="stack" data-testid="reminders">
        <div className="card"><EmptyLine>{issues ? "Nothing is due. Documents, services and km allowances are in order." : "No task needs attention right now."}</EmptyLine></div>
        {others > 0 && <IssuesLine n={others} />}
      </div>
    );
  }
  return (
    <div className="stack" data-testid="reminders">
      {plates.length > 0 && (
        <div className="stack" data-testid="reminders-vehicles">
          <div className="card"><ListHeader title="Vehicles: service and documents due" count={plates.length} /></div>
          <div className="care-cards">{list.items.map((p) => <ReminderCard key={p} plate={p} care={careOf.get(p)} rows={byPlate.get(p) ?? []} />)}</div>
          {(list.hasMore || list.pages > 1) && <div className="card"><LoadMore list={list} /><Pager list={list} /></div>}
        </div>
      )}
      {loose.length > 0 && <ReminderList items={loose} issues={issues} />}
      {others > 0 && <IssuesLine n={others} />}
    </div>
  );
}

/** Everything else the overview lists, counted, to Issues (each of them is there). */
function IssuesLine({ n }: { n: number }) {
  return (
    <Link className="card row link-row" to="/issues" data-testid="reminders-issues">
      <span className="att-ic"><Icon name="issues" /></span>
      <span className="grow">
        <span className="name" style={{ display: "block" }}>{n === 1 ? "1 more needs attention" : `${n} more need attention`}</span>
        <span className="sub" style={{ display: "block" }}>Km allowances, missed tasks, odometer checks and the rest are in Issues</span>
      </span>
      <span className="btn small">Open Issues</span>
    </Link>
  );
}

export function Reminders() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const ov = useEntry<Overview>("overview");
  const lists = useLists(!noConnector);
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
          {!ov.err && <SkeletonRows label="Loading the reminders…" />}
        </>
      )}
      {o && (
        <div className="stack">
          <StaleNote entry={ov} />
          <ReminderCards items={o.needs_attention} vehicles={lists.vehicles as VehicleCard[] | undefined} issues={can(me, "issues")} windowDays={o.reminders.window_days} />
          {can(me, "issues", "assign_tasks") && <p className="muted small" style={{ margin: 0 }}>Every issue, with its history and who has it: <Link to="/issues">Issues</Link>.</p>}
        </div>
      )}
    </section>
  );
}
