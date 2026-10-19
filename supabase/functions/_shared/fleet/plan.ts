// The leave-by planner: from the stops of a task (with their dwell times and
// arrive-by deadlines) and a function that answers how long each leg takes,
// the latest time the driver can leave and still arrive everywhere on time
// with the buffer, and the planned arrival and departure at every stop.
//
// Pure: no imports but the duration words (durations.ts); the leg durations are injected (routing.ts in the
// functions, fixed numbers in the tests). Times are ISO strings in UTC;
// nothing here knows about days, so a trip across midnight is nothing special.
//
//   forward(leaveAt)  planned times from a leave time (each leg asked with its
//                     own departure time, so the rush-hour band is the right one)
//   leave-by          three passes: from now, then from the leave time the first
//                     pass implies, then again with that pass's legs; the result
//                     is the latest leave time that meets every deadline minus
//                     the buffer
//   warnings          not_reachable (leave-by is already past; with the earliest
//                     possible arrival), no_coordinates (a stop with no pin: its
//                     leg counts as 0), no_base (no base place: the plan starts
//                     from the first stop), long_day (over 12 hours)

import { duration } from "./durations.ts";

export type StopType = "pickup" | "drop" | "visit";
export type What = "people" | "goods" | "documents" | "other";
export type LegSource = "ors" | "google" | "estimate";

export interface PlanPoint {
  lat: number;
  lng: number;
}

export interface PlanStop {
  seq: number;
  type: StopType;
  what?: What | null;
  name: string;
  point: PlanPoint | null;
  /** Minutes at the stop; null = the settings' default for the type and what. */
  dwell_min?: number | null;
  /** ISO: the deadline, if any. */
  arrive_by?: string | null;
  /** Phase 7 (§11): the pickup at the start ("Passengers get in here"): no leg to it. */
  at_start?: boolean;
}

export interface PlanPlace {
  name: string;
  point: PlanPoint | null;
}

export interface PlanInput {
  /** ISO now, for not_reachable and the first pass. */
  now: string;
  /** Where the trip starts; null = the base. */
  start: PlanPlace | null;
  /** The base place from the settings; null when none is set. */
  base: PlanPlace | null;
  stops: PlanStop[];
  return_to_base: boolean;
  avoid_expressway: boolean;
  /** ISO: a leave time given by hand. The plan is then advice (source manual). */
  leave_at?: string | null;
  buffer_min?: number | null;
}

export interface PlanSettings {
  dwell_min: Record<string, number>;
  buffer_min: number;
}

export interface LegResult {
  km: number;
  minutes: number;
  source: LegSource;
  via_expressway: boolean | null;
  /** The rush-hour factor applied (1 when none). */
  factor: number;
  /**
   * The leg's road line (encoded polyline). `source` says whose: google (the Routes call of the road times; kept 30 days,
   * drawn on Google's maps only) or ors (openrouteservice's, ours: drawn on any map). The estimate has none.
   */
  line?: string;
}

export type LegFn = (from: PlanPoint, to: PlanPoint, departAt: string, opts: { avoid_expressway: boolean }) => Promise<LegResult>;

export interface PlanLeg extends LegResult {
  /** 0 = the start; stops by seq; -1 = the base at the end. */
  from_seq: number;
  to_seq: number;
  depart_at: string;
  arrive_at: string;
}

export interface PlannedStop {
  seq: number;
  dwell_min: number;
  arrive_by: string | null;
  planned_arrive_at: string;
  planned_depart_at: string;
  /** Minutes to spare before the deadline (negative = late), for stops with one. */
  slack_min: number | null;
}

export type WarningCode = "not_reachable" | "no_coordinates" | "no_base" | "long_day";

export interface PlanWarning {
  code: WarningCode;
  text: string;
  seq?: number;
  earliest_arrival?: string;
}

export interface Plan {
  leave_by: string;
  leave_by_source: "plan" | "manual";
  ends_at: string;
  total_drive_min: number;
  total_km: number;
  legs: PlanLeg[];
  stops: PlannedStop[];
  warnings: PlanWarning[];
  buffer_min: number;
  computed_at: string;
  /** When Google's leg lines were fetched (Phase 7, §20): the nightly google_content job removes them 30 days on. */
  line_fetched_at?: string;
}

export const LONG_DAY_HOURS = 12;
export const NO_BASE_TEXT = "No base place set — add it in Settings";
const MINUTE = 60000;

const addMin = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * MINUTE).toISOString();
const diffMin = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / MINUTE;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The dwell for a stop: its own, else the settings by "type.what", by what, by type, else the default. */
export function dwellFor(settings: PlanSettings, type: StopType, what: What | null | undefined, own?: number | null): number {
  if (own !== null && own !== undefined) return own;
  const d = settings.dwell_min;
  return d[`${type}.${what ?? ""}`] ?? (what ? d[what] : undefined) ?? d[type] ?? d.default ?? 10;
}

interface Pass {
  legs: PlanLeg[];
  stops: PlannedStop[];
  ends_at: string;
}

async function forward(
  input: PlanInput,
  settings: PlanSettings,
  legFn: LegFn,
  leaveAt: string,
  warnings: PlanWarning[],
  noted: Set<string>,
): Promise<Pass> {
  const legs: PlanLeg[] = [];
  const stops: PlannedStop[] = [];
  let at = leaveAt;
  let prev: PlanPoint | null = input.start?.point ?? input.base?.point ?? null;
  let prevSeq = 0;
  const warn = (w: PlanWarning) => {
    const key = `${w.code}:${w.seq ?? ""}`;
    if (noted.has(key)) return;
    noted.add(key);
    warnings.push(w);
  };
  if (!input.start?.point && !input.base?.point) warn({ code: "no_base", text: NO_BASE_TEXT });

  for (const stop of input.stops) {
    const dwell = dwellFor(settings, stop.type, stop.what, stop.dwell_min);
    if (!stop.point) {
      warn({
        code: "no_coordinates",
        text: `${stop.name}: no map pin, so its leg counts as 0 minutes. Save the place with a pin, or type a town name.`,
        seq: stop.seq,
      });
    }
    // The pickup at the start is where the trip begins: no leg to it.
    if (prev && stop.point && !stop.at_start) {
      const leg = await legFn(prev, stop.point, at, { avoid_expressway: input.avoid_expressway });
      const arrive = addMin(at, leg.minutes);
      legs.push({ ...leg, from_seq: prevSeq, to_seq: stop.seq, depart_at: at, arrive_at: arrive });
      at = arrive;
    }
    const arriveAt = at;
    const departAt = addMin(at, dwell);
    stops.push({
      seq: stop.seq,
      dwell_min: dwell,
      arrive_by: stop.arrive_by ?? null,
      planned_arrive_at: arriveAt,
      planned_depart_at: departAt,
      slack_min: stop.arrive_by ? Math.round(diffMin(stop.arrive_by, arriveAt)) : null,
    });
    at = departAt;
    if (stop.point) {
      prev = stop.point;
      prevSeq = stop.seq;
    }
  }
  if (input.return_to_base && input.base?.point && prev) {
    const leg = await legFn(prev, input.base.point, at, { avoid_expressway: input.avoid_expressway });
    const arrive = addMin(at, leg.minutes);
    legs.push({ ...leg, from_seq: prevSeq, to_seq: -1, depart_at: at, arrive_at: arrive });
    at = arrive;
  }
  return { legs, stops, ends_at: at };
}

/**
 * The points the legs of a pass join, in order (the same walk as forward): the start (or the base),
 * every stop with a pin, the base again when the trip returns there. One routing call can answer
 * all the legs at once: leg i joins points i and i + 1.
 */
export function legSequence(input: Pick<PlanInput, "start" | "base" | "stops" | "return_to_base">): PlanPoint[] {
  const out: PlanPoint[] = [];
  const first = input.start?.point ?? input.base?.point ?? null;
  if (first) out.push(first);
  for (const stop of input.stops) if (stop.point && !(stop.at_start && first)) out.push(stop.point);
  if (input.return_to_base && input.base?.point && out.length > 0) out.push(input.base.point);
  return out;
}

/** The latest leave time implied by a pass: the tightest deadline minus the buffer minus the time to reach it. */
function impliedLeave(pass: Pass, leaveAt: string, buffer: number): string | null {
  let best: number | null = null;
  for (const s of pass.stops) {
    if (!s.arrive_by) continue;
    const travel = diffMin(s.planned_arrive_at, leaveAt);
    const leave = new Date(s.arrive_by).getTime() - (buffer + travel) * MINUTE;
    if (best === null || leave < best) best = leave;
  }
  return best === null ? null : new Date(best).toISOString();
}

export async function planTask(input: PlanInput, settings: PlanSettings, legFn: LegFn): Promise<Plan> {
  const buffer = input.buffer_min ?? settings.buffer_min;
  const warnings: PlanWarning[] = [];
  const noted = new Set<string>();
  const hasDeadline = input.stops.some((s) => s.arrive_by);

  let leaveBy: string;
  let source: "plan" | "manual";
  let pass: Pass;
  if (input.leave_at || !hasDeadline) {
    leaveBy = input.leave_at ?? input.now;
    source = "manual";
    pass = await forward(input, settings, legFn, leaveBy, warnings, noted);
  } else {
    // Three passes: the legs of each pass are asked at the departure times the previous one implied.
    let leave = input.now;
    pass = await forward(input, settings, legFn, leave, warnings, noted);
    for (let i = 0; i < 2; i++) {
      leave = impliedLeave(pass, leave, buffer) ?? leave;
      pass = await forward(input, settings, legFn, leave, warnings, noted);
    }
    leaveBy = impliedLeave(pass, leave, buffer) ?? leave;
    if (leaveBy !== leave) pass = await forward(input, settings, legFn, leaveBy, warnings, noted);
    source = "plan";
  }

  if (hasDeadline && new Date(leaveBy).getTime() < new Date(input.now).getTime()) {
    const fromNow = await forward(input, settings, legFn, input.now, [], new Set());
    const binding = fromNow.stops.find((s) => s.arrive_by && s.slack_min !== null && s.slack_min < buffer) ??
      fromNow.stops.find((s) => s.arrive_by);
    warnings.push({
      code: "not_reachable",
      text: binding
        ? `Leaving now, the earliest arrival at Stop ${input.stops.findIndex((s) => s.seq === binding.seq) + 1} is ${
          binding.planned_arrive_at.slice(11, 16)
        } UTC; the deadline cannot be met with the buffer.`
        : "The leave-by time is already past.",
      seq: binding?.seq,
      earliest_arrival: binding?.planned_arrive_at,
    });
  }
  const hours = diffMin(pass.ends_at, leaveBy) / 60;
  if (hours > LONG_DAY_HOURS) warnings.push({ code: "long_day", text: `A long day: ${duration(hours * 60)} from leaving to the end.` });

  return {
    leave_by: leaveBy,
    leave_by_source: source,
    ends_at: pass.ends_at,
    total_drive_min: Math.round(pass.legs.reduce((sum, l) => sum + l.minutes, 0)),
    total_km: round1(pass.legs.reduce((sum, l) => sum + l.km, 0)),
    legs: pass.legs,
    stops: pass.stops,
    warnings,
    buffer_min: buffer,
    computed_at: input.now,
  };
}
