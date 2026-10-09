// Vehicle requests: staff ask for a vehicle, the office approves (which creates
// the task) or declines.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { assignWarnings, loadRefs, monthKm, openTasksOn, type Task, taskWindow } from "../fleet.ts";
import { ago, colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime, zVehicleType } from "../tool.ts";
import { matchProjects } from "./projects.ts";
import { activeDriver, activeVehicle, saveTask, type Split } from "./tasks.ts";

type VehicleRequest = Row<"vehicle_requests">;

const TYPE_NAME: Record<string, string> = { car: "Car", van: "Van", double_cab: "Double cab", lorry: "Lorry", other: "Other" };

/** "Van · 6 pax + tools" */
function needText(r: VehicleRequest): string {
  const parts = [r.need_type ? TYPE_NAME[r.need_type] ?? r.need_type : "Any vehicle"];
  if (r.pax != null) parts.push(`${r.pax} pax`);
  return parts.join(" · ") + (r.tools ? " + tools" : "");
}

function requestCard(r: VehicleRequest, now: Date) {
  const sameDay = r.back_by && colomboDate(r.back_by) === colomboDate(r.needed_at);
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
    decided: r.decided_at ? `${colomboDateTime(r.decided_at)}${r.decided_by ? ` by ${r.decided_by}` : ""}` : undefined,
    decline_reason: r.decline_reason,
    task_id: r.task_id,
  };
}

async function getRequest(db: Db, id: string): Promise<VehicleRequest> {
  const request = unwrapMaybe(await db.from("vehicle_requests").select("*").eq("id", id).maybeSingle(), "vehicle request");
  if (!request) throw new ToolError(`No vehicle request has the id ${id}. Use list_requests to find it.`);
  return request;
}

export const createRequest = tool({
  name: "create_request",
  title: "New vehicle request",
  description:
    "Records that someone needs a vehicle. It waits for approval; decide_request approves it (creating the task) or declines it.",
  readOnly: false,
  input: z.object({
    requested_by: zText(120).describe("Who needs the vehicle"),
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
  }),
  async run(args, { db, now }) {
    realDate(args.date);
    const neededAt = utcIso(args.date, args.time);
    const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");

    // A project that is known from Zoho is linked; anything else is kept as a label.
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const wantName = args.requested_by.toLowerCase();
    const employee = unwrap(await db.from("employees").select("id, name, code").eq("active", true).limit(1000), "employees")
      .find((e) => e.name.toLowerCase() === wantName || e.code.toLowerCase() === wantName);

    const created = unwrap(
      await db.from("vehicle_requests").insert({
        requested_by_name: args.requested_by,
        requested_by_employee_id: employee?.id ?? null,
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
      }).select("*").single(),
      "vehicle request",
    );
    return {
      result: {
        request: requestCard(created, now),
        project_linked: args.project
          ? (project ? `${project.job_no ?? ""} ${project.name}`.trim() : "no (kept as a label only)")
          : undefined,
        next: "suggest_vehicles shows which vehicles and drivers are free.",
      },
      summary: `request ${created.id} by ${args.requested_by} for ${colomboDateTime(neededAt)}`,
    };
  },
});

export const listRequests = tool({
  name: "list_requests",
  title: "List vehicle requests",
  description: "Vehicle requests. By default those waiting for approval, soonest first.",
  readOnly: true,
  input: z.object({ status: z.enum(["waiting", "approved", "declined", "all"]).optional().describe("Default: waiting") }),
  async run({ status = "waiting" }, { db, now }) {
    let query = db.from("vehicle_requests").select("*");
    if (status !== "all") query = query.eq("status", status);
    const rows = unwrap(await query.order("needed_at", { ascending: status === "waiting" }).limit(100), "vehicle requests");
    return {
      result: { status, count: rows.length, requests: rows.map((r) => requestCard(r, now)) },
      summary: `${rows.length} requests (${status})`,
    };
  },
});

export const suggestVehicles = tool({
  name: "suggest_vehicles",
  title: "Suggest vehicles for a request",
  description:
    'For one request: every vehicle marked "free all day", "over km allowance", "booked HH:MM–HH:MM" or "in garage", best first, ' +
    "and which drivers are free that day.",
  readOnly: true,
  input: z.object({ request_id: zId }),
  async run({ request_id }, { db, now }) {
    const request = await getRequest(db, request_id);
    const day = colomboDate(request.needed_at);
    const dayEnd = new Date(dayRange(day).to).getTime();
    const from = new Date(request.needed_at).getTime();
    const to = request.back_by ? new Date(request.back_by).getTime() : dayEnd;
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
        request.need_type && v.vehicle_type !== request.need_type
          ? `is a ${TYPE_NAME[v.vehicle_type]?.toLowerCase() ?? v.vehicle_type}, not a ${TYPE_NAME[request.need_type]?.toLowerCase()}`
          : null,
        request.pax != null && v.seats != null && v.seats < request.pax ? `only ${v.seats} seats` : null,
      ].filter(Boolean);
      const rank = (v.in_garage || clash ? 20 : over ? 10 : 0) + fits.length;
      return {
        rank,
        card: {
          reg_no: v.reg_no,
          make_model: v.make_model,
          type: v.vehicle_type,
          seats: v.seats,
          availability,
          pick: v.in_garage || clash ? "no" : over || fits.length > 0 ? "possible" : "good",
          but: fits.length > 0 ? fits.join(", ") : undefined,
          regular_driver: v.regular_driver_id ? refs.emp.get(v.regular_driver_id)?.name : undefined,
        },
      };
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
    }).sort((a, b) => Number(b.free) - Number(a.free)).map(({ free: _free, ...card }) => card);

    return {
      result: {
        request: requestCard(request, now),
        vehicles: ranked.map((r) => r.card),
        drivers,
        next: request.status === "waiting"
          ? "decide_request with decision=approve, a vehicle and a driver."
          : `This request is already ${request.status}.`,
      },
      summary: `suggestions for request ${request.id}`,
    };
  },
});

export const decideRequest = tool({
  name: "decide_request",
  title: "Approve or decline a request",
  description:
    "approve: needs a vehicle and a driver; creates the task and sends it to the driver, and returns the same warnings as create_task. " +
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
  async run(args, { db, now }) {
    const request = await getRequest(db, args.request_id);
    if (request.status !== "waiting") throw new ToolError(`This request is already ${request.status}.`);
    const decidedBy = args.decided_by ?? "office";

    if (args.decision === "decline") {
      if (!args.reason) throw new ToolError("A reason is needed to decline a request.");
      const changed = unwrap(
        await db.from("vehicle_requests")
          .update({ status: "declined", decided_at: now.toISOString(), decided_by: decidedBy, decline_reason: args.reason })
          .eq("id", request.id).eq("status", "waiting").select("*"),
        "vehicle request",
      );
      if (changed.length === 0) throw new ToolError("Someone else decided this request just now. Check list_requests.");
      return { result: { request: requestCard(changed[0], now) }, summary: `declined request ${request.id}: ${args.reason}` };
    }

    if (!args.vehicle || !args.driver) {
      throw new ToolError("To approve, give both a vehicle and a driver. suggest_vehicles shows who is free.");
    }
    const refs = await loadRefs(db);
    const driver = activeDriver(refs, args.driver);
    const vehicle = activeVehicle(refs, args.vehicle);
    const warnings = await assignWarnings(db, { driver, vehicle, startAt: request.needed_at, endBy: request.back_by });

    const split: Split = request.project_id
      ? {
        rows: [{ project_id: request.project_id, percent: 100 }],
        shown: [{ project: request.project_label ?? "project", percent: 100 }],
        label: request.project_label,
      }
      : { rows: [], shown: [], label: request.project_label };
    const requester = request.requested_by_employee_id ? refs.emp.get(request.requested_by_employee_id) : undefined;

    const saved = await saveTask(db, {
      title: args.title ?? (request.route_to ? `Trip · ${request.route_to}` : `Trip for ${request.requested_by_name}`),
      label: request.project_label,
      driver,
      vehicle,
      startAt: request.needed_at,
      endBy: request.back_by,
      passengers: request.pax,
      contactName: request.requested_by_name,
      contactPhone: requester?.phone ?? null,
      notes: [request.note, request.tools ? "Tools / equipment travel too." : null].filter(Boolean).join(" ") || null,
      pickup: request.route_from ?? "To be confirmed",
      dropoff: request.route_to ?? "To be confirmed",
      split,
      createdBy: decidedBy,
      request: { id: request.id, decidedBy },
    }, warnings);

    return {
      result: { request: "approved", requested_by: request.requested_by_name, ...saved.result },
      summary: `approved request ${request.id} -> ${saved.summary}`,
    };
  },
});
