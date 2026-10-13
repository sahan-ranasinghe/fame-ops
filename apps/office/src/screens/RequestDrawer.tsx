import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { DecideResult, RequestCard, RequestsList, Suggestions } from "../data/types";
import { availabilityTone, cap, joinDots, requestTone, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DrawerTop, useDirty, useDrawer } from "../ui/Drawer";
import { useToast } from "../ui/Toast";
import { decisionInput } from "./requestLogic";
import { TaskDrawer } from "./TaskDrawer";

interface Option {
  plate: string;
  desc: string;
  label: string;
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
  // A pick or a typed reason is unsaved input until the decision is made.
  const [touched, setTouched] = useState(false);
  useDirty(touched || reason.trim() !== "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const decides = me.tools.includes("decide_request");
  const suggests = me.tools.includes("suggest_vehicles");

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!suggests) return;
      try {
        const p = await transport.call<Suggestions>("suggest_vehicles", { request_id: id });
        if (!alive) return;
        setSug(p);
        setQ(p.request);
      } catch (e) {
        if (alive) setSugNote("Suggestions are not available (" + errText(e as FleetError)[0] + "). Pick a vehicle and driver yourself.");
      }
    })();
    return () => { alive = false; };
  }, [id, transport, suggests]);

  const vehicles: Option[] = sug?.vehicles.length
    ? sug.vehicles.map((v) => ({ plate: v.reg_no, desc: joinDots([v.make_model, v.seats ? `${v.seats} seats` : ""]), label: joinDots([v.availability, v.but]) }))
    : (lists.vehicles ?? []).map((v) => ({ plate: v.reg_no, desc: joinDots([v.make_model, v.seats ? `${v.seats} seats` : ""]), label: v.status || "" }));
  const drivers = sug?.drivers.length
    ? sug.drivers.map((d) => ({ u: d.username, name: d.name, label: d.availability }))
    : (lists.drivers ?? []).filter((d) => d.active !== false).map((d) => ({ u: d.username, name: d.name, label: "" }));
  const ready = sug !== null || sugNote !== null || !suggests;

  useEffect(() => {
    if (!vehicle && vehicles[0]) setVehicle(vehicles[0].plate);
    if (!driver && drivers[0]) setDriver(drivers[0].u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, vehicles.length, drivers.length]);

  async function decide(decision: "approve" | "decline") {
    const v = decisionInput({ id, decision, reason, vehicle, driver, decidedBy: me.name });
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
              <b>Approved.</b> The task is in the driver’s app.{" "}
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

  if (!q) return <><DrawerTop title="Vehicle request" /><Loading>Loading the request…</Loading></>;
  const head = (
    <>
      <DrawerTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status || "waiting")}</Pill>} />
      <div className="card card-b">
        <div className="name" style={{ fontSize: 19 }}>{q.requested_by}</div>
        <div className="sub">{joinDots([q.project, q.asked])}</div>
        <dl className="kv" style={{ marginTop: 14 }}>
          <div><dt>When</dt><dd>{q.when}</dd></div>
          <div><dt>Back by</dt><dd>{q.back_by || "—"}</dd></div>
          <div><dt>Route</dt><dd>{q.route || "—"}</dd></div>
          <div><dt>Need</dt><dd>{q.need || "—"}</dd></div>
          {q.note && <div style={{ gridColumn: "1/-1" }}><dt>Note</dt><dd style={{ fontWeight: 400 }}>{q.note}</dd></div>}
          {q.decline_reason && <div style={{ gridColumn: "1/-1" }}><dt>Declined because</dt><dd>{q.decline_reason}</dd></div>}
        </dl>
      </div>
    </>
  );
  if (q.status !== "waiting" || !decides) {
    return (
      <>
        {head}
        {q.task_id && me.tools.includes("task_detail") && <button type="button" className="btn" onClick={() => drawer.open(<TaskDrawer id={q.task_id!} />)}>Open the task</button>}
        {q.status === "waiting" && <Notice tone="info">The fleet office will approve or decline this request.</Notice>}
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
              {vehicles.length ? vehicles.map((v) => (
                <label className="opt" key={v.plate}>
                  <input type="radio" name="rq-veh" value={v.plate} checked={vehicle === v.plate} onChange={() => { setVehicle(v.plate); setTouched(true); }} />
                  <span className="grow">
                    <span className="plate">{v.plate}</span>
                    <span className={`sub ${availabilityTone(v.label)}`} style={{ display: "block", marginTop: 4 }}>{joinDots([v.desc, v.label])}</span>
                  </span>
                </label>
              )) : <Empty>No vehicles registered yet.</Empty>}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="rq-driver">Driver</label>
              <select id="rq-driver" value={driver} onChange={(e) => { setDriver(e.target.value); setTouched(true); }}>
                {drivers.map((d) => <option key={d.u} value={d.u}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
              </select>
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
          <button type="button" className="btn dark" disabled={busy || !ready} onClick={() => void decide("approve")}>Approve &amp; send to driver</button>
        </div>
      </div>
    </>
  );
}
