// The driver picker's rules (Round 3: the name-only driver selects become a list of the driver-first cards with a search
// field, Uber Fleet's and Samsara's driver lists). Which drivers it lists and in what order, the words beside each, and
// the search. Pure.
import type { AvailableDriver, Driver, DriverVehicleRef, NowStatus } from "../data/types";
import { plateOf } from "../lib/format";

/** One driver the picker lists. */
export interface DriverOption {
  username: string;
  name: string;
  photo_url?: string;
  vehicle?: DriverVehicleRef;
  now_status?: NowStatus;
  /** Free or busy for the trip ("Free", "Free · off duty", "Busy"), when the page knows. */
  fit?: { text: string; free: boolean };
}

/**
 * As Who's available's badge: Round 48, the trip's words when the server gives them ("Free Thu 29 Oct", "Busy 09:00–13:00
 * that day · Team drop"), else "Free", "Free · off duty" or "Busy".
 */
export function fitOf(d: Pick<AvailableDriver, "free" | "state" | "free_text" | "busy_text">): { text: string; free: boolean } {
  if (d.free) return { text: d.free_text ?? (d.state === "off_duty" ? "Free · off duty" : "Free"), free: true };
  return { text: d.busy_text ?? "Busy", free: false };
}

/**
 * The options: Who's available's rows first (in its best-match order: they know the trip's time), then the drivers of the
 * list it lacks, then the free drivers of suggest_vehicles it lacks; the driver picked is always there (a pick from a link
 * or a list that could not load). Only active drivers with a username.
 */
export function driverOptions(o: {
  avail?: AvailableDriver[];
  list?: Pick<Driver, "username" | "name" | "photo_url" | "current_vehicle" | "active">[];
  free?: { name: string; username: string; photo_url?: string; vehicle?: DriverVehicleRef; free_text?: string }[];
  /** Words beside a driver of `other` ("free", "on a task until 10:40"): suggest_vehicles' drivers (Round 48: free_text / busy_text first). */
  other?: { name: string; username: string; availability?: string; free_text?: string; busy_text?: string }[];
  picked?: string;
  pickedName?: string;
}): DriverOption[] {
  const out: DriverOption[] = [];
  const seen = new Set<string>();
  const add = (x: DriverOption) => {
    if (!x.username || seen.has(x.username)) return;
    seen.add(x.username);
    out.push(x);
  };
  const rows = o.avail ?? [];
  const ranked = [...rows.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!), ...rows.filter((r) => r.rank == null)];
  for (const d of ranked) {
    if (!d.username) continue;
    add({ username: d.username, name: d.name, photo_url: d.photo_url, vehicle: d.vehicle, now_status: d.now_status, fit: fitOf(d) });
  }
  for (const d of o.list ?? []) {
    if (d.active === false) continue;
    add({ username: d.username, name: d.name, photo_url: d.photo_url, vehicle: d.current_vehicle ? { reg_no: plateOf(d.current_vehicle), source: "on_duty" } : undefined });
  }
  for (const d of o.free ?? []) add({ username: d.username, name: d.name, photo_url: d.photo_url, vehicle: d.vehicle, fit: { text: d.free_text ?? "Free", free: true } });
  for (const d of o.other ?? []) {
    const free = !d.availability || /free/i.test(d.availability);
    // Round 48: the trip's words when given, else suggest_vehicles' availability sentence.
    const text = free ? d.free_text : d.busy_text;
    add({ username: d.username, name: d.name, fit: text ? { text, free } : d.availability ? { text: d.availability, free } : undefined });
  }
  if (o.picked && !seen.has(o.picked)) add({ username: o.picked, name: o.pickedName ?? o.picked });
  return out;
}

/** A search over the name, the username and the plate (spaces and dashes ignored), as the lists' search boxes. */
export function filterOptions(list: DriverOption[], text: string): DriverOption[] {
  const t = text.trim().toLowerCase();
  if (!t) return list;
  const squash = (s: string) => s.toLowerCase().replace(/[\s-]/g, "");
  const tt = squash(t);
  return list.filter((d) => d.name.toLowerCase().includes(t) || d.username.toLowerCase().includes(t) || (!!d.vehicle && squash(d.vehicle.reg_no).includes(tt)));
}
