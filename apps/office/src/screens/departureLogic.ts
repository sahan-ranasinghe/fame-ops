// The departure check (Phase 7, §17 and §20's words), in the browser, from the
// latest plan: the plan's arrivals shifted by the difference between the typed
// departure and the plan's leave time (the same road times, no waiting), so it
// answers at once while the next plan is still on its way. Pure.
// - An arrive-by is set and the departure is empty: fill in the recommended one.
// - The departure is later than leave-by: "Leaving 08:00 you reach Kurunegala
//   site at 09:36, 36 min after 09:00. Leave by 07:24." with Use 07:24 and Move
//   arrive-by to 09:40 (the arrival rounded up to 5 minutes).
// - 20 minutes or more earlier: "Arrives 25 min early".
// Never blocks anything.
import type { PlanTimeline } from "../data/types";

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
}

export type DepartureCheck =
  /** Fill the empty departure with the plan's leave-by. */
  | { kind: "fill"; leaveBy: string }
  /** Later than leave-by: red when a deadline is missed, amber when only the buffer is eaten. */
  | { kind: "late"; tone: "bad" | "warn"; text: string; leaveBy: string; n: number; place: string; moveTo?: string }
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

/** The departure plan from a timeline (and the plan's buffer); null when no stop has an arrive-by. */
export function departurePlan(timeline: PlanTimeline | null | undefined, buffer?: number | null): DeparturePlan | null {
  if (!timeline) return null;
  const leave = timeline.items.find((x) => x.kind === "leave");
  if (!leave || leave.kind !== "leave") return null;
  const stops: DepartureStop[] = [];
  for (const x of timeline.items) {
    if (x.kind !== "stop") continue;
    stops.push({ n: x.n, place: x.place, arrive: x.planned_arrive, arriveBy: x.arrive_by });
  }
  if (!stops.some((s) => s.arriveBy)) return null;
  return { leave: leave.at, source: leave.source, buffer: buffer ?? 0, stops };
}

/** The check for a typed departure ("" = empty) against the latest plan; null = nothing to say. */
export function checkDeparture(departure: string, plan: DeparturePlan | null): DepartureCheck | null {
  if (!plan) return null;
  const leave = toMin(plan.leave);
  if (leave === null) return null;
  const d = toMin(departure);
  if (!departure.trim()) return plan.source === "plan" ? { kind: "fill", leaveBy: fromMin(leave) } : null;
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
  if (!binding) return null;
  const need = plan.buffer - binding.slack; // minutes to leave earlier
  const { s, arrival, slack } = binding;
  if (need > 0) {
    const leaveBy = fromMin(d - need);
    const by = s.arriveBy!;
    if (slack < 0) {
      return {
        kind: "late",
        tone: "bad",
        text: `Leaving ${fromMin(d)} you reach ${s.place} at ${fromMin(arrival)}, ${-slack} min after ${by}. Leave by ${leaveBy}.`,
        leaveBy,
        n: s.n,
        place: s.place,
        moveTo: fromMin(ceil5(arrival)),
      };
    }
    return {
      kind: "late",
      tone: "warn",
      text: `Leaving ${fromMin(d)} you reach ${s.place} at ${fromMin(arrival)}, ${slack === 0 ? "just at" : `only ${slack} min before`} ${by}. Leave by ${leaveBy}.`,
      leaveBy,
      n: s.n,
      place: s.place,
    };
  }
  if (-need >= EARLY_NOTE_MIN) return { kind: "early", text: `Arrives ${slack} min early`, minutes: slack };
  return null;
}
