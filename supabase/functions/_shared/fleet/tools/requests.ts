// Vehicle requests: staff ask for a vehicle, the office approves (which creates
// the task), declines, books one directly in one step (book_vehicle: request and
// task in one transaction), or cancels a booking (cancel_request). A vehicle with
// a custodian (an office person who keeps it) is "ask first"; when driver_required
// is false the custodian drives it: the task is theirs, with no app behind it.
// Phase 6: the requester edits a request (update_request; an approved one becomes
// "changed" and needs re-approval), the approver decides it again
// (redecide_request: keep, change, decline), every step is a request_events row
// (the timeline), and a request can be made on behalf of someone else.

import { holdersOf } from "../holders.ts";
import { passengerCards, passengerColumn } from "./passengers.ts";
import { noAppAction } from "./checks.ts";
import { z } from "zod";
import { busyPieces, busyText, freeText, taskEndMs, tripDayWords, tripWindow, windowWords } from "../availability.ts";
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
import { contactLinks, phoneLinks, plain } from "../format.ts";
import { unavailableText } from "../presence.ts";
import { driverPhotoLinks, profilePaths, vehiclePhotoLinks } from "../media.ts";
import { momentOf, tellLink, tellMessage } from "../requesterUpdates.ts";
import { notifyEvent } from "../notifications.ts";
import { hasAny } from "../permissions.ts";
import type { Actor } from "../roles.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, daysBetween, utcIso } from "../time.ts";
import { duration, whenText } from "../durations.ts";
import { realDate, tool, zDate, zId, zPaging, zSearch, zText, zTime, zVehicleType } from "../tool.ts";
import { pageInfo, pageOf, pageWindow } from "../paging.ts";
import { DECLINE_TEXT } from "../decline.ts";
import { matchProjects } from "./projects.ts";
import { stopChanges, stopForChange } from "../stopChanges.ts";
import { actorUserId, logRequestEvent, requester } from "./requestCore.ts";
import { changeCardOf, type ProposedChange, taskMovedSince } from "./changes.ts";
import { taskTarget, writePassengerColumn } from "./passengers.ts";
import {
  type RequestStop,
  requestStopsOf,
  type RequestTrip,
  resolvedFromRow,
  saveRequestTrip,
  startOfRequest,
  type StopRowLike,
} from "./requestTrip.ts";
import { loadSettings } from "../settings.ts";
import { type Asked, askedOf, checkAsked, decideWhoDrives, noAppNote, shownDriver, whoDrivesInput } from "../whoDrives.ts";
import { type LicenceFields, licenceState, noLicenceWarning } from "../licence.ts";
import {
  alreadyDecidedText,
  atText,
  canRedecide,
  checkVersion,
  diffText,
  FIELD_LABEL,
  requestDiff,
  type RequestFields,
  snapshot,
  statusAfterEdit,
} from "../requests_rules.ts";
import {
  activeDriver,
  activeVehicle,
  type BookingRequest,
  changesText,
  changeTask,
  defaultVehicleFor,
  makePlan,
  ON_THE_DAY_OFF,
  parseVehicleWord,
  pickVehicle,
  planTimeline,
  prepareTask,
  reassignTask,
  type ResolvedStop,
  saveTask,
  type Split,
  stopCard,
  type StoredPlan,
  updateTask,
  updateTaskStops,
  type VehicleChoice,
  type VehicleMode,
  vehicleText,
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

/** The names a proposed task's card shows (Phase 7, §33), and the trip behind an approved one (§4). */
interface CardRefs {
  people: Map<string, { name: string; username: string | null }>;
  plates: Map<string, string>;
  trips?: Map<string, TripOutcome>;
  /** Hotfix 2 (K): who decided, with their number and photo; the approvers who have it open now. */
  /** Who decided and who asked: their name, phone, photo and (Round 3, A5) their licence fields. */
  deciders?: Map<string, { name: string; phone: string | null; photo?: string; licence?: Partial<LicenceFields> }>;
  reviewing?: Map<string, { name: string; since: string }[]>;
  /** Hotfix 2 (F): the office's number (Call office). */
  officePhone?: string | null;
}

/** How long an approver's "reviewing" lasts after their decide page last said so (it says so every 20 s). */
const REVIEWING_FOR_MS = 45_000;

/** "Approved by Palitha · 10:42": the person (photo, Call, WhatsApp when they have a number) and when. */
function personAt(name: string, at: string, now: Date, p?: { phone: string | null; photo?: string }) {
  return { name, at: atText(at, now), photo_url: p?.photo, ...phoneLinks(p?.phone) };
}

/**
 * The trip's live state for the person who asked (Hotfix 2, A): the request's decision, then its task (accepted, on the
 * way, arrived at the first pickup, completed, cancelled).
 */
function liveOf(r: VehicleRequest, trip: TripOutcome | undefined, now: Date) {
  const at = (iso: string | null | undefined) => (iso ? atText(iso, now) : undefined);
  const dot = (text: string, iso: string | null | undefined) => (iso ? `${text} · ${atText(iso, now)}` : text);
  switch (r.status) {
    case "waiting":
      return { state: "waiting" as const, text: new Date(r.needed_at) <= now ? "Waiting · its leave time has passed" : "Waiting" };
    case "changed":
      return { state: "waiting" as const, text: "Changed · waiting for the office", at: at(r.changed_at) };
    case "declined":
      return { state: "declined" as const, text: r.decline_reason ? `Declined · ${r.decline_reason}` : "Declined", at: at(r.decided_at) };
    case "cancelled":
      return {
        state: "cancelled" as const,
        text: r.cancel_reason ? `Cancelled · ${r.cancel_reason}` : "Cancelled",
        at: at(r.cancelled_at),
      };
    // Round 3 (A6): still waiting when its day was over; "Request again" copies it.
    case "expired":
      return { state: "expired" as const, text: "Expired · nobody decided it in time", at: at(r.expired_at) };
  }
  const t = trip?.task;
  if (!t) return { state: "approved" as const, text: "Approved", at: at(r.decided_at) };
  switch (t.status) {
    case "completed":
      return { state: "completed" as const, text: dot("Completed", t.completed_at), at: at(t.completed_at) };
    case "cancelled":
      return {
        state: "cancelled" as const,
        text: t.cancelled_reason ? `Cancelled · ${t.cancelled_reason}` : "Cancelled",
        at: at(t.updated_at),
      };
    case "in_progress": {
      const pickup = trip.stops.find((s) => s.type === "pickup");
      const arrivedAt = pickup?.arrived_at ?? pickup?.auto_detected_at;
      return arrivedAt
        ? { state: "arrived" as const, text: dot("Arrived", arrivedAt), at: at(arrivedAt) }
        : { state: "on_the_way" as const, text: dot("On the way", t.started_at), at: at(t.started_at) };
    }
    case "declined":
      return { state: "approved" as const, text: "Approved · finding another driver", at: at(r.decided_at) };
    case "missed":
      return { state: "missed" as const, text: dot("Missed", t.missed_at), at: at(t.missed_at) };
    default:
      return t.accepted_at
        ? { state: "accepted" as const, text: dot("Driver accepted", t.accepted_at), at: at(t.accepted_at) }
        : { state: "approved" as const, text: "Approved", at: at(r.decided_at) };
  }
}

/** What the person who asked sees once it is approved (Phase 7, §4, §35 19): the driver, the vehicle, their photos. */
interface TripOutcome {
  /** Round 3: driver | self | other. */
  drivenBy: string;
  status: string;
  driver: string;
  phone: string | null;
  driverPhoto?: string;
  plate: string;
  model: string | null;
  vehiclePhoto?: string;
  vehicleThumb?: string;
  started: string | null;
  firstPickup?: string;
  arrived: boolean;
  reassigned: boolean;
  /** The task as it is now: the single source of the trip once the request is approved (§4). */
  task: Task;
  stops: TaskStopRow[];
}

type TaskStopRow = Row<"task_stops">;

/** The approved push's pictures (Phase 7, §4): the driver's photo as its icon, the vehicle's as its image. */
async function pushPhotos(db: Db, driver: Employee, vehicle: Vehicle | null) {
  const driverPath = (await profilePaths(db, [driver])).get(driver.id);
  return {
    ...(driverPath ? { icon_path: { bucket: "driver-photos" as const, path: driverPath } } : {}),
    ...(vehicle?.photo_thumb_path ? { image_path: { bucket: "vehicle-photos" as const, path: vehicle.photo_thumb_path } } : {}),
  };
}

/** The trips behind these requests' tasks, with the photos (one query each). */
async function tripOutcomes(db: Db, rows: VehicleRequest[], now: Date): Promise<Map<string, TripOutcome>> {
  const out = new Map<string, TripOutcome>();
  const taskIds = rows.flatMap((r) => r.task_id ? [r.task_id] : []);
  if (taskIds.length === 0) return out;
  const tasks = unwrap(await db.from("tasks").select("*").in("id", taskIds), "tasks");
  const [taskStops, events, emps, vehs] = await Promise.all([
    db.from("task_stops").select("*").in("task_id", taskIds).neq("status", "removed").order("seq").limit(5000),
    db.from("task_assignment_events").select("task_id").in("task_id", taskIds).eq("action", "reassigned"),
    db.from("employees").select("id, name, phone, photo_id").in("id", [...new Set(tasks.map((t) => t.employee_id))]),
    db.from("vehicles").select("id, reg_no, make_model, photo_path, photo_thumb_path").in("id", [
      ...new Set(tasks.flatMap((t) => t.vehicle_id ? [t.vehicle_id] : [])),
    ]),
  ]);
  const people = unwrap(emps, "employees");
  const vehicles = unwrap(vehs, "vehicles");
  const [driverPhotos, vehiclePhotos] = await Promise.all([driverPhotoLinks(db, people, now), vehiclePhotoLinks(db, vehicles, now)]);
  const allStops = unwrap(taskStops, "stops");
  const firsts = new Map<string, { place_name: string; arrived: boolean }>();
  for (const p of allStops.filter((x) => x.type === "pickup")) {
    if (!firsts.has(p.task_id)) firsts.set(p.task_id, { place_name: p.place_name, arrived: !!(p.arrived_at || p.auto_detected_at) });
  }
  const reassigned = new Set(unwrap(events, "assignment history").map((e) => e.task_id));
  for (const t of tasks) {
    const e = people.find((x) => x.id === t.employee_id);
    const v = vehicles.find((x) => x.id === t.vehicle_id);
    // Round 3: someone not in Fame Fleet drives: their name and phone (the account behind the task is never shown).
    const other = t.driven_by === "other";
    out.set(t.id, {
      status: t.status,
      drivenBy: t.driven_by,
      driver: other ? t.driver_name ?? "" : e?.name ?? "",
      phone: other ? t.driver_phone : e?.phone ?? null,
      driverPhoto: other ? undefined : driverPhotos.get(t.employee_id),
      plate: v?.reg_no ?? "",
      model: v?.make_model ?? null,
      vehiclePhoto: t.vehicle_id ? vehiclePhotos.get(t.vehicle_id)?.photo : undefined,
      vehicleThumb: t.vehicle_id ? vehiclePhotos.get(t.vehicle_id)?.thumb : undefined,
      started: t.started_at,
      firstPickup: firsts.get(t.id)?.place_name,
      arrived: firsts.get(t.id)?.arrived ?? false,
      reassigned: reassigned.has(t.id),
      task: t,
      stops: allStops.filter((x) => x.task_id === t.id),
    });
  }
  return out;
}

/** The trip behind an approved request, and the "Tell requester" message for someone without an office account. */
function outcomeOf(r: VehicleRequest, trip: TripOutcome | undefined) {
  const moment = momentOf({ requestStatus: r.status, taskStatus: trip?.status, arrived: trip?.arrived, reassigned: trip?.reassigned });
  const shown = trip && (r.status === "approved" || r.status === "changed");
  const message = moment && (moment === "cancelled" || trip)
    ? tellMessage({
      moment,
      when: colomboDayTime(trip ? trip.task.leave_by ?? trip.task.start_at : r.needed_at),
      driver: trip?.driver,
      driverPhone: trip?.phone,
      drivenBy: trip?.drivenBy,
      plate: trip?.plate,
      model: trip?.model,
      place: trip?.firstPickup,
      left: trip?.started ? colomboTime(trip.started) : undefined,
      reason: r.cancel_reason,
    })
    : null;
  return {
    assigned: shown
      ? {
        driver: trip.driver,
        driven_by: trip.drivenBy !== "driver" ? trip.drivenBy : undefined,
        phone: trip.phone ?? undefined,
        ...contactLinks(trip.phone),
        photo_url: trip.driverPhoto,
        vehicle: trip.plate,
        // Hotfix 2 (J): no vehicle yet: "Vehicle: on the day", "Any van".
        vehicle_text: trip.plate ? undefined : vehicleText(trip.task.vehicle_mode, trip.task.vehicle_type_wanted),
        make_model: trip.model ?? undefined,
        vehicle_photo_url: trip.vehiclePhoto,
        vehicle_thumb_url: trip.vehicleThumb,
        task_status: trip.status,
      }
      : undefined,
    // For a person with no office account to push to: the asker typed in by the office, or the person it is for
    // (on behalf of). The office tells them.
    tell_requester: (!r.requested_by_employee_id || r.on_behalf_of) && moment && message
      ? { moment, message, whatsapp: tellLink(r.requester_phone, message) }
      : undefined,
  };
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

/** Where a trip starts and how it is planned: the same columns on a request and on its task. */
type TripOwner = Pick<
  VehicleRequest,
  | "start_name"
  | "start_place_id"
  | "start_google_place_id"
  | "start_lat"
  | "start_lng"
  | "leave_by"
  | "leave_by_source"
  | "return_to_base"
  | "avoid_expressway"
>;

/** The start stop's own fields when passengers get in at the start (what, note, its time there when chosen). */
function startStopFields(stops: StopRowLike[]) {
  const at = stops.find((s) => s.is_start);
  if (!at) return {};
  return {
    passengers: true,
    what: at.what ?? undefined,
    note: at.note ?? undefined,
    dwell_min: at.dwell_source === "chosen" ? at.dwell_min ?? undefined : undefined,
  };
}

/** "Sat 17 Oct 09:00" as "09:00 Sat 17 Oct" (the time first, as the changed line says it). */
const timeThenDay = (iso: string) => colomboDayTime(iso).replace(/^(.*) (\d{2}:\d{2})$/, "$2 $1");

/**
 * Once a request is approved its trip is the task's (Phase 7, §4; Sahan, 17 October): the stops and times as they are
 * now, never the plan as first asked. "Changed by the office · was 09:00 Sat 17 Oct" when the leave time or the stops
 * differ from what the request asked (an older From/To request compares the time only: its place names were resolved
 * when it was approved). Not while the requester's own change waits for a decision (status changed): the difference is
 * theirs then, listed in the card's changes.
 */
function taskTrip(r: VehicleRequest, t: TripOutcome, asked: RequestStop[], withLine: boolean) {
  const task = t.task;
  const plan = task.plan_json as unknown as StoredPlan | null;
  const leave = task.leave_by ?? task.start_at;
  const askedAt = r.leave_by ?? r.needed_at;
  const timeMoved = Math.abs(new Date(leave).getTime() - new Date(askedAt).getTime()) >= 60000;
  const keys = (list: { type: string; place_name: string; place_id?: string | null; google_place_id?: string | null }[]) =>
    list.map((x) => stopForChange(x).key).join("\n");
  const stopsMoved = asked.length > 0 && keys(asked) !== keys(t.stops);
  const changed = r.status !== "changed" && (timeMoved || stopsMoved)
    ? {
      by: "the office",
      was: timeMoved ? timeThenDay(askedAt) : undefined,
      stops: stopsMoved || undefined,
      text: ["Changed by the office", timeMoved ? `was ${timeThenDay(askedAt)}` : "", stopsMoved ? "stops changed" : ""]
        .filter(Boolean).join(" · "),
    }
    : undefined;
  return {
    source: "task" as const,
    start: task.start_name
      ? {
        name: task.start_name,
        has_pin: task.start_lat != null,
        lat: task.start_lat ?? undefined,
        lng: task.start_lng ?? undefined,
        google: task.start_google_place_id ? true : undefined,
      }
      : undefined,
    leave_by: colomboTime(leave),
    leave_by_source: task.leave_by_source ?? undefined,
    return_to_base: task.return_to_base || undefined,
    avoid_expressway: task.avoid_expressway || undefined,
    stops: t.stops.map((x, i) => ({ ...stopCard(x, i), status: x.status, google: x.google_place_id ? true : undefined })),
    timeline: planTimeline(plan, t.stops, withLine),
    changed,
  };
}

/** The trip as the edit form takes it back (update_request's stops and start): the request's, or once approved its task's. */
function tripFields(r: TripOwner, stops: StopRowLike[]) {
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
        ...startStopFields(stops),
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
  // Once there is a task behind it, the task's times and stops are the request's (the office may have changed them).
  const outcome = r.task_id ? refs?.trips?.get(r.task_id) : undefined;
  const leaveAt = outcome ? outcome.task.leave_by ?? outcome.task.start_at : r.needed_at;
  const backBy = outcome ? outcome.task.end_by : r.back_by;
  // The edit form starts from the task while approved; a change waiting for a decision is the request's own (it took
  // the task's trip when it was made, update_request).
  const editFrom = outcome && r.status === "approved" ? outcome : undefined;
  const editLeave = editFrom ? leaveAt : r.needed_at;
  const editBack = editFrom ? backBy : r.back_by;
  const route = outcome?.stops.length
    ? [outcome.stops[0].place_name, outcome.stops.length > 1 ? outcome.stops[outcome.stops.length - 1].place_name : null]
    : [r.route_from, r.route_to];
  // A request planned with stops edits the task's stops; an older From/To one edits From and To (the task's ends).
  const editRoute = editFrom && stops.length === 0 ? route : [r.route_from, r.route_to];
  const sameDay = backBy && colomboDate(backBy) === colomboDate(leaveAt);
  // Decided = approved or declined (a cancelled booking was approved first; a cancelled waiting request was never decided).
  const decided = r.status === "approved" || r.status === "changed" || r.status === "declined" || (r.status === "cancelled" && r.task_id);
  const decider = r.decided_by_employee_id ? refs?.deciders?.get(r.decided_by_employee_id) : undefined;
  return {
    id: r.id,
    // Phase 7 (§33): "task" = a task proposed by someone without approve, with the proposed driver and vehicle.
    kind: r.kind,
    title: r.title ?? undefined,
    requested_by: r.requested_by_name,
    requested_by_photo_url: r.requested_by_employee_id ? refs?.deciders?.get(r.requested_by_employee_id)?.photo : undefined,
    on_behalf_of: r.on_behalf_of ?? undefined,
    project: r.project_label,
    when: colomboDayTime(leaveAt),
    back_by: backBy ? (sameDay ? colomboTime(backBy) : colomboDayTime(backBy)) : undefined,
    route: route.filter(Boolean).join(" → ") || undefined,
    need: needText(r),
    note: r.note,
    status: r.status,
    asked: whenText(r.created_at, now),
    decided: decided ? by(r.decided_at, r.decided_by) : undefined,
    decline_reason: r.decline_reason,
    task_id: r.task_id,
    driver_required: r.driver_required,
    // Round 3: who the asker said drives, when not a driver (self, other with the name and phone, custodian).
    driven_by: r.driven_by !== "driver" ? r.driven_by : undefined,
    driver_name: r.driver_name ?? undefined,
    driver_phone: r.driver_phone ?? undefined,
    // Round 3 (A5, Zipcar for Business): the asker drives it themselves: is their licence on file on the trip's day?
    self_drive_licence: r.driven_by === "self" && r.requested_by_employee_id
      ? licenceState(refs?.deciders?.get(r.requested_by_employee_id)?.licence, colomboDate(r.leave_by ?? r.needed_at))
      : undefined,
    one_step: r.one_step ? true : undefined,
    cancelled: by(r.cancelled_at, r.cancelled_by),
    cancel_reason: r.cancel_reason,
    expired: r.expired_at ? colomboDateTime(r.expired_at) : undefined,
    version: r.version,
    // Waiting past its leave-by: it stays in the queue, never sent by itself (§35 18).
    late: r.status === "waiting" && new Date(r.needed_at) <= now ? true : undefined,
    // Round 48: a proposed change names the task it changes and what changes.
    change: changeCardOf(r),
    proposed: r.kind === "task" || r.kind === "change"
      ? {
        driver: r.proposed_employee_id ? refs?.people.get(r.proposed_employee_id)?.name : undefined,
        username: r.proposed_employee_id ? refs?.people.get(r.proposed_employee_id)?.username ?? undefined : undefined,
        vehicle: r.proposed_vehicle_id ? refs?.plates.get(r.proposed_vehicle_id) : undefined,
        // Hotfix 2 (J): "Vehicle: on the day" / "Any van" when none was named.
        vehicle_text: r.proposed_vehicle_id ? undefined : vehicleText(r.proposed_vehicle_mode, r.proposed_vehicle_type),
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
    stops_count: (outcome ? outcome.stops.length : stops.length) || undefined,
    // Once approved (or changed, or cancelled after approval) the trip is the task's: never an old plan.
    trip: outcome ? taskTrip(r, outcome, stops, withLine) : tripOf(r, stops, withLine),
    requester_phone: r.requester_phone ?? undefined,
    ...outcomeOf(r, outcome),
    // The fields as the edit form needs them (Colombo day and clock).
    fields: {
      date: colomboDate(editLeave),
      time: colomboTime(editLeave),
      back_by: editBack ? colomboTime(editBack) : undefined,
      route_from: editRoute[0] ?? undefined,
      route_to: editRoute[1] ?? undefined,
      need_type: r.need_type ?? undefined,
      pax: r.pax ?? undefined,
      tools: r.tools,
      note: r.note ?? undefined,
      driver_required: r.driver_required,
      driven_by: r.driven_by,
      driver_name: r.driver_name ?? undefined,
      driver_phone: r.driver_phone ?? undefined,
      on_behalf_of: r.on_behalf_of ?? undefined,
      from_dwell_min: r.from_dwell_min ?? undefined,
      to_dwell_min: r.to_dwell_min ?? undefined,
      ...(editFrom && stops.length > 0 ? tripFields(editFrom.task, editFrom.stops) : tripFields(r, stops)),
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
      // Round 3 (A6): still waiting when its day was over.
      expired: r.expired_at ? colomboDateTime(r.expired_at) : undefined,
    },
    events: events.map(eventCard),
    // Hotfix 2 (K): who decided it, with their number (Call, WhatsApp) and photo; who has it open now.
    approved_by: decided && r.status !== "declined" && r.decided_at
      ? personAt(r.decided_by ?? "the office", r.decided_at, now, decider)
      : undefined,
    declined_by: r.status === "declined" && r.decided_at
      ? { ...personAt(r.decided_by ?? "the office", r.decided_at, now, decider), reason: r.decline_reason ?? undefined }
      : undefined,
    cancelled_by: r.status === "cancelled" && r.cancelled_at
      ? { name: r.cancelled_by ?? "the office", at: atText(r.cancelled_at, now), reason: r.cancel_reason ?? undefined }
      : undefined,
    reviewing: (r.status === "waiting" || r.status === "changed") && refs?.reviewing?.get(r.id)?.length
      ? refs.reviewing.get(r.id)
      : undefined,
    // Hotfix 2 (A, F): the trip's live state from its task, and the office's number for Call office.
    live: liveOf(r, outcome, now),
    office_phone: phoneLinks(refs?.officePhone),
  };
}

/**
 * The cards with their timelines and trips (one query each for all the rows). `viewer` = the person asking: they are left
 * out of "reviewing" (their own decide page).
 */
async function requestCards(db: Db, rows: VehicleRequest[], now: Date, withLine = false, viewer?: string | null) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const people = [...new Set(rows.flatMap((r) => r.proposed_employee_id ? [r.proposed_employee_id] : []))];
  const plates = [...new Set(rows.flatMap((r) => r.proposed_vehicle_id ? [r.proposed_vehicle_id] : []))];
  // Who decided, and (Round 3) who asked: their photos beside their names.
  const deciderIds = [
    ...new Set(rows.flatMap((r) => [r.decided_by_employee_id, r.requested_by_employee_id].filter((x): x is string => !!x))),
  ];
  const open = rows.filter((r) => r.status === "waiting" || r.status === "changed").map((r) => r.id);
  const [events, stops, emps, vehs, trips, deciderRes, viewerRes, settings] = await Promise.all([
    db.from("request_events").select("*").in("request_id", ids).order("at").order("id").limit(5000),
    requestStopsOf(db, ids),
    people.length ? db.from("employees").select("id, name, username").in("id", people) : { data: [], error: null },
    plates.length ? db.from("vehicles").select("id, reg_no").in("id", plates) : { data: [], error: null },
    tripOutcomes(db, rows, now),
    deciderIds.length
      ? db.from("employees").select(
        "id, name, phone, photo_id, licence_no, licence_expiry, licence_front_photo_id, licence_back_photo_id",
      ).in("id", deciderIds)
      : { data: [], error: null },
    open.length
      ? db.from("request_viewers").select("request_id, employee_id, name, seen_at").in("request_id", open)
        .gte("seen_at", new Date(now.getTime() - REVIEWING_FOR_MS).toISOString()).order("seen_at")
      : { data: [], error: null },
    loadSettings(db),
  ]);
  const evs = unwrap(events, "request events");
  const deciders = unwrap(deciderRes, "employees");
  const photos = await driverPhotoLinks(db, deciders, now);
  const reviewing = new Map<string, { name: string; since: string }[]>();
  for (const v of unwrap(viewerRes, "reviewing")) {
    if (v.employee_id === viewer) continue;
    reviewing.set(v.request_id, [...(reviewing.get(v.request_id) ?? []), { name: v.name, since: colomboTime(v.seen_at) }]);
  }
  const refs: CardRefs = {
    people: new Map(unwrap(emps, "employees").map((e) => [e.id, { name: e.name, username: e.username }])),
    plates: new Map(unwrap(vehs, "vehicles").map((v) => [v.id, v.reg_no])),
    trips,
    deciders: new Map(deciders.map((e) => [e.id, { name: e.name, phone: e.phone, photo: photos.get(e.id), licence: e }])),
    reviewing,
    officePhone: settings.office_phone,
  };
  // Round 4–7 (6): who rides, by name; nothing while the switch passengers is off.
  const riders = settings.passengers ? await passengerCards(db, { requestIds: ids }, now) : new Map();
  return rows.map((r) => {
    const card = requestCard(r, now, evs.filter((e) => e.request_id === r.id), stops.get(r.id) ?? [], refs, withLine);
    const list = riders.get(r.id);
    return list ? { ...card, passengers_list: list } : card;
  });
}

async function requestCardOf(db: Db, row: VehicleRequest, now: Date, withLine = false, viewer?: string | null) {
  return (await requestCards(db, [row], now, withLine, viewer))[0];
}

/**
 * Round 4–7 (6): update_request's own first checks, for a call that changes only who rides (withPassengerList never runs
 * the tool then): the request is the caller's (or they approve), the version they loaded, a state an edit may change.
 */
/** Round 48: a proposed change is applied or declined as proposed; to change it, withdraw it and propose again. */
const CHANGE_NOT_EDITABLE = "A proposed change cannot be edited: cancel it (cancel_request) and propose the change again.";

export async function requestEditGuard(args: Record<string, unknown>, { db, actor }: { db: Db; actor: Actor }): Promise<void> {
  const request = await getRequest(db, args.request_id as string);
  if (!actor.permissions.includes("approve") && request.requested_by_employee_id !== actor.employeeId) {
    throw new ToolError("This request is not yours to change.");
  }
  if (request.kind === "change") throw new ToolError(CHANGE_NOT_EDITABLE);
  checkVersion(request.version, args.version as number);
  statusAfterEdit(request.status);
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

/**
 * Who drives a request's task (Round 3, whoDrives.ts): a driver named here wins; else the request's own choice (self =
 * the asker, other = the name asked, custodian = the vehicle's custodian).
 */
function pickWhoDrives(
  refs: Refs,
  typed: string | undefined,
  request: Pick<VehicleRequest, "driven_by" | "requested_by_employee_id" | "driver_name" | "driver_phone">,
  vehicle: Vehicle | null,
  selfDrive: boolean,
  actor: Actor,
) {
  return decideWhoDrives({
    driverTyped: typed ? activeDriver(refs, typed) : null,
    asked: request.driven_by as Asked,
    askerId: request.requested_by_employee_id,
    approverId: actor.employeeId,
    driverName: request.driver_name,
    driverPhone: request.driver_phone,
    vehicle,
    selfDriveAllowed: selfDrive,
  }, refs.emp);
}

/** Warnings about the vehicle against what was asked for (never blocks). */
function fitWarnings(vehicle: Vehicle | null, need: { need_type?: string | null; pax?: number | null }): string[] {
  const out: string[] = [];
  // No vehicle yet (on the day, any of a type, Hotfix 2 J): its fit is checked when it is set.
  if (!vehicle) return out;
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
  driver_required: z.boolean().optional().describe(
    "false when no driver is needed: the vehicle's custodian drives (the older form of driven_by). Default true",
  ),
  ...whoDrivesInput,
  requester_phone: zText(30).optional().describe(
    "The phone of the person who asked, when they have no office account: Tell requester (WhatsApp) goes to it (Phase 7, §4)",
  ),
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
  async run(args, { db, now, actor, passengers }) {
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
    // From is where the passengers first get in (the start, when they get in there), To the last stop.
    const firstStop = trip?.stops[0];
    const lastStop = trip?.stops[trip.stops.length - 1];

    // A project that is known from Zoho is linked; anything else is kept as a label.
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const who = await requester(db, actor, args.requested_by);
    // Round 3: who drives, as asked (self = the asker).
    const drives = checkAsked(askedOf(args), args, settingsNow.self_drive_allowed, { employeeId: who.employeeId });
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
        ...drives,
        on_behalf_of: args.on_behalf_of ?? null,
        from_dwell_min: args.from_dwell_min ?? null,
        to_dwell_min: args.to_dwell_min ?? null,
        requester_phone: args.requester_phone ?? null,
        // Round 4–7 (6): who rides, in the same statement.
        ...passengerColumn(passengers),
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
      // Hotfix 2 (A): the notification centre and the push open this request (its page has Decide).
      url: `/requests/${created.id}`,
      tag: `request:${created.id}`,
      who: created.requested_by_name,
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
    "late = waiting past its leave-by. Round 48: kind change = a change to an existing task (change.task_id) proposed by someone " +
    "without approve: the driver, vehicle, time or stops it would get (change.changes); the task stays as it is until decided.",
  readOnly: true,
  input: z.object({
    status: z.enum(["waiting", "changed", "approved", "declined", "cancelled", "expired", "all"]).optional().describe(
      "Default: waiting (which includes changed = approved and edited since, needing re-approval)",
    ),
    kind: z.enum(["request", "task", "change"]).optional().describe(
      "task = only tasks proposed by someone without approve (Phase 7); change = only changes to a task proposed by someone without approve (Round 48)",
    ),
    id: zId.optional().describe("Only this request"),
    with_line: z.boolean().optional().describe("The web's plan map: each leg's Google road line in the trip's timeline"),
    // Hotfix 3 (L3): a page at a time, and the search box.
    search: zSearch,
    ...zPaging,
  }),
  async run({ status = "waiting", kind, id, with_line, search, limit, cursor }, { db, now, actor }) {
    const w = pageWindow(limit, cursor);
    let query = db.from("vehicle_requests").select("*", { count: "exact" });
    const words = search?.replace(/[%_,()*]/g, " ").trim();
    if (words) {
      query = query.or(
        `requested_by_name.ilike.*${words}*,route_from.ilike.*${words}*,route_to.ilike.*${words}*,title.ilike.*${words}*,` +
          `note.ilike.*${words}*,project_label.ilike.*${words}*,on_behalf_of.ilike.*${words}*`,
      );
    }
    if (kind) query = query.eq("kind", kind);
    if (id) query = query.eq("id", id);
    if (status === "waiting") query = query.in("status", ["waiting", "changed"]);
    else if (status !== "all") query = query.eq("status", status);
    // The queue (everyone's requests) is the approver's; everyone else sees their own.
    if (!actor.permissions.includes("approve")) {
      query = query.eq("requested_by_employee_id", actor.employeeId ?? "00000000-0000-0000-0000-000000000000");
    }
    const ordered = query.order("needed_at", { ascending: status === "waiting" || status === "changed" }).order("id");
    const res = w.limit === null ? await ordered.limit(100) : await ordered.range(w.offset, w.offset + w.limit - 1);
    const rows = unwrap(res, "vehicle requests");
    return {
      result: {
        status,
        count: rows.length,
        ...pageInfo(w, rows.length, res.count ?? rows.length),
        requests: await requestCards(db, rows, now, with_line === true, actor.employeeId),
      },
      summary: `${rows.length} requests (${status})`,
    };
  },
});

/** My trips' filter (Hotfix 2, A) on the trip's live state. */
const TRIP_FILTER: Record<string, readonly string[]> = {
  waiting: ["waiting"],
  approved: ["approved", "accepted"],
  under_way: ["on_the_way", "arrived"],
  completed: ["completed"],
  declined: ["declined"],
  cancelled: ["cancelled"],
  expired: ["expired"],
};

/**
 * The tasks a person created directly, as My trips rows (Hotfix 3): the task's live state, the driver and the vehicle, who
 * sent it. `at` (the leave time, ISO) is for the sort and is taken off before the answer.
 */
async function createdTaskCards(db: Db, tasks: Task[], now: Date) {
  if (tasks.length === 0) return [];
  const outcomes = await tripOutcomes(db, tasks.map((t) => ({ task_id: t.id }) as VehicleRequest), now);
  const approverIds = [...new Set(tasks.flatMap((t) => (t.approved_by_employee_id ? [t.approved_by_employee_id] : [])))];
  const approvers = approverIds.length
    ? unwrap(await db.from("employees").select("id, name, phone, photo_id").in("id", approverIds), "employees")
    : [];
  const photos = await driverPhotoLinks(db, approvers, now);
  return tasks.map((t) => {
    const trip = outcomes.get(t.id);
    const leave = t.leave_by ?? t.start_at;
    const stops = trip?.stops ?? [];
    const approver = approvers.find((a) => a.id === t.approved_by_employee_id);
    const sameDay = t.end_by && colomboDate(t.end_by) === colomboDate(leave);
    return {
      source: "task" as const,
      id: t.id,
      task_id: t.id,
      title: t.title,
      label: t.label ?? undefined,
      kind: t.kind,
      when: colomboDayTime(leave),
      back_by: t.end_by ? (sameDay ? colomboTime(t.end_by) : colomboDayTime(t.end_by)) : undefined,
      route: stops.length
        ? [stops[0].place_name, stops.length > 1 ? stops[stops.length - 1].place_name : null].filter(Boolean).join(" → ")
        : undefined,
      stops_count: stops.length || undefined,
      status: t.status,
      live: taskLive(t, trip, now),
      assigned: trip
        ? {
          driver: trip.driver,
          driven_by: trip.drivenBy !== "driver" ? trip.drivenBy : undefined,
          phone: trip.phone ?? undefined,
          ...contactLinks(trip.phone),
          photo_url: trip.driverPhoto,
          vehicle: trip.plate,
          vehicle_text: trip.plate ? undefined : vehicleText(t.vehicle_mode, t.vehicle_type_wanted),
          make_model: trip.model ?? undefined,
          vehicle_photo_url: trip.vehiclePhoto,
          vehicle_thumb_url: trip.vehicleThumb,
          task_status: t.status,
        }
        : undefined,
      approved_by: approver && t.approved_at
        ? personAt(approver.name, t.approved_at, now, { phone: approver.phone, photo: photos.get(approver.id) })
        : undefined,
      created: colomboDateTime(t.created_at),
      at: leave,
    };
  });
}

/** What a My trips row is found by (Hotfix 3): its title, label, project, route and stops, the driver and the plate. */
function tripWords(card: Record<string, unknown>): string {
  const c = card as {
    title?: string;
    label?: string;
    project?: string;
    route?: string;
    trip?: { stops?: { place?: string; place_name?: string }[] };
    assigned?: { driver?: string; vehicle?: string };
  };
  const stops = (c.trip?.stops ?? []).map((s) => s.place ?? s.place_name);
  return plain([c.title, c.label, c.project, c.route, ...stops, c.assigned?.driver, c.assigned?.vehicle].filter(Boolean).join(" "));
}

/** A task's live state on My trips (Hotfix 3): sent, accepted, on the way, arrived, completed, declined, cancelled, missed. */
function taskLive(t: Task, trip: TripOutcome | undefined, now: Date) {
  const at = (iso: string | null | undefined) => (iso ? atText(iso, now) : undefined);
  const dot = (text: string, iso: string | null | undefined) => (iso ? `${text} · ${atText(iso, now)}` : text);
  switch (t.status) {
    case "completed":
      return { state: "completed" as const, text: dot("Completed", t.completed_at), at: at(t.completed_at) };
    case "cancelled":
      return {
        state: "cancelled" as const,
        text: t.cancelled_reason ? `Cancelled · ${t.cancelled_reason}` : "Cancelled",
        at: at(t.updated_at),
      };
    case "missed":
      return { state: "missed" as const, text: dot("Missed", t.missed_at), at: at(t.missed_at) };
    case "declined":
      return {
        state: "declined" as const,
        text: `Declined by the driver${t.declined_reason ? ` · ${DECLINE_TEXT[t.declined_reason] ?? t.declined_reason}` : ""}`,
        at: at(t.declined_at),
      };
    case "in_progress": {
      const pickup = trip?.stops.find((s) => s.type === "pickup");
      const arrivedAt = pickup?.arrived_at ?? pickup?.auto_detected_at;
      return arrivedAt
        ? { state: "arrived" as const, text: dot("Arrived", arrivedAt), at: at(arrivedAt) }
        : { state: "on_the_way" as const, text: dot("On the way", t.started_at), at: at(t.started_at) };
    }
    default:
      return t.accepted_at
        ? { state: "accepted" as const, text: dot("Driver accepted", t.accepted_at), at: at(t.accepted_at) }
        : { state: "approved" as const, text: "Sent to the driver", at: at(t.sent_at) };
  }
}

export const myTrips = tool({
  name: "my_trips",
  title: "My trips",
  description: "The person's own requests and proposed tasks, the trips they ride in as a registered passenger (role " +
    "passenger, view only: not with include tasks), and with include tasks or all (Hotfix 3) the tasks they created " +
    "directly (source task), " +
    "whose trip day is between from and to (Colombo dates, at most a " +
    "year), newest first, each with its live state from its task (live: waiting, approved, accepted, on_the_way, arrived, " +
    "completed, declined, cancelled), who decided it (approved_by / declined_by with their number), the driver and the vehicle " +
    "(assigned, with Call and WhatsApp), and the office's number. status filters on the live state (under_way = on the way or " +
    "arrived). Personal: a signed-in person or a personal key.",
  readOnly: true,
  input: z.object({
    from: zDate.describe("First day, YYYY-MM-DD"),
    to: zDate.describe("Last day, YYYY-MM-DD"),
    status: z.enum(["waiting", "approved", "under_way", "completed", "declined", "cancelled", "expired", "all"]).optional().describe(
      "Default all",
    ),
    include: z.enum(["all", "requests", "tasks"]).optional().describe(
      "requests (the default, as before): the requests and proposals; tasks: the tasks the person created directly; all: both",
    ),
    search: zSearch.describe("Words to look for: the title, a place on the route, the project, the driver or the plate"),
    ...zPaging,
  }),
  async run({ from, to, status = "all", include = "requests", search, limit, cursor }, { db, now, actor }) {
    realDate(from);
    realDate(to);
    if (to < from) throw new ToolError("to must be the same day as from or later.");
    if (daysBetween(from, to) > 366) throw new ToolError("At most a year at a time: choose a shorter range.");
    if (!actor.employeeId) {
      throw new ToolError("This is personal: it needs a signed-in person (the web app) or a personal connector key.");
    }
    const span = { from: dayRange(from).from, to: dayRange(to).to };
    const rows = include === "tasks" ? [] : unwrap(
      await db.from("vehicle_requests").select("*").eq("requested_by_employee_id", actor.employeeId)
        .gte("needed_at", span.from).lt("needed_at", span.to)
        .order("needed_at", { ascending: false }).order("created_at", { ascending: false }).limit(500),
      "vehicle requests",
    );
    // Hotfix 3 (decision 2): the tasks the person made directly (not from a request): they assigned them.
    const made = include === "requests" ? [] : unwrap(
      await db.from("tasks").select("*").eq("assigned_by_employee_id", actor.employeeId).is("request_id", null).eq("kind", "dispatch")
        .gte("start_at", span.from).lt("start_at", span.to).order("start_at", { ascending: false }).limit(500),
      "tasks",
    );
    // Round 4–7 (6): the trips the person rides in (a registered passenger), view only: never their own or asked by them;
    // none while the switch passengers is off.
    const riding = include === "tasks" || !(await loadSettings(db)).passengers ? [] : await (async () => {
      const ids = unwrap(
        await db.from("task_passengers").select("task_id").eq("employee_id", actor.employeeId!).is("removed_at", null),
        "passengers",
      ).map((p) => p.task_id);
      if (!ids.length) return [];
      const mine = new Set(rows.flatMap((r) => (r.task_id ? [r.task_id] : [])));
      return unwrap(
        await db.from("tasks").select("*").in("id", ids).neq("employee_id", actor.employeeId!).eq("demo", false)
          .gte("start_at", span.from).lt("start_at", span.to).order("start_at", { ascending: false }).limit(500),
        "tasks",
      ).filter((t) => !mine.has(t.id) && t.assigned_by_employee_id !== actor.employeeId);
    })();
    const [requestRows, taskRows, ridingRows] = await Promise.all([
      requestCards(db, rows, now, false, actor.employeeId),
      createdTaskCards(db, made, now),
      createdTaskCards(db, riding, now),
    ]);
    // Newest trip first, requests and tasks together.
    const all = [
      ...requestRows.map((c) => ({
        card: c as Record<string, unknown> & { live: { state: string } },
        at: rows.find((r) => r.id === c.id)!.needed_at,
      })),
      ...taskRows.map((c) => ({ card: c as Record<string, unknown> & { live: { state: string } }, at: c.at })),
      // A passenger sees the time, the stops, the driver with their phone, the plate and the live state: not who approved.
      ...ridingRows.map(({ approved_by: _a, created: _c, ...c }) => ({
        card: { ...c, role: "passenger" } as Record<string, unknown> & { live: { state: string } },
        at: c.at,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const wanted = status === "all" ? null : TRIP_FILTER[status];
    const key = search ? plain(search) : "";
    const kept = all.filter((x) => (!wanted || wanted.includes(x.card.live.state)) && (!key || tripWords(x.card).includes(key)))
      .map((x) => x.card);
    const page = pageOf(kept, pageWindow(limit, cursor));
    // Round 4–7 (4b): a trip nobody drives with the app, on the person's own account, says what it asks of them now (the
    // row's button: check before setting off, finish, or confirm one closed without its odometer); its page is my_trip.
    const taskIds = page.rows.flatMap((c) => (typeof c.task_id === "string" ? [c.task_id] : []));
    const noApp = taskIds.length
      ? unwrap(
        await db.from("tasks").select("id, employee_id, driven_by, status, started_at, finish_flag, finish_ask_sent_at, start_at")
          .in("id", taskIds).neq("driven_by", "driver"),
        "tasks",
      )
      : [];
    const actions = new Map(noApp.filter((t) => t.employee_id === actor.employeeId).map((t) => [t.id, noAppAction(t, now)]));
    const trips = page.rows.map((c) => {
      const { at: _at, ...card } = c as Record<string, unknown> & { at?: string };
      const action = typeof card.task_id === "string" ? actions.get(card.task_id) : undefined;
      return action ? { ...card, trip_action: action } : card;
    });
    return {
      result: { from, to, status, include, count: trips.length, total: page.total, next: page.next, trips },
      summary: `${trips.length} trips of ${actor.name} ${from}..${to} (${status}, ${include})`,
    };
  },
});

export const reviewing = tool({
  name: "reviewing",
  title: "I'm deciding this request",
  description: 'The decide page says so every 20 s while it is open: the others who approve see "Palitha is reviewing" (for ' +
    "45 s after the last call). Answers the others reviewing it now. With the shared key (no person) nothing is recorded.",
  readOnly: false,
  input: z.object({ request_id: zId }),
  async run({ request_id }, { db, now, actor }) {
    const request = await getRequest(db, request_id);
    if (actor.employeeId && (request.status === "waiting" || request.status === "changed")) {
      unwrap(
        await db.from("request_viewers").upsert(
          { request_id, employee_id: actor.employeeId, name: actor.name, seen_at: now.toISOString() },
          { onConflict: "request_id,employee_id" },
        ),
        "reviewing",
      );
    }
    const others = unwrap(
      await db.from("request_viewers").select("employee_id, name, seen_at").eq("request_id", request_id)
        .gte("seen_at", new Date(now.getTime() - REVIEWING_FOR_MS).toISOString()).order("seen_at"),
      "reviewing",
    ).filter((v) => v.employee_id !== actor.employeeId);
    return {
      result: {
        request_id,
        status: request.status,
        version: request.version,
        reviewing: others.map((v) => ({ name: v.name, since: colomboTime(v.seen_at) })),
      },
      summary: `${actor.name} reviewing request ${request_id}`,
    };
  },
});

export interface Window {
  neededAt: string;
  backBy: string | null;
  need_type: string | null;
  pax: number | null;
  /** Round 48: the plan's end when the trip has no back-by: the window ends there, else at the end of the day. */
  plannedEnd?: string | null;
  /** Round 48: today (Colombo), for the chips' day words; default now. */
  today?: string;
}

/**
 * Every active vehicle ranked for a window, in the four groups, and every active driver with whether he is free. Round 48
 * (Google Calendar's room picker): the window is the trip's (tripWindow: the back-by, else the plan's end, else the rest
 * of the trip's day); every entry carries the trip's chip words (free_text "Free Thu 29 Oct", busy_text "Busy 09:00–13:00
 * that day · Team drop" with its pieces). In the garage is NOW (the only thing known): for a trip on another day the
 * entry says so (garage_now, garage_text).
 */
export async function availabilityFor(db: Db, refs: Refs, w: Window) {
  const tw = tripWindow({ start: w.neededAt, endBy: w.backBy, plannedEnd: w.plannedEnd });
  const day = tw.day;
  const from = new Date(tw.from).getTime();
  const to = new Date(tw.to).getTime();
  const busy = (t: Task) =>
    new Date(t.start_at).getTime() < to &&
    from < taskEndMs({ end_by: t.end_by, ends_planned: (t.plan_json as { ends_at?: string } | null)?.ends_at }, tw.day_end);
  const today = w.today ?? colomboDate(new Date().toISOString());
  const freeChip = { free_text: freeText(day, today), free_day: day };
  const busyChip = (t: Task) => ({ busy_text: busyText(t), ...busyPieces(t) });
  const later = day > today;

  const vehicles = refs.vehicles.filter((v) => v.active);
  const [tasks, km, settings, offRes, openRes] = await Promise.all([
    openTasksOn(db, day),
    monthKm(db, vehicles.map((v) => v.id), day.slice(0, 7)),
    loadSettings(db),
    // Part 3b (H1): a driver who is not available then is not free.
    db.from("driver_unavailability").select("employee_id, starts_at, ends_at, part, reason").is("removed_at", null)
      .lt("starts_at", new Date(to).toISOString()).gt("ends_at", new Date(from).toISOString()),
    // Round 48: who is on duty now (the vehicle a free driver brings is the one held only while on duty, for a trip today).
    db.from("duty_sessions").select("employee_id").is("ended_at", null),
  ]);
  const away = new Map(unwrap(offRes, "availability").map((u) => [u.employee_id, u]));
  const onDutyNow = new Set(unwrap(openRes, "duty sessions").map((s) => s.employee_id));
  // Round 4–7 (7): who holds each busy vehicle or driver (none while holder_contact is off).
  const holders = await holdersOf(db, tasks.filter(busy));

  const ranked = vehicles.map((v) => {
    const mine = tasks.filter((t) => t.vehicle_id === v.id);
    const clash = mine.find(busy);
    const used = km.get(v.id) ?? 0;
    // No allowance set (null or 0): no check (Hotfix 3, L2).
    const over = (v.monthly_km_allowance ?? 0) > 0 && used > v.monthly_km_allowance!;
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
      // Round 48: the trip's chip, and "in the garage now" said as now (not known for another day).
      ...(v.in_garage
        ? { garage_now: true, garage_text: later ? `In the garage now · not known for ${tripDayWords(day, today)}` : "In the garage now" }
        : clash
        ? busyChip(clash)
        : freeChip),
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
      ? { back: clash.end_by ? `back ~${colomboTime(clash.end_by)}` : "end time not set", holder: holders.get(clash.id) }
      : {};
    return { rank, group, card, entry: { ...card, ...extra } };
  }).sort((a, b) => a.rank - b.rank);

  const drivers = refs.employees.filter((e) => e.role === "driver" && e.active).map((e) => {
    const mine = tasks.filter((t) => t.employee_id === e.id);
    const clash = mine.find(busy);
    const off = away.get(e.id);
    return {
      name: e.name,
      username: e.username,
      availability: clash
        ? `task ${taskWindow(clash)} · ${clash.title}`
        : off
        ? unavailableText(off)
        : mine.length === 0
        ? "free all day"
        : `free at that time (other task ${taskWindow(mine[0])})`,
      free: !clash && !off,
      holder: clash ? holders.get(clash.id) : undefined,
      // Round 48: the trip's chip words.
      ...(clash ? busyChip(clash) : off ? { busy_text: unavailableText(off) } : freeChip),
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
    // Round 3: the driver-first card: the photo, and the vehicle they hold (on duty) or their regular one.
    drivers_free: await (async () => {
      const free = refs.employees.filter((e) =>
        e.role === "driver" && e.active && drivers.some((d) => d.free && d.username === e.username)
      );
      const photos = await driverPhotoLinks(db, free);
      return free.map((e) => {
        // Round 48: the vehicle held is the one on duty NOW, for a trip today; another day (or off duty) brings the regular one.
        const held = !later && onDutyNow.has(e.id) && e.current_vehicle_id ? refs.veh.get(e.current_vehicle_id) : undefined;
        const regular = held ? undefined : refs.vehicles.find((v) => v.active && v.regular_driver_id === e.id);
        return {
          name: e.name,
          username: e.username,
          photo_url: photos.get(e.id),
          vehicle: held ? { reg_no: held.reg_no, source: "on_duty" } : regular ? { reg_no: regular.reg_no, source: "regular" } : undefined,
        };
      });
    })(),
    self_drive_allowed: settings.self_drive_allowed,
    good: ranked.some((r) => r.card.pick === "good"),
    day,
    // Round 48: the window in words and where its end came from.
    window_words: windowWords({ from: tw.from, to: tw.to }, today),
    end_source: tw.end_source,
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
    request_id: zId.optional().describe(
      "The request, or give date and time instead (Round 48: with a request, date, time and back_by are the approver's edited times: " +
        "the groups follow them)",
    ),
    date: zDate.optional(),
    time: zTime.optional(),
    back_by: zTime.optional(),
    planned_end: zTime.optional().describe("Round 48: the plan's end (HH:MM) when the trip has no back-by: the window ends there"),
    need_type: zVehicleType.optional(),
    pax: z.number().int().min(0).max(80).optional(),
  }),
  async run(args, { db, now, actor }) {
    let request: VehicleRequest | null = null;
    let w: Window;
    const today = colomboDate(now);
    if (args.request_id) {
      request = await markSeen(db, await getRequest(db, args.request_id), actor, now);
      // Round 48: the approver's edited day and times (the decide page's fields) win over the request's own.
      if (args.date) realDate(args.date);
      const day = args.date ?? colomboDate(request.needed_at);
      const neededAt = args.time ? utcIso(day, args.time) : args.date ? utcIso(day, colomboTime(request.needed_at)) : request.needed_at;
      const backBy = args.back_by
        ? utcIso(day, args.back_by)
        : args.date || args.time
        ? (request.back_by ? utcIso(day, colomboTime(request.back_by)) : null)
        : request.back_by;
      if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
      const plan = request.plan_json as { ends_at?: string } | null;
      w = {
        neededAt,
        backBy,
        need_type: request.need_type,
        pax: request.pax,
        // The plan's end stands only while the times are the request's own (a moved trip is planned again when decided).
        plannedEnd: args.planned_end ? utcIso(day, args.planned_end) : !args.date && !args.time ? plan?.ends_at ?? null : null,
        today,
      };
    } else {
      if (!args.date || !args.time) throw new ToolError("Give request_id, or date and time.");
      realDate(args.date);
      const neededAt = utcIso(args.date, args.time);
      const backBy = args.back_by ? utcIso(args.date, args.back_by) : null;
      if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
      w = {
        neededAt,
        backBy,
        need_type: args.need_type ?? null,
        pax: args.pax ?? null,
        plannedEnd: args.planned_end ? utcIso(args.date, args.planned_end) : null,
        today,
      };
    }
    const refs = await loadRefs(db);
    const a = await availabilityFor(db, refs, w);

    const { groups, good, day: _day, window_words, end_source, ...rest } = a;
    return {
      result: {
        request: request ? await requestCardOf(db, request, now) : undefined,
        window: {
          when: colomboDayTime(w.neededAt),
          back_by: w.backBy ? colomboTime(w.backBy) : undefined,
          need: needText({ need_type: w.need_type, pax: w.pax, tools: false }),
          // Round 48: the window in words ("tomorrow 09:00–13:00") and where its end came from (end_by, plan, day_end).
          words: window_words,
          end_source,
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
    // Hotfix 2 (K): several approvers; the one who loaded an older version is told who decided it, never a second decision.
    version: z.number().int().min(0).optional().describe(
      "The version list_requests showed: a request decided or edited since is refused with who did it and when",
    ),
  }),
  async run(args, { db, now, actor }) {
    let request = await getRequest(db, args.request_id);
    if (request.status !== "waiting" || (args.version !== undefined && args.version !== request.version)) {
      throw new ToolError(alreadyDecidedText(request, now));
    }
    request = await markSeen(db, request, actor, now);
    try {
      return await decide(db, now, actor, request, args);
    } catch (error) {
      // Another approver got there first (office_create_task holds the request while it approves): say who and when.
      if (error instanceof ToolError && /already (approved|declined|cancelled|changed)|Someone else decided/.test(error.message)) {
        throw new ToolError(alreadyDecidedText(await getRequest(db, request.id), now));
      }
      throw error;
    }
  },
});

type DecideArgs = {
  request_id: string;
  decision: "approve" | "decline";
  vehicle?: string;
  driver?: string;
  reason?: string;
  title?: string;
  decided_by?: string;
  start?: z.infer<typeof zStart>;
  from_dwell_min?: number;
  to_dwell_min?: number;
  date?: string;
  leave_by?: string;
  back_by?: string;
};

async function decide(db: Db, now: Date, actor: Actor, request: VehicleRequest, args: DecideArgs) {
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
          decided_by_employee_id: actor.employeeId,
          decline_reason: args.reason,
          version: request.version + 1,
        })
        .eq("id", request.id).eq("status", "waiting").select("*"),
      "vehicle request",
    );
    if (changed.length === 0) throw new ToolError("Someone else decided this request just now. Check list_requests.");
    await logRequestEvent(db, request.id, "declined", decidedBy, { note: args.reason });
    await notifyEvent(db, "request.decided", {
      title: request.kind === "task"
        ? `Task declined by ${decidedBy} · ${request.title ?? "your task"}`
        : request.kind === "change"
        ? `Change declined by ${decidedBy} · ${request.title ?? "the task"}`
        : `Request declined by ${decidedBy}`,
      who: decidedBy,
      body: args.reason,
      url: `/requests/${request.id}`,
      tag: `request:${request.id}`,
    }, told);
    return { result: { request: await requestCardOf(db, changed[0], now) }, summary: `declined request ${request.id}: ${args.reason}` };
  }

  // Round 48 (item 1): a proposed change to an existing task: the approver applies it (the same tool, run as them).
  if (request.kind === "change") return await approveChange(db, now, actor, request, decidedBy, told);

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
  const chosen = chooseVehicle(refs, args.vehicle, args.driver, decidedBy, now, {
    day: colomboDate(request.needed_at),
    onTheDay: settings.vehicle_on_the_day,
  });
  const vehicle = chosen.vehicle;
  const whoDrives = pickWhoDrives(refs, args.driver, request, vehicle, settings.self_drive_allowed, actor);
  const driver = whoDrives.employee;
  const drivesName = whoDrives.driverName ?? driver.name;
  const warnings = await assignWarnings(db, {
    driver: whoDrives.drivenBy === "other" ? null : driver,
    vehicle,
    startAt: request.needed_at,
    endBy: request.back_by,
    // Round 48: the request's plan bounds the trip when it has no back-by (the one window rule).
    plannedEnd: (request.plan_json as { ends_at?: string } | null)?.ends_at ?? null,
  });
  warnings.push(...fitWarnings(vehicle, request));
  // Round 3 (A5): driving it yourself with no licence on file is a warning, never a block.
  const noLicence = whoDrives.drivenBy === "self" ? noLicenceWarning(driver.name, driver, colomboDate(request.needed_at)) : null;
  if (noLicence) warnings.push(noLicence);

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
    notes: [request.note, request.tools ? "Tools / equipment travel too." : null, noAppNote(whoDrives)]
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
    vehicleChoice: whoDrives.drivenBy === "driver" ? chosen.choice : null,
    drivenBy: whoDrives.drivenBy,
    driverName: whoDrives.driverName,
    driverPhone: whoDrives.driverPhone,
    savedWarnings: warnings,
    assignedBy: actor.employeeId,
    vehicleWhy: chosen.why,
    vehicleMode: chosen.mode,
    vehicleType: chosen.type,
    approvedBy: actor.employeeId,
    approvedAt: now.toISOString(),
  }, warnings);
  // Every decision bumps the version (the approval itself is written by office_create_task), with who decided (K).
  unwrap(
    await db.from("vehicle_requests").update({ version: request.version + 1, decided_by_employee_id: actor.employeeId })
      .eq("id", request.id).select("id"),
    "vehicle request",
  );
  await logRequestEvent(db, request.id, "approved", decidedBy, { note: `${vehicleWordsOf(chosen)} · ${drivesName}` });
  await notifyEvent(db, "request.decided", {
    title: `Request approved by ${decidedBy} · ${vehicleWordsOf(chosen)} · ${drivesName}`,
    who: decidedBy,
    body: [colomboDayTime(request.needed_at), [request.route_from, request.route_to].filter(Boolean).join(" → ")].filter(Boolean).join(
      " · ",
    ),
    url: `/requests/${request.id}`,
    tag: `request:${request.id}`,
    ...(await pushPhotos(db, driver, vehicle)),
  }, told);

  return {
    result: { request: "approved", requested_by: request.requested_by_name, ...saved.result },
    summary: `approved request ${request.id} -> ${saved.summary}`,
  };
}

/**
 * Approving a request that carries its trip (Phase 7, §33, §34): a proposed task (the proposed driver and vehicle unless
 * the approver changes them) or a request planned with stops. The task takes the request's stops as they are, with nothing
 * retyped. The plan is kept as planned unless the approver changes the day or the leave time; then it is planned again
 * (the stops' arrive_by times move with the day).
 */
/**
 * Round 48 (item 1): the approver applies a proposed change (reassign_task, update_task or update_task_stops as proposed,
 * run as the approver: the task's history, approved_by and the audit are theirs), then the request is approved and the
 * proposer told. A change whose task has gone (completed, cancelled) or, for stops, whose plan moved on since, is refused:
 * decline it, or make the change yourself on the task.
 */
async function approveChange(
  db: Db,
  now: Date,
  actor: Actor,
  request: VehicleRequest,
  decidedBy: string,
  told: { actor: string | null; requester: string | null },
) {
  const p = request.proposal_json as unknown as ProposedChange | null;
  if (!request.change_task_id || !p?.tool) throw new ToolError("This change names no task; decline it.");
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", request.change_task_id).maybeSingle(), "task");
  if (!task) throw new ToolError("The task this change is for no longer exists; decline it.");
  if (task.status === "completed" || task.status === "cancelled") {
    throw new ToolError(`The task is ${task.status} now; decline this change.`);
  }
  if (p.tool === "update_task_stops" && task.plan_version !== p.plan_version) {
    throw new ToolError(
      `The task's stops changed since ${request.requested_by_name} proposed this (plan version ${task.plan_version}, proposed on ${p.plan_version}): ` +
        "decline it, or change the stops yourself on the task.",
    );
  }
  // Review L1: the card's "from" values are the task as it was proposed; a task moved since is not changed under the approver.
  const moved = taskMovedSince(task, p);
  if (moved) {
    throw new ToolError(
      `The task changed since ${request.requested_by_name} proposed this (${moved} is not what the card says): decline it, or make the change yourself on the task.`,
    );
  }
  // Review M1: the names proposed with the call go to the task with it (and only now).
  const keep = p.passengers ? { list: p.passengers, written: false } : undefined;
  const ctx = { db, now, actor, passengers: keep };
  const args = { ...p.args, task_id: task.id };
  let applied: { result: unknown; summary: string };
  switch (p.tool) {
    case "reassign_task":
      // deno-lint-ignore no-explicit-any
      applied = await reassignTask.run(args as any, ctx);
      break;
    case "update_task":
      // deno-lint-ignore no-explicit-any
      applied = await updateTask.run({ ...args, plan_version: task.plan_version } as any, ctx);
      break;
    case "update_task_stops":
      // deno-lint-ignore no-explicit-any
      applied = await updateTaskStops.run({ ...args, plan_version: task.plan_version } as any, ctx);
      break;
    default:
      throw new ToolError(`This change (${p.tool}) cannot be applied; decline it.`);
  }
  if (keep && !keep.written) await writePassengerColumn(db, taskTarget(task.id), keep.list);
  const rows = unwrap(
    await db.from("vehicle_requests").update({
      status: "approved",
      decided_at: now.toISOString(),
      decided_by: decidedBy,
      decided_by_employee_id: actor.employeeId,
      version: request.version + 1,
    }).eq("id", request.id).eq("status", "waiting").select("*"),
    "vehicle request",
  );
  if (rows.length === 0) throw new ToolError("Someone else decided this change just now. Check list_requests.");
  await logRequestEvent(db, request.id, "approved", decidedBy, { note: `applied: ${p.summary}` });
  await notifyEvent(db, "request.decided", {
    title: `Change approved by ${decidedBy} · ${task.title}`,
    who: decidedBy,
    body: p.summary,
    url: `/requests/${request.id}`,
    tag: `request:${request.id}`,
  }, told);
  return {
    result: {
      request: await requestCardOf(db, rows[0], now),
      decision: "approved",
      task_id: task.id,
      applied: applied.result,
    },
    summary: `approved change ${request.id} (${p.summary}) -> ${applied.summary}`,
  };
}

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
  // Hotfix 2 (J): a proposal made with the driver's vehicle on the day, or any of a type, keeps it when approved as proposed.
  const proposedWord = request.proposed_vehicle_mode === "driver_day"
    ? "on the day"
    : request.proposed_vehicle_mode === "any_type" && request.proposed_vehicle_type
    ? `any ${request.proposed_vehicle_type.replace("_", " ")}`
    : undefined;
  const proposedShown = proposedPlate ?? vehicleText(request.proposed_vehicle_mode, request.proposed_vehicle_type);
  const vehicleTyped = args.vehicle ?? (sameAsProposed ? proposedPlate ?? proposedWord : undefined);
  if (!vehicleTyped && !driverTyped) {
    throw new ToolError(
      "To approve, give a driver (the vehicle fills itself: the one they hold today, else their regular one) or a vehicle. " +
        "availability shows who is free.",
    );
  }
  const chosen = chooseVehicle(refs, vehicleTyped, driverTyped, decidedBy, now, {
    day: args.date ?? colomboDate(request.leave_by ?? request.needed_at),
    onTheDay: settings.vehicle_on_the_day,
  });
  const vehicle = chosen.vehicle;
  const whoDrives = pickWhoDrives(refs, driverTyped, request, vehicle, settings.self_drive_allowed, actor);
  const driver = whoDrives.employee;

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

  const { warnings, conflicts } = await assignCheck(db, {
    driver: whoDrives.drivenBy === "other" ? null : driver,
    vehicle,
    startAt: leaveBy,
    endBy,
    plannedEnd: plan.ends_at,
  });
  // Round 3 (A5): driving it yourself with no licence on file is a warning, never a block.
  const noLicence = whoDrives.drivenBy === "self" ? noLicenceWarning(driver.name, driver, colomboDate(leaveBy)) : null;
  if (noLicence) warnings.push(noLicence);
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
    notes: task ? request.task_notes : [request.note, request.tools ? "Tools / equipment travel too." : null, noAppNote(whoDrives)]
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
    vehicleChoice: whoDrives.drivenBy === "driver" ? chosen.choice : null,
    drivenBy: whoDrives.drivenBy,
    driverName: whoDrives.driverName,
    driverPhone: whoDrives.driverPhone,
    savedWarnings: warnings,
    assignedBy: task ? request.requested_by_employee_id : actor.employeeId,
    vehicleWhy: chosen.why,
    vehicleMode: chosen.mode,
    vehicleType: chosen.type,
    approvedBy: actor.employeeId,
    approvedAt: now.toISOString(),
  }, warnings);
  unwrap(
    await db.from("vehicle_requests").update({ version: request.version + 1, decided_by_employee_id: actor.employeeId })
      .eq("id", request.id).select("id"),
    "vehicle request",
  );
  const shownNow = vehicleWordsOf(chosen);
  const changedNote = [
    task && proposed && driver.id !== proposed.id ? `driver ${driver.name} instead of ${proposed.name}` : null,
    task && proposedShown && shownNow !== proposedShown ? `vehicle ${shownNow} instead of ${proposedShown}` : null,
    args.date || args.leave_by ? `leave ${colomboDayTime(leaveBy)}` : null,
  ].filter(Boolean).join(", ");
  await logRequestEvent(db, request.id, "approved", decidedBy, {
    note: `${shownNow} · ${whoDrives.driverName ?? driver.name}${changedNote ? ` (${changedNote})` : task ? " (as proposed)" : ""}`,
  });
  await notifyEvent(db, "request.decided", {
    ...(await pushPhotos(db, driver, vehicle)),
    title: task
      ? `Task approved by ${decidedBy} · sent to ${whoDrives.driverName ?? driver.name}`
      : `Request approved by ${decidedBy} · ${shownNow} · ${whoDrives.driverName ?? driver.name}`,
    who: decidedBy,
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
/**
 * The vehicle for an approval or a booking: as typed (a plate, or "on the day" / "any van" with vehicle_on_the_day), else
 * the driver's default (pickVehicle's rules, the request's day). Hotfix 2 (J): the vehicle may be none yet (mode).
 */
function chooseVehicle(
  refs: Refs,
  typedVehicle: string | undefined,
  typedDriver: string | undefined,
  by: string,
  now: Date,
  opts: { day?: string; onTheDay?: boolean } = {},
): { vehicle: Vehicle | null; mode: VehicleMode; type: string | null; why: string | undefined; choice: VehicleChoice | null } {
  const word = parseVehicleWord(typedVehicle);
  if (typedVehicle && !word) {
    const vehicle = activeVehicle(refs, typedVehicle);
    const driver = typedDriver ? refs.employees.find((e) => e.role === "driver" && e.active && sameDriver(e, typedDriver)) : undefined;
    if (driver) {
      const picked = pickVehicle(refs, driver, typedVehicle, by, now, opts);
      return { vehicle, mode: "specific", type: null, why: picked.why, choice: picked.choice };
    }
    return { vehicle, mode: "specific", type: null, why: undefined, choice: null };
  }
  const driver = activeDriver(refs, typedDriver ?? "");
  const picked = pickVehicle(refs, driver, typedVehicle, by, now, opts);
  return { vehicle: picked.vehicle, mode: picked.mode, type: picked.type, why: picked.why, choice: null };
}

/** "WP CAB-4521", or "Vehicle: on the day" / "Any van" while there is none (messages and history). */
const vehicleWordsOf = (v: { vehicle: Vehicle | null; mode: string; type: string | null }) =>
  v.vehicle?.reg_no ?? vehicleText(v.mode, v.type) ?? "the vehicle on the day";

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
    vehicle: zText(20).optional().describe(
      'Plate, or "on the day" / "any van" (car, double cab, lorry) with vehicle_on_the_day. Default: the driver\'s vehicle today, else their regular one',
    ),
    driver: zText(80).optional().describe("Username, code or name; not needed when the custodian drives"),
    title: zText(120).optional().describe("Task title. Default: built from the route"),
    stops: zStops.optional().describe("The task's stops; default: route_from → route_to"),
    start: zStart.optional(),
    return_to_base: z.boolean().optional(),
    avoid_expressway: z.boolean().optional(),
  }),
  async run(args, { db, now, actor, passengers }) {
    realDate(args.date);
    const matched = args.project ? (await matchProjects(db, args.project)).projects : [];
    const project = matched.length === 1 ? matched[0] : null;
    const who = await requester(db, actor, args.requested_by);

    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    if (!args.vehicle && !args.driver) throw new ToolError("Give a driver (the vehicle fills itself) or a vehicle.");
    const chosen = chooseVehicle(refs, args.vehicle, args.driver, actor.name, now, {
      day: args.date,
      onTheDay: settings.vehicle_on_the_day,
    });
    const vehicle = chosen.vehicle;
    // Round 3: who drives (self = the person it is booked for, other = the name and phone given).
    const asked = checkAsked(askedOf(args), args, settings.self_drive_allowed, { employeeId: who.employeeId ?? actor.employeeId });
    const whoDrives = pickWhoDrives(
      refs,
      args.driver,
      {
        driven_by: asked.driven_by,
        requested_by_employee_id: who.employeeId,
        driver_name: asked.driver_name,
        driver_phone: asked.driver_phone,
      },
      vehicle,
      settings.self_drive_allowed,
      actor,
    );
    const driver = whoDrives.employee;
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
    const warnings = await assignWarnings(db, {
      driver: whoDrives.drivenBy === "other" ? null : driver,
      vehicle,
      startAt: neededAt,
      endBy: backBy,
      // Round 48: the plan's end bounds the trip when it has no back-by (the one window rule).
      plannedEnd: prepared.plan.ends_at ?? null,
    });
    warnings.push(...fitWarnings(vehicle, args));
    // Round 3 (A5): driving it yourself with no licence on file is a warning, never a block.
    const noLicence = whoDrives.drivenBy === "self" ? noLicenceWarning(driver.name, driver, args.date) : null;
    if (noLicence) warnings.push(noLicence);
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
      route_from: args.stops ? prepared.stops[0].place_name : args.route_from ?? null,
      route_to: args.stops
        ? (prepared.stops.length > 1 ? prepared.stops[prepared.stops.length - 1].place_name : null)
        : args.route_to ?? null,
      need_type: args.need_type ?? null,
      pax: args.pax ?? null,
      tools: args.tools ?? false,
      note: args.note ?? null,
      // The request records what was asked; a driver named here makes it a driver's trip.
      ...(args.driver ? { driven_by: "driver", driver_required: true, driver_name: null, driver_phone: null } : asked),
      on_behalf_of: args.on_behalf_of ?? null,
      from_dwell_min: args.from_dwell_min ?? null,
      to_dwell_min: args.to_dwell_min ?? null,
    };
    const saved = await saveTask(db, {
      keep: passengers,
      title: args.title ?? (args.route_to ? `Trip · ${args.route_to}` : `Trip for ${who.name}`),
      label,
      driver,
      vehicle,
      startAt: neededAt,
      endBy: backBy,
      passengers: args.pax ?? null,
      contactName: who.name,
      contactPhone: who.employeeId ? refs.emp.get(who.employeeId)?.phone ?? null : null,
      notes: [args.note, args.tools ? "Tools / equipment travel too." : null, noAppNote(whoDrives)]
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
      vehicleChoice: whoDrives.drivenBy === "driver" ? chosen.choice : null,
      drivenBy: whoDrives.drivenBy,
      driverName: whoDrives.driverName,
      driverPhone: whoDrives.driverPhone,
      vehicleMode: chosen.mode,
      vehicleType: chosen.type,
      approvedBy: actor.employeeId,
      approvedAt: now.toISOString(),
      savedWarnings: warnings,
      assignedBy: actor.employeeId,
      vehicleWhy: chosen.why,
      request: { create, decidedBy: actor.name },
      bookedBy: actor.employeeId,
    }, warnings);
    // Who booked (and so approved) it (Hotfix 2, K), and the asker's phone when given.
    unwrap(
      await db.from("vehicle_requests").update({
        decided_by_employee_id: actor.employeeId,
        ...(args.requester_phone && { requester_phone: args.requester_phone }),
      }).eq("id", saved.result.request_id!).select("id"),
      "vehicle request",
    );
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
    await logRequestEvent(db, row.id, "approved", actor.name, {
      note: `${vehicleWordsOf(chosen)} · ${whoDrives.driverName ?? driver.name}`,
    });
    return {
      result: { request: await requestCardOf(db, row, now), booked: "in one step", ...saved.result },
      summary: `booked ${vehicleWordsOf(chosen)} for ${who.name} (requested and approved by ${actor.name}) -> ${saved.summary}`,
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
    if (request.status === "expired") throw new ToolError("This request expired already: nothing to cancel.");
    // Round 48: a change already applied is part of the task now; change the task itself.
    if (request.kind === "change" && request.status !== "waiting") {
      throw new ToolError("This change was approved already: change the task itself (update_task or reassign_task).");
    }
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
      const vehicle = task.vehicle_id
        ? unwrapMaybe(
          await db.from("vehicles").select("reg_no, custodian_employee_id").eq("id", task.vehicle_id).maybeSingle(),
          "vehicle",
        )
        : null;
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
  const { what, ...rest } = startStopFields(rows);
  return {
    place: r.start_name,
    place_id: r.start_place_id ?? undefined,
    lat: r.start_lat ?? undefined,
    lng: r.start_lng ?? undefined,
    ...rest,
    what: what as "people" | "goods" | "documents" | "other" | undefined,
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

/**
 * The first change to an approved request starts from its task as it is now (Phase 7, §4): the time, back-by, start and
 * stops the office may have changed since. What the requester changes is measured from the trip they saw, and deciding it
 * again never brings back the plan as first asked. A request planned with stops takes the task's stops; an older From/To
 * one takes the times and the first and last stops' names (it stays a From/To request). Null when there is no task to
 * start from (finished or cancelled).
 */
async function tripOfTask(
  db: Db,
  request: VehicleRequest,
  now: Date,
  withStops: boolean,
): Promise<{ request: VehicleRequest; rows?: RequestStop[]; trip?: RequestTrip } | null> {
  if (!request.task_id) return null;
  const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", request.task_id).maybeSingle(), "task");
  if (!task || task.status === "completed" || task.status === "cancelled") return null;
  const stops = unwrap(await db.from("task_stops").select("*").eq("task_id", task.id).neq("status", "removed").order("seq"), "stops");
  const leave = task.leave_by ?? task.start_at;
  if (!withStops) {
    const [first, last] = [stops[0], stops.length > 1 ? stops[stops.length - 1] : undefined];
    return {
      request: {
        ...request,
        needed_at: leave,
        back_by: task.end_by,
        route_from: first?.place_name ?? request.route_from,
        route_to: last?.place_name ?? request.route_to,
      },
    };
  }
  const nowIso = now.toISOString();
  const rows: RequestStop[] = stops.map((x) => ({
    id: x.id,
    request_id: request.id,
    seq: x.seq,
    type: x.type,
    what: x.what,
    place_id: x.place_id,
    place_name: x.place_name,
    address: x.address,
    lat: x.lat,
    lng: x.lng,
    dwell_min: x.dwell_min,
    arrive_by: x.arrive_by,
    note: x.note,
    planned_arrive_at: x.planned_arrive_at,
    planned_depart_at: x.planned_depart_at,
    is_start: x.is_start,
    dwell_source: x.dwell_source,
    google_place_id: x.google_place_id,
    google_fetched_at: x.google_fetched_at,
    created_at: nowIso,
    removed_at: null,
  }));
  const caught: VehicleRequest = {
    ...request,
    needed_at: leave,
    back_by: task.end_by,
    start_place_id: task.start_place_id,
    start_name: task.start_name,
    start_lat: task.start_lat,
    start_lng: task.start_lng,
    start_google_place_id: task.start_google_place_id,
    start_google_fetched_at: task.start_google_fetched_at,
    leave_by: leave,
    leave_by_source: task.leave_by_source ?? "manual",
    return_to_base: task.return_to_base,
    avoid_expressway: task.avoid_expressway,
    buffer_min: task.buffer_min,
    plan_json: task.plan_json,
  };
  return {
    request: caught,
    rows,
    trip: {
      start: startOfRequest(caught),
      stops: rows.map(resolvedFromRow),
      plan: task.plan_json as unknown as StoredPlan,
      returnToBase: task.return_to_base,
      avoidExpressway: task.avoid_expressway,
      leaveBy: leave,
      leaveBySource: task.leave_by_source === "plan" ? "plan" : "manual",
      bufferMin: task.buffer_min,
    },
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
    ...whoDrivesInput,
    on_behalf_of: z.string().trim().max(120).nullable().optional(),
    requester_phone: z.string().trim().max(30).nullable().optional().describe(
      "The phone of the person who asked (no office account); null clears it",
    ),
    from_dwell_min: z.number().int().min(0).max(1440).nullable().optional().describe("Minutes at From; null = the default"),
    to_dwell_min: z.number().int().min(0).max(1440).nullable().optional().describe("Minutes at To; null = the default"),
  }),
  async run(args, { db, now, actor, passengers }) {
    if (args.date) realDate(args.date);
    const request = await getRequest(db, args.request_id);
    if (!actor.permissions.includes("approve") && request.requested_by_employee_id !== actor.employeeId) {
      throw new ToolError("This request is not yours to change.");
    }
    if (request.kind === "change") throw new ToolError(CHANGE_NOT_EDITABLE);
    checkVersion(request.version, args.version);
    // The asker's phone alone (Phase 7, §4) changes nothing about the trip: the status stays, no re-approval, no push.
    const phoneOnly = Object.keys(args).every((k) => k === "request_id" || k === "version" || k === "requester_phone");
    const next: { status: string; event: "edited" | "changed"; needs_reapproval: boolean } = phoneOnly
      ? { status: request.status, event: "edited", needs_reapproval: false }
      : statusAfterEdit(request.status);

    // Phase 7 (§4): the first change after approval starts from the task as it is now (the office may have changed it).
    const stored = (await requestStopsOf(db, [request.id])).get(request.id) ?? [];
    const fromTask = request.status === "approved" && !phoneOnly ? await tripOfTask(db, request, now, stored.length > 0) : null;
    const base = fromTask?.request ?? request;
    const day = args.date ?? colomboDate(base.needed_at);
    // Phase 7 (§34): a request with its trip is planned again when its stops, start, day or time change.
    const tripRows = fromTask?.rows ?? stored;
    const tripEdit = args.stops !== undefined ||
      (tripRows.length > 0 &&
        (args.date !== undefined || args.time !== undefined || args.return_to_base !== undefined || args.avoid_expressway !== undefined));
    if (args.start && !args.stops) throw new ToolError("Give the stops together with the start.");
    const trip = tripEdit ? await replanRequest(db, now, base, tripRows, day, args) : null;
    const neededAt = trip ? trip.leaveBy : args.date || args.time ? utcIso(day, args.time ?? colomboTime(base.needed_at)) : base.needed_at;
    const backBy = args.back_by === null
      ? null
      : args.back_by
      ? utcIso(day, args.back_by)
      : base.back_by
      ? utcIso(day, colomboTime(base.back_by))
      : null;
    if (backBy && backBy <= neededAt) throw new ToolError("back_by must be later than time on the same day.");
    // Round 3: who drives, as now asked (self = the asker).
    const askedNow = askedOf(args, request.driven_by as Asked);
    const drives = checkAsked(
      askedNow,
      {
        driver_name: args.driver_name ?? (askedNow === "other" ? request.driver_name : null),
        driver_phone: args.driver_phone ?? (askedNow === "other" ? request.driver_phone : null),
      },
      (await loadSettings(db)).self_drive_allowed,
      { employeeId: request.requested_by_employee_id },
    );
    const driverRequired = drives.driver_required;

    const before = snapshot(base);
    const tripFrom = trip ? trip.stops[0].place_name : undefined;
    const tripTo = trip && trip.stops.length > 1 ? trip.stops[trip.stops.length - 1].place_name : undefined;
    const after: RequestFields = {
      needed_at: neededAt,
      back_by: backBy,
      route_from: tripFrom ?? args.route_from ?? base.route_from,
      route_to: trip ? tripTo ?? null : args.route_to ?? base.route_to,
      need_type: args.need_type === undefined ? request.need_type : args.need_type,
      pax: args.pax === undefined ? request.pax : args.pax,
      tools: args.tools ?? request.tools,
      note: args.note === undefined ? request.note : (args.note || null),
      driver_required: driverRequired,
      driven_by: drives.driven_by,
      driver_name: drives.driver_name,
      driver_phone: drives.driver_phone,
    };
    const changes = requestDiff(before, after);
    const onBehalfOf = args.on_behalf_of === undefined ? request.on_behalf_of : (args.on_behalf_of || null);
    if (onBehalfOf !== request.on_behalf_of) changes["for"] = { from: request.on_behalf_of, to: onBehalfOf };
    const requesterPhone = args.requester_phone === undefined ? request.requester_phone : (args.requester_phone || null);
    if (requesterPhone !== request.requester_phone) changes["phone"] = { from: request.requester_phone, to: requesterPhone };
    // Phase 7 (§17): the times at From and To.
    const fromDwell = args.from_dwell_min === undefined ? request.from_dwell_min : args.from_dwell_min;
    const toDwell = args.to_dwell_min === undefined ? request.to_dwell_min : args.to_dwell_min;
    const minText = (m: number | null) => (m == null ? null : duration(m));
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
        // Round 4–7 (6): who rides, in the same statement (the request's task too, in the database).
        ...passengerColumn(passengers),
        ...after,
        on_behalf_of: onBehalfOf,
        requester_phone: requesterPhone,
        from_dwell_min: fromDwell,
        to_dwell_min: toDwell,
        status: next.status,
        version: request.version + 1,
        // The request as approved, kept from the first change until it is decided again (the card's changes, and what
        // redecide_request applies: only what the requester changed). A phone alone keeps it as it is.
        ...(!phoneOnly && request.status !== "changed" && { previous: before as unknown as Json }),
        // The asker changed the trip itself: an approved booking's task takes the stops when decided again.
        ...(trip && { trip_edited_at: nowIso }),
        // A waiting request moved to another time is reminded afresh (30 minutes before, and once if it passes).
        ...(neededAt !== request.needed_at && next.status === "waiting" && { decide_reminder_sent_at: null, late_push_sent_at: null }),
        ...(!phoneOnly && next.status === "changed" && { changed_at: nowIso, changed_by: actor.name, change_note: diffText(changes) }),
      }).eq("id", request.id).eq("version", request.version).select("*"),
      "vehicle request",
    );
    if (rows.length === 0) throw new ToolError("Someone else changed this request just now. Reload it and try again.");
    if (trip) await saveRequestTrip(db, request.id, trip, now);
    else if (fromTask?.trip) await saveRequestTrip(db, request.id, fromTask.trip, now);
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
        request: await requestCardOf(db, trip || fromTask ? await getRequest(db, request.id) : rows[0], now),
        needs_reapproval: next.needs_reapproval,
        changes,
        next: next.needs_reapproval
          ? "The approvers were told; the booking keeps its old plan until they decide again (redecide_request)."
          : phoneOnly
          ? "The phone is saved."
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
    // Hotfix 2 (K): another approver decided it (or the person who asked changed it) since this one loaded it.
    if (request.version !== args.version && request.status !== "waiting") throw new ToolError(alreadyDecidedText(request, now, true));
    canRedecide(request.status);
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
      if (rows.length === 0) throw new ToolError(alreadyDecidedText(await getRequest(db, request.id), now, true));
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
        title: `Your changed request was declined by ${actor.name}`,
        who: actor.name,
        body: args.reason,
        url: `/requests/${request.id}`,
        tag: `request:${request.id}`,
      }, told);
      const vehicle = task.vehicle_id
        ? unwrapMaybe(
          await db.from("vehicles").select("reg_no, custodian_employee_id").eq("id", task.vehicle_id).maybeSingle(),
          "vehicle",
        )
        : null;
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

    // keep or change: the task takes what the requester changed since it was approved (the card's changes), plus the
    // approver's own changes. Everything else stays as the task has it now: the office's own edits are never undone.
    if (task.status === "completed" || task.status === "cancelled") {
      throw new ToolError(`The task behind this request is ${task.status}; decline the request or make a new booking.`);
    }
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const change = args.decision === "change";
    const asked = request.status === "changed" && request.previous
      ? requestDiff(request.previous as unknown as RequestFields, snapshot(request))
      : {};
    const askedLeave = asked[FIELD_LABEL.needed_at] ? request.needed_at : task.start_at;
    const day = change && args.date ? args.date : colomboDate(askedLeave);
    const startAt = change && (args.date || args.time)
      ? utcIso(day, args.time ?? colomboTime(askedLeave))
      : asked[FIELD_LABEL.needed_at]
      ? request.needed_at
      : undefined;
    const leaveDay = colomboDate(startAt ?? task.start_at);
    // Back-by stays at its clock time when the time moves (on the new day when the day moves): as asked, not shifted.
    const endBy = change && args.back_by === null
      ? null
      : change && args.back_by
      ? utcIso(leaveDay, args.back_by)
      : asked[FIELD_LABEL.back_by]
      ? (request.back_by ? utcIso(leaveDay, colomboTime(request.back_by)) : null)
      : startAt
      ? (task.end_by ? utcIso(leaveDay, colomboTime(task.end_by)) : null)
      : undefined;
    if (endBy && endBy <= (startAt ?? task.start_at)) throw new ToolError("back_by must be later than time on the same day.");
    // A new driver with no vehicle named takes the vehicle they hold today, else their regular one (Phase 7, §3). Hotfix 2
    // (J): "on the day" / "any van" clears the vehicle; a task without one keeps it so unless a vehicle is named.
    const word = change ? parseVehicleWord(args.vehicle) : null;
    if (word && !settings.vehicle_on_the_day) throw new ToolError(ON_THE_DAY_OFF);
    const current = task.vehicle_id ? refs.veh.get(task.vehicle_id) ?? null : null;
    if (task.vehicle_id && !current) throw new ToolError("The task's vehicle no longer exists.");
    // A vehicle named, or a new driver's own on a task with a set vehicle; otherwise (undefined) the task keeps its choice:
    // a vehicle chosen on the day stays so (a new driver confirms theirs at Start task).
    const named: Vehicle | null | undefined = word
      ? null
      : change && args.vehicle
      ? activeVehicle(refs, args.vehicle)
      : change && args.driver && task.vehicle_mode === "specific"
      ? defaultVehicleFor(refs, activeDriver(refs, args.driver))?.vehicle ?? undefined
      : undefined;
    const vehicle: Vehicle | null = named === undefined ? current : named;
    const shownVehicle = vehicle?.reg_no ??
      (word
        ? vehicleText(word.mode, word.mode === "any_type" ? word.type : null)
        : vehicleText(task.vehicle_mode, task.vehicle_type_wanted)) ??
      "the vehicle on the day";
    // Round 3: who drives. A driver named by the approver wins. Otherwise who drives changes only when the person who asked
    // changed it since it was approved (the previous version's "driver" line), or, on the old custodian path, when the
    // vehicle changed on a trip its custodian drives. The office's own choice (a driver given at approval, a reassignment)
    // is never undone (Checkpoint 3 review).
    const askedNow = request.driven_by as Asked;
    const requesterChangedWho = !!asked[FIELD_LABEL.driver_required];
    const whoChanged = askedNow === "custodian"
      ? task.driven_by === "self" && (vehicle?.id ?? null) !== task.vehicle_id
      : requesterChangedWho && askedNow !== "driver";
    if (!(change && args.driver) && requesterChangedWho && askedNow === "driver" && task.driven_by !== "driver") {
      throw new ToolError("The request now asks for a driver: decide with change and give one (driver).");
    }
    const whoDrives = change && args.driver
      ? pickWhoDrives(refs, args.driver, request, vehicle, settings.self_drive_allowed, actor)
      : whoChanged
      ? pickWhoDrives(refs, undefined, request, vehicle, settings.self_drive_allowed, actor)
      : null;
    const driver = whoDrives?.employee ?? refs.emp.get(task.employee_id);
    if (!driver) throw new ToolError("The task's driver no longer exists.");
    const drivesName = whoDrives ? whoDrives.driverName ?? driver.name : shownDriver(task, driver) ?? driver.name;

    // Phase 7 (§34): a trip the requester edited changes the task's stops through update_task_stops (below); a From or To
    // they changed (an older request, or the connector) through the route.
    const tripRows = (await requestStopsOf(db, [request.id])).get(request.id) ?? [];
    const decidedAt = request.decided_at;
    const tripEdited = tripRows.length > 0 && decidedAt !== null && request.trip_edited_at !== null && request.trip_edited_at > decidedAt;
    const routeAsked = !tripEdited && (asked[FIELD_LABEL.route_from] || asked[FIELD_LABEL.route_to]);
    const out = await changeTask(db, now, actor, task, {
      startAt,
      endBy,
      // Only a new choice of who drives goes to the task: otherwise it keeps its driver (or self-driver, or someone else).
      driver: whoDrives?.employee,
      who: whoDrives ? { drivenBy: whoDrives.drivenBy, driverName: whoDrives.driverName, driverPhone: whoDrives.driverPhone } : undefined,
      vehicle: named ?? undefined,
      vehicleMode: word ? { mode: word.mode, type: word.mode === "any_type" ? word.type : null } : undefined,
      passengers: asked[FIELD_LABEL.pax] ? request.pax : undefined,
      route: routeAsked ? routeOf(request) : undefined,
    }, {
      note: args.decision === "keep" ? "request decided again: kept" : "request decided again: changed",
      tellRequester: false,
      allowNoop: true,
    });
    const warnings = [...out.warnings, ...fitWarnings(vehicle, request)];

    // Phase 7 (§34): the trip edited since it was approved: the task takes its stops as update_task_stops does (the pending
    // ones replaced, planned again, the driver told what changed). A task under way keeps its stops. The request's stops
    // started from the task's when it was changed (update_request), so the office's stop edits are in them.
    if (tripEdited && out.task.status === "assigned") {
      const fields = tripFields(request, tripRows);
      // The approver's own time wins; else a time typed by the asker; else planned from the arrive-by times.
      const leave = change && args.time
        ? args.time
        : request.leave_by_source === "manual"
        ? colomboTime(startAt ?? out.task.start_at)
        : undefined;
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
    // The request keeps what its requester asked: its page says "Changed by the office · was …" when the approver moved
    // the time now (or the office changed the task of a request nobody edited). A requester's change taken as asked
    // takes the task's times, so a trip planned again (the same stops, a minute apart on the roads) is not shown as changed.
    const final = unwrap(await db.from("tasks").select("start_at, end_by, leave_by").eq("id", task.id).single(), "task");
    const neededAt = final.leave_by ?? final.start_at;
    const approverMoved = change && (args.date !== undefined || args.time !== undefined || args.back_by !== undefined);
    const asTask = request.status === "changed" && !approverMoved;
    const rows = unwrap(
      await db.from("vehicle_requests").update({
        status: "approved",
        ...(asTask && { needed_at: neededAt, back_by: final.end_by }),
        ...(asTask && request.leave_by !== null && { leave_by: neededAt }),
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
    if (rows.length === 0) throw new ToolError(alreadyDecidedText(await getRequest(db, request.id), now, true));
    const text = changesText(out.changes);
    await logRequestEvent(db, request.id, action, actor.name, {
      note: args.decision === "keep" ? (text ? `kept as asked: ${text}` : "kept as asked") : text || "changed",
      changes: Object.keys(out.changes).length ? out.changes : null,
      at: nowIso,
    });
    await notifyEvent(db, "request.redecided", {
      title: `${
        args.decision === "keep" ? "Your changed request was kept" : onlyTime ? "Your booking was postponed" : "Your booking was changed"
      } by ${actor.name}`,
      who: actor.name,
      body: [text || "as asked", `${shownVehicle} · ${drivesName} · ${colomboDayTime(neededAt)}`].join(" · "),
      url: `/requests/${request.id}`,
      tag: `request:${request.id}`,
    }, told);

    return {
      result: {
        request: await requestCardOf(db, rows[0], now),
        decision: action === "postponed" ? "postponed" : args.decision === "keep" ? "kept" : "changed",
        task: {
          task_id: task.id,
          when: colomboDayTime(final.start_at),
          until: final.end_by ? colomboTime(final.end_by) : undefined,
          driver: driver.name,
          vehicle: vehicle?.reg_no,
          vehicle_text: vehicle ? undefined : shownVehicle,
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
