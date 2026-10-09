// Tasks: create (with warnings), the day's board, one task in detail, cancel, reassign.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import {
  assignWarnings,
  type Employee,
  findDriver,
  findVehicle,
  type Latest,
  loadLatest,
  loadRefs,
  odometerCheck,
  type Refs,
  sharing,
  type Task,
  type Vehicle,
} from "../fleet.ts";
import { centsToLkr, contactLinks, mapsDirections, telLink, waLink } from "../format.ts";
import { GPS_KM_NOTE, type Point, summariseRoute } from "../geo.ts";
import { PHOTO_LINK_NOTE, photoLinks, photoOrNote } from "../photos.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime } from "../tool.ts";
import { findPlace } from "./places.ts";
import { findOneProject } from "./projects.ts";

type TaskStop = Row<"task_stops">;

// ---------------------------------------------------------------------------
// Shared with requests.ts (approving a request creates a task the same way)
// ---------------------------------------------------------------------------

export const zSplit = z.array(z.object({
  project: zText(200).describe('Job number (13021), short name (TRKAN1) or full name. "internal" = Fame internal'),
  percent: z.number().gt(0).max(100),
})).max(10).describe("How the cost is split across Zoho projects. Percentages must total 100. Leave out for Fame internal.");

export interface Split {
  rows: { project_id: string | null; percent: number }[];
  shown: { project: string; job_no?: string | null; percent: number }[];
  label: string | null;
}

export async function resolveSplit(db: Db, split: z.infer<typeof zSplit> | undefined): Promise<Split> {
  if (!split || split.length === 0) return { rows: [], shown: [], label: null };
  const total = Math.round(split.reduce((sum, part) => sum + part.percent, 0) * 100) / 100;
  if (total !== 100) throw new ToolError(`The project percentages total ${total}, not 100.`);

  const out: Split = { rows: [], shown: [], label: null };
  for (const part of split) {
    const internal = /^(fame\s+)?internal$/i.test(part.project.trim());
    const project = internal ? null : await findOneProject(db, part.project);
    if (out.rows.some((row) => row.project_id === (project?.id ?? null))) {
      throw new ToolError(`"${part.project}" is listed twice in the project split.`);
    }
    const name = project ? project.short_name ?? project.name : "Fame internal";
    out.rows.push({ project_id: project?.id ?? null, percent: Math.round(part.percent * 100) / 100 });
    out.shown.push({ project: name, job_no: project?.job_no, percent: part.percent });
  }
  out.label = out.shown.length === 1 ? out.shown[0].project : `${out.shown[0].project} +${out.shown.length - 1}`;
  return out;
}

export function activeDriver(refs: Refs, typed: string): Employee {
  const driver = findDriver(refs, typed);
  if (!driver.active) throw new ToolError(`${driver.name} is switched off. Use set_driver_active first.`);
  return driver;
}

export function activeVehicle(refs: Refs, typed: string): Vehicle {
  const vehicle = findVehicle(refs, typed);
  if (!vehicle.active) throw new ToolError(`${vehicle.reg_no} is not active. Use update_vehicle first.`);
  return vehicle;
}

export interface NewTask {
  title: string;
  label: string | null;
  driver: Employee;
  vehicle: Vehicle;
  startAt: string;
  endBy: string | null;
  passengers: number | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  pickup: string;
  dropoff: string;
  split: Split;
  createdBy: string | null;
  /** Set when the task comes from approving a vehicle request. */
  request?: { id: string; decidedBy: string | null };
}

async function stopFor(db: Db, seq: number, type: "pickup" | "drop", typed: string) {
  const place = await findPlace(db, typed);
  return place
    ? { seq, type, place_id: place.id, place_name: place.name, address: place.address, lat: place.lat, lng: place.lng }
    : { seq, type, place_id: null, place_name: typed.trim(), address: null, lat: null, lng: null };
}

/** Saves the task, its two stops and its project split in one transaction, and builds the reply. */
export async function saveTask(db: Db, t: NewTask, warnings: string[]) {
  const stops = [await stopFor(db, 1, "pickup", t.pickup), await stopFor(db, 2, "drop", t.dropoff)];
  const taskId = unwrap(
    await db.rpc("office_create_task", {
      p_task: {
        title: t.title,
        label: t.label,
        employee_id: t.driver.id,
        vehicle_id: t.vehicle.id,
        start_at: t.startAt,
        end_by: t.endBy,
        passengers: t.passengers,
        contact_name: t.contactName,
        contact_phone: t.contactPhone,
        notes: t.notes,
        created_by: t.createdBy,
      },
      p_stops: stops,
      p_projects: t.split.rows,
      p_request_id: t.request?.id,
      p_decided_by: t.request?.decidedBy ?? undefined,
    }),
    "task",
  );

  const notes = stops
    .filter((stop) => stop.place_id === null)
    .map((stop) => `"${stop.place_name}" is not a saved place, so the driver gets no map pin for it (add_place saves one).`);
  const message = [
    `New task: ${t.title}`,
    colomboDayTime(t.startAt),
    `Pickup: ${stops[0].place_name}`,
    `Drop-off: ${stops[1].place_name}`,
    mapsDirections({ lat: stops[0].lat, lng: stops[0].lng, text: stops[0].address ?? stops[0].place_name }),
  ].filter(Boolean).join("\n");

  return {
    result: {
      task_id: taskId,
      title: t.title,
      when: colomboDayTime(t.startAt),
      until: t.endBy ? colomboTime(t.endBy) : undefined,
      driver: t.driver.name,
      vehicle: t.vehicle.reg_no,
      pickup: stops[0].place_name,
      dropoff: stops[1].place_name,
      projects: t.split.shown.length > 0 ? t.split.shown : "Fame internal (no project)",
      sent: "Sent to the driver's Fame Driver app.",
      warnings,
      notes,
      links: { whatsapp_driver: waLink(t.driver.phone, message), call_driver: telLink(t.driver.phone) },
    },
    summary: `task ${taskId}: ${t.title}, ${colomboDateTime(t.startAt)}, ${t.driver.name}, ${t.vehicle.reg_no}` +
      (warnings.length > 0 ? ` (${warnings.length} warnings)` : ""),
  };
}

// ---------------------------------------------------------------------------
// Status lines, as on the Tasks screen
// ---------------------------------------------------------------------------

function statusLine(task: Task, latest: Latest | undefined, now: Date): string {
  switch (task.status) {
    case "assigned":
      return task.seen_at ? `Seen by driver ${colomboTime(task.seen_at)}` : "Sent · not opened yet";
    case "in_progress": {
      const share = sharing(latest, now);
      const where = share.state === "sharing"
        ? "sharing location"
        : share.state === "stale" && share.minutes !== null
        ? `location ${share.minutes} min old`
        : "not sharing location";
      return `Started ${task.started_at ? colomboTime(task.started_at) : "?"} · ${where}`;
    }
    case "completed":
      return `Done ${task.completed_at ? colomboTime(task.completed_at) : "?"} · ${task.km ?? 0} km logged`;
    default:
      return `Cancelled: ${task.cancelled_reason ?? ""}`.trim();
  }
}

function endsOf(stops: TaskStop[]): { from?: string; to?: string } {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  return { from: ordered[0]?.place_name, to: ordered.length > 1 ? ordered[ordered.length - 1].place_name : undefined };
}

async function getTask(db: Db, id: string): Promise<Task> {
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", id).maybeSingle(), "task");
  if (!task) throw new ToolError(`No task has the id ${id}. Use task_board to find it.`);
  return task;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const createTask = tool({
  name: "create_task",
  title: "Assign a task",
  description: "Creates a task and sends it to the driver's app. Returns warnings (never blocks): vehicle or driver already booked, " +
    "vehicle over its monthly km allowance or in the garage, expired document. Read the warnings to the user.",
  readOnly: false,
  input: z.object({
    title: zText(120).describe('e.g. "Team drop · Matara sites"'),
    date: zDate.describe("Day of the task (Asia/Colombo), YYYY-MM-DD"),
    start_time: zTime.describe("Start time, HH:MM"),
    end_time: zTime.optional().describe("When the vehicle should be free again, HH:MM the same day"),
    driver: zText(80).describe("Driver's username, code or name"),
    vehicle: zText(20).describe("Vehicle plate"),
    pickup: zText(160).describe("Saved place name, or free text"),
    dropoff: zText(160).describe("Saved place name, or free text"),
    passengers: z.number().int().min(0).max(80).optional(),
    contact_name: zText(120).optional().describe("Person the driver can call"),
    contact_phone: zText(30).optional(),
    notes: zText(1000).optional(),
    label: zText(40).optional().describe('Short label on the task card, e.g. "Mobitel MS". Default: the project short name'),
    projects: zSplit.optional(),
    created_by: zText(80).optional().describe("Name of the office user assigning the task, if known"),
  }),
  async run(args, { db, now }) {
    realDate(args.date);
    const refs = await loadRefs(db);
    const driver = activeDriver(refs, args.driver);
    const vehicle = activeVehicle(refs, args.vehicle);
    const startAt = utcIso(args.date, args.start_time);
    const endBy = args.end_time ? utcIso(args.date, args.end_time) : null;
    if (endBy && endBy <= startAt) throw new ToolError("end_time must be later than start_time on the same day.");

    const split = await resolveSplit(db, args.projects);
    const warnings = await assignWarnings(db, { driver, vehicle, startAt, endBy });
    if (new Date(startAt) < now) warnings.push("The start time is already in the past.");

    return await saveTask(db, {
      title: args.title,
      label: args.label ?? split.label,
      driver,
      vehicle,
      startAt,
      endBy,
      passengers: args.passengers ?? null,
      contactName: args.contact_name ?? null,
      contactPhone: args.contact_phone ?? null,
      notes: args.notes ?? null,
      pickup: args.pickup,
      dropoff: args.dropoff,
      split,
      createdBy: args.created_by ?? "office",
    }, warnings);
  },
});

export const taskBoard = tool({
  name: "task_board",
  title: "Task board",
  description: "The day's tasks in three columns (assigned, in progress, completed) with status lines such as " +
    '"Seen by driver 10:42", "Sent · not opened yet", "Started 07:06 · sharing location", "Done 07:55 · 62 km logged".',
  readOnly: true,
  input: z.object({ date: zDate.optional().describe("Default: today") }),
  async run({ date }, { db, now }) {
    const today = colomboDate(now);
    const day = realDate(date ?? today);
    const { from, to } = dayRange(day);

    const [refs, latest, ofDay, stillRunning] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("tasks").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
      // Looking at today: also show tasks started on an earlier day that are still running.
      day === today
        ? db.from("tasks").select("*").eq("status", "in_progress").lt("start_at", from).order("start_at")
        : { data: [] as Task[], error: null },
    ]);
    const tasks = [...unwrap(stillRunning, "tasks"), ...unwrap(ofDay, "tasks")];
    const stops = tasks.length > 0 ? unwrap(await db.from("task_stops").select("*").in("task_id", tasks.map((t) => t.id)), "stops") : [];

    const card = (t: Task) => ({
      id: t.id,
      time: colomboTime(t.start_at),
      started_on: colomboDate(t.start_at) === day ? undefined : colomboDate(t.start_at),
      label: t.label,
      title: t.title,
      ...endsOf(stops.filter((s) => s.task_id === t.id)),
      driver: refs.emp.get(t.employee_id)?.name,
      vehicle: refs.veh.get(t.vehicle_id)?.reg_no,
      status: statusLine(t, latest.get(t.employee_id), now),
    });
    const column = (status: string) => tasks.filter((t) => t.status === status).map(card);
    const board = { assigned: column("assigned"), in_progress: column("in_progress"), completed: column("completed") };
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;

    return {
      result: {
        date: day,
        counts: {
          assigned: board.assigned.length,
          in_progress: board.in_progress.length,
          completed: board.completed.length,
          cancelled,
        },
        ...board,
      },
      summary: `${day}: ${board.assigned.length} assigned, ${board.in_progress.length} in progress, ${board.completed.length} completed`,
    };
  },
});

export const taskDetail = tool({
  name: "task_detail",
  title: "Task detail",
  description: "Everything about one task: times, stops, project split, odometer readings (how each was entered, what the photo shows, " +
    "flags) and fuel with photo links (valid 1 hour), vehicle problems reported during it, and whether km were driven that nobody " +
    "logged before it started.",
  readOnly: true,
  input: z.object({ task_id: zId }),
  async run({ task_id }, { db, now, actor }) {
    const task = await getTask(db, task_id);
    if (actor.role === "staff") {
      const own = task.request_id
        ? unwrapMaybe(
          await db.from("vehicle_requests").select("id").eq("id", task.request_id).eq("requested_by_employee_id", actor.employeeId ?? "")
            .maybeSingle(),
          "vehicle request",
        )
        : null;
      if (!own) throw new ToolError("This task did not come from one of your requests.");
    }
    const [refs, latest, stopsRes, splitRes, odoRes, fuelRes, reportsRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("task_stops").select("*").eq("task_id", task.id).order("seq"),
      db.from("task_projects").select("*").eq("task_id", task.id),
      db.from("odometer_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("fuel_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("vehicle_reports").select("*").eq("task_id", task.id).order("created_at"),
    ]);
    const stops = unwrap(stopsRes, "stops");
    const split = unwrap(splitRes, "project split");
    const odometer = unwrap(odoRes, "odometer logs");
    const fuel = unwrap(fuelRes, "fuel logs");
    const reports = unwrap(reportsRes, "vehicle reports");

    const projectIds = split.flatMap((row) => row.project_id ? [row.project_id] : []);
    const [projectsRes, links, request, unlogged, gps] = await Promise.all([
      projectIds.length > 0
        ? db.from("projects").select("id, job_no, short_name, name, customer_name").in("id", projectIds)
        : { data: [], error: null },
      photoLinks(db, {
        ids: [...odometer.map((o) => o.photo_id), ...fuel.map((f) => f.receipt_photo_id)].flatMap((id) => id ? [id] : []),
        reportIds: reports.map((r) => r.id),
      }),
      task.request_id
        ? db.from("vehicle_requests").select("id, requested_by_name, project_label, created_at").eq("id", task.request_id).maybeSingle()
        : { data: null, error: null },
      unloggedBeforeStart(db, odometer.find((o) => o.kind === "task_start")),
      taskGpsKm(db, task, now),
    ]);
    const projects = new Map(unwrap(projectsRes, "projects").map((p) => [p.id, p]));
    const requestRow = unwrapMaybe(request, "vehicle request");
    const driver = refs.emp.get(task.employee_id);
    const vehicle = refs.veh.get(task.vehicle_id);
    const when = (at: string | null) => at ? colomboDateTime(at) : undefined;

    return {
      result: {
        task: {
          id: task.id,
          title: task.title,
          label: task.label,
          status: task.status,
          status_line: statusLine(task, latest.get(task.employee_id), now),
          start: colomboDayTime(task.start_at),
          end_by: task.end_by ? colomboTime(task.end_by) : undefined,
          driver: driver?.name,
          vehicle: vehicle ? `${vehicle.reg_no}${vehicle.make_model ? ` · ${vehicle.make_model}` : ""}` : undefined,
          passengers: task.passengers,
          contact: task.contact_name || task.contact_phone
            ? { name: task.contact_name, phone: task.contact_phone, ...contactLinks(task.contact_phone) }
            : undefined,
          notes: task.notes,
          created_by: task.created_by,
          sent: when(task.sent_at),
          seen: task.seen_at ? colomboDateTime(task.seen_at) : "not opened yet",
          started: when(task.started_at),
          completed: when(task.completed_at),
          cancelled_reason: task.cancelled_reason,
          start_odometer_km: task.start_odometer_km,
          end_odometer_km: task.end_odometer_km,
          km: task.km,
          gps_km: gps?.km,
          gps_km_note: gps ? GPS_KM_NOTE : undefined,
        },
        stops: stops.map((s) => ({
          seq: s.seq,
          type: s.type,
          place: s.place_name,
          address: s.address,
          status: s.status,
          arrived: s.arrived_at ? colomboTime(s.arrived_at) : undefined,
          done: s.done_at ? colomboTime(s.done_at) : undefined,
          navigate: mapsDirections({ lat: s.lat, lng: s.lng, text: s.address ?? s.place_name }),
        })),
        projects: split.length === 0 ? "Fame internal (no project)" : split.map((row) => {
          const p = row.project_id ? projects.get(row.project_id) : undefined;
          return {
            project: p ? p.short_name ?? p.name : "Fame internal",
            job_no: p?.job_no,
            customer: p?.customer_name,
            percent: Number(row.percent),
          };
        }),
        odometer: odometer.map((o) => ({
          kind: o.kind,
          reading_km: o.reading_km,
          entry: o.entry,
          photo_reading: o.ai_value,
          photo_status: o.ai_status,
          photo_attempts: o.photo_attempts,
          camera_read: o.ocr_value,
          flag: o.flag,
          check: odometerCheck(o),
          at: colomboDateTime(o.logged_at),
          photo: photoOrNote(links, o.photo_id),
        })),
        unlogged_km: unlogged,
        fuel: fuel.map((f) => ({
          litres: f.litres === null ? null : Number(f.litres),
          amount_lkr: centsToLkr(f.amount_cents),
          odometer_km: f.odometer_km,
          at: colomboDateTime(f.logged_at),
          receipt_photo: photoOrNote(links, f.receipt_photo_id),
        })),
        vehicle_reports: reports.map((r) => ({
          id: r.id,
          category: r.category,
          note: r.note,
          status: r.status,
          at: colomboDateTime(r.created_at),
          photos: links.byReport.get(r.id) ?? [],
        })),
        from_request: requestRow
          ? {
            id: requestRow.id,
            requested_by: requestRow.requested_by_name,
            project: requestRow.project_label,
            asked: colomboDateTime(requestRow.created_at),
          }
          : undefined,
        driver_links: contactLinks(driver?.phone),
        photo_links: PHOTO_LINK_NOTE,
      },
      summary: `task ${task.id} (${task.status})`,
    };
  },
});

/**
 * Km by GPS while the task was running: the driver's points from the start to
 * the finish (or now), through the drift filter. Nothing when the task has
 * not started or no point was shared.
 */
async function taskGpsKm(db: Db, task: Task, now: Date): Promise<{ km: number } | null> {
  if (!task.started_at) return null;
  const until = task.completed_at ?? now.toISOString();
  const rows = await fetchAll(
    (a, b) =>
      db.from("location_points").select("id, recorded_at, lat, lng, speed_mps, accuracy_m")
        .eq("employee_id", task.employee_id).gte("recorded_at", task.started_at!).lte("recorded_at", until)
        .order("recorded_at").order("id").range(a, b),
    "location points",
  );
  if (rows.length === 0) return null;
  const points: Point[] = rows.map((r) => ({ at: r.recorded_at, lat: r.lat, lng: r.lng, speedMps: r.speed_mps, accuracyM: r.accuracy_m }));
  return { km: summariseRoute(points).km };
}

/**
 * Km the vehicle moved between its last logged reading and the start of this
 * task. More than 2 km means somebody drove without logging it.
 */
export async function unloggedBeforeStart(db: Db, startLog: Row<"odometer_logs"> | undefined) {
  if (!startLog) return undefined;
  const previous = unwrap(
    await db.from("odometer_logs").select("reading_km, logged_at")
      .eq("vehicle_id", startLog.vehicle_id).lt("logged_at", startLog.logged_at)
      .order("logged_at", { ascending: false }).limit(1),
    "odometer logs",
  )[0];
  if (!previous) return undefined;
  const gap = startLog.reading_km - previous.reading_km;
  if (Math.abs(gap) <= 2) return undefined;
  return {
    km: gap,
    last_logged_km: previous.reading_km,
    last_logged_at: colomboDateTime(previous.logged_at),
    start_km: startLog.reading_km,
  };
}

export const cancelTask = tool({
  name: "cancel_task",
  title: "Cancel a task",
  description:
    "Cancels a task that is assigned or in progress. The reason is required and the driver's app shows the task as cancelled. Nothing is deleted.",
  readOnly: false,
  input: z.object({ task_id: zId, reason: zText(300) }),
  async run({ task_id, reason }, { db }) {
    const task = await getTask(db, task_id);
    if (task.status === "completed" || task.status === "cancelled") {
      throw new ToolError(`This task is already ${task.status}; it cannot be cancelled.`);
    }
    const changed = unwrap(
      await db.from("tasks").update({ status: "cancelled", cancelled_reason: reason })
        .eq("id", task.id).in("status", ["assigned", "in_progress"]).select("id"),
      "task",
    );
    if (changed.length === 0) throw new ToolError("The task changed just now (the driver may have completed it). Check task_detail.");

    const driver = unwrapMaybe(await db.from("employees").select("name, phone").eq("id", task.employee_id).maybeSingle(), "employee");
    return {
      result: {
        cancelled: task.title,
        was: task.status,
        reason,
        note: task.request_id ? "The vehicle request this task came from stays approved." : undefined,
        tell_the_driver: {
          whatsapp: waLink(driver?.phone, `Task cancelled: ${task.title} (${colomboDayTime(task.start_at)}). ${reason}`),
          call: telLink(driver?.phone),
        },
      },
      summary: `cancelled task ${task.id} (${task.title}): ${reason}`,
    };
  },
});

export const reassignTask = tool({
  name: "reassign_task",
  title: "Reassign or move a task",
  description: "Changes the driver, the vehicle and/or the start time of a task that has not started yet. " +
    "A new driver gets it as a new task. Returns the same warnings as create_task.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    driver: zText(80).optional().describe("New driver: username, code or name"),
    vehicle: zText(20).optional().describe("New vehicle plate"),
    start_time: zTime.optional().describe("New start time, HH:MM"),
    date: zDate.optional().describe("New day, YYYY-MM-DD"),
  }),
  async run({ task_id, driver, vehicle, start_time, date }, { db, now }) {
    if (!driver && !vehicle && !start_time && !date) throw new ToolError("Nothing to change: give a driver, vehicle, start_time or date.");
    if (date) realDate(date);
    const task = await getTask(db, task_id);
    if (task.status !== "assigned") {
      throw new ToolError(
        `This task is ${
          task.status.replace("_", " ")
        }. Only a task that has not started can be reassigned; cancel it and create a new one.`,
      );
    }

    const refs = await loadRefs(db);
    const newDriver = driver ? activeDriver(refs, driver) : refs.emp.get(task.employee_id)!;
    const newVehicle = vehicle ? activeVehicle(refs, vehicle) : refs.veh.get(task.vehicle_id)!;
    const startAt = utcIso(date ?? colomboDate(task.start_at), start_time ?? colomboTime(task.start_at));
    // Keep the planned length of the task when it moves.
    const endBy = task.end_by
      ? new Date(new Date(task.end_by).getTime() + new Date(startAt).getTime() - new Date(task.start_at).getTime()).toISOString()
      : null;
    const driverChanged = newDriver.id !== task.employee_id;

    const changed = unwrap(
      await db.from("tasks").update({
        employee_id: newDriver.id,
        vehicle_id: newVehicle.id,
        start_at: startAt,
        end_by: endBy,
        ...(driverChanged && { sent_at: now.toISOString(), seen_at: null }),
      }).eq("id", task.id).eq("status", "assigned").select("id"),
      "task",
    );
    if (changed.length === 0) throw new ToolError("The driver started this task just now, so it was not changed. Check task_detail.");

    const warnings = await assignWarnings(db, { driver: newDriver, vehicle: newVehicle, startAt, endBy, ignoreTaskId: task.id });
    if (new Date(startAt) < now) warnings.push("The start time is already in the past.");
    const previousDriver = refs.emp.get(task.employee_id);
    return {
      result: {
        task_id: task.id,
        title: task.title,
        when: colomboDayTime(startAt),
        driver: newDriver.name,
        vehicle: newVehicle.reg_no,
        warnings,
        notes: driverChanged ? [`${previousDriver?.name ?? "The previous driver"} no longer sees this task.`] : [],
        links: { whatsapp_driver: waLink(newDriver.phone), call_driver: telLink(newDriver.phone) },
      },
      summary: `reassigned task ${task.id}: ${newDriver.name}, ${newVehicle.reg_no}, ${colomboDateTime(startAt)}`,
    };
  },
});
