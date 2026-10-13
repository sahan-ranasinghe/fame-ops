// Tasks: create (with stops, the plan and warnings), plan without creating,
// change the stops of a task, the day's board, one task in detail, cancel,
// reassign.

import { z } from "zod";
import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { freeAt } from "../availability.ts";
import { DECLINE_TEXT } from "../decline.ts";
export { DECLINE_TEXT };
import { basePoint, type Eta, taskEta } from "../eta.ts";
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
import { type Plan, type PlanPoint, type PlanStop, planTask as runPlanner, type StopType, type What } from "../plan.ts";
import { legFnFor, providerFromEnv } from "../routing.ts";
import { loadSettings, type Settings } from "../settings.ts";
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

// ---------------------------------------------------------------------------
// Stops, the start and the plan
// ---------------------------------------------------------------------------

const zStopType = z.enum(["pickup", "drop", "visit"]);
const zWhat = z.enum(["people", "goods", "documents", "other"]);
const zLat = z.number().min(-90).max(90);
const zLng = z.number().min(-180).max(180);
/** "HH:MM" on the task's day, or a full ISO time. */
const zArriveBy = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^\d{4}-\d{2}-\d{2}T/, "Use HH:MM (the task's day) or an ISO time");

export const zStop = z.object({
  type: zStopType,
  what: zWhat.optional().describe("What is picked up or dropped: people, goods, documents, other"),
  place: zText(160).optional().describe("A saved place name (list_places), a town, or free text"),
  address: zText(240).optional(),
  lat: zLat.optional(),
  lng: zLng.optional(),
  dwell_min: z.number().int().min(0).max(1440).optional().describe("Minutes at the stop. Default: the fleet setting for the type and what"),
  arrive_by: zArriveBy.optional().describe("Deadline: HH:MM on the task's day, or an ISO time"),
  note: zText(300).optional().describe("A line for the driver about this stop"),
});
export const zStops = z.array(zStop).min(1).max(12);
export const zStart = z.object({
  place: zText(160).optional(),
  address: zText(240).optional(),
  lat: zLat.optional(),
  lng: zLng.optional(),
}).describe("Where the driver leaves from. Default: the base place (fleet settings)");

export interface ResolvedStop {
  seq: number;
  type: StopType;
  what: What | null;
  place_id: string | null;
  place_name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  dwell_min: number | null;
  arrive_by: string | null;
  note: string | null;
  /** Where the pin came from: a saved place, a town centre, the given lat/lng, or none. */
  pin_from: "place" | "town" | "given" | null;
  planned_arrive_at?: string;
  planned_depart_at?: string;
}

export interface ResolvedStart {
  place_id: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** A town's centre by its exact name (case does not matter), for a stop typed as a town. */
async function townByName(db: Db, text: string): Promise<{ lat: number; lng: number } | null> {
  const rows = unwrap(
    await db.from("towns").select("lat, lng, population").ilike("name", text.trim().replace(/[%_]/g, "")).order("population", {
      ascending: false,
    }).limit(1),
    "towns",
  );
  return rows[0] ? { lat: rows[0].lat, lng: rows[0].lng } : null;
}

function arriveByIso(day: string, value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d{2}:\d{2}$/.test(value)) return utcIso(day, value);
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) throw new ToolError(`arrive_by "${value}" is not a time.`);
  return t.toISOString();
}

type StopInput = z.infer<typeof zStop>;

/** The stops as they go into the database: saved places, towns and typed pins resolved. */
export async function resolveStops(
  db: Db,
  day: string,
  input: { stops?: StopInput[]; pickup?: string; dropoff?: string },
  firstSeq = 1,
): Promise<ResolvedStop[]> {
  const list: StopInput[] = input.stops?.length ? input.stops : [
    ...(input.pickup ? [{ type: "pickup" as const, place: input.pickup }] : []),
    ...(input.dropoff ? [{ type: "drop" as const, place: input.dropoff }] : []),
  ];
  if (list.length === 0) throw new ToolError("A task needs at least one stop (stops[], or pickup and dropoff).");
  const out: ResolvedStop[] = [];
  for (const [i, s] of list.entries()) {
    const typed = (s.place ?? s.address ?? "").trim();
    if (!typed && (s.lat === undefined || s.lng === undefined)) {
      throw new ToolError(`Stop ${i + 1}: give a place, an address or lat and lng.`);
    }
    if ((s.lat === undefined) !== (s.lng === undefined)) throw new ToolError(`Stop ${i + 1}: give both lat and lng, or neither.`);
    const place = typed ? await findPlace(db, typed) : null;
    let lat = place?.lat ?? s.lat ?? null;
    let lng = place?.lng ?? s.lng ?? null;
    let pinFrom: ResolvedStop["pin_from"] = place?.lat != null ? "place" : s.lat !== undefined ? "given" : null;
    if (lat === null && typed) {
      const town = await townByName(db, typed);
      if (town) {
        lat = town.lat;
        lng = town.lng;
        pinFrom = "town";
      }
    }
    out.push({
      seq: firstSeq + i,
      type: s.type,
      what: s.what ?? null,
      place_id: place?.id ?? null,
      place_name: place?.name ?? (typed || `Stop ${i + 1}`),
      address: place?.address ?? s.address ?? null,
      lat,
      lng,
      dwell_min: s.dwell_min ?? null,
      arrive_by: arriveByIso(day, s.arrive_by),
      note: s.note ?? null,
      pin_from: pinFrom,
    });
  }
  return out;
}

/** The start place: the given one (saved place, town or pin), else the base place, else none. */
export async function resolveStart(db: Db, settings: Settings, start: z.infer<typeof zStart> | undefined): Promise<ResolvedStart | null> {
  if (start && (start.place || start.address || start.lat !== undefined)) {
    const typed = (start.place ?? start.address ?? "").trim();
    const place = typed ? await findPlace(db, typed) : null;
    let lat = place?.lat ?? start.lat ?? null;
    let lng = place?.lng ?? start.lng ?? null;
    if (lat === null && typed) {
      const town = await townByName(db, typed);
      if (town) {
        lat = town.lat;
        lng = town.lng;
      }
    }
    return { place_id: place?.id ?? null, name: place?.name ?? (typed || "Start"), lat, lng };
  }
  const base = await basePoint(db, settings);
  return base ? { place_id: base.id, name: base.name, lat: base.point?.lat ?? null, lng: base.point?.lng ?? null } : null;
}

export interface PlanRequest {
  now: Date;
  start: ResolvedStart | null;
  stops: ResolvedStop[];
  returnToBase: boolean;
  avoidExpressway: boolean;
  /** ISO: a leave time by hand (start_time / leave_by); null = plan it from the deadlines. */
  leaveAt: string | null;
  bufferMin: number | null;
  /** For a task under way: where the driver is now, as the origin of the remaining stops. */
  origin?: PlanPoint | null;
}

export type StoredPlan = Plan & { settings_used: Record<string, unknown> };

const point = (p: { lat: number | null; lng: number | null } | null | undefined): PlanPoint | null =>
  p && p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;

/** Runs the planner with the fleet's routing and writes the planned times onto the stops. */
export async function makePlan(db: Db, settings: Settings, p: PlanRequest): Promise<StoredPlan> {
  const base = await basePoint(db, settings);
  const stops: PlanStop[] = p.stops.map((s) => ({
    seq: s.seq,
    type: s.type,
    what: s.what,
    name: s.place_name,
    point: point(s),
    dwell_min: s.dwell_min,
    arrive_by: s.arrive_by,
  }));
  const startPoint = p.origin ?? point(p.start);
  const plan = await runPlanner(
    {
      now: p.now.toISOString(),
      start: startPoint ? { name: p.start?.name ?? "here", point: startPoint } : null,
      base: base ? { name: base.name, point: base.point } : null,
      stops,
      return_to_base: p.returnToBase,
      avoid_expressway: p.avoidExpressway,
      leave_at: p.leaveAt,
      buffer_min: p.bufferMin,
    },
    settings,
    legFnFor(db, settings),
  );
  for (const s of p.stops) {
    const planned = plan.stops.find((x) => x.seq === s.seq);
    if (planned) {
      s.planned_arrive_at = planned.planned_arrive_at;
      s.planned_depart_at = planned.planned_depart_at;
      s.dwell_min = planned.dwell_min;
    }
  }
  return {
    ...plan,
    settings_used: {
      dwell_min: settings.dwell_min,
      buffer_min: plan.buffer_min,
      provider: providerFromEnv(Deno.env.get("ROUTING_PROVIDER")),
    },
  };
}

const SOURCE_LABEL: Record<string, string> = {
  ors: "road time · OpenRouteService",
  google: "road time · Google",
  estimate: "estimate — no routing key",
};

/** The plan as the office reads it. */
export function planSummary(plan: Plan | null | undefined, stopNames: Map<number, string>) {
  if (!plan || !Array.isArray(plan.legs)) return undefined;
  const sources = new Set(plan.legs.map((l) => l.source));
  const source = sources.has("ors") ? "ors" : sources.has("google") ? "google" : "estimate";
  const name = (seq: number) => seq === 0 ? "start" : seq === -1 ? "base" : stopNames.get(seq) ?? `stop ${seq}`;
  return {
    source,
    source_label: SOURCE_LABEL[source],
    computed_at: colomboDateTime(plan.computed_at),
    leave_by: colomboDateTime(plan.leave_by),
    leave_by_source: plan.leave_by_source,
    ends_at: colomboDateTime(plan.ends_at),
    total_drive_min: plan.total_drive_min,
    total_km: plan.total_km,
    buffer_min: plan.buffer_min,
    legs: plan.legs.map((l) => ({
      from: name(l.from_seq),
      to: name(l.to_seq),
      depart: colomboTime(l.depart_at),
      arrive: colomboTime(l.arrive_at),
      km: l.km,
      minutes: Math.round(l.minutes),
      source: l.source,
      via_expressway: l.via_expressway ?? undefined,
      factor: l.factor !== 1 ? l.factor : undefined,
    })),
    warnings: (plan.warnings ?? []).map((w) => w.text),
  };
}

function stopCard(s: ResolvedStop | TaskStop) {
  return {
    seq: s.seq,
    type: s.type,
    what: s.what ?? undefined,
    place: s.place_name,
    address: s.address ?? undefined,
    note: s.note ?? undefined,
    dwell_min: s.dwell_min ?? undefined,
    arrive_by: s.arrive_by ? colomboTime(s.arrive_by) : undefined,
    planned_arrive: s.planned_arrive_at ? colomboTime(s.planned_arrive_at) : undefined,
    planned_depart: s.planned_depart_at ? colomboTime(s.planned_depart_at) : undefined,
    lat: s.lat ?? undefined,
    lng: s.lng ?? undefined,
    pin: "pin_from" in s ? s.pin_from ?? "none" : s.lat != null ? "yes" : "none",
  };
}

// ---------------------------------------------------------------------------
// Saving a task
// ---------------------------------------------------------------------------

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
  stops: ResolvedStop[];
  start: ResolvedStart | null;
  returnToBase: boolean;
  avoidExpressway: boolean;
  leaveBy: string;
  leaveBySource: "plan" | "manual";
  bufferMin: number | null;
  plan: StoredPlan;
  split: Split;
  createdBy: string | null;
  /** Set when the task comes from approving a vehicle request. */
  request?: { id: string; decidedBy: string | null };
}

const stopRow = (s: ResolvedStop) => ({
  seq: s.seq,
  type: s.type,
  place_id: s.place_id,
  place_name: s.place_name,
  address: s.address,
  lat: s.lat,
  lng: s.lng,
  what: s.what,
  note: s.note,
  dwell_min: s.dwell_min,
  arrive_by: s.arrive_by,
  planned_arrive_at: s.planned_arrive_at ?? null,
  planned_depart_at: s.planned_depart_at ?? null,
});

const TYPE_WORD: Record<string, string> = { pickup: "Pickup", drop: "Drop-off", visit: "Visit" };

/** Saves the task, its stops and its project split in one transaction, and builds the reply. */
export async function saveTask(db: Db, t: NewTask, warnings: string[]) {
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
        start_place_id: t.start?.place_id ?? null,
        start_name: t.start?.name ?? null,
        start_lat: t.start?.lat ?? null,
        start_lng: t.start?.lng ?? null,
        return_to_base: t.returnToBase,
        avoid_expressway: t.avoidExpressway,
        leave_by: t.leaveBy,
        leave_by_source: t.leaveBySource,
        buffer_min: t.bufferMin,
        plan_json: t.plan as unknown as Json,
      },
      p_stops: t.stops.map(stopRow),
      p_projects: t.split.rows,
      p_request_id: t.request?.id,
      p_decided_by: t.request?.decidedBy ?? undefined,
    }),
    "task",
  );

  const first = t.stops[0];
  const last = t.stops[t.stops.length - 1];
  const notes = t.stops
    .filter((stop) => stop.lat === null)
    .map((stop) =>
      `"${stop.place_name}" is not a saved place and has no map pin: the driver gets no pin for it and its leg is not timed ` +
      "(add_place saves one)."
    );
  const message = [
    `New task: ${t.title}`,
    `Leave by ${colomboDayTime(t.leaveBy)}`,
    ...t.stops.map((s) => `${TYPE_WORD[s.type]}: ${s.place_name}${s.arrive_by ? ` by ${colomboTime(s.arrive_by)}` : ""}`),
    mapsDirections({ lat: first.lat, lng: first.lng, text: first.address ?? first.place_name }),
  ].filter(Boolean).join("\n");
  const names = new Map(t.stops.map((s) => [s.seq, s.place_name]));

  return {
    result: {
      task_id: taskId,
      title: t.title,
      when: colomboDayTime(t.startAt),
      until: t.endBy ? colomboTime(t.endBy) : undefined,
      leave_by: colomboDayTime(t.leaveBy),
      leave_by_source: t.leaveBySource,
      driver: t.driver.name,
      vehicle: t.vehicle.reg_no,
      pickup: first.place_name,
      dropoff: t.stops.length > 1 ? last.place_name : undefined,
      stops: t.stops.map(stopCard),
      plan: planSummary(t.plan, names),
      projects: t.split.shown.length > 0 ? t.split.shown : "Fame internal (no project)",
      sent: "Sent to the driver's Fame Driver app.",
      warnings,
      notes,
      links: { whatsapp_driver: waLink(t.driver.phone, message), call_driver: telLink(t.driver.phone) },
    },
    summary:
      `task ${taskId}: ${t.title}, leave by ${colomboDateTime(t.leaveBy)} (${t.leaveBySource}), ${t.driver.name}, ${t.vehicle.reg_no}, ` +
      `${t.stops.length} stops` + (warnings.length > 0 ? ` (${warnings.length} warnings)` : ""),
  };
}

/** The planning part of creating a task, shared by create_task, plan_task and decide_request. */
export async function prepareTask(db: Db, settings: Settings, now: Date, args: {
  day: string;
  stops?: StopInput[];
  pickup?: string;
  dropoff?: string;
  start?: z.infer<typeof zStart>;
  return_to_base?: boolean;
  avoid_expressway?: boolean;
  /** ISO: the time typed by hand, if any. */
  leaveAt: string | null;
  buffer_min?: number;
}) {
  const stops = await resolveStops(db, args.day, args);
  const start = await resolveStart(db, settings, args.start);
  const hasDeadline = stops.some((s) => s.arrive_by);
  if (!args.leaveAt && !hasDeadline) {
    throw new ToolError("Give start_time (or leave_by), or an arrive_by time on a stop so the leave-by time can be planned.");
  }
  const plan = await makePlan(db, settings, {
    now,
    start,
    stops,
    returnToBase: args.return_to_base ?? false,
    avoidExpressway: args.avoid_expressway ?? false,
    leaveAt: args.leaveAt,
    bufferMin: args.buffer_min ?? null,
  });
  return { stops, start, plan, leaveBy: plan.leave_by, leaveBySource: plan.leave_by_source };
}

// ---------------------------------------------------------------------------
// Status lines, as on the Tasks screen
// ---------------------------------------------------------------------------

function declinedLine(task: Task): string {
  const reason = DECLINE_TEXT[task.declined_reason ?? ""] ?? task.declined_reason ?? "no reason given";
  return `Declined${task.declined_after_accept ? " after accepting" : ""} (${reason})${
    task.declined_note ? ` · ${task.declined_note}` : ""
  }`;
}

function statusLine(task: Task, latest: Latest | undefined, now: Date): string {
  switch (task.status) {
    case "assigned":
      if (task.accepted_at) return `Accepted ${colomboTime(task.accepted_at)}`;
      return task.seen_at ? `Seen by driver ${colomboTime(task.seen_at)}` : "Sent · not opened yet";
    case "declined":
      return declinedLine(task);
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

/** The stops the task has now (edited-out ones are kept in the table but shown nowhere), in order. */
const live = (stops: TaskStop[]) => stops.filter((s) => s.status !== "removed").sort((a, b) => a.seq - b.seq);

function endsOf(stops: TaskStop[]): { from?: string; to?: string } {
  const ordered = live(stops);
  return { from: ordered[0]?.place_name, to: ordered.length > 1 ? ordered[ordered.length - 1].place_name : undefined };
}

async function getTask(db: Db, id: string): Promise<Task> {
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", id).maybeSingle(), "task");
  if (!task) throw new ToolError(`No task has the id ${id}. Use task_board to find it.`);
  return task;
}

function etaCard(eta: Eta | null, stops: TaskStop[]) {
  if (!eta) return undefined;
  return {
    next_stop: eta.next_seq !== null ? stops.find((s) => s.seq === eta.next_seq)?.place_name : undefined,
    next: eta.next_eta_at ? colomboTime(eta.next_eta_at) : undefined,
    final: eta.final_eta_at ? colomboTime(eta.final_eta_at) : undefined,
    late_min: eta.late_min,
    source: eta.source,
    as_of: colomboTime(eta.computed_at),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const planFields = {
  stops: zStops.optional().describe("The stops in order. Or give pickup and dropoff for the simple two-stop task"),
  pickup: zText(160).optional().describe("Saved place name, or free text (the simple form)"),
  dropoff: zText(160).optional().describe("Saved place name, or free text (the simple form)"),
  start: zStart.optional(),
  return_to_base: z.boolean().optional().describe("The driver returns to the base place at the end"),
  avoid_expressway: z.boolean().optional().describe("Plan the roads without the expressway"),
  leave_by: zTime.optional().describe(
    "A leave time by hand, HH:MM; the plan is then advice. Default: planned from the stops' arrive_by times",
  ),
  buffer_min: z.number().int().min(0).max(600).optional().describe("Arrive this early before a deadline. Default: the fleet setting"),
};

export const createTask = tool({
  name: "create_task",
  title: "Assign a task",
  description: "Creates a task with its stops and sends it to the driver's app. The leave-by time is planned from the stops' arrive_by " +
    "deadlines (road time, dwell at each stop, the buffer), or taken from start_time / leave_by. Returns the plan and warnings (never " +
    "blocks): vehicle or driver already booked, vehicle over its monthly km allowance or in the garage, expired document, a deadline " +
    "that cannot be met, a stop without a map pin. Read the warnings to the user.",
  readOnly: false,
  input: z.object({
    title: zText(120).describe('e.g. "Team drop · Matara sites"'),
    date: zDate.describe("Day of the task (Asia/Colombo), YYYY-MM-DD"),
    start_time: zTime.optional().describe(
      "Leave time, HH:MM. Needed unless a stop has an arrive_by time (then the plan gives the leave-by time)",
    ),
    end_time: zTime.optional().describe("When the vehicle should be free again, HH:MM the same day"),
    driver: zText(80).describe("Driver's username, code or name"),
    vehicle: zText(20).describe("Vehicle plate"),
    ...planFields,
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
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const driver = activeDriver(refs, args.driver);
    const vehicle = activeVehicle(refs, args.vehicle);
    const typed = args.leave_by ?? args.start_time;
    const prepared = await prepareTask(db, settings, now, { day: args.date, ...args, leaveAt: typed ? utcIso(args.date, typed) : null });
    const startAt = prepared.leaveBy;
    const endBy = args.end_time ? utcIso(args.date, args.end_time) : null;
    if (endBy && endBy <= startAt) throw new ToolError("end_time must be later than the leave-by time on the same day.");

    const split = await resolveSplit(db, args.projects);
    const warnings = await assignWarnings(db, { driver, vehicle, startAt, endBy });
    warnings.push(...prepared.plan.warnings.map((w) => w.text));
    if (new Date(startAt) < now) warnings.push("The leave-by time is already in the past.");

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
      stops: prepared.stops,
      start: prepared.start,
      returnToBase: args.return_to_base ?? false,
      avoidExpressway: args.avoid_expressway ?? false,
      leaveBy: prepared.leaveBy,
      leaveBySource: prepared.leaveBySource,
      bufferMin: args.buffer_min ?? null,
      plan: prepared.plan,
      split,
      createdBy: args.created_by ?? "office",
    }, warnings);
  },
});

export const planTask = tool({
  name: "plan_task",
  title: "Plan a task (preview)",
  description: "The leave-by time, the planned arrival and departure at every stop, which legs use the expressway, the total drive time " +
    "and the warnings, without creating anything. With a driver and vehicle the assign warnings too. The road time comes from the " +
    "routing provider (plan.source), or an estimate when none is set.",
  readOnly: true,
  input: z.object({
    date: zDate,
    ...planFields,
    driver: zText(80).optional(),
    vehicle: zText(20).optional(),
    end_time: zTime.optional(),
  }),
  async run(args, { db, now }) {
    realDate(args.date);
    const settings = await loadSettings(db);
    const prepared = await prepareTask(db, settings, now, {
      day: args.date,
      ...args,
      leaveAt: args.leave_by ? utcIso(args.date, args.leave_by) : null,
    });
    const warnings = prepared.plan.warnings.map((w) => w.text);
    if (args.driver && args.vehicle) {
      const refs = await loadRefs(db);
      const driver = activeDriver(refs, args.driver);
      const vehicle = activeVehicle(refs, args.vehicle);
      warnings.push(
        ...await assignWarnings(db, {
          driver,
          vehicle,
          startAt: prepared.leaveBy,
          endBy: args.end_time ? utcIso(args.date, args.end_time) : null,
        }),
      );
    }
    if (new Date(prepared.leaveBy) < now) warnings.push("The leave-by time is already in the past.");
    const names = new Map(prepared.stops.map((s) => [s.seq, s.place_name]));
    return {
      result: {
        date: args.date,
        leave_by: colomboDayTime(prepared.leaveBy),
        leave_by_at: prepared.leaveBy,
        leave_by_source: prepared.leaveBySource,
        start: prepared.start ? { name: prepared.start.name, has_pin: prepared.start.lat != null } : undefined,
        stops: prepared.stops.map(stopCard),
        plan: planSummary(prepared.plan, names),
        warnings,
        settings_used: prepared.plan.settings_used,
      },
      summary:
        `plan ${args.date}: leave by ${colomboDateTime(prepared.leaveBy)} (${prepared.leaveBySource}), ${prepared.stops.length} stops, ` +
        `${prepared.plan.total_drive_min} min`,
    };
  },
});

export const updateTaskStops = tool({
  name: "update_task_stops",
  title: "Change a task's stops",
  description:
    "Replaces the stops of a task that has not finished (arrived, done and skipped stops stay; the pending ones are replaced), " +
    're-plans the leave-by time and the planned times, and tells the driver ("Task changed"). plan_version must be the one task_detail ' +
    "showed: if the task changed since, the call is refused and you reload. For a task under way the plan continues from where the " +
    "driver is now.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    plan_version: z.number().int().min(0).describe("From task_detail"),
    stops: zStops,
    start: zStart.optional(),
    return_to_base: z.boolean().optional(),
    avoid_expressway: z.boolean().optional(),
    leave_by: zTime.optional().describe("A new leave time by hand, HH:MM (a task not started yet)"),
    buffer_min: z.number().int().min(0).max(600).optional(),
  }),
  async run(args, { db, now }) {
    const task = await getTask(db, args.task_id);
    if (task.status !== "assigned" && task.status !== "in_progress") {
      throw new ToolError(`This task is ${task.status.replace("_", " ")}; its stops cannot be changed.`);
    }
    if (task.plan_version !== args.plan_version) {
      throw new ToolError(
        `This task changed since you loaded it (version ${task.plan_version}, you have ${args.plan_version}). Reload it and try again.`,
      );
    }
    const settings = await loadSettings(db);
    const existing = unwrap(await db.from("task_stops").select("*").eq("task_id", task.id).order("seq"), "stops");
    const kept = existing.filter((s) => s.status === "arrived" || s.status === "done" || s.status === "skipped");
    const nextSeq = existing.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
    const day = colomboDate(task.start_at);
    const stops = await resolveStops(db, day, { stops: args.stops }, nextSeq);
    const start = args.start
      ? await resolveStart(db, settings, args.start)
      : (task.start_name
        ? { place_id: task.start_place_id, name: task.start_name, lat: task.start_lat, lng: task.start_lng }
        : await resolveStart(db, settings, undefined));
    const returnToBase = args.return_to_base ?? task.return_to_base;
    const avoidExpressway = args.avoid_expressway ?? task.avoid_expressway;
    const running = task.status === "in_progress";

    let origin: PlanPoint | null = null;
    let leaveAt: string | null;
    if (running) {
      const latest = (await loadLatest(db)).get(task.employee_id);
      const lastKept = [...kept].reverse().find((s) => s.lat != null);
      origin = point(latest ?? null) ?? point(lastKept ?? null) ?? point(start);
      leaveAt = now.toISOString();
    } else {
      const typed = args.leave_by ? utcIso(day, args.leave_by) : null;
      const hasDeadline = stops.some((s) => s.arrive_by);
      leaveAt = typed ?? (hasDeadline ? null : task.leave_by ?? task.start_at);
    }
    const plan = await makePlan(db, settings, {
      now,
      start,
      stops,
      returnToBase,
      avoidExpressway,
      leaveAt,
      bufferMin: args.buffer_min ?? task.buffer_min,
      origin,
    });
    const version = unwrap(
      await db.rpc("office_update_task_stops", {
        p_task_id: task.id,
        p_version: args.plan_version,
        p_task: {
          ...(start && { start_place_id: start.place_id, start_name: start.name, start_lat: start.lat, start_lng: start.lng }),
          return_to_base: returnToBase,
          avoid_expressway: avoidExpressway,
          ...(!running && { leave_by: plan.leave_by, leave_by_source: plan.leave_by_source, start_at: plan.leave_by }),
          buffer_min: args.buffer_min ?? task.buffer_min,
          plan_json: plan as unknown as Json,
        },
        p_stops: stops.map(stopRow),
      }),
      "task stops",
    );
    const names = new Map<number, string>([
      ...kept.map((s) => [s.seq, s.place_name] as const),
      ...stops.map((s) => [s.seq, s.place_name] as const),
    ]);
    return {
      result: {
        task_id: task.id,
        plan_version: version,
        leave_by: colomboDayTime(running ? task.leave_by ?? task.start_at : plan.leave_by),
        leave_by_source: running ? task.leave_by_source ?? "manual" : plan.leave_by_source,
        stops: [...kept.map(stopCard), ...stops.map(stopCard)],
        plan: planSummary(plan, names),
        warnings: plan.warnings.map((w) => w.text),
        sent: "The driver's app shows the new stops (Task changed).",
      },
      summary: `task ${task.id}: stops replaced (version ${version}), ${stops.length} new, ${kept.length} kept`,
    };
  },
});

export const taskBoard = tool({
  name: "task_board",
  title: "Task board",
  description: "The day's tasks in four columns (assigned, in progress, completed, declined = needs a driver) with status lines such as " +
    '"Seen by driver 10:42", "Accepted 10:50", "Sent · not opened yet", "Declined (Vehicle problem)", "Started 07:06 · sharing location", ' +
    '"Done 07:55 · 62 km logged", ' +
    'the leave-by time ("Leave by HH:MM"), the number of stops, and for a task under way the live ETA and how late it runs.',
  readOnly: true,
  input: z.object({ date: zDate.optional().describe("Default: today") }),
  async run({ date }, { db, now }) {
    const today = colomboDate(now);
    const day = realDate(date ?? today);
    const { from, to } = dayRange(day);

    const [refs, latest, settings, ofDay, stillRunning] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      loadSettings(db),
      db.from("tasks").select("*").gte("start_at", from).lt("start_at", to).order("start_at"),
      // Looking at today: also show tasks started on an earlier day that are still running.
      day === today
        ? db.from("tasks").select("*").eq("status", "in_progress").lt("start_at", from).order("start_at")
        : { data: [] as Task[], error: null },
    ]);
    const tasks = [...unwrap(stillRunning, "tasks"), ...unwrap(ofDay, "tasks")];
    const stops = tasks.length > 0 ? unwrap(await db.from("task_stops").select("*").in("task_id", tasks.map((t) => t.id)), "stops") : [];

    const card = async (t: Task) => {
      const mine = live(stops.filter((s) => s.task_id === t.id));
      const eta = t.status === "in_progress" ? await taskEta(db, t, mine, latest.get(t.employee_id), settings, now) : null;
      return {
        id: t.id,
        time: colomboTime(t.start_at),
        started_on: colomboDate(t.start_at) === day ? undefined : colomboDate(t.start_at),
        label: t.label,
        title: t.title,
        ...endsOf(mine),
        stops_count: mine.length,
        leave_by: t.leave_by ? colomboTime(t.leave_by) : undefined,
        accepted: t.accepted_at ? colomboTime(t.accepted_at) : undefined,
        driver: refs.emp.get(t.employee_id)?.name,
        vehicle: refs.veh.get(t.vehicle_id)?.reg_no,
        status: statusLine(t, latest.get(t.employee_id), now),
        eta_next: eta?.next_eta_at ? colomboTime(eta.next_eta_at) : undefined,
        eta_final: eta?.final_eta_at ? colomboTime(eta.final_eta_at) : undefined,
        late_min: eta && eta.late_min > 0 ? eta.late_min : undefined,
      };
    };
    const column = async (status: string) => await Promise.all(tasks.filter((t) => t.status === status).map(card));
    const board = {
      assigned: await column("assigned"),
      in_progress: await column("in_progress"),
      completed: await column("completed"),
      declined: await column("declined"),
    };
    const cancelled = tasks.filter((t) => t.status === "cancelled").length;

    return {
      result: {
        date: day,
        counts: {
          assigned: board.assigned.length,
          in_progress: board.in_progress.length,
          completed: board.completed.length,
          cancelled,
          declined: board.declined.length,
        },
        ...board,
      },
      summary: `${day}: ${board.assigned.length} assigned, ${board.in_progress.length} in progress, ${board.completed.length} completed` +
        (board.declined.length ? `, ${board.declined.length} declined` : ""),
    };
  },
});

export const taskDetail = tool({
  name: "task_detail",
  title: "Task detail",
  description: "Everything about one task: times, the leave-by time and its plan (legs, road time, expressway, source), stops with " +
    "what, dwell, deadline, planned and actual times, the live ETA while it runs, project split, odometer readings (how each was " +
    "entered, what the photo shows, flags) and fuel with photo links (valid 1 hour), vehicle problems reported during it, and " +
    "whether km were driven that nobody logged before it started. plan_version is what update_task_stops needs.",
  readOnly: true,
  input: z.object({ task_id: zId }),
  async run({ task_id }, { db, now, actor }) {
    const task = await getTask(db, task_id);
    // Without assign_tasks a person sees a request's task only: any request's with approve, their own request's otherwise.
    if (!actor.permissions.includes("assign_tasks")) {
      if (!task.request_id) throw new ToolError("This task did not come from a vehicle request.");
      if (!actor.permissions.includes("approve")) {
        const own = unwrapMaybe(
          await db.from("vehicle_requests").select("id").eq("id", task.request_id).eq("requested_by_employee_id", actor.employeeId ?? "")
            .maybeSingle(),
          "vehicle request",
        );
        if (!own) throw new ToolError("This task did not come from one of your requests.");
      }
    }
    const [refs, latest, settings, stopsRes, splitRes, odoRes, fuelRes, reportsRes, eventsRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      loadSettings(db),
      db.from("task_stops").select("*").eq("task_id", task.id).order("seq"),
      db.from("task_projects").select("*").eq("task_id", task.id),
      db.from("odometer_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("fuel_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("vehicle_reports").select("*").eq("task_id", task.id).order("created_at"),
      db.from("task_assignment_events").select("*").eq("task_id", task.id).order("at").order("id"),
    ]);
    const events = unwrap(eventsRes, "assignment history");
    const allStops = unwrap(stopsRes, "stops");
    const stops = live(allStops);
    const removed = allStops.filter((s) => s.status === "removed");
    const split = unwrap(splitRes, "project split");
    const odometer = unwrap(odoRes, "odometer logs");
    const fuel = unwrap(fuelRes, "fuel logs");
    const reports = unwrap(reportsRes, "vehicle reports");

    const projectIds = split.flatMap((row) => row.project_id ? [row.project_id] : []);
    const [projectsRes, links, request, unlogged, gps, eta] = await Promise.all([
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
      taskEta(db, task, stops, latest.get(task.employee_id), settings, now),
    ]);
    const projects = new Map(unwrap(projectsRes, "projects").map((p) => [p.id, p]));
    const requestRow = unwrapMaybe(request, "vehicle request");
    const driver = refs.emp.get(task.employee_id);
    const vehicle = refs.veh.get(task.vehicle_id);
    const when = (at: string | null) => at ? colomboDateTime(at) : undefined;
    const names = new Map(allStops.map((s) => [s.seq, s.place_name]));

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
          leave_by: task.leave_by ? colomboDayTime(task.leave_by) : undefined,
          leave_by_source: task.leave_by_source ?? undefined,
          buffer_min: task.buffer_min ?? undefined,
          start_place: task.start_name ?? undefined,
          return_to_base: task.return_to_base,
          avoid_expressway: task.avoid_expressway,
          plan_version: task.plan_version,
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
          accepted: when(task.accepted_at),
          declined: task.status === "declined"
            ? {
              at: when(task.declined_at),
              reason: task.declined_reason ?? undefined,
              reason_text: DECLINE_TEXT[task.declined_reason ?? ""] ?? task.declined_reason ?? undefined,
              note: task.declined_note ?? undefined,
              after_accept: task.declined_after_accept,
            }
            : undefined,
          started: when(task.started_at),
          completed: when(task.completed_at),
          cancelled_reason: task.cancelled_reason,
          start_odometer_km: task.start_odometer_km,
          end_odometer_km: task.end_odometer_km,
          km: task.km,
          gps_km: gps?.km,
          gps_km_note: gps ? GPS_KM_NOTE : undefined,
          eta: etaCard(eta, stops),
        },
        plan: planSummary(task.plan_json as Plan | null, names),
        stops: stops.map((s) => ({
          ...stopCard(s),
          status: s.status,
          arrived: s.arrived_at ? colomboTime(s.arrived_at) : undefined,
          done: s.done_at ? colomboTime(s.done_at) : undefined,
          skip_reason: s.skip_reason ?? undefined,
          skip_note: s.skip_note ?? undefined,
          navigate: mapsDirections({ lat: s.lat, lng: s.lng, text: s.address ?? s.place_name }),
        })),
        removed_stops: removed.length
          ? removed.map((s) => ({ seq: s.seq, place: s.place_name, removed: s.removed_at ? colomboDateTime(s.removed_at) : undefined }))
          : undefined,
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
        assignment_history: events.map((e) => ({
          at: colomboDateTime(e.at),
          action: e.action,
          driver: e.employee_id ? refs.emp.get(e.employee_id)?.name : undefined,
          vehicle: e.vehicle_id ? refs.veh.get(e.vehicle_id)?.reg_no : undefined,
          actor: e.actor ?? undefined,
          note: e.note ?? undefined,
        })),
        suggestions: task.status === "declined" ? await freeAt(db, task.start_at, task.end_by, task.id) : undefined,
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
    "Cancels a task that is assigned, in progress or declined. The reason is required and the driver's app shows the task as cancelled. Nothing is deleted.",
  readOnly: false,
  input: z.object({ task_id: zId, reason: zText(300) }),
  async run({ task_id, reason }, { db, actor }) {
    const task = await getTask(db, task_id);
    if (task.status === "completed" || task.status === "cancelled") {
      throw new ToolError(`This task is already ${task.status}; it cannot be cancelled.`);
    }
    const changed = unwrap(
      await db.from("tasks").update({ status: "cancelled", cancelled_reason: reason })
        .eq("id", task.id).in("status", ["assigned", "in_progress", "declined"]).select("id"),
      "task",
    );
    if (changed.length === 0) throw new ToolError("The task changed just now (the driver may have completed it). Check task_detail.");
    unwrap(
      await db.from("task_assignment_events").insert({
        task_id: task.id,
        action: "cancelled",
        employee_id: task.employee_id,
        vehicle_id: task.vehicle_id,
        actor: actor.name,
        note: reason,
      }),
      "assignment history",
    );

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
  description: "Changes the driver, the vehicle and/or the leave time of a task that has not started yet, or gives a declined task " +
    "to another driver (or back to the same one). A new driver gets it as a new task; a moved task keeps its plan, shifted. " +
    "Returns the same warnings as create_task.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    driver: zText(80).optional().describe("New driver: username, code or name"),
    vehicle: zText(20).optional().describe("New vehicle plate"),
    start_time: zTime.optional().describe("New leave time, HH:MM"),
    date: zDate.optional().describe("New day, YYYY-MM-DD"),
  }),
  async run({ task_id, driver, vehicle, start_time, date }, { db, now, actor }) {
    if (!driver && !vehicle && !start_time && !date) throw new ToolError("Nothing to change: give a driver, vehicle, start_time or date.");
    if (date) realDate(date);
    const task = await getTask(db, task_id);
    const wasDeclined = task.status === "declined";
    if (task.status !== "assigned" && !wasDeclined) {
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
    const delta = new Date(startAt).getTime() - new Date(task.start_at).getTime();
    const shift = (iso: string | null) => iso && delta !== 0 ? new Date(new Date(iso).getTime() + delta).toISOString() : iso;
    // Keep the planned length of the task when it moves.
    const endBy = shift(task.end_by);
    const driverChanged = newDriver.id !== task.employee_id;
    // A new driver (or a driver who declined and gets it back) starts afresh: not seen, not accepted, no reminder yet.
    const fresh = driverChanged || wasDeclined;

    const changed = unwrap(
      await db.from("tasks").update({
        employee_id: newDriver.id,
        vehicle_id: newVehicle.id,
        start_at: startAt,
        end_by: endBy,
        status: "assigned",
        ...(delta !== 0 && task.leave_by && { leave_by: shift(task.leave_by), leave_by_source: "manual" }),
        ...(fresh && { sent_at: now.toISOString(), seen_at: null, accepted_at: null, accept_reminder_sent_at: null }),
        ...(wasDeclined &&
          { declined_at: null, declined_by: null, declined_reason: null, declined_note: null, declined_after_accept: false }),
      }).eq("id", task.id).in("status", ["assigned", "declined"]).select("id"),
      "task",
    );
    if (changed.length === 0) throw new ToolError("The driver started this task just now, so it was not changed. Check task_detail.");
    unwrap(
      await db.from("task_assignment_events").insert({
        task_id: task.id,
        action: "reassigned",
        employee_id: newDriver.id,
        vehicle_id: newVehicle.id,
        actor: actor.name,
        note: [
          wasDeclined ? "after a decline" : null,
          driverChanged ? `driver ${refs.emp.get(task.employee_id)?.name ?? "?"} → ${newDriver.name}` : null,
          newVehicle.id !== task.vehicle_id ? `vehicle ${refs.veh.get(task.vehicle_id)?.reg_no ?? "?"} → ${newVehicle.reg_no}` : null,
          delta !== 0 ? `time ${colomboDateTime(task.start_at)} → ${colomboDateTime(startAt)}` : null,
        ].filter(Boolean).join("; ") || undefined,
      }),
      "assignment history",
    );
    if (delta !== 0) {
      // The planned times move with the task.
      const stops = unwrap(
        await db.from("task_stops").select("id, planned_arrive_at, planned_depart_at").eq("task_id", task.id).neq("status", "removed"),
        "stops",
      );
      for (const s of stops) {
        if (!s.planned_arrive_at && !s.planned_depart_at) continue;
        unwrap(
          await db.from("task_stops").update({
            planned_arrive_at: shift(s.planned_arrive_at),
            planned_depart_at: shift(s.planned_depart_at),
          }).eq("id", s.id),
          "stop",
        );
      }
    }

    const warnings = await assignWarnings(db, { driver: newDriver, vehicle: newVehicle, startAt, endBy, ignoreTaskId: task.id });
    if (new Date(startAt) < now) warnings.push("The leave-by time is already in the past.");
    const previousDriver = refs.emp.get(task.employee_id);
    return {
      result: {
        task_id: task.id,
        title: task.title,
        when: colomboDayTime(startAt),
        driver: newDriver.name,
        vehicle: newVehicle.reg_no,
        was: wasDeclined ? "declined" : undefined,
        warnings,
        notes: [
          ...(driverChanged ? [`${previousDriver?.name ?? "The previous driver"} no longer sees this task.`] : []),
          ...(wasDeclined ? [`${newDriver.name} gets it as a new task to accept.`] : []),
        ],
        links: { whatsapp_driver: waLink(newDriver.phone), call_driver: telLink(newDriver.phone) },
      },
      summary: `reassigned task ${task.id}: ${newDriver.name}, ${newVehicle.reg_no}, ${colomboDateTime(startAt)}`,
    };
  },
});
