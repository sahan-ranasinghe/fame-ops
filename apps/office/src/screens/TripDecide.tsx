// Decide a proposed task, or a request planned with its stops (Phase 7, §33,
// §34; /requests/:id/decide). The stops and the plan as asked, read only (the
// timeline and the map); the proposal's warnings and conflicts as proposed; the
// proposed driver and vehicle filled in (Who's available still picks another
// driver with the vehicle they bring; a request takes the best match); the day,
// the leave-by and the back-by the approver may move (sent only when changed: a
// new day or leave-by plans the trip again on the server, the stops stay); Send
// as proposed (Approve and send once anything changed) or Decline with a reason.
// A late one says "Leave-by passed · not decided" first. The choices are kept as
// a draft and no refresh resets them (§10).
import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useFormDraft } from "../data/drafts";
import { useLists } from "../data/hooks";
import type { Conflict, DecideResult, RequestCard, Suggestions } from "../data/types";
import { useQuery } from "../data/useQuery";
import { cap, joinDots, requestTone, today, warnList } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Notice, Pill, WarningsNote } from "../ui/basics";
import { DraftBanner } from "../ui/DraftBanner";
import { PageTop, StickyActions } from "../ui/Page";
import { TimeInput } from "../ui/TimeInput";
import { useToast } from "../ui/Toast";
import { askedTimes, decideLabel, emptyTripDecision, isProposal, requestView, shownTimes, type TripDecision, tripDecideInput, tripPick } from "./approvalLogic";
import { linkedDriver } from "./asks/askLogic";
import { availabilityArgs, type DefaultVehicle, driverVehicle, floorTo5, withPicked } from "./availabilityLogic";
import { AvailabilityPanel, scrollToAvailability, useAvailability, vehicleFor } from "./AvailabilityPanel";
import { ConflictCards } from "./ConflictCards";
import { checkDeparture, departurePlan } from "./departureLogic";
import { DecidedBy, refreshRequest, ReviewingLine, useReviewing } from "./approvers";
import { DepartureNote, DriverSelect, useFleetSettings, VehicleSelect, vehicleOnTheDay } from "./dispatchParts";
import { RequestDetailCard } from "./RequestDetailCard";
import { LateNotice } from "./requestParts";
import { TripSection, useTripLine } from "./RequestTrip";
import { knownDef, ON_THE_DAY, vehicleDefault } from "./vehicleChoiceLogic";

export function TripDecide({ id, q, setQ }: { id: string; q: RequestCard; setQ: (q: RequestCard) => void }) {
  const { me, store, transport } = useFleet();
  const navigate = useNavigate();
  const toast = useToast();
  const lists = useLists();
  const [params] = useSearchParams();
  // Part 3b (H3): Assign on a driver's Yes opens the page with ?driver=<username> (the fresh form takes them).
  const [f, setF, draft] = useFormDraft<TripDecision>("request-decide-trip", id, () => ({ ...emptyTripDecision(), driver: linkedDriver(params) }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok"; text: ReactNode; warnings?: string[]; conflicts?: Conflict[] } | null>(null);
  // Sent: the answer stays on this page (the request is approved now).
  const [sent, setSent] = useState(false);
  const set = <K extends keyof TripDecision>(k: K, v: TripDecision[K]) => setF((x) => ({ ...x, [k]: v }));
  const trip = useTripLine(q);
  const view = requestView(q, me);
  const proposal = isProposal(q);
  const proposed = proposal ? q.proposed : undefined;

  // The free vehicles and drivers, quietly every minute; opening them marks the request seen.
  const sugQ = useQuery<Suggestions>("suggest", "suggest_vehicles", { request_id: id }, { enabled: me.tools.includes("suggest_vehicles"), every: 60_000 });
  const sug = sugQ.data;
  useEffect(() => {
    if (sug?.request) setQ(sug.request);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sug?.request]);

  // The day and the times as the fields show them (as asked until changed); Who's available looks from the leave-by.
  const was = askedTimes(q);
  const shown = shownTimes(f, was);
  const first = trip?.stops[0];
  const availArgs = availabilityArgs(shown.date, floorTo5(shown.leaveBy), shown.back, q.fields?.need_type, q.fields?.pax == null ? "" : String(q.fields.pax),
    first?.lat != null && first.lng != null && !first.google ? { lat: first.lat, lng: first.lng } : first?.place ? { place: first.place } : null);
  const avail = useAvailability(availArgs);
  const settings = useFleetSettings();
  // Hotfix 2 (K): this page is open (every 20 s), and who else has it open.
  const reviewers = useReviewing(id, q.status === "waiting");

  // The driver: picked, else the proposed one, else (a request) the best match once Who's available answers.
  const noDriverNeeded = q.driver_required === false;
  const availDefault = avail.data ? avail.data.best?.username ?? avail.data.vehicles.drivers_free[0]?.username : undefined;
  const defaultDriver = proposed?.username ?? (noDriverNeeded ? "" : availDefault ?? (avail.loading ? "" : sug?.drivers_free?.[0]?.username) ?? "");
  const driver = f.driver || defaultDriver;
  const active = (lists.drivers ?? []).filter((d) => d.active !== false);
  const driverVeh = driver ? driverVehicle(vehicleFor(avail.data, driver), active.find((d) => d.username === driver), active.map((d) => d.name)) : null;
  // The proposed driver brings the proposed vehicle; another driver brings their own.
  const asProposedDriver = !!proposed?.username && driver === proposed.username;
  const def: DefaultVehicle | null = asProposedDriver && proposed?.vehicle ? { reg_no: proposed.vehicle, why: "the proposed vehicle" } : driverVeh;
  // The driver's vehicle known, known to be none, or not known yet (the server decides).
  const knownVehicle = driverVeh?.reg_no ?? (avail.data || !me.tools.includes("availability") ? null : undefined);
  // Hotfix 2 (J): with vehicle_on_the_day on, a later day (or a driver who brings none today) leaves the vehicle to the
  // day; a proposal sent with its proposed driver keeps the vehicle it was proposed with.
  const onDay = vehicleOnTheDay(settings.data);
  const dflt = asProposedDriver ? null : vehicleDefault({ on: onDay, date: shown.date, today: today(), driver, def: knownDef(driverVeh, knownVehicle !== undefined) });
  const dayDefault = dflt?.kind === "on_the_day";
  const pickArgs = {
    f: dayDefault && !f.vehicle ? { ...f, vehicle: ON_THE_DAY } : f, was, driver,
    proposed: proposed ? { username: proposed.username, vehicle: proposed.vehicle } : undefined, driverVehicle: knownVehicle, noDriverNeeded,
  };
  const pick = tripPick(pickArgs);
  const custodianDrives = noDriverNeeded && !driver && !!f.vehicle;
  const vehicles = sug?.vehicles.length
    ? sug.vehicles.map((v) => ({ reg_no: v.reg_no, make_model: v.make_model, status: v.availability }))
    : (lists.vehicles ?? []).map((v) => ({ reg_no: v.reg_no, make_model: v.make_model, status: v.availability || v.status }));
  const driverName = (u: string) =>
    active.find((d) => d.username === u)?.name ?? avail.data?.drivers.find((d) => d.username === u)?.name ?? (u === proposed?.username ? proposed.driver : undefined) ?? u;
  // A driver picked in the list keeps a vehicle picked by hand; a row of Who's available takes the vehicle they bring.
  const takeDriver = (username: string) => setF((x) => ({ ...x, driver: username, vehicle: "" }));
  const timesChanged = Object.keys(pick.times).length > 0;
  // The departure checked at once against the plan as asked: a later leave-by that misses an arrive-by, or the back-by.
  const check = checkDeparture(shown.leaveBy, departurePlan(trip?.timeline, undefined, shown.back));

  async function decide(decision: "approve" | "decline") {
    const v = tripDecideInput({ ...pickArgs, id, decision, decidedBy: me.name, version: q.version });
    if ("error" in v) {
      setMsg({ tone: "bad", text: v.error });
      return;
    }
    setBusy(true);
    try {
      const p = await transport.call<DecideResult>("decide_request", v.input);
      draft.clear();
      void store.invalidate();
      if (decision === "decline") {
        toast(proposal ? "Task declined" : "Request declined");
        navigate("/requests");
        return;
      }
      setSent(true);
      setMsg({
        tone: "ok",
        warnings: warnList(p),
        conflicts: p.conflicts,
        text: (
          <>
            <b>{p.as_proposed ? "Sent as proposed." : custodianDrives ? "Approved." : "Approved and sent."}</b>{" "}
            {custodianDrives ? "The custodian drives it." : "The task is in the driver’s app."}{" "}
            {p.vehicle_changed ? <span data-testid="vehicle-used">{p.vehicle_changed}. </span>
              : p.vehicle_used ? <span data-testid="vehicle-used">Vehicle: {p.vehicle_used.reg_no} · {p.vehicle_used.why === "chosen" ? "as picked" : p.vehicle_used.why}. </span>
              : p.vehicle ? <span data-testid="vehicle-used">Vehicle: {p.vehicle}. </span> : null}
            {p.task_id && <Link className="btn small" to={`/tasks/${p.task_id}`}>Open task</Link>}{" "}
            <Link className="btn small" to={`/requests/${id}`}>The request</Link>
          </>
        ),
      });
    } catch (e) {
      // Refused (another approver decided it first: "Already approved by Palitha at 10:42"): the server's words, and the
      // card as it is now. Never a second decision.
      setMsg({ tone: "bad", text: errText(e as FleetError)[0] });
      void refreshRequest(transport, id, setQ, () => store.invalidate());
    }
    setBusy(false);
  }

  const title = proposal ? "Decide the task" : "Decide the request";
  const sub = proposal ? joinDots([q.title, q.when]) : <>{q.requested_by} · {joinDots([q.when, q.route])}</>;
  if (sent && msg) {
    return (
      <section className="view" data-testid="request-decided">
        <PageTop title={title} sub={sub} backTo="/requests" />
        <div className="page-form">
          <Notice tone={msg.tone}>{msg.text}</Notice>
          {msg.warnings && <WarningsNote warnings={msg.warnings} />}
          <ConflictCards conflicts={msg.conflicts} />
        </div>
      </section>
    );
  }
  if (q.status !== "waiting" || !me.tools.includes("decide_request")) {
    return (
      <section className="view">
        <PageTop title={title} sub={<Pill tone={requestTone(q.status)}>{cap(q.status)}</Pill>} backTo={`/requests/${id}`} />
        {/* The server's refusal of a second decision ("Already approved by Palitha at 10:42"). */}
        {msg && <div style={{ marginBottom: 12 }} data-testid="decide-message"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <Notice tone="info">This {proposal ? "task" : "request"} is {q.status}; there is nothing to decide. <Link to={`/requests/${id}`}>Open it</Link>.</Notice>
        <DecidedBy q={q} />
      </section>
    );
  }
  const updating = sugQ.updating ? <span className="updated" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}> · Updating…</span> : null;
  const focusVehicle = () => document.getElementById("rq-vehicle")?.focus();
  // The proposal's warnings and conflicts, to whoever may see them (§35 19).
  const checks = view.conflicts && proposed && (proposed.warnings?.length || proposed.conflicts?.length) ? proposed : null;

  return (
    <section className="view" data-testid="request-decide-trip">
      <PageTop title={title} sub={sub} backTo={`/requests/${id}`} />
      <ReviewingLine list={reviewers} block />
      <DraftBanner draft={draft} />
      <div className="page-form">
        {q.late && <LateNotice approver />}
        <RequestDetailCard q={q} compact hideLate />
        {trip && <TripSection trip={trip} leaveNote={proposal ? "as proposed" : "the time asked for"} />}
        {checks ? (
          <div className="card card-b form" data-testid="proposal-checks">
            <div className="section-t" style={{ marginBottom: 2 }}>As proposed</div>
            {(pick.driver || pick.vehicle) && <p className="hint" style={{ margin: 0 }}>These were checked for the proposed driver and vehicle; your pick is checked again when you send, and the answer lists any overlap.</p>}
            {checks.warnings?.length ? <WarningsNote warnings={checks.warnings} /> : null}
            <ConflictCards conflicts={checks.conflicts} onPickVehicle={focusVehicle} onPickDriver={scrollToAvailability} />
          </div>
        ) : null}
        <div className="card card-b form" data-testid="decide-pick">
          <div className="section-t" style={{ marginBottom: 2 }}>Driver and vehicle{updating}</div>
          {proposed?.driver && (
            <p className="muted small" style={{ margin: 0 }} data-testid="proposed-pick">
              Proposed by {q.requested_by}: {proposed.driver}{proposed.vehicle ? ` with ${proposed.vehicle}` : proposed.vehicle_text ? ` · ${proposed.vehicle_text}` : ""}{proposed.vehicle_why && proposed.vehicle_why !== "chosen" ? ` (${proposed.vehicle_why})` : ""}.
            </p>
          )}
          <DriverSelect id="rq-driver" value={driver} drivers={withPicked(active, driver, driverName(driver))} onChange={(u) => set("driver", u)}
            emptyLabel={noDriverNeeded ? "No driver: the custodian drives" : "Pick a driver"} loading={!lists.drivers && !lists.error} />
          {!f.driver && defaultDriver && !proposed?.username && (
            <span className="hint" data-testid="driver-default">{defaultDriver === avail.data?.best?.username ? "The best match" : "The first free driver"}. Pick another to change it.</span>
          )}
          <VehicleSelect id="rq-vehicle" value={f.vehicle} def={def} vehicles={vehicles} onChange={(reg) => set("vehicle", reg)}
            emptyLabel={noDriverNeeded && !driver ? "Pick the custodian’s vehicle" : "Pick a vehicle"}
            choices={onDay && !(noDriverNeeded && !driver)} dayDefault={dayDefault}
            hint={driver && !def && knownVehicle === null && !onDay ? "This driver holds no vehicle today and has no regular one: pick one." : undefined} />
        </div>
        {!custodianDrives && (
          <AvailabilityPanel args={availArgs} askFor={{ request: id }} picked={driver} onPick={(d) => { if (d.username) takeDriver(d.username); }} onUse={(b) => { if (b.username) takeDriver(b.username); }} />
        )}
        <div className="card card-b form" data-testid="decide-times">
          <div className="section-t" style={{ marginBottom: 2 }}>Day and times</div>
          <div className="grid2">
            <div className="field"><label htmlFor="rq-date">Day</label><input type="date" id="rq-date" value={shown.date} onChange={(e) => set("date", e.target.value)} /></div>
            <div className="field"><label htmlFor="rq-leave">Leave by</label><TimeInput id="rq-leave" value={shown.leaveBy} onCommit={(t) => set("leaveBy", t)} /></div>
            <div className="field"><label htmlFor="rq-back">Back by</label><TimeInput id="rq-back" value={shown.back} onCommit={(t) => set("back", t)} /></div>
          </div>
          <DepartureNote check={check} onUse={(t) => set("leaveBy", t)} onMoveBack={(t) => set("back", t)} />
          <p className="hint" style={{ margin: 0 }} data-testid="times-hint">
            {timesChanged
              ? <>Asked: {q.when}{was.back ? ` · back by ${was.back}` : ""}. A new day or leave-by plans the trip again when you send it; the stops stay as asked.{" "}
                <button type="button" className="linkish" onClick={() => setF((x) => ({ ...x, date: "", leaveBy: "", back: "" }))}>Use the times asked</button></>
              : "As asked. The stops stay as asked; move the day or the times only if needed."}
          </p>
        </div>
        <div className="confirm" style={{ borderColor: "var(--line)" }}>
          <div className="field">
            <label htmlFor="rq-reason">Decline with a reason</label>
            <input id="rq-reason" maxLength={300} placeholder="e.g. No van free that morning" value={f.reason} onChange={(e) => set("reason", e.target.value)} autoFocus={params.get("mode") === "decline"} />
          </div>
          {msg && <div><Notice tone={msg.tone}>{msg.text}</Notice>{msg.warnings && <WarningsNote warnings={msg.warnings} />}</div>}
          <StickyActions>
            <button type="button" className="btn" disabled={busy} onClick={() => void decide("decline")}>Decline</button>
            <button type="button" className="btn dark" disabled={busy} data-testid="decide-send" onClick={() => void decide("approve")}>
              {decideLabel({ proposal: !!proposed?.username, asProposed: pick.asProposed, custodianDrives })}
            </button>
          </StickyActions>
        </div>
      </div>
    </section>
  );
}
