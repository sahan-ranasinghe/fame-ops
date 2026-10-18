// Trips a driver starts (Phase 7, §13): a task of kind self, made by the driver in the app through driver-api, with one
// stop (more may be added on the way), no request and no plan deadline; its leave-by is its start. Company work or
// personal, per the setting driver_personal_trips. Accepted, seen and reminded at once: the driver made it. Idempotent by
// the phone's ids, so the offline queue can send a trip and its stops again.

import type { Db, Row } from "./db.ts";
import { ToolError, unwrap, unwrapMaybe } from "./db.ts";
import { googlePin } from "./googlePlaces.ts";
import { notifyEvent } from "./notifications.ts";
import { loadSettings, type Settings } from "./settings.ts";
import { colomboTime } from "./time.ts";

type Employee = Row<"employees">;
type Task = Row<"tasks">;
type TaskStop = Row<"task_stops">;

export type Purpose = "company" | "personal";

/** Where the trip goes: one of our places, a Google pick (its id and name), a pin, or words only (offline). */
export interface Destination {
  place_id?: string;
  google_place_id?: string;
  name?: string;
  text?: string;
  lat?: number;
  lng?: number;
  session?: string;
}

export interface TripInput {
  /** The phone's id for the trip: the task's id. */
  id: string;
  /** The phone's id for the first stop (its Arrived and Done are queued against it before the trip is sent). */
  stop_id?: string;
  purpose: Purpose;
  destination: Destination;
  note?: string;
  vehicle_id?: string;
  /** When the driver pressed Start on the phone (an offline start is sent later). */
  at?: string;
  /**
   * Sent by the phone's offline queue: the trip has happened already and the phone's records of it (the odometer, fuel,
   * reports) follow it in the queue, so the start-time rules (personal trips off, a task under way, the vehicle, on duty)
   * do not refuse it: each one that would have is noted on the trip's history instead.
   */
  queued?: boolean;
}

/** A Google place's name is Google's: it stays only on the stop (cleared after 30 days); titles and messages say this. */
export const GOOGLE_PLACE = "Google place";

interface StopFields {
  place_id: string | null;
  place_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** A Google pick that could not be fetched (a queued trip at the cap): only its id is kept, under GOOGLE_PLACE. */
  google_place_id?: string;
}

/** May this driver mark a trip personal? (ask_first is reserved and behaves as allowed.) */
export function personalAllowed(settings: Pick<Settings, "driver_personal_trips">): boolean {
  return settings.driver_personal_trips !== "off";
}

/** The phone's time, never in the future and at most a day back (an offline start sent later). */
export function tripTime(at: string | undefined, now: Date): string {
  const t = at ? new Date(at) : now;
  if (isNaN(t.getTime())) throw new ToolError("at: not a time.");
  const clamped = Math.max(Math.min(t.getTime(), now.getTime()), now.getTime() - 86400000);
  return new Date(clamped).toISOString();
}

/** The trip's title on the board and the phone: "Trip · Kadawatha", "Personal trip · Kadawatha". */
export function tripTitle(purpose: Purpose, place: string): string {
  return `${purpose === "personal" ? "Personal trip" : "Trip"} · ${place}`.slice(0, 120);
}

/**
 * The destination as a stop's fields: our place, a Google pick (its pin through our counted gate), a pin, or words. At
 * Google's cap a pick is refused in words (pick again); a queued one keeps only the place id, under GOOGLE_PLACE.
 */
export async function resolveDestination(db: Db, settings: Settings, now: Date, d: Destination, queued = false): Promise<StopFields> {
  const name = (d.name ?? d.text ?? "").trim();
  if (d.place_id) {
    const place = unwrapMaybe(await db.from("places").select("*").eq("id", d.place_id).maybeSingle(), "place");
    if (!place || !place.active) throw new ToolError("That place is not in the list any more: search again.");
    return { place_id: place.id, place_name: place.name, address: place.address, lat: place.lat, lng: place.lng };
  }
  if (d.google_place_id) {
    if (!name) throw new ToolError("A Google place needs its name.");
    const got = await googlePin(db, settings, d.google_place_id, { session: d.session, now });
    if ("note" in got) {
      if (!queued) throw new ToolError(`${got.note}. Pick one of our places, or type the place.`);
      return { place_id: null, place_name: GOOGLE_PLACE, address: null, lat: null, lng: null, google_place_id: d.google_place_id };
    }
    return { place_id: null, place_name: name, address: got.pin.address ?? null, lat: got.pin.lat, lng: got.pin.lng };
  }
  if (d.lat !== undefined && d.lng !== undefined) {
    if (Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180) throw new ToolError("The pin is not a place on the map.");
    return { place_id: null, place_name: name || `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`, address: null, lat: d.lat, lng: d.lng };
  }
  if (!name) throw new ToolError("Where to? Pick a place or type it.");
  return { place_id: null, place_name: name.slice(0, 160), address: null, lat: null, lng: null };
}

/** The trip as the phone and the office read it back. */
export function tripCard(t: Task, stops: TaskStop[]) {
  return {
    task_id: t.id,
    title: t.title,
    kind: t.kind,
    purpose: t.purpose,
    status: t.status,
    vehicle_id: t.vehicle_id,
    started_at: t.start_at,
    stops: stops.filter((s) => s.status !== "removed").sort((a, b) => a.seq - b.seq).map((s) => ({
      stop_id: s.id,
      seq: s.seq,
      type: s.type,
      place: s.place_name,
      place_id: s.place_id ?? undefined,
      lat: s.lat ?? undefined,
      lng: s.lng ?? undefined,
      google: s.google_place_id ? true : undefined,
      status: s.status,
    })),
  };
}

/** The trip's first history row: started by the driver, with what a queued trip broke (see TripInput). */
async function tripStarted(db: Db, task: Task, driver: Employee, noted: string[]) {
  const what = task.purpose === "personal" ? "Personal trip started by the driver" : "Trip started by the driver";
  unwrap(
    await db.from("task_assignment_events").insert({
      task_id: task.id,
      action: "assigned",
      employee_id: driver.id,
      vehicle_id: task.vehicle_id,
      actor: `driver: ${driver.name}`,
      note: noted.length ? `${what} (sent later: ${noted.join("; ")})` : what,
    }),
    "assignment history",
  );
}

async function stopsOf(db: Db, taskId: string): Promise<TaskStop[]> {
  return unwrap(await db.from("task_stops").select("*").eq("task_id", taskId).order("seq"), "stops");
}

/**
 * Starts a trip: the task (kind self, accepted, seen and reminded at once) with its one stop, on the driver's vehicle
 * today unless the phone names another active one. The same id again answers the trip already made (the queue resends).
 */
export async function createSelfTrip(db: Db, now: Date, driver: Employee, input: TripInput) {
  const settings = await loadSettings(db);
  const queued = input.queued === true;
  const existing = unwrapMaybe(await db.from("tasks").select("*").eq("id", input.id).maybeSingle(), "task");
  if (existing) {
    if (existing.employee_id !== driver.id || existing.kind !== "self") throw new ToolError("That id belongs to another task.");
    // A first try that failed half-way (its answer lost): the stop or the history row it did not write.
    let stops = await stopsOf(db, existing.id);
    if (stops.length === 0) {
      const stop = await resolveDestination(db, settings, now, input.destination, true);
      unwrap(
        await db.from("task_stops").insert({
          ...(input.stop_id && { id: input.stop_id }),
          task_id: existing.id,
          seq: 1,
          type: "visit",
          status: "pending",
          ...stop,
        }).select("id"),
        "stop",
      );
      stops = await stopsOf(db, existing.id);
    }
    const events = unwrap(await db.from("task_assignment_events").select("id").eq("task_id", existing.id).limit(1), "assignment history");
    if (events.length === 0) await tripStarted(db, existing, driver, []);
    return { trip: tripCard(existing, stops), repeated: true };
  }
  // The start-time rules: a queued trip has happened already, so each is noted instead of refusing it (see TripInput).
  const noted: string[] = [];
  const rule = (broken: boolean, refusal: string, note: string) => {
    if (!broken) return;
    if (!queued) throw new ToolError(refusal);
    noted.push(note);
  };
  rule(
    input.purpose === "personal" && !personalAllowed(settings),
    "Personal trips are switched off by the office: choose Company work.",
    "personal trips were switched off when it was sent",
  );
  const [running, waiting, onDuty] = await Promise.all([
    db.from("tasks").select("id, title").eq("employee_id", driver.id).eq("status", "in_progress").limit(1),
    db.from("tasks").select("id, title").eq("employee_id", driver.id).eq("kind", "self").eq("status", "assigned").limit(1),
    db.from("duty_sessions").select("id").eq("employee_id", driver.id).is("ended_at", null).limit(1),
  ]);
  const run = unwrap(running, "tasks")[0];
  rule(!!run, `Finish "${run?.title}" first.`, `"${run?.title}" was still under way`);
  const unstarted = unwrap(waiting, "tasks")[0];
  rule(!!unstarted, `Start or cancel your trip "${unstarted?.title}" first.`, `"${unstarted?.title}" had not started`);
  rule(unwrap(onDuty, "duty sessions").length === 0, "Start work first.", "sent while off duty");
  const vehicleId = input.vehicle_id ?? driver.current_vehicle_id;
  if (!vehicleId) throw new ToolError("Start work with today's vehicle first.");
  const vehicle = unwrapMaybe(
    await db.from("vehicles").select("id, reg_no, active, in_garage").eq("id", vehicleId).maybeSingle(),
    "vehicle",
  );
  if (!vehicle) throw new ToolError("That vehicle is not in the list: choose today's vehicle again.");
  rule(!vehicle.active, "That vehicle is not in use any more: choose today's vehicle again.", `${vehicle.reg_no} was switched off`);
  rule(vehicle.in_garage, `${vehicle.reg_no} is in the garage: choose today's vehicle again.`, `${vehicle.reg_no} was in the garage`);

  const stop = await resolveDestination(db, settings, now, input.destination, queued);
  // Google's name stays on the stop only (cleared after 30 days): the title and the office's push say "Google place".
  const shown = input.destination.google_place_id ? GOOGLE_PLACE : stop.place_name;
  const at = tripTime(input.at, now);
  const note = input.note?.trim() || null;
  const by = `driver: ${driver.name}`;
  const task = unwrap(
    await db.from("tasks").insert({
      id: input.id,
      kind: "self",
      purpose: input.purpose,
      title: tripTitle(input.purpose, shown),
      employee_id: driver.id,
      vehicle_id: vehicle.id,
      start_at: at,
      leave_by: at,
      leave_by_source: "manual",
      status: "assigned",
      sent_at: at,
      seen_at: at,
      accepted_at: at,
      // The driver is already going: no leave-by or accept reminders.
      reminder_30_sent_at: at,
      reminder_0_sent_at: at,
      accept_reminder_sent_at: at,
      notes: note,
      created_by: by,
    }).select("*").single(),
    "task",
  );
  const stopRow = unwrap(
    await db.from("task_stops").insert({
      ...(input.stop_id && { id: input.stop_id }),
      task_id: task.id,
      seq: 1,
      type: "visit",
      status: "pending",
      ...stop,
    }).select("*").single(),
    "stop",
  );
  await tripStarted(db, task, driver, noted);
  // Part 6: the stores' demo driver tells the office nothing.
  if (input.purpose === "personal" && !driver.demo) {
    await notifyEvent(db, "trip.personal", {
      title: `${driver.name} started a personal trip to ${shown}`,
      body: `${vehicle.reg_no} · ${colomboTime(at)}`,
      url: `/tasks/${task.id}`,
      tag: `task:${task.id}`,
    }, {});
  }
  return {
    trip: tripCard(task, [stopRow]),
    repeated: false,
    personal_note: input.purpose === "personal" ? "The office is told." : undefined,
  };
}

/** A stop added on the way: the driver's own trip, while it is under way. The same id again answers the stop already added. */
export async function addTripStop(
  db: Db,
  now: Date,
  driver: Employee,
  taskId: string,
  input: { id: string; destination: Destination; queued?: boolean },
) {
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", taskId).maybeSingle(), "task");
  if (!task || task.employee_id !== driver.id) throw new ToolError("No such trip.");
  if (task.kind !== "self") throw new ToolError("Stops of the office's tasks are changed by the office.");
  const stops = await stopsOf(db, task.id);
  const again = stops.find((s) => s.id === input.id);
  if (again) return { trip: tripCard(task, stops), repeated: true };
  if (task.status !== "in_progress") throw new ToolError("A stop is added while the trip is under way.");
  if (stops.filter((s) => s.status !== "removed").length >= 12) throw new ToolError("12 stops at most.");
  const settings = await loadSettings(db);
  const stop = await resolveDestination(db, settings, now, input.destination, input.queued === true);
  const seq = stops.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
  unwrap(
    await db.from("task_stops").insert({ id: input.id, task_id: task.id, seq, type: "visit", status: "pending", ...stop }).select("id"),
    "stop",
  );
  return { trip: tripCard(task, await stopsOf(db, task.id)), repeated: false };
}

/**
 * A trip started by mistake: the driver cancels their own trip while it has not started (it would otherwise wait for the
 * office, and its leave-by would pass). Once started it is finished like any task, or the office cancels it.
 */
export async function cancelSelfTrip(db: Db, driver: Employee, taskId: string) {
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", taskId).maybeSingle(), "task");
  if (!task || task.employee_id !== driver.id || task.kind !== "self") throw new ToolError("No such trip.");
  if (task.status === "cancelled") return { trip: tripCard(task, await stopsOf(db, task.id)), repeated: true };
  if (task.status !== "assigned") throw new ToolError("The trip has started: finish it with the odometer, or ask the office.");
  const by = `driver: ${driver.name}`;
  const rows = unwrap(
    await db.from("tasks").update({ status: "cancelled", cancelled_reason: "Cancelled by the driver before starting" })
      .eq("id", task.id).eq("status", "assigned").select("*"),
    "task",
  );
  if (rows.length === 0) throw new ToolError("The trip changed just now: refresh.");
  unwrap(
    await db.from("task_assignment_events").insert({
      task_id: task.id,
      action: "cancelled",
      employee_id: driver.id,
      vehicle_id: task.vehicle_id,
      actor: by,
      note: "Cancelled by the driver before starting",
    }),
    "assignment history",
  );
  return { trip: tripCard(rows[0], await stopsOf(db, task.id)), repeated: false };
}
