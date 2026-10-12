import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { TaskDetail } from "../data/types";
import { cap, hhmm, joinDots, num, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DrawerTop, useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";

const TONE = { assigned: "warn", in_progress: "live", completed: "ok", cancelled: "bad" } as const;

export function TaskDrawer({ id }: { id: string }) {
  const { me, store, transport } = useFleet();
  const drawer = useDrawer();
  const toast = useToast();
  const lists = useLists();
  const [p, setP] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ra, setRa] = useState({ driver: "", vehicle: "", date: "", time: "" });
  const [raMsg, setRaMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [cxMsg, setCxMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setP(await transport.call<TaskDetail>("task_detail", { task_id: id }));
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (err) return <><DrawerTop title="Task" /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><DrawerTop title="Task" /><Loading>Loading the task…</Loading></>;

  const t = p.task;
  const c = t.contact ?? {};
  const km = t.km ?? (t.end_odometer_km != null && t.start_odometer_km != null ? t.end_odometer_km - t.start_odometer_km : null);
  const projects = typeof p.projects === "string" ? p.projects : p.projects.map((x) => joinDots([x.project, x.percent != null ? `${x.percent}%` : ""])).join(", ");
  const canChange = t.status === "assigned" && me.tools.includes("reassign_task");
  const canCancel = (t.status === "assigned" || t.status === "in_progress") && me.tools.includes("cancel_task");

  async function reassign(ev: FormEvent) {
    ev.preventDefault();
    const input: Record<string, unknown> = { task_id: id };
    if (ra.driver) input.driver = ra.driver;
    if (ra.vehicle) input.vehicle = ra.vehicle;
    if (ra.date) input.date = ra.date;
    if (ra.time) input.start_time = ra.time;
    if (Object.keys(input).length === 1) {
      setRaMsg("Choose what to change first.");
      return;
    }
    setBusy(true);
    try {
      const out = await transport.call("reassign_task", input);
      toast("Task changed");
      setRaMsg(null);
      setRa({ driver: "", vehicle: "", date: "", time: "" });
      setWarnings(warnList(out));
      void store.invalidate();
      await load();
    } catch (e) {
      setRaMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }

  async function cancel() {
    if (!reason.trim()) {
      setCxMsg("Write the reason first. The driver sees it.");
      return;
    }
    setBusy(true);
    try {
      await transport.call("cancel_task", { task_id: id, reason: reason.trim() });
      toast("Task cancelled");
      void store.invalidate();
      drawer.close();
    } catch (e) {
      setCxMsg(errText(e as FleetError)[0]);
      setBusy(false);
    }
  }

  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const ext = { target: "_blank", rel: "noopener" } as const;

  return (
    <>
      <DrawerTop title={t.title || "Task"} sub={<><Pill tone={TONE[t.status] ?? ""}>{cap(t.status)}</Pill> <span className="mono">{t.start}</span></>} />
      <div className="card card-b">
        <dl className="kv">
          <div><dt>Driver</dt><dd>{t.driver || "—"}</dd></div>
          <div><dt>Vehicle</dt><dd>{t.vehicle || "—"}</dd></div>
          <div><dt>Status</dt><dd>{t.status_line || cap(t.status)}</dd></div>
          <div><dt>Passengers</dt><dd>{t.passengers ?? "—"}</dd></div>
          <div>
            <dt>Contact</dt>
            <dd>
              {joinDots([c.name, c.phone]) || "—"}
              {(c.call || c.whatsapp) && (
                <div className="acts" style={{ marginTop: 6 }}>
                  {c.call && <a className="btn small" href={c.call}>Call</a>}
                  {c.whatsapp && <a className="btn small" href={c.whatsapp} {...ext}>WhatsApp</a>}
                </div>
              )}
            </dd>
          </div>
          <div><dt>Charged to</dt><dd>{projects || "Fame internal"}</dd></div>
          <div><dt>Sent · seen</dt><dd className="mono">{joinDots([hhmm(t.sent), t.seen === "not opened yet" ? "not opened yet" : hhmm(t.seen)]) || "—"}</dd></div>
          <div><dt>Started · done</dt><dd className="mono">{joinDots([hhmm(t.started), hhmm(t.completed)]) || "—"}</dd></div>
          <div><dt>Odometer</dt><dd className="num">{t.start_odometer_km != null ? num(t.start_odometer_km) : "—"}{t.end_odometer_km != null ? " → " + num(t.end_odometer_km) : ""}</dd></div>
          <div><dt>Km this task</dt><dd className="num">{km != null ? num(km) + " km" : "—"}{t.gps_km != null ? <span className="muted"> · GPS {num(t.gps_km)} km</span> : null}</dd></div>
          {t.created_by && <div><dt>Assigned by</dt><dd>{t.created_by}</dd></div>}
          {t.cancelled_reason && <div><dt>Cancelled because</dt><dd>{t.cancelled_reason}</dd></div>}
          {t.notes && <div style={{ gridColumn: "1/-1" }}><dt>Notes</dt><dd style={{ fontWeight: 400 }}>{t.notes}</dd></div>}
        </dl>
      </div>
      {p.unlogged_km && (
        <Notice>
          {num(p.unlogged_km.km)} km were driven before this task that nobody logged (last reading {num(p.unlogged_km.last_logged_km)} km at {p.unlogged_km.last_logged_at}, this task started at {num(p.unlogged_km.start_km)} km).
        </Notice>
      )}
      <WarningsNote warnings={warnings} />

      <div className="section-t">Stops</div>
      <div className="card">
        <div className="rows">
          {p.stops.length ? p.stops.map((s) => (
            <div className="row" key={s.seq}>
              <span className={`dot ${s.status === "done" ? "ok" : s.status === "skipped" ? "bad" : "warn"}`} />
              <div className="grow">
                <div className="name">{cap(s.type)} · {s.place || s.address || ""}</div>
                <div className="sub">{cap(s.status)}{s.arrived ? " · arrived " + s.arrived : ""}{s.done ? " · done " + s.done : ""}</div>
              </div>
              {s.navigate && <a className="btn small" href={s.navigate} {...ext}>Map</a>}
            </div>
          )) : <Empty>No stops.</Empty>}
        </div>
      </div>

      <div className="section-t">Odometer and fuel</div>
      <div className="card">
        <div className="rows">
          {p.odometer.map((o, i) => (
            <div className="row" key={i}>
              <div className="grow">
                <div className="name num">{num(o.reading_km)} km {o.flag && <Pill tone="warn">{cap(o.flag)}</Pill>}</div>
                <div className="sub">{joinDots([cap(o.kind), o.at, o.check, o.photo_reading != null ? `photo shows ${o.photo_reading}` : ""])}</div>
              </div>
              {o.photo && <a className="btn small" href={o.photo} {...ext}>Photo</a>}
            </div>
          ))}
          {p.fuel.map((f, i) => (
            <div className="row" key={"f" + i}>
              <div className="grow"><div className="name">{num(f.litres)} L · LKR {num(f.amount_lkr)}</div><div className="sub">Fuel · {f.at}</div></div>
              {f.receipt_photo && <a className="btn small" href={f.receipt_photo} {...ext}>Receipt</a>}
            </div>
          ))}
          {!p.odometer.length && !p.fuel.length && <Empty>No readings yet.</Empty>}
        </div>
      </div>

      {p.vehicle_reports.length > 0 && (
        <>
          <div className="section-t">Problems reported</div>
          <div className="card">
            <div className="rows">
              {p.vehicle_reports.map((r) => (
                <div className="row" key={r.id}>
                  <span className="att-ic bad"><Icon name="alert" /></span>
                  <div className="grow"><div className="name">{cap(r.category)}</div><div className="sub">{r.at} · {cap(r.status)}{r.note ? " · " + r.note : ""}</div></div>
                  <div className="photos">{(r.photos ?? []).map((u, i) => <a key={i} className="btn small" href={u} {...ext}>Photo {i + 1}</a>)}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="muted small">Photo links work for 1 hour. Reopen the task for fresh links.</p>
        </>
      )}

      {canChange && (
        <>
          <div className="section-t">Change before it starts</div>
          <form className="card card-b form" onSubmit={reassign}>
            <div className="grid2">
              <div className="field"><label htmlFor="ra-driver">Driver</label>
                <select id="ra-driver" value={ra.driver} onChange={(e) => setRa({ ...ra, driver: e.target.value })}><option value="">Keep</option>{drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-vehicle">Vehicle</label>
                <select id="ra-vehicle" value={ra.vehicle} onChange={(e) => setRa({ ...ra, vehicle: e.target.value })}><option value="">Keep</option>{(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-date">Day</label><input type="date" id="ra-date" value={ra.date} onChange={(e) => setRa({ ...ra, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="ra-time">Start</label><input type="time" id="ra-time" value={ra.time} onChange={(e) => setRa({ ...ra, time: e.target.value })} /></div>
            </div>
            {raMsg && <Notice tone="bad">{raMsg}</Notice>}
            <button className="btn dark" type="submit" disabled={busy}>Save changes</button>
          </form>
        </>
      )}
      {canCancel && (
        <div className="confirm">
          <div className="field"><label htmlFor="cx-reason">Cancel this task</label><input id="cx-reason" maxLength={300} placeholder="Reason the driver will see" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          {cxMsg && <Notice tone="bad">{cxMsg}</Notice>}
          <button type="button" className="btn danger" onClick={() => void cancel()} disabled={busy}>Cancel task</button>
        </div>
      )}
    </>
  );
}
