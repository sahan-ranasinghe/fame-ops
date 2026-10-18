// The rows of Needs attention and Critical issues (Hotfix 3, L2). A row is one issue (its title opens /issues/:id) or a
// group of one kind ("Odometer typed by hand · 9 this week") whose title expands it in place to its issues. Every row,
// group and expanded issue has "Snooze or dismiss": an inline strip under the row (no pop-up, nothing closes on a click
// elsewhere) with Until tomorrow, 1 week and Dismiss; Dismiss asks once more in the same strip. A group's action covers
// all of its issues (update_issue once each). The rows go at once and the Overview is fetched again.
import { useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { Attention, Overview } from "../../data/types";
import { errText } from "../../transport/errors";
import type { FleetError } from "../../transport/types";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/Toast";
import { severityTone } from "../issuesLogic";
import { actedText, GROUP_ITEMS, type IssueRow, itemRow, kindLink, withoutIssues } from "./overviewLogic";

export type IssueAction = "tomorrow" | "week" | "dismiss";
/** Acts on the issues; answers the sentence to show when something failed (null = all went through). */
export type ActOn = (ids: string[], action: IssueAction) => Promise<string | null>;

/** update_issue for each issue (snooze, or dismissed); the rows leave the Overview at once, then everything is refreshed. */
export function useIssueAction(): ActOn {
  const { transport, store } = useFleet();
  const toast = useToast();
  return async (ids, action) => {
    const input = action === "dismiss" ? { status: "dismissed" } : { snooze: action };
    const results = await Promise.allSettled(ids.map((id) => transport.call("update_issue", { id, ...input })));
    const done = ids.filter((_, i) => results[i].status === "fulfilled");
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (done.length) store.patch<Overview>("overview", (o) => withoutIssues(o, done));
    void store.invalidate();
    if (failed) {
      const why = errText(failed.reason as FleetError)[0];
      return done.length ? `${actedText(action, done.length)}; ${ids.length - done.length} could not be changed: ${why}` : why;
    }
    toast(actedText(action, done.length));
    return null;
  };
}

/** "⋯" and the inline strip: Snooze until tomorrow or for a week, or Dismiss (a second click confirms). */
export function IssueActions({ title, ids, onAct }: { title: string; ids: string[]; onAct: ActOn }) {
  const [mode, setMode] = useState<"closed" | "open" | "confirm">("closed");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!ids.length) return null;
  const n = ids.length;
  const run = async (action: IssueAction) => {
    setBusy(true);
    setMsg(null);
    const err = await onAct(ids, action);
    setBusy(false);
    if (err) setMsg(err);
    else setMode("closed");
  };
  return (
    <>
      <button
        type="button"
        className={`btn small icon-btn ov-more${mode !== "closed" ? " on" : ""}`}
        aria-label={`Snooze or dismiss: ${title}`}
        aria-expanded={mode !== "closed"}
        title="Snooze or dismiss"
        onClick={() => { setMode((m) => (m === "closed" ? "open" : "closed")); setMsg(null); }}
      >
        <Icon name="more" />
      </button>
      {mode !== "closed" && (
        <div className="ov-acts" data-testid="issue-actions">
          {mode === "open" ? (
            <>
              <span className="muted small">Snooze</span>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run("tomorrow")}>Until tomorrow</button>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run("week")}>1 week</button>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => setMode("confirm")}>Dismiss</button>
            </>
          ) : (
            <>
              <span className="small"><b>{n === 1 ? "Dismiss this issue?" : `Dismiss all ${n}?`}</b> It leaves the lists until it comes back worse.</span>
              <button type="button" className="btn small danger" disabled={busy} onClick={() => void run("dismiss")}>{n === 1 ? "Yes, dismiss" : `Yes, dismiss ${n}`}</button>
              <button type="button" className="btn small" disabled={busy} onClick={() => setMode("open")}>Keep</button>
            </>
          )}
          {busy && <span className="muted small">Saving…</span>}
          {msg && <span className="ov-acts-err" role="alert">{msg}</span>}
        </div>
      )}
    </>
  );
}

const tone = (severity: string) => severityTone(severity) || "warn";

/** One issue inside an expanded group. */
function ItemLine({ a, i, canAct, onAct }: { a: Attention; i: number; canAct: boolean; onAct: ActOn }) {
  const r = itemRow(a, i);
  return (
    <div className="row ov-row ov-item" data-testid="attention-item">
      <div className="grow">
        <div className="name">{r.to ? <Link to={r.to}>{r.title}</Link> : r.title}</div>
        {r.sub && <div className="sub">{r.sub}</div>}
      </div>
      {r.due && <span className={`due ${tone(r.severity)}`}>{r.due}</span>}
      {canAct && <IssueActions title={r.title} ids={r.ids} onAct={onAct} />}
    </div>
  );
}

/** A row of Needs attention or Critical issues; a group expands in place. */
export function IssueLine({ row, canAct, onAct, testid = "attention-row" }: { row: IssueRow; canAct: boolean; onAct: ActOn; testid?: string }) {
  const [open, setOpen] = useState(false);
  const group = !!row.items && row.count > 1;
  const items = row.items ?? [];
  const shown = items.slice(0, GROUP_ITEMS);
  const t = tone(row.severity);
  return (
    <div className="ov-line" data-testid={testid} data-key={row.key}>
      <div className="row ov-row">
        <span className={`att-ic sm ${t}`}><Icon name={row.severity === "critical" ? "alert" : "issues"} /></span>
        <div className="grow">
          <div className="name">
            {group ? (
              <button type="button" className="linkish ov-expand" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span className="chev" aria-hidden="true" />{row.title}
              </button>
            ) : row.to ? <Link to={row.to}>{row.title}</Link> : row.title}
            {group && <span className={`pill ${t}`} data-testid="group-count">{row.count}</span>}
          </div>
          {row.sub && <div className="sub">{row.sub}</div>}
        </div>
        {row.due && <span className={`due ${t}`}>{row.due}</span>}
        {canAct && <IssueActions title={row.title} ids={row.ids} onAct={onAct} />}
      </div>
      {group && open && (
        <div className="ov-items rows" data-testid="group-items">
          {shown.map((a, i) => <ItemLine key={a.issue_id ?? i} a={a} i={i} canAct={canAct} onAct={onAct} />)}
          {row.count > shown.length && (
            <div className="row ov-row ov-item">
              <Link to={kindLink(row.kind)}>{row.count - shown.length} more on Issues</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
