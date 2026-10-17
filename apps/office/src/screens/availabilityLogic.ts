// "Who's available" in words and tones, from an availability row; the vehicle a
// driver brings (Phase 7, §3) and the best-match order. Pure.
import { shortName } from "@fleet/names";
import type { Availability, AvailableDriver, BestMatch } from "../data/types";
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

/**
 * The vehicle a driver brings, in words: "Kamal's vehicle today" (on duty), "Kamal's regular vehicle", or none; the full
 * name when another driver in `names` has the same first name ("Test Driver's" beside "Test Driver 2's").
 */
export interface DefaultVehicle {
  reg_no: string;
  why: string;
}

export function defaultVehicle(d: { name: string; vehicle?: { reg_no: string; source: "on_duty" | "regular" } } | null | undefined, names: readonly string[]): DefaultVehicle | null {
  if (!d?.vehicle?.reg_no) return null;
  const who = shortName(d.name, names);
  return { reg_no: d.vehicle.reg_no, why: d.vehicle.source === "on_duty" ? `${who}'s vehicle today` : `${who}'s regular vehicle` };
}

/** The vehicle the picked driver brings: Who's available's row, else the driver list's vehicle today. */
export function driverVehicle(avail: DefaultVehicle | null, driver: { name: string; current_vehicle?: string } | undefined, names: readonly string[]): DefaultVehicle | null {
  if (avail) return avail;
  if (!driver?.current_vehicle) return null;
  return { reg_no: plateOf(driver.current_vehicle), why: `${shortName(driver.name, names)}'s vehicle today` };
}

/**
 * A driver select's options with the picked driver in them even when the list lacks them (it could not load, or the
 * driver is new): a pick from Who's available always shows in the select.
 */
export function withPicked<T extends { username: string; name: string }>(list: T[], picked: string, name: string | undefined): (T | { username: string; name: string })[] {
  if (!picked || list.some((d) => d.username === picked)) return list;
  return [...list, { username: picked, name: name ?? picked }];
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

const driverKey = (r: { username?: string | null; name: string }) => r.username ?? r.name;

/** How much nearer to the first stop a driver must come before a refresh re-ranks Who's available, km. */
export const RERANK_KM = 0.5;

/** `b` (shown lower) is now really nearer than `a`: by more than RERANK_KM, or it has a position and `a` has none. */
const nearer = (b: AvailableDriver, a: AvailableDriver) =>
  b.km_to_first != null && (a.km_to_first == null || a.km_to_first - b.km_to_first > RERANK_KM);

/**
 * A refresh of Who's available for the same day and time (useQuery's merge; hotfix, 17 October 2026). Two drivers
 * parked side by side would swap places, and the best match with them, on every refresh as their GPS wanders. So the
 * ranking and the best match shown stay while the same drivers are in the ranking and none of them is now nearer than
 * one shown above it by more than RERANK_KM; the words (status, reasons, counts, vehicles) are the fresh ones. A driver
 * joining or leaving the ranking, or a real move, ranks them all again.
 */
export function steadyAvailability(prev: Availability, next: Availability): Availability {
  const ranked = (a: Availability) => a.drivers.filter((r) => r.rank != null).map(driverKey).sort().join("\n");
  if (ranked(prev) !== ranked(next)) return next;
  const fresh = new Map(next.drivers.map((r) => [driverKey(r), r]));
  const shown = rankedRows(prev.drivers).filter((r) => r.rank != null).map((r) => fresh.get(driverKey(r))!);
  if (shown.some((a, i) => shown.slice(i + 1).some((b) => nearer(b, a)))) return next;
  const rankOf = new Map(prev.drivers.map((r) => [driverKey(r), r.rank]));
  const drivers = next.drivers.map((r) => (r.rank === rankOf.get(driverKey(r)) ? r : { ...r, rank: rankOf.get(driverKey(r)) }));
  const held = prev.best && next.best && driverKey(prev.best) !== driverKey(next.best) ? prev.best : undefined;
  const row = held ? fresh.get(driverKey(held)) : undefined;
  const best = held ? { ...held, vehicle: row?.vehicle, why: row?.match_why ?? held.why } : next.best;
  return { ...next, drivers, best };
}
