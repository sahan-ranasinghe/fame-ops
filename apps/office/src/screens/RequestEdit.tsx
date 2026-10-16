// Change a request (/requests/:id/edit, Phase 6): the person who asked (or an
// approver) changes the day and time, back-by, route and the time at From and
// To (Phase 7, §17), kind of vehicle, passengers, tools, note, whether a driver
// is needed and who it is for. A waiting request stays waiting; an approved
// booking becomes "changed" and needs re-approval (the approvers are told).
// Kept as a draft for this request.
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import type { UpdateRequestResult } from "../data/types";
import { cap, joinDots, requestTone } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice, Pill } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { LocationSearch } from "../ui/LocationSearch";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { useFleetSettings } from "./dispatchParts";
import { DwellPicker } from "./DwellPicker";
import { useRequest } from "./RequestDetail";
import { editFields, type RequestFields, updateRequestInput } from "./requestLogic";
import { typeDwell } from "./stopsLogic";

export function RequestEdit() {
  const { id = "" } = useParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const { q, err } = useRequest(id);
  const [f, setF, draft] = useFormDraft<RequestFields | null>("request-edit", id, null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const settings = useFleetSettings();
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const dwellSetting = settings.data?.settings.dwell_min;
  const set = <K extends keyof RequestFields>(k: K, v: RequestFields[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const was = q ? editFields(q) : null;

  // The form starts from the request once it is loaded (a draft resumed later replaces it).
  useEffect(() => {
    if (q && !f) draft.reset(editFields(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, q?.version]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!q || !f || !was) return;
    const v = updateRequestInput(id, q.version ?? 0, f, was);
    if ("error" in v) {
      setMsg(v.error);
      return;
    }
    setBusy(true);
    try {
      const r = await transport.call<UpdateRequestResult>("update_request", v.input);
      draft.clear();
      toast(r.needs_reapproval ? "Changed · the office will decide again" : "Request changed");
      void store.invalidate();
      navigate(`/requests/${id}`);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  if (err) return <section className="view"><PageTop title="Vehicle request" backTo={`/requests/${id}`} /><Notice tone="bad">{err}</Notice></section>;
  if (!q || !f) return <section className="view"><PageTop title="Vehicle request" backTo={`/requests/${id}`} /><Loading>Loading the request…</Loading></section>;
  const approver = me.permissions.includes("approve");
  const editable = (q.status === "waiting" || q.status === "approved" || q.status === "changed") && me.tools.includes("update_request") && (approver || q.requested_by === me.name);
  if (!editable) {
    return (
      <section className="view">
        <PageTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>} backTo={`/requests/${id}`} />
        <Notice tone="info">This request is {q.status === "waiting" || q.status === "approved" || q.status === "changed" ? "not yours to change" : q.status}. <Link to={`/requests/${id}`}>Open the request</Link>.</Notice>
      </section>
    );
  }
  return (
    <section className="view" data-testid="request-edit">
      <PageTop title="Change the request" sub={<>{q.requested_by} · {joinDots([q.when, q.route])}</>} backTo={`/requests/${id}`} />
      <DraftBanner draft={draft} />
      <form className="page-form" onSubmit={submit} noValidate>
        {q.status !== "waiting" && (
          <Notice tone="info">This booking is approved: your change needs re-approval. The office is told, and the booking keeps its old plan until they decide again.</Notice>
        )}
        <div className="card card-b form">
          <div className="field"><label htmlFor="re-behalf">On behalf of</label><input id="re-behalf" maxLength={120} value={f.behalf} onChange={(e) => set("behalf", e.target.value)} placeholder="Only when the vehicle is for someone else" /></div>
          <div className="grid2">
            <div className="field"><label htmlFor="re-date">Day</label><input type="date" id="re-date" value={f.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="field"><label htmlFor="re-time">Time</label><input type="time" id="re-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
            <div className="field"><label htmlFor="re-back">Back by</label><input type="time" id="re-back" value={f.back} onChange={(e) => set("back", e.target.value)} /></div>
            <div className="field"><label htmlFor="re-need">Vehicle</label>
              <select id="re-need" value={f.need} onChange={(e) => set("need", e.target.value)}>
                <option value="">Any</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="re-from">From</label><LocationSearch id="re-from" value={f.from} onText={(text) => set("from", text)} onPick={(p) => set("from", p.name)} />
              <DwellPicker id="re-from-dwell" value={f.fromDwell ?? ""} onChange={(v) => set("fromDwell", v)} fallback={{ min: typeDwell("pickup", dwellSetting), source: "either" }} />
            </div>
            <div className="field">
              <label htmlFor="re-to">To</label><LocationSearch id="re-to" value={f.to} onText={(text) => set("to", text)} onPick={(p) => set("to", p.name)} />
              <DwellPicker id="re-to-dwell" value={f.toDwell ?? ""} onChange={(v) => set("toDwell", v)} fallback={{ min: typeDwell("drop", dwellSetting), source: "either" }} />
            </div>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="re-pax">Passengers</label><input type="number" id="re-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
            <div className="field" style={{ alignContent: "end", gap: 8 }}>
              <span className="check"><input type="checkbox" id="re-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="re-tools">Tools or equipment go too</label></span>
              {selfDrive && <span className="check"><input type="checkbox" id="re-driver" checked={f.driver} onChange={(e) => set("driver", e.target.checked)} /> <label htmlFor="re-driver">A driver is needed</label></span>}
            </div>
          </div>
          <div className="field"><label htmlFor="re-note">Note</label><textarea id="re-note" maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></div>
        </div>
        {msg && <Notice tone="bad">{msg}</Notice>}
        <StickyActions>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : q.status === "waiting" ? "Save changes" : "Save · ask for re-approval"}</button>
        </StickyActions>
      </form>
    </section>
  );
}
