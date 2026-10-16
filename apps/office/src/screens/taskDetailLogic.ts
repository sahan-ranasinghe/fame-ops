// The task page's words (Phase 7): a stop's name by its order, its time there
// planned against what happened, the vehicle swap's stretches and their total,
// and the needs-a-driver line. Pure; the page is TaskDetail.tsx.
import type { Stop, TaskDetail, TaskSegment } from "../data/types";
import { cap, joinDots, num, plateOf } from "../lib/format";
import { TYPE_LABEL, WHAT_LABEL } from "./stopsLogic";

/** A time at a stop: "45 min", "1 h", "1 h 30", "2 h 05". */
export function stayText(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

/** "Stop 2 · Drop · Kurunegala site" from the answer; else the type, what is carried and the place, as before. */
export function stopTitle(s: Pick<Stop, "label" | "type" | "what" | "place" | "address">): string {
  if (s.label) return s.label;
  const type = TYPE_LABEL[s.type as keyof typeof TYPE_LABEL] ?? cap(s.type);
  const what = s.what ? WHAT_LABEL[s.what as keyof typeof WHAT_LABEL] ?? s.what : "";
  return joinDots([type, what, s.place || s.address || ""]);
}

/** What is carried, when the label (which has no room for it) is used. */
export const whatOf = (s: Pick<Stop, "label" | "what">) => (s.label && s.what ? WHAT_LABEL[s.what as keyof typeof WHAT_LABEL] ?? s.what : "");

/**
 * The time there, planned against what happened:
 * "planned 09:00–10:30 (1 h 30) · actual 09:04–10:41 (1 h 37)". A stop still being
 * visited reads "actual from 09:04 (there now)". Without planned_stay (an older
 * answer) the planned arrival and departure as before.
 */
export function stayLine(s: Pick<Stop, "planned_stay" | "actual_stay" | "planned_arrive" | "planned_depart" | "status">): string {
  const p = s.planned_stay;
  const planned = p
    ? `planned ${p.arrive}${p.leave !== p.arrive ? `–${p.leave}` : ""}${p.minutes > 0 ? ` (${stayText(p.minutes)})` : ""}`
    : s.planned_arrive
    ? `planned ${s.planned_arrive}${s.planned_depart && s.planned_depart !== s.planned_arrive ? `–${s.planned_depart}` : ""}`
    : "";
  const a = s.actual_stay;
  const actual = !a
    ? ""
    : a.done
    ? `actual ${a.arrived}–${a.done}${a.minutes != null ? ` (${stayText(a.minutes)})` : ""}`
    : s.status === "arrived"
    ? `actual from ${a.arrived} (there now)`
    : `arrived ${a.arrived}`;
  return joinDots([planned, actual]);
}

/** Where the planned time there came from, when it is worth saying: the place's usual time. */
export const dwellNote = (s: Pick<Stop, "dwell_source">) => (s.dwell_source === "place" ? "usual here" : "");

export interface SegmentRow {
  vehicle: string;
  /** "08:10–10:42", or "from 10:42" while it runs. */
  window: string;
  /** "45,210 km → 45,262 km", "45,210 km → end to come", "start to come → in use now". */
  readings: string;
  /** "52 km", or "" while a reading is missing. */
  km: string;
  waiting: boolean;
  /** "Breakdown near Kurunegala · by Palitha" */
  why: string;
}

/** One row per vehicle's stretch of the task, in order. */
export function segmentRows(segments: TaskSegment[] | undefined | null): SegmentRow[] {
  return (segments ?? []).map((g) => {
    const start = g.start_km != null ? `${num(g.start_km)} km` : "start to come";
    const end = g.end_km != null ? `${num(g.end_km)} km` : g.to ? "end to come" : "in use now";
    const readings = `${start} → ${end}`;
    return {
      vehicle: g.vehicle ? plateOf(g.vehicle) : "Vehicle",
      window: g.to ? `${g.from}–${g.to}` : `from ${g.from}`,
      readings,
      km: g.km != null ? `${num(g.km)} km` : "",
      waiting: !!g.readings_waiting,
      why: joinDots([g.reason, g.by && `by ${g.by}`]),
    };
  });
}

/**
 * The swap's total: the stretches' km added up (task km = their sum), whether a reading is still to come,
 * and the line under the rows: "52 + 31 = 83 km", "52 km so far · a reading is still to come".
 */
export function segmentsTotal(segments: TaskSegment[] | undefined | null): { km: number; complete: boolean; line: string } {
  const list = segments ?? [];
  const known = list.filter((g) => g.km != null).map((g) => g.km as number);
  const km = known.reduce((a, b) => a + b, 0);
  const complete = list.length > 0 && known.length === list.length && !list.some((g) => g.readings_waiting);
  const sum = known.length > 1 ? `${known.map((k) => num(k)).join(" + ")} = ${num(km)} km` : `${num(km)} km`;
  return { km, complete, line: complete ? `Total ${sum}` : known.length ? `${sum} so far · a reading is still to come from the driver` : "The readings are still to come from the driver" };
}

/** "Needs a driver since Thu 16 Oct 08:40 · Kamal declined: Vehicle problem", or "· not accepted in time". */
export function needsDriverText(t: Pick<TaskDetail["task"], "needs_driver" | "driver">): string {
  const nd = t.needs_driver;
  if (!nd) return "";
  const first = t.driver ? t.driver.split(" ")[0] : "The driver";
  const why = nd.reason === "declined"
    ? `${first} declined${nd.reason_text ? `: ${nd.reason_text}` : ""}`
    : nd.reason === "not_accepted"
    ? `${first} hasn't accepted in time`
    : nd.reason_text ?? "";
  return joinDots([`Needs a driver since ${nd.since}`, why]);
}
