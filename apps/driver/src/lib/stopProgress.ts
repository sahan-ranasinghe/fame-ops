// A trip's progress stop by stop (Round 2, 21 October 2026): planned against what happened, and the stops still to come
// estimated again from the last thing the driver confirmed. Pure, no imports: the server (task_detail), the site
// (@fleet/stopProgress) and the app (apps/driver/src/lib/stopProgress.ts, a byte-identical copy) all read it.
//
// - A stop's planned times stay as planned; what happened is arrived_at (Arrived) and done_at (Left: "Slide when you
//   leave" marks the stop done). The deltas are minutes against the plan: + late, − early.
// - The re-estimate: from the latest confirmed stop, its leave time (done_at; still there = arrived_at plus its planned
//   stay, or now when that has passed), then each stop after it keeps the planner's own leg time (planned arrive minus
//   the previous stop's planned leave) and its planned stay. The plan's leg times are the one calculation; nothing new is
//   asked of a router here.
// - Nothing confirmed yet: no estimate (the plan is what is known). A skipped stop is passed over (no time of its own).

export interface ProgressStopIn {
  id: string;
  seq: number;
  status: string;
  planned_arrive_at: string | null;
  planned_depart_at: string | null;
  arrived_at: string | null;
  done_at: string | null;
}

export interface StopProgress {
  id: string;
  /** ISO times; null when not known. */
  planned_arrive: string | null;
  planned_leave: string | null;
  arrived: string | null;
  left: string | null;
  /** Minutes against the plan: + late, − early; null when either side is missing. */
  arrive_delta_min: number | null;
  leave_delta_min: number | null;
  /** For a stop still to come once something was confirmed: the new times and when they were worked out. */
  estimate: { arrive: string; leave: string | null; updated: string } | null;
  /** The stop the driver is at or heading to next (the first one not left or skipped). */
  current: boolean;
}

const ms = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);
const iso = (t: number): string => new Date(t).toISOString();
const minutes = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.round((a - b) / 60000));

/** Whether a stop is behind the driver (left or skipped). */
const passed = (s: ProgressStopIn) => s.status === "done" || s.status === "skipped" || s.done_at !== null;

export function stopProgress(stops: readonly ProgressStopIn[], now: Date = new Date()): StopProgress[] {
  const list = [...stops].filter((s) => s.status !== "removed").sort((a, b) => a.seq - b.seq);
  const out: StopProgress[] = list.map((s) => ({
    id: s.id,
    planned_arrive: s.planned_arrive_at,
    planned_leave: s.planned_depart_at,
    arrived: s.arrived_at,
    left: s.done_at,
    arrive_delta_min: minutes(ms(s.arrived_at), ms(s.planned_arrive_at)),
    leave_delta_min: minutes(ms(s.done_at), ms(s.planned_depart_at)),
    estimate: null,
    current: false,
  }));
  const currentIndex = list.findIndex((s) => !passed(s));
  if (currentIndex >= 0) out[currentIndex].current = true;

  // The latest stop with a confirmation, and its leave time (left; still there: arrived + its planned stay, or now).
  let anchor = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].arrived_at || list[i].done_at) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) return out;
  const a = list[anchor];
  const updated = a.done_at ?? a.arrived_at!;
  let leave: number;
  if (a.done_at) leave = ms(a.done_at)!;
  else {
    const stay = (ms(a.planned_depart_at) ?? 0) - (ms(a.planned_arrive_at) ?? 0);
    leave = Math.max(ms(a.arrived_at)! + (stay > 0 ? stay : 0), now.getTime());
  }
  let prevPlannedLeave = ms(a.planned_depart_at);
  for (let i = anchor + 1; i < list.length; i++) {
    const s = list[i];
    const pa = ms(s.planned_arrive_at);
    const pd = ms(s.planned_depart_at);
    if (s.status === "skipped") {
      // Passed over: the next leg is measured from the stop before it.
      continue;
    }
    if (pa === null || prevPlannedLeave === null || passed(s) || s.arrived_at) break;
    const arrive = leave + Math.max(0, pa - prevPlannedLeave);
    const stay = pd !== null ? Math.max(0, pd - pa) : null;
    out[i].estimate = { arrive: iso(arrive), leave: stay !== null ? iso(arrive + stay) : null, updated };
    if (stay === null) break;
    leave = arrive + stay;
    prevPlannedLeave = pd;
  }
  return out;
}

/** The words for a delta: "22 min late", "8 min early", "on time" (within 2 minutes). Language-free parts for the UIs. */
export function deltaKind(delta: number | null): { kind: "late" | "early" | "on_time"; min: number } | null {
  if (delta === null) return null;
  if (Math.abs(delta) <= 2) return { kind: "on_time", min: 0 };
  return delta > 0 ? { kind: "late", min: delta } : { kind: "early", min: -delta };
}
