// Hotfix 4 (b): the warnings a change to a task leaves for the task page. A save goes back in the history to wherever the
// person came from (ui/Page.tsx useAfterSave), and a step back carries no navigation state, so they wait here: per task, in
// this tab, for a minute (read on the task page, never removed by reading: React may render twice).

import type { Conflict } from "./types";

const KEY = (taskId: string) => `fame.flash.warnings.${taskId}`;
const KEEP_MS = 60_000;

export function flashWarnings(taskId: string, warnings: string[], now = Date.now()): void {
  try {
    if (warnings.length) sessionStorage.setItem(KEY(taskId), JSON.stringify({ at: now, warnings }));
    else sessionStorage.removeItem(KEY(taskId));
  } catch {
    // A private window: the toast still says it was saved.
  }
}

export function readFlashWarnings(taskId: string, now = Date.now()): string[] {
  try {
    const raw = sessionStorage.getItem(KEY(taskId));
    if (!raw) return [];
    const { at, warnings } = JSON.parse(raw) as { at: number; warnings: string[] };
    return now - at <= KEEP_MS ? warnings : [];
  } catch {
    return [];
  }
}

// Round 4–7 (7): the conflict cards of a save (update_task, book_vehicle: the other trip, its holder, Ask for it) wait for
// the task page the same way, so the person sees who holds the driver or the vehicle where they land.
const CONFLICTS_KEY = (taskId: string) => `fame.flash.conflicts.${taskId}`;

export function flashConflicts(taskId: string, conflicts: Conflict[], now = Date.now()): void {
  try {
    if (conflicts.length) sessionStorage.setItem(CONFLICTS_KEY(taskId), JSON.stringify({ at: now, conflicts }));
    else sessionStorage.removeItem(CONFLICTS_KEY(taskId));
  } catch {
    // A private window: the warnings' words still say it.
  }
}

export function readFlashConflicts(taskId: string, now = Date.now()): Conflict[] {
  try {
    const raw = sessionStorage.getItem(CONFLICTS_KEY(taskId));
    if (!raw) return [];
    const { at, conflicts } = JSON.parse(raw) as { at: number; conflicts: Conflict[] };
    return now - at <= KEEP_MS && Array.isArray(conflicts) ? conflicts : [];
  } catch {
    return [];
  }
}
