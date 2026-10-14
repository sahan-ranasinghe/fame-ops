// One request: what was asked, its timeline (sent → seen → decided / cancelled),
// and for someone who approves: the free vehicles in four groups (the assigned
// ones say "ask first" with the custodian's links), the free drivers, Approve or
// Decline; an approved booking can be cancelled with a reason (its task too).
import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { DecideResult, RequestCard, RequestsList, SuggestedVehicle, Suggestions } from "../data/types";
import { cap, joinDots, requestTone, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DrawerTop, useDirty, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { GROUPS, VehicleOption } from "./NewRequestDrawer";
import { decisionInput, timelineSteps } from "./requestLogic";
import { TaskDrawer } from "./TaskDrawer";

/** The requester's timeline: sent → seen → decided / cancelled. */
export function Timeline({ q }: { q: RequestCard }) {
  return (
    <ol className="rq-timeline" data-testid="request-timeline">
      {timelineSteps(q).map((s) => (
        <li key={s.label} className={s.done ? "done" : ""}>
          <i className={`dot ${s.done ? "ok" : "muted"}`} />
          <span><b>{s.label}</b>{s.at ? <span className="sub" style={{ display: "block" }}>{s.at}</span> : null}</span>
        </li>
      ))}
    </ol>
  );
}

export function RequestDrawer({ id, mode }: { id: string; mode?: "decline" }) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const lists = useLists();
  const fromList = useEntry<RequestsList>("reqs").data?.requests.find((r) => r.id === id);
  const fromWaiting = useEntry<RequestsList>("reqWaiting").data?.requests.find((r) => r.id === id);
  const [q, setQ] = useState<RequestCard | undefined>(fromList ?? fromWaiting);
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [sugNote, setSugNote] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [reason, setReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  // A pick or a typed reason is unsaved input until the decision is made.
  const [touched, setTouched] = useState(false);
  useDirty(touched || reason.trim() !== "" || cancelReason.trim() !== "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const decides = me.tools.includes("decide_request");
  const suggests = me.tools.includes("suggest_vehicles");
  const cancels = me.tools.includes("cancel_request");

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!suggests) return;
      try {
        const p = await transport.call<Suggestions>("suggest_vehicles", { request_id: id });
        if (!alive) return;
        setSug(p);
        if (p.request) setQ(p.request);
      } catch (e) {
        if (alive) setSugNote("Suggestions are not available (" + errText(e as FleetError)[0] + "). Pick a vehicle and driver yourself.");
      }
    })();
    return () => { alive = false; };
  }, [id, transport, suggests]);

  const options: SuggestedVehicle[] = sug?.vehicles.length
    ? sug.vehicles
    : (lists.vehicles ?? []).map((v) => ({ reg_no: v.reg_no, make_model: v.make_model, seats: v.seats, availability: v.availability || v.status || "", pick: "good", assigned_to: v.assigned_to }));
  const drivers = sug?.drivers.length
    ? sug.drivers.map((d) => ({ u: d.username, name: d.name, label: d.availability }))
    : (lists.drivers ?? []).filter((d) => d.active !== false).map((d) => ({ u: d.username, name: d.name, label: "" }));
  const ready = sug !== null || sugNote !== null || !suggests;
  const picked = options.find((v) => v.reg_no === vehicle);
  const custodianDrives = q?.driver_required === false && !!picked?.assigned_to && sug?.self_drive_allowed !== false;

  useEffect(() => {
    if (!vehicle && options[0]) setVehicle(options[0].reg_no);
    if (!driver && drivers[0]) setDriver(drivers[0].u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, options.length, drivers.length]);

  async function decide(decision: "approve" | "decline") {
    const v = decisionInput({ id, decision, reason, vehicle, driver: custodianDrives ? "" : driver, decidedBy: me.name, custodianDrives });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<DecideResult>("decide_request", v.input);
      setTouched(false);
      setReason("");
      void store.invalidate();
      if (decision === "approve") {
        setMsg({
          tone: "ok",
          warnings: warnList(p),
          text: (
            <>
              <b>Approved.</b> {custodianDrives ? `${picked?.assigned_to} drives it.` : "The task is in the driver’s app."}{" "}
              {p.task_id && <button type="button" className="btn small" onClick={() => drawer.open(<TaskDrawer id={p.task_id!} />)}>Open task</button>}
            </>
          ),
        });
      } else {
        toast("Request declined");
        drawer.close();
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  async function cancel() {
    const r = cancelReason.trim();
    if (!r) {
      setMsg({ tone: "bad", text: "Write the reason first. The person who asked and the driver will see it." });
      return;
    }
    setBusy(true);
    try {
      await transport.call("cancel_request", { request_id: id, reason: r });
      setCancelReason("");
      toast("Booking cancelled");
      drawer.close();
      void store.invalidate();
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
      setBusy(false);
    }
  }

  if (!q) return <><DrawerTop title="Vehicle request" /><Loading>Loading the request…</Loading></>;
  const head = (
    <>
      <DrawerTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status || "waiting")}</Pill>} />
      <div className="card card-b">
        <div className="name" style={{ fontSize: 19 }}>{q.requested_by}</div>
        <div className="sub">{joinDots([q.project, q.asked, q.one_step ? "booked directly by the office" : ""])}</div>
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
    </>
  );
  if (q.status !== "waiting" || !decides) {
    return (
      <>
        {head}
        {q.task_id && me.tools.includes("task_detail") && <button type="button" className="btn" onClick={() => drawer.open(<TaskDrawer id={q.task_id!} />)}>Open the task</button>}
        {q.status === "waiting" && <Notice tone="info">The fleet office will approve or decline this request.</Notice>}
        {q.status === "approved" && cancels && (
          <div className="confirm" style={{ borderColor: "var(--line)" }} data-testid="cancel-booking">
            <div className="field">
              <label htmlFor="rq-cancel">Cancel this booking with a reason</label>
              <input id="rq-cancel" maxLength={300} placeholder="e.g. The trip is off" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="acts"><button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>Cancel booking</button></div>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {head}
      <div>
        {!ready ? <Loading>Finding free vehicles…</Loading> : (
          <>
            {sugNote && <div style={{ marginBottom: 12 }}><Notice>{sugNote}</Notice></div>}
            <div className="section-t" style={{ marginBottom: 10 }}>Pick a vehicle</div>
            <div className="form">
              {sug?.groups
                ? GROUPS.map(([key, label]) => {
                  const rows = sug.groups![key];
                  if (rows.length === 0) return null;
                  return (
                    <div key={key} className="form" data-testid={`group-${key}`}>
                      <div className="lab">{label}</div>
                      {rows.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={vehicle === v.reg_no} onPick={() => { setVehicle(v.reg_no); setTouched(true); }} />)}
                    </div>
                  );
                })
                : options.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={vehicle === v.reg_no} onPick={() => { setVehicle(v.reg_no); setTouched(true); }} />)}
              {options.length === 0 && <Empty>No vehicles registered yet.</Empty>}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="rq-driver">Driver</label>
              {custodianDrives
                ? <p className="muted small" style={{ margin: 0 }} id="rq-driver">{picked?.assigned_to} drives it: no driver needed.</p>
                : (
                  <select id="rq-driver" value={driver} onChange={(e) => { setDriver(e.target.value); setTouched(true); }}>
                    {drivers.map((d) => <option key={d.u} value={d.u}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
                  </select>
                )}
            </div>
          </>
        )}
      </div>
      <div className="confirm" style={{ borderColor: "var(--line)" }}>
        <div className="field">
          <label htmlFor="rq-reason">Decline with a reason</label>
          <input id="rq-reason" maxLength={300} placeholder="e.g. No van free that morning" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={mode === "decline"} />
        </div>
        {msg && <div><Notice tone={msg.tone}>{msg.text}</Notice>{msg.warnings && <WarningsNote warnings={msg.warnings} />}</div>}
        <div className="acts">
          <button type="button" className="btn" disabled={busy} onClick={() => void decide("decline")}>Decline</button>
          <button type="button" className="btn dark" disabled={busy || !ready} onClick={() => void decide("approve")}>{custodianDrives ? "Approve" : "Approve & send to driver"}</button>
        </div>
      </div>
    </>
  );
}
