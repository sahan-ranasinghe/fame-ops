// The issues centre (issues or assign_tasks; Phase 7 §9; Round 4–7 item 8, §33.7). Three tabs (Gmail's Inbox · Snoozed ·
// Done): Open, Snoozed and Resolved. Open shows the issues grouped by kind (Samsara alerts, Sentry, GitHub notifications):
// the most urgent group first, each "Missed tasks · 12" with its 3 newest, collapsible, and "Show all 12" (?kind=: that
// kind 25 at a time with Load more / page numbers); words searched for list the results as one list. Snoozed and Resolved
// are flat, 25 at a time. Every tab is over the opened days (the date range): the Open tab any time by default (an open
// issue is open whenever it was opened), Snoozed and Resolved this month as before. The Filter's Status is the Open tab's
// own (Active, Open, In progress): Snoozed, Resolved, Dismissed and All repeated the tabs and are gone (Sahan's OK, 22
// October 2026), as is the "N more were opened outside these dates" note. Every row is Gmail's: the kind's icon tinted
// by severity, ONE title line (the server's headline: never the kind again), ONE grey line (plate · driver · when), the
// Pre-trip tag. With update_issues, rows are ticked (one by one, the rows of a group, or "Select all 12 in this group")
// and resolved or dismissed together with one reason. An issue opens beside the list on a desktop (/issues/:id, a panel with an X; Esc
// closes it) and as a full page with Back on a phone. Every filter is in the URL. The lists are watched every 60 s; on
// the web the Realtime channel on issues reloads them within a second.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { Issue, IssuesList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { ErrBox, Notice, Segmented, StaleNote } from "../ui/basics";
import { DateRangePicker, useDateRange } from "../ui/DateRangePicker";
import { Icon } from "../ui/icons";
import { FilterBar } from "../ui/FilterBar";
import { type FilterDef, type FilterValues, listDef, pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, LoadMore, Pager, SearchBox, SkeletonRows, useUrlSearch, useWatchedPagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { BulkBar, BulkSheet, IssueGroupBlock, IssueLine } from "./IssueParts";
import {
  type BulkAnswer,
  bulkCalls,
  bulkDoneText,
  type BulkAction,
  DEFAULT_STATUS,
  defaultSort,
  emptyText,
  filterOptions,
  groupArgs,
  groupText,
  isActive,
  ISSUES_KEY,
  issuesArgs,
  type IssueStatusFilter,
  type IssueTab,
  listRows,
  CLOSED_STATUS_FILTERS,
  OPEN_STATUS_FILTERS,
  readSeverity,
  readSort,
  readStatus,
  SEVERITY_OPTIONS,
  sendBulk,
  showsGroups,
  SORT_OPTIONS,
  STATUS_FILTERS,
  TAB_STATUS,
  tabOf,
  TABS,
  toggled,
} from "./issuesLogic";

/** list_issues takes at most 366 days. */
const MAX_DAYS = 366;
/** The groups' store key. */
const GROUPS_KEY = "issueGroups";

export default function Issues() {
  const { store, transport, noConnector, managePermissions, realtime, me } = useFleet();
  const toast = useToast();
  const lists = useLists(!noConnector);
  const { id } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = readStatus(params);
  const tab = tabOf(status);
  // The Open tab: any time by default (Round 4–7); Snoozed and Resolved: this month, as before.
  const dates = useDateRange(tab === "open" ? "any" : "month", { maxDays: MAX_DAYS });
  const sort = readSort(params, status);
  const severity = readSeverity(params);
  const kind = params.get("kind") || "";
  const vehicle = params.get("vehicle") || "";
  const [text, setText] = useUrlSearch();
  const canBulk = me.tools.includes("update_issues");

  /** The filters as the Filter panel applies them (docs/ui-patterns.md §1): every one at once, the URL's names kept. */
  const applyFilters = (v: FilterValues) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.delete("tab"); // the old links' tab= gives way to status=
    const put = (key: string, value: string, def = "") => (value && value !== def ? next.set(key, value) : next.delete(key));
    // The Status section is the Open tab's only; under Snoozed and Resolved the tab's status stays.
    const st = ((v.status as string) || (tab === "open" ? DEFAULT_STATUS : status)) as IssueStatusFilter;
    put("status", st, DEFAULT_STATUS);
    put("kind", v.kind as string);
    put("vehicle", v.vehicle as string);
    put("severity", v.severity as string);
    // A new status takes its own order unless one was chosen for it.
    if (next.get("sort") === defaultSort(st)) next.delete("sort");
    return next;
  }, { replace: true });
  const setTab = (t: IssueTab) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.delete("tab");
    next.delete("sort");
    const st = TAB_STATUS[t];
    if (st === DEFAULT_STATUS) next.delete("status");
    else next.set("status", st);
    return next;
  }, { replace: true });
  const setSort = (value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value && value !== defaultSort(status)) next.set("sort", value);
    else next.delete("sort");
    return next;
  }, { replace: true });
  /** The links that keep every other filter: a kind's own list ("Show all 12") and back to the groups. */
  const withKind = (k: string) => {
    const next = new URLSearchParams(params);
    if (k) next.set("kind", k);
    else next.delete("kind");
    const q = next.toString();
    return `/issues${q ? `?${q}` : ""}`;
  };

  const filters = { status, sort, from: dates.from, to: dates.to, kind, vehicle, severity, search: text };
  const grouped = showsGroups(filters);
  const blocked = !!dates.error;
  const list = useWatchedPagedList<Issue, IssuesList>(
    ISSUES_KEY,
    "list_issues",
    grouped ? null : issuesArgs(filters),
    (a) => a.issues ?? [],
    { every: 60000, enabled: !noConnector && !grouped && !blocked },
  );
  const groups = useQuery<IssuesList>(GROUPS_KEY, "list_issues", grouped ? groupArgs(filters) : null, { every: 60000, keep: true, enabled: !noConnector });
  const reload = useRef<() => void>(() => {});
  reload.current = () => {
    if (grouped) groups.refetch();
    else if (list.asked) void store.load(ISSUES_KEY, "list_issues", list.asked);
  };

  // Web: a change on the table reloads the list at once (a sync touches many rows: one reload a second at most).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    const stop = realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        reload.current();
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [realtime]);

  // ---- The selection (Gmail's ticks): only issues still open can be resolved or dismissed; a new view starts empty. ----
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [acting, setActing] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const view = `${status}|${kind}|${vehicle}|${severity}|${text}`;
  const [pickedView, setPickedView] = useState(view);
  if (pickedView !== view) {
    setPickedView(view);
    setPicked(new Set());
  }
  const pickable = canBulk && tab !== "resolved";
  const pick = (ids: string[], on: boolean) => setPicked((s) => toggled(s, ids, on));

  /** "Select all 12 in this group": the kind's every issue under the same filters (its ids, at most 500). */
  async function pickAllOf(k: string, count: number) {
    try {
      const all = await transport.call<IssuesList>("list_issues", { ...issuesArgs({ ...filters, kind: k }), limit: Math.min(500, count) });
      pick(all.issues.map((i) => i.id), true);
    } catch (e) {
      toast(errText(e as FleetError)[0]);
    }
  }

  /**
   * Resolve or Dismiss the picked issues, 100 a call. Each call's done ids leave the selection at once; the first call that
   * fails stops the rest and says how many were done, so Try again sends only what is left.
   */
  async function act(reason: string) {
    if (!acting) return;
    const calls = bulkCalls([...picked], acting, reason);
    setBusy(true);
    setBulkError(null);
    try {
      const r = await sendBulk(calls, (c) => transport.call<BulkAnswer>("update_issues", c), (ids) => setPicked((s) => toggled(s, ids, false)));
      if (r.error) {
        const why = errText(r.error as FleetError)[0];
        setBulkError(r.done ? `${bulkDoneText(r.done, acting)}; the rest were not: ${why}` : why);
      } else {
        toast(bulkDoneText(r.done, acting));
        setActing(null);
        setPicked(new Set());
      }
    } finally {
      setBusy(false);
      void store.invalidate();
    }
  }

  const answer = grouped ? groups.data : list.query.data;
  const entry = grouped ? { data: groups.data, err: groups.err, loading: groups.loading } : list.entry;
  const stale = grouped ? groups.stale : list.query.stale;
  const updating = grouped ? groups.updating : list.query.updating;
  const err = grouped ? groups.err : list.entry.err;
  const refetch = grouped ? groups.refetch : list.query.refetch;
  const narrowed = !!(kind || vehicle || severity);
  const rows = grouped ? [] : listRows(list.items, { status });
  // A row patched out of this filter (Resolve on Open) leaves the count too.
  const total = Math.max(0, list.total - (list.items.length - rows.length));
  const options = filterOptions(list.items, { kind: kind || undefined, vehicle: vehicle || undefined }, lists.vehicles?.map((v) => v.reg_no));
  const filterDefs: FilterDef[] = [
    ...(tab === "open"
      ? [pairsDef("status", "Status", OPEN_STATUS_FILTERS, DEFAULT_STATUS)]
      : tab === "resolved"
      ? [pairsDef("status", "Status", CLOSED_STATUS_FILTERS, TAB_STATUS.resolved)]
      : []),
    listDef("kind", "Kind", "All kinds", options.kinds.map(([value, l]) => ({ value, label: l })), kind),
    listDef("vehicle", "Vehicle", "All vehicles", options.vehicles.map((v) => ({ value: v, label: v })), vehicle),
    pairsDef("severity", "Severity", SEVERITY_OPTIONS, ""),
  ];
  // The tabs' counts: everything open (not snoozed) and the snoozed ones, from whichever answer is on screen.
  const counts = answer ? { open: answer.open + answer.in_progress, snoozed: answer.snoozed ?? 0 } : null;
  const tabOptions = TABS.map(([k, l]) => [k, counts && k !== "resolved" ? `${l} · ${counts[k]}` : l] as const);
  const needs = answer?.needs_action;
  const rowProps = { currentId: id, search, replace: !!id, filter: status };
  const kindName = kind ? groupText({ kind, kind_text: options.kinds.find(([k]) => k === kind)?.[1] ?? kind }) : "";
  const label = STATUS_FILTERS.find(([k]) => k === status)?.[1] ?? "Issues";
  const headerTitle = kind ? kindName : label;
  const groupTotal = (answer?.groups ?? []).reduce((n, g) => n + g.count, 0);

  return (
    <section className="view">
      <ListWithDetail>
        <div className="ph">
          <div>
            <div className="eyebrow">Everything that needs attention</div>
            <h1>Issues</h1>
            {needs !== undefined && (
              <p className="sub" style={{ margin: "4px 0 0" }} data-testid="issues-summary">
                {needs === 0 ? "Nothing needs action now." : `${needs} need${needs === 1 ? "s" : ""} action${answer?.critical ? ` · ${answer.critical} critical` : ""}`}
              </p>
            )}
          </div>
        </div>
        <div className="card card-b" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          <Segmented label="Issues" options={tabOptions} value={tab} onChange={setTab} />
          <DateRangePicker value={dates} label="Opened" />
          <FilterBar
            search={<SearchBox value={text} onChange={setText} placeholder="Title, plate, driver or detail" />}
            filters={filterDefs}
            values={{ status, kind, vehicle, severity }}
            onChange={applyFilters}
            sort={grouped ? undefined : { value: sort, options: SORT_OPTIONS.map(([value, l]) => ({ value, label: l })), onChange: setSort, label: "Order" }}
          />
        </div>

        {blocked ? null : !answer && !noConnector ? (
          <>
            <ErrBox entry={entry} onRetry={refetch} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!err && <div className="card"><SkeletonRows label="Loading issues…" /></div>}
          </>
        ) : answer && stale && err ? (
          // The rows on screen are another filter's: say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={refetch}>Try again</button>}>{errText(err)[0]}</Notice>
        ) : answer ? (
          <div aria-busy={updating || undefined}>
            {!stale && !grouped && <StaleNote entry={list.entry} />}
            {pickable && <BulkBar n={picked.size} onAct={(a) => { setBulkError(null); setActing(a); }} onClear={() => setPicked(new Set())} />}
            {grouped ? (
              <div className="card issue-groups" data-testid="issues-list" style={stale ? { opacity: 0.6 } : undefined}>
                <ListHeader title={label} count={groupTotal} updating={updating} />
                {(answer.groups ?? []).length === 0 ? (
                  <div className="empty-state" data-testid="issues-empty">
                    <span className="att-ic"><Icon name="check" /></span>
                    <EmptyLine>{emptyText(status, dates.from, dates.to, narrowed, text)}</EmptyLine>
                  </div>
                ) : (answer.groups ?? []).map((g) => (
                  <IssueGroupBlock
                    key={g.kind}
                    g={g}
                    open={!collapsed.has(g.kind)}
                    onToggle={() => setCollapsed((c) => toggled(c, [g.kind], !c.has(g.kind)))}
                    rowProps={rowProps}
                    picked={pickable ? picked : undefined}
                    onPick={pickable ? pick : undefined}
                    onPickAll={pickable ? () => void pickAllOf(g.kind, g.count) : undefined}
                    showAll={withKind(g.kind)}
                  />
                ))}
              </div>
            ) : (
              <div className="card" data-testid="issues-list">
                <ListHeader
                  title={kind ? <span className="issue-kind-head"><button type="button" onClick={() => navigate(withKind(""), { replace: true })} className="btn icon-btn small" aria-label="All kinds" title="All kinds"><Icon name="back" /></button>{headerTitle}</span> : headerTitle}
                  count={total}
                  updating={updating}
                  right={pickable && rows.some((i) => isActive(i.status)) ? (
                    <label className="check small" data-testid="page-tick">
                      <input type="checkbox" checked={rows.every((i) => picked.has(i.id))} onChange={(e) => pick(rows.filter((i) => isActive(i.status)).map((i) => i.id), e.target.checked)} /> Select all shown
                    </label>
                  ) : undefined}
                />
                <div className="rows" style={stale ? { opacity: 0.6 } : undefined}>
                  {rows.length
                    ? rows.map((i) => (
                      <IssueLine
                        key={i.id}
                        i={i}
                        filter={status}
                        current={i.id === id}
                        search={search}
                        replace={!!id}
                        picked={pickable && isActive(i.status) ? picked.has(i.id) : undefined}
                        onPick={pickable && isActive(i.status) ? (on) => pick([i.id], on) : undefined}
                      />
                    ))
                    : stale ? <SkeletonRows rows={3} /> : (
                      <div className="empty-state" data-testid="issues-empty">
                        <span className="att-ic"><Icon name={tab === "snoozed" ? "clock" : "check"} /></span>
                        <EmptyLine>{emptyText(status, dates.from, dates.to, narrowed, text)}</EmptyLine>
                      </div>
                    )}
                </div>
                <LoadMore list={list} />
                <Pager list={list} />
              </div>
            )}
          </div>
        ) : null}
        <BulkSheet action={acting} n={picked.size} busy={busy} error={bulkError} onClose={() => setActing(null)} onConfirm={(r) => void act(r)} />
      </ListWithDetail>
    </section>
  );
}
