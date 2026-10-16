// Tasks that need a driver (Phase 7, §19): declined, or not accepted within the
// accept window. The rules of the list Overview and Tasks share: where a row and
// the block lead, how the time to the start is coloured, the best match's words.
// Pure; the list is NeedsDriverList.tsx.
import type { BestMatch, NeedsDriverTask } from "../data/types";
import { plateOf } from "../lib/format";

/** The Tasks page filtered to the tasks that need a driver (the banner's and the Overview block's link). */
export const NEEDS_DRIVER_LIST = "/tasks?filter=needs_driver";

/** A row opens the task's change page with the driver field first. */
export const findDriverPath = (taskId: string) => `/tasks/${taskId}/edit?driver=1`;

/** "1 task needs a driver", "2 tasks need a driver". */
export const needsDriverCount = (n: number) => (n === 1 ? "1 task needs a driver" : `${n} tasks need a driver`);

/** The time to the start: red when late or within the hour, amber later today, plain after that. */
export function whenTone(minutesToStart: number): "bad" | "warn" | "" {
  if (minutesToStart < 60) return "bad";
  if (minutesToStart < 240) return "warn";
  return "";
}

/** "Best match: Nuwan Perera · WP CAB-4521", or nothing when nobody is free. */
export function bestLine(best?: BestMatch | null): string {
  if (!best?.name) return "";
  return `Best match: ${best.name}${best.vehicle?.reg_no ? ` · ${plateOf(best.vehicle.reg_no)}` : ""}`;
}

/** The soonest first (the server sends them so; kept if a later answer does not). */
export function sortNeedsDriver(list: NeedsDriverTask[] | undefined | null): NeedsDriverTask[] {
  return [...(list ?? [])].sort((a, b) => a.minutes_to_start - b.minutes_to_start);
}
