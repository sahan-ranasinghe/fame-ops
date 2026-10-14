// "Who's available" in words and tones, from an availability row. Pure.
import type { AvailableDriver } from "../data/types";
import type { Tone } from "../lib/format";

/** The chip's tone: on duty = blue, on a task = amber, off duty = grey; busy with a task = red. */
export function driverTone(d: Pick<AvailableDriver, "state" | "free">): Tone {
  if (!d.free) return "bad";
  return d.state === "on_duty" ? "live" : d.state === "on_task" ? "warn" : "muted";
}

/** "On duty since 07:12 · next task 13:00 · 2 accepted · 1 declined". */
export function driverLine(d: AvailableDriver): string {
  return [
    d.status_text,
    d.busy_with ? `busy: ${d.busy_with}` : d.next_task_start ? `next task ${d.next_task_start}` : null,
    d.accepted_today ? `${d.accepted_today} accepted` : null,
    d.declined_today ? `${d.declined_today} declined` : null,
  ].filter(Boolean).join(" · ");
}

/** The licence chip's tone, as the vehicles' document chips. */
export const licenceTone = (chip?: string): Tone => chip === "red" ? "bad" : chip === "orange" ? "warn" : chip === "ok" ? "ok" : "muted";

/** The availability call's arguments from a day, a time and an optional back-by; null until the day and time are known. */
export function availabilityArgs(date: string, time: string, until?: string, needType?: string, pax?: string): Record<string, unknown> | null {
  const d = date.trim(), t = time.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const args: Record<string, unknown> = { at: `${d} ${t}` };
  if (until && /^\d{2}:\d{2}$/.test(until.trim()) && until.trim() > t) args.until = until.trim();
  if (needType?.trim()) args.need_type = needType.trim();
  if (pax?.trim() !== undefined && pax?.trim() !== "") args.pax = Math.max(0, Math.min(80, parseInt(pax!.trim(), 10) || 0));
  return args;
}
