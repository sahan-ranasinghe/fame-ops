// Fleet facts shared by several tools: who and what exists, sharing status,
// vehicle status, document chips, service, km this month, and the warnings
// shown when a task is assigned.

import type { Db, Row } from "./db.ts";
import { fetchAll, ToolError, unwrap } from "./db.ts";
import { closest } from "./geo.ts";
import { plain, thousands } from "./format.ts";
import { ago, colomboDate, colomboTime, dayRange, daysBetween, minutesSince, monthRange, shortDate } from "./time.ts";

export type Employee = Row<"employees">;
export type Vehicle = Row<"vehicles">;
export type Task = Row<"tasks">;
export type Latest = Row<"driver_latest">;

// ---------------------------------------------------------------------------
// Reference data: small tables read whole and joined in memory
// ---------------------------------------------------------------------------

export interface Refs {
  employees: Employee[];
  vehicles: Vehicle[];
  emp: Map<string, Employee>;
  veh: Map<string, Vehicle>;
  company: Map<string, Row<"rental_companies">>;
}

export async function loadRefs(db: Db): Promise<Refs> {
  const [employees, vehicles, companies] = await Promise.all([
    db.from("employees").select("*").order("name"),
    db.from("vehicles").select("*").order("reg_no"),
    db.from("rental_companies").select("*").order("name"),
  ]);
  const e = unwrap(employees, "employees");
  const v = unwrap(vehicles, "vehicles");
  const c = unwrap(companies, "rental companies");
  return {
    employees: e,
    vehicles: v,
    emp: new Map(e.map((row) => [row.id, row])),
    veh: new Map(v.map((row) => [row.id, row])),
    company: new Map(c.map((row) => [row.id, row])),
  };
}

export function vehicleLabel(v: Vehicle | undefined): string | null {
  if (!v) return null;
  return v.make_model ? `${v.reg_no} · ${v.make_model}` : v.reg_no;
}

// ---------------------------------------------------------------------------
// Finding a driver or vehicle from what the office typed
// ---------------------------------------------------------------------------

function pickOne<T>(matches: T[], what: string, typed: string, show: (item: T) => string, hint: string): T {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new ToolError(`No ${what} matches "${typed}". ${hint}`);
  throw new ToolError(`"${typed}" matches more than one ${what}: ${matches.slice(0, 8).map(show).join("; ")}. Be more specific.`);
}

/** By username, employee code or name. */
export function findDriver(refs: Refs, typed: string): Employee {
  const drivers = refs.employees.filter((e) => e.role === "driver");
  const want = typed.trim().toLowerCase();
  const exact = drivers.filter((e) => e.username === want || e.code.toLowerCase() === want || e.name.toLowerCase() === want);
  const show = (e: Employee) => `${e.name} (${e.username ?? e.code})`;
  if (exact.length > 0) return pickOne(exact, "driver", typed, show, "");
  const partial = drivers.filter((e) => e.name.toLowerCase().includes(want));
  return pickOne(partial, "driver", typed, show, "Use list_drivers to see the drivers.");
}

/** By plate; spaces, dashes and capitals do not matter ("cab4521" finds "WP CAB-4521"). */
export function findVehicle(refs: Refs, typed: string): Vehicle {
  const want = plain(typed);
  if (want === "") throw new ToolError("The vehicle plate is empty.");
  const show = (v: Vehicle) => v.reg_no;
  const exact = refs.vehicles.filter((v) => plain(v.reg_no) === want);
  if (exact.length > 0) return pickOne(exact, "vehicle", typed, show, "");
  const partial = refs.vehicles.filter((v) => plain(v.reg_no).includes(want));
  return pickOne(partial, "vehicle", typed, show, "Use list_vehicles to see the vehicles.");
}

/** "wp cab-4521" -> "WP CAB-4521" */
export function normalisePlate(typed: string): string {
  return typed.trim().replace(/\s+/g, " ").toUpperCase();
}

// ---------------------------------------------------------------------------
// Location sharing
// ---------------------------------------------------------------------------

export const STALE_AFTER_MINUTES = 15;
export type ShareState = "sharing" | "stale" | "not_sharing";

export interface Sharing {
  state: ShareState;
  /** "Live · 2 min", "Last seen 48 min", "Not sharing" */
  text: string;
  minutes: number | null;
}

/** Sharing = last point under 15 minutes old; stale = older; not sharing = switched off. */
export function sharing(latest: Latest | undefined, now: Date): Sharing {
  const minutes = latest?.recorded_at ? minutesSince(latest.recorded_at, now) : null;
  if (!latest || !latest.sharing) return { state: "not_sharing", text: "Not sharing", minutes };
  if (!latest.recorded_at || minutes === null) return { state: "stale", text: "Sharing · no location yet", minutes: null };
  if (minutes < STALE_AFTER_MINUTES) return { state: "sharing", text: `Live · ${ago(latest.recorded_at, now)}`, minutes };
  return { state: "stale", text: `Last seen ${ago(latest.recorded_at, now)}`, minutes };
}

export async function loadLatest(db: Db): Promise<Map<string, Latest>> {
  const rows = unwrap(await db.from("driver_latest").select("*"), "driver positions");
  return new Map(rows.map((row) => [row.employee_id, row]));
}

/** Name of the nearest town, for "Near <town>". */
export async function nearestTown(db: Db, lat: number, lng: number): Promise<string | null> {
  for (const box of [0.03, 0.1, 0.4]) {
    const rows = unwrap(
      await db.from("towns").select("name, lat, lng")
        .gte("lat", lat - box).lte("lat", lat + box)
        .gte("lng", lng - box).lte("lng", lng + box)
        .limit(1000),
      "towns",
    );
    const town = closest({ lat, lng }, rows);
    if (town) return town.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vehicles: status, documents, service, km this month
// ---------------------------------------------------------------------------

export type VehicleStatus = "In garage" | "On a task" | "Available";

export function vehicleStatus(v: Vehicle, onTask: Set<string>): VehicleStatus {
  if (v.in_garage) return "In garage";
  return onTask.has(v.id) ? "On a task" : "Available";
}

export type Chip = "ok" | "orange" | "red" | "not set";

export interface Doc {
  expiry: string | null;
  chip: Chip;
  days_left: number | null;
}

/** Orange when expiring within 30 days, red within 7 days or already expired. */
export function docChip(expiry: string | null, today: string): Doc {
  if (!expiry) return { expiry: null, chip: "not set", days_left: null };
  const days = daysBetween(today, expiry);
  return { expiry, chip: days <= 7 ? "red" : days <= 30 ? "orange" : "ok", days_left: days };
}

export const VEHICLE_DOCS = [
  { column: "licence_expiry", name: "Revenue licence" },
  { column: "insurance_expiry", name: "Insurance" },
  { column: "emission_expiry", name: "Emission test" },
] as const;

export interface Service {
  km_to_go: number | null;
  date: string | null;
  state: "ok" | "due soon" | "overdue" | "not set";
  /** "In 1,120 km or 2 Nov" */
  text: string;
}

/** Next service: by km (last service + interval) or by date, whichever comes first. */
export function service(v: Vehicle, today: string): Service {
  const kmToGo = v.last_service_odometer_km != null && v.service_interval_km != null && v.current_odometer_km != null
    ? v.last_service_odometer_km + v.service_interval_km - v.current_odometer_km
    : null;
  const days = v.next_service_date ? daysBetween(today, v.next_service_date) : null;
  if (kmToGo === null && days === null) return { km_to_go: null, date: null, state: "not set", text: "Not set" };

  const overdue = (kmToGo !== null && kmToGo <= 0) || (days !== null && days < 0);
  const soon = (kmToGo !== null && kmToGo <= 500) || (days !== null && days <= 14);
  const parts: string[] = [];
  if (kmToGo !== null) parts.push(kmToGo > 0 ? `In ${thousands(kmToGo)} km` : `${thousands(-kmToGo)} km over`);
  if (v.next_service_date) parts.push(`${kmToGo !== null ? "or " : ""}${shortDate(v.next_service_date)}`);
  return {
    km_to_go: kmToGo,
    date: v.next_service_date,
    state: overdue ? "overdue" : soon ? "due soon" : "ok",
    text: parts.join(" "),
  };
}

/**
 * Km driven in a month per vehicle, from odometer readings: the last reading
 * of the month minus the last reading before the month (or, when there is
 * none, the first reading of the month). This includes km that were driven
 * outside tasks, which is what the rental km allowance counts.
 */
export async function monthKm(db: Db, vehicleIds: string[], month: string): Promise<Map<string, number>> {
  const km = new Map<string, number>(vehicleIds.map((id) => [id, 0]));
  if (vehicleIds.length === 0) return km;
  const { from, to } = monthRange(month);

  const [inMonth, before] = await Promise.all([
    fetchAll(
      (a, b) =>
        db.from("odometer_logs").select("id, vehicle_id, reading_km, logged_at")
          .in("vehicle_id", vehicleIds).gte("logged_at", from).lt("logged_at", to)
          .order("logged_at").order("id").range(a, b),
      "odometer logs",
    ),
    Promise.all(vehicleIds.map(async (id) => {
      const rows = unwrap(
        await db.from("odometer_logs").select("reading_km")
          .eq("vehicle_id", id).lt("logged_at", from)
          .order("logged_at", { ascending: false }).limit(1),
        "odometer logs",
      );
      return [id, rows[0]?.reading_km ?? null] as const;
    })),
  ]);

  const base = new Map(before);
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const log of inMonth) {
    if (!first.has(log.vehicle_id)) first.set(log.vehicle_id, log.reading_km);
    last.set(log.vehicle_id, log.reading_km);
  }
  for (const id of vehicleIds) {
    const end = last.get(id);
    const start = base.get(id) ?? first.get(id);
    if (end != null && start != null) km.set(id, Math.max(0, end - start));
  }
  return km;
}

// ---------------------------------------------------------------------------
// Tasks: who is busy, and the warnings shown when assigning
// ---------------------------------------------------------------------------

/** Tasks that are still to do or under way and start on one Colombo day. */
export async function openTasksOn(db: Db, date: string): Promise<Task[]> {
  const { from, to } = dayRange(date);
  return unwrap(
    await db.from("tasks").select("*")
      .in("status", ["assigned", "in_progress"]).gte("start_at", from).lt("start_at", to)
      .order("start_at"),
    "tasks",
  );
}

/** "06:00–13:00" or "from 06:00" */
export function taskWindow(t: Pick<Task, "start_at" | "end_by">): string {
  return t.end_by ? `${colomboTime(t.start_at)}–${colomboTime(t.end_by)}` : `from ${colomboTime(t.start_at)}`;
}

function overlaps(aStart: string, aEnd: string | null, b: Pick<Task, "start_at" | "end_by">): boolean {
  const a0 = new Date(aStart).getTime();
  const a1 = aEnd ? new Date(aEnd).getTime() : a0;
  const b0 = new Date(b.start_at).getTime();
  const b1 = b.end_by ? new Date(b.end_by).getTime() : b0;
  return a0 <= b1 && b0 <= a1;
}

export interface AssignCheck {
  driver: Employee;
  vehicle: Vehicle;
  startAt: string;
  endBy: string | null;
  /** The task being changed, so it is not compared with itself. */
  ignoreTaskId?: string;
}

/**
 * Things the office should know before sending a task. These are warnings,
 * never blocks: the vehicle or driver already has a task, the vehicle is over
 * its monthly km allowance or in the garage, or a document has expired.
 */
export async function assignWarnings(db: Db, check: AssignCheck): Promise<string[]> {
  const { driver, vehicle, startAt, endBy } = check;
  const date = colomboDate(startAt);
  const warnings: string[] = [];

  const [sameDay, km] = await Promise.all([
    openTasksOn(db, date),
    monthKm(db, [vehicle.id], date.slice(0, 7)),
  ]);

  for (const other of sameDay) {
    if (other.id === check.ignoreTaskId) continue;
    const clash = overlaps(startAt, endBy, other) ? "at the same time" : "the same day";
    if (other.vehicle_id === vehicle.id) {
      warnings.push(`${vehicle.reg_no} is booked ${taskWindow(other)} ${clash} (${other.title}).`);
    }
    if (other.employee_id === driver.id) {
      warnings.push(`${driver.name} has another task ${taskWindow(other)} ${clash} (${other.title}).`);
    }
  }

  if (vehicle.in_garage) warnings.push(`${vehicle.reg_no} is marked as in the garage.`);

  const used = km.get(vehicle.id) ?? 0;
  if (vehicle.monthly_km_allowance != null && used > vehicle.monthly_km_allowance) {
    warnings.push(
      `${vehicle.reg_no} is over its monthly km allowance (${thousands(used)} of ${thousands(vehicle.monthly_km_allowance)} km).`,
    );
  }

  for (const doc of VEHICLE_DOCS) {
    const expiry = vehicle[doc.column];
    if (expiry && expiry < date) warnings.push(`${vehicle.reg_no}: ${doc.name.toLowerCase()} expired on ${expiry}.`);
  }
  if (driver.licence_expiry && driver.licence_expiry < date) {
    warnings.push(`${driver.name}'s driving licence expired on ${driver.licence_expiry}.`);
  }
  return warnings;
}
