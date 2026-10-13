import { type FormEvent, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import { useLists } from "../data/hooks";
import { mapRouteOf, minutesText, type Route, routeOf } from "../data/route";
import type { DriverRoute, TaskDetail, UpdateStopsResult } from "../data/types";
import { cap, hhmm, joinDots, num, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { MapView } from "../map/MapView";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DrawerTop, useDirty, useDrawer } from "../ui/Drawer";
import { Icon } from "../ui/icons";
import { useToast } from "../ui/Toast";
import { PlanPanel } from "./PlanPanel";
import { StopsEditor } from "./StopsEditor";
import { draftsFromStops, driveText, type StopDraft, stopsInput, TYPE_LABEL, WHAT_LABEL } from "./stopsLogic";

const TONE: Record<string, "warn" | "live" | "ok" | "bad"> = { assigned: "warn", in_progress: "live", completed: "ok", cancelled: "bad", declined: "bad" };
const SKIP_TEXT: Record<string, string> = { closed: "closed", nobody_there: "nobody there", not_needed: "not needed", not_visited: "not visited (task finished)", other: "other" };

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
  const [stopsMsg, setStopsMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useDirty(Object.values(ra).some((v) => v !== "") || reason.trim() !== "");

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
  const declined = t.status === "declined";
  const canChange = (t.status === "assigned" || declined) && me.tools.includes("reassign_task");
  const canCancel = (t.status === "assigned" || t.status === "in_progress" || declined) && me.tools.includes("cancel_task");
  const canStops = (t.status === "assigned" || t.status === "in_progress") && me.tools.includes("update_task_stops");
  const pending = p.stops.filter((s) => s.status === "pending");

  async function reassign(ev: FormEvent) {
    ev.preventDefault();
    const input: Record<string, unknown> = { task_id: id };
    if (ra.driver) input.driver = ra.driver;
    if (ra.vehicle) input.vehicle = ra.vehicle;
    if (ra.date) input.date = ra.date;
    if (ra.time) input.start_time = ra.time;
    if (Object.keys(input).length === 1) {
      if (!declined) {
        setRaMsg("Choose what to change first.");
        return;
      }
      input.driver = t.driver ?? "";
      if (!input.driver) {
        setRaMsg("Choose the driver first.");
        return;
      }
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

  /** The stops editor replaces this panel; on save the task reopens with the new plan. */
  function editStops() {
    const version = t.plan_version ?? 0;
    const onSave = async (drafts: StopDraft[]) => {
      const v = stopsInput(drafts);
      if ("error" in v) return;
      try {
        const out = await transport.call<UpdateStopsResult>("update_task_stops", { task_id: id, plan_version: version, stops: v.stops });
        toast(`Stops saved · leave by ${out.leave_by?.slice(-5) ?? "—"}`);
        void store.invalidate();
      } catch (e) {
        const text = errText(e as FleetError)[0];
        setStopsMsg({ tone: "bad", text: /changed since/i.test(text) ? `${text} The task below is reloaded.` : text });
      }
      drawer.open(<TaskDrawer id={id} />);
    };
    drawer.open(<StopsEditor title={`Stops · ${t.title}`} stops={draftsFromStops(pending)} places={lists.places ?? []} onSave={(d) => void onSave(d)} />);
  }

  const drivers = (lists.drivers ?? []).filter((d) => d.active !== false);
  const ext = { target: "_blank", rel: "noopener" } as const;
  const eta = t.eta;

  return (
    <>
      <DrawerTop title={t.title || "Task"} sub={<><Pill tone={TONE[t.status] ?? ""}>{cap(t.status)}</Pill> <span className="mono">{t.start}</span></>} />
      <div className="card card-b">
        <dl className="kv">
          <div><dt>Driver</dt><dd>{t.driver || "—"}</dd></div>
          <div><dt>Vehicle</dt><dd>{t.vehicle || "—"}</dd></div>
          <div><dt>Status</dt><dd>{t.status_line || cap(t.status)}</dd></div>
          {t.accepted && <div><dt>Accepted</dt><dd>{t.accepted}</dd></div>}
          <div><dt>Leave by</dt><dd className="mono">{t.leave_by ? `${hhmm(t.leave_by)} (${t.leave_by_source === "plan" ? "planned" : "typed"})` : "—"}</dd></div>
          {eta && (
            <div style={{ gridColumn: "1/-1" }} data-testid="eta">
              <dt>ETA (live)</dt>
              <dd>
                {eta.next_stop ? `${eta.next_stop} ` : "next "}{eta.next ?? "—"} · final {eta.final ?? "—"}
                {eta.late_min ? <span className="status bad"> · running late by {eta.late_min} min</span> : <span className="status live"> · on time</span>}
                <span className="muted small"> · as of {eta.as_of}</span>
              </dd>
            </div>
          )}
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
      {can(me, ...ROUTES_NEED) && <TaskRoute id={id} started={t.started} />}

      <div className="section-t">Stops{t.start_place ? ` · from ${t.start_place}` : ""}{t.return_to_base ? " · back to the office" : ""}{t.avoid_expressway ? " · no expressway" : ""}</div>
      {stopsMsg && <Notice tone={stopsMsg.tone}>{stopsMsg.text}</Notice>}
      <div className="card">
        <div className="rows">
          {p.stops.length ? p.stops.map((s) => (
            <div className="row" key={s.seq}>
              <span className={`dot ${s.status === "done" ? "ok" : s.status === "skipped" ? "bad" : s.status === "arrived" ? "live" : "warn"}`} />
              <div className="grow">
                <div className="name">{TYPE_LABEL[s.type as keyof typeof TYPE_LABEL] ?? cap(s.type)}{s.what ? ` · ${WHAT_LABEL[s.what as keyof typeof WHAT_LABEL] ?? s.what}` : ""} · {s.place || s.address || ""}</div>
                <div className="sub">
                  {joinDots([
                    s.planned_arrive ? `planned ${s.planned_arrive}${s.planned_depart && s.planned_depart !== s.planned_arrive ? `–${s.planned_depart}` : ""}` : null,
                    s.arrive_by ? `by ${s.arrive_by}` : null,
                    s.dwell_min != null ? `${s.dwell_min} min there` : null,
                    s.status === "pending" ? null : cap(s.status),
                    s.arrived ? `arrived ${s.arrived}` : null,
                    s.done ? `done ${s.done}` : null,
                    s.skip_reason ? `skipped: ${SKIP_TEXT[s.skip_reason] ?? s.skip_reason}${s.skip_note ? ` (${s.skip_note})` : ""}` : null,
                    s.pin === "none" ? "no map pin" : null,
                  ])}
                </div>
                {s.note && <div className="sub">Note: {s.note}</div>}
              </div>
              {s.navigate && <a className="btn small" href={s.navigate} {...ext}>Map</a>}
            </div>
          )) : <Empty>No stops.</Empty>}
        </div>
        {(canStops || p.removed_stops?.length) && (
          <div className="card-b" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {canStops && <button type="button" className="btn" onClick={editStops}>Edit stops</button>}
            {p.removed_stops?.length ? <span className="muted small">{p.removed_stops.length} stop{p.removed_stops.length > 1 ? "s" : ""} edited out earlier: {p.removed_stops.map((r) => r.place).join(", ")}</span> : null}
          </div>
        )}
      </div>
      {p.plan && (
        <>
          <div className="section-t">Plan</div>
          <PlanPanel plan={p.plan} stops={p.stops.map((s) => ({ seq: s.seq, type: s.type, place: s.place, arrive_by: s.arrive_by, planned_arrive: s.planned_arrive, planned_depart: s.planned_depart, pin: s.pin }))} />
          <p className="muted small" style={{ margin: 0 }}>{driveText(p.plan.total_drive_min)} driving in {p.plan.legs.length} leg{p.plan.legs.length === 1 ? "" : "s"} · computed {p.plan.computed_at}</p>
        </>
      )}

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

      {t.declined && (
        <Notice tone="bad">
          Declined{t.declined.after_accept ? " after accepting" : ""}{t.declined.at ? ` at ${t.declined.at}` : ""}: {t.declined.reason_text ?? t.declined.reason ?? "no reason given"}
          {t.declined.note ? ` · “${t.declined.note}”` : ""}. Give it to another driver below, or cancel it.
        </Notice>
      )}
      {p.suggestions && canChange && (
        <div className="card card-b" data-testid="suggestions" style={{ display: "grid", gap: 8 }}>
          <b>Free at that time</b>
          <div className="chips">
            {p.suggestions.drivers.length
              ? p.suggestions.drivers.map((d) => (
                <button type="button" key={d.username ?? d.name} className="chip" aria-pressed={!!d.username && ra.driver === d.username} title={d.availability} onClick={() => setRa({ ...ra, driver: d.username ?? "" })}>{d.name}</button>
              ))
              : <span className="muted small">No driver is free then.</span>}
          </div>
          <div className="chips">
            {p.suggestions.vehicles.length
              ? p.suggestions.vehicles.map((v) => (
                <button type="button" key={v.reg_no} className="chip" aria-pressed={ra.vehicle === v.reg_no} title={v.availability} onClick={() => setRa({ ...ra, vehicle: v.reg_no })}>{v.reg_no}</button>
              ))
              : <span className="muted small">No vehicle is free then.</span>}
          </div>
        </div>
      )}
      {canChange && (
        <>
          <div className="section-t">{declined ? "Give it to a driver" : "Change before it starts"}</div>
          <form className="card card-b form" onSubmit={reassign}>
            <div className="grid2">
              <div className="field"><label htmlFor="ra-driver">Driver</label>
                <select id="ra-driver" value={ra.driver} onChange={(e) => setRa({ ...ra, driver: e.target.value })}><option value="">Keep</option>{drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-vehicle">Vehicle</label>
                <select id="ra-vehicle" value={ra.vehicle} onChange={(e) => setRa({ ...ra, vehicle: e.target.value })}><option value="">Keep</option>{(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}</select></div>
              <div className="field"><label htmlFor="ra-date">Day</label><input type="date" id="ra-date" value={ra.date} onChange={(e) => setRa({ ...ra, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="ra-time">Leave by</label><input type="time" id="ra-time" value={ra.time} onChange={(e) => setRa({ ...ra, time: e.target.value })} /></div>
            </div>
            {raMsg && <Notice tone="bad">{raMsg}</Notice>}
            <button className="btn dark" type="submit" disabled={busy}>{declined ? "Reassign" : "Save changes"}</button>
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
      {p.assignment_history?.length ? (
        <>
          <div className="section-t">History</div>
          <div className="card card-b" data-testid="history">
            <dl className="kv">
              {p.assignment_history.map((e, i) => (
                <div key={i} style={{ gridColumn: "1/-1" }}>
                  <dt>{e.at}</dt>
                  <dd>{[cap(e.action), e.driver, e.vehicle, e.actor ? `by ${e.actor}` : null, e.note].filter(Boolean).join(" · ")}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      ) : null}
    </>
  );
}

/** The route between Start task and Save & finish (or now), on the same map as the driver page, with GPS km next to the odometer. */
function TaskRoute({ id, started }: { id: string; started?: string | null }) {
  const { transport } = useFleet();
  const [route, setRoute] = useState<Route | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!started) return;
    let alive = true;
    setBusy(true);
    transport.call<DriverRoute>("driver_route", { task_id: id })
      .then((p) => { if (alive) setRoute(routeOf("", p)); })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [id, started, transport]);
  if (!started) return null;
  const line = route && !route.note
    ? joinDots([`GPS ${num(route.km)} km`, `driving ${minutesText(route.drivingMinutes)}`, `stopped ${minutesText(route.stoppedMinutes)}`, route.stopsCount ? `${route.stopsCount} stop${route.stopsCount > 1 ? "s" : ""} of 10 min or more` : "no stops of 10 min or more"])
    : route?.note;
  return (
    <>
      <div className="section-t">Route</div>
      <div className="card card-b stack" data-testid="task-route">
        {busy && <Loading>Loading the route…</Loading>}
        {err && <Notice tone="bad">{err}</Notice>}
        {route && route.points.length > 0 && <MapView markers={[]} route={mapRouteOf(route)} onPick={() => undefined} />}
        {line && <p className="muted small" style={{ margin: 0 }}>{line}</p>}
      </div>
    </>
  );
}
