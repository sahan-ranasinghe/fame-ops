// "Who's available" in words and tones, from an availability row; the vehicle a
// driver brings (Phase 7, §3) and the best-match order. Pure.
import type { AvailableDriver, BestMatch } from "../data/types";
import { plateOf, type Tone } from "../lib/format";

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

/** The first stop, for the best match: a pin, else a saved place's name or site id. */
export interface FirstStop {
  place?: string;
  lat?: number;
  lng?: number;
}

/** The availability call's arguments from a day, a time and an optional back-by; null until the day and time are known. */
export function availabilityArgs(date: string, time: string, until?: string, needType?: string, pax?: string, first?: FirstStop | null): Record<string, unknown> | null {
  const d = date.trim(), t = time.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  const args: Record<string, unknown> = { at: `${d} ${t}` };
  if (until && /^\d{2}:\d{2}$/.test(until.trim()) && until.trim() > t) args.until = until.trim();
  if (needType?.trim()) args.need_type = needType.trim();
  if (pax?.trim() !== undefined && pax?.trim() !== "") args.pax = Math.max(0, Math.min(80, parseInt(pax!.trim(), 10) || 0));
  if (first && first.lat !== undefined && first.lng !== undefined && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
    args.lat = first.lat;
    args.lng = first.lng;
  } else if (first?.place?.trim()) {
    args.first_stop = first.place.trim().slice(0, 160);
  }
  return args;
}

/**
 * "07:24" → "07:20": Who's available on a planned task looks from the 5-minute mark at or before the
 * leave-by time, so a plan that moves by a minute does not ask again.
 */
export function floorTo5(time: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!m) return time;
  const min = Math.floor(Number(m[2]) / 5) * 5;
  return `${m[1]}:${String(min).padStart(2, "0")}`;
}

/** The vehicle a driver brings, in words: "Kamal's vehicle today" (on duty), "Kamal's regular vehicle", or none. */
export interface DefaultVehicle {
  reg_no: string;
  why: string;
}

export function defaultVehicle(d: { name: string; vehicle?: { reg_no: string; source: "on_duty" | "regular" } } | null | undefined): DefaultVehicle | null {
  if (!d?.vehicle?.reg_no) return null;
  const first = d.name.split(" ")[0];
  return { reg_no: d.vehicle.reg_no, why: d.vehicle.source === "on_duty" ? `${first}'s vehicle today` : `${first}'s regular vehicle` };
}

/** The vehicle the picked driver brings: Who's available's row, else the driver list's vehicle today. */
export function driverVehicle(avail: DefaultVehicle | null, driver: { name: string; current_vehicle?: string } | undefined): DefaultVehicle | null {
  if (avail) return avail;
  if (!driver?.current_vehicle) return null;
  return { reg_no: plateOf(driver.current_vehicle), why: `${driver.name.split(" ")[0]}'s vehicle today` };
}

/** The rows in the best-match order (1, 2, 3… the free drivers on duty), then the others as the server sorted them. */
export function rankedRows(rows: AvailableDriver[]): AvailableDriver[] {
  const ranked = rows.filter((r) => r.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return [...ranked, ...rows.filter((r) => r.rank == null)];
}

/** The best match's row (for its vehicle when the best match itself carries none). */
export function bestRow(best: BestMatch | undefined, rows: AvailableDriver[] | undefined): AvailableDriver | undefined {
  if (!best || !rows) return undefined;
  return rows.find((r) => (best.username ? r.username === best.username : r.name === best.name));
}
