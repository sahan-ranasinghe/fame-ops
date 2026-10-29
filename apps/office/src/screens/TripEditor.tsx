// The trip editor (Phase 7, §34): the trip part of Assign a task as one piece
// for Assign a task, New request and Change the request. The leave-by time with
// its departure check (typed, or the plan's as a grey suggestion; checked at once
// against the arrive-by times and the back-by time, §17, §20), the route card
// (Fix B: From with its ⋯ Options and Tick it, the stops with theirs, To, + Add
// stop, Then back to the office and No expressway), the back-by time
// ("Vehicle free by" on a task), and the plan as a timeline with the time at
// each stop beside its map (Google's road line under the google package). The
// plan is plan_task, 1.5 s after the last edit (no Plan now); the
// plan shown stays while the next one comes. `useTrip` holds the rules, the
// parts go where each form puts them, and `TripEditor` is the three cards of
// the request forms. Requesters see no driver, vehicle or overlaps here.
import type { ReactNode } from "react";
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
import { SwitchLine } from "../ui/basics";

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
  /** planner_suggestions (Settings → Fleet): off = no suggestions and no hints. */
  suggestions: boolean;
  /** The planner's leave time, shown grey in the empty field ("07:24 · suggested"); never sent. */
  suggestedLeave?: string;
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
 * plan_task gets (the trip alone, or Assign's with the driver and vehicle).
 */
export function useTrip<F extends TripFields>(f: F, setF: (fn: (x: F) => F) => void, opts: {
  base: Base;
  settings?: SettingsResult;
  planInput: Record<string, unknown> | null;
  backLabel?: string;
}): Trip {
  const { base, backLabel = "back by" } = opts;
  const update = (fn: (x: TripFields) => TripFields) => setF((x) => ({ ...x, ...fn(x) }));
  const plan = usePlanPreview(opts.planInput);
  const preview = plan.err ? null : plan.data ?? null;
  const previewErr = plan.err ? errText(plan.err)[0] : null;

  // The planner advises, never blocks (21 October 2026). Its leave time is a grey suggestion in the empty field, never
  // written into the form: written back it was planned again as a chosen time (the road times asked again for that
  // departure) and judged a few minutes late ("09:22 … Use 09:18"). Only a chosen time is checked; a miss is an amber hint.
  // The back-by time: a plan that ends after it says so beside both fields (§20). planner_suggestions off = no hints.
  const suggestions = opts.settings?.settings.planner_suggestions !== false;
  const dPlan = departurePlan(preview?.timeline, preview?.plan?.buffer_min, f.end);
  const raw = suggestions ? checkDeparture(f.leaveBy, dPlan) : null;
  const check = raw?.kind === "fill" ? null : raw;
  const suggestedLeave = suggestions && !f.leaveBy && raw?.kind === "fill" ? raw.leaveBy : undefined;
  const lateBack = check?.kind === "late" && !!check.back;
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
    suggestedLeave,
    suggestions,
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
      <TimeField id={id} value={f.leaveBy} onCommit={trip.setLeave} suggested={trip.suggestedLeave} />
      {check
        ? <DepartureNote check={check} onUse={trip.setLeave} onMove={trip.moveArriveBy} onMoveBack={trip.setEnd} backLabel={trip.backLabel} />
        : <span className="hint">{trip.suggestedLeave ? `Suggested ${trip.suggestedLeave} from the stops’ arrive-by times. Change it if you like.` : "Empty: planned from the stops’ arrive-by times."}</span>}
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

/**
 * The route card (Fix B, 29 October 2026: From / To / Add stop, Uber's and Google Maps' route form): From (the start with
 * its ⋯ Options), the stops and To on one line, + Add stop, then "Then back to the office" (a switch, on for a new trip)
 * and No expressway. `prefix` names the fields' ids.
 */
export function TripRoute({ trip, prefix }: { trip: Trip; prefix: string }) {
  const { f, update, base, preview, check, lateKey } = trip;
  return (
    <StopsRows list={f.stops} onChange={(stops) => update((x) => ({ ...x, stops }))} offset={trip.offset}
      fallbacks={trip.suggestions ? dwellFallbacks(f.stops, preview?.stops, trip.dwellSetting) : undefined}
      start={startPoint(f, base)} startIsStop={f.startPax} onTickStart={trip.onTickStart}
      note={(s) => (s.key === lateKey ? <DepartureNote check={check} onUse={trip.setLeave} onMove={trip.moveArriveBy} testId="departure-check-stop" /> : null)}
      from={<StartFrom id={`${prefix}-start`} value={f} base={base} stay={trip.stay} onChange={(patch) => update((x) => ({ ...x, ...patch }))} />}
      after={(
        <>
          <SwitchLine title="Then back to the office" on={f.returnToBase} onChange={(on) => update((x) => ({ ...x, returnToBase: on }))} testId="return-to-base" />
          <span className="check"><input type="checkbox" id={`${prefix}-noexp`} checked={f.avoidExpressway} onChange={(e) => update((x) => ({ ...x, avoidExpressway: e.target.checked }))} /> <label htmlFor={`${prefix}-noexp`}>No expressway</label></span>
        </>
      )} />
  );
}

/** The plan card (planned by itself 1.5 s after the last change; no Plan now since 21 October 2026): the timeline with the time at each stop beside its map; `children` under it (Assign's overlaps). */
export function TripPlanCard({ trip, children }: { trip: Trip; children?: ReactNode }) {
  const { plan, preview } = trip;
  return (
    <div className="card card-b form" data-testid="plan-card">
      <div className="row" style={{ padding: 0 }}>
        <b className="grow">Plan</b>
        {plan.fetching && <span className="muted">Planning…</span>}
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
