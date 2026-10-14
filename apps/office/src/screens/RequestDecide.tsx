// Decide a request (/requests/:id/decide): the free vehicles in four groups
// (the assigned ones say "ask first" with the custodian's links), the free
// drivers, Approve (& send to the driver) or Decline with a reason. The pick
// and the reason are kept as a draft for this request.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { DecideResult, SuggestedVehicle, Suggestions } from "../data/types";
import { cap, joinDots, requestTone, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { RequestDetailCard } from "./RequestDetailCard";
import { useRequest } from "./RequestDetail";
import { decisionInput } from "./requestLogic";
import { VehicleGroups, VehicleOption } from "./requestParts";

interface Decision {
  vehicle: string;
  driver: string;
  reason: string;
}

export function RequestDecide() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const lists = useLists();
  const { q, err, setQ } = useRequest(id);
  const [f, setF, draft] = useFormDraft<Decision>("request-decide", id, { vehicle: "", driver: "", reason: "" });
  const [sug, setSug] = useState<Suggestions | null>(null);
  const [sugNote, setSugNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const suggests = me.tools.includes("suggest_vehicles");
  const set = <K extends keyof Decision>(k: K, v: Decision[K]) => setF((x) => ({ ...x, [k]: v }));

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
    if (!f.vehicle && options[0]) set("vehicle", options[0].reg_no);
    if (!f.driver && drivers[0]) set("driver", drivers[0].u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, options.length, drivers.length]);

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

  if (err) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Notice tone="bad">{err}</Notice></section>;
  if (!q) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Loading>Loading the request…</Loading></section>;
  if (q.status !== "waiting" || !me.tools.includes("decide_request")) {
    return (
      <section className="view">
        <PageTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>} backTo={`/requests/${id}`} />
        <Notice tone="info">This request is {q.status}; there is nothing to decide. <Link to={`/requests/${id}`}>Open the request</Link>.</Notice>
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
