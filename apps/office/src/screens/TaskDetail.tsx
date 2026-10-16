// One task, read only (/tasks/:id): a panel beside the board on a desktop, a
// full screen on a phone. The facts, the route, the stops with planned and
// actual times, the plan, odometer and fuel, problems, the decline, the
// history; Change and Cancel open /tasks/:id/edit, Edit stops /tasks/:id/stops.
// Phase 7: the finish flag (completed early), the vehicle taken at Start task,
// each stop's arrival flag, and Reopen (a task completed today) as a second
// step on the page with the reason.
import { useEffect, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import { estimatedLegend, type Route, mapRouteOf, minutesText, routeOf, snapLegend } from "../data/route";
import type { DriverRoute, TaskDetail as TaskDetailData } from "../data/types";
import { cap, hhmm, joinDots, num, today } from "../lib/format";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { MapView } from "../map/MapView";
import { StopArrival } from "./StopArrival";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { Icon } from "../ui/icons";
import { PageTop } from "../ui/Page";
import { useToast } from "../ui/Toast";
import { PlanPanel } from "./PlanPanel";
import { videoWords } from "./fuelLogic";
import { driveText, TYPE_LABEL, WHAT_LABEL } from "./stopsLogic";

export const TONE: Record<string, "warn" | "live" | "ok" | "bad"> = { assigned: "warn", in_progress: "live", completed: "ok", cancelled: "bad", declined: "bad" };
/** The arrival flags shown in amber (an override, no GPS fix, Done without Arrived); "no pin" is plain. */
const ARRIVAL_WARN = new Set(["override", "no_gps", "not_arrived"]);
const SKIP_TEXT: Record<string, string> = { closed: "closed", nobody_there: "nobody there", not_needed: "not needed", not_visited: "not visited (task finished)", other: "other" };

/** Loads one task; loads again when the page is returned to (after an edit). */
export function useTask(id: string): { p: TaskDetailData | null; err: string | null; reload: () => Promise<void> } {
  const { transport } = useFleet();
  const { key } = useLocation();
  const [p, setP] = useState<TaskDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = async () => {
    try {
      setP(await transport.call<TaskDetailData>("task_detail", { task_id: id }));
      setErr(null);
    } catch (e) {
      setErr(errText(e as FleetError)[0]);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, key]);
  return { p, err, reload };
}

/** The board's day as a query string (`?date=…`, empty for today), carried from the board through a task's pages. */
export function useBoardQuery(): string {
  const [params] = useSearchParams();
  const date = params.get("date");
  return date && date !== today() ? `?date=${date}` : "";
}

/** The board's day in the URL, kept when going back to it. */
export function useBoardBack(): string {
  return `/tasks${useBoardQuery()}`;
}

export function TaskDetail() {
  const { id = "" } = useParams();
  const { me } = useFleet();
  const { p, err, reload } = useTask(id);
  const backTo = useBoardBack();
  const q = useBoardQuery();
  // The warnings of a change just made on /tasks/:id/edit (passed in the navigation state).
  const flash = (useLocation().state as { warnings?: string[] } | null)?.warnings ?? [];

  if (err) return <><PageTop title="Task" backTo={backTo} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Task" backTo={backTo} /><Loading>Loading the task…</Loading></>;

  const t = p.task;
  const c = t.contact ?? {};
  const km = t.km ?? (t.end_odometer_km != null && t.start_odometer_km != null ? t.end_odometer_km - t.start_odometer_km : null);
  const projects = typeof p.projects === "string" ? p.projects : p.projects.map((x) => joinDots([x.project, x.percent != null ? `${x.percent}%` : ""])).join(", ");
  const declined = t.status === "declined";
  const canChange = (t.status === "assigned" || t.status === "in_progress" || declined) && (me.tools.includes("update_task") || me.tools.includes("reassign_task"));
  const canCancel = (t.status === "assigned" || t.status === "in_progress" || declined) && me.tools.includes("cancel_task");
  const canStops = (t.status === "assigned" || t.status === "in_progress") && me.tools.includes("update_task_stops");
  const ext = { target: "_blank", rel: "noopener" } as const;
  const eta = t.eta;

  return (
    <div data-testid="task-detail">
      <PageTop
        title={t.title || "Task"}
        sub={<><Pill tone={TONE[t.status] ?? ""}>{cap(t.status)}</Pill> <span className="mono">{t.start}</span></>}
        backTo={backTo}
        actions={(canChange || canCancel) ? <Link className="btn small" to={`/tasks/${id}/edit${q}`}>{declined ? "Give it to a driver" : "Change"}</Link> : undefined}
      />
      <WarningsNote warnings={flash} />
      {t.finish_flag && <Notice>{t.finish_flag.text}</Notice>}
      <div className="card card-b">
        <dl className="kv">
          <div><dt>Driver</dt><dd>{t.driver || "—"}</dd></div>
          <div><dt>Vehicle</dt><dd>{t.vehicle || "—"}{t.vehicle_taken && <div className="sub" style={{ fontWeight: 400 }}>{t.vehicle_taken}</div>}</dd></div>
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
      {t.can_reopen && me.tools.includes("reopen_task") && <ReopenTask id={id} onDone={reload} />}
      {p.unlogged_km && (
        <Notice>
          {num(p.unlogged_km.km)} km were driven before this task that nobody logged (last reading {num(p.unlogged_km.last_logged_km)} km at {p.unlogged_km.last_logged_at}, this task started at {num(p.unlogged_km.start_km)} km).
        </Notice>
      )}
      {t.declined && (
        <Notice tone="bad">
          Declined{t.declined.after_accept ? " after accepting" : ""}{t.declined.at ? ` at ${t.declined.at}` : ""}: {t.declined.reason_text ?? t.declined.reason ?? "no reason given"}
          {t.declined.note ? ` · “${t.declined.note}”` : ""}. {canChange ? <Link to={`/tasks/${id}/edit${q}`}>Give it to another driver</Link> : null}
        </Notice>
      )}
      {can(me, ...ROUTES_NEED) && <TaskRoute id={id} started={t.started} />}

      <div className="section-t">Stops{t.start_place ? ` · from ${t.start_place}` : ""}{t.return_to_base ? " · back to the office" : ""}{t.avoid_expressway ? " · no expressway" : ""}</div>
      <div className="card">
        <div className="rows">
          {p.stops.length ? p.stops.map((s) => (
            <div className="row" key={s.seq}>
              <span className={`dot ${s.status === "done" ? "ok" : s.status === "skipped" ? "bad" : s.status === "arrived" ? "live" : "warn"}`} />
              <div className="grow">
                <div className="name">{TYPE_LABEL[s.type as keyof typeof TYPE_LABEL] ?? cap(s.type)}{s.what ? ` · ${WHAT_LABEL[s.what as keyof typeof WHAT_LABEL] ?? s.what}` : ""} · {s.place || s.address || ""}{s.google && <> <span translate="no"><Pill tone="live">Google Maps</Pill></span></>}</div>
                <div className="sub">
                  {joinDots([
                    s.planned_arrive ? `planned ${s.planned_arrive}${s.planned_depart && s.planned_depart !== s.planned_arrive ? `–${s.planned_depart}` : ""}` : null,
                    s.arrive_by ? `by ${s.arrive_by}` : null,
                    s.dwell_min != null ? `${s.dwell_min} min there` : null,
                    s.status === "pending" ? null : cap(s.status),
                    s.arrived ? `arrived ${s.arrived}` : null,
                    s.auto_detected ? `near the stop ${s.auto_detected} (phone)` : null,
                    s.done ? `done ${s.done}` : null,
                    s.skip_reason ? `skipped: ${SKIP_TEXT[s.skip_reason] ?? s.skip_reason}${s.skip_note ? ` (${s.skip_note})` : ""}` : null,
                    s.pin === "none" ? "no map pin" : null,
                  ])}
                </div>
                {s.arrival_text && <div className={ARRIVAL_WARN.has(s.arrival_flag ?? "") ? "status warn" : "sub"} data-testid="arrival-flag">{s.arrival_text}</div>}
                {s.note && <div className="sub">Note: {s.note}</div>}
                <StopArrival stop={s} onSaved={() => void reload()} />
              </div>
              {s.navigate && <a className="btn small" href={s.navigate} {...ext}>Map</a>}
            </div>
          )) : <Empty>No stops.</Empty>}
        </div>
        {(canStops || p.removed_stops?.length) && (
          <div className="card-b" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {canStops && <Link className="btn" to={`/tasks/${id}/stops${q}`}>Edit stops</Link>}
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
              <div className="grow">
                <div className="name">{num(f.litres)} L · LKR {num(f.amount_lkr)}</div>
                <div className="sub">{joinDots(["Fuel", f.at, f.video ? videoWords(f.video) : ""])}</div>
              </div>
              {f.video?.status === "uploaded" && f.id && can(me, "vehicles") && <Link className="btn small" to={`/fuel/${f.id}`}><Icon name="video" />Video</Link>}
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

      {(canChange || canCancel) && (
        <div className="acts">
          {canChange && <Link className="btn dark" to={`/tasks/${id}/edit${q}`}>{declined ? "Give it to a driver" : "Change the task"}</Link>}
          {canCancel && <Link className="btn danger" to={`/tasks/${id}/edit${q}#cancel`}>Cancel task</Link>}
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
                  <dd>
                    {e.action === "reopened"
                      // "Reopened by Sahan: wrong reading · was completed 14:20 · end odometer 1003 km"
                      ? `Reopened${e.actor ? ` by ${e.actor}` : ""}${e.note ? `: ${e.note}` : ""}`
                      : [cap(e.action), e.driver, e.vehicle, e.actor ? `by ${e.actor}` : null, e.changes ? null : e.note].filter(Boolean).join(" · ")}
                    {e.changes && <ul className="changes">{Object.entries(e.changes).map(([k, c]) => <li key={k}>{k} {c.from ?? "—"} → {c.to ?? "—"}</li>)}</ul>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Reopen (reopen_task, a task completed today): a second step on the page, never
 * a dialog: Reopen task → the reason → Reopen task / Keep completed. The task is
 * loaded again after it, and every watch (the board) fetches again.
 */
function ReopenTask({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const { transport, store } = useFleet();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const keep = () => {
    setArmed(false);
    setReason("");
    setMsg(null);
  };
  async function reopen() {
    if (!reason.trim()) {
      setMsg("Say why the task is reopened: the history keeps it.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("reopen_task", { task_id: id, reason: reason.trim() });
      toast("Task reopened: the driver finishes it again");
      keep();
      void store.invalidate();
      await onDone();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }
  return (
    <div className="confirm" style={armed ? undefined : { borderColor: "var(--line)" }} data-testid="reopen">
      <div>
        <b>Reopen this task</b>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          For a wrong end reading or a task finished too soon: it goes back to in progress on the driver's phone, the end odometer and the
          finish time are cleared (the history keeps them) and the driver finishes it again. Only on the day it was completed.
        </p>
      </div>
      {!armed ? (
        <div><button type="button" className="btn" onClick={() => setArmed(true)}>Reopen task</button></div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="reopen-reason">Why is it reopened?</label>
            <textarea id="reopen-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong end reading" />
          </div>
          {msg && <Notice tone="bad">{msg}</Notice>}
          <div className="acts">
            <button type="button" className="btn dark" disabled={busy || !reason.trim()} onClick={() => void reopen()}>Reopen task</button>
            <button type="button" className="btn" disabled={busy} onClick={keep}>Keep completed</button>
          </div>
        </>
      )}
    </div>
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
    transport.call<DriverRoute>("driver_route", { task_id: id, line_tolerance_m: 0, max_line_points: 3000, snap: true, estimate_gaps: true })
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
        {route && route.points.length > 0 && <MapView markers={[]} route={mapRouteOf(route, null, true)} onPick={() => undefined} />}
        {line && <p className="muted small" style={{ margin: 0 }}>{line}{snapLegend(route, true) ? ` · ${snapLegend(route, true)}` : ""}</p>}
        {estimatedLegend(route) && <p className="muted small" style={{ margin: 0 }} data-testid="estimated-legend">{estimatedLegend(route)}</p>}
      </div>
    </>
  );
}
