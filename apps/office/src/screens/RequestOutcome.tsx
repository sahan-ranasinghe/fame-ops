// The request page once it is decided (Phase 7, §4, §35 19): who drives and in
// what (the driver's photo, name, phone with Call and WhatsApp, the plate and
// the vehicle's photo), and for a person who asked without an office account
// "Tell requester": the message for the trip's moment (approved, driver
// changed, on the way, arrived, cancelled) opened in WhatsApp, nothing sent by
// itself, with the requester's phone an approver can change on the page.
import { useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { PhoneLinks, RequestCard } from "../data/types";
import { asFleetError, errText } from "../transport/errors";
import { Avatar, Notice, Plate, VehicleThumb } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { linksFromCall } from "../ui/phoneLinks";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { phoneChange, TELL_MOMENT } from "./mediaLogic";

/** The driver's number with its links as the card carries them (call, whatsapp), or made from the number alone. */
export const assignedPhone = (a: Pick<NonNullable<RequestCard["assigned"]>, "phone" | "call" | "whatsapp">): PhoneLinks | null => linksFromCall(a);

/** Who drives and in what, with their photos. */
export function AssignedBlock({ a }: { a: NonNullable<RequestCard["assigned"]> }) {
  return (
    <div className="card card-b assigned" data-testid="assigned">
      <div className="section-t">Driver and vehicle</div>
      <div className="row" style={{ padding: 0 }}>
        <Avatar name={a.driver} src={a.photo_url} large />
        <div className="grow">
          <div className="name" style={{ fontSize: 18 }}>{a.driver}</div>
        </div>
        {/* Hotfix 2 (F): Call driver and WhatsApp driver (tel: and wa.me on a phone; the number, Copy and WhatsApp web on a computer). */}
        <ContactButtons phone={assignedPhone(a)} label="Call driver" testId="call-driver" />
      </div>
      <div className="assigned-vehicle">
        <VehicleThumb src={a.vehicle_photo_url ?? a.vehicle_thumb_url} plate={a.vehicle} size="md" />
        <div>
          {/* Hotfix 2 (J): no vehicle yet ("Vehicle: on the day", "Any van"). */}
          {a.vehicle ? <Plate v={a.vehicle} /> : a.vehicle_text ? <span data-testid="vehicle-text">{a.vehicle_text}</span> : null}
          {a.make_model && <div className="sub" style={{ marginTop: 4 }}>{a.make_model}</div>}
        </div>
      </div>
    </div>
  );
}

/** Tell requester (no office account: no pushes), and the requester's phone with Change for an approver. */
export function TellRequester({ q }: { q: RequestCard }) {
  const { me, transport, store } = useFleet();
  const toast = useToast();
  const tell = q.tell_requester;
  const editable = me.permissions.includes("approve") && me.tools.includes("update_request") && q.version != null &&
    (q.status === "waiting" || q.status === "approved" || q.status === "changed");
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(q.requester_phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!tell && !q.requester_phone) return null;

  async function save() {
    const change = phoneChange(phone, q.requester_phone);
    if (!change) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("update_request", { request_id: q.id, version: q.version, ...change });
      toast(change.requester_phone ? "Phone saved" : "Phone cleared");
      setEditing(false);
      void store.invalidate();
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
    }
    setBusy(false);
  }

  return (
    <div className="card card-b form" data-testid="tell-requester">
      <div className="section-t">Tell {q.requested_by}{tell ? ` · ${TELL_MOMENT[tell.moment] ?? tell.moment}` : ""}</div>
      {tell && (
        <>
          <p className="tell-msg" data-testid="tell-message">{tell.message}</p>
          <div className="acts">
            <a className="btn dark" href={tell.whatsapp} target="_blank" rel="noopener"><Icon name="chat" />Tell requester</a>
          </div>
          <p className="hint" style={{ margin: 0 }}>Opens WhatsApp with the message ready; nothing is sent until you send it.{q.requester_phone ? "" : " With no phone saved, WhatsApp asks whom to send it to."}</p>
        </>
      )}
      {!editing && (
        <div className="row" style={{ padding: 0 }}>
          <span className="grow">Requester's phone: <b className="mono">{q.requester_phone || "not saved"}</b></span>
          {editable && <button type="button" className="btn small" onClick={() => { setPhone(q.requester_phone ?? ""); setEditing(true); setMsg(null); }}>{q.requester_phone ? "Change" : "Add phone"}</button>}
        </div>
      )}
      {editing && (
        <div className="field">
          <label htmlFor="rq-phone">Requester's phone</label>
          <div className="acts">
            <input id="rq-phone" maxLength={30} inputMode="tel" placeholder="077 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ flex: "1 1 180px", width: "auto" }} autoFocus />
            <button type="button" className="btn dark" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setEditing(false); setMsg(null); }}>Cancel</button>
          </div>
          <span className="hint">Empty and Save clears it.</span>
        </div>
      )}
      {msg && <Notice tone="bad">{msg}</Notice>}
    </div>
  );
}
