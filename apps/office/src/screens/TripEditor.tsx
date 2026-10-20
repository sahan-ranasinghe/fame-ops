// The trip editor (Phase 7, §34): the trip part of Assign a task as one piece
// for Assign a task, New request and Change the request. The leave-by time with
// its departure check (typed, or filled in from the plan; checked at once
// against the arrive-by times and the back-by time, §17, §20), Start from with
// "Passengers get in here" and Tick it, the stops (type, what, place, arrive-by,
// the time at each stop), Return to office and No expressway, the back-by time
// ("Vehicle free by" on a task), and the plan as a timeline with the time at
// each stop beside its map (Google's road line under the google package). The
// plan is plan_task, 1.5 s after the last edit or at once with Plan now; the
// plan shown stays while the next one comes. `useTrip` holds the rules, the
// parts go where each form puts them, and `TripEditor` is the three cards of
// the request forms. Requesters see no driver, vehicle or overlaps here.
import { type ReactNode, useEffect } from "react";
import type { PlanPreview, SettingsResult } from "../data/types";
import type { Query } from "../data/useQuery";
import { errText } from "../transport/errors";
import { TimeField } from "../ui/TimeField";
import { checkDeparture, type DepartureCheck, departurePlan } from "./departureLogic";
import { DepartureNote, StartFrom, startPoint, usePlanPreview } from "./dispatchParts";
import { dwellFallbacks, type PlanReason, planReasons, rowStopNumbers } from "./planLogic";
import { PlanWithMap } from "./PlanMap";
import { StopsRows } from "./StopsEditor";
import { dwellText, tickStart } from "./stopsLogic";
import { type Base, type TripFields, tripOffset } from "./tripLogic";
import { TripDayPicker } from "../ui/DayPicker";

export interface Trip {
  f: TripFields;
  /** Changes the trip's fields; the form's other fields stay. */
  update: (fn: (x: TripFields) => TripFields) => void;
  base: Base;
  /** The fleet setting: the default time at a stop by type. */
  dwellSetting?: Record<string, number> | null;
  /** plan_task's arguments (null: not plannable yet) and its answer. */
  pInput: Record<string, unknown> | null;
  plan: Query<PlanPreview>;
  preview: PlanPreview | null;
  /** The departure check from the latest plan; `lateBack`: the plan ends after the back-by time. */
  check: DepartureCheck | null;
  lateBack: boolean;
  /** The row whose arrive-by the typed leave-by misses (the note goes under it). */
  lateKey?: string;
  /** The rows' first number: 1 when the start is Stop 1. */
  offset: number;
  /** The start stop's time there, from the plan. */
  stay?: string;
  reasons: PlanReason[];
  /** The back-by field's name in the departure note's button ("Move free by to 18:20"). */
  backLabel: string;
  setLeave: (time: string) => void;
  setEnd: (time: string) => void;
  moveArriveBy: (n: number, time: string) => void;
  onTickStart: (i: number) => void;
}

/**
 * The trip's rules for a form whose state holds the trip's fields (`f`, changed with `setF`). `planInput` is what
 * plan_task gets (the trip alone, or Assign's with the driver and vehicle); `fill` fills an empty leave-by from the
 * plan (Assign a task and New request; off where an empty one means "planned", as on Change the request).
 */
export function useTrip<F extends TripFields>(f: F, setF: (fn: (x: F) => F) => void, opts: {
  base: Base;
  settings?: SettingsResult;
  planInput: Record<string, unknown> | null;
  fill?: boolean;
  backLabel?: string;
}): Trip {
  const { base, fill = true, backLabel = "back by" } = opts;
  const update = (fn: (x: TripFields) => TripFields) => setF((x) => ({ ...x, ...fn(x) }));
  const plan = usePlanPreview(opts.planInput);
  const preview = plan.err ? null : plan.data ?? null;
  const previewErr = plan.err ? errText(plan.err)[0] : null;

  // The departure check, at once from the latest plan: fill an empty leave-by, else say what a typed one does.
  // The back-by time: a plan that ends after it says so beside both fields (§20).
  const dPlan = departurePlan(preview?.timeline, preview?.plan?.buffer_min, f.end);
  const check = checkDeparture(f.leaveBy, dPlan);
  const lateBack = check?.kind === "late" && !!check.back;
  const fillTo = fill && check?.kind === "fill" && !plan.stale && !plan.updating ? check.leaveBy : null;
  useEffect(() => {
    if (fillTo) setF((x) => (x.leaveBy ? x : { ...x, leaveBy: fillTo }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillTo]);
  const offset = tripOffset(f);
  const numbers = rowStopNumbers(f.stops, offset);
  const lateKey = check?.kind === "late" && !check.back ? [...numbers].find(([, n]) => n === check.n)?.[0] : undefined;
  const startStop = preview?.stops.find((s) => s.is_start);
  const stay = startStop?.dwell_min != null ? `${dwellText(startStop.dwell_min)} there${startStop.dwell_source === "place" ? " (usual here)" : ""}` : undefined;
  const reasons = planReasons({ date: f.date, stops: f.stops, leaveBy: f.leaveBy, start: f.start || base?.name || "", returnToBase: f.returnToBase, offset }, preview, previewErr);

  return {
    f,
    update,
    base,
    dwellSetting: opts.settings?.settings.dwell_min,
    pInput: opts.planInput,
    plan,
    preview,
    check,
    lateBack,
    lateKey,
    offset,
    stay,
    reasons,
    backLabel,
    setLeave: (time) => update((x) => ({ ...x, leaveBy: time })),
    setEnd: (time) => update((x) => ({ ...x, end: time })),
    moveArriveBy: (n, time) => {
      const key = [...numbers].find(([, m]) => m === n)?.[0];
      if (key) update((x) => ({ ...x, stops: x.stops.map((s) => (s.key === key ? { ...s, arriveBy: time } : s)) }));
    },
    onTickStart: (i) => update((x) => {
      const t = tickStart(x.stops, i);
      return { ...x, stops: t.list, startPax: true, ...t.carried };
    }),
  };
}

/** The leave-by field: the time typed, or the plan's; the departure check under it. */
export function LeaveByField({ trip, id, label = "Leave by" }: { trip: Trip; id: string; label?: string }) {
  const { f, check } = trip;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <TimeField id={id} value={f.leaveBy} onCommit={trip.setLeave} suggested={trip.plan.data?.leave_by} />
      {check && check.kind !== "fill"
        ? <DepartureNote check={check} onUse={trip.setLeave} onMove={trip.moveArriveBy} onMoveBack={trip.setEnd} backLabel={trip.backLabel} />
        : <span className="hint">Empty: planned from the stops’ arrive-by times.</span>}
    </div>
  );
}

/** The back-by field ("Vehicle free by" on a task): a plan that ends after it says so here too. */
export function BackByField({ trip, id, label = "Back by" }: { trip: Trip; id: string; label?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <TimeField id={id} value={trip.f.end} onCommit={trip.setEnd} />
      {trip.lateBack && <DepartureNote check={trip.check} onUse={trip.setLeave} onMoveBack={trip.setEnd} backLabel={trip.backLabel} testId="departure-check-back" />}
    </div>
  );
}

/** Start from, the stops, Return to office and No expressway (the inside of a card). `prefix` names the fields' ids. */
export function TripRoute({ trip, prefix }: { trip: Trip; prefix: string }) {
  const { f, update, base, preview, check, lateKey } = trip;
  return (
    <>
      <StartFrom id={`${prefix}-start`} value={f} base={base} stay={trip.stay} onChange={(patch) => update((x) => ({ ...x, ...patch }))} />
      <span className="lab">Stops</span>
      <StopsRows list={f.stops} onChange={(stops) => update((x) => ({ ...x, stops }))} offset={trip.offset}
        fallbacks={dwellFallbacks(f.stops, preview?.stops, trip.dwellSetting)}
        start={startPoint(f, base)} startIsStop={f.startPax} onTickStart={trip.onTickStart}
        note={(s) => (s.key === lateKey ? <DepartureNote check={check} onUse={trip.setLeave} onMove={trip.moveArriveBy} testId="departure-check-stop" /> : null)} />
      <div className="grid2">
        <span className="check"><input type="checkbox" id={`${prefix}-return`} checked={f.returnToBase} onChange={(e) => update((x) => ({ ...x, returnToBase: e.target.checked }))} /> <label htmlFor={`${prefix}-return`}>Return to office</label></span>
        <span className="check"><input type="checkbox" id={`${prefix}-noexp`} checked={f.avoidExpressway} onChange={(e) => update((x) => ({ ...x, avoidExpressway: e.target.checked }))} /> <label htmlFor={`${prefix}-noexp`}>No expressway</label></span>
      </div>
    </>
  );
}

/** The plan card: Plan now, the timeline with the time at each stop beside its map; `children` under it (Assign's overlaps). */
export function TripPlanCard({ trip, children }: { trip: Trip; children?: ReactNode }) {
  const { plan, preview } = trip;
  return (
    <div className="card card-b form" data-testid="plan-card">
      <div className="row" style={{ padding: 0 }}>
        <b className="grow">Plan</b>
        <button type="button" className="btn small" onClick={plan.refetch} disabled={plan.fetching || !trip.pInput}>{plan.fetching ? "Planning…" : "Plan now"}</button>
      </div>
      <PlanWithMap timeline={preview?.timeline} plan={preview?.plan} startName={preview?.start?.name} reasons={trip.reasons} updating={plan.updating}
        stops={preview?.stops} start={preview?.start} />
      {children}
    </div>
  );
}

/**
 * The request forms' trip: the day with the leave-by and back-by times, the route (Start from, the stops, the two
 * switches) and the plan, as three cards. `prefix` names the fields' ids.
 */
export function TripEditor({ trip, prefix }: { trip: Trip; prefix: string }) {
  const { f, update } = trip;
  return (
    <>
      <div className="card card-b form" data-testid="trip-when">
        <div className="grid2">
          <div className="field"><span className="lab">Day</span><TripDayPicker id={`${prefix}-date`} label="Day" value={f.date} onChange={(d) => update((x) => ({ ...x, date: d }))} /></div>
          <LeaveByField trip={trip} id={`${prefix}-leave`} />
        </div>
        <div className="grid2">
          <BackByField trip={trip} id={`${prefix}-back`} />
        </div>
      </div>
      <div className="card card-b form" data-testid="trip-route">
        <TripRoute trip={trip} prefix={prefix} />
      </div>
      <TripPlanCard trip={trip} />
    </>
  );
}
