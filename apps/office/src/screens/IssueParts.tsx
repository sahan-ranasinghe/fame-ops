// The issues centre's pieces (Round 4–7, item 8, §33.7): Gmail's row (a tick, the kind's icon tinted by severity, ONE
// title line, ONE grey meta line, the Pre-trip tag), a group of one kind (Samsara / Sentry / GitHub notifications: "Missed
// tasks · 12", the 3 newest, "Show all 12", collapsible, a tick for the group and "Select all 12 in this group"), the bulk
// bar ("3 selected · Resolve · Dismiss") and the reason sheet (update_issues: one reason, required).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Issue } from "../data/types";
import { cap } from "../lib/format";
import { datesInWords } from "../lib/when";
import { Avatar, Notice, Pill, Plate } from "../ui/basics";
import { Icon } from "../ui/icons";
import { ChoiceChip } from "../ui/Select";
import { Sheet } from "../ui/Sheet";
import {
  BULK_REASONS,
  type BulkAction,
  groupText,
  groupTick,
  type IssueGroup,
  isActive,
  type IssueStatusFilter,
  kindIcon,
  kindText,
  metaParts,
  rowTitle,
  severityTone,
  snoozeLine,
  statusShown,
  statusTone,
} from "./issuesLogic";

/** Who closed it, on the Resolved tab: "closed automatically" (the system), else "by Sahan". */
function closedBy(i: Issue): string {
  if (isActive(i.status) || !i.resolved_by) return "";
  return i.resolved_by === "system" ? "closed automatically" : `by ${i.resolved_by}`;
}

/** A box that can show "some picked" (a group's tick). */
function TickBox({ state, onChange, label, testId }: { state: "on" | "mixed" | "off"; onChange: (on: boolean) => void; label: string; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <label className="issue-tick">
      <input ref={ref} type="checkbox" checked={state === "on"} onChange={(e) => onChange(e.target.checked)} aria-label={label} data-testid={testId} />
    </label>
  );
}

/**
 * One issue: the tick (when the person may act in bulk), then the link to its page: the kind's icon tinted by severity,
 * ONE title, ONE grey line (the plate chip · driver · when), the snooze, who closed it, who has it, and the status only
 * when the filter does not say it already.
 */
export function IssueLine({ i, filter, current, search, replace, picked, onPick }: {
  i: Issue;
  /** The status asked for (the status pill shows only what it does not say). */
  filter: IssueStatusFilter;
  current: boolean;
  search: string;
  replace: boolean;
  /** Undefined = no tick (no update_issues, or a closed issue). */
  picked?: boolean;
  onPick?: (on: boolean) => void;
}) {
  const tone = severityTone(i.severity);
  const snooze = snoozeLine(i);
  const by = closedBy(i);
  const meta = metaParts(i);
  return (
    <div className={`issue-line${picked ? " picked" : ""}`} data-testid="issue-line">
      {onPick && <TickBox state={picked ? "on" : "off"} onChange={onPick} label={`Select ${rowTitle(i)}`} />}
      <Link
        className="row issue-row grow"
        to={`/issues/${i.id}${search}`}
        state={{ fromList: true }}
        replace={replace}
        aria-current={current ? "true" : undefined}
        style={current ? { background: "var(--surface-2)" } : undefined}
      >
        <span className={`att-ic ${tone}`} role="img" aria-label={`${cap(i.severity)} · ${kindText(i)}`} title={kindText(i)}><Icon name={kindIcon(i.kind)} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="name issue-title">
            <span className="clip">{rowTitle(i)}</span>
            {i.pre_trip && <span data-testid="issue-pre-trip"><Pill tone="warn">Pre-trip</Pill></span>}
          </div>
          <div className="sub issue-meta" data-testid="issue-meta">{meta.plate && <Plate v={meta.plate} />}<span className="clip">{datesInWords(meta.rest)}</span></div>
          {snooze && <div className="sub" data-testid="snoozed-until">{datesInWords(snooze)}</div>}
        </div>
        {by && <span className="sub" data-testid="closed-by">{by}</span>}
        {/* Taken: who has it, by their photo (the initials until there is one). */}
        {i.assigned_to && <span title={`Taken by ${i.assigned_to.name}`} data-testid="issue-assignee"><Avatar name={i.assigned_to.name} src={i.assigned_to.photo_url} small /></span>}
        {statusShown(filter, i.status) && <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill>}
      </Link>
    </div>
  );
}

/**
 * One kind's group: its heading (the tick for the rows shown, the severity dot, "Missed tasks · 12", collapse), its 3
 * newest, "Show all 12" (the kind's own list), and once every row shown is picked, "Select all 12 in this group".
 */
export function IssueGroupBlock({ g, open, onToggle, rowProps, picked, onPick, onPickAll, showAll }: {
  g: IssueGroup;
  open: boolean;
  onToggle: () => void;
  rowProps: { currentId?: string; search: string; replace: boolean; filter: IssueStatusFilter };
  /** The selection (undefined = no bulk actions). */
  picked?: ReadonlySet<string>;
  onPick?: (ids: string[], on: boolean) => void;
  /** Picks every issue of the kind under the same filters (fetched). */
  onPickAll?: () => void;
  /** The kind's own list ("Show all 12"). */
  showAll: string;
}) {
  const ids = g.newest.map((i) => i.id);
  const tick = picked ? groupTick(picked, ids) : "off";
  // Gmail's "All 3 on this page are selected. Select all 12": once every row shown is picked and the group has more.
  const allPicked = tick === "on" && g.count > ids.length;
  const text = groupText(g);
  return (
    <section className="issue-group" data-testid={`issue-group-${g.kind}`} data-kind={g.kind}>
      <div className="issue-group-h">
        {picked && onPick && <TickBox state={tick} onChange={(on) => onPick(ids, on)} label={`Select the ${text.toLowerCase()} shown`} testId="group-tick" />}
        <button type="button" className="issue-group-toggle grow" aria-expanded={open} onClick={onToggle} data-testid="group-toggle">
          <span className={`chev${open ? " open" : ""}`} aria-hidden="true"><Icon name="down" /></span>
          <i className={`dot ${severityTone(g.severity)}`} aria-hidden="true" />
          <b>{text}</b>
          <span className="muted"> · {g.count}</span>
          <span className="sr-only"> ({g.severity})</span>
        </button>
        {g.count > g.newest.length && <Link className="btn small" to={showAll} data-testid="group-show-all">Show all {g.count}</Link>}
      </div>
      {open && (
        <div className="rows">
          {g.newest.map((i) => (
            <IssueLine
              key={i.id}
              i={i}
              filter={rowProps.filter}
              current={i.id === rowProps.currentId}
              search={rowProps.search}
              replace={rowProps.replace}
              picked={picked ? picked.has(i.id) : undefined}
              onPick={picked && onPick ? (on) => onPick([i.id], on) : undefined}
            />
          ))}
        </div>
      )}
      {allPicked && onPickAll && (
        <div className="issue-group-all sub" data-testid="group-select-all">
          The {ids.length} shown are selected. <button type="button" className="linkish" onClick={onPickAll}>Select all {g.count} in this group</button>
        </div>
      )}
    </section>
  );
}

/** The bar over the list while rows are picked (Gmail's): how many, Resolve, Dismiss, Clear. */
export function BulkBar({ n, onAct, onClear }: { n: number; onAct: (action: BulkAction) => void; onClear: () => void }) {
  if (n === 0) return null;
  return (
    <div className="bulk-bar" role="toolbar" aria-label="Selected issues" data-testid="bulk-bar">
      <b>{n} selected</b>
      <span className="grow" />
      <button type="button" className="btn dark small" onClick={() => onAct("resolved")}>Resolve</button>
      <button type="button" className="btn small" onClick={() => onAct("dismissed")}>Dismiss</button>
      <button type="button" className="btn small" onClick={onClear}>Clear</button>
    </div>
  );
}

/** The reason sheet: one reason for every issue picked (required), chips for the common ones; the error stays here. */
export function BulkSheet({ action, n, busy, error, onClose, onConfirm }: {
  action: BulkAction | null;
  n: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (action) setReason("");
  }, [action]);
  const verb = action === "dismissed" ? "Dismiss" : "Resolve";
  const ok = reason.trim().length > 0;
  return (
    <Sheet
      open={!!action}
      onClose={() => { if (!busy) onClose(); }}
      title={`${verb} ${n} issue${n === 1 ? "" : "s"}`}
      testId="bulk-sheet"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn dark" disabled={!ok || busy} onClick={() => onConfirm(reason.trim())} data-testid="bulk-confirm">{busy ? "Saving…" : verb}</button>
        </>
      )}
    >
      <div className="form">
        <div className="chips" role="group" aria-label="Common reasons">
          {BULK_REASONS.map((r) => <ChoiceChip key={r} selected={reason === r} onClick={() => setReason(r)}>{r}</ChoiceChip>)}
        </div>
        <div className="field">
          <label htmlFor="bulk-reason">Reason (written on each issue)</label>
          <input id="bulk-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test data" />
        </div>
        {!ok && <p className="sub" style={{ margin: 0 }}>Write a reason first: it is kept with each issue.</p>}
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Sheet>
  );
}
