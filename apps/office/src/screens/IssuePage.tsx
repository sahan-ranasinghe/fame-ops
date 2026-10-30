// One issue (/issues/:id, a child of the list; Phase 7 §9): a panel beside the
// list on a desktop with an X (Esc closes it too), a full page with Back on a
// phone. The facts (opened, opened by, taken by, resolved or dismissed at and
// by), the linked task / report / request with its photos, the timeline, and
// the office's actions with the issues permission: Take (assign to me), Add
// note, Resolve with a note, Dismiss, Reopen. Take, Resolve and Dismiss close
// the panel; the list's row and the bell are patched in place at once and
// fetched again quietly (no reload flash).
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import type { Issue, IssueHistory, IssuesList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { attIcon, cap, clock } from "../lib/format";
import { errText } from "../transport/errors";
import { can, canOpenTask, type FleetError } from "../transport/types";
import { Avatar, Loading, Notice, Pill, Plate } from "../ui/basics";
import { colomboDay } from "../ui/dateRange";
import { Icon } from "../ui/icons";
import { useIsPhone } from "../ui/phone";
import { useToast } from "../ui/Toast";
import { BELL_KEY, eventText, isActive, issueFacts, ISSUES_KEY, kindText, patchIssues, severityTone, statusTone } from "./issuesLogic";
import { datesInWords, whenText } from "../lib/when";
import { DeleteEntryButton } from "./bin/BinParts";

/** update_issue's answer (not in data/types.ts yet). */
interface UpdateIssueAnswer {
  issue: Issue;
  changed?: string[];
}

/** The panel's top: Back on a phone, an X on a desktop; Esc closes it (not while typing in a field). */
function PanelTop({ title, sub, side, onClose }: { title: ReactNode; sub?: ReactNode; side?: ReactNode; onClose: () => void }) {
  const phone = useIsPhone();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="page-top">
      {phone && <button type="button" className="btn icon-btn back" onClick={onClose} aria-label="Back"><Icon name="back" /></button>}
      <div className="grow">
        {sub && <div className="eyebrow">{sub}</div>}
        <h2 className="page-title">{title}</h2>
      </div>
      {side}
      {!phone && <button type="button" className="btn icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="close" /></button>}
    </div>
  );
}

export default function IssuePage() {
  const { id = "" } = useParams();
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const { me, store, transport, noConnector } = useFleet();
  const toast = useToast();
  const q = useQuery<IssueHistory>("issue", "issue_history", { id }, { enabled: !noConnector && !!id });
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = me.tools.includes("update_issue");
  // A note half-typed for one issue never moves to the next one opened.
  useEffect(() => {
    setNote("");
    setMsg(null);
  }, [id]);

  /**
   * Back to the list with its filters, without a history entry of its own: opened from the list (the row pushed it),
   * one step back; opened from a link (the bell, the Overview, a reload), the URL replaced. Back then leaves Issues
   * instead of reopening a resolved issue.
   */
  const close = () => ((state as { fromList?: boolean } | null)?.fromList ? navigate(-1) : navigate(`/issues${search}`, { replace: true }));

  async function change(input: Record<string, unknown>, done: string, closes: boolean) {
    const was = q.data?.issue.status ?? "";
    setBusy(true);
    setMsg(null);
    try {
      const r = await transport.call<UpdateIssueAnswer>("update_issue", { id, ...input });
      // The row and the bell change at once; the quiet refresh after brings the server's own words.
      const takenAt = `${colomboDay()} ${clock(Date.now())}`;
      store.patch<IssuesList>(ISSUES_KEY, (d) => patchIssues(d, r.issue, was, { takenAt }));
      store.patch<IssuesList>(BELL_KEY, (d) => patchIssues(d, r.issue, was, { activeOnly: true, takenAt }));
      toast(done);
      setNote("");
      setBusy(false);
      if (closes) close();
      void store.invalidate();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }
  function addNote(ev: FormEvent) {
    ev.preventDefault();
    if (!note.trim()) {
      setMsg("Write the note first.");
      return;
    }
    void change({ note: note.trim() }, "Note added", false);
  }
  function resolve() {
    if (!note.trim()) {
      setMsg("Write what was done first: it becomes the resolution.");
      return;
    }
    void change({ status: "resolved", note: note.trim() }, "Issue resolved", true);
  }

  // The answer for another issue (a click on the next row) is never shown under this one.
  const h = q.data && q.data.issue.id === id ? q.data : undefined;
  if (!h) {
    return (
      <div data-testid="issue-page">
        <PanelTop title="Issue" onClose={close} />
        {q.err ? <Notice tone="bad">{errText(q.err)[0]}</Notice> : <Loading>Loading the issue…</Loading>}
      </div>
    );
  }
  const i = h.issue;
  const active = isActive(i.status);
  const driverLink = i.driver_username && can(me, ...ROUTES_NEED) ? `/drivers/${i.driver_username}` : null;

  return (
    <div className="stack" data-testid="issue-page">
      <PanelTop
        title={i.title}
        sub={kindText(i)}
        side={<>{i.pre_trip && <span data-testid="issue-pre-trip"><Pill tone="warn">Pre-trip</Pill></span>} <Pill tone={statusTone(i.status)}>{i.status.replace("_", " ")}</Pill></>}
        onClose={close}
      />
      <div className="card card-b">
        <div className="row" style={{ padding: 0 }}>
          <span className={`att-ic ${severityTone(i.severity)}`}><Icon name={attIcon(i.title)} /></span>
          <div className="grow">
            <div className="name">{i.detail || "—"}</div>
            <div className="sub">{[cap(i.severity), i.due].filter(Boolean).join(" · ")}</div>
          </div>
          {i.vehicle && <Plate v={i.vehicle} />}
        </div>
        <dl className="kv" data-testid="issue-facts" style={{ marginTop: 12 }}>
          {issueFacts(i).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              {/* Round 3: the person who took it with their photo (the initials until there is one). */}
              <dd>{label === "Taken by" && i.assigned_to ? <span className="person"><Avatar name={i.assigned_to.name} src={i.assigned_to.photo_url} small />{datesInWords(value)}</span> : datesInWords(value)}</dd>
            </div>
          ))}
        </dl>
        {i.resolution_note && <Notice tone="ok">{i.status === "dismissed" ? "Dismissed" : "Resolved"} by {i.resolved_by ?? "?"} {i.resolved ? whenText(i.resolved, { inline: true }) : ""}: {i.resolution_note}</Notice>}
        <div className="chips">
          {h.task && canOpenTask(me) && <Link className="btn small" to={`/tasks/${h.task.id}`}>Task · {h.task.title} →</Link>}
          {driverLink && <Link className="btn small" to={driverLink}>Driver · {i.driver}</Link>}
          {i.driver_links?.call && <a className="btn small" href={i.driver_links.call}>Call driver</a>}
          {i.driver_links?.whatsapp && <a className="btn small" href={i.driver_links.whatsapp} target="_blank" rel="noopener">WhatsApp</a>}
          {h.request && <Link className="btn small" to={`/requests/${h.request.id}`}>Request · {h.request.requested_by}</Link>}
        </div>
      </div>

      {h.report && (
        <div className="card card-b" data-testid="issue-report">
          <h2>The driver's report</h2>
          <p style={{ margin: 0 }}>{cap(h.report.category)} · {h.report.driver ?? "?"} · reported {whenText(h.report.reported, { inline: true })} · <b>{h.report.status.replace("_", " ")}</b></p>
          {h.report.note && <p style={{ margin: 0 }}>{h.report.note}</p>}
          {h.report.office_note && <p className="muted" style={{ margin: 0 }}>Office: {h.report.office_note}</p>}
          <div className="photos">{h.report.photos.map((u, n) => <a key={n} className="btn small" href={u} target="_blank" rel="noopener">Photo {n + 1}</a>)}</div>
        </div>
      )}

      {canEdit && (
        <form className="card card-b form" onSubmit={addNote} data-testid="issue-actions">
          <h2>{active ? "Deal with it" : "Reopen"}</h2>
          <div className="field">
            <label htmlFor="issue-note">Note{active ? " (the resolution when you resolve)" : ""}</label>
            <input id="issue-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, or what the driver should know" />
          </div>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div className="acts">
            {active && !i.assigned_to && <button type="button" className="btn" disabled={busy} onClick={() => void change({ assign_to: "me", status: "in_progress" }, "Taken", true)}>Take</button>}
            {active && <button className="btn" type="submit" disabled={busy}>Add note</button>}
            {active && <button type="button" className="btn dark" disabled={busy} onClick={resolve}>Resolve</button>}
            {active && <button type="button" className="btn" disabled={busy} onClick={() => void change({ status: "dismissed", ...(note.trim() && { note: note.trim() }) }, "Issue dismissed", true)}>Dismiss</button>}
            {!active && <button type="button" className="btn dark" disabled={busy} onClick={() => void change({ status: "open", ...(note.trim() && { note: note.trim() }) }, "Issue reopened", false)}>Reopen</button>}
          </div>
        </form>
      )}

      {/* Round 52 (§40): a wrong issue (approve): Delete… with a reason (Dismiss stays the usual way). */}
      {me.tools.includes("delete_entry") && (
        <div className="acts"><DeleteEntryButton kind="issue" id={i.id} fallback={`/issues${search}`} onDeleted={() => close()} /></div>
      )}
      <div className="card card-b" data-testid="issue-history">
        <h2>History</h2>
        <dl className="kv">
          {h.events.map((e, n) => (
            <div key={n} style={{ gridColumn: "1/-1" }}>
              <dt>{whenText(e.at)}</dt>
              <dd>{eventText(e)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
