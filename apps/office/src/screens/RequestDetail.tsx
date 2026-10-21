// One request, read only (/requests/:id): what was asked, its timeline, the
// decision or the cancellation; Review opens /requests/:id/decide (a changed
// booking too); Edit opens /requests/:id/edit for the person who asked (or an
// approver); an approved booking can be cancelled here with a reason (its task too).
// Phase 7 (§33, §34): a proposed task ("Task for Kamal · WP CAB-4521 · proposed
// by Nimal"), the trip (the stops with their times, the plan, the map), "Leave-by
// passed" when it waits past its leave-by, and Withdraw for the person who asked
// while it waits (a reason, on the page, in two steps). Once approved (§4): the
// driver and the vehicle with their photos; Tell requester for a person who
// asked without an office account, and their phone.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { RequestCard, RequestsList } from "../data/types";
import { cap, joinDots, requestTone } from "../lib/format";
import { errText } from "../transport/errors";
import { canOpenTask, type FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { PageTop, useAfterSave } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { ContactButtons } from "../ui/ContactButtons";
import { isProposal, requestView, withdrawInput } from "./approvalLogic";
import { DecidedBy, ReviewingLine } from "./approvers";
import { AskedWho, ChangesList, LateNotice, RequestHead, Timeline } from "./requestParts";
import { AssignedBlock, TellRequester } from "./RequestOutcome";
import { TripSection, useTripLine } from "./RequestTrip";
import { useRequestsHome, useTripCard } from "./myTripsQuery";

/**
 * The request from the lists already loaded (followed as they refresh), else
 * from list_requests(id) once the list is not loading.
 */
export function useRequest(id: string): { q: RequestCard | undefined; err: string | null; setQ: (q: RequestCard) => void } {
  const { transport } = useFleet();
  const list = useEntry<RequestsList>("reqs");
  const fromList = list.data?.requests.find((r) => r.id === id);
  const fromWaiting = useEntry<RequestsList>("reqWaiting").data?.requests.find((r) => r.id === id);
  // Hotfix 2 (A): opened from My trips (/my-trips/:id): the trip from that list, followed as it refreshes.
  const trips = useTripCard(id);
  const known = fromList ?? fromWaiting ?? trips.card;
  const [q, setQ] = useState<RequestCard | undefined>(known);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (known) {
      setQ(known);
      return;
    }
    if (list.loading || trips.waiting) return; // the list's answer arrives through known
    let alive = true;
    // An older server ignores `id` and answers every request: found among them the same way.
    void transport.call<RequestsList>("list_requests", { status: "all", id })
      .then((p) => {
        if (!alive) return;
        const found = p.requests.find((r) => r.id === id);
        if (found) setQ(found);
        else setErr("This request is not in your list: it is someone else's, or the link is wrong.");
      })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
  }, [id, transport, known, list.loading, trips.waiting]);
  return { q, err, setQ };
}

export function RequestDetail() {
  const { id = "" } = useParams();
  const { me, store, transport } = useFleet();
  const afterSave = useAfterSave();
  const toast = useToast();
  const { q, err } = useRequest(id);
  const trip = useTripLine(q);
  const [cancelReason, setCancelReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Withdraw's second step: the reason and the confirming button.
  const [withdrawing, setWithdrawing] = useState(false);
  const decides = me.tools.includes("decide_request");
  const cancels = me.tools.includes("cancel_request");
  const approver = me.permissions.includes("approve");
  // Hotfix 2 (A): back to My trips (its dates and filter) when opened from it, else to Requests.
  const home = useRequestsHome();

  async function cancel() {
    const r = cancelReason.trim();
    if (!r) {
      setMsg("Write the reason first. The person who asked and the driver will see it.");
      return;
    }
    setBusy(true);
    try {
      await transport.call("cancel_request", { request_id: id, reason: r });
      toast("Booking cancelled");
      void store.invalidate();
      afterSave(home);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  async function withdraw() {
    const v = withdrawInput(id, cancelReason);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      await transport.call("cancel_request", v.input);
      toast(q && isProposal(q) ? "Task withdrawn" : "Request withdrawn");
      void store.invalidate();
      afterSave(home);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  if (err) return <><PageTop title="Vehicle request" backTo={home} /><Notice tone="bad">{err}</Notice></>;
  if (!q) return <><PageTop title="Vehicle request" backTo={home} /><Loading>Loading the request…</Loading></>;
  const view = requestView(q, me);
  const task = isProposal(q);
  const p = view.proposal ? q.proposed : undefined;
  return (
    <div data-testid="request-detail">
      <PageTop
        title={task ? "Proposed task" : "Vehicle request"}
        sub={<Pill tone={requestTone(q.status)}>{cap(q.status || "waiting")}</Pill>}
        backTo={home}
        actions={(q.status === "waiting" || q.status === "changed") && decides ? <Link className="btn small dark" to={`/requests/${id}/decide`}>Review</Link> : undefined}
      />
      <div className="card card-b">
        <RequestHead q={q} proposal={view.proposal} />
        {q.late && <div style={{ marginTop: 12 }}><LateNotice approver={approver} /></div>}
        {q.status === "changed" && (
          <div className="notice" style={{ marginTop: 12 }} data-testid="changed-notice">
            <p><b>Changed{q.changed?.by ? ` by ${q.changed.by}` : ""}{q.changed?.at ? ` · ${q.changed.at}` : ""} · needs re-approval.</b> The booking keeps its old plan until the office decides again.</p>
            <ChangesList changes={q.changes} />
          </div>
        )}
        <dl className="kv" style={{ marginTop: 14 }}>
          <div><dt>When</dt><dd>{q.when}</dd></div>
          <div><dt>Back by</dt><dd>{q.back_by || "—"}</dd></div>
          <div><dt>Route</dt><dd>{joinDots([q.route || "—", q.stops_count && q.stops_count > 2 ? `${q.stops_count} stops` : ""])}</dd></div>
          {task
            ? <div><dt>Passengers</dt><dd>{p?.passengers ?? "—"}</dd></div>
            : <div><dt>Need</dt><dd>{q.need || "—"}</dd></div>}
          {/* Round 3: who drives, when it is not a driver of ours (the asker, someone else, the custodian). */}
          {(q.driven_by || q.driver_required === false) && !q.assigned && <div style={{ gridColumn: "1/-1" }}><dt>Who drives</dt><dd style={{ fontWeight: 400 }}><AskedWho q={q} /></dd></div>}
          {(p?.contact_name || p?.contact_phone) && <div><dt>Contact</dt><dd>{joinDots([p.contact_name, p.contact_phone])}</dd></div>}
          {p?.notes && <div style={{ gridColumn: "1/-1" }}><dt>Notes for the driver</dt><dd style={{ fontWeight: 400 }}>{p.notes}</dd></div>}
          {q.note && <div style={{ gridColumn: "1/-1" }}><dt>Note</dt><dd style={{ fontWeight: 400 }}>{q.note}</dd></div>}
          {q.decline_reason && <div style={{ gridColumn: "1/-1" }}><dt>Declined because</dt><dd>{q.decline_reason}</dd></div>}
          {q.cancel_reason && <div style={{ gridColumn: "1/-1" }}><dt>Cancelled because</dt><dd>{q.cancel_reason}</dd></div>}
        </dl>
        <Timeline q={q} />
        {/* Hotfix 2 (K): who decided it, with Call / WhatsApp (Call office when they have no number); who is reviewing it. */}
        <div style={{ marginTop: 12 }}><DecidedBy q={q} /></div>
        {approver && <ReviewingLine list={q.reviewing} block />}
        {!approver && !q.approved_by && q.office_phone?.call && (
          <div className="row" style={{ padding: 0, marginTop: 12 }} data-testid="office-contact">
            <span className="grow muted small">Questions about it? The fleet office.</span>
            <ContactButtons phone={q.office_phone} label="Call office" testId="call-office" />
          </div>
        )}
      </div>
      {q.assigned && <div style={{ marginTop: 18 }}><AssignedBlock a={q.assigned} /></div>}
      {(q.tell_requester || q.requester_phone) && <div style={{ marginTop: 18 }}><TellRequester key={`${q.id}-${q.version ?? 0}`} q={q} /></div>}
      {trip && <div style={{ marginTop: 18 }}><TripSection trip={trip} leaveNote={task ? "as proposed" : "the time asked for"} /></div>}
      {view.conflicts && q.status === "waiting" && !!(p?.warnings?.length || p?.conflicts?.length) && (
        <div className="notice" style={{ marginTop: 18 }} data-testid="proposal-checks">
          <p>
            <b>When it was proposed:</b>{" "}
            {[...(p?.warnings ?? []), ...(p?.conflicts ?? []).map((c) => c.text)].map((w, i) => <span key={i}>{i > 0 && <br />}{w}</span>)}
          </p>
        </div>
      )}
      <div className="acts">
        {q.task_id && canOpenTask(me) && <Link className="btn" to={`/tasks/${q.task_id}`}>Open the task →</Link>}
        {(q.status === "waiting" || q.status === "approved" || q.status === "changed") && me.tools.includes("update_request") && (approver || q.requested_by === me.name) && (
          <Link className="btn" to={`/requests/${id}/edit`}>Edit request</Link>
        )}
        {view.withdraw && !withdrawing && (
          <button type="button" className="btn" onClick={() => { setWithdrawing(true); setMsg(null); }}>Withdraw</button>
        )}
      </div>
      {view.withdraw && withdrawing && (
        <div className="confirm" data-testid="withdraw">
          <div className="field">
            <label htmlFor="rq-withdraw">Withdraw this {task ? "task" : "request"} with a reason</label>
            <input id="rq-withdraw" maxLength={300} placeholder="e.g. The trip is off" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
          </div>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div className="acts">
            <button type="button" className="btn" disabled={busy} onClick={() => { setWithdrawing(false); setMsg(null); }}>Keep it</button>
            <button type="button" className="btn dark" disabled={busy} onClick={() => void withdraw()}>{task ? "Withdraw the task" : "Withdraw the request"}</button>
          </div>
        </div>
      )}
      {q.status === "waiting" && (decides
        ? <Link className="btn dark" to={`/requests/${id}/decide`}>Approve or decline</Link>
        : <Notice tone="info">{task ? "The fleet admin will approve or decline this task. It is sent to the driver only when approved." : "The fleet office will approve or decline this request."}</Notice>)}
      {q.status === "changed" && (decides
        ? <Link className="btn dark" to={`/requests/${id}/decide`}>Decide the change</Link>
        : <Notice tone="info">The fleet office will keep, change or decline the changed booking.</Notice>)}
      {(q.status === "approved" || q.status === "changed") && cancels && approver && (
        <div className="confirm" style={{ borderColor: "var(--line)" }} data-testid="cancel-booking">
          <div className="field">
            <label htmlFor="rq-cancel">Cancel this booking with a reason</label>
            <input id="rq-cancel" maxLength={300} placeholder="e.g. The trip is off" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div className="acts"><button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>Cancel booking</button></div>
        </div>
      )}
    </div>
  );
}
