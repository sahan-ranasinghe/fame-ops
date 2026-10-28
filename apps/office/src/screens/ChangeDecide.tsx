// Round 48 (item 1): the approver's page for a CHANGE to an existing task proposed by someone without the approve
// permission (reassign_task, update_task's day / time / end / driver / vehicle, update_task_stops). The pattern is the
// changed booking's (Phase 6 Part 2: a proposal in the queue, the live thing untouched until the decision): the task's
// title, who proposes what, each change as "from → to", then Approve (the server applies the same tool as the approver)
// or Decline with a reason. To do something else than proposed, the approver opens the task and changes it there.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { DecideResult, RequestCard } from "../data/types";
import { joinDots } from "../lib/format";
import { errText } from "../transport/errors";
import { canOpenTask, type FleetError } from "../transport/types";
import { Notice } from "../ui/basics";
import { PageTop, StickyActions } from "../ui/Page";
import { StatusBanner } from "../ui/patterns";
import { useToast } from "../ui/Toast";
import { DecidedBy, refreshRequest, ReviewingLine, useReviewing } from "./approvers";
import { ChangesList, LateNotice, RequestStatusPill } from "./requestParts";

export function ChangeDecide({ id, q, setQ }: { id: string; q: RequestCard; setQ: (q: RequestCard) => void }) {
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode } | null>(null);
  const [done, setDone] = useState(false);
  useReviewing(id, q.status === "waiting");
  const change = q.change;
  const taskId = change?.task_id;

  async function decide(decision: "approve" | "decline") {
    if (decision === "decline" && !reason.trim()) {
      setMsg({ tone: "bad", text: "Write the reason first. The person who proposed it sees it." });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<DecideResult & { task_id?: string }>("decide_request", {
        request_id: id,
        decision,
        version: q.version,
        ...(decision === "decline" ? { reason: reason.trim() } : {}),
      });
      void store.invalidate();
      if (decision === "decline") {
        toast("Change declined · the task is as it was");
        navigate("/requests", { replace: true });
        return;
      }
      setDone(true);
      setMsg({
        tone: "ok",
        text: (
          <>
            <b>Approved and applied.</b> {change?.summary ? `${change.summary}. ` : ""}
            {(p.task_id ?? taskId) && canOpenTask(me) && <Link className="btn small" to={`/tasks/${p.task_id ?? taskId}`}>Open task →</Link>}{" "}
            <Link className="btn small" to={`/requests/${id}`}>The request →</Link>
          </>
        ),
      });
    } catch (e) {
      // Refused (another approver decided it, the task moved on): the server's words, and the card as it is now.
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
      void refreshRequest(transport, id, setQ, () => store.invalidate());
    }
    setBusy(false);
  }

  const waiting = q.status === "waiting" && me.tools.includes("decide_request") && !done;
  return (
    <section className="view" data-testid="change-decide">
      <PageTop title="Approve a change" sub={<RequestStatusPill status={q.status} />} backTo="/requests" />
      {q.status === "waiting" && !done && (
        <StatusBanner tone="warn" icon="clock" testId="decide-banner" title="Waiting for your OK" line={joinDots([`Proposed by ${q.requested_by}`, q.asked])} />
      )}
      {q.late && <LateNotice approver />}
      <div className="card card-b">
        <div className="name" style={{ fontSize: 19 }} data-testid="change-task">{q.title || change?.task_title || "A task"}</div>
        <div className="sub" data-testid="proposal-line">{joinDots([change?.summary || "a change", `proposed by ${q.requested_by}`])}</div>
        <p className="muted" style={{ marginTop: 10 }}>
          The task is as it was until you decide. {change?.task_was === "declined" ? "It needs a driver (the driver declined it)." : ""}
        </p>
        <ChangesList changes={change?.changes} testId="change-lines" />
        <dl className="kv" style={{ marginTop: 14 }}>
          <div><dt>When</dt><dd>{q.when}</dd></div>
          {q.back_by && <div><dt>Back by</dt><dd>{q.back_by}</dd></div>}
          {q.route && <div><dt>Route</dt><dd>{q.route}</dd></div>}
          {q.proposed?.driver && <div><dt>Driver would be</dt><dd>{q.proposed.driver}</dd></div>}
          {(q.proposed?.vehicle || q.proposed?.vehicle_text) && <div><dt>Vehicle would be</dt><dd>{q.proposed.vehicle ?? q.proposed.vehicle_text}</dd></div>}
          {q.decline_reason && <div style={{ gridColumn: "1/-1" }}><dt>Declined because</dt><dd>{q.decline_reason}</dd></div>}
        </dl>
        <div style={{ marginTop: 12 }}><DecidedBy q={q} /></div>
        <ReviewingLine list={q.reviewing} block />
        {taskId && canOpenTask(me) && (
          <div className="acts"><Link className="btn" to={`/tasks/${taskId}`}>Open the task → (to change it another way)</Link></div>
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {waiting && declining && (
        <div className="confirm" data-testid="decline">
          <div className="field">
            <label htmlFor="ch-reason">Decline with a reason</label>
            <input id="ch-reason" maxLength={300} placeholder="e.g. Keep Nuwan on it; he is back at 10" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
        </div>
      )}
      {waiting && (
        <StickyActions>
          {declining
            ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => { setDeclining(false); setMsg(null); }}>Back</button>
                <button type="button" className="btn dark" disabled={busy} onClick={() => void decide("decline")} data-testid="decline-confirm">Decline the change</button>
              </>
            )
            : (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => { setDeclining(true); setMsg(null); }} data-testid="decline-start">Decline…</button>
                <button type="button" className="btn primary" disabled={busy} onClick={() => void decide("approve")} data-testid="approve">Approve the change</button>
              </>
            )}
        </StickyActions>
      )}
    </section>
  );
}
