// Vehicle requests: staff ask for a vehicle, the office approves (which creates
// the task), declines, books one directly in one step (book_vehicle: request and
// task in one transaction), or cancels a booking (cancel_request). A vehicle with
// a custodian (an office person who keeps it) is "ask first"; when driver_required
// is false the custodian drives it: the task is theirs, with no app behind it.
// Phase 6: the requester edits a request (update_request; an approved one becomes
// "changed" and needs re-approval), the approver decides it again
// (redecide_request: keep, change, decline), every step is a request_events row
// (the timeline), and a request can be made on behalf of someone else.

import { z } from "zod";
import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import {
  assignCheck,
  assignWarnings,
  type Employee,
  isDriver,
  loadRefs,
  monthKm,
  openTasksOn,
  type Refs,
  type Task,
  taskWindow,
  type Vehicle,
} from "../fleet.ts";
import { contactLinks } from "../format.ts";
import { notifyEvent } from "../notifications.ts";
import { hasAny } from "../permissions.ts";
import type { Actor } from "../roles.ts";
import { ago, colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime, zVehicleType } from "../tool.ts";
import { matchProjects } from "./projects.ts";
import { stopChanges, stopForChange } from "../stopChanges.ts";
import { actorUserId, logRequestEvent, requester } from "./requestCore.ts";
import { type RequestStop, requestStopsOf, resolvedFromRow, saveRequestTrip, startOfRequest } from "./requestTrip.ts";
import { loadSettings } from "../settings.ts";
import { canRedecide, checkVersion, diffText, requestDiff, type RequestFields, snapshot, statusAfterEdit } from "../requests_rules.ts";
import {
  activeDriver,
  activeVehicle,
  type BookingRequest,
  changesText,
  changeTask,
  defaultVehicleFor,
  makePlan,
  pickVehicle,
  planTimeline,
  prepareTask,
  type ResolvedStop,
  saveTask,
  type Split,
  stopCard,
  type StoredPlan,
  updateTaskStops,
  type VehicleChoice,
  zStart,
  zStops,
} from "./tasks.ts";

type VehicleRequest = Row<"vehicle_requests">;
type RequestEvent = Row<"request_events">;
type EventAction = RequestEvent["action"];

const TYPE_NAME: Record<string, string> = { car: "Car", van: "Van", double_cab: "Double cab", lorry: "Lorry", other: "Other" };

/** "Van · 6 pax + tools" */
function needText(r: Pick<VehicleRequest, "need_type" | "pax" | "tools">): string {
  const parts = [r.need_type ? TYPE_NAME[r.need_type] ?? r.need_type : "Any vehicle"];
  if (r.pax != null) parts.push(`${r.pax} pax`);
  return parts.join(" · ") + (r.tools ? " + tools" : "");
}

const by = (at: string | null, who: string | null) => at ? `${colomboDateTime(at)}${who ? ` by ${who}` : ""}` : undefined;

function eventCard(e: RequestEvent) {
  return {
    at: colomboDateTime(e.at),
    action: e.action,
    actor: e.actor ?? undefined,
    note: e.note ?? undefined,
    changes: e.changes ?? undefined,
  };
}

/** The names a proposed task's card shows (Phase 7, §33). */
interface CardRefs {
  people: Map<string, { name: string; username: string | null }>;
  plates: Map<string, string>;
}

/** The request's trip (Phase 7, §34): the start, the stops with their times, the plan timeline; and the fields to edit it. */
function tripOf(r: VehicleRequest, stops: RequestStop[], withLine: boolean) {
  if (stops.length === 0) return undefined;
  const resolved = stops.map(resolvedFromRow);
  const plan = r.plan_json as unknown as StoredPlan | null;
  return {
    start: r.start_name
      ? {
        name: r.start_name,
        has_pin: r.start_lat != null,
        lat: r.start_lat ?? undefined,
        lng: r.start_lng ?? undefined,
        google: r.start_google_place_id ? true : undefined,
      }
      : undefined,
    leave_by: r.leave_by ? colomboTime(r.leave_by) : undefined,
    leave_by_source: r.leave_by_source ?? undefined,
    return_to_base: r.return_to_base || undefined,
    avoid_expressway: r.avoid_expressway || undefined,
    stops: resolved.map((s, i) => ({ ...stopCard(s, i), google: stops[i].google_place_id ? true : undefined })),
    timeline: planTimeline(plan, resolved, withLine),
  };
}

/** The trip as the edit form takes it back (update_request's stops and start). */
function tripFields(r: VehicleRequest, stops: RequestStop[]) {
  if (stops.length === 0) return {};
  return {
    stops: stops.filter((s) => !s.is_start).map((s) => ({
      type: s.type,
      what: s.what ?? undefined,
      place: s.place_name,
      place_id: s.place_id ?? undefined,
      google_place_id: s.google_place_id ?? undefined,
      address: s.address ?? undefined,
      lat: s.lat ?? undefined,
      lng: s.lng ?? undefined,
      dwell_min: s.dwell_source === "chosen" ? s.dwell_min ?? undefined : undefined,
      arrive_by: s.arrive_by ? colomboTime(s.arrive_by) : undefined,
      note: s.note ?? undefined,
    })),
    start: r.start_name
      ? {
        place: r.start_name,
        place_id: r.start_place_id ?? undefined,
        google_place_id: r.start_google_place_id ?? undefined,
        lat: r.start_lat ?? undefined,
        lng: r.start_lng ?? undefined,
        passengers: stops.some((s) => s.is_start) || undefined,
      }
      : undefined,
    leave_by: r.leave_by_source === "manual" && r.leave_by ? colomboTime(r.leave_by) : undefined,
    return_to_base: r.return_to_base || undefined,
    avoid_expressway: r.avoid_expressway || undefined,
  };
}

function requestCard(
  r: VehicleRequest,
  now: Date,
  events: RequestEvent[] = [],
  stops: RequestStop[] = [],
  refs?: CardRefs,
  withLine = false,
) {
  const sameDay = r.back_by && colomboDate(r.back_by) === colomboDate(r.needed_at);
  // Decided = approved or declined (a cancelled booking was approved first; a cancelled waiting request was never decided).
  const decided = r.status === "approved" || r.status === "changed" || r.status === "declined" || (r.status === "cancelled" && r.task_id);
  return {
    id: r.id,
    // Phase 7 (§33): "task" = a task proposed by someone without approve, with the proposed driver and vehicle.
    kind: r.kind,
    title: r.title ?? undefined,
    requested_by: r.requested_by_name,
    on_behalf_of: r.on_behalf_of ?? undefined,
    project: r.project_label,
    when: colomboDayTime(r.needed_at),
    back_by: r.back_by ? (sameDay ? colomboTime(r.back_by) : colomboDayTime(r.back_by)) : undefined,
    route: [r.route_from, r.route_to].filter(Boolean).join(" → ") || undefined,
    need: needText(r),
    note: r.note,
    status: r.status,
    asked: `${ago(r.created_at, now)} ago`,
    decided: decided ? by(r.decided_at, r.decided_by) : undefined,
    decline_reason: r.decline_reason,
    task_id: r.task_id,
    driver_required: r.driver_required,
    one_step: r.one_step ? true : undefined,
    cancelled: by(r.cancelled_at, r.cancelled_by),
    cancel_reason: r.cancel_reason,
    version: r.version,
    // Waiting past its leave-by: it stays in the queue, never sent by itself (§35 18).
    late: r.status === "waiting" && new Date(r.needed_at) <= now ? true : undefined,
    proposed: r.kind === "task"
      ? {
        driver: r.proposed_employee_id ? refs?.people.get(r.proposed_employee_id)?.name : undefined,
        username: r.proposed_employee_id ? refs?.people.get(r.proposed_employee_id)?.username ?? undefined : undefined,
        vehicle: r.proposed_vehicle_id ? refs?.plates.get(r.proposed_vehicle_id) : undefined,
        vehicle_why: (r.proposal_json as { vehicle_why?: string } | null)?.vehicle_why ?? undefined,
        warnings: (r.proposal_json as { warnings?: string[] } | null)?.warnings?.length
          ? (r.proposal_json as { warnings: string[] }).warnings
          : undefined,
        conflicts: (r.proposal_json as { conflicts?: unknown[] } | null)?.conflicts?.length
          ? (r.proposal_json as { conflicts: unknown[] }).conflicts
          : undefined,
        passengers: r.pax ?? undefined,
        contact_name: r.contact_name ?? undefined,
        contact_phone: r.contact_phone ?? undefined,
        notes: r.task_notes ?? undefined,
      }
      : undefined,
    stops_count: stops.length || undefined,
    trip: tripOf(r, stops, withLine),
    // The fields as the edit form needs them (Colombo day and clock).
    fields: {
      date: colomboDate(r.needed_at),
      time: colomboTime(r.needed_at),
      back_by: r.back_by ? colomboTime(r.back_by) : undefined,
      route_from: r.route_from ?? undefined,
      route_to: r.route_to ?? undefined,
      need_type: r.need_type ?? undefined,
      pax: r.pax ?? undefined,
      tools: r.tools,
      note: r.note ?? undefined,
      driver_required: r.driver_required,
      on_behalf_of: r.on_behalf_of ?? undefined,
      from_dwell_min: r.from_dwell_min ?? undefined,
      to_dwell_min: r.to_dwell_min ?? undefined,
      ...tripFields(r, stops),
    },
    // An approved booking the requester edited: what changed since it was approved, until it is decided again.
    changed: r.changed_at
      ? { at: colomboDateTime(r.changed_at), by: r.changed_by ?? undefined, note: r.change_note ?? undefined }
      : undefined,
    changes: r.status === "changed" && r.previous ? requestDiff(r.previous as unknown as RequestFields, snapshot(r)) : undefined,
    timeline: {
      sent: colomboDateTime(r.created_at),
      seen: by(r.seen_at, r.seen_by),
      decided: decided ? by(r.decided_at, null) : undefined,
      decided_by: decided ? r.decided_by ?? undefined : undefined,
      changed: by(r.changed_at, r.changed_by),
      cancelled: by(r.cancelled_at, r.cancelled_by),
    },
    events: events.map(eventCard),
  };
}

/** The cards with their timelines and trips (one query each for all the rows). */
async function requestCards(db: Db, rows: VehicleRequest[], now: Date, withLine = false) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const people = [...new Set(rows.flatMap((r) => r.proposed_employee_id ? [r.proposed_employee_id] : []))];
  const plates = [...new Set(rows.flatMap((r) => r.proposed_vehicle_id ? [r.proposed_vehicle_id] : []))];
  const [events, stops, emps, vehs] = await Promise.all([
    db.from("request_events").select("*").in("request_id", ids).order("at").order("id").limit(5000),
    requestStopsOf(db, ids),
    people.length ? db.from("employees").select("id, name, username").in("id", people) : { data: [], error: null },
    plates.length ? db.from("vehicles").select("id, reg_no").in("id", plates) : { data: [], error: null },
  ]);
  const evs = unwrap(events, "request events");
  const refs: CardRefs = {
    people: new Map(unwrap(emps, "employees").map((e) => [e.id, { name: e.name, username: e.username }])),
    plates: new Map(unwrap(vehs, "vehicles").map((v) => [v.id, v.reg_no])),
  };
  return rows.map((r) => requestCard(r, now, evs.filter((e) => e.request_id === r.id), stops.get(r.id) ?? [], refs, withLine));
}

async function requestCardOf(db: Db, row: VehicleRequest, now: Date, withLine = false) {
  return (await requestCards(db, [row], now, withLine))[0];
}

async function getRequest(db: Db, id: string): Promise<VehicleRequest> {
  const request = unwrapMaybe(await db.from("vehicle_requests").select("*").eq("id", id).maybeSingle(), "vehicle request");
  if (!request) throw new ToolError(`No vehicle request has the id ${id}. Use list_requests to find it.`);
  return request;
}

/** The first time someone who approves opens a waiting request, it counts as seen (the requester's timeline). */
async function markSeen(db: Db, request: VehicleRequest, actor: Actor, now: Date): Promise<VehicleRequest> {
  if (request.seen_at || request.status !== "waiting" || !actor.permissions.includes("approve")) return request;
  const rows = unwrap(
    await db.from("vehicle_requests").update({ seen_at: now.toISOString(), seen_by: actor.name }).eq("id", request.id).is("seen_at", null)
      .select("*"),
    "vehicle request",
  );
  if (rows[0]) await logRequestEvent(db, request.id, "seen", actor.name, { at: now.toISOString() });
  return rows[0] ?? request;
}

const SELF_DRIVE_OFF = "Self-drive bookings are switched off (Settings → Fleet, self_drive_allowed): give a driver.";

/** The driver of a booking: the one named, or the vehicle's custodian when no driver is needed (and self-drive is allowed). */
function pickDriver(refs: Refs, typed: string | undefined, driverRequired: boolean, vehicle: Vehicle, selfDrive: boolean): Employee {
  if (typed) return activeDriver(refs, typed);
  if (!driverRequired) {
    if (!selfDrive) throw new ToolError(SELF_DRIVE_OFF);
    const custodian = vehicle.custodian_employee_id ? refs.emp.get(vehicle.custodian_employee_id) : undefined;
    if (custodian?.active) return custodian;
    throw new ToolError(`${vehicle.reg_no} has no custodian to drive it: give a driver.`);
  }
  throw new ToolError("Give a driver, or set driver_required to false so the vehicle's custodian drives it.");
}

/** Warnings about the vehicle against what was asked for (never blocks). */
function fitWarnings(vehicle: Vehicle, need: { need_type?: string | null; pax?: number | null }): string[] {
  const out: string[] = [];
  if (need.need_type && vehicle.vehicle_type !== need.need_type) {
    out.push(
      `${vehicle.reg_no} is a ${(TYPE_NAME[vehicle.vehicle_type] ?? vehicle.vehicle_type).toLowerCase()}, not a ${
        TYPE_NAME[need.need_type]?.toLowerCase()
      }.`,
    );
  }
  if (need.pax != null && vehicle.seats != null && vehicle.seats < need.pax) {
    out.push(`${vehicle.reg_no} has ${vehicle.seats} seats for ${need.pax} passengers.`);
  }
  return out;
}

const requestFields = {
  project: zText(200).optional().describe('Project or team it is for: job number, short name, or a plain label such as "HR"'),
  date: zDate.describe("Day the vehicle is needed, YYYY-MM-DD"),
  time: zTime.optional().describe("Time it is needed (the leave time), HH:MM. Needed unless a stop has an arrive_by time (Phase 7)"),
  back_by: zTime.optional().describe("Time it will be back the same day, HH:MM"),
  route_from: zText(160).optional(),
  route_to: zText(160).optional(),
  need_type: zVehicleType.optional().describe("Kind of vehicle needed"),
  pax: z.number().int().min(0).max(80).optional().describe("Number of passengers"),
  tools: z.boolean().optional().describe("true if tools or equipment travel too"),
  note: zText(1000).optional(),
  driver_required: z.boolean().optional().describe("false when no driver is needed: the vehicle's custodian drives. Default true"),
  from_dwell_min: z.number().int().min(0).max(1440).optional().describe(
    "Minutes at the From place (the pickup). Default: its usual time, else 5",
  ),
  to_dwell_min: z.number().int().min(0).max(1440).optional().describe("Minutes at the To place. Default: its usual time, else 5 (a drop)"),
};

/** Phase 7 (§34): the whole trip, as Assign a task plans it (the stops win over route_from and route_to). */
const tripInput = {
  stops: zStops.optional().describe(
    "The trip's stops in order, as create_task takes them (with arrive_by deadlines; the leave time is then planned). " +
      "Default: route_from → route_to",
  ),
  start: zStart.optional(),
  return_to_base: z.boolean().optional().describe("The vehicle returns to the base place at the end"),
  avoid_expressway: z.boolean().optional(),
};

/** The time a request leaves: as typed, else none (the plan gives it from an arrive_by). */
function typedLeave(date: string, time: string | undefined, stops: { arrive_by?: string }[] | undefined): string | null {
  if (time) return utcIso(date, time);
  if (!stops?.some((s) => s.arrive_by)) throw new ToolError("Give time (when the vehicle leaves), or an arrive_by time on a stop.");
  return null;
}

export const createRequest = tool({
  name: "create_request",
  title: "New vehicle request",
  description:
    "Records that someone needs a vehicle. It waits for approval; decide_request approves it (creating the task) or declines it. " +
    "The request is in the asker's name (an approver may name someone else with requested_by); on_behalf_of names the person it is " +
    "for when it is not the asker, who stays the one notified.",
  readOnly: false,
  input: z.object({
    requested_by: zText(120).optional().describe(
      "Who asks. Default: you (someone who can neither approve nor assign always asks in their own name)",
    ),
    on_behalf_of: zText(120).optional().describe("The person the vehicle is for, when it is not the asker"),
    ...requestFields,
    ...tripInput,
  }),
  async run(args, { db, now, actor }) {
    realDate(args.date);
    // Phase 7 (§34): with stops, the trip is planned as a task's is (the leave time from the deadlines when none is typed).
    const settingsNow = await loadSettings(db);
    const trip = args.stops
      ? await prepareTask(db, settingsNow, now, {
        day: args.date,
        stops: args.stops,
        start: args.start,
        return_to_base: args.return_to_base,
        avoid_expressway: args.avoid_expressway,
        leaveAt: typedLeave(args.date, args.time, args.stops),
      })
      : null;
    if (!trip && !args.time) throw new ToolError("Give time (when the vehicle is needed).");
    const neededAt = trip ? trip.leaveBy : utcIso(args.date, args.time!);
    const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than the leave time on the same day.");
    const firstStop = trip?.stops.find((s) => !s.is_start) ?? trip?.stops[0];
    const lastStop = trip?.stops[trip.stops.length - 1];

    if (args.driver_required === false && !settingsNow.self_drive_allowed) throw new ToolError(SELF_DRIVE_OFF);
    // A project that is known from Zoho is linked; anything else is kept as a label.
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const who = await requester(db, actor, args.requested_by);
    const staff = !hasAny(actor.permissions, ["approve", "assign_tasks"]);

    const created = unwrap(
      await db.from("vehicle_requests").insert({
        requested_by_name: who.name,
        requested_by_employee_id: who.employeeId,
        requested_by_user_id: who.userId,
        project_id: project?.id ?? null,
        project_label: project ? project.short_name ?? project.name : args.project ?? null,
        needed_at: neededAt,
        back_by: backBy,
        // With a trip, From and To are its first and last stops (what the cards and older readers show).
        route_from: firstStop?.place_name ?? args.route_from ?? null,
        route_to: (lastStop && lastStop !== firstStop ? lastStop.place_name : null) ?? args.route_to ?? null,
        need_type: args.need_type ?? null,
        pax: args.pax ?? null,
        tools: args.tools ?? false,
        note: args.note ?? null,
        driver_required: args.driver_required ?? true,
        on_behalf_of: args.on_behalf_of ?? null,
        from_dwell_min: args.from_dwell_min ?? null,
        to_dwell_min: args.to_dwell_min ?? null,
      }).select("*").single(),
      "vehicle request",
    );
    if (trip) {
      await saveRequestTrip(db, created.id, {
        start: trip.start,
        stops: trip.stops,
        plan: trip.plan,
        returnToBase: args.return_to_base ?? false,
        avoidExpressway: args.avoid_expressway ?? false,
        leaveBy: trip.leaveBy,
        leaveBySource: trip.leaveBySource,
        bufferMin: null,
      }, now);
    }
    await logRequestEvent(db, created.id, "created", actor.name, { at: created.created_at });
    await notifyEvent(db, "request.created", {
      title: `Vehicle request · ${created.requested_by_name}${args.on_behalf_of ? ` for ${args.on_behalf_of}` : ""}`,
      body: [
        colomboDayTime(neededAt),
        args.need_type ? TYPE_NAME[args.need_type] : "any vehicle",
        [created.route_from, created.route_to].filter(Boolean).join(" → "),
      ]
        .filter(Boolean).join(" · "),
      url: "/requests",
      tag: `request:${created.id}`,
    }, { actor: actor.employeeId });
    const row = trip ? await getRequest(db, created.id) : created;
    return {
      result: {
        request: await requestCardOf(db, row, now),
        warnings: trip?.plan.warnings.length ? trip.plan.warnings.map((w) => w.text) : undefined,
        project_linked: args.project
          ? (project ? `${project.job_no ?? ""} ${project.name}`.trim() : "no (kept as a label only)")
          : undefined,
        next: staff ? "Sent to the fleet admin · you'll be notified." : "suggest_vehicles shows which vehicles and drivers are free.",
      },
      summary: `request ${created.id} by ${who.name} for ${colomboDateTime(neededAt)}`,
    };
  },
});

export const listRequests = tool({
  name: "list_requests",
  title: "List vehicle requests",
  description: "Vehicle requests. By default those needing a decision (waiting, and approved ones the requester changed), soonest " +
    "first. Everyone's with the approve permission; otherwise the person's own. Each carries its version, its timeline (sent, seen, " +
    "decided, changed, cancelled), its events and, for a changed one, what changed since it was approved. Phase 7: kind task = a " +
    "task proposed by someone without approve (proposed driver, vehicle, warnings); trip = the stops with their planned times; " +
    "late = waiting past its leave-by.",
  readOnly: true,
  input: z.object({
    status: z.enum(["waiting", "changed", "approved", "declined", "cancelled", "all"]).optional().describe(
      "Default: waiting (which includes changed = approved and edited since, needing re-approval)",
    ),
    kind: z.enum(["request", "task"]).optional().describe("task = only tasks proposed by someone without approve (Phase 7)"),
    id: zId.optional().describe("Only this request"),
    with_line: z.boolean().optional().describe("The web's plan map: each leg's Google road line in the trip's timeline"),
  }),
  async run({ status = "waiting", kind, id, with_line }, { db, now, actor }) {
    let query = db.from("vehicle_requests").select("*");
    if (kind) query = query.eq("kind", kind);
    if (id) query = query.eq("id", id);
    if (status === "waiting") query = query.in("status", ["waiting", "changed"]);
    else if (status !== "all") query = query.eq("status", status);
    // The queue (everyone's requests) is the approver's; everyone else sees their own.
    if (!actor.permissions.includes("approve")) {
      query = query.eq("requested_by_employee_id", actor.employeeId ?? "00000000-0000-0000-0000-000000000000");
    }
    const rows = unwrap(
      await query.order("needed_at", { ascending: status === "waiting" || status === "changed" }).limit(100),
      "vehicle requests",
    );
    return {
      result: { status, count: rows.length, requests: await requestCards(db, rows, now, with_line === true) },
      summary: `${rows.length} requests (${status})`,
    };
  },
});

export interface Window {
  neededAt: string;
  backBy: string | null;
  need_type: string | null;
  pax: number | null;
}

/** Every active vehicle ranked for a window, in the four groups, and every active driver with whether he is free. */
export async function availabilityFor(db: Db, refs: Refs, w: Window) {
  const day = colomboDate(w.neededAt);
  const dayEnd = new Date(dayRange(day).to).getTime();
  const from = new Date(w.neededAt).getTime();
  const to = w.backBy ? new Date(w.backBy).getTime() : dayEnd;
  const busy = (t: Task) => new Date(t.start_at).getTime() < to && from < (t.end_by ? new Date(t.end_by).getTime() : dayEnd);

  const vehicles = refs.vehicles.filter((v) => v.active);
  const [tasks, km, settings] = await Promise.all([
    openTasksOn(db, day),
    monthKm(db, vehicles.map((v) => v.id), day.slice(0, 7)),
    loadSettings(db),
  ]);

  const ranked = vehicles.map((v) => {
    const mine = tasks.filter((t) => t.vehicle_id === v.id);
    const clash = mine.find(busy);
    const used = km.get(v.id) ?? 0;
    const over = v.monthly_km_allowance != null && used > v.monthly_km_allowance;
    const availability = v.in_garage
      ? "in garage"
      : clash
      ? `booked ${taskWindow(clash)} · ${clash.title}`
      : over
      ? "over km allowance"
      : mine.length === 0
      ? "free all day"
      : `free at that time (other task ${taskWindow(mine[0])})`;
    const fits = [
      w.need_type && v.vehicle_type !== w.need_type
        ? `is a ${TYPE_NAME[v.vehicle_type]?.toLowerCase() ?? v.vehicle_type}, not a ${TYPE_NAME[w.need_type]?.toLowerCase()}`
        : null,
      w.pax != null && v.seats != null && v.seats < w.pax ? `only ${v.seats} seats` : null,
    ].filter(Boolean);
    const rank = (v.in_garage || clash ? 20 : over ? 10 : 0) + fits.length;
    const custodian = v.custodian_employee_id ? refs.emp.get(v.custodian_employee_id) : undefined;
    const card = {
      reg_no: v.reg_no,
      make_model: v.make_model,
      type: v.vehicle_type,
      seats: v.seats,
      availability,
      pick: v.in_garage || clash ? "no" : over || fits.length > 0 ? "possible" : "good",
      but: fits.length > 0 ? fits.join(", ") : undefined,
      regular_driver: v.regular_driver_id ? refs.emp.get(v.regular_driver_id)?.name : undefined,
      assigned_to: custodian?.name,
      custodian_note: custodian ? v.custodian_note ?? undefined : undefined,
    };
    const group: "in_garage" | "busy" | "free_assigned" | "free_pool" = v.in_garage
      ? "in_garage"
      : clash
      ? "busy"
      : custodian
      ? "free_assigned"
      : "free_pool";
    const extra = group === "free_assigned"
      ? { ...contactLinks(custodian?.phone), note: "ask first" }
      : group === "busy" && clash
      ? { back: clash.end_by ? `back ~${colomboTime(clash.end_by)}` : "end time not set" }
      : {};
    return { rank, group, card, entry: { ...card, ...extra } };
  }).sort((a, b) => a.rank - b.rank);

  const drivers = refs.employees.filter((e) => e.role === "driver" && e.active).map((e) => {
    const mine = tasks.filter((t) => t.employee_id === e.id);
    const clash = mine.find(busy);
    return {
      name: e.name,
      username: e.username,
      availability: clash
        ? `task ${taskWindow(clash)} · ${clash.title}`
        : mine.length === 0
        ? "free all day"
        : `free at that time (other task ${taskWindow(mine[0])})`,
      free: !clash,
    };
  }).sort((a, b) => Number(b.free) - Number(a.free));
  const groups = {
    free_pool: ranked.filter((r) => r.group === "free_pool").map((r) => r.entry),
    free_assigned: ranked.filter((r) => r.group === "free_assigned").map((r) => r.entry),
    busy: ranked.filter((r) => r.group === "busy").map((r) => r.entry),
    in_garage: ranked.filter((r) => r.group === "in_garage").map((r) => r.entry),
  };
  return {
    vehicles: ranked.map((r) => r.card),
    drivers: drivers.map(({ free: _free, ...card }) => card),
    groups,
    drivers_free: drivers.filter((d) => d.free).map((d) => ({ name: d.name, username: d.username })),
    self_drive_allowed: settings.self_drive_allowed,
    good: ranked.some((r) => r.card.pick === "good"),
    day,
  };
}

export const suggestVehicles = tool({
  name: "suggest_vehicles",
  title: "Suggest vehicles for a request",
  description:
    'For one request, or for a day and time: every vehicle marked "free all day", "over km allowance", "booked HH:MM–HH:MM" or "in garage", ' +
    "best first, in four groups (the free pool; free but assigned to a custodian: ask first, with call and WhatsApp links; busy, with " +
    "when it is back; in the garage), and which drivers are free that day. Opening a request this way counts as seen.",
  readOnly: true,
  input: z.object({
    request_id: zId.optional().describe("The request, or give date and time instead"),
    date: zDate.optional(),
    time: zTime.optional(),
    back_by: zTime.optional(),
    need_type: zVehicleType.optional(),
    pax: z.number().int().min(0).max(80).optional(),
  }),
  async run(args, { db, now, actor }) {
    let request: VehicleRequest | null = null;
    let w: Window;
    if (args.request_id) {
      request = await markSeen(db, await getRequest(db, args.request_id), actor, now);
      w = { neededAt: request.needed_at, backBy: request.back_by, need_type: request.need_type, pax: request.pax };
    } else {
      if (!args.date || !args.time) throw new ToolError("Give request_id, or date and time.");
      realDate(args.date);
      const neededAt = utcIso(args.date, args.time);
      const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
      if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
      w = { neededAt, backBy, need_type: args.need_type ?? null, pax: args.pax ?? null };
    }
    const refs = await loadRefs(db);
    const a = await availabilityFor(db, refs, w);

    const { groups, good, day: _day, ...rest } = a;
    return {
      result: {
        request: request ? await requestCardOf(db, request, now) : undefined,
        window: {
          when: colomboDayTime(w.neededAt),
          back_by: w.backBy ? colomboTime(w.backBy) : undefined,
          need: needText({ need_type: w.need_type, pax: w.pax, tools: false }),
        },
        ...rest,
        groups,
        next: request
          ? good
            ? request.status === "waiting"
              ? "decide_request with decision=approve, a vehicle and a driver (none needed when the custodian drives)."
              : "redecide_request: keep, change the vehicle or driver, postpone, or decline with a reason."
            : "Nothing is clearly free: pick the best possible one, or decline with a reason."
          : good
          ? "book_vehicle books one of them in one step."
          : "Nothing is clearly free: book_vehicle the best possible one, or try another time.",
      },
      summary: request
        ? `suggestions for request ${request.id}: ${groups.free_pool.length} free, ${groups.free_assigned.length} assigned, ${groups.busy.length} busy`
        : `suggestions for ${
          colomboDayTime(w.neededAt)
        }: ${groups.free_pool.length} free, ${groups.free_assigned.length} assigned, ${groups.busy.length} busy`,
    };
  },
});

export const decideRequest = tool({
  name: "decide_request",
  title: "Approve or decline a request",
  description:
    "approve: needs a driver (the vehicle fills itself: the one they hold today, else their regular one; or name it), or a vehicle " +
    "alone when the request says driver_required false and the vehicle has a custodian (the custodian drives); start and the minutes " +
    "at From and To are optional; creates the task and sends it to the driver, and returns the same warnings as create_task. " +
    "decline: needs a reason. A request can be decided only once.",
  readOnly: false,
  input: z.object({
    request_id: zId,
    decision: z.enum(["approve", "decline"]),
    vehicle: zText(20).optional().describe("Plate (approve)"),
    driver: zText(80).optional().describe("Username, code or name (approve)"),
    reason: zText(300).optional().describe("Why it is declined (decline)"),
    title: zText(120).optional().describe("Task title. Default: built from the route"),
    decided_by: zText(80).optional().describe("Name of the office user deciding, if known"),
    // Phase 7 (§11, §17): the approver may set where the trip starts and the times at From and To (the request keeps its own).
    start: zStart.optional(),
    from_dwell_min: z.number().int().min(0).max(720).optional().describe("Approve: minutes at the From place. Default: the request's"),
    to_dwell_min: z.number().int().min(0).max(720).optional().describe("Approve: minutes at the To place. Default: the request's"),
    // Phase 7 (§33): the approver may change the times of a proposed task or a planned request (the stops stay as asked).
    date: zDate.optional().describe("Approve: another day (the stops' arrive_by times move with it)"),
    leave_by: zTime.optional().describe("Approve: another leave time, HH:MM (the plan then follows it)"),
    back_by: zTime.optional().describe("Approve: another time the vehicle is free again, HH:MM"),
  }),
  async run(args, { db, now, actor }) {
    let request = await getRequest(db, args.request_id);
    if (request.status !== "waiting") throw new ToolError(`This request is already ${request.status}.`);
    request = await markSeen(db, request, actor, now);
    const decidedBy = args.decided_by ?? actor.name;
    const told = { actor: actor.employeeId, requester: request.requested_by_employee_id };

    if (args.decision === "decline") {
      if (!args.reason) throw new ToolError("A reason is needed to decline a request.");
      const changed = unwrap(
        await db.from("vehicle_requests")
          .update({
            status: "declined",
            decided_at: now.toISOString(),
            decided_by: decidedBy,
            decline_reason: args.reason,
            version: request.version + 1,
          })
          .eq("id", request.id).eq("status", "waiting").select("*"),
        "vehicle request",
      );
      if (changed.length === 0) throw new ToolError("Someone else decided this request just now. Check list_requests.");
      await logRequestEvent(db, request.id, "declined", decidedBy, { note: args.reason });
      await notifyEvent(db, "request.decided", {
        title: request.kind === "task" ? `Task declined · ${request.title ?? "your task"}` : "Request declined",
        body: args.reason,
        url: `/requests/${request.id}`,
        tag: `request:${request.id}`,
      }, told);
      return { result: { request: await requestCardOf(db, changed[0], now) }, summary: `declined request ${request.id}: ${args.reason}` };
    }

    // Phase 7 (§33, §34): a proposed task, or a request planned with its stops: the task takes the stops as asked.
    const tripRows = (await requestStopsOf(db, [request.id])).get(request.id) ?? [];
    if (tripRows.length > 0) return await approveTrip(db, now, actor, request, tripRows, args, decidedBy, told);

    if (!args.vehicle && !args.driver) {
      throw new ToolError(
        "To approve, give a driver (the vehicle fills itself: the one they hold today, else their regular one) or a vehicle. " +
          "suggest_vehicles and availability show who is free.",
      );
    }
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const chosen = chooseVehicle(refs, args.vehicle, args.driver, decidedBy, now);
    const vehicle = chosen.vehicle;
    const driver = pickDriver(refs, args.driver, request.driver_required, vehicle, settings.self_drive_allowed);
    const warnings = await assignWarnings(db, { driver, vehicle, startAt: request.needed_at, endBy: request.back_by });
    warnings.push(...fitWarnings(vehicle, request));

    const split: Split = request.project_id
      ? {
        rows: [{ project_id: request.project_id, percent: 100 }],
        shown: [{ project: request.project_label ?? "project", percent: 100 }],
        label: request.project_label,
      }
      : { rows: [], shown: [], label: request.project_label };
    const requesterRow = request.requested_by_employee_id ? refs.emp.get(request.requested_by_employee_id) : undefined;
    const prepared = await prepareTask(db, settings, now, {
      day: colomboDate(request.needed_at),
      // The request's From and To, with the times the requester gave there (Phase 7, §17).
      stops: [
        {
          type: "pickup",
          place: request.route_from ?? "To be confirmed",
          dwell_min: args.from_dwell_min ?? request.from_dwell_min ?? undefined,
        },
        { type: "drop", place: request.route_to ?? "To be confirmed", dwell_min: args.to_dwell_min ?? request.to_dwell_min ?? undefined },
      ],
      start: args.start,
      leaveAt: request.needed_at,
    });
    warnings.push(...prepared.notes);
    warnings.push(...prepared.plan.warnings.map((w) => w.text));

    const saved = await saveTask(db, {
      title: args.title ?? (request.route_to ? `Trip · ${request.route_to}` : `Trip for ${request.requested_by_name}`),
      label: request.project_label,
      driver,
      vehicle,
      startAt: request.needed_at,
      endBy: request.back_by,
      passengers: request.pax,
      contactName: request.requested_by_name,
      contactPhone: requesterRow?.phone ?? null,
      notes: [request.note, request.tools ? "Tools / equipment travel too." : null, isDriver(driver) ? null : "Driven by the custodian."]
        .filter(Boolean).join(" ") || null,
      stops: prepared.stops,
      start: prepared.start,
      returnToBase: false,
      avoidExpressway: false,
      leaveBy: prepared.leaveBy,
      leaveBySource: prepared.leaveBySource,
      bufferMin: null,
      plan: prepared.plan,
      split,
      createdBy: decidedBy,
      request: { id: request.id, decidedBy },
      bookedBy: actor.employeeId,
      vehicleChoice: isDriver(driver) ? chosen.choice : null,
      savedWarnings: warnings,
      assignedBy: actor.employeeId,
      vehicleWhy: chosen.why,
    }, warnings);
    // Every decision bumps the version (the approval itself is written by office_create_task).
    unwrap(await db.from("vehicle_requests").update({ version: request.version + 1 }).eq("id", request.id).select("id"), "vehicle request");
    await logRequestEvent(db, request.id, "approved", decidedBy, { note: `${vehicle.reg_no} · ${driver.name}` });
    await notifyEvent(db, "request.decided", {
      title: `Request approved · ${vehicle.reg_no} · ${driver.name}`,
      body: [colomboDayTime(request.needed_at), [request.route_from, request.route_to].filter(Boolean).join(" → ")].filter(Boolean).join(
        " · ",
      ),
      url: `/requests/${request.id}`,
      tag: `request:${request.id}`,
    }, told);

    return {
      result: { request: "approved", requested_by: request.requested_by_name, ...saved.result },
      summary: `approved request ${request.id} -> ${saved.summary}`,
    };
  },
});

/**
 * Approving a request that carries its trip (Phase 7, §33, §34): a proposed task (the proposed driver and vehicle unless
 * the approver changes them) or a request planned with stops. The task takes the request's stops as they are, with nothing
 * retyped. The plan is kept as planned unless the approver changes the day or the leave time; then it is planned again
 * (the stops' arrive_by times move with the day).
 */
async function approveTrip(
  db: Db,
  now: Date,
  actor: Actor,
  request: VehicleRequest,
  rows: RequestStop[],
  args: { driver?: string; vehicle?: string; title?: string; date?: string; leave_by?: string; back_by?: string },
  decidedBy: string,
  told: { actor: string | null; requester: string | null },
) {
  const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
  const proposed = request.proposed_employee_id ? refs.emp.get(request.proposed_employee_id) : undefined;
  if (args.driver === undefined && proposed && !proposed.active) {
    throw new ToolError(`${proposed.name} (proposed) is switched off: give another driver.`);
  }
  const driverTyped = args.driver ?? (proposed ? proposed.username ?? proposed.code : undefined);
  const sameAsProposed = !args.driver || (proposed !== undefined && sameDriver(proposed, args.driver));
  const proposedPlate = request.proposed_vehicle_id ? refs.veh.get(request.proposed_vehicle_id)?.reg_no : undefined;
  const vehicleTyped = args.vehicle ?? (sameAsProposed ? proposedPlate : undefined);
  if (!vehicleTyped && !driverTyped) {
    throw new ToolError(
      "To approve, give a driver (the vehicle fills itself: the one they hold today, else their regular one) or a vehicle. " +
        "availability shows who is free.",
    );
  }
  const chosen = chooseVehicle(refs, vehicleTyped, driverTyped, decidedBy, now);
  const vehicle = chosen.vehicle;
  const driver = pickDriver(refs, driverTyped, request.driver_required, vehicle, settings.self_drive_allowed);

  // The day and the times: as asked, unless the approver moves them.
  if (args.date) realDate(args.date);
  const askedDay = colomboDate(request.leave_by ?? request.needed_at);
  const day = args.date ?? askedDay;
  const shiftMs = new Date(dayRange(day).from).getTime() - new Date(dayRange(askedDay).from).getTime();
  const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + shiftMs).toISOString() : null);
  const stops: ResolvedStop[] = rows.map(resolvedFromRow).map((st) => ({ ...st, arrive_by: shift(st.arrive_by) }));
  const start = startOfRequest(request);
  const stored = request.plan_json as unknown as StoredPlan | null;
  let plan: StoredPlan;
  if (!args.date && !args.leave_by && stored && request.leave_by) {
    plan = stored;
  } else {
    const leaveAt = args.leave_by ? utcIso(day, args.leave_by) : request.leave_by_source === "manual" ? shift(request.leave_by) : null;
    if (!leaveAt && !stops.some((st) => st.arrive_by)) {
      throw new ToolError("Give leave_by: the request has no arrive_by time to plan from.");
    }
    plan = await makePlan(db, settings, {
      now,
      start,
      stops,
      returnToBase: request.return_to_base,
      avoidExpressway: request.avoid_expressway,
      leaveAt,
      bufferMin: request.buffer_min,
    });
  }
  const leaveBy = plan.leave_by;
  const endBy = args.back_by ? utcIso(day, args.back_by) : shift(request.back_by);
  if (endBy && endBy <= leaveBy) throw new ToolError("back_by must be later than the leave time on the same day.");

  const { warnings, conflicts } = await assignCheck(db, { driver, vehicle, startAt: leaveBy, endBy, plannedEnd: plan.ends_at });
  warnings.push(...fitWarnings(vehicle, request), ...plan.warnings.map((w) => w.text));
  if (new Date(leaveBy) < now) warnings.push("The leave-by time is already in the past.");

  const task = request.kind === "task";
  const projects = request.projects_json as { rows?: Split["rows"]; shown?: Split["shown"]; label?: string | null } | null;
  const split: Split = task && projects?.rows
    ? { rows: projects.rows, shown: projects.shown ?? [], label: projects.label ?? request.label }
    : request.project_id
    ? {
      rows: [{ project_id: request.project_id, percent: 100 }],
      shown: [{ project: request.project_label ?? "project", percent: 100 }],
      label: request.project_label,
    }
    : { rows: [], shown: [], label: request.project_label };
  const requesterRow = request.requested_by_employee_id ? refs.emp.get(request.requested_by_employee_id) : undefined;
  const title = args.title ?? request.title ??
    (request.route_to ? `Trip · ${request.route_to}` : `Trip for ${request.requested_by_name}`);

  const saved = await saveTask(db, {
    title,
    label: request.label ?? split.label,
    driver,
    vehicle,
    startAt: leaveBy,
    endBy,
    passengers: request.pax,
    contactName: task ? request.contact_name : request.requested_by_name,
    contactPhone: task ? request.contact_phone : requesterRow?.phone ?? null,
    notes: task
      ? request.task_notes
      : [request.note, request.tools ? "Tools / equipment travel too." : null, isDriver(driver) ? null : "Driven by the custodian."]
        .filter(Boolean).join(" ") || null,
    stops,
    start,
    returnToBase: request.return_to_base,
    avoidExpressway: request.avoid_expressway,
    leaveBy,
    leaveBySource: plan.leave_by_source,
    bufferMin: request.buffer_min,
    plan,
    split,
    createdBy: task ? request.requested_by_name : decidedBy,
    request: { id: request.id, decidedBy },
    bookedBy: actor.employeeId,
    vehicleChoice: isDriver(driver) ? chosen.choice : null,
    savedWarnings: warnings,
    assignedBy: task ? request.requested_by_employee_id : actor.employeeId,
    vehicleWhy: chosen.why,
  }, warnings);
  unwrap(await db.from("vehicle_requests").update({ version: request.version + 1 }).eq("id", request.id).select("id"), "vehicle request");
  const changedNote = [
    task && proposed && driver.id !== proposed.id ? `driver ${driver.name} instead of ${proposed.name}` : null,
    task && proposedPlate && vehicle.reg_no !== proposedPlate ? `vehicle ${vehicle.reg_no} instead of ${proposedPlate}` : null,
    args.date || args.leave_by ? `leave ${colomboDayTime(leaveBy)}` : null,
  ].filter(Boolean).join(", ");
  await logRequestEvent(db, request.id, "approved", decidedBy, {
    note: `${vehicle.reg_no} · ${driver.name}${changedNote ? ` (${changedNote})` : task ? " (as proposed)" : ""}`,
  });
  await notifyEvent(db, "request.decided", {
    title: task ? `Task approved · sent to ${driver.name}` : `Request approved · ${vehicle.reg_no} · ${driver.name}`,
    body: [
      task ? title : null,
      colomboDayTime(leaveBy),
      [request.route_from, request.route_to].filter(Boolean).join(" → "),
      changedNote || null,
    ]
      .filter(Boolean).join(" · "),
    url: `/requests/${request.id}`,
    tag: `request:${request.id}`,
  }, told);
  return {
    result: {
      request: "approved",
      requested_by: request.requested_by_name,
      as_proposed: task ? !changedNote : undefined,
      ...saved.result,
      conflicts: conflicts.length ? conflicts : undefined,
    },
    summary: `approved ${task ? "proposed task" : "request"} ${request.id}${changedNote ? ` (${changedNote})` : ""} -> ${saved.summary}`,
  };
}

/**
 * The vehicle for an approval or a booking (Phase 7, §3): as typed, else the driver's vehicle today or their regular one;
 * when the office picks another than the driver's default, the choice is kept on the task.
 */
function chooseVehicle(refs: Refs, typedVehicle: string | undefined, typedDriver: string | undefined, by: string, now: Date) {
  if (typedVehicle) {
    const vehicle = activeVehicle(refs, typedVehicle);
    const driver = typedDriver ? refs.employees.find((e) => e.role === "driver" && e.active && sameDriver(e, typedDriver)) : undefined;
    if (driver) {
      const picked = pickVehicle(refs, driver, typedVehicle, by, now);
      return { vehicle, why: picked.why as string | undefined, choice: picked.choice };
    }
    return { vehicle, why: undefined as string | undefined, choice: null as VehicleChoice | null };
  }
  const driver = activeDriver(refs, typedDriver ?? "");
  const picked = pickVehicle(refs, driver, undefined, by, now);
  return { vehicle: picked.vehicle, why: picked.why as string | undefined, choice: null as VehicleChoice | null };
}

const sameDriver = (e: { username: string | null; code: string; name: string }, typed: string) => {
  const t = typed.trim().toLowerCase();
  return e.username === t || e.code.toLowerCase() === t || e.name.toLowerCase() === t;
};

export const bookVehicle = tool({
  name: "book_vehicle",
  title: "Book a vehicle in one step",
  description:
    "The office books a vehicle for someone: the request and its task are made together (one transaction; a refused task leaves no " +
    "request behind). driver is needed unless driver_required is false and the vehicle has a custodian, who then drives. Returns the " +
    "request, the task with its plan, and every warning (another booking, km allowance, garage, expired document, seats, type). " +
    "Audited as requested and approved by you.",
  readOnly: false,
  input: z.object({
    requested_by: zText(120).optional().describe("Who asks. Default: you"),
    on_behalf_of: zText(120).optional().describe("The person the vehicle is for, when it is not the asker"),
    ...requestFields,
    vehicle: zText(20).optional().describe("Plate. Default: the driver's vehicle today, else their regular one"),
    driver: zText(80).optional().describe("Username, code or name; not needed when the custodian drives"),
    title: zText(120).optional().describe("Task title. Default: built from the route"),
    stops: zStops.optional().describe("The task's stops; default: route_from → route_to"),
    start: zStart.optional(),
    return_to_base: z.boolean().optional(),
    avoid_expressway: z.boolean().optional(),
  }),
  async run(args, { db, now, actor }) {
    realDate(args.date);
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const who = await requester(db, actor, args.requested_by);

    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    if (!args.vehicle && !args.driver) throw new ToolError("Give a driver (the vehicle fills itself) or a vehicle.");
    const chosen = chooseVehicle(refs, args.vehicle, args.driver, actor.name, now);
    const vehicle = chosen.vehicle;
    const driverRequired = args.driver_required ?? true;
    const driver = pickDriver(refs, args.driver, driverRequired, vehicle, settings.self_drive_allowed);
    const prepared = await prepareTask(db, settings, now, {
      day: args.date,
      stops: args.stops ?? [
        { type: "pickup", place: args.route_from ?? "To be confirmed", dwell_min: args.from_dwell_min },
        { type: "drop", place: args.route_to ?? "To be confirmed", dwell_min: args.to_dwell_min },
      ],
      start: args.start,
      return_to_base: args.return_to_base,
      avoid_expressway: args.avoid_expressway,
      // Phase 7 (§34): the time as typed, else the plan's leave-by from the stops' arrive_by times.
      leaveAt: typedLeave(args.date, args.time, args.stops),
    });
    const neededAt = prepared.leaveBy;
    const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than the leave time on the same day.");
    const warnings = await assignWarnings(db, { driver, vehicle, startAt: neededAt, endBy: backBy });
    warnings.push(...fitWarnings(vehicle, args));
    warnings.push(...prepared.plan.warnings.map((w) => w.text));
    if (new Date(neededAt) < now) warnings.push("The time is already in the past.");

    const label = project ? project.short_name ?? project.name : args.project ?? null;
    const split: Split = project
      ? { rows: [{ project_id: project.id, percent: 100 }], shown: [{ project: label ?? "project", percent: 100 }], label }
      : { rows: [], shown: [], label };
    const create: BookingRequest = {
      requested_by_name: who.name,
      requested_by_employee_id: who.employeeId,
      requested_by_user_id: who.userId,
      project_id: project?.id ?? null,
      project_label: label,
      needed_at: neededAt,
      back_by: backBy,
      route_from: args.stops
        ? prepared.stops.find((x) => !x.is_start)?.place_name ?? prepared.stops[0].place_name
        : args.route_from ?? null,
      route_to: args.stops
        ? (prepared.stops.length > 1 ? prepared.stops[prepared.stops.length - 1].place_name : null)
        : args.route_to ?? null,
      need_type: args.need_type ?? null,
      pax: args.pax ?? null,
      tools: args.tools ?? false,
      note: args.note ?? null,
      driver_required: driverRequired,
      on_behalf_of: args.on_behalf_of ?? null,
      from_dwell_min: args.from_dwell_min ?? null,
      to_dwell_min: args.to_dwell_min ?? null,
    };
    const saved = await saveTask(db, {
      title: args.title ?? (args.route_to ? `Trip · ${args.route_to}` : `Trip for ${who.name}`),
      label,
      driver,
      vehicle,
      startAt: neededAt,
      endBy: backBy,
      passengers: args.pax ?? null,
      contactName: who.name,
      contactPhone: who.employeeId ? refs.emp.get(who.employeeId)?.phone ?? null : null,
      notes: [args.note, args.tools ? "Tools / equipment travel too." : null, isDriver(driver) ? null : "Driven by the custodian."]
        .filter(Boolean).join(" ") || null,
      stops: prepared.stops,
      start: prepared.start,
      returnToBase: args.return_to_base ?? false,
      avoidExpressway: args.avoid_expressway ?? false,
      leaveBy: prepared.leaveBy,
      leaveBySource: prepared.leaveBySource,
      bufferMin: null,
      plan: prepared.plan,
      split,
      createdBy: actor.name,
      vehicleChoice: chosen.choice,
      savedWarnings: warnings,
      assignedBy: actor.employeeId,
      vehicleWhy: chosen.why,
      request: { create, decidedBy: actor.name },
      bookedBy: actor.employeeId,
    }, warnings);
    // The request keeps the trip too (Phase 7, §34): its page shows the stops and the plan as the task has them.
    await saveRequestTrip(db, saved.result.request_id!, {
      start: prepared.start,
      stops: prepared.stops,
      plan: prepared.plan,
      returnToBase: args.return_to_base ?? false,
      avoidExpressway: args.avoid_expressway ?? false,
      leaveBy: prepared.leaveBy,
      leaveBySource: prepared.leaveBySource,
      bufferMin: null,
    }, now);
    const row = await getRequest(db, saved.result.request_id!);
    await logRequestEvent(db, row.id, "created", actor.name, { at: row.created_at, note: "booked in one step" });
    await logRequestEvent(db, row.id, "approved", actor.name, { note: `${vehicle.reg_no} · ${driver.name}` });
    return {
      result: { request: await requestCardOf(db, row, now), booked: "in one step", ...saved.result },
      summary: `booked ${vehicle.reg_no} for ${who.name} (requested and approved by ${actor.name}) -> ${saved.summary}`,
    };
  },
});

export const cancelRequest = tool({
  name: "cancel_request",
  title: "Cancel a request or booking",
  description: "Cancels a waiting request, or an approved one together with its task (the driver's app shows the task as cancelled; " +
    "the vehicle's custodian and the person who asked are told). The reason is required. Nothing is deleted. Without the approve " +
    "permission: only your own request or proposed task, while it waits.",
  readOnly: false,
  input: z.object({ request_id: zId, reason: zText(300) }),
  async run({ request_id, reason }, { db, now, actor }) {
    const request = await getRequest(db, request_id);
    if (request.status === "declined" || request.status === "cancelled") throw new ToolError(`This request is already ${request.status}.`);
    // Phase 7 (§35 17): the person who asked or proposed may withdraw it while it waits; the approvers decide the rest.
    if (!actor.permissions.includes("approve")) {
      const userId = await actorUserId(db, actor);
      const own = (actor.employeeId !== null && request.requested_by_employee_id === actor.employeeId) ||
        (userId !== null && request.requested_by_user_id === userId);
      if (!own) throw new ToolError("This request is not yours to cancel.");
      if (request.status !== "waiting") throw new ToolError("It is decided already: ask the fleet admin to cancel it.");
    }
    const nowIso = now.toISOString();

    let task: Task | null = null;
    let taskCancelled: string | undefined;
    if (request.task_id) {
      task = unwrapMaybe(await db.from("tasks").select("*").eq("id", request.task_id).maybeSingle(), "task");
      if (task?.status === "completed") throw new ToolError("The trip is already completed: nothing to cancel.");
      if (task && task.status !== "cancelled") {
        const changed = unwrap(
          await db.from("tasks").update({ status: "cancelled", cancelled_reason: `Request cancelled: ${reason}` })
            .eq("id", task.id).in("status", ["assigned", "in_progress", "declined"]).select("id"),
          "task",
        );
        if (changed.length > 0) {
          unwrap(
            await db.from("task_assignment_events").insert({
              task_id: task.id,
              action: "cancelled",
              employee_id: task.employee_id,
              vehicle_id: task.vehicle_id,
              actor: actor.name,
              note: `Request cancelled: ${reason}`,
            }),
            "assignment history",
          );
          taskCancelled = task.title;
        }
      }
    }

    const rows = unwrap(
      await db.from("vehicle_requests").update({
        status: "cancelled",
        cancelled_at: nowIso,
        cancelled_by: actor.name,
        cancel_reason: reason,
        changed_at: null,
        changed_by: null,
        change_note: null,
        version: request.version + 1,
        ...(request.decided_at ? {} : { decided_at: nowIso, decided_by: actor.name }),
      }).eq("id", request.id).in("status", ["waiting", "approved", "changed"]).select("*"),
      "vehicle request",
    );
    if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Check list_requests.");
    await logRequestEvent(db, request.id, "cancelled", actor.name, { note: reason, at: nowIso });

    if (task) {
      const vehicle = unwrapMaybe(
        await db.from("vehicles").select("reg_no, custodian_employee_id").eq("id", task.vehicle_id).maybeSingle(),
        "vehicle",
      );
      if (vehicle?.custodian_employee_id) {
        await notifyEvent(db, "vehicle.booking_cancelled", {
          title: `${vehicle.reg_no} booking cancelled`,
          body: `${reason} · ${colomboDayTime(task.start_at)}`,
          url: "/requests",
          tag: `request:${request.id}`,
        }, { actor: actor.employeeId, custodian: vehicle.custodian_employee_id });
      }
    }
    await notifyEvent(db, "request.decided", {
      title: "Request cancelled",
      body: reason,
      url: `/requests/${request.id}`,
      tag: `request:${request.id}`,
    }, {
      actor: actor.employeeId,
      requester: request.requested_by_employee_id,
    });

    return {
      result: { request: await requestCardOf(db, rows[0], now), was: request.status, task_cancelled: taskCancelled },
      summary: `cancelled request ${request.id} (was ${request.status}): ${reason}`,
    };
  },
});

// ---------------------------------------------------------------------------
// Phase 6: the requester edits, the approver decides again
// ---------------------------------------------------------------------------

/** The request's route as the task was given it (the stops' names). */
const routeOf = (r: Pick<VehicleRequest, "route_from" | "route_to">) => ({
  from: r.route_from ?? "To be confirmed",
  to: r.route_to ?? "To be confirmed",
});

/** The edit form's start of a stored trip, as an input (the start stop's own fields when passengers get in there). */
function startInput(r: VehicleRequest, rows: RequestStop[]) {
  if (!r.start_name) return undefined;
  const atStart = rows.find((x) => x.is_start);
  return {
    place: r.start_name,
    place_id: r.start_place_id ?? undefined,
    lat: r.start_lat ?? undefined,
    lng: r.start_lng ?? undefined,
    passengers: atStart ? true : undefined,
    what: (atStart?.what ?? undefined) as "people" | "goods" | "documents" | "other" | undefined,
    note: atStart?.note ?? undefined,
    dwell_min: atStart?.dwell_source === "chosen" ? atStart.dwell_min ?? undefined : undefined,
  };
}

/**
 * A request's trip planned again for an edit (Phase 7, §34): the stops as given (else the stored ones, moved with the day),
 * the leave time as typed, else from the arrive_by times.
 */
async function replanRequest(
  db: Db,
  now: Date,
  request: VehicleRequest,
  rows: RequestStop[],
  day: string,
  args: {
    time?: string | null;
    stops?: z.infer<typeof zStops>;
    start?: z.infer<typeof zStart>;
    return_to_base?: boolean;
    avoid_expressway?: boolean;
  },
) {
  const settings = await loadSettings(db);
  const keptTime = request.leave_by_source === "plan" ? null : colomboTime(request.needed_at);
  const time = args.time === null ? null : args.time ?? keptTime;
  const returnToBase = args.return_to_base ?? request.return_to_base;
  const avoidExpressway = args.avoid_expressway ?? request.avoid_expressway;
  if (args.stops) {
    const p = await prepareTask(db, settings, now, {
      day,
      stops: args.stops,
      start: args.start ?? startInput(request, rows),
      return_to_base: returnToBase,
      avoid_expressway: avoidExpressway,
      leaveAt: typedLeave(day, time ?? undefined, args.stops),
    });
    return {
      start: p.start,
      stops: p.stops,
      plan: p.plan,
      returnToBase,
      avoidExpressway,
      leaveBy: p.leaveBy,
      leaveBySource: p.leaveBySource,
      bufferMin: request.buffer_min,
    };
  }
  const askedDay = colomboDate(request.leave_by ?? request.needed_at);
  const shiftMs = new Date(dayRange(day).from).getTime() - new Date(dayRange(askedDay).from).getTime();
  const stops = rows.map(resolvedFromRow).map((st) => ({
    ...st,
    arrive_by: st.arrive_by ? new Date(new Date(st.arrive_by).getTime() + shiftMs).toISOString() : null,
  }));
  const leaveAt = time ? utcIso(day, time) : null;
  if (!leaveAt && !stops.some((st) => st.arrive_by)) {
    throw new ToolError("Give time (when the vehicle leaves), or an arrive_by time on a stop.");
  }
  const start = startOfRequest(request);
  const plan = await makePlan(db, settings, { now, start, stops, returnToBase, avoidExpressway, leaveAt, bufferMin: request.buffer_min });
  return {
    start,
    stops,
    plan,
    returnToBase,
    avoidExpressway,
    leaveBy: plan.leave_by,
    leaveBySource: plan.leave_by_source,
    bufferMin: request.buffer_min,
  };
}

export const updateRequest = tool({
  name: "update_request",
  title: "Change a request",
  description:
    "Changes what a request asks for: the day and time, back-by, route, kind of vehicle, passengers, tools, note, whether a driver " +
    'is needed, who it is for. A waiting request stays waiting; an approved booking becomes "changed" and needs re-approval ' +
    "(the approvers are told; the task keeps the old plan until redecide_request). The person who asked may change their own " +
    "request; an approver any. version must be the one list_requests showed. Returns the request and what changed.",
  readOnly: false,
  input: z.object({
    request_id: zId,
    version: z.number().int().min(0).describe("From list_requests"),
    date: zDate.optional(),
    time: zTime.nullable().optional().describe("The leave time, HH:MM; null = planned from the stops' arrive_by times (Phase 7)"),
    back_by: zTime.nullable().optional().describe("HH:MM the same day; null clears it"),
    route_from: zText(160).optional(),
    route_to: zText(160).optional(),
    ...tripInput,
    need_type: zVehicleType.nullable().optional(),
    pax: z.number().int().min(0).max(80).nullable().optional(),
    tools: z.boolean().optional(),
    note: z.string().trim().max(1000).nullable().optional().describe("The note; empty or null clears it"),
    driver_required: z.boolean().optional(),
    on_behalf_of: z.string().trim().max(120).nullable().optional(),
    from_dwell_min: z.number().int().min(0).max(1440).nullable().optional().describe("Minutes at From; null = the default"),
    to_dwell_min: z.number().int().min(0).max(1440).nullable().optional().describe("Minutes at To; null = the default"),
  }),
  async run(args, { db, now, actor }) {
    if (args.date) realDate(args.date);
    const request = await getRequest(db, args.request_id);
    if (!actor.permissions.includes("approve") && request.requested_by_employee_id !== actor.employeeId) {
      throw new ToolError("This request is not yours to change.");
    }
    checkVersion(request.version, args.version);
    const next = statusAfterEdit(request.status);

    const day = args.date ?? colomboDate(request.needed_at);
    // Phase 7 (§34): a request with its trip is planned again when its stops, start, day or time change.
    const tripRows = (await requestStopsOf(db, [request.id])).get(request.id) ?? [];
    const tripEdit = args.stops !== undefined ||
      (tripRows.length > 0 &&
        (args.date !== undefined || args.time !== undefined || args.return_to_base !== undefined || args.avoid_expressway !== undefined));
    if (args.start && !args.stops) throw new ToolError("Give the stops together with the start.");
    const trip = tripEdit ? await replanRequest(db, now, request, tripRows, day, args) : null;
    const neededAt = trip
      ? trip.leaveBy
      : args.date || args.time
      ? utcIso(day, args.time ?? colomboTime(request.needed_at))
      : request.needed_at;
    const backBy = args.back_by === null
      ? null
      : args.back_by
      ? utcIso(day, args.back_by)
      : request.back_by
      ? utcIso(day, colomboTime(request.back_by))
      : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
    const driverRequired = args.driver_required ?? request.driver_required;
    if (!driverRequired && !(await loadSettings(db)).self_drive_allowed) throw new ToolError(SELF_DRIVE_OFF);

    const before = snapshot(request);
    const tripFrom = trip ? trip.stops.find((x) => !x.is_start)?.place_name ?? trip.stops[0].place_name : undefined;
    const tripTo = trip && trip.stops.length > 1 ? trip.stops[trip.stops.length - 1].place_name : undefined;
    const after: RequestFields = {
      needed_at: neededAt,
      back_by: backBy,
      route_from: tripFrom ?? args.route_from ?? request.route_from,
      route_to: trip ? tripTo ?? null : args.route_to ?? request.route_to,
      need_type: args.need_type === undefined ? request.need_type : args.need_type,
      pax: args.pax === undefined ? request.pax : args.pax,
      tools: args.tools ?? request.tools,
      note: args.note === undefined ? request.note : (args.note || null),
      driver_required: driverRequired,
    };
    const changes = requestDiff(before, after);
    const onBehalfOf = args.on_behalf_of === undefined ? request.on_behalf_of : (args.on_behalf_of || null);
    if (onBehalfOf !== request.on_behalf_of) changes["for"] = { from: request.on_behalf_of, to: onBehalfOf };
    // Phase 7 (§17): the times at From and To.
    const fromDwell = args.from_dwell_min === undefined ? request.from_dwell_min : args.from_dwell_min;
    const toDwell = args.to_dwell_min === undefined ? request.to_dwell_min : args.to_dwell_min;
    const minText = (m: number | null) => (m == null ? null : `${m} min`);
    if (fromDwell !== request.from_dwell_min) changes["time at From"] = { from: minText(request.from_dwell_min), to: minText(fromDwell) };
    if (toDwell !== request.to_dwell_min) changes["time at To"] = { from: minText(request.to_dwell_min), to: minText(toDwell) };
    if (trip) {
      const moved = stopChanges(tripRows.map(stopForChange), trip.stops.map(stopForChange), 3);
      if (moved.list.length > 0) {
        changes["stops"] = {
          from: null,
          to: moved.list.map((c) => `Stop ${c.n} ${c.change}: ${c.place}`).join("; ") + (moved.more ? ` (+${moved.more} more)` : ""),
        };
      }
    }
    if (Object.keys(changes).length === 0) throw new ToolError("Nothing to change.");

    const nowIso = now.toISOString();
    const rows = unwrap(
      await db.from("vehicle_requests").update({
        ...after,
        on_behalf_of: onBehalfOf,
        from_dwell_min: fromDwell,
        to_dwell_min: toDwell,
        status: next.status,
        version: request.version + 1,
        previous: before as unknown as Json,
        ...(next.status === "changed" && { changed_at: nowIso, changed_by: actor.name, change_note: diffText(changes) }),
      }).eq("id", request.id).eq("version", request.version).select("*"),
      "vehicle request",
    );
    if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Reload it and try again.");
    if (trip) await saveRequestTrip(db, request.id, trip, now);
    await logRequestEvent(db, request.id, next.event, actor.name, { note: diffText(changes), changes, at: nowIso });

    if (next.needs_reapproval) {
      await notifyEvent(db, "request.changed", {
        title: `Request changed · needs re-approval · ${request.requested_by_name}`,
        body: `${diffText(changes)} · ${colomboDayTime(neededAt)}`,
        url: `/requests/${request.id}/decide`,
        tag: `request:${request.id}`,
      }, { actor: actor.employeeId });
    }
    return {
      result: {
        request: await requestCardOf(db, trip ? await getRequest(db, request.id) : rows[0], now),
        needs_reapproval: next.needs_reapproval,
        changes,
        next: next.needs_reapproval
          ? "The approvers were told; the booking keeps its old plan until they decide again (redecide_request)."
          : "Still waiting for approval, with the new details.",
      },
      summary: `request ${request.id} edited (${next.status}, version ${request.version + 1}): ${diffText(changes)}`,
    };
  },
});

export const redecideRequest = tool({
  name: "redecide_request",
  title: "Decide a changed request again",
  description:
    "For an approved booking (changed by the requester, or not): keep = approve it again as it now asks (the task takes the new " +
    "time, back-by, route and passengers and is planned again); change = the same with a new vehicle, driver, day, time or back-by " +
    "(only a new time = postponed); decline = with a reason: the request is declined and its task cancelled. The driver's app " +
    "shows the change, the person who asked and the vehicle's custodian are told. version must be the one list_requests showed.",
  readOnly: false,
  input: z.object({
    request_id: zId,
    version: z.number().int().min(0).describe("From list_requests"),
    decision: z.enum(["keep", "change", "decline"]),
    vehicle: zText(20).optional().describe("New plate (change)"),
    driver: zText(80).optional().describe("New driver: username, code or name (change)"),
    date: zDate.optional().describe("New day (change)"),
    time: zTime.optional().describe("New time, HH:MM (change)"),
    back_by: zTime.nullable().optional().describe("New back-by, HH:MM; null clears it (change)"),
    reason: zText(300).optional().describe("Why it is declined (decline)"),
  }),
  async run(args, { db, now, actor }) {
    if (args.date) realDate(args.date);
    const request = await getRequest(db, args.request_id);
    canRedecide(request.status);
    checkVersion(request.version, args.version);
    if (!request.task_id) throw new ToolError("This request has no task behind it; cancel it and make a new booking.");
    const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", request.task_id).maybeSingle(), "task");
    if (!task) throw new ToolError("The task behind this request no longer exists.");
    const nowIso = now.toISOString();
    const told = { actor: actor.employeeId, requester: request.requested_by_employee_id };

    if (args.decision === "decline") {
      if (!args.reason) throw new ToolError("A reason is needed to decline a request.");
      const rows = unwrap(
        await db.from("vehicle_requests").update({
          status: "declined",
          decided_at: nowIso,
          decided_by: actor.name,
          decline_reason: args.reason,
          changed_at: null,
          changed_by: null,
          change_note: null,
          version: request.version + 1,
        }).eq("id", request.id).eq("version", request.version).select("*"),
        "vehicle request",
      );
      if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Reload it and try again.");
      let taskCancelled: string | undefined;
      if (task.status === "assigned" || task.status === "in_progress" || task.status === "declined") {
        const changed = unwrap(
          await db.from("tasks").update({ status: "cancelled", cancelled_reason: `Request declined: ${args.reason}` })
            .eq("id", task.id).in("status", ["assigned", "in_progress", "declined"]).select("id"),
          "task",
        );
        if (changed.length > 0) {
          unwrap(
            await db.from("task_assignment_events").insert({
              task_id: task.id,
              action: "cancelled",
              employee_id: task.employee_id,
              vehicle_id: task.vehicle_id,
              actor: actor.name,
              note: `Request declined: ${args.reason}`,
            }),
            "assignment history",
          );
          taskCancelled = task.title;
        }
      }
      await logRequestEvent(db, request.id, "declined", actor.name, { note: args.reason, at: nowIso });
      await notifyEvent(db, "request.redecided", {
        title: "Your changed request was declined",
        body: args.reason,
        url: `/requests/${request.id}`,
        tag: `request:${request.id}`,
      }, told);
      const vehicle = unwrapMaybe(
        await db.from("vehicles").select("reg_no, custodian_employee_id").eq("id", task.vehicle_id).maybeSingle(),
        "vehicle",
      );
      if (vehicle?.custodian_employee_id) {
        await notifyEvent(db, "vehicle.booking_cancelled", {
          title: `${vehicle.reg_no} booking cancelled`,
          body: `Request declined: ${args.reason} · ${colomboDayTime(task.start_at)}`,
          url: `/requests/${request.id}`,
          tag: `request:${request.id}`,
        }, { actor: actor.employeeId, custodian: vehicle.custodian_employee_id });
      }
      return {
        result: { request: await requestCardOf(db, rows[0], now), decision: "declined", task_cancelled: taskCancelled },
        summary: `declined request ${request.id} again: ${args.reason}`,
      };
    }

    // keep or change: the task takes what the request now asks, plus the approver's own changes.
    if (task.status === "completed" || task.status === "cancelled") {
      throw new ToolError(`The task behind this request is ${task.status}; decline the request or make a new booking.`);
    }
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const change = args.decision === "change";
    const day = change && args.date ? args.date : colomboDate(request.needed_at);
    const neededAt = change && (args.date || args.time) ? utcIso(day, args.time ?? colomboTime(request.needed_at)) : request.needed_at;
    const backBy = change && args.back_by === null
      ? null
      : change && args.back_by
      ? utcIso(day, args.back_by)
      : request.back_by
      ? utcIso(day, colomboTime(request.back_by))
      : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
    // A new driver with no vehicle named takes the vehicle they hold today, else their regular one (Phase 7, §3).
    const vehicle = change && args.vehicle
      ? activeVehicle(refs, args.vehicle)
      : change && args.driver
      ? defaultVehicleFor(refs, activeDriver(refs, args.driver))?.vehicle ?? refs.veh.get(task.vehicle_id)
      : refs.veh.get(task.vehicle_id);
    if (!vehicle) throw new ToolError("The task's vehicle no longer exists.");
    const driver = change && args.driver
      ? activeDriver(refs, args.driver)
      : !request.driver_required && vehicle.id !== task.vehicle_id
      ? pickDriver(refs, undefined, false, vehicle, settings.self_drive_allowed)
      : refs.emp.get(task.employee_id);
    if (!driver) throw new ToolError("The task's driver no longer exists.");

    // Phase 7 (§34): a request with its trip changes the task's stops through update_task_stops (below), not its From and To.
    const tripRows = (await requestStopsOf(db, [request.id])).get(request.id) ?? [];
    const out = await changeTask(db, now, actor, task, {
      startAt: neededAt,
      endBy: backBy,
      driver,
      vehicle,
      passengers: request.pax,
      route: tripRows.length > 0 ? undefined : routeOf(request),
    }, {
      note: args.decision === "keep" ? "request decided again: kept" : "request decided again: changed",
      tellRequester: false,
      allowNoop: true,
    });
    const warnings = [...out.warnings, ...fitWarnings(vehicle, request)];

    // Phase 7 (§34): the trip edited since it was approved: the task takes its stops as update_task_stops does (the pending
    // ones replaced, planned again, the driver told what changed). A task under way keeps its stops.
    const decidedAt = request.decided_at;
    const tripEdited = tripRows.length > 0 && decidedAt !== null && tripRows.some((r) => r.created_at > decidedAt);
    if (tripEdited && out.task.status === "assigned") {
      const fields = tripFields(request, tripRows);
      const leave = request.leave_by_source === "manual" ? colomboTime(neededAt) : undefined;
      const res = await updateTaskStops.run({
        task_id: task.id,
        plan_version: out.plan_version,
        stops: fields.stops as z.infer<typeof zStops>,
        start: startInput(request, tripRows),
        return_to_base: request.return_to_base,
        avoid_expressway: request.avoid_expressway,
        leave_by: leave,
      }, { db, now, actor });
      const r = res.result as { warnings?: string[]; plan_version?: number };
      warnings.push(...(r.warnings ?? []));
      out.changes["stops"] = { from: null, to: "as the request now asks" };
      if (r.plan_version !== undefined) out.plan_version = r.plan_version;
    }

    const onlyTime = change && Object.keys(out.changes).every((k) => k === "time" || k === "end by") &&
      (out.changes.time || out.changes["end by"]);
    const action: EventAction = onlyTime ? "postponed" : "redecided";
    const rows = unwrap(
      await db.from("vehicle_requests").update({
        status: "approved",
        needed_at: neededAt,
        back_by: backBy,
        decided_at: nowIso,
        decided_by: actor.name,
        changed_at: null,
        changed_by: null,
        change_note: null,
        previous: null,
        version: request.version + 1,
      }).eq("id", request.id).eq("version", request.version).select("*"),
      "vehicle request",
    );
    if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Reload it and try again.");
    const text = changesText(out.changes);
    await logRequestEvent(db, request.id, action, actor.name, {
      note: args.decision === "keep" ? (text ? `kept as asked: ${text}` : "kept as asked") : text || "changed",
      changes: Object.keys(out.changes).length ? out.changes : null,
      at: nowIso,
    });
    await notifyEvent(db, "request.redecided", {
      title: args.decision === "keep"
        ? "Your changed request was kept"
        : onlyTime
        ? "Your booking was postponed"
        : "Your booking was changed",
      body: [text || "as asked", `${vehicle.reg_no} · ${driver.name} · ${colomboDayTime(neededAt)}`].join(" · "),
      url: `/requests/${request.id}`,
      tag: `request:${request.id}`,
    }, told);

    return {
      result: {
        request: await requestCardOf(db, rows[0], now),
        decision: action === "postponed" ? "postponed" : args.decision === "keep" ? "kept" : "changed",
        task: {
          task_id: task.id,
          when: colomboDayTime(out.task.start_at),
          until: out.task.end_by ? colomboTime(out.task.end_by) : undefined,
          driver: driver.name,
          vehicle: vehicle.reg_no,
          plan_version: out.plan_version,
          changes: out.changes,
        },
        warnings,
        sent: Object.keys(out.changes).length
          ? (out.driverChanged ? `${driver.name} gets it as a new task to accept.` : "The driver's app shows the change (Task changed).")
          : "Nothing changed for the driver.",
      },
      summary: `request ${request.id} decided again (${action}): ${text || "kept as it was"}` +
        (warnings.length ? ` (${warnings.length} warnings)` : ""),
    };
  },
});
