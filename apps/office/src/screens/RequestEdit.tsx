// Change a request (/requests/:id/edit, Phase 6): the person who asked (or an
// approver) changes the trip in the trip editor of Assign a task (Phase 7,
// §34: the day, the leave-by time, back by, Start from, the stops with their
// times there, the plan with its map), the kind of vehicle, passengers, tools,
// note, whether a driver is needed and who it is for. An older request (From
// and To only) opens with two stops, a pickup at From and a drop at To. A
// waiting request stays waiting; an approved booking becomes "changed" and
// needs re-approval (the approvers are told). Kept as a draft for this request.
// Phase 7 (§4): an approver may give or change the requester's phone.
// Round 4–7 (6): Who rides (ui/PassengersField) beside the passenger count: changed names go as passenger_list (names alone
// need no re-approval on the server); hidden with the passengers switch off.
// Round 3: "Who drives?" (ui/WhoDrives) in place of "A driver is needed"; on someone else's request (an approver
// changing it) the second choice is "<their first name> drives", as the server takes the asker as the one who drives.
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { type DraftControls, useFormDraft } from "../data/drafts";
import type { RequestCard, UpdateRequestResult } from "../data/types";
import { joinDots } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Loading, Notice } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { SuggestFor } from "../ui/LocationSearch";
import { PageTop, StickyActions, useAfterSave } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { MyLicenceNote, WhoDrives } from "../ui/WhoDrives";
import { PassengersField } from "../ui/PassengersField";
import { passengersOn } from "./passengersLogic";
import { selfLabel } from "../ui/whoDrivesLogic";
import { basePlace, useFleetSettings } from "./dispatchParts";
import { useRequest } from "./RequestDetail";
import { editFields, type RequestFields, updateRequestInput, whoOf } from "./requestLogic";
import { TripEditor, useTrip } from "./TripEditor";
import { RequestStatusPill } from "./requestParts";
import { tripPlanInput } from "./tripLogic";

export function RequestEdit() {
  const { id = "" } = useParams();
  const { me } = useFleet();
  const { q, err } = useRequest(id);
  // The draft's key changed with the trip (§34): an older draft (From and To) is not offered.
  const [f, setF, draft] = useFormDraft<RequestFields | null>("request-trip-edit", id, null);

  // The form starts from the request once it is loaded (a draft resumed later replaces it).
  useEffect(() => {
    if (q && !f) draft.reset(editFields(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id, q?.version]);

  if (err) return <section className="view"><PageTop title="Vehicle request" backTo={`/requests/${id}`} /><Notice tone="bad">{err}</Notice></section>;
  if (!q || !f) return <section className="view"><PageTop title="Vehicle request" backTo={`/requests/${id}`} /><Loading>Loading the request…</Loading></section>;
  const approver = me.permissions.includes("approve");
  const editable = (q.status === "waiting" || q.status === "approved" || q.status === "changed") && me.tools.includes("update_request") && (approver || q.requested_by === me.name);
  if (!editable) {
    return (
      <section className="view">
        <PageTop title="Vehicle request" sub={<RequestStatusPill status={q.status} />} backTo={`/requests/${id}`} />
        <Notice tone="info">This request is {q.status === "waiting" || q.status === "approved" || q.status === "changed" ? "not yours to change" : q.status}. <Link to={`/requests/${id}`}>Open the request</Link>.</Notice>
      </section>
    );
  }
  return <EditForm id={id} q={q} f={f} setF={setF} draft={draft} />;
}

/** The form itself, once the request and its fields are loaded (the trip's plan needs them). */
function EditForm({ id, q, f, setF, draft }: {
  id: string;
  q: RequestCard;
  f: RequestFields;
  setF: Dispatch<SetStateAction<RequestFields | null>>;
  draft: DraftControls<RequestFields | null>;
}) {
  const { me, store, transport } = useFleet();
  const afterSave = useAfterSave();
  const toast = useToast();
  const approver = me.permissions.includes("approve");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const settings = useFleetSettings();
  const selfDrive = settings.data?.settings.self_drive_allowed !== false;
  const riding = passengersOn(settings.data);
  const base = basePlace(settings.data);
  const set = <K extends keyof RequestFields>(k: K, v: RequestFields[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  // The request as loaded: only what differs from it is sent.
  const was = useMemo(() => editFields(q), [q]);
  // An empty leave-by stays empty here: the request is then planned from the stops' arrive-by times.
  const trip = useTrip(f, (fn) => setF((x) => (x ? fn(x) : x)), { base, settings: settings.data, planInput: tripPlanInput(f, base) });

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    // The passengers switch off: the names are left as they are.
    const v = updateRequestInput(id, q.version ?? 0, riding ? f : { ...f, riders: undefined }, was, base);
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
      afterSave(`/requests/${id}`);
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
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
          {approver && (
            <div className="field">
              <label htmlFor="re-phone">Requester's phone</label>
              <input id="re-phone" maxLength={30} inputMode="tel" placeholder="077 123 4567" value={f.requesterPhone ?? ""} onChange={(e) => set("requesterPhone", e.target.value)} />
              <span className="hint">Optional. For someone without a Fame Fleet account: Tell requester sends them the news on WhatsApp. Empty clears it.</span>
            </div>
          )}
        </div>

        {/* Round 4–7 (item 10): someone else's request: the place boxes offer the requester's recent places too. */}
        <SuggestFor request={q.requested_by !== me.name ? id : undefined}><TripEditor trip={trip} prefix="re" /></SuggestFor>

        <div className="card card-b form">
          <div className="grid2">
            <div className="field"><label htmlFor="re-need">Vehicle</label>
              <select id="re-need" value={f.need} onChange={(e) => set("need", e.target.value)}>
                <option value="">Any</option><option value="car">Car</option><option value="van">Van</option><option value="double_cab">Double cab</option><option value="lorry">Lorry</option><option value="other">Other</option>
              </select>
            </div>
            <div className="field"><label htmlFor="re-pax">Passengers</label><input type="number" id="re-pax" min={0} max={80} inputMode="numeric" value={f.pax} onChange={(e) => set("pax", e.target.value)} /></div>
          </div>
          {riding && <PassengersField id="re" value={f.riders ?? []} onChange={(r) => set("riders", r)} count={f.pax} />}
          <div className="field" style={{ gap: 8 }}>
            <span className="check"><input type="checkbox" id="re-tools" checked={f.tools} onChange={(e) => set("tools", e.target.checked)} /> <label htmlFor="re-tools">Tools or equipment go too</label></span>
          </div>
          <WhoDrives id="re" value={whoOf(f)} onChange={(w) => set("who", w)} hidden={!selfDrive || transport.kind === "claude"} selfWords={selfLabel(q.requested_by, me.name)}
            selfNote={q.requested_by === me.name ? <MyLicenceNote /> : undefined} />
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
