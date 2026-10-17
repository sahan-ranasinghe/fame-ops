// The issues centre (issues or assign_tasks): everything that needs attention,
// on three tabs (Open / In progress / Resolved), narrowed by kind and vehicle.
// One list of everything from list_issues, watched every 60 s; on the web the
// Realtime channel on issues reloads it at once. The item page does the work.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import type { IssuesList } from "../data/types";
import { attIcon } from "../lib/format";
import { Chips, Empty, ErrBox, Loading, Pill, Plate, StaleNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { filterIssues, filterOptions, type IssueTab, kindText, severityTone, statusTone, tabCounts, TABS } from "./issuesLogic";

export const ISSUES_ARGS = { status: "all", limit: 200 };

export default function Issues() {
  const { store, noConnector, managePermissions, realtime } = useFleet();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "open") as IssueTab;
  const [kind, setKind] = useState("");
  const [vehicle, setVehicle] = useState("");
  const entry = useWatch<IssuesList>("issuesAll", "list_issues", ISSUES_ARGS, 60000, !noConnector);

  // Web: a change on the table reloads the list at once (a sync touches many rows: one reload a second at most).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    return realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load("issuesAll", "list_issues", ISSUES_ARGS);
      }, 1000);
    });
  }, [store, realtime]);

  const all = entry.data?.issues ?? [];
  const rows = filterIssues(all, { tab, kind: kind || undefined, vehicle: vehicle || undefined });
  const counts = tabCounts(all);
  const options = filterOptions(all);

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Issues</div><h1>Issues</h1></div>
        <Chips options={TABS} value={tab} onChange={(t) => setParams(t === "open" ? {} : { tab: t }, { replace: true })} counts={counts} />
      </div>
      {!entry.data && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("issuesAll", "list_issues", ISSUES_ARGS)} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading issues…</Loading>}
        </>
      )}
      {entry.data && (
        <>
          <StaleNote entry={entry} />
          <div className="filters">
            <label className="field"><span>Kind</span>
              <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All kinds</option>
                {options.kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span>Vehicle</span>
              <select aria-label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                <option value="">All vehicles</option>
                {options.vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="card" data-testid="issues-list">
            <div className="rows">
              {rows.length ? rows.map((i) => (
                <Link className="row issue-row" to={`/issues/${i.id}`} key={i.id}>
                  <span className={`att-ic ${severityTone(i.severity)}`}><Icon name={attIcon(i.title)} /></span>
                  <div className="grow">
                    <div className="name">{i.title}</div>
                    <div className="sub">{[kindText(i), i.detail, i.due].filter(Boolean).join(" · ")}</div>
                  </div>
                  {i.vehicle && <Plate v={i.vehicle} />}
                  {i.assigned_to && <span className="muted small">{i.assigned_to.name}</span>}
                  <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill>
                </Link>
              )) : <Empty>{tab === "open" ? "Nothing open. The fleet is in order." : tab === "in_progress" ? "Nothing in progress." : "Nothing resolved yet."}</Empty>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
