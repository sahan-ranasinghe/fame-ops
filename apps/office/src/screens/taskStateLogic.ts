// A task's state as its chip (docs/design-pass.md §3, one vocabulary; §2 R3, tones mean one thing): the same words and
// the same tone wherever a task shows its state. Pure. The board's cards use it first (pilot f); the task page and the
// other lists follow in the rollout.
//
// Sent (grey) → Seen (grey) → Accepted (blue) → On the way (blue), At the stop (blue) → Done (green); Needs a driver
// (red) for a task declined or not accepted in time; Missed (red); Cancelled (grey). Late is a chip of its own beside the
// state ("Late · 12 min", amber), never a state instead of it. The words are never "In progress", "Under way" or
// "Completed".
import { duration } from "@fleet/durations";
import type { BoardCard, FinishFlag } from "../data/types";
import type { Tone } from "../lib/format";

/** A task's status as the server stores it (task_board's columns are the first four). */
export type TaskStatus = "assigned" | "in_progress" | "completed" | "declined" | "missed" | "cancelled";

export interface StateChip {
  label: string;
  tone: Tone;
  /** More words on hover (the finish flag's reason). */
  title?: string;
}

export interface TaskStateInput {
  status: TaskStatus | string;
  /** "10:50" once the driver accepted it. */
  accepted?: string | null;
  /** The driver opened it (task_board says so only in its sentence: seenFromLine). */
  seen?: boolean;
  /** Minutes behind the plan while it runs (the live ETA). */
  late_min?: number | null;
  /** In the server's needs-a-driver list (declined, or not accepted within the accept window). */
  needs_driver?: boolean;
  /** At a stop and not left it yet. */
  at_stop?: boolean;
  /** Finished far under the plan (Phase 7). */
  finish_flag?: FinishFlag | null;
}

const SENT: StateChip = { label: "Sent", tone: "" };

/** The state's chip: one word and its tone. */
export function taskStateChip(t: TaskStateInput): StateChip {
  if (t.status === "declined" || (t.needs_driver && t.status === "assigned")) return { label: "Needs a driver", tone: "bad" };
  switch (t.status) {
    case "assigned":
      // The chip says the latest: accepted wins over seen.
      if (t.accepted) return { label: "Accepted", tone: "live" };
      return t.seen ? { label: "Seen", tone: "" } : SENT;
    case "in_progress":
      return t.at_stop ? { label: "At the stop", tone: "live" } : { label: "On the way", tone: "live" };
    case "completed":
      return { label: "Done", tone: "ok" };
    case "missed":
      return { label: "Missed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "" };
    default:
      return SENT;
  }
}

/** "Late · 12 min" (amber) while a running task is behind its plan; nothing otherwise. */
export function lateChip(lateMin?: number | null): StateChip | null {
  return lateMin && lateMin > 0 ? { label: `Late · ${duration(lateMin)}`, tone: "warn" } : null;
}

/** A finish flag as a warning chip: its name (the issue's own, "Completed early"), its reason on hover. */
export function finishFlagChip(flag?: FinishFlag | null): StateChip | null {
  if (!flag) return null;
  const label = flag.kind === "completed_early" ? "Completed early" : flag.kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { label, tone: "warn", title: flag.text };
}

/** Every chip of a task, in order: the state, Late beside it while it runs behind, then a finish flag. */
export function taskChips(t: TaskStateInput): StateChip[] {
  const late = t.status === "in_progress" ? lateChip(t.late_min) : null;
  return [taskStateChip(t), late, finishFlagChip(t.finish_flag)].filter((c): c is StateChip => !!c);
}

/** task_board's sentence "Seen by driver 10:42" (tools/tasks.ts statusLine): the driver opened it, not accepted yet. */
export const seenFromLine = (line?: string | null): boolean => /^Seen by driver \d{2}:\d{2}$/.test(String(line ?? "").trim());

/** A board card's chips: its column is its status; `needsDriver` = the card is in the board's needs-a-driver list. */
export function boardCardChips(column: TaskStatus, t: BoardCard, needsDriver: boolean): StateChip[] {
  return taskChips({
    status: column,
    accepted: t.accepted,
    seen: seenFromLine(t.status),
    late_min: t.late_min,
    needs_driver: needsDriver,
    finish_flag: t.finish_flag,
  });
}

/** A proposed task waiting for an approver (the board's first column): "Waiting", or "Waiting · late" past its leave-by. */
export const waitingChip = (late?: boolean): StateChip => ({ label: late ? "Waiting · late" : "Waiting", tone: "warn" });
