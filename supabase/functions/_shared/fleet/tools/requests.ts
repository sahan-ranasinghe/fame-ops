// Vehicle requests: staff ask for a vehicle, the office approves (which creates
// the task), declines, books one directly in one step (book_vehicle: request and
// task in one transaction), or cancels a booking (cancel_request). A vehicle with
// a custodian (an office person who keeps it) is "ask first"; when driver_required
// is false the custodian drives it: the task is theirs, with no app behind it.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import {
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
import { loadSettings } from "../settings.ts";
import { activeDriver, activeVehicle, type BookingRequest, prepareTask, saveTask, type Split, zStart, zStops } from "./tasks.ts";

type VehicleRequest = Row<"vehicle_requests">;

const TYPE_NAME: Record<string, string> = { car: "Car", van: "Van", double_cab: "Double cab", lorry: "Lorry", other: "Other" };

/** "Van · 6 pax + tools" */
function needText(r: Pick<VehicleRequest, "need_type" | "pax" | "tools">): string {
  const parts = [r.need_type ? TYPE_NAME[r.need_type] ?? r.need_type : "Any vehicle"];
  if (r.pax != null) parts.push(`${r.pax} pax`);
  return parts.join(" · ") + (r.tools ? " + tools" : "");
}

const by = (at: string | null, who: string | null) => at ? `${colomboDateTime(at)}${who ? ` by ${who}` : ""}` : undefined;

function requestCard(r: VehicleRequest, now: Date) {
  const sameDay = r.back_by && colomboDate(r.back_by) === colomboDate(r.needed_at);
  // Decided = approved or declined (a cancelled booking was approved first; a cancelled waiting request was never decided).
  const decided = r.status === "approved" || r.status === "declined" || (r.status === "cancelled" && r.task_id);
  return {
    id: r.id,
    requested_by: r.requested_by_name,
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
    timeline: {
      sent: colomboDateTime(r.created_at),
      seen: by(r.seen_at, r.seen_by),
      decided: decided ? by(r.decided_at, null) : undefined,
      decided_by: decided ? r.decided_by ?? undefined : undefined,
      cancelled: by(r.cancelled_at, r.cancelled_by),
    },
  };
}

async function getRequest(db: Db, id: string): Promise<VehicleRequest> {
  const request = unwrapMaybe(await db.from("vehicle_requests").select("*").eq("id", id).maybeSingle(), "vehicle request");
  if (!request) throw new ToolError(`No vehicle request has the id ${id}. Use list_requests to find it.`);
  return request;
}

/** The Auth account behind the actor: a web session, or the person behind a personal key. */
async function actorUserId(db: Db, actor: Actor): Promise<string | null> {
  if (actor.authUserId) return actor.authUserId;
  if (!actor.employeeId) return null;
  const row = unwrapMaybe(await db.from("employees").select("auth_user_id").eq("id", actor.employeeId).maybeSingle(), "employee");
  return row?.auth_user_id ?? null;
}

/** Who the request is for: a staff member always in their own name; the office may name anyone (linked when the name matches). */
async function requester(
  db: Db,
  actor: Actor,
  typed: string | undefined,
): Promise<{ name: string; employeeId: string | null; userId: string | null }> {
  const userId = await actorUserId(db, actor);
  const staff = !hasAny(actor.permissions, ["approve", "assign_tasks"]);
  if (staff || !typed) return { name: actor.name, employeeId: actor.employeeId, userId };
  const want = typed.toLowerCase();
  const employee = unwrap(await db.from("employees").select("id, name, code").eq("active", true).limit(1000), "employees")
    .find((e) => e.name.toLowerCase() === want || e.code.toLowerCase() === want);
  return { name: typed, employeeId: employee?.id ?? null, userId };
}

/** The first time someone who approves opens a waiting request, it counts as seen (the requester's timeline). */
async function markSeen(db: Db, request: VehicleRequest, actor: Actor, now: Date): Promise<VehicleRequest> {
  if (request.seen_at || request.status !== "waiting" || !actor.permissions.includes("approve")) return request;
  const rows = unwrap(
    await db.from("vehicle_requests").update({ seen_at: now.toISOString(), seen_by: actor.name }).eq("id", request.id).is("seen_at", null)
      .select("*"),
    "vehicle request",
  );
  return rows[0] ?? request;
}

/** The driver of a booking: the one named, or the vehicle's custodian when no driver is needed. */
function pickDriver(refs: Refs, typed: string | undefined, driverRequired: boolean, vehicle: Vehicle): Employee {
  if (typed) return activeDriver(refs, typed);
  if (!driverRequired) {
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
  time: zTime.describe("Time it is needed, HH:MM"),
  back_by: zTime.optional().describe("Time it will be back the same day, HH:MM"),
  route_from: zText(160).optional(),
  route_to: zText(160).optional(),
  need_type: zVehicleType.optional().describe("Kind of vehicle needed"),
  pax: z.number().int().min(0).max(80).optional().describe("Number of passengers"),
  tools: z.boolean().optional().describe("true if tools or equipment travel too"),
  note: zText(1000).optional(),
  driver_required: z.boolean().optional().describe("false when no driver is needed: the vehicle's custodian drives. Default true"),
};

export const createRequest = tool({
  name: "create_request",
  title: "New vehicle request",
  description:
    "Records that someone needs a vehicle. It waits for approval; decide_request approves it (creating the task) or declines it. " +
    "Someone who can neither approve nor assign asks in their own name.",
  readOnly: false,
  input: z.object({
    requested_by: zText(120).describe("Who needs the vehicle"),
    ...requestFields,
  }),
  async run(args, { db, now, actor }) {
    realDate(args.date);
    const neededAt = utcIso(args.date, args.time);
    const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");

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
        route_from: args.route_from ?? null,
        route_to: args.route_to ?? null,
        need_type: args.need_type ?? null,
        pax: args.pax ?? null,
        tools: args.tools ?? false,
        note: args.note ?? null,
        driver_required: args.driver_required ?? true,
      }).select("*").single(),
      "vehicle request",
    );
    await notifyEvent(db, "request.created", {
      title: `Vehicle request · ${created.requested_by_name}`,
      body: [
        colomboDayTime(neededAt),
        args.need_type ? TYPE_NAME[args.need_type] : "any vehicle",
        [args.route_from, args.route_to].filter(Boolean).join(" → "),
      ]
        .filter(Boolean).join(" · "),
      url: "/requests",
      tag: `request:${created.id}`,
    }, { actor: actor.employeeId });
    return {
      result: {
        request: requestCard(created, now),
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
  description: "Vehicle requests. By default those waiting for approval, soonest first. Everyone's with the approve permission; " +
    "otherwise the person's own. Each carries its timeline (sent, seen, decided, cancelled).",
  readOnly: true,
  input: z.object({ status: z.enum(["waiting", "approved", "declined", "cancelled", "all"]).optional().describe("Default: waiting") }),
  async run({ status = "waiting" }, { db, now, actor }) {
    let query = db.from("vehicle_requests").select("*");
    if (status !== "all") query = query.eq("status", status);
    // The queue (everyone's requests) is the approver's; everyone else sees their own.
    if (!actor.permissions.includes("approve")) {
      query = query.eq("requested_by_employee_id", actor.employeeId ?? "00000000-0000-0000-0000-000000000000");
    }
    const rows = unwrap(await query.order("needed_at", { ascending: status === "waiting" }).limit(100), "vehicle requests");
    return {
      result: { status, count: rows.length, requests: rows.map((r) => requestCard(r, now)) },
      summary: `${rows.length} requests (${status})`,
    };
  },
});

interface Window {
  neededAt: string;
  backBy: string | null;
  need_type: string | null;
  pax: number | null;
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
    const day = colomboDate(w.neededAt);
    const dayEnd = new Date(dayRange(day).to).getTime();
    const from = new Date(w.neededAt).getTime();
    const to = w.backBy ? new Date(w.backBy).getTime() : dayEnd;
    const busy = (t: Task) => new Date(t.start_at).getTime() < to && from < (t.end_by ? new Date(t.end_by).getTime() : dayEnd);

    const refs = await loadRefs(db);
    const vehicles = refs.vehicles.filter((v) => v.active);
    const [tasks, km] = await Promise.all([openTasksOn(db, day), monthKm(db, vehicles.map((v) => v.id), day.slice(0, 7))]);

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
      result: {
        request: request ? requestCard(request, now) : undefined,
        window: {
          when: colomboDayTime(w.neededAt),
          back_by: w.backBy ? colomboTime(w.backBy) : undefined,
          need: needText({ need_type: w.need_type, pax: w.pax, tools: false }),
        },
        vehicles: ranked.map((r) => r.card),
        drivers: drivers.map(({ free: _free, ...card }) => card),
        groups,
        drivers_free: drivers.filter((d) => d.free).map((d) => ({ name: d.name, username: d.username })),
        next: request
          ? ranked.some((r) => r.card.pick === "good")
            ? "decide_request with decision=approve, a vehicle and a driver (none needed when the custodian drives)."
            : "Nothing is clearly free: pick the best possible one, or decline with a reason."
          : ranked.some((r) => r.card.pick === "good")
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
    "approve: needs a vehicle and a driver (no driver when the request says driver_required false and the vehicle has a custodian: the " +
    "custodian drives); creates the task and sends it to the driver, and returns the same warnings as create_task. " +
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
          .update({ status: "declined", decided_at: now.toISOString(), decided_by: decidedBy, decline_reason: args.reason })
          .eq("id", request.id).eq("status", "waiting").select("*"),
        "vehicle request",
      );
      if (changed.length === 0) throw new ToolError("Someone else decided this request just now. Check list_requests.");
      await notifyEvent(db, "request.decided", {
        title: "Request declined",
        body: args.reason,
        url: "/requests",
        tag: `request:${request.id}`,
      }, told);
      return { result: { request: requestCard(changed[0], now) }, summary: `declined request ${request.id}: ${args.reason}` };
    }

    if (!args.vehicle) {
      throw new ToolError("To approve, give a vehicle (and a driver, unless the custodian drives). suggest_vehicles shows who is free.");
    }
    const refs = await loadRefs(db);
    const vehicle = activeVehicle(refs, args.vehicle);
    const driver = pickDriver(refs, args.driver, request.driver_required, vehicle);
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
    const settings = await loadSettings(db);
    const prepared = await prepareTask(db, settings, now, {
      day: colomboDate(request.needed_at),
      pickup: request.route_from ?? "To be confirmed",
      dropoff: request.route_to ?? "To be confirmed",
      leaveAt: request.needed_at,
    });
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
    }, warnings);
    await notifyEvent(db, "request.decided", {
      title: `Request approved · ${vehicle.reg_no} · ${driver.name}`,
      body: [colomboDayTime(request.needed_at), [request.route_from, request.route_to].filter(Boolean).join(" → ")].filter(Boolean).join(
        " · ",
      ),
      url: "/requests",
      tag: `request:${request.id}`,
    }, told);

    return {
      result: { request: "approved", requested_by: request.requested_by_name, ...saved.result },
      summary: `approved request ${request.id} -> ${saved.summary}`,
    };
  },
});

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
    requested_by: zText(120).optional().describe("Who it is for. Default: you"),
    ...requestFields,
    vehicle: zText(20).describe("Plate"),
    driver: zText(80).optional().describe("Username, code or name; not needed when the custodian drives"),
    title: zText(120).optional().describe("Task title. Default: built from the route"),
    stops: zStops.optional().describe("The task's stops; default: route_from → route_to"),
    start: zStart.optional(),
    return_to_base: z.boolean().optional(),
    avoid_expressway: z.boolean().optional(),
  }),
  async run(args, { db, now, actor }) {
    realDate(args.date);
    const neededAt = utcIso(args.date, args.time);
    const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const who = await requester(db, actor, args.requested_by);

    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const vehicle = activeVehicle(refs, args.vehicle);
    const driverRequired = args.driver_required ?? true;
    const driver = pickDriver(refs, args.driver, driverRequired, vehicle);
    const warnings = await assignWarnings(db, { driver, vehicle, startAt: neededAt, endBy: backBy });
    warnings.push(...fitWarnings(vehicle, args));
    const prepared = await prepareTask(db, settings, now, {
      day: args.date,
      stops: args.stops,
      pickup: args.route_from ?? "To be confirmed",
      dropoff: args.route_to ?? "To be confirmed",
      start: args.start,
      return_to_base: args.return_to_base,
      avoid_expressway: args.avoid_expressway,
      leaveAt: neededAt,
    });
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
      route_from: args.route_from ?? null,
      route_to: args.route_to ?? null,
      need_type: args.need_type ?? null,
      pax: args.pax ?? null,
      tools: args.tools ?? false,
      note: args.note ?? null,
      driver_required: driverRequired,
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
      request: { create, decidedBy: actor.name },
      bookedBy: actor.employeeId,
    }, warnings);
    const row = await getRequest(db, saved.result.request_id!);
    return {
      result: { request: requestCard(row, now), booked: "in one step", ...saved.result },
      summary: `booked ${vehicle.reg_no} for ${who.name} (requested and approved by ${actor.name}) -> ${saved.summary}`,
    };
  },
});

export const cancelRequest = tool({
  name: "cancel_request",
  title: "Cancel a request or booking",
  description: "Cancels a waiting request, or an approved one together with its task (the driver's app shows the task as cancelled; " +
    "the vehicle's custodian and the person who asked are told). The reason is required. Nothing is deleted.",
  readOnly: false,
  input: z.object({ request_id: zId, reason: zText(300) }),
  async run({ request_id, reason }, { db, now, actor }) {
    const request = await getRequest(db, request_id);
    if (request.status === "declined" || request.status === "cancelled") throw new ToolError(`This request is already ${request.status}.`);
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
        ...(request.decided_at ? {} : { decided_at: nowIso, decided_by: actor.name }),
      }).eq("id", request.id).in("status", ["waiting", "approved"]).select("*"),
      "vehicle request",
    );
    if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Check list_requests.");

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
    await notifyEvent(db, "request.decided", { title: "Request cancelled", body: reason, url: "/requests", tag: `request:${request.id}` }, {
      actor: actor.employeeId,
      requester: request.requested_by_employee_id,
    });

    return {
      result: { request: requestCard(rows[0], now), was: request.status, task_cancelled: taskCancelled },
      summary: `cancelled request ${request.id} (was ${request.status}): ${reason}`,
    };
  },
});
