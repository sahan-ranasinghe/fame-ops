// Decide a request (/requests/:id/decide). A waiting one: the driver first and
// the vehicle they bring (Phase 7, §3; or one picked from the free vehicles in
// four groups, the assigned ones saying "ask first" with the custodian's
// links), who's available with the best match and Use suggestion, the stops
// with the time at each (§17), the plan as a timeline with the overlaps as
// cards, Approve (& send to the driver) or Decline with a reason. An approved
// booking (changed by the requester, or not): what changed, who's available,
// Keep as asked / Change the driver, vehicle or time / Decline with a reason
// (Phase 6). The answers stay on screen while they refresh, and a choice is
// never reset by a refresh (§10). The pick and the reason are kept as a draft.
// Phase 7 (§33, §34): a waiting proposed task, or a request planned with its
// stops, gets the trip decide page (TripDecide); an old request (From and To
// only) keeps this one. The page is chosen once, on the first answer.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { DecideResult, RedecideResult, RequestCard, SuggestedVehicle, Suggestions } from "../data/types";
import { useQuery } from "../data/useQuery";
import { cap, joinDots, requestTone, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { TimeInput } from "../ui/TimeInput";
import { useToast } from "../ui/Toast";
import { decidesTrip } from "./approvalLogic";
import { availabilityArgs, driverVehicle, withPicked } from "./availabilityLogic";
import { AvailabilityPanel, scrollToAvailability, useAvailability, vehicleFor } from "./AvailabilityPanel";
import { ConflictCards } from "./ConflictCards";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DecidedBy, refreshRequest, ReviewingLine, useReviewing } from "./approvers";
import { basePlace, DepartureNote, useFleetSettings, usePlanPreview, VehicleChoiceRadios, vehicleOnTheDay } from "./dispatchParts";
import { DwellPicker } from "./DwellPicker";
import { dwellFallbacks, planReasons } from "./planLogic";
import { PlanWithMap } from "./PlanMap";
import { RequestDetailCard } from "./RequestDetailCard";
import { useRequest } from "./RequestDetail";
import { decisionInput, dwellChanges, redecideInput } from "./requestLogic";
import { VehicleGroups, VehicleOption } from "./requestParts";
import { newStop, parseDwell, type StopDraft } from "./stopsLogic";
import { TripDecide } from "./TripDecide";
import { knownDef, ON_THE_DAY, shownVehicle, vehicleArg, vehicleDefault } from "./vehicleChoiceLogic";

interface Decision {
  /** The vehicle picked; "" = the one the driver brings (or, deciding again, keep the vehicle). */
  vehicle: string;
  /** The driver picked; "" = the best match (or, deciding again, keep the driver). */
  driver: string;
  reason: string;
  /** The redecision's own changes (Change): a new day, time or back-by. */
  date: string;
  time: string;
  back: string;
  /** The time at From / To as chosen here; absent = as the request says. */
  fromDwell?: string;
  toDwell?: string;
}

type Decided = DecideResult;

/** The From and To as rows, for the stops' first times (the plan preview answers them in this order). */
const routeRows = (from: string, to: string): StopDraft[] => [
  { ...newStop("pickup"), key: "from", place: from || "To be confirmed" },
  { ...newStop("drop"), key: "to", place: to || "To be confirmed" },
];

export function RequestDecide() {
  const { id = "" } = useParams();
  const { q, err, setQ } = useRequest(id);
  // Chosen once: once decided, the request is approved and the answer stays on the page that sent it.
  const [trip, setTrip] = useState<boolean | null>(null);
  useEffect(() => {
    if (q && trip === null) setTrip(decidesTrip(q));
  }, [q, trip]);
  if (err) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Notice tone="bad">{err}</Notice></section>;
  if (!q || trip === null) return <section className="view"><PageTop title="Vehicle request" backTo="/requests" /><Loading>Loading the request…</Loading></section>;
  return trip ? <TripDecide id={id} q={q} setQ={setQ} /> : <ClassicDecide id={id} q={q} setQ={setQ} />;
}

/** A request with From and To only (and every changed or approved booking decided again). */
function ClassicDecide({ id, q, setQ }: { id: string; q: RequestCard; setQ: (q: RequestCard) => void }) {
  const [params] = useSearchParams();
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const lists = useLists();
  const settings = useFleetSettings();
  const base = basePlace(settings.data);
  const [f, setF, draft] = useFormDraft<Decision>("request-decide", id, { vehicle: "", driver: "", reason: "", date: "", time: "", back: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: React.ReactNode; warnings?: string[] } | null>(null);
  const suggests = me.tools.includes("suggest_vehicles");
  const set = <K extends keyof Decision>(k: K, v: Decision[K]) => setF((x) => ({ ...x, [k]: v }));
  const again = q?.status === "approved" || q?.status === "changed";

  // The free vehicles, once and quietly every minute; the groups never collapse into "Finding…" again.
  const sugQ = useQuery<Suggestions>("suggest", "suggest_vehicles", { request_id: id }, { enabled: suggests, every: 60_000 });
  const sug = sugQ.data;
  const sugNote = sugQ.err && !sug ? "Suggestions are not available (" + errText(sugQ.err)[0] + "). Pick a vehicle and driver yourself." : null;
  // Opening the suggestions marks the request seen: show the card it answers (the same object while nothing changed).
  useEffect(() => {
    if (sug?.request) setQ(sug.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sug?.request]);

  const fields = q?.fields;
  const availArgs = fields
    ? availabilityArgs(f.date || fields.date, f.time || fields.time, f.back || fields.back_by, fields.need_type, fields.pax == null ? "" : String(fields.pax), fields.route_from ? { place: fields.route_from } : null)
    : null;
  const avail = useAvailability(availArgs);

  const options: SuggestedVehicle[] = sug?.vehicles.length
    ? sug.vehicles
    : (lists.vehicles ?? []).map((v) => ({ reg_no: v.reg_no, make_model: v.make_model, seats: v.seats, availability: v.availability || v.status || "", pick: "good", assigned_to: v.assigned_to }));
  const allOptions = sug?.groups ? Object.values(sug.groups).flat() : options;
  const drivers = sug?.drivers.length
    ? sug.drivers.map((d) => ({ username: d.username, name: d.name, label: d.availability }))
    : (lists.drivers ?? []).filter((d) => d.active !== false).map((d) => ({ username: d.username, name: d.name, label: "" }));
  const ready = sug !== undefined || sugNote !== null || !suggests;

  // Defaults, only while the person has not chosen: the best match (or the first free driver), and the vehicle they bring.
  const noDriverNeeded = q?.driver_required === false;
  // Who's available decides it once it answers (its best match holds while the day and time stay), so the default does
  // not start as the first free driver and then jump.
  const availDefault = avail.data ? avail.data.best?.username ?? avail.data.vehicles.drivers_free[0]?.username : undefined;
  const defaultDriver = again || noDriverNeeded ? "" : availDefault ?? (avail.loading ? "" : sug?.drivers_free?.[0]?.username) ?? "";
  const driver = f.driver || defaultDriver;
  const def = driver ? driverVehicle(vehicleFor(avail.data, driver), lists.drivers?.find((d) => d.username === driver), (lists.drivers ?? []).filter((d) => d.active !== false).map((d) => d.name)) : null;
  // Hotfix 2 (J): with vehicle_on_the_day on, a later day (or a driver who brings none today) leaves the vehicle to the day.
  const onDay = vehicleOnTheDay(settings.data);
  const dflt = again ? null : vehicleDefault({ on: onDay, date: fields?.date ?? "", today: today(), driver, def: knownDef(def, !!avail.data || !me.tools.includes("availability")) });
  const dayDefault = dflt?.kind === "on_the_day";
  const vehicle = again ? f.vehicle : shownVehicle(f.vehicle, dflt);
  // The select always holds the driver picked (from Who's available too), even when its list lacks them.
  const driverOptions: { username: string; name: string; label?: string }[] = withPicked(drivers, driver, avail.data?.drivers.find((d) => d.username === driver)?.name);
  const picked = allOptions.find((v) => v.reg_no === vehicle);
  const custodianDrives = !again && noDriverNeeded && !!picked?.assigned_to && sug?.self_drive_allowed !== false;
  // A driver picked in the list keeps a vehicle picked by hand; Use suggestion and a row of Who's available take the
  // driver with the vehicle they bring.
  const pickDriver = (username: string) => setF((x) => ({ ...x, driver: username }));
  const takeSuggestion = (username: string) => setF((x) => ({ ...x, driver: username, vehicle: "" }));

  // The stops and their times: From and To with the time at each (as the request says until changed here).
  const fromDwell = f.fromDwell ?? (fields?.from_dwell_min == null ? "" : String(fields.from_dwell_min));
  const toDwell = f.toDwell ?? (fields?.to_dwell_min == null ? "" : String(fields.to_dwell_min));
  const rows = routeRows(fields?.route_from ?? "", fields?.route_to ?? "");
  const dw = (text: string) => {
    const m = parseDwell(text);
    return typeof m === "number" ? { dwell_min: m } : {};
  };
  const planArgs = fields && !again && me.tools.includes("plan_task")
    ? {
      date: fields.date,
      leave_by: fields.time,
      stops: [{ type: "pickup", place: rows[0].place, ...dw(fromDwell) }, { type: "drop", place: rows[1].place, ...dw(toDwell) }],
      ...(driver && !custodianDrives ? { driver } : {}),
      ...(f.vehicle || (custodianDrives && vehicle) ? { vehicle } : {}),
      ...(fields.back_by ? { end_time: fields.back_by } : {}),
    }
    : null;
  const plan = usePlanPreview(planArgs);
  const preview = plan.err ? null : plan.data ?? null;
  // Hotfix 2 (K): this page is open (every 20 s), and who else has it open.
  const reviewers = useReviewing(id, q.status === "waiting" || q.status === "changed");
  const fallbacks = dwellFallbacks(rows, preview?.stops, settings.data?.settings.dwell_min);
  // Leaving at the time asked for, is the vehicle back by the time asked for (§20)? Said in the plan card; the requester's times stay.
  const backCheck = fields?.back_by ? checkDeparture(fields.time ?? "", departurePlan(preview?.timeline, preview?.plan?.buffer_min, fields.back_by)) : null;

  async function decide(decision: "approve" | "decline") {
    if (!q) return;
    // The driver's vehicle: known (Who's available), known to be none, or not known yet (the server decides).
    const knownDefault = def?.reg_no ?? (avail.data || !me.tools.includes("availability") ? null : undefined);
    const v = decisionInput({
      id, version: q.version, decision, reason: f.reason, vehicle: custodianDrives ? vehicle : vehicleArg(f.vehicle, dflt), driver: custodianDrives ? "" : driver,
      decidedBy: me.name, custodianDrives, defaultVehicle: knownDefault,
    });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    const times = decision === "approve" ? dwellChanges({ fromDwell, toDwell }, fields) : null;
    if (times === "bad") {
      setMsg({ tone: "bad", text: "The time at a stop must be minutes or h:mm, up to 12 h." });
      return;
    }
    setBusy(true);
    try {
      // The times at From and To set here go onto the task's stops (the request keeps its own); a cleared one uses the request's.
      const stopTimes = Object.fromEntries(Object.entries(times ?? {}).filter(([, n]) => n !== null));
      const p = await transport.call<Decided>("decide_request", { ...v.input, ...stopTimes });
      draft.clear();
      void store.invalidate();
      if (decision === "approve") {
        setMsg({
          tone: "ok",
          warnings: warnList(p),
          text: (
            <>
              <b>Approved.</b> {custodianDrives ? `${picked?.assigned_to} drives it.` : "The task is in the driver’s app."}{" "}
              {p.vehicle_changed ? <span data-testid="vehicle-used">{p.vehicle_changed}. </span>
                : p.vehicle_used ? <span data-testid="vehicle-used">Vehicle: {p.vehicle_used.reg_no} · {p.vehicle_used.why === "chosen" ? "as picked" : p.vehicle_used.why}. </span>
                : p.vehicle ? <span data-testid="vehicle-used">Vehicle: {p.vehicle}. </span> : null}
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
      // Refused (another approver decided it first: "Already approved by Palitha at 10:42"): the server's words, and the
      // card as it is now. Never a second decision.
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
      void refreshRequest(transport, id, setQ, () => store.invalidate());
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
              {p.task?.vehicle && <span data-testid="vehicle-used">Vehicle: {p.task.vehicle}{p.task.driver ? ` · ${p.task.driver}` : ""}. </span>}
              {p.task?.task_id && <Link className="btn small" to={`/tasks/${p.task.task_id}`}>Open task</Link>}{" "}
              <Link className="btn small" to={`/requests/${id}`}>The request</Link>
            </>
          ),
        });
      }
    } catch (e) {
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
      void refreshRequest(transport, id, setQ, () => store.invalidate());
    }
    setBusy(false);
  }

  const decides = me.tools.includes("decide_request");
  const redecides = me.tools.includes("redecide_request");
  if ((q.status !== "waiting" && !again) || (q.status === "waiting" && !decides) || (again && !redecides)) {
    return (
      <section className="view">
        <PageTop title="Vehicle request" sub={<Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>} backTo={`/requests/${id}`} />
        {/* A decision just made here, or the server's refusal of a second one ("Already approved by Palitha at 10:42"). */}
        {msg && <div style={{ marginBottom: 12 }} data-testid="decide-message"><Notice tone={msg.tone}>{msg.text}</Notice>{msg.warnings && <WarningsNote warnings={msg.warnings} />}</div>}
        {msg?.tone !== "ok" && <Notice tone="info">This request is {q.status}; there is nothing to decide. <Link to={`/requests/${id}`}>Open the request</Link>.</Notice>}
        <DecidedBy q={q} />
      </section>
    );
  }
  const updating = sugQ.updating ? <span className="updated" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · Updating…</span> : null;
  const scrollToVehicles = () => document.getElementById("rq-vehicles")?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (again) {
    const againDef = f.driver ? def : null;
    return (
      <section className="view" data-testid="request-redecide">
        <PageTop title={q.status === "changed" ? "Decide the change" : "Change the booking"} sub={<>{q.requested_by} · {joinDots([q.when, q.route])}</>} backTo={`/requests/${id}`} />
        <ReviewingLine list={reviewers} block />
        <DraftBanner draft={draft} />
        <div className="page-form">
          <RequestDetailCard q={q} compact />
          <div className="card card-b form">
            <div className="section-t" style={{ marginBottom: 2 }}>Change the driver, the vehicle or the time{updating}</div>
            <p className="muted small" style={{ margin: 0 }}>Leave everything as it is and press Keep to approve the booking as it now asks.</p>
            {sugNote && <Notice>{sugNote}</Notice>}
            <div className="field">
              <label htmlFor="rq-driver">Driver</label>
              <select id="rq-driver" value={f.driver} onChange={(e) => pickDriver(e.target.value)}>
                <option value="">Keep the driver</option>
                {driverOptions.map((d) => <option key={d.username} value={d.username}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
              </select>
            </div>
            {!ready ? <Loading>Finding free vehicles…</Loading> : (
              <>
                <div className="lab" id="rq-vehicles">Vehicle</div>
                <label className="opt"><input type="radio" name="rq-veh" value="" checked={f.vehicle === ""} onChange={() => set("vehicle", "")} />
                  <span className="grow">{againDef ? <>{againDef.reg_no} · {againDef.why}</> : "Keep the vehicle"}</span></label>
                {onDay && <VehicleChoiceRadios name="rq-veh" value={f.vehicle} onPick={(v) => set("vehicle", v)} />}
                {sug?.groups
                  ? <VehicleGroups sug={sug} name="rq-veh" vehicle={f.vehicle} onPick={(reg) => set("vehicle", reg)} />
                  : options.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={f.vehicle === v.reg_no} onPick={() => set("vehicle", v.reg_no)} />)}
              </>
            )}
            <div className="grid2">
              <div className="field"><label htmlFor="rq-date">Day</label><input type="date" id="rq-date" value={f.date} placeholder={q.fields?.date} onChange={(e) => set("date", e.target.value)} /></div>
              <div className="field"><label htmlFor="rq-time">Time</label><TimeInput id="rq-time" value={f.time} onCommit={(time) => set("time", time)} /></div>
              <div className="field"><label htmlFor="rq-back">Back by</label><TimeInput id="rq-back" value={f.back} onCommit={(back) => set("back", back)} /></div>
            </div>
            <p className="hint" style={{ margin: 0 }}>Now {q.when}{q.back_by ? ` · back by ${q.back_by}` : ""}. A new time alone postpones the booking.</p>
          </div>
          <AvailabilityPanel args={availArgs} picked={f.driver} onPick={(d) => { if (d.username) takeSuggestion(d.username); }} onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />
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

  const reasons = planReasons({ date: fields?.date ?? "", stops: rows, leaveBy: fields?.time ?? "", start: base?.name ?? "", returnToBase: false }, preview, plan.err ? errText(plan.err)[0] : null);
  return (
    <section className="view" data-testid="request-decide">
      <PageTop title="Decide the request" sub={<>{q.requested_by} · {joinDots([q.when, q.route])}</>} backTo={`/requests/${id}`} />
      <ReviewingLine list={reviewers} block />
      <DraftBanner draft={draft} />
      <div className="page-form">
        {/* An old request keeps today's page: no leave-by to move here, so no "Leave-by passed" advice either. */}
        <RequestDetailCard q={q} compact hideLate />
        <div className="card card-b form" data-testid="decide-pick">
          <div className="section-t" style={{ marginBottom: 2 }}>Driver and vehicle{updating}</div>
          {sugNote && <Notice>{sugNote}</Notice>}
          <div className="field">
            <label htmlFor="rq-driver">Driver</label>
            {custodianDrives
              ? <p className="muted small" style={{ margin: 0 }} id="rq-driver">{picked?.assigned_to} drives it: no driver needed.</p>
              : (
                <select id="rq-driver" value={driver} onChange={(e) => pickDriver(e.target.value)}>
                  <option value="">{noDriverNeeded ? "No driver: pick the custodian’s vehicle" : "Pick a driver"}</option>
                  {driverOptions.map((d) => <option key={d.username} value={d.username}>{d.name}{d.label ? ` · ${d.label}` : ""}</option>)}
                </select>
              )}
            {!f.driver && defaultDriver && (
              <span className="hint" data-testid="driver-default">
                {defaultDriver === avail.data?.best?.username ? "The best match" : "The first free driver"}. Pick another to change it.
              </span>
            )}
          </div>
          <div className="lab" id="rq-vehicles">Vehicle</div>
          {(driver || dayDefault) && !custodianDrives && (
            <p className="hint" style={{ margin: 0 }} data-testid="vehicle-default">
              {dayDefault
                ? (f.vehicle && f.vehicle !== ON_THE_DAY
                  ? <>Instead of the driver's vehicle on the day. <button type="button" className="linkish" onClick={() => set("vehicle", "")}>Leave it to the day</button></>
                  : <>The driver's vehicle on the day: they confirm it at Start task. Pick another below to change it.</>)
                : f.vehicle && def && f.vehicle !== def.reg_no
                ? <>Instead of {def.why} {def.reg_no}. <button type="button" className="linkish" onClick={() => set("vehicle", "")}>Use {def.reg_no}</button></>
                : def ? <>{def.reg_no} · {def.why}. Pick another below to change it.</>
                : <>This driver holds no vehicle today and has no regular one: pick one below.</>}
            </p>
          )}
          {!ready ? <Loading>Finding free vehicles…</Loading> : (
            <>
              {onDay && !custodianDrives && <VehicleChoiceRadios name="rq-veh" value={vehicle} dayDefault={dayDefault} onPick={(v) => set("vehicle", v)} />}
              {sug?.groups
                ? <VehicleGroups sug={sug} name="rq-veh" vehicle={vehicle} onPick={(reg) => set("vehicle", reg)} />
                : options.map((v) => <VehicleOption key={v.reg_no} v={v} name="rq-veh" checked={vehicle === v.reg_no} onPick={() => set("vehicle", v.reg_no)} />)}
              {options.length === 0 && <Empty>No vehicles registered yet.</Empty>}
            </>
          )}
        </div>
        {!custodianDrives && <AvailabilityPanel args={availArgs} picked={driver} onPick={(d) => { if (d.username) takeSuggestion(d.username); }} onUse={(b) => { if (b.username) takeSuggestion(b.username); }} />}
        <div className="card card-b form" data-testid="decide-stops">
          <div className="section-t" style={{ marginBottom: 2 }}>Stops</div>
          <p className="muted small" style={{ margin: 0 }}>Start from {base ? base.name : "the base place"} (the base place). Passengers get in at Stop 1.</p>
          <div className="stop-card" data-testid="stop-row">
            <b data-testid="stop-label">Stop 1 · Pickup · {rows[0].place}</b>
            <DwellPicker id="rq-from-dwell" value={fromDwell} onChange={(v) => set("fromDwell", v)} fallback={fallbacks.get("from") ?? null} />
          </div>
          <div className="stop-card" data-testid="stop-row">
            <b data-testid="stop-label">Stop 2 · Drop · {rows[1].place}</b>
            <DwellPicker id="rq-to-dwell" value={toDwell} onChange={(v) => set("toDwell", v)} fallback={fallbacks.get("to") ?? null} />
          </div>
          {(f.fromDwell !== undefined || f.toDwell !== undefined) && dwellChanges({ fromDwell, toDwell }, fields) && (
            <p className="hint" style={{ margin: 0 }}>The new times are saved on the request when you approve.</p>
          )}
        </div>
        {planArgs && (
          <div className="card card-b form" data-testid="plan-card">
            <div className="row" style={{ padding: 0 }}>
              <b className="grow">Plan</b>
              <button type="button" className="btn small" onClick={plan.refetch} disabled={plan.fetching}>{plan.fetching ? "Planning…" : "Plan now"}</button>
            </div>
            {backCheck?.kind === "late" && backCheck.back && <DepartureNote check={backCheck} testId="departure-check-back" />}
            <PlanWithMap timeline={preview?.timeline} plan={preview?.plan} startName={preview?.start?.name} reasons={reasons} updating={plan.updating} leaveNote="the time asked for"
              stops={preview?.stops} start={preview?.start} />
            <ConflictCards conflicts={preview?.conflicts} onPickVehicle={scrollToVehicles} onPickDriver={scrollToAvailability} />
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
