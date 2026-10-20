// The issues centre (issues or assign_tasks; Phase 7 §9): everything that
// needs attention, opened in the chosen days (the date-range control on
// opened_at, default this month), one status at a time (Active / Open / In
// progress / Snoozed / Resolved / Dismissed / All), narrowed by kind, vehicle,
// severity and the words searched for. An issue opens beside the list on a
// desktop (/issues/:id, a panel with an X; Esc closes it) and as a full page
// with Back on a phone. Every filter is in the URL, so the panel, a reload and
// Back keep them. The list is watched every 60 s; on the web the Realtime
// channel on issues reloads it within a second. A change made in the panel
// patches the row in place (issuesLogic.patchIssues).
// Hotfix 3 (L3): Active (open or in progress, the snoozed left out) and the
// most urgent first by default (the closed ones newest first), 25 at a time
// ("Load more" on a phone, page numbers on a desktop), the count in the
// header, a search box, the Snoozed tab with "Snoozed until …" on its rows.
import { useEffect, useRef } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { Issue, IssuesList } from "../data/types";
import { addDays, attIcon } from "../lib/format";
import { errText } from "../transport/errors";
import { ErrBox, Notice, Pill, Plate, StaleNote } from "../ui/basics";
import { DateRangePicker, useDateRange } from "../ui/DateRangePicker";
import { colomboDay } from "../ui/dateRange";
import { Icon } from "../ui/icons";
import { FilterBar } from "../ui/FilterBar";
import { type FilterDef, type FilterValues, listDef, pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, SkeletonRows, useUrlSearch, useWatchedPagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import {
  DEFAULT_STATUS,
  defaultSort,
  emptyText,
  filterOptions,
  ISSUES_KEY,
  issuesArgs,
  type IssueStatusFilter,
  kindText,
  listRows,
  outsideNote,
  readSeverity,
  readSort,
  readStatus,
  SEVERITY_OPTIONS,
  severityTone,
  snoozeLine,
  SORT_OPTIONS,
  STATUS_FILTERS,
  statusTone,
  whoLine,
} from "./issuesLogic";

/** list_issues takes at most 366 days. */
const MAX_DAYS = 366;

function IssueRow({ i, current, search, replace }: { i: Issue; current: boolean; search: string; replace: boolean }) {
  const snooze = snoozeLine(i);
  return (
    <Link className="row issue-row" to={`/issues/${i.id}${search}`} state={{ fromList: true }} replace={replace} aria-current={current ? "true" : undefined} style={current ? { background: "var(--surface-2)" } : undefined}>
      <span className={`att-ic ${severityTone(i.severity)}`}><Icon name={attIcon(i.title)} /></span>
      <div className="grow">
        <div className="name">{i.title}</div>
        <div className="sub">{[kindText(i), i.detail, i.due].filter(Boolean).join(" · ")}</div>
        <div className="sub">{whoLine(i)}</div>
        {snooze && <div className="sub" data-testid="snoozed-until">{snooze}</div>}
      </div>
      {i.vehicle && <Plate v={i.vehicle} />}
      <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill>
    </Link>
  );
}

export default function Issues() {
  const { store, noConnector, managePermissions, realtime } = useFleet();
  const lists = useLists(!noConnector);
  const { id } = useParams();
  const { search } = useLocation();
  const dates = useDateRange("month", { maxDays: MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const status = readStatus(params);
  const sort = readSort(params, status);
  const severity = readSeverity(params);
  const kind = params.get("kind") || "";
  const vehicle = params.get("vehicle") || "";
  const [text, setText] = useUrlSearch();
  /** The filters as the Filter panel applies them (docs/ui-patterns.md §1): every one at once, the URL's names kept. */
  const applyFilters = (v: FilterValues) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.delete("tab"); // the old links' tab= gives way to status=
    const put = (key: string, value: string, def = "") => (value && value !== def ? next.set(key, value) : next.delete(key));
    const st = (v.status as string) || DEFAULT_STATUS;
    put("status", st, DEFAULT_STATUS);
    put("kind", v.kind as string);
    put("vehicle", v.vehicle as string);
    put("severity", v.severity as string);
    // A new status takes its own order unless one was chosen for it.
    if (next.get("sort") === defaultSort(st as IssueStatusFilter)) next.delete("sort");
    return next;
  }, { replace: true });
  const setSort = (value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value && value !== defaultSort(status)) next.set("sort", value);
    else next.delete("sort");
    return next;
  }, { replace: true });

  const { from, to } = dates;
  const list = useWatchedPagedList<Issue, IssuesList>(
    ISSUES_KEY,
    "list_issues",
    issuesArgs({ status, from, to, sort, kind, vehicle, severity, search: text }),
    (a) => a.issues ?? [],
    { every: 60000, enabled: !noConnector && !dates.error },
  );
  const asked = useRef(list.asked);
  asked.current = list.asked;

  // Web: a change on the table reloads the list at once (a sync touches many rows: one reload a second at most).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    const stop = realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (asked.current) void store.load(ISSUES_KEY, "list_issues", asked.current);
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [store, realtime]);

  const entry = list.entry;
  const d = list.query.data;
  const stale = list.query.stale;
  const updating = list.query.updating && !dates.error;
  const narrowed = !!(kind || vehicle || severity);
  const rows = listRows(list.items, { status });
  // A row patched out of this filter (Resolve under Active) leaves the count too.
  const total = Math.max(0, list.total - (list.items.length - rows.length));
  const options = filterOptions(list.items, { kind: kind || undefined, vehicle: vehicle || undefined }, lists.vehicles?.map((v) => v.reg_no));
  const outside = d && !stale && !text ? outsideNote(d, status, narrowed) : undefined;
  const today = colomboDay();
  const label = STATUS_FILTERS.find(([k]) => k === status)?.[1] ?? "Issues";
  const filterDefs: FilterDef[] = [
    { ...pairsDef("status", "Status", STATUS_FILTERS, DEFAULT_STATUS, { snoozed: d?.snoozed || undefined }) },
    listDef("kind", "Kind", "All kinds", options.kinds.map(([value, l]) => ({ value, label: l })), kind),
    listDef("vehicle", "Vehicle", "All vehicles", options.vehicles.map((v) => ({ value: v, label: v })), vehicle),
    pairsDef("severity", "Severity", SEVERITY_OPTIONS, ""),
  ];

  return (
    <section className="view">
      <ListWithDetail>
        <div className="ph">
          <div><div className="eyebrow">Everything that needs attention</div><h1>Issues</h1></div>
        </div>
        <div className="card card-b" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          <DateRangePicker value={dates} label="Opened" />
          <FilterBar
            search={<SearchBox value={text} onChange={setText} placeholder="Title, plate, driver or detail" />}
            filters={filterDefs}
            values={{ status, kind, vehicle, severity }}
            onChange={applyFilters}
            sort={{ value: sort, options: SORT_OPTIONS.map(([value, l]) => ({ value, label: l })), onChange: setSort, label: "Order" }}
          />
        </div>

        {dates.error ? null : !d && !noConnector ? (
          <>
            <ErrBox entry={entry} onRetry={list.query.refetch} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!entry.err && <div className="card"><SkeletonRows label="Loading issues…" /></div>}
          </>
        ) : d && stale && entry.err ? (
          // The rows on screen are another filter's: say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={list.query.refetch}>Try again</button>}>{errText(entry.err)[0]}</Notice>
        ) : d ? (
          <div aria-busy={updating || undefined}>
            {!stale && <StaleNote entry={entry} />}
            {outside && (
              <div style={{ marginBottom: 12 }}>
                <Notice tone="info" action={<button type="button" className="btn small" onClick={() => dates.setCustom(addDays(today, -365), today)}>Show the last 12 months</button>}>{outside}</Notice>
              </div>
            )}
            <div className="card" data-testid="issues-list">
              <ListHeader title={label} count={total} updating={updating} />
              <div className="rows" style={stale ? { opacity: 0.6 } : undefined}>
                {rows.length
                  ? rows.map((i) => <IssueRow key={i.id} i={i} current={i.id === id} search={search} replace={!!id} />)
                  : stale ? <SkeletonRows rows={3} /> : <EmptyLine>{emptyText(status, from, to, narrowed, text)}</EmptyLine>}
              </div>
              <LoadMore list={list} />
              <Pager list={list} />
            </div>
          </div>
        ) : null}
      </ListWithDetail>
    </section>
  );
}
