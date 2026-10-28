// One task, read only (/tasks/:id): a panel beside the board on a desktop, a
// full screen on a phone. The facts, the route, the stops with planned and
// actual times, the plan, odometer and fuel, problems, the decline, the
// history; Change and Cancel open /tasks/:id/edit, Edit stops /tasks/:id/stops.
// Phase 7: the finish flag (completed early), the vehicle taken at Start task,
// each stop's arrival flag, and Reopen (a task completed today) as a second
// step on the page with the reason. Part 2: the stops named by their order
// ("Stop 2 · Drop · Kurunegala site") with the time there planned against what
// happened, the vehicle swap's stretches and their total, the vehicle chosen
// against the default, the warnings saved past, and "Needs a driver" at the top.
// Part 4 (§13): a trip the driver started is tagged "Driver-started" (and "Personal"), with Company work ↔ Personal and
// "Attach a project" (set_trip_purpose) on the page.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import { type Route, mapRouteOf, minutesText, routeOf } from "../data/route";
import type { DriverRoute, TaskDetail as TaskDetailData } from "../data/types";
import { cap, hhmm, joinDots, num, plateOf, today } from "../lib/format";
import { errText } from "../transport/errors";
import { can, type FleetError } from "../transport/types";
import { MapView } from "../map/MapView";
import { useGoogleMap } from "../map/google/useGoogleMap";
import { eventsOn, LAYERS_DEF } from "../map/layers";
import { snapAllowed } from "../map/mapChoice";
import type { RoutePoint } from "../map/types";
import { useRouteMarks } from "./GapsList";
import { noGpsLine } from "./dayLogic";
import { RouteLegend } from "./RouteInfo";
import { useRouteLayout } from "./routeLayout";
import { RouteMapPane } from "./RouteMapPane";
import { FilterBar, useUrlFilters } from "../ui/FilterBar";
import { LateReportLine } from "./LateReport";
import { StopArrival } from "./StopArrival";
import { StopProgress } from "./StopProgress";
import { TripPurposeCard, TripTags } from "./TripPurpose";
import { Empty, Loading, Notice, Pill, VehicleThumb, WarningsNote } from "../ui/basics";
import { ContactButtons, linksOf } from "../ui/ContactButtons";
import { DriverLine } from "../ui/DriverRow";
import { firstName, vehicleChipWords } from "../ui/driverRowLogic";
import { Icon } from "../ui/icons";
import { FROM_TASK, PageTop } from "../ui/Page";
import { DecisionRow } from "./approvers";
import { useFleetSettings } from "./dispatchParts";
import { useToast } from "../ui/Toast";
import { PlanWithMap } from "./PlanMap";
import { amountText, videoWords } from "./fuelLogic";
import { driveText } from "./stopsLogic";
import { readFlashConflicts, readFlashWarnings } from "../data/flash";
import type { Conflict } from "../data/types";
import { ConflictCards } from "./ConflictCards";
import { TaskAsksLine } from "./HolderAsks";
import { findDriverPath } from "./needsDriverLogic";
import { dwellNote, fuelCardWords, locationWords, needsDriverText, segmentRows, segmentsTotal, taskTone, whatOf } from "./taskDetailLogic";
import { duration } from "@fleet/durations";
import { datesInWords, whenText } from "../lib/when";
import { finishChip } from "./myTripLogic";
import { TaskCheckLines } from "./VehicleChecks";
import { PassengerList } from "./PassengerList";
import { HolderLine } from "../ui/Holder";
import { StatusBanner } from "../ui/patterns";
import { countWithNames, ridersLine } from "./passengersLogic";
import { featureOn } from "./switchLogic";
import { liveForTask } from "./overviewLinks";

/** Round 4–7 (5): "Fuel: Enough fuel · 07:42" with the estimate under it; before the start the estimate alone. */
function FuelCardLine({ card, started }: { card: NonNullable<TaskDetailData["task"]["fuel_card"]>; started: boolean }) {
  const w = fuelCardWords(card, started);
  if (!w.answer && !w.estimate) return null;
  return (
    <div style={{ gridColumn: "1/-1" }} data-testid="fuel-card">
      <dt>Fuel</dt>
      <dd style={{ fontWeight: 400 }}>
        {w.answer ? <b className={w.tone === "warn" ? "status warn" : w.tone === "muted" ? "muted" : undefined}>{w.answer}</b> : <span className="muted">Asked at Start task</span>}
        {w.estimate && <div className="sub">{w.estimate}</div>}
      </dd>
    </div>
  );
}

/** The arrival flags shown in amber (an override, no GPS fix, Done without Arrived); "no pin" is plain. */
const ARRIVAL_WARN = new Set(["override", "no_gps", "not_arrived"]);

/**
 * Loads one task; loads again when the page is returned to (after an edit). `withLine`: the task page's plan map also
 * asks for each leg's Google road line (web only: Google's map is never in the artifact).
 */
export function useTask(id: string, opts: { withLine?: boolean; live?: boolean } = {}): { p: TaskDetailData | null; err: string | null; reload: () => Promise<void> } {
  const { transport, realtime } = useFleet();
  const { key } = useLocation();
  const [p, setP] = useState<TaskDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const withLine = !!opts.withLine && __BUILD__ === "web";
  // Only the newest answer is kept (a slow one that lands after a newer one is dropped).
  const seq = useRef(0);
  const reload = async () => {
    const mine = ++seq.current;
    try {
      const next = await transport.call<TaskDetailData>("task_detail", withLine ? { task_id: id, with_line: true } : { task_id: id });
      if (mine !== seq.current) return;
      setP(next);
      setErr(null);
    } catch (e) {
      // A live refresh that fails keeps the page as it is; only the first load shows the error.
      if (mine === seq.current) setErr((was) => (p ? was : errText(e as FleetError)[0]));
    }
  };
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, key]);

  // Round 2: live without a reload. The web: a Realtime channel on the task and its stops; a change asks task_detail
  // again about a second later (a burst of changes is one call), and the answer replaces the data in place (the page
  // stays, the scroll too). The artifact has no Realtime: it asks again every 60 s while the task is still to finish.
  const live = !!opts.live;
  const subscribe = realtime?.taskProgress;
  useEffect(() => {
    if (!live || !subscribe || !id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribe(id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current(), 1000);
    });
    return () => { clearTimeout(timer); stop(); };
  }, [live, subscribe, id]);
  const running = p?.task.status === "assigned" || p?.task.status === "in_progress";
  // The 60 s refresh stays on the web too, behind the channel (Checkpoint 2 review): a channel that fails or never joins
  // must not leave the page frozen.
  useEffect(() => {
    if (!live || !running) return;
    const timer = setInterval(() => void reloadRef.current(), 60_000);
    return () => clearInterval(timer);
  }, [live, running]);
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
  const { p, err, reload } = useTask(id, { withLine: true, live: true });
  // Hotfix 2 (F): the office's number, for Call office beside "Approved by …" when the approver has none.
  const settings = useFleetSettings();
  const officePhone = linksOf(settings.data?.settings.office_phone);
  // Round 4–7: a switched-off feature hides its part (the fuel card; who rides by name with Share trip, the count stays).
  const fuelOn = featureOn(settings.data?.settings, "fuel_card");
  const ridersOn = featureOn(settings.data?.settings, "passengers");
  const backTo = useBoardBack();
  const q = useBoardQuery();
  // The warnings of a change just made on /tasks/:id/edit or its stops (passed in the navigation state, or, after a save
  // that went back in the history, left in data/flash).
  const navState = useLocation().state as { warnings?: string[]; conflicts?: Conflict[] } | null;
  const flash = navState?.warnings ?? readFlashWarnings(id);
  // Round 4–7 (7): the overlaps of that change as cards (who holds the driver or the vehicle then, Ask for it).
  const flashedConflicts = navState?.conflicts ?? readFlashConflicts(id);

  if (err) return <><PageTop title="Task" backTo={backTo} /><Notice tone="bad">{err}</Notice></>;
  if (!p) return <><PageTop title="Task" backTo={backTo} /><Loading>Loading the task…</Loading></>;

  const t = p.task;
  const c = t.contact ?? {};
  // After a vehicle swap the km are the stretches added up (none while a reading is still to come); never end − start.
  const km = t.km ?? (!p.segments?.length && t.end_odometer_km != null && t.start_odometer_km != null ? t.end_odometer_km - t.start_odometer_km : null);
  const projects = typeof p.projects === "string" ? p.projects : p.projects.map((x) => joinDots([x.project, x.percent != null ? `${x.percent}%` : ""])).join(", ");
  const declined = t.status === "declined";
  const canChange = (t.status === "assigned" || t.status === "in_progress" || declined) && (me.tools.includes("update_task") || me.tools.includes("reassign_task"));
  const canCancel = (t.status === "assigned" || t.status === "in_progress" || declined) && me.tools.includes("cancel_task");
  const canStops = (t.status === "assigned" || t.status === "in_progress") && me.tools.includes("update_task_stops");
  const ext = { target: "_blank", rel: "noopener" } as const;
  const eta = t.eta;
  // Needs a driver (§19): the change page with the driver field first; the edit pages need assign_tasks.
  const findDriver = !!t.needs_driver && can(me, "assign_tasks") && (me.tools.includes("update_task") || me.tools.includes("reassign_task"));
  const segments = segmentRows(p.segments);
  const segTotal = segmentsTotal(p.segments);
  const riders = ridersOn ? t.passengers_list ?? [] : [];

  return (
    <div data-testid="task-detail">
      <PageTop
        title={t.title || "Task"}
        sub={<><Pill tone={taskTone(t.status)}>{cap(t.status)}</Pill> <TripTags t={t} /> <span className="mono">{t.start}</span></>}
        backTo={backTo}
        actions={(canChange || canCancel)
          ? (declined || t.needs_driver) && canChange
            ? <Link className="btn small" to={findDriverPath(id)} state={FROM_TASK}>Give it a driver</Link>
            : <Link className="btn small" to={`/tasks/${id}/edit${q}`} state={FROM_TASK}>Change</Link>
          : undefined}
      />
      {/* Round 4–7, item 12 (the approved mockup 4): ONE status banner: needs a driver (with Find a driver), on the way
          (arrives about, back about, the late chip; a click opens Live), else the task's state in words. */}
      {t.needs_driver ? (
        <StatusBanner tone="bad" icon="user_x" title={<span data-testid="needs-driver-line">{needsDriverText(t)}</span>} testId="task-banner">
          {findDriver ? <span><Link className="btn small" to={findDriverPath(id)} state={FROM_TASK}>Find a driver</Link></span> : null}
        </StatusBanner>
      ) : <TaskBanner t={t} />}
      <WarningsNote warnings={flash} />
      <ConflictCards conflicts={flashedConflicts} />
      <TaskAsksLine taskId={id} />
      {/* Round 4–7 (4b): Completed · not confirmed (a trip nobody drives with the app, closed without its odometer) is grey. */}
      {t.finish_flag && (t.finish_flag.kind === "not_confirmed"
        ? <div className="card card-b" data-testid="finish-flag"><Pill>{finishChip(t.finish_flag)?.text}</Pill> <span className="muted small">{t.finish_flag.text}</span></div>
        : <Notice>{t.finish_flag.text}</Notice>)}
      <div className="td-layout">
      <div className="td-cols">
      <div className="td-top">
      <div className="card card-b">
        <dl className="kv">
          <div>
            <dt>{t.driven_by ? "Who drives" : "Driver"}</dt>
            <dd>
              {/* Round 3: the driver-first card (the vehicle chip under the name); a trip with no app says who drives instead of a state. */}
              {t.driver
                ? <DriverLine name={t.driver} photo={t.driver_photo_url} drivenBy={t.driven_by} vehicle={vehicleChipWords(plateOf(t.vehicle), { text: t.vehicle_text })} />
                : "—"}
              {/* Hotfix 2 (F): Call and WhatsApp the driver (someone else: their own number), for people who may see drivers' numbers. */}
              {t.driver_phone && <div style={{ marginTop: 6 }}><ContactButtons phone={t.driver_phone} label={t.driven_by === "other" && t.driver ? `Call ${firstName(t.driver)}` : "Call driver"} testId="call-driver" /></div>}
            </dd>
          </div>
          <div>
            <dt>Vehicle</dt>
            <dd>
              {t.vehicle ? <span className="with-photo"><VehicleThumb src={t.vehicle_thumb_url} />{t.vehicle}</span> : <span data-testid="vehicle-text">{t.vehicle_text || "—"}</span>}
              {t.vehicle_taken && <div className="sub" style={{ fontWeight: 400 }}>{t.vehicle_taken}</div>}
              {t.vehicle_changed && <div className="sub" style={{ fontWeight: 400 }} data-testid="vehicle-changed">{t.vehicle_changed}</div>}
              {segments.length > 1 && <div className="sub" style={{ fontWeight: 400 }}>Swapped during the task: {segments.map((g) => g.vehicle).join(" → ")}</div>}
            </dd>
          </div>
          {t.accepted && <div><dt>Accepted</dt><dd>{whenText(t.accepted)}</dd></div>}
          <div><dt>Leave by</dt><dd className="mono">{t.leave_by ? `${hhmm(t.leave_by)} (${t.leave_by_source === "plan" ? "planned" : "typed"})` : "—"}</dd></div>
          {eta && (
            <div style={{ gridColumn: "1/-1" }} data-testid="eta">
              <dt>ETA (live)</dt>
              <dd>
                {eta.next_stop ? `${eta.next_stop} ` : "next "}{eta.next ?? "—"} · final {eta.final ?? "—"}
                {eta.late_min ? <span className="status bad"> · running late by {duration(eta.late_min)}</span> : <span className="status live"> · on time</span>}
                <span className="muted small"> · as of {eta.as_of}</span>
              </dd>
            </div>
          )}
          {/* Part 3b (H4): the driver's own "Running late". */}
          {t.late_report && (
            <div style={{ gridColumn: "1/-1" }}>
              <dt>The driver says</dt>
              <dd><LateReportLine late={t.late_report} /></dd>
            </div>
          )}
          {/* Round 4–7 (6): the count (never under the names) and who rides by name, with Share trip for someone without an
              account; with the switch passengers off, the count alone. */}
          <div style={riders.length ? { gridColumn: "1/-1" } : undefined} data-testid="task-passengers">
            <dt>Passengers</dt>
            <dd>
              <span className="num">{countWithNames(t.passengers, riders.length) ?? "—"}</span>
              {riders.length ? <span className="muted" style={{ fontWeight: 400 }}> · {ridersLine(riders.map((x) => x.name), t.passengers)}</span> : null}
              {riders.length ? <div style={{ fontWeight: 400 }}><PassengerList list={riders} /></div> : null}
            </dd>
          </div>
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
          <div><dt>Charged to</dt><dd>{t.purpose === "personal" ? "Personal · not charged to a job" : projects || "Fame internal"}</dd></div>
          <div><dt>Sent · seen</dt><dd className="mono">{joinDots([hhmm(t.sent), t.seen === "not opened yet" ? "not opened yet" : hhmm(t.seen)]) || "—"}</dd></div>
          <div><dt>Started · done</dt><dd className="mono">{joinDots([hhmm(t.started), hhmm(t.completed)]) || "—"}</dd></div>
          {/* Round 4–7 (4): the vehicle check of the task's day by its person, with the photos. */}
          <TaskCheckLines checks={t.vehicle_checks} />
          <div><dt>Odometer</dt><dd className="num">{t.start_odometer_km != null ? num(t.start_odometer_km) : "—"}{t.end_odometer_km != null ? " → " + num(t.end_odometer_km) : ""}</dd></div>
          <div><dt>Km this task</dt><dd className="num">{km != null ? num(km) + " km" : "—"}{segments.length > 1 ? <span className="muted"> · {segments.length} vehicles</span> : null}{t.gps_km != null ? <span className="muted"> · GPS {num(t.gps_km)} km</span> : null}</dd></div>
          {/* Round 4–7 (5): the fuel card the driver saw at Start task and their answer (nothing when the task has none, or
              while the switch fuel_card is off). */}
          {fuelOn && t.fuel_card && <FuelCardLine card={t.fuel_card} started={!!t.started || t.status === "in_progress" || t.status === "completed"} />}
          {t.created_by && <div><dt>Assigned by</dt><dd>{t.created_by}</dd></div>}
          {/* Hotfix 2 (K): who sent it to the driver, with their number (Call office when they have none). */}
          {t.approved_by && <div style={{ gridColumn: "1/-1" }}><dt>Approved</dt><dd style={{ fontWeight: 400 }}><DecisionRow kind="approved" who={t.approved_by} office={officePhone} /></dd></div>}
          {t.cancelled_reason && <div><dt>Cancelled because</dt><dd>{t.cancelled_reason}</dd></div>}
          {t.notes && <div style={{ gridColumn: "1/-1" }}><dt>Notes</dt><dd style={{ fontWeight: 400 }}>{t.notes}</dd></div>}
        </dl>
      </div>
      {/* Phase 7 (§13): a trip the driver started: company or personal, and the project it is charged to. */}
      {t.kind === "self" && <TripPurposeCard key={id} taskId={id} purpose={t.purpose} driver={t.driver} charged={projects || "Fame internal"} onSaved={reload} />}
      {t.can_reopen && me.tools.includes("reopen_task") && <ReopenTask id={id} onDone={reload} />}
      {p.unlogged_km && (
        <Notice>
          {num(p.unlogged_km.km)} km were driven before this task that nobody logged (last reading {num(p.unlogged_km.last_logged_km)} km {whenText(p.unlogged_km.last_logged_at, { inline: true })}, this task started at {num(p.unlogged_km.start_km)} km).
        </Notice>
      )}
      {t.declined && (
        <Notice tone="bad">
          Declined{t.declined.after_accept ? " after accepting" : ""}{t.declined.at ? ` ${whenText(t.declined.at, { inline: true })}` : ""}: {t.declined.reason_text ?? t.declined.reason ?? "no reason given"}
          {t.declined.note ? ` · “${t.declined.note}”` : ""}. {canChange && !findDriver ? <Link to={findDriverPath(id)} state={FROM_TASK}>Give it to another driver →</Link> : null}
        </Notice>
      )}
      {t.warnings_saved?.length ? (
        <div className="notice" data-testid="warnings-saved">
          <p>
            <b>Saved past these warnings:</b>
            {t.warnings_saved.map((w, i) => <span key={i}><br />{datesInWords(w)}</span>)}
          </p>
        </div>
      ) : null}
      {/* Round 4–7, item 12 (feature 7): who this trip is for (its requester, else who assigned it), with Call and WhatsApp. */}
      {t.holder && (
        <div className="card card-b" data-testid="task-holder">
          <div className="section-t" style={{ marginBottom: 6 }}>{t.holder.by === "asked" ? "Asked for by" : "Assigned by"}</div>
          <HolderLine holder={t.holder} resource="driver" ask={false} testId="task-holder-line" />
        </div>
      )}
      </div>
      <div className="td-left">
      {can(me, ...ROUTES_NEED) && <TaskRoute id={id} started={t.started} />}

      <div className="section-t">Stops{t.start_place ? ` · from ${t.start_place}` : ""}{t.return_to_base ? " · back to the office" : ""}{t.avoid_expressway ? " · no expressway" : ""}</div>
      <div className="card">
        {p.stops.length ? (
          <StopProgress
            stops={p.stops}
            extra={(s) => (
              <>
                <div className="sub">
                  {joinDots([
                    whatOf(s),
                    s.arrive_by ? `by ${s.arrive_by}` : null,
                    // The time there: in the planned line already when the answer has it.
                    !s.progress && !s.planned_stay && s.dwell_min != null ? `${duration(s.dwell_min)} there` : null,
                    dwellNote(s),
                    // Arrived and Left are on the timeline's own line; Skipped has its line with the reason in words.
                    s.progress || s.status === "pending" || s.status === "skipped" ? null : cap(s.status),
                    !s.progress && !s.actual_stay && s.arrived ? `arrived ${s.arrived}` : null,
                    s.auto_detected ? `near the stop ${s.auto_detected} (phone)` : null,
                    !s.progress && !s.actual_stay && s.done ? `done ${s.done}` : null,
                    s.pin === "none" ? "no map pin" : null,
                  ])}
                </div>
                {s.arrival_text && <div className={ARRIVAL_WARN.has(s.arrival_flag ?? "") ? "status warn" : "sub"} data-testid="arrival-flag">{s.arrival_text}</div>}
                {s.note && <div className="sub">Note: {s.note}</div>}
                <StopArrival stop={s} onSaved={() => void reload()} />
              </>
            )}
            action={(s) => (s.navigate ? <a className="btn small" href={s.navigate} {...ext}>Map</a> : null)}
          />
        ) : <div className="rows"><Empty>No stops.</Empty></div>}
        {(canStops || p.removed_stops?.length) && (
          <div className="card-b" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {canStops && <Link className="btn" to={`/tasks/${id}/stops${q}`} state={FROM_TASK}>Edit stops</Link>}
            {p.removed_stops?.length ? <span className="muted small">{p.removed_stops.length} stop{p.removed_stops.length > 1 ? "s" : ""} edited out earlier: {p.removed_stops.map((r) => r.place).join(", ")}</span> : null}
          </div>
        )}
      </div>
      {p.plan && (
        <>
          <div className="section-t">Plan</div>
          <PlanWithMap timeline={p.timeline} plan={p.plan} startName={p.task.start_place} stops={p.stops}
            start={{ name: t.start_place, lat: t.start_lat, lng: t.start_lng, google: !!t.start_google_place_id }} />
          <p className="muted small" style={{ margin: 0 }}>{driveText(p.plan.total_drive_min)} driving in {p.plan.legs.length} leg{p.plan.legs.length === 1 ? "" : "s"} · computed {whenText(p.plan.computed_at, { inline: true })}</p>
        </>
      )}

      {segments.length > 0 && (
        <>
          <div className="section-t">Vehicle swap</div>
          <div className="card" data-testid="segments">
            <div className="rows">
              {segments.map((g, i) => (
                <div className="row" key={i} data-testid="segment">
                  <span className="plate">{g.vehicle}</span>
                  <div className="grow">
                    <div className="name"><span className="mono">{g.window}</span></div>
                    <div className="sub num">{g.readings}</div>
                    {g.waiting && <div className="status warn">Reading to come from the driver</div>}
                    {g.waiting && me.tools.includes("swap_reading") && p.segments?.[i] && (
                      <SwapReadingForm taskId={id} vehicle={p.segments[i].vehicle ?? ""} needEnd={!!p.segments[i].to && p.segments[i].end_km == null}
                        needStart={i > 0 && p.segments[i].start_km == null} onDone={reload} />
                    )}
                    {g.why && <div className="sub">{g.why}</div>}
                  </div>
                  <span className="num" style={{ fontWeight: 700 }}>{g.km || "—"}</span>
                </div>
              ))}
            </div>
            <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", justifyContent: "space-between", borderTop: "1px solid var(--line)" }}>
              <b className="num" data-testid="segments-total">{segTotal.line}</b>
              <span className="muted small">Task km = the stretches added up{km != null ? ` · this task ${num(km)} km` : ""}</span>
            </div>
          </div>
        </>
      )}

      </div>
      <div className="td-rest">
      <div className="section-t">Odometer and fuel</div>
      <div className="card">
        <div className="rows">
          {p.odometer.map((o, i) => (
            <div className="row" key={i}>
              <div className="grow">
                <div className="name num">{num(o.reading_km)} km {o.flag && <Pill tone="warn">{cap(o.flag)}</Pill>}</div>
                <div className="sub">{joinDots([cap(o.kind), whenText(o.at), o.check, o.photo_reading != null ? `photo shows ${o.photo_reading}` : ""])}</div>
              </div>
              {o.photo && <a className="btn small" href={o.photo} {...ext}>Photo</a>}
            </div>
          ))}
          {p.fuel.map((f, i) => (
            <div className="row" key={"f" + i}>
              <div className="grow">
                {/* Round 4–7 (§33.6): no amount given is "–", never LKR 0. */}
                <div className="name">{joinDots([f.litres != null ? `${num(f.litres)} L` : "", amountText(f.amount_lkr)])}</div>
                <div className="sub">{joinDots(["Fuel", whenText(f.at), f.video ? videoWords(f.video) : ""])}</div>
              </div>
              {f.video?.status === "uploaded" && f.id && can(me, "vehicles") && <Link className="btn small" to={`/fuel/${f.id}${f.at ? `?range=custom&from=${f.at.slice(0, 10)}&to=${f.at.slice(0, 10)}` : ""}`}><Icon name="video" />Video</Link>}
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
                  <div className="grow"><div className="name">{cap(r.category)}</div><div className="sub">{whenText(r.at)} · {cap(r.status)}{r.note ? " · " + r.note : ""}</div></div>
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
          {canChange && <Link className="btn dark" to={declined ? findDriverPath(id) : `/tasks/${id}/edit${q}`} state={FROM_TASK}>{declined ? "Give it a driver" : "Change the task"}</Link>}
          {canCancel && <Link className="btn danger" to={`/tasks/${id}/edit${q}#cancel`} state={FROM_TASK}>Cancel task</Link>}
        </div>
      )}
      {p.assignment_history?.length ? (
        <>
          <div className="section-t">History</div>
          <div className="card card-b" data-testid="history">
            <dl className="kv">
              {p.assignment_history.map((e, i) => (
                <div key={i} style={{ gridColumn: "1/-1" }}>
                  <dt>{whenText(e.at)}</dt>
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
      </div>
      </div>
    </div>
  );
}

/**
 * The task's status banner while it is on the way (the approved mockup 4): "On the way to <stop>", arrives about, back
 * about, the late chip; a click opens Live with the driver on this task selected (/live?task=<id>). In the other states the
 * page's top already says the state (the pill), so no second banner says it again. Round 4–7 (the Status row gone): the
 * driver's location when it is not live ("not sharing location", "location 12 min old") is on its line.
 */
function TaskBanner({ t }: { t: TaskDetailData["task"] }) {
  const eta = t.eta;
  if (t.status !== "in_progress") return null;
  const times = joinDots([eta?.next ? `Arrives about ${eta.next}` : "", eta?.final ? `back about ${eta.final}` : ""]) || "On the way now";
  return (
    <StatusBanner tone="live" icon="navigation" to={liveForTask(t.id)} testId="task-banner"
      title={`On the way${eta?.next_stop ? ` to ${eta.next_stop}` : ""}`}
      line={joinDots([times, locationWords(t)])}
      chip={eta?.late_min ? { text: `${duration(eta.late_min)} late`, tone: "warn" } : null} />
  );
}

/**
 * A swap reading the driver's phone has not sent, typed by the office (swap_reading): the old vehicle's end or the new
 * vehicle's start (a towed vehicle). The task is loaded again after it.
 */
function SwapReadingForm({ taskId, vehicle, needEnd, needStart, onDone }: {
  taskId: string;
  vehicle: string;
  needEnd: boolean;
  needStart: boolean;
  onDone: () => Promise<void>;
}) {
  const { transport, store } = useFleet();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const kind = needStart ? "start" : needEnd ? "end" : null;
  if (!kind || !vehicle) return null;
  const id = `swap-${kind}-${vehicle.replace(/\W/g, "")}`;
  async function save() {
    const km = Number(value.replace(/[,\s]/g, ""));
    if (!Number.isInteger(km) || km < 0) {
      setMsg("Type the odometer in whole km.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await transport.call("swap_reading", { task_id: taskId, vehicle, ...(kind === "end" ? { end_km: km } : { start_km: km }) });
      toast("Reading saved");
      setValue("");
      void store.invalidate();
      await onDone();
    } catch (e) {
      setMsg(errText(e as FleetError)[0]);
    }
    setBusy(false);
  }
  return (
    <div className="field" style={{ marginTop: 6 }} data-testid="swap-reading">
      <label htmlFor={id}>{kind === "end" ? `${vehicle}'s odometer when it was swapped out (km)` : `${vehicle}'s odometer when it was swapped in (km)`}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input id={id} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn small" disabled={busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      </div>
      {msg && <span className="hint" style={{ color: "var(--bad)" }}>{msg}</span>}
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

/**
 * The route between Start task and Save & finish (or now), on the same map as the driver page, with GPS km next to the
 * odometer. Snapped to roads by default where the server allows it (§26), "Recorded points" shows the raw line; the gaps
 * as markers on the map (§21) and one "No GPS for …" line under it (Round 4–7: the Gaps list went, as on a driver's day).
 * Round 48: the task page is itself the right pane of the Tasks split view, so its route is the stacked pane (the map at
 * a fixed height), with the same compact legend, ⓘ sheet, Layers filter, pins, dots and clusters as the driver page
 * (docs/ui-patterns.md §18).
 */
function TaskRoute({ id, started }: { id: string; started?: string | null }) {
  const { transport } = useFleet();
  const [route, setRoute] = useState<Route | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Snap to roads only while Google's map is the one drawn, or under the open package (Part 6).
  const [snapWanted, setSnap] = useState(true);
  const mapChoice = useGoogleMap();
  const snap = snapWanted && snapAllowed(mapChoice);
  const [focus, setFocus] = useState<RoutePoint[] | null>(null);
  useEffect(() => {
    if (!started) return;
    let alive = true;
    setBusy(true);
    transport.call<DriverRoute>("driver_route", { task_id: id, line_tolerance_m: 0, max_line_points: 3000, snap, estimate_gaps: true })
      .then((p) => { if (alive) { setRoute(routeOf("", p)); setErr(null); } })
      .catch((e) => { if (alive) setErr(errText(e as FleetError)[0]); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [id, started, transport, snap]);
  const mapRoute = useMemo(() => mapRouteOf(route, null, snap), [route, snap]);
  // The Events layer (Round 48): the Filter button on the strip, the value in the URL (?layers=events), off by default.
  const layers = useUrlFilters([LAYERS_DEF]);
  const events = eventsOn(layers.values);
  const marks = useRouteMarks(route, snap, setFocus, { events, latest: !route?.window?.to });
  const layout = useRouteLayout(true);
  if (!started) return null;
  const noGps = route ? noGpsLine(route.gaps) : null;
  const line = route && !route.note
    ? joinDots([`GPS ${num(route.km)} km`, `driving ${minutesText(route.drivingMinutes)}`, `stopped ${minutesText(route.stoppedMinutes)}`, route.stopsCount ? `${route.stopsCount} stop${route.stopsCount > 1 ? "s" : ""} of 10 min or more` : "no stops of 10 min or more"])
    : route?.note;
  return (
    <>
      <div className="section-t">Route</div>
      <div className="card card-b stack" data-testid="task-route">
        {busy && !route && <Loading>Loading the route…</Loading>}
        {err && <Notice tone="bad">{err}</Notice>}
        {route && route.points.length > 0 && (
          <RouteMapPane
            layout={layout}
            strip={<RouteLegend route={route} snap={snap} onSnap={(raw) => setSnap(!raw)} busy={busy} events={events} extra={<FilterBar filters={[LAYERS_DEF]} values={layers.values} onChange={layers.apply} />} />}
            map={<MapView markers={[]} route={mapRoute} focus={focus} onPick={() => undefined} gaps={marks.marks} openGap={marks.open} onGap={marks.onMark} height={layout.mapHeight} />}
          />
        )}
        {/* What the line is (snapped, raw) moved to the legend strip and the ⓘ sheet (Round 48). */}
        {line && <p className="muted small" style={{ margin: 0 }}>{line}</p>}
        {/* Round 4–7 (approved by Sahan 22 October 2026; the driver's day page's way, §33.6): the gaps as ONE line, "No GPS for
            2 h 10 min" (driver_route's gaps added up), in place of the Gaps list; each gap keeps its marker on the map. */}
        {noGps && <p className="day-gaps" data-testid="route-gaps"><Icon name="alert" />{noGps}{route && route.gaps.length > 1 ? ` · ${route.gaps.length} gaps` : ""}</p>}
      </div>
    </>
  );
}
