// The issues centre (issues or assign_tasks; Phase 7 §9): everything that
// needs attention, opened in the chosen days (the date-range control on
// opened_at, default this month), one status at a time (Open / In progress /
// Resolved / Dismissed / All), narrowed by kind and vehicle, newest first. An
// issue opens beside the list on a desktop (/issues/:id, a panel with an X;
// Esc closes it) and as a full page with Back on a phone. Every filter is in
// the URL, so the panel, a reload and Back keep them. The list is watched every
// 60 s; on the web the Realtime channel on issues reloads it within a second.
// A change made in the panel patches the row in place (issuesLogic.patchIssues).
import { useEffect, useRef } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useWatch } from "../data/hooks";
import type { IssuesList } from "../data/types";
import { addDays, attIcon } from "../lib/format";
import { errText } from "../transport/errors";
import { Empty, ErrBox, Loading, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { DateRange, useDateRange } from "../ui/DateRange";
import { colomboDay } from "../ui/dateRange";
import { Icon } from "../ui/icons";
import { ListWithDetail } from "../ui/Page";
import { answerFor, DEFAULT_STATUS, emptyText, filterOptions, ISSUES_KEY, issuesArgs, type IssueStatusFilter, kindText, limitNote, listRows, outsideNote, readStatus, severityTone, STATUS_FILTERS, statusTone, whoLine } from "./issuesLogic";

/** list_issues takes at most 366 days. */
const MAX_DAYS = 366;

/** The status filter as tabs (the old page's three tabs, now five). */
function StatusTabs({ value, onChange }: { value: IssueStatusFilter; onChange: (s: IssueStatusFilter) => void }) {
  return (
    <div className="chips" role="tablist" aria-label="Status">
      {STATUS_FILTERS.map(([k, label]) => (
        <button key={k} type="button" role="tab" className="chip" aria-selected={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export default function Issues() {
  const { store, noConnector, managePermissions, realtime } = useFleet();
  const { id } = useParams();
  const { search } = useLocation();
  const dates = useDateRange("month", { maxDays: MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const status = readStatus(params);
  const kind = params.get("kind") || "";
  const vehicle = params.get("vehicle") || "";
  const set = (key: string, value: string, def = "") => setParams((p) => {
    const next = new URLSearchParams(p);
    next.delete("tab"); // the old links' tab= gives way to status=
    if (value && value !== def) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });

  const { from, to } = dates;
  const args = issuesArgs(status, from, to);
  const argsRef = useRef(args);
  argsRef.current = args;
  const entry = useWatch<IssuesList>(ISSUES_KEY, "list_issues", args, 60000, !noConnector && !dates.error);

  // Web: a change on the table reloads the list at once (a sync touches many rows: one reload a second at most).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    const stop = realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load(ISSUES_KEY, "list_issues", argsRef.current);
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [store, realtime]);

  const d = entry.data;
  const current = !!d && answerFor(d, { status, from, to });
  const updating = !!d && !current && !entry.err && !dates.error;
  const retry = () => void store.load(ISSUES_KEY, "list_issues", args);
  const rows = d ? listRows(d.issues, { status, kind: kind || undefined, vehicle: vehicle || undefined }) : [];
  const options = filterOptions(d?.issues ?? [], { kind: kind || undefined, vehicle: vehicle || undefined });
  const outside = d && current ? outsideNote(d, status) : undefined;
  const cut = d && current ? limitNote(d) : undefined;
  const today = colomboDay();

  return (
    <section className="view">
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">Everything that needs attention</div><h1>Issues</h1></div>
        </div>
        <div className="card card-b" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          <DateRange value={dates} label="Opened" />
          <StatusTabs value={status} onChange={(s) => set("status", s, DEFAULT_STATUS)} />
          <div className="filters" style={{ marginBottom: 0 }}>
            <label className="field"><span>Kind</span>
              <select aria-label="Kind" value={kind} onChange={(e) => set("kind", e.target.value)}>
                <option value="">All kinds</option>
                {options.kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span>Vehicle</span>
              <select aria-label="Vehicle" value={vehicle} onChange={(e) => set("vehicle", e.target.value)}>
                <option value="">All vehicles</option>
                {options.vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          </div>
        </div>

        {dates.error ? null : !d && !noConnector ? (
          <>
            <ErrBox entry={entry} onRetry={retry} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!entry.err && <Loading>Loading issues…</Loading>}
          </>
        ) : d && !current && entry.err ? (
          // The rows on screen are another filter's: say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={retry}>Try again</button>}>{errText(entry.err)[0]}</Notice>
        ) : d ? (
          <div style={updating ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
            {updating ? <div className="updated" style={{ paddingBottom: 10 }}>Updating…</div> : <StaleNote entry={entry} />}
            {outside && (
              <div style={{ marginBottom: 12 }}>
                <Notice tone="info" action={<button type="button" className="btn small" onClick={() => dates.setCustom(addDays(today, -365), today)}>Show the last 12 months</button>}>{outside}</Notice>
              </div>
            )}
            {cut && <div style={{ marginBottom: 12 }}><Notice tone="info">{cut}</Notice></div>}
            <div className="card" data-testid="issues-list">
              <div className="rows">
                {rows.length ? rows.map((i) => (
                  <Link className="row issue-row" to={`/issues/${i.id}${search}`} key={i.id} state={{ fromList: true }} replace={!!id} aria-current={i.id === id ? "true" : undefined} style={i.id === id ? { background: "var(--surface-2)" } : undefined}>
                    <span className={`att-ic ${severityTone(i.severity)}`}><Icon name={attIcon(i.title)} /></span>
                    <div className="grow">
                      <div className="name">{i.title}</div>
                      <div className="sub">{[kindText(i), i.detail, i.due].filter(Boolean).join(" · ")}</div>
                      <div className="sub">{whoLine(i)}</div>
                    </div>
                    {i.vehicle && <Plate v={i.vehicle} />}
                    <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill>
                  </Link>
                )) : updating ? <Empty>Loading…</Empty> : <Empty>{emptyText(status, from, to, !!(kind || vehicle))}</Empty>}
              </div>
            </div>
          </div>
        ) : null}
      </ListWithDetail>
    </section>
  );
}
