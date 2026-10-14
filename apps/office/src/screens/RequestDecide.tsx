// Decide a request (/requests/:id/decide). A waiting one: the free vehicles in
// four groups (the assigned ones say "ask first" with the custodian's links),
// who's available, Approve (& send to the driver) or Decline with a reason.
// An approved booking (changed by the requester, or not): what changed, who's
// available, Keep as asked / Change the vehicle, driver or time / Decline with
// a reason (Phase 6). The pick and the reason are kept as a draft.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { DecideResult, RedecideResult, SuggestedVehicle, Suggestions } from "../data/types";
import { cap, joinDots, requestTone, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { availabilityArgs } from "./availabilityLogic";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { RequestDetailCard } from "./RequestDetailCard";
import { useRequest } from "./RequestDetail";
import { decisionInput, redecideInput } from "./requestLogic";
import { VehicleGroups, VehicleOption } from "./requestParts";

interface Decision {
  vehicle: string;
  driver: string;
  reason: string;
  /** The redecision's own changes (Change): a new day, time or back-by. */
  date: string;
  time: string;
  back: string;
}

export function RequestDecide() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const lists = useLists();
  const { q, err, setQ } = useRequest(id);
  const [f, setF, draft] = useFormDraft<Decision>("request-decide", id, { vehicle: "", driver: "", reason: "", date: "", time: "", back: "" });
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [sugNote, setSugNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const suggests = me.tools.includes("suggest_vehicles");
  const set = <K extends keyof Decision>(k: K, v: Decision[K]) => setF((x) => ({ ...x, [k]: v }));
  const again = q?.status === "approved" || q?.status === "changed";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, transport, suggests]);

  const options: SuggestedVehicle[] = sug?.vehicles.length
    ? sug.vehicles
    : (lists.vehicles ?? []).map((v) => ({ reg_no: v.reg_no, make_model: v.make_model, seats: v.seats, availability: v.availability || v.status || "", pick: "good", assigned_to: v.assigned_to }));
  const drivers = sug?.drivers.length
    ? sug.drivers.map((d) => ({ u: d.username, name: d.name, label: d.availability }))
    : (lists.drivers ?? []).filter((d) => d.active !== false).map((d) => ({ u: d.username, name: d.name, label: "" }));
  const ready = sug !== null || sugNote !== null || !suggests;
  const picked = options.find((v) => v.reg_no === f.vehicle);
  const custodianDrives = q?.driver_required === false && !!picked?.assigned_to && sug?.self_drive_allowed !== false;

  useEffect(() => {
    if (again) return; // deciding again: "keep" needs no pick; a pick is a change
    if (!f.vehicle && options[0]) set("vehicle", options[0].reg_no);
    if (!f.driver && drivers[0]) set("driver", drivers[0].u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, options.length, drivers.length, again]);

  async function decide(decision: "approve" | "decline") {
    const v = decisionInput({ id, decision, reason: f.reason, vehicle: f.vehicle, driver: custodianDrives ? "" : f.driver, decidedBy: me.name, custodianDrives });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<DecideResult>("decide_request", v.input);
      draft.clear();
      void store.invalidate();
      if (decision === "approve") {
        setMsg({
          tone: "ok",
          warnings: warnList(p),
          text: (
            <>
              <b>Approved.</b> {custodianDrives ? `${picked?.assigned_to} drives it.` : "The task is in the driver’s app."}{" "}
              {p.task_id && <Link className="btn small" to={`/tasks/${p.task_id}`}>Open task</Link>}{" "}
              <Link className="btn small" to={`/requests/${id}`}>The request</Link>
            </>
          ),
        });
      } else {
        toast("Request declined");
        navigate("/requests");
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  async function redecide(decision: "keep" | "change" | "decline") {
    if (!q) return;
    const was = q.fields ? { date: q.fields.date, time: q.fields.time, back: q.fields.back_by ?? "" } : undefined;
    const v = redecideInput({ id, version: q.version ?? 0, decision, reason: f.reason, vehicle: f.vehicle, driver: f.driver, date: f.date, time: f.time, back: f.back || was?.back, was });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<RedecideResult>("redecide_request", v.input);
      draft.clear();
      void store.invalidate();
      if (decision === "decline") {
        toast("Request declined · the booking is cancelled");
        navigate(`/requests/${id}`);
      } else {
        setMsg({
          tone: "ok",
          warnings: warnList(p),
          text: (
            <>
              <b>{p.decision === "kept" ? "Kept as asked." : p.decision === "postponed" ? "Postponed." : "Changed."}</b> {p.sent}{" "}
              {p.task?.task_id && <Link className="btn small" to={`/tasks/${p.task.task_id}`}>Open task</Link>}{" "}
              <Link className="btn small" to={`/requests/${id}`}>The request</Link>
            </>
          ),
        });
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
    }
    setBusy(false);
  }

  if (err) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Notice tone="bad">{err}</Notice></section>;
  if (!q) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Loading>Loading the request…</Loading></section>;
  const decides = me.tools.includes("decide_request");
  const redecides = me.tools.includes("redecide_request");
  if ((q.status !== "waiting" && !again) || (q.status === "waiting" && !decides) || (again && !redecides)) {
    return (
      <section className="view">
        <PageTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>} backTo={`/requests/${id}`} />
        <Notice tone="info">This request is {q.status}; there is nothing to decide. <Link to={`/requests/${id}`}>Open the request</Link>.</Notice>
      </section>
    );
  }
  const availArgs = q.fields ? availabilityArgs(f.date || q.fields.date, f.time || q.fields.time, f.back || q.fields.back_by, q.fields.need_type, q.fields.pax == null ? "" : String(q.fields.pax)) : null;

  if (again) {
    return (
      <section className="view" data-testid="request-redecide">
        <PageTop title={q.status === "changed" ? "Decide the change" : "Change the booking"} sub={<>{q.requested_by} · {joinDots([q.when, q.route])}</>} backTo={`/requests/${id}`} />
        <DraftBanner draft={draft} />
        <div className="page-form">
          <RequestDetailCard q={q} compact />
          <div className="card card-b form">
            <div className="section-t" style={{ marginBottom: 2 }}>Change the vehicle, the driver or the time</div>
            <p className="muted small" style={{ margin: 0 }}>Leave everything as it is and press Keep to approve the booking as it now asks.</p>
            {sugNote && <Notice>{sugNote}</Notice>}
            {!ready ? <Loading>Finding free vehicles…</Loading> : (
              <>
                <div className="lab">Vehicle</div>
                <label className="opt"><input type="radio" name="rq-veh" value="" checked={f.vehicle === ""} onChange={() => set("vehicle", "")} /><span className="grow">Keep the vehicle</span></label>
                {sug?.groups
                  ? <VehicleGroups sug={sug} name="rq-veh" vehicle={f.vehicle} onPick={(reg) => set("vehicle", reg)} />
                  : options.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={f.vehicle === v.reg_no} onPick={() => set("vehicle", v.reg_no)} />)}
              </>
            )}
            <div className="field">
              <label htmlFor="rq-driver">Driver</label>
              <select id="rq-driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}>
                <option value="">Keep the driver</option>
                {drivers.map((d) => <option key={d.u} value={d.u}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
              </select>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="rq-date">Day</label><input type="date" id="rq-date" value={f.date} placeholder={q.fields?.date} onChange={(e) => set("date", e.target.value)} /></div>
              <div className="field"><label htmlFor="rq-time">Time</label><input type="time" id="rq-time" value={f.time} onChange={(e) => set("time", e.target.value)} /></div>
              <div className="field"><label htmlFor="rq-back">Back by</label><input type="time" id="rq-back" value={f.back} onChange={(e) => set("back", e.target.value)} /></div>
            </div>
            <p className="hint" style={{ margin: 0 }}>Now {q.when}{q.back_by ? ` · back by ${q.back_by}` : ""}. A new time alone postpones the booking.</p>
          </div>
          <AvailabilityPanel args={availArgs} picked={f.driver} onPick={(d) => { if (d.username) set("driver", d.username); }} />
          <div className="confirm" style={{ borderColor: "var(--line)" }}>
            <div className="field">
              <label htmlFor="rq-reason">Decline with a reason</label>
              <input id="rq-reason" maxLength={300} placeholder="e.g. No van free that morning" value={f.reason} onChange={(e) => set("reason", e.target.value)} autoFocus={params.get("mode") === "decline"} />
            </div>
            {msg && <div><Notice tone={msg.tone}>{msg.text}</Notice>{msg.warnings && <WarningsNote warnings={msg.warnings} />}</div>}
            <StickyActions>
              <button type="button" className="btn" disabled={busy} onClick={() => void redecide("decline")}>Decline</button>
              <button type="button" className="btn" disabled={busy} onClick={() => void redecide("change")}>Change</button>
              <button type="button" className="btn dark" disabled={busy} onClick={() => void redecide("keep")}>Keep as asked</button>
            </StickyActions>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view" data-testid="request-decide">
      <PageTop title="Decide the request" sub={<>{q.requested_by} · {joinDots([q.when, q.route])}</>} backTo={`/requests/${id}`} />
      <DraftBanner draft={draft} />
      <div className="page-form">
        <RequestDetailCard q={q} compact />
        {!ready ? <Loading>Finding free vehicles…</Loading> : (
          <div className="card card-b form">
            {sugNote && <Notice>{sugNote}</Notice>}
            <div className="section-t" style={{ marginBottom: 2 }}>Pick a vehicle</div>
            {sug?.groups
              ? <VehicleGroups sug={sug} name="rq-veh" vehicle={f.vehicle} onPick={(reg) => set("vehicle", reg)} />
              : options.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={f.vehicle === v.reg_no} onPick={() => set("vehicle", v.reg_no)} />)}
            {options.length === 0 && <Empty>No vehicles registered yet.</Empty>}
            <div className="field">
              <label htmlFor="rq-driver">Driver</label>
              {custodianDrives
                ? <p className="muted small" style={{ margin: 0 }} id="rq-driver">{picked?.assigned_to} drives it: no driver needed.</p>
                : (
                  <select id="rq-driver" value={f.driver} onChange={(e) => set("driver", e.target.value)}>
                    {drivers.map((d) => <option key={d.u} value={d.u}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
                  </select>
                )}
            </div>
          </div>
        )}
        {!custodianDrives && <AvailabilityPanel args={availArgs} picked={f.driver} onPick={(d) => { if (d.username) set("driver", d.username); }} />}
        <div className="confirm" style={{ borderColor: "var(--line)" }}>
          <div className="field">
            <label htmlFor="rq-reason">Decline with a reason</label>
            <input id="rq-reason" maxLength={300} placeholder="e.g. No van free that morning" value={f.reason} onChange={(e) => set("reason", e.target.value)} autoFocus={params.get("mode") === "decline"} />
          </div>
          {msg && <div><Notice tone={msg.tone}>{msg.text}</Notice>{msg.warnings && <WarningsNote warnings={msg.warnings} />}</div>}
          <StickyActions>
            <button type="button" className="btn" disabled={busy} onClick={() => void decide("decline")}>Decline</button>
            <button type="button" className="btn dark" disabled={busy || !ready} onClick={() => void decide("approve")}>{custodianDrives ? "Approve" : "Approve & send to driver"}</button>
          </StickyActions>
        </div>
      </div>
    </section>
  );
}
