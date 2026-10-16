// The duty log's words (Phase 7 §1), pure: how a vehicle was held in a duty
// period, how the period ended, and whether an answer is the one asked for.
import type { DutyLog, DutyPeriod } from "../data/types";
import { rangeText } from "../ui/dateRange";

type HeldVehicle = DutyPeriod["vehicles"][number];

/** A name worth showing: not the driver themself, not the server's own "system". */
const someoneElse = (by: string | null | undefined, driver?: string): by is string => !!by && by !== driver && by.toLowerCase() !== "system";

function startWords(v: HeldVehicle, driver?: string): string {
  if (v.how === "office") return someoneElse(v.by, driver) ? `the office (${v.by})` : "the office";
  return someoneElse(v.by, driver) ? `${v.how} by ${v.by}` : v.how;
}

function endWords(v: HeldVehicle, driver?: string): string | undefined {
  if (!v.ended) return undefined;
  if (v.ended === "taken over") return v.ended_by ? `taken over by ${v.ended_by}` : "taken over";
  if (v.ended === "office") return someoneElse(v.ended_by, driver) ? `the office (${v.ended_by})` : "the office";
  return someoneElse(v.ended_by, driver) ? `${v.ended} by ${v.ended_by}` : v.ended;
}

/** "08:12–12:40" and "clocked in → taken over by Nuwan" (a vehicle still held: "08:12–now"). */
export function vehicleLine(v: HeldVehicle, driver?: string): { times: string; how: string } {
  const end = endWords(v, driver);
  return { times: `${v.from}–${v.to ?? "now"}`, how: end ? `${startWords(v, driver)} → ${end}` : startWords(v, driver) };
}

const OUT_HOW: Record<string, string> = { driver: "by the driver", office: "by the office", "auto at the cut-off": "auto at the cut-off" };

/** The clock-out cell: the time (none while on duty) and how. */
export function clockOut(p: Pick<DutyPeriod, "clock_out" | "out_how">): { time?: string; how?: string; onDuty: boolean } {
  if (p.clock_out === "on duty") return { onDuty: true };
  return { time: p.clock_out, how: p.out_how ? OUT_HOW[p.out_how] ?? p.out_how : undefined, onDuty: false };
}

/**
 * Whether the answer on screen is the one for the chosen range and driver (the previous
 * one stays on screen, marked "Updating…", until the new one lands). The answer names the
 * driver; the name is compared once the drivers' list is in.
 */
export function answerFor(d: Pick<DutyLog, "from" | "to" | "driver">, want: { from: string; to: string; driver?: string; driverName?: string }): boolean {
  if (d.from !== want.from || d.to !== want.to) return false;
  if (!want.driver) return !d.driver;
  if (!d.driver) return false;
  return !want.driverName || d.driver === want.driverName;
}

/** duty_log's input: one day as `date`, a range as `from`/`to`. */
export function dutyArgs(from: string, to: string, driver?: string): Record<string, unknown> {
  return { ...(from === to ? { date: from } : { from, to }), ...(driver ? { driver } : {}) };
}

/** No duty periods, in words: "Nobody has started work today.", "Kamal was not on duty (Mon 12 Oct – Sun 18 Oct 2026)." */
export function emptyText(d: Pick<DutyLog, "from" | "to" | "driver">, today: string): string {
  if (d.from === today && d.to === today) return d.driver ? `${d.driver} has not started work today.` : "Nobody has started work today.";
  return `${d.driver ? `${d.driver} was not` : "Nobody was"} on duty (${rangeText(d.from, d.to)}).`;
}
