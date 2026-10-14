// One request, read only (/requests/:id): what was asked, its timeline, the
// decision or the cancellation; Review opens /requests/:id/decide (a changed
// booking too); Edit opens /requests/:id/edit for the person who asked (or an
// approver); an approved booking can be cancelled here with a reason (its task too).
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { RequestCard, RequestsList } from "../data/types";
import { cap, joinDots, requestTone } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { PageTop } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { ChangesList, Timeline } from "./requestParts";

/**
 * The request from the lists already loaded (followed as they refresh), else
 * from list_requests(all) once the list is not loading.
 */
export function useRequest(id: string): { q: RequestCard | undefined; err: string | null; setQ: (q: RequestCard) => void } {
  const { transport } = useFleet();
  const list = useEntry<RequestsList>("reqs");
  const fromList = list.data?.requests.find((r) => r.id === id);
  const fromWaiting = useEntry<RequestsList>("reqWaiting").data?.requests.find((r) => r.id === id);
  const known = fromList ?? fromWaiting;
  const [q, setQ] = useState<RequestCard | undefined>(known);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (known) {
      setQ(known);
      return;
    }
    if (list.loading) return; // the list's answer arrives through known
    let alive = true;
    void transport.call<RequestsList>("list_requests", { status: "all" })
      .then((p) => { if (alive) setQ(p.requests.find((r) => r.id === id)); })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); });
    return () => { alive = false; };
  }, [id, transport, known, list.loading]);
  return { q, err, setQ };
}

export function RequestDetail() {
  const { id = "" } = useParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const { q, err } = useRequest(id);
  const [cancelReason, setCancelReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decides = me.tools.includes("decide_request");
  const cancels = me.tools.includes("cancel_request");
  const approver = me.permissions.includes("approve");

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
      navigate("/requests");
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  if (err) return <><PageTop title="Vehicle request" backTo="/requests" /><Notice tone="bad">{err}</Notice></>;
  if (!q) return <><PageTop title="Vehicle request" backTo="/requests" /><Loading>Loading the request…</Loading></>;
  return (
    <div data-testid="request-detail">
      <PageTop
        title="Vehicle request"
        sub={<Pill tone={requestTone(q.status)}>{cap(q.status || "waiting")}</Pill>}
        backTo="/requests"
        actions={(q.status === "waiting" || q.status === "changed") && decides ? <Link className="btn small dark" to={`/requests/${id}/decide`}>Review</Link> : undefined}
      />
      <div className="card card-b">
        <div className="name" style={{ fontSize: 19 }}>{q.requested_by}{q.on_behalf_of ? <span className="muted"> · for {q.on_behalf_of}</span> : null}</div>
        <div className="sub">{joinDots([q.project, q.asked, q.one_step ? "booked directly by the office" : ""])}</div>
        {q.status === "changed" && (
          <div className="notice" style={{ marginTop: 12 }} data-testid="changed-notice">
            <p><b>Changed{q.changed?.by ? ` by ${q.changed.by}` : ""}{q.changed?.at ? ` · ${q.changed.at}` : ""} · needs re-approval.</b> The booking keeps its old plan until the office decides again.</p>
            <ChangesList changes={q.changes} />
          </div>
        )}
        <dl className="kv" style={{ marginTop: 14 }}>
          <div><dt>When</dt><dd>{q.when}</dd></div>
          <div><dt>Back by</dt><dd>{q.back_by || "—"}</dd></div>
          <div><dt>Route</dt><dd>{q.route || "—"}</dd></div>
          <div><dt>Need</dt><dd>{joinDots([q.need, q.driver_required === false ? "no driver · the custodian drives" : ""]) || "—"}</dd></div>
          {q.note && <div style={{ gridColumn: "1/-1" }}><dt>Note</dt><dd style={{ fontWeight: 400 }}>{q.note}</dd></div>}
          {q.decline_reason && <div style={{ gridColumn: "1/-1" }}><dt>Declined because</dt><dd>{q.decline_reason}</dd></div>}
          {q.cancel_reason && <div style={{ gridColumn: "1/-1" }}><dt>Cancelled because</dt><dd>{q.cancel_reason}</dd></div>}
        </dl>
        <Timeline q={q} />
      </div>
      <div className="acts">
        {q.task_id && me.tools.includes("task_detail") && <Link className="btn" to={`/tasks/${q.task_id}`}>Open the task</Link>}
        {(q.status === "waiting" || q.status === "approved" || q.status === "changed") && me.tools.includes("update_request") && (approver || q.requested_by === me.name) && (
          <Link className="btn" to={`/requests/${id}/edit`}>Edit request</Link>
        )}
      </div>
      {q.status === "waiting" && (decides
        ? <Link className="btn dark" to={`/requests/${id}/decide`}>Approve or decline</Link>
        : <Notice tone="info">The fleet office will approve or decline this request.</Notice>)}
      {q.status === "changed" && (decides
        ? <Link className="btn dark" to={`/requests/${id}/decide`}>Decide the change</Link>
        : <Notice tone="info">The fleet office will keep, change or decline the changed booking.</Notice>)}
      {(q.status === "approved" || q.status === "changed") && cancels && (
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
