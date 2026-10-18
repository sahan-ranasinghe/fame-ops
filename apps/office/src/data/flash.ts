// Hotfix 4 (b): the warnings a change to a task leaves for the task page. A save goes back in the history to wherever the
// person came from (ui/Page.tsx useAfterSave), and a step back carries no navigation state, so they wait here: per task, in
// this tab, for a minute (read on the task page, never removed by reading: React may render twice).

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
