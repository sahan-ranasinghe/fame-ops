// The departure check (Phase 7, §17 and §20's words), in the browser, from the
// latest plan: the plan's arrivals shifted by the difference between the typed
// departure and the plan's leave time (the same road times, no waiting), so it
// answers at once while the next plan is still on its way. Pure.
// - An arrive-by is set and the departure is empty: fill in the recommended one.
// - The departure is later than leave-by: "Leaving 08:00 you reach Kurunegala
//   site at 09:36, 36 min after 09:00. Leave by 07:24." with Use 07:24 and Move
//   arrive-by to 09:40 (the arrival rounded up to 5 minutes).
// - The same for the end of the trip against a back-by (or end) time: "Leaving
//   08:00 you are back at 18:20, 20 min after 18:00. Leave by 07:40." with Use
//   07:40 and Move back by to 18:20; without the drive back, "you finish at
//   <the last stop> at 18:20".
// - 20 minutes or more earlier: "Arrives 25 min early".
// Never blocks anything.
import type { PlanTimeline } from "../data/types";
import { duration } from "@fleet/durations";

export interface DepartureStop {
  /** The stop's number in the timeline (Stop 2). */
  n: number;
  place: string;
  /** Planned arrival with the plan's leave time, "HH:MM". */
  arrive: string;
  /** The deadline, "HH:MM". */
  arriveBy?: string;
}

export interface DeparturePlan {
  /** The plan's leave time, "HH:MM". */
  leave: string;
  /** plan = from the deadlines; manual = the time typed. */
  source: string;
  /** Minutes the plan arrives before a deadline. */
  buffer: number;
  stops: DepartureStop[];
  /** The end of the trip and the back-by it must meet (only when the form has one). */
  end?: DepartureEnd;
}

/** The trip's end: back at the base (a leg back), else leaving the last stop; checked against a back-by / end time. */
export interface DepartureEnd {
  /** The plan's end, "HH:MM" (totals.ends). */
  at: string;
  /** The deadline, "HH:MM". */
  by: string;
  /** The plan drives back to the base. */
  back: boolean;
  /** The last stop (its number and place), for "you finish at <place>". */
  n: number;
  place: string;
}

export type DepartureCheck =
  /** Fill the empty departure with the plan's leave-by. */
  | { kind: "fill"; leaveBy: string }
  /**
   * Later than leave-by: red when a deadline is missed, amber when only the buffer is eaten. `back` when the end of
   * the trip misses the back-by: `moveBackTo` is the end rounded up to 5 minutes (Move back by).
   */
  | { kind: "late"; tone: "bad" | "warn"; text: string; leaveBy: string; n: number; place: string; moveTo?: string; back?: true; moveBackTo?: string }
  | { kind: "early"; text: string; minutes: number };

/** Early by this much or more is worth a line. */
export const EARLY_NOTE_MIN = 20;

export const toMin = (t: string | undefined | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim().slice(-5));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fromMin = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** Up to the next 5 minutes: 09:36 → 09:40, 09:40 → 09:40. */
export const ceil5 = (min: number) => Math.ceil(min / 5) * 5;

/**
 * The departure plan from a timeline (and the plan's buffer, and the form's back-by or end time when it has one);
 * null when nothing is to be met: no stop has an arrive-by and no back-by is set.
 */
export function departurePlan(timeline: PlanTimeline | null | undefined, buffer?: number | null, backBy?: string | null): DeparturePlan | null {
  if (!timeline) return null;
  const leave = timeline.items.find((x) => x.kind === "leave");
  if (!leave || leave.kind !== "leave") return null;
  const stops: DepartureStop[] = [];
  for (const x of timeline.items) {
    if (x.kind !== "stop") continue;
    stops.push({ n: x.n, place: x.place, arrive: x.planned_arrive, arriveBy: x.arrive_by });
  }
  const by = backBy && toMin(backBy) !== null ? fromMin(toMin(backBy)!) : null;
  const last = stops[stops.length - 1];
  const end: DepartureEnd | undefined = by && last && toMin(timeline.totals.ends) !== null
    ? { at: timeline.totals.ends.slice(-5), by, back: timeline.items.some((x) => x.kind === "leg" && x.to_n === "base"), n: last.n, place: last.place }
    : undefined;
  if (!stops.some((s) => s.arriveBy) && !end) return null;
  const plan: DeparturePlan = { leave: leave.at, source: leave.source, buffer: buffer ?? 0, stops };
  if (end) plan.end = end;
  return plan;
}

/** The check for a typed departure ("" = empty) against the latest plan; null = nothing to say. */
export function checkDeparture(departure: string, plan: DeparturePlan | null): DepartureCheck | null {
  if (!plan) return null;
  const leave = toMin(plan.leave);
  if (leave === null) return null;
  const d = toMin(departure);
  if (!departure.trim()) return plan.source === "plan" && plan.stops.some((s) => s.arriveBy) ? { kind: "fill", leaveBy: fromMin(leave) } : null;
  if (d === null) return null;
  const shift = d - leave;
  // The binding stop: the one that needs the earliest departure (the least slack after the buffer).
  let binding: { s: DepartureStop; arrival: number; slack: number } | null = null;
  for (const s of plan.stops) {
    const by = toMin(s.arriveBy);
    const at = toMin(s.arrive);
    if (by === null || at === null) continue;
    const arrival = at + shift;
    const slack = by - arrival;
    if (!binding || slack < binding.slack) binding = { s, arrival, slack };
  }
  // The end of the trip against the back-by: no buffer (it is when the vehicle is free again, not a meeting).
  const endAt = plan.end ? toMin(plan.end.at) : null;
  const endBy = plan.end ? toMin(plan.end.by) : null;
  const endNeed = endAt !== null && endBy !== null ? (endAt + shift) - endBy : null;
  const stopNeed = binding ? plan.buffer - binding.slack : null;
  if (endNeed !== null && endNeed > 0 && (stopNeed === null || endNeed > stopNeed)) {
    const e = plan.end!;
    const arrival = endAt! + shift;
    const leaveBy = fromMin(d - endNeed);
    const where = e.back ? `you are back at ${fromMin(arrival)}` : `you finish at ${e.place} at ${fromMin(arrival)}`;
    return {
      kind: "late",
      tone: "warn",
      text: `Leaving ${fromMin(d)} ${where}, ${duration(endNeed)} after ${e.by}. Leave by ${leaveBy}.`,
      leaveBy,
      n: e.n,
      place: e.place,
      back: true,
      moveBackTo: fromMin(ceil5(arrival)),
    };
  }
  if (!binding || stopNeed === null) return null;
  const need = stopNeed; // minutes to leave earlier
  const { s, arrival, slack } = binding;
  if (need > 0) {
    const leaveBy = fromMin(d - need);
    const by = s.arriveBy!;
    if (slack < 0) {
      return {
        kind: "late",
        tone: "warn",
        text: `Leaving ${fromMin(d)} you reach ${s.place} at ${fromMin(arrival)}, ${duration(-slack)} after ${by}. Leave by ${leaveBy}.`,
        leaveBy,
        n: s.n,
        place: s.place,
        moveTo: fromMin(ceil5(arrival)),
      };
    }
    return {
      kind: "late",
      tone: "warn",
      text: `Leaving ${fromMin(d)} you reach ${s.place} at ${fromMin(arrival)}, ${slack === 0 ? "just at" : `only ${duration(slack)} before`} ${by}. Leave by ${leaveBy}.`,
      leaveBy,
      n: s.n,
      place: s.place,
    };
  }
  if (-need >= EARLY_NOTE_MIN) return { kind: "early", text: `Arrives ${duration(slack)} early`, minutes: slack };
  return null;
}
