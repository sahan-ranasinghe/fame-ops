// Tasks: create (with stops, the plan and warnings), plan without creating,
// change the stops of a task, the day's board, one task in detail, cancel,
// reassign.

import { z } from "zod";
import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { freeAt } from "../availability.ts";
import { driverRows } from "./driverRows.ts";
import { DECLINE_TEXT } from "../decline.ts";
export { DECLINE_TEXT };
import { basePoint, type Eta, taskEta } from "../eta.ts";
import {
  assignCheck,
  assignWarnings,
  type Conflict,
  type Employee,
  findDriver,
  findVehicle,
  isDriver,
  type Latest,
  loadLatest,
  loadRefs,
  nearestTown,
  odometerCheck,
  type Refs,
  sharing,
  type Task,
  type Vehicle,
} from "../fleet.ts";
import { centsToLkr, contactLinks, mapsDirections, mapsPoint, telLink, waLink } from "../format.ts";
import { GPS_KM_NOTE, haversineKm, type Point, summariseRoute } from "../geo.ts";
import { PHOTO_LINK_NOTE, photoLinks, photoOrNote } from "../photos.ts";
import { videoCard, videoLinks } from "../videos.ts";
import {
  legSequence,
  type Plan,
  type PlanInput,
  type PlanPoint,
  type PlanStop,
  planTask as runPlanner,
  type StopType,
  type What,
} from "../plan.ts";
import { estimateLegFn, googleLegs, legFnFor, memoLegFn, providerFromEnv } from "../routing.ts";
import { googleUse } from "../google.ts";
import { notifyEvent } from "../notifications.ts";
import type { Actor } from "../roles.ts";
import { loadSettings, type Settings } from "../settings.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime } from "../tool.ts";
import { endOfDay, type GooglePin, googlePin } from "../googlePlaces.ts";
import { findPlace, placeById } from "./places.ts";
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

/** The vehicle a task gets when only the driver is named (Phase 7, §3): the one they hold today, else their regular one. */
export function defaultVehicleFor(refs: Refs, driver: Employee): { vehicle: Vehicle; why: string } | null {
  const first = driver.name.split(" ")[0];
  const today = driver.current_vehicle_id ? refs.veh.get(driver.current_vehicle_id) : undefined;
  if (today?.active) return { vehicle: today, why: `${first}'s vehicle today` };
  const regular = refs.vehicles.find((v) => v.active && v.regular_driver_id === driver.id);
  return regular ? { vehicle: regular, why: `${first}'s regular vehicle` } : null;
}

/** What the office chose against the default, kept on the task: "Vehicle changed by Palitha: WP X instead of Kamal's Axio". */
export interface VehicleChoice {
  default_vehicle_id: string;
  default_reg_no: string;
  why: string;
  chosen_vehicle_id: string;
  chosen_reg_no: string;
  by: string;
  at: string;
}

/** The vehicle for a driver: as typed, else the default; and the choice when it differs from the default. */
export function pickVehicle(refs: Refs, driver: Employee, typed: string | undefined, by: string, now: Date) {
  const fallback = defaultVehicleFor(refs, driver);
  if (!typed) {
    if (!fallback) {
      throw new ToolError(`Pick a vehicle: ${driver.name} holds none today and has no regular vehicle.`);
    }
    return { vehicle: fallback.vehicle, why: fallback.why, choice: null as VehicleChoice | null };
  }
  const vehicle = activeVehicle(refs, typed);
  const choice: VehicleChoice | null = fallback && fallback.vehicle.id !== vehicle.id
    ? {
      default_vehicle_id: fallback.vehicle.id,
      default_reg_no: fallback.vehicle.reg_no,
      why: fallback.why,
      chosen_vehicle_id: vehicle.id,
      chosen_reg_no: vehicle.reg_no,
      by,
      at: now.toISOString(),
    }
    : null;
  return { vehicle, why: fallback?.vehicle.id === vehicle.id ? fallback.why : "chosen", choice };
}

/** "Vehicle changed by Palitha: WP CAB-4521 instead of Kamal's regular vehicle WP KL-1234". */
export function vehicleChoiceText(choice: unknown): string | undefined {
  const c = choice as Partial<VehicleChoice> | null;
  if (!c?.chosen_reg_no) return undefined;
  return `Vehicle changed by ${c.by ?? "the office"}: ${c.chosen_reg_no} instead of ${c.why ?? "the default"} ${c.default_reg_no ?? ""}`
    .trim();
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
  place_id: zId.optional().describe("A place picked with search_places (wins over place)"),
  google_place_id: zText(300).optional().describe(
    "A Google place picked with search_places (google) and google_place: its pin is Google's (kept 30 days); give its name as place",
  ),
  place: zText(160).optional().describe("A saved place name or site id, a town, or free text"),
  address: zText(240).optional(),
  lat: zLat.optional(),
  lng: zLng.optional(),
  dwell_min: z.number().int().min(0).max(1440).optional().describe("Minutes at the stop. Default: the fleet setting for the type and what"),
  arrive_by: zArriveBy.optional().describe("Deadline: HH:MM on the task's day, or an ISO time"),
  note: zText(300).optional().describe("A line for the driver about this stop"),
});
export const zStops = z.array(zStop).min(1).max(12);
export const zStart = z.object({
  place_id: zId.optional().describe("A place picked with search_places"),
  google_place_id: zText(300).optional().describe("A Google place picked with search_places (google); give its name as place"),
  place: zText(160).optional(),
  address: zText(240).optional(),
  lat: zLat.optional(),
  lng: zLng.optional(),
  passengers: z.boolean().optional().describe(
    "Passengers get in at the start: it becomes Stop 1, a pickup there (no leg to it; marked arrived when the task starts)",
  ),
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
  /** Where the pin came from: a saved place, a town centre, the given lat/lng, a Google place, or none. */
  pin_from: "place" | "town" | "given" | "google" | null;
  planned_arrive_at?: string;
  planned_depart_at?: string;
  /** Phase 7 (§11): the pickup at the start ("Passengers get in here"). */
  is_start: boolean;
  /** Phase 7 (§17): where the time at the stop came from: chosen, the place's usual time, or the default by type. */
  dwell_source: DwellSource;
}

export type DwellSource = "chosen" | "place" | "default";

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
    if (s.google_place_id && !s.place_id) {
      const pin = await pinForTask(db, s.google_place_id, day);
      out.push({
        seq: firstSeq + i,
        type: s.type,
        what: s.what ?? null,
        place_id: null,
        place_name: typed || pin.short_address || pin.address || `Stop ${i + 1}`,
        address: pin.address,
        lat: pin.lat,
        lng: pin.lng,
        dwell_min: s.dwell_min ?? null,
        arrive_by: arriveByIso(day, s.arrive_by),
        note: s.note ?? null,
        pin_from: "google",
        is_start: false,
        dwell_source: s.dwell_min != null ? "chosen" : "default",
      });
      continue;
    }
    if (!s.place_id && !typed && (s.lat === undefined || s.lng === undefined)) {
      throw new ToolError(`Stop ${i + 1}: give a place, an address or lat and lng.`);
    }
    if ((s.lat === undefined) !== (s.lng === undefined)) throw new ToolError(`Stop ${i + 1}: give both lat and lng, or neither.`);
    const place = s.place_id ? await placeById(db, s.place_id) : typed ? await findPlace(db, typed) : null;
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
      // The time at the stop: as given, else the place's usual time (the last one used there), else the default.
      dwell_min: s.dwell_min ?? place?.usual_dwell_min ?? null,
      arrive_by: arriveByIso(day, s.arrive_by),
      note: s.note ?? null,
      pin_from: pinFrom,
      is_start: false,
      dwell_source: s.dwell_min != null ? "chosen" : place?.usual_dwell_min != null ? "place" : "default",
    });
  }
  return out;
}

/**
 * A Google place's pin for a task on `day`: the kept one when it lasts past the day, else one counted
 * Place Details call; refused (a cap, no key) = the stop cannot be placed on Google's pin, said plainly.
 */
async function pinForTask(db: Db, googlePlaceId: string, day: string): Promise<GooglePin> {
  const settings = await loadSettings(db);
  const now = new Date();
  const got = await googlePin(db, settings, googlePlaceId, { until: endOfDay(day), now });
  if ("note" in got) {
    throw new ToolError(`${got.note}. Pick one of our places, paste a pin or type the address instead.`);
  }
  return got.pin;
}

/** The start place: the given one (saved place, Google place, town or pin), else the base place, else none. */
export async function resolveStart(
  db: Db,
  settings: Settings,
  start: z.infer<typeof zStart> | undefined,
  day?: string,
): Promise<ResolvedStart | null> {
  if (start?.google_place_id && !start.place_id) {
    const pin = await pinForTask(db, start.google_place_id, day ?? colomboDate(new Date()));
    return { place_id: null, name: (start.place ?? "").trim() || pin.short_address || pin.address || "Start", lat: pin.lat, lng: pin.lng };
  }
  if (start && (start.place_id || start.place || start.address || start.lat !== undefined)) {
    const typed = (start.place ?? start.address ?? "").trim();
    const place = start.place_id ? await placeById(db, start.place_id) : typed ? await findPlace(db, typed) : null;
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
    at_start: s.is_start,
  }));
  const startPoint = p.origin ?? point(p.start);
  const input: PlanInput = {
    now: p.now.toISOString(),
    start: startPoint ? { name: p.start?.name ?? "here", point: startPoint } : null,
    base: base ? { name: base.name, point: base.point } : null,
    stops,
    return_to_base: p.returnToBase,
    avoid_expressway: p.avoidExpressway,
    leave_at: p.leaveAt,
    buffer_min: p.bufferMin,
  };
  const open = legFnFor(db, settings);
  const points = legSequence(input);
  let plan: Plan;
  let googleNote: string | undefined;
  if (googleUse(settings).routes && points.length >= 2) {
    // A rough pass on the estimate (no calls) finds when the trip leaves; one Google call then
    // answers every leg at that time, and the planner's passes read those legs.
    const rough = await runPlanner(input, settings, estimateLegFn(settings));
    const departAt = new Date(rough.leave_by).getTime() > p.now.getTime() ? rough.leave_by : p.now.toISOString();
    const got = await googleLegs(db, settings, points, departAt, { avoid_expressway: p.avoidExpressway }, p.now);
    if ("legs" in got) {
      plan = await runPlanner(input, settings, memoLegFn(got.legs, open));
    } else {
      googleNote = got.note;
      plan = await runPlanner(input, settings, open);
    }
  } else {
    plan = await runPlanner(input, settings, open);
  }
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
      provider: plan.legs.some((l) => l.source === "google") ? "google" : providerFromEnv(Deno.env.get("ROUTING_PROVIDER")),
      ...(googleNote ? { google_note: googleNote } : {}),
    },
  };
}

const SOURCE_LABEL: Record<string, string> = {
  ors: "road time · OpenRouteService",
  google: "road time · Google traffic",
  estimate: "estimate — no routing key",
};

/** The plan as the office reads it. */
export function planSummary(plan: Plan | null | undefined, stopNames: Map<number, string>) {
  if (!plan || !Array.isArray(plan.legs)) return undefined;
  const sources = new Set(plan.legs.map((l) => l.source));
  const source = sources.has("google") ? "google" : sources.has("ors") ? "ors" : "estimate";
  const googleNote = (plan as Partial<StoredPlan>).settings_used?.google_note;
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
    google_note: typeof googleNote === "string" ? googleNote : undefined,
  };
}

const STOP_TYPE: Record<string, string> = { pickup: "Pickup", drop: "Drop", visit: "Visit" };

/** One item of the plan as a timeline (Phase 7, §17): the leave time, each stop with its time there, each leg. */
export type TimelineItem =
  | { kind: "leave"; at: string; source: string }
  | {
    kind: "stop";
    n: number;
    label: string;
    place: string;
    planned_arrive: string;
    planned_leave: string;
    arrive_by?: string;
    late_min?: number;
    dwell_min: number;
    dwell_source?: string;
    is_start?: boolean;
  }
  | {
    kind: "leg";
    from_n: number | "start";
    to_n: number | "base";
    km: number;
    minutes: number;
    source: string;
    rush_factor?: number;
    via_expressway?: boolean;
  };

/** The plan as a timeline: leave, then each leg and stop in order, then the totals. */
export function planTimeline(
  plan: Plan | null | undefined,
  stops: { seq: number; type: string; place_name: string; dwell_source?: string | null; is_start?: boolean }[],
) {
  if (!plan || !Array.isArray(plan.legs)) return undefined;
  const order = new Map(stops.map((st, i) => [st.seq, i + 1]));
  const items: TimelineItem[] = [{ kind: "leave", at: colomboTime(plan.leave_by), source: plan.leave_by_source }];
  const legTo = new Map(plan.legs.filter((l) => l.to_seq !== -1).map((l) => [l.to_seq, l]));
  const legItem = (l: Plan["legs"][number]): TimelineItem => ({
    kind: "leg",
    from_n: l.from_seq === 0 ? "start" : order.get(l.from_seq) ?? l.from_seq,
    to_n: l.to_seq === -1 ? "base" : order.get(l.to_seq) ?? l.to_seq,
    km: l.km,
    minutes: Math.round(l.minutes),
    source: l.source,
    rush_factor: l.factor !== 1 ? l.factor : undefined,
    via_expressway: l.via_expressway ?? undefined,
  });
  for (const st of stops) {
    const planned = plan.stops.find((x) => x.seq === st.seq);
    const leg = legTo.get(st.seq);
    if (leg) items.push(legItem(leg));
    if (!planned) continue;
    const n = order.get(st.seq)!;
    items.push({
      kind: "stop",
      n,
      label: stopLabel(n, st),
      place: st.place_name,
      planned_arrive: colomboTime(planned.planned_arrive_at),
      planned_leave: colomboTime(planned.planned_depart_at),
      arrive_by: planned.arrive_by ? colomboTime(planned.arrive_by) : undefined,
      late_min: planned.slack_min !== null && planned.slack_min < 0 ? -planned.slack_min : undefined,
      dwell_min: planned.dwell_min,
      dwell_source: st.dwell_source ?? undefined,
      is_start: st.is_start ? true : undefined,
    });
  }
  const back = plan.legs.find((l) => l.to_seq === -1);
  if (back) items.push(legItem(back));
  return {
    items,
    totals: { drive_min: plan.total_drive_min, km: plan.total_km, ends: colomboTime(plan.ends_at) },
  };
}

/** "Stop 2 · Drop · Kurunegala site": stops are named by their place in the order (Phase 7, §11), never by seq. */
export function stopLabel(n: number, s: { type: string; place_name: string }): string {
  return `Stop ${n} · ${STOP_TYPE[s.type] ?? s.type} · ${s.place_name}`;
}

function stopCard(s: ResolvedStop | TaskStop, i?: number) {
  return {
    n: i !== undefined ? i + 1 : undefined,
    label: i !== undefined ? stopLabel(i + 1, s) : undefined,
    is_start: s.is_start ? true : undefined,
    dwell_source: s.dwell_source ?? undefined,
    planned_leave: s.planned_depart_at ? colomboTime(s.planned_depart_at) : undefined,
    seq: s.seq,
    type: s.type,
    what: s.what ?? undefined,
    place: s.place_name,
    place_id: s.place_id ?? undefined,
    address: s.address ?? undefined,
    note: s.note ?? undefined,
    dwell_min: s.dwell_min ?? undefined,
    arrive_by: s.arrive_by ? colomboTime(s.arrive_by) : undefined,
    planned_arrive: s.planned_arrive_at ? colomboTime(s.planned_arrive_at) : undefined,
    planned_depart: s.planned_depart_at ? colomboTime(s.planned_depart_at) : undefined,
    lat: s.lat ?? undefined,
    lng: s.lng ?? undefined,
    pin: "pin_from" in s ? s.pin_from ?? "none" : s.lat != null ? "yes" : "none",
    // A Google place: its pin is drawn on Google's map only (listed, not drawn, anywhere else).
    google: ("pin_from" in s && s.pin_from === "google") || ("google_place_id" in s && !!s.google_place_id) ? true : undefined,
    google_place_id: "google_place_id" in s ? s.google_place_id ?? undefined : undefined,
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
  /** Set when the task comes from approving a vehicle request (id), or books one in the same transaction (create). */
  request?: { id: string; decidedBy: string | null } | { create: BookingRequest; decidedBy: string | null };
  /** The person booking (employee id), so a custodian is not told about their own booking. */
  bookedBy?: string | null;
  /** Phase 7: the vehicle chosen against the default, the warnings saved past, who assigned it (told when it needs a driver). */
  vehicleChoice?: VehicleChoice | null;
  savedWarnings?: string[];
  assignedBy?: string | null;
  /** The vehicle used and why ("Kamal's vehicle today", "chosen"). */
  vehicleWhy?: string;
}

/** The vehicle_requests row office_book_vehicle inserts before the task (one transaction). */
export interface BookingRequest {
  requested_by_name: string;
  requested_by_employee_id: string | null;
  requested_by_user_id: string | null;
  project_id: string | null;
  project_label: string | null;
  needed_at: string;
  back_by: string | null;
  route_from: string | null;
  route_to: string | null;
  need_type: string | null;
  pax: number | null;
  tools: boolean;
  note: string | null;
  driver_required: boolean;
  on_behalf_of: string | null;
  /** Phase 7 (§17): the times at From and To. */
  from_dwell_min: number | null;
  to_dwell_min: number | null;
}

const stopRow = (s: ResolvedStop) => ({
  is_start: s.is_start,
  dwell_source: s.dwell_source,
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
  const taskJson = {
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
    vehicle_choice: (t.vehicleChoice ?? null) as unknown as Json,
    warnings:
      (t.savedWarnings?.length
        ? t.savedWarnings.map((text) => ({ text, by: t.createdBy ?? "the office", at: new Date().toISOString() }))
        : null) as unknown as Json,
    assigned_by_employee_id: t.assignedBy ?? null,
  };
  let taskId: string;
  let requestId: string | undefined;
  if (t.request && "create" in t.request) {
    const booked = unwrap(
      await db.rpc("office_book_vehicle", {
        p_request: t.request.create as unknown as Json,
        p_task: taskJson,
        p_stops: t.stops.map(stopRow),
        p_projects: t.split.rows,
        p_decided_by: t.request.decidedBy ?? undefined,
      }),
      "booking",
    ) as { request_id: string; task_id: string };
    taskId = booked.task_id;
    requestId = booked.request_id;
  } else {
    taskId = unwrap(
      await db.rpc("office_create_task", {
        p_task: taskJson,
        p_stops: t.stops.map(stopRow),
        p_projects: t.split.rows,
        p_request_id: t.request?.id,
        p_decided_by: t.request?.decidedBy ?? undefined,
      }),
      "task",
    );
  }

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

  // The vehicle's custodian hears about the booking (not when they booked it themselves).
  if (t.vehicle.custodian_employee_id) {
    await notifyEvent(db, "vehicle.booked", {
      title: `${t.vehicle.reg_no} booked · ${colomboDayTime(t.startAt)}`,
      body: [t.createdBy ?? "the office", `${first.place_name} → ${last.place_name}`].join(" · "),
      url: `/tasks?task=${taskId}`,
      tag: `task:${taskId}`,
    }, { actor: t.bookedBy ?? null, custodian: t.vehicle.custodian_employee_id });
  }

  return {
    result: {
      task_id: taskId,
      request_id: requestId,
      title: t.title,
      when: colomboDayTime(t.startAt),
      until: t.endBy ? colomboTime(t.endBy) : undefined,
      leave_by: colomboDayTime(t.leaveBy),
      leave_by_source: t.leaveBySource,
      driver: t.driver.name,
      vehicle: t.vehicle.reg_no,
      vehicle_used: t.vehicleWhy ? { reg_no: t.vehicle.reg_no, why: t.vehicleWhy } : undefined,
      vehicle_changed: vehicleChoiceText(t.vehicleChoice),
      pickup: first.place_name,
      dropoff: t.stops.length > 1 ? last.place_name : undefined,
      stops: t.stops.map(stopCard),
      plan: planSummary(t.plan, names),
      timeline: planTimeline(t.plan, t.stops),
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
  let stops = await resolveStops(db, args.day, args);
  const start = await resolveStart(db, settings, args.start, args.day);
  const notes: string[] = [];
  if (args.start?.passengers) {
    // "Passengers get in here": the start becomes Stop 1, a pickup there (no leg to it).
    if (!start) throw new ToolError("Passengers get in at the start: give a start place (or set the base place in Settings).");
    stops = [await startStop(db, start), ...stops.map((st) => ({ ...st, seq: st.seq + 1 }))];
  } else if (start && stops[0]?.type === "pickup" && samePlace(start, stops[0])) {
    notes.push(
      `Same as the start: Stop 1 (${
        stops[0].place_name
      }) is a pickup where the trip starts. Tick "Passengers get in here" instead (start.passengers: true).`,
    );
  }
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
  return { stops, start, plan, leaveBy: plan.leave_by, leaveBySource: plan.leave_by_source, notes };
}

/** Stop 1 at the start place: a pickup of people, with the place's usual time. */
export async function startStop(db: Db, start: ResolvedStart, seq = 1): Promise<ResolvedStop> {
  const place = start.place_id ? await placeById(db, start.place_id) : null;
  const usual = place?.usual_dwell_min ?? null;
  return {
    seq,
    type: "pickup",
    what: "people",
    place_id: start.place_id,
    place_name: start.name,
    address: place?.address ?? null,
    lat: start.lat,
    lng: start.lng,
    dwell_min: usual,
    arrive_by: null,
    note: null,
    pin_from: start.lat != null ? "place" : null,
    is_start: true,
    dwell_source: usual != null ? "place" : "default",
  };
}

/** The same place: the same saved place, or pins within 50 m (cars kept in the office basement). */
export function samePlace(a: { place_id: string | null; lat: number | null; lng: number | null }, b: ResolvedStop): boolean {
  if (a.place_id && a.place_id === b.place_id) return true;
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  return haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) * 1000 <= 50;
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

function statusLine(task: Task, latest: Latest | undefined, now: Date, employee?: Employee): string {
  switch (task.status) {
    case "assigned":
      if (employee && !isDriver(employee)) return `Driven by ${employee.name} (custodian · no app)`;
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
    vehicle: zText(20).optional().describe("Vehicle plate. Default: the vehicle the driver holds today, else their regular vehicle"),
    ...planFields,
    passengers: z.number().int().min(0).max(80).optional(),
    contact_name: zText(120).optional().describe("Person the driver can call"),
    contact_phone: zText(30).optional(),
    notes: zText(1000).optional(),
    label: zText(40).optional().describe('Short label on the task card, e.g. "Mobitel MS". Default: the project short name'),
    projects: zSplit.optional(),
    created_by: zText(80).optional().describe("Name of the office user assigning the task, if known"),
  }),
  async run(args, { db, now, actor }) {
    realDate(args.date);
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const driver = activeDriver(refs, args.driver);
    const picked = pickVehicle(refs, driver, args.vehicle, args.created_by ?? actor.name, now);
    const vehicle = picked.vehicle;
    const typed = args.leave_by ?? args.start_time;
    const prepared = await prepareTask(db, settings, now, { day: args.date, ...args, leaveAt: typed ? utcIso(args.date, typed) : null });
    const startAt = prepared.leaveBy;
    const endBy = args.end_time ? utcIso(args.date, args.end_time) : null;
    if (endBy && endBy <= startAt) throw new ToolError("end_time must be later than the leave-by time on the same day.");

    const split = await resolveSplit(db, args.projects);
    const { warnings, conflicts } = await assignCheck(db, { driver, vehicle, startAt, endBy });
    warnings.push(...prepared.plan.warnings.map((w) => w.text), ...prepared.notes);
    if (new Date(startAt) < now) warnings.push("The leave-by time is already in the past.");

    const saved = await saveTask(db, {
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
      createdBy: args.created_by ?? actor.name,
      bookedBy: actor.employeeId,
      vehicleChoice: picked.choice,
      savedWarnings: warnings,
      assignedBy: actor.employeeId,
      vehicleWhy: picked.why,
    }, warnings);
    return { ...saved, result: { ...saved.result, conflicts: conflicts.length ? conflicts : undefined } };
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
  async run(args, { db, now, actor }) {
    realDate(args.date);
    const settings = await loadSettings(db);
    const prepared = await prepareTask(db, settings, now, {
      day: args.date,
      ...args,
      leaveAt: args.leave_by ? utcIso(args.date, args.leave_by) : null,
    });
    const warnings = [...prepared.plan.warnings.map((w) => w.text), ...prepared.notes];
    let conflicts: Conflict[] = [];
    let vehicleUsed: { reg_no: string; why: string } | undefined;
    if (args.driver) {
      const refs = await loadRefs(db);
      const driver = activeDriver(refs, args.driver);
      // With a driver and no vehicle, the default one (the driver's today, else the regular one), as saving would use.
      const vehicle = args.vehicle ? activeVehicle(refs, args.vehicle) : defaultVehicleFor(refs, driver)?.vehicle;
      if (vehicle) {
        vehicleUsed = { reg_no: vehicle.reg_no, why: pickVehicle(refs, driver, vehicle.reg_no, actor.name, now).why };
        const check = await assignCheck(db, {
          driver,
          vehicle,
          startAt: prepared.leaveBy,
          endBy: args.end_time ? utcIso(args.date, args.end_time) : null,
        });
        warnings.push(...check.warnings);
        conflicts = check.conflicts;
      }
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
        timeline: planTimeline(prepared.plan, prepared.stops),
        warnings,
        conflicts: conflicts.length ? conflicts : undefined,
        vehicle_used: vehicleUsed,
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
    let stops = await resolveStops(db, day, { stops: args.stops }, nextSeq);
    const start = args.start
      ? await resolveStart(db, settings, args.start, day)
      : (task.start_name
        ? { place_id: task.start_place_id, name: task.start_name, lat: task.start_lat, lng: task.start_lng }
        : await resolveStart(db, settings, undefined));
    const returnToBase = args.return_to_base ?? task.return_to_base;
    const avoidExpressway = args.avoid_expressway ?? task.avoid_expressway;
    const running = task.status === "in_progress";
    const notes: string[] = [];
    // "Passengers get in here" on a task not under way: the start becomes the first stop (no arrived stop before it).
    if (args.start?.passengers && start && kept.length === 0 && !running) {
      stops = [await startStop(db, start, nextSeq), ...stops.map((st) => ({ ...st, seq: st.seq + 1 }))];
    } else if (args.start?.passengers) {
      notes.push("Passengers get in at the start only on a task not under way: the stops were saved without it.");
    } else if (start && kept.length === 0 && stops[0]?.type === "pickup" && samePlace(start, stops[0])) {
      notes.push(
        `Same as the start: Stop 1 (${stops[0].place_name}) is a pickup where the trip starts. Tick "Passengers get in here" instead.`,
      );
    }

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
        stops: [...kept, ...stops].map((st, i) => stopCard(st, i)),
        plan: planSummary(plan, names),
        timeline: planTimeline(plan, [...kept, ...stops]),
        warnings: [...plan.warnings.map((w) => w.text), ...notes],
        sent: "The driver's app shows the new stops (Task changed).",
      },
      summary: `task ${task.id}: stops replaced (version ${version}), ${stops.length} new, ${kept.length} kept`,
    };
  },
});

/**
 * Tasks that need a driver (Phase 7, §19): declined, or not accepted within the accept window, today and later, the
 * soonest first, each with the best match for its time and first stop. task_board and fleet_overview list them first.
 */
export async function needsDriverList(db: Db, refs: Refs, now: Date) {
  const rows = unwrap(
    await db.from("tasks").select("*").not("needs_driver_since", "is", null).in("status", ["assigned", "declined"])
      .gte("start_at", dayRange(colomboDate(now)).from).order("start_at"),
    "tasks",
  );
  const firstStops = rows.length
    ? unwrap(
      await db.from("task_stops").select("task_id, seq, lat, lng, place_name").in("task_id", rows.map((t) => t.id)).neq("status", "removed")
        .order("seq"),
      "stops",
    )
    : [];
  return await Promise.all(rows.map(async (t) => {
    const leave = t.leave_by ?? t.start_at;
    const minutes = Math.round((new Date(leave).getTime() - now.getTime()) / 60000);
    const who = refs.emp.get(t.employee_id)?.name ?? "The driver";
    const declined = t.needs_driver_reason === "declined";
    const reason = declined ? DECLINE_TEXT[t.declined_reason ?? ""] ?? t.declined_reason ?? "no reason given" : "not accepted in time";
    const first = firstStops.find((st) => st.task_id === t.id && st.lat != null && st.lng != null);
    const day = colomboDate(leave);
    const { best } = await driverRows(
      db,
      refs,
      { from: leave, to: t.end_by, day_end: dayRange(day).to },
      now,
      first ? { lat: first.lat!, lng: first.lng! } : null,
      t.employee_id,
    );
    return {
      task_id: t.id,
      start: day === colomboDate(now) ? colomboTime(leave) : colomboDayTime(leave),
      title: t.title,
      driver: who,
      kind: t.needs_driver_reason as "declined" | "not_accepted",
      reason_text: declined ? reason : "Not accepted in time",
      note: t.declined_note ?? undefined,
      line: `${who.split(" ")[0]} ${declined ? "declined" : "hasn't accepted"} · ${declined ? reason : "needs a driver"}`,
      since: t.needs_driver_since ? colomboTime(t.needs_driver_since) : undefined,
      minutes_to_start: minutes,
      when: minutes >= 0 ? `in ${minutes} min` : `${-minutes} min late`,
      best,
    };
  }));
}

export const taskBoard = tool({
  name: "task_board",
  title: "Task board",
  description: "Tasks that need a driver first (needs_driver: declined, or not accepted within the accept window, today and later, " +
    "with the reason, minutes to the start and the best free driver), then the day's tasks in four columns (assigned, in progress, " +
    "completed, declined = needs a driver) with status lines such as " +
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
        status: statusLine(t, latest.get(t.employee_id), now, refs.emp.get(t.employee_id)),
        eta_next: eta?.next_eta_at ? colomboTime(eta.next_eta_at) : undefined,
        eta_final: eta?.final_eta_at ? colomboTime(eta.final_eta_at) : undefined,
        late_min: eta && eta.late_min > 0 ? eta.late_min : undefined,
        finish_flag: finishFlagText(t.finish_flag),
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
    const needsDriver = await needsDriverList(db, refs, now);

    return {
      result: {
        // Phase 7 (§19): first, the tasks that need a driver (today and later, not only this day).
        needs_driver: needsDriver.length ? needsDriver : undefined,
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
    const [refs, latest, settings, stopsRes, splitRes, odoRes, fuelRes, reportsRes, eventsRes, segmentsRes] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      loadSettings(db),
      db.from("task_stops").select("*").eq("task_id", task.id).order("seq"),
      db.from("task_projects").select("*").eq("task_id", task.id),
      db.from("odometer_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("fuel_logs").select("*").eq("task_id", task.id).order("logged_at"),
      db.from("vehicle_reports").select("*").eq("task_id", task.id).order("created_at"),
      db.from("task_assignment_events").select("*").eq("task_id", task.id).order("at").order("id"),
      db.from("task_vehicle_segments").select("*").eq("task_id", task.id).order("seq"),
    ]);
    const events = unwrap(eventsRes, "assignment history");
    const segments = unwrap(segmentsRes, "vehicle segments");
    const allStops = unwrap(stopsRes, "stops");
    const stops = live(allStops);
    const removed = allStops.filter((s) => s.status === "removed");
    // Part 5b: a reached stop saved as one of our places (its name), and the town near each arrival point.
    const savedIds = [...new Set(stops.map((s) => s.saved_place_id).filter((x): x is string => !!x))];
    const savedNames = new Map(
      savedIds.length
        ? unwrap(await db.from("places").select("id, name").in("id", savedIds), "saved places").map((p) => [p.id, p.name])
        : [],
    );
    const arrivalNear = new Map<string, string | null>();
    for (const st of stops) {
      if (st.arrival_lat != null && st.arrival_lng != null) arrivalNear.set(st.id, await nearestTown(db, st.arrival_lat, st.arrival_lng));
    }
    const split = unwrap(splitRes, "project split");
    const odometer = unwrap(odoRes, "odometer logs");
    const fuel = unwrap(fuelRes, "fuel logs");
    const reports = unwrap(reportsRes, "vehicle reports");

    const projectIds = split.flatMap((row) => row.project_id ? [row.project_id] : []);
    const [projectsRes, links, request, unlogged, gps, eta, videos] = await Promise.all([
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
      videoLinks(db, fuel),
    ]);
    const projects = new Map(unwrap(projectsRes, "projects").map((p) => [p.id, p]));
    const requestRow = unwrapMaybe(request, "vehicle request");
    // Phase 7: when Start task took the vehicle from another driver, "WP CAB-4521 taken over from Nuwan 08:40".
    const startTake = unwrapMaybe(
      await db.from("vehicle_assignments").select("vehicle_id, from_at").eq("task_id", task.id).eq("how", "task_start").order("from_at")
        .limit(1).maybeSingle(),
      "vehicle hand-over",
    );
    const takenFrom = startTake
      ? unwrapMaybe(
        await db.from("vehicle_assignments").select("employee_id").eq("vehicle_id", startTake.vehicle_id).eq("ended_how", "taken_over")
          .eq("to_at", startTake.from_at).neq("employee_id", task.employee_id).limit(1).maybeSingle(),
        "vehicle hand-over",
      )
      : null;
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
          status_line: statusLine(task, latest.get(task.employee_id), now, driver),
          start: colomboDayTime(task.start_at),
          // The day and clock as the edit form needs them.
          date: colomboDate(task.start_at),
          time: colomboTime(task.start_at),
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
          finish_flag: finishFlagText(task.finish_flag),
          // Phase 7: the vehicle chosen against the default, the warnings saved past, and whether it needs a driver.
          vehicle_changed: vehicleChoiceText(task.vehicle_choice),
          warnings_saved: Array.isArray(task.warnings)
            ? (task.warnings as { text?: string; by?: string }[]).map((w) => w.by ? `${w.text} (saved by ${w.by})` : w.text ?? "")
            : undefined,
          needs_driver: task.needs_driver_since
            ? {
              since: colomboDateTime(task.needs_driver_since),
              reason: task.needs_driver_reason ?? undefined,
              reason_text: task.needs_driver_reason === "declined"
                ? DECLINE_TEXT[task.declined_reason ?? ""] ?? task.declined_reason ?? undefined
                : "Not accepted in time",
            }
            : undefined,
          // Reopen (reopen_task): a task completed today, Colombo time.
          can_reopen: task.status === "completed" && !!task.completed_at && colomboDate(task.completed_at) === colomboDate(now)
            ? true
            : undefined,
          vehicle_taken: takenFrom && startTake
            ? `${vehicle?.reg_no ?? "The vehicle"} taken over from ${refs.emp.get(takenFrom.employee_id)?.name ?? "another driver"} ${
              colomboTime(startTake.from_at)
            }`
            : undefined,
        },
        plan: planSummary(task.plan_json as Plan | null, names),
        timeline: planTimeline(task.plan_json as Plan | null, stops),
        // Phase 7: a vehicle swap during the task keeps each vehicle's stretch; task km = their sum.
        segments: segments.length
          ? segments.map((g) => ({
            vehicle: refs.veh.get(g.vehicle_id)?.reg_no,
            from: colomboTime(g.from_at),
            to: g.to_at ? colomboTime(g.to_at) : undefined,
            start_km: g.start_odometer_km ?? undefined,
            end_km: g.end_odometer_km ?? undefined,
            km: g.start_odometer_km != null && g.end_odometer_km != null ? g.end_odometer_km - g.start_odometer_km : undefined,
            readings_waiting: g.start_odometer_km == null || (g.to_at != null && g.end_odometer_km == null) ? true : undefined,
            reason: g.reason ?? undefined,
            by: g.by_name ?? undefined,
          }))
          : undefined,
        stops: stops.map((s, i) => ({
          id: s.id,
          ...stopCard(s, i),
          // Phase 7 (§17): the time at the stop, planned against what happened (Arrived → Done).
          planned_stay: s.planned_arrive_at && s.planned_depart_at
            ? {
              arrive: colomboTime(s.planned_arrive_at),
              leave: colomboTime(s.planned_depart_at),
              minutes: Math.round((new Date(s.planned_depart_at).getTime() - new Date(s.planned_arrive_at).getTime()) / 60000),
            }
            : undefined,
          actual_stay: s.arrived_at
            ? {
              arrived: colomboTime(s.arrived_at),
              done: s.done_at ? colomboTime(s.done_at) : undefined,
              minutes: s.done_at ? Math.round((new Date(s.done_at).getTime() - new Date(s.arrived_at).getTime()) / 60000) : undefined,
            }
            : undefined,
          status: s.status,
          arrived: s.arrived_at ? colomboTime(s.arrived_at) : undefined,
          // The driver's phone saw them within 150 m (the arrival nudge), beside their own tap above.
          auto_detected: s.auto_detected_at ? colomboTime(s.auto_detected_at) : undefined,
          done: s.done_at ? colomboTime(s.done_at) : undefined,
          skip_reason: s.skip_reason ?? undefined,
          skip_note: s.skip_note ?? undefined,
          // Phase 7: how Arrived was marked, when not within 300 m (override, no_gps, no_pin, not_arrived).
          arrival_flag: s.arrival_flag && s.arrival_flag !== "ok" ? s.arrival_flag : undefined,
          arrival_text: arrivalFlagText(s.arrival_flag, s.arrival_distance_m),
          arrival_distance_m: s.arrival_distance_m ?? undefined,
          navigate: mapsDirections({ lat: s.lat, lng: s.lng, text: s.address ?? s.place_name }),
          // Where the driver's own phone was when the stop was reached (ours, kept for good).
          arrival: s.arrival_lat != null && s.arrival_lng != null
            ? {
              at: s.arrival_at ? colomboTime(s.arrival_at) : undefined,
              lat: s.arrival_lat,
              lng: s.arrival_lng,
              accuracy_m: s.arrival_accuracy_m != null ? Math.round(s.arrival_accuracy_m) : undefined,
              near: arrivalNear.get(s.id) ?? undefined,
              maps: mapsPoint(s.arrival_lat, s.arrival_lng),
            }
            : undefined,
          saved_place: s.saved_place_id ? { id: s.saved_place_id, name: savedNames.get(s.saved_place_id) ?? "" } : undefined,
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
          id: f.id,
          litres: f.litres === null ? null : Number(f.litres),
          amount_lkr: centsToLkr(f.amount_cents),
          odometer_km: f.odometer_km,
          at: colomboDateTime(f.logged_at),
          receipt_photo: photoOrNote(links, f.receipt_photo_id),
          video: videoCard(
            f,
            videos,
            f.video_uploaded_at ? colomboDateTime(f.video_uploaded_at) : undefined,
            settings.fuel_video_checklist,
          ),
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
          changes: e.changes ?? undefined,
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

// ---------------------------------------------------------------------------
// Changing a task (Phase 6, Part 2): the time, the end time, the driver, the
// vehicle, the words, the route. Shared by update_task and redecide_request.
// ---------------------------------------------------------------------------

export interface TaskChanges {
  /** ISO: the new leave-by time (a task not started yet). */
  startAt?: string;
  /** ISO, or null to clear; undefined = keep (it moves with the time). */
  endBy?: string | null;
  driver?: Employee;
  vehicle?: Vehicle;
  title?: string;
  passengers?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  /** Replace the pending stops with this route (a request's route after an edit) and re-plan. */
  route?: { from: string; to: string };
}

export interface FieldChange {
  from: string | null;
  to: string | null;
}

export interface ChangedTask {
  task: Task;
  /** What changed, by label, in the office's words. */
  changes: Record<string, FieldChange>;
  warnings: string[];
  plan_version: number;
  driverChanged: boolean;
}

/** "time Thu 15 Oct 09:00 → Thu 15 Oct 09:30, vehicle WP CAB-4521 → WP KL-1234" */
export const changesText = (changes: Record<string, FieldChange>): string =>
  Object.entries(changes).map(([label, c]) => `${label} ${c.from ?? "—"} → ${c.to ?? "—"}`).join(", ");

/**
 * Applies changes to a task that has not finished. A moved time shifts the
 * plan (the planned times move with it); a new driver gets the task as new
 * (seen and accepted start afresh, the previous driver hears it is gone if he
 * had accepted it); a declined task goes back to assigned; a route replaces the
 * pending stops and re-plans. One history event carries the diff; the driver's
 * push names the changed fields; a request's requester and the vehicle's
 * custodian hear about a moved or re-equipped booking. `version` is the
 * plan_version the caller loaded (refused when stale).
 */
export async function changeTask(
  db: Db,
  now: Date,
  actor: Actor,
  task: Task,
  c: TaskChanges,
  opts: { version?: number; note?: string; tellRequester?: boolean; allowNoop?: boolean } = {},
): Promise<ChangedTask> {
  if (task.status === "completed" || task.status === "cancelled") throw new ToolError(`This task is ${task.status}; it cannot be changed.`);
  if (opts.version !== undefined && task.plan_version !== opts.version) {
    throw new ToolError(
      `This task changed since you loaded it (version ${task.plan_version}, you have ${opts.version}). Reload it and try again.`,
    );
  }
  const running = task.status === "in_progress";
  const wasDeclined = task.status === "declined";
  if (running && (c.startAt || c.driver || c.vehicle || c.route || c.endBy !== undefined)) {
    throw new ToolError(
      "This task has started: its time, driver, vehicle and route cannot change now (the title, passengers, contact and notes can).",
    );
  }

  const refs = await loadRefs(db);
  const oldDriver = refs.emp.get(task.employee_id);
  const oldVehicle = refs.veh.get(task.vehicle_id);
  const driver = c.driver ?? oldDriver;
  const vehicle = c.vehicle ?? oldVehicle;
  if (!driver || !vehicle) throw new ToolError("The task's driver or vehicle no longer exists.");
  const driverChanged = driver.id !== task.employee_id;
  const vehicleChanged = vehicle.id !== task.vehicle_id;
  const startAt = c.startAt ?? task.start_at;
  const delta = new Date(startAt).getTime() - new Date(task.start_at).getTime();
  const shift = (iso: string | null) => iso && delta !== 0 ? new Date(new Date(iso).getTime() + delta).toISOString() : iso;
  const endBy = c.endBy !== undefined ? c.endBy : shift(task.end_by);
  if (endBy && endBy <= startAt) throw new ToolError("The end time must be later than the leave-by time.");

  const changes: Record<string, FieldChange> = {};
  const note = (label: string, from: string | null, to: string | null) => {
    if (from !== to) changes[label] = { from, to };
  };
  note("time", colomboDayTime(task.start_at), colomboDayTime(startAt));
  note("end by", task.end_by ? colomboTime(task.end_by) : null, endBy ? colomboTime(endBy) : null);
  note("driver", oldDriver?.name ?? null, driver.name);
  note("vehicle", oldVehicle?.reg_no ?? null, vehicle.reg_no);
  if (c.title !== undefined) note("title", task.title, c.title);
  if (c.passengers !== undefined) {
    note("passengers", task.passengers == null ? null : String(task.passengers), c.passengers == null ? null : String(c.passengers));
  }
  if (c.contactName !== undefined || c.contactPhone !== undefined) {
    const was = [task.contact_name, task.contact_phone].filter(Boolean).join(" ") || null;
    const next =
      [c.contactName === undefined ? task.contact_name : c.contactName, c.contactPhone === undefined ? task.contact_phone : c.contactPhone]
        .filter(Boolean).join(" ") || null;
    note("contact", was, next);
  }
  if (c.notes !== undefined) note("notes", task.notes, c.notes);
  // A route is compared after resolving it (a typed "Head office" is the saved "Head office, Colombo 05"),
  // so a request decided again with the same route keeps its stops and plan.
  let newStops: ResolvedStop[] | null = null;
  if (c.route) {
    const existing = unwrap(await db.from("task_stops").select("*").eq("task_id", task.id).order("seq"), "stops");
    const current = live(existing);
    const from = current[0]?.place_name ?? null;
    const to = current.length > 1 ? current[current.length - 1].place_name : null;
    const nextSeq = existing.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
    const resolved = await resolveStops(db, colomboDate(startAt), { pickup: c.route.from, dropoff: c.route.to }, nextSeq);
    const wantFrom = resolved[0]?.place_name ?? null;
    const wantTo = resolved.length > 1 ? resolved[resolved.length - 1].place_name : null;
    if (from !== wantFrom || to !== wantTo) {
      newStops = resolved;
      note("route", [from, to].filter(Boolean).join(" → ") || null, [wantFrom, wantTo].filter(Boolean).join(" → ") || null);
    }
  }
  if (Object.keys(changes).length === 0 && !wasDeclined) {
    if (opts.allowNoop) return { task, changes, warnings: [], plan_version: task.plan_version, driverChanged: false };
    throw new ToolError("Nothing to change.");
  }

  // A new driver (or a driver who declined and gets it back) starts afresh: not seen, not accepted, no reminder yet.
  const fresh = driverChanged || wasDeclined;
  let version = task.plan_version + 1;
  const updated = unwrap(
    await db.from("tasks").update({
      employee_id: driver.id,
      vehicle_id: vehicle.id,
      start_at: startAt,
      end_by: endBy,
      ...(delta !== 0 && { leave_by: startAt, leave_by_source: "manual" }),
      ...(c.title !== undefined && { title: c.title }),
      ...(c.passengers !== undefined && { passengers: c.passengers }),
      ...(c.contactName !== undefined && { contact_name: c.contactName }),
      ...(c.contactPhone !== undefined && { contact_phone: c.contactPhone }),
      ...(c.notes !== undefined && { notes: c.notes }),
      status: running ? "in_progress" : "assigned",
      plan_version: version,
      ...(fresh && { sent_at: now.toISOString(), seen_at: null, accepted_at: null, accept_reminder_sent_at: null }),
      ...(wasDeclined &&
        { declined_at: null, declined_by: null, declined_reason: null, declined_note: null, declined_after_accept: false }),
    }).eq("id", task.id).eq("plan_version", task.plan_version).in("status", ["assigned", "declined", "in_progress"]).select("*"),
    "task",
  );
  if (updated.length === 0) {
    throw new ToolError("The task changed just now (the driver may have started or finished it). Reload it and try again.");
  }
  let saved: Task = updated[0];

  if (newStops) {
    // The pending stops are replaced by the route and the task is planned again from the (new) leave time.
    const settings = await loadSettings(db);
    const stops = newStops;
    const start = saved.start_name
      ? { place_id: saved.start_place_id, name: saved.start_name, lat: saved.start_lat, lng: saved.start_lng }
      : await resolveStart(db, settings, undefined);
    const plan = await makePlan(db, settings, {
      now,
      start,
      stops,
      returnToBase: saved.return_to_base,
      avoidExpressway: saved.avoid_expressway,
      leaveAt: startAt,
      bufferMin: saved.buffer_min,
    });
    version = unwrap(
      await db.rpc("office_update_task_stops", {
        p_task_id: task.id,
        p_version: version,
        p_task: {
          leave_by: plan.leave_by,
          leave_by_source: plan.leave_by_source,
          start_at: plan.leave_by,
          plan_json: plan as unknown as Json,
        },
        p_stops: stops.map(stopRow),
      }),
      "task stops",
    );
    saved = await getTask(db, task.id);
  } else if (delta !== 0) {
    // The planned times move with the task.
    const stops = unwrap(
      await db.from("task_stops").select("id, planned_arrive_at, planned_depart_at").eq("task_id", task.id).neq("status", "removed"),
      "stops",
    );
    for (const s of stops) {
      if (!s.planned_arrive_at && !s.planned_depart_at) continue;
      unwrap(
        await db.from("task_stops").update({ planned_arrive_at: shift(s.planned_arrive_at), planned_depart_at: shift(s.planned_depart_at) })
          .eq("id", s.id),
        "stop",
      );
    }
  }

  unwrap(
    await db.from("task_assignment_events").insert({
      task_id: task.id,
      action: driverChanged ? "reassigned" : "changed",
      employee_id: driver.id,
      vehicle_id: vehicle.id,
      actor: actor.name,
      note: [opts.note, wasDeclined ? "after a decline" : null, changesText(changes) || null].filter(Boolean).join(" · ") || null,
      changes: changes as unknown as Json,
    }),
    "assignment history",
  );

  // Who else hears: a request's requester and the vehicle's custodian about a moved or re-equipped booking;
  // the previous vehicle's custodian that theirs is free again.
  const moved = changes.time || changes["end by"] || changes.driver || changes.vehicle || changes.route;
  if (moved) {
    const request = task.request_id
      ? unwrapMaybe(
        await db.from("vehicle_requests").select("requested_by_employee_id").eq("id", task.request_id).maybeSingle(),
        "vehicle request",
      )
      : null;
    await notifyEvent(db, "booking.changed", {
      title: `Booking changed · ${saved.title}`,
      body: `${changesText(changes)} · ${actor.name}`,
      url: task.request_id ? `/requests/${task.request_id}` : `/tasks?task=${task.id}`,
      tag: task.request_id ? `request:${task.request_id}` : `task:${task.id}`,
    }, {
      actor: actor.employeeId,
      requester: opts.tellRequester === false ? null : request?.requested_by_employee_id ?? null,
      custodian: vehicle.custodian_employee_id,
    });
    if (vehicleChanged && oldVehicle?.custodian_employee_id && oldVehicle.custodian_employee_id !== vehicle.custodian_employee_id) {
      await notifyEvent(db, "vehicle.booking_cancelled", {
        title: `${oldVehicle.reg_no} no longer booked`,
        body: `${saved.title} · now ${vehicle.reg_no} · ${colomboDayTime(startAt)}`,
        url: `/tasks?task=${task.id}`,
        tag: `task:${task.id}`,
      }, { actor: actor.employeeId, custodian: oldVehicle.custodian_employee_id });
    }
  }

  const warnings = running ? [] : await assignWarnings(db, { driver, vehicle, startAt, endBy, ignoreTaskId: task.id });
  if (!running && new Date(startAt) < now) warnings.push("The leave-by time is already in the past.");
  return { task: saved, changes, warnings, plan_version: version, driverChanged };
}

/** "" clears a text field (null); undefined keeps it. */
const zClearable = (max: number) => z.string().trim().max(max).nullable().optional();
const cleared = (v: string | null | undefined): string | null | undefined => v === undefined ? undefined : v === "" ? null : v;

export const updateTask = tool({
  name: "update_task",
  title: "Change a task",
  description:
    "Changes a task that has not finished: the day and leave-by time (the plan shifts with it), the end time, the driver (they get it " +
    "as a new task; the previous driver hears it is gone if they had accepted it), the vehicle, the title, passengers, contact and " +
    "notes. The change goes into the task's history with what changed, and the driver's app says \"Task changed: new time 09:30 · " +
    'vehicle WP KL-1234". plan_version must be the one task_detail showed. A task under way takes only the title, passengers, contact ' +
    "and notes. Returns the same warnings as create_task.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    plan_version: z.number().int().min(0).describe("From task_detail"),
    date: zDate.optional().describe("New day, YYYY-MM-DD"),
    time: zTime.optional().describe("New leave-by time, HH:MM"),
    end_time: zTime.nullable().optional().describe("When the vehicle should be free again, HH:MM; null clears it"),
    driver: zText(80).optional().describe("New driver: username, code or name"),
    vehicle: zText(20).optional().describe("New vehicle plate"),
    title: zText(120).optional(),
    passengers: z.number().int().min(0).max(80).nullable().optional(),
    contact_name: zClearable(120),
    contact_phone: zClearable(30),
    notes: zClearable(1000),
  }),
  async run(args, { db, now, actor }) {
    if (args.date) realDate(args.date);
    const task = await getTask(db, args.task_id);
    const refs = (args.driver || args.vehicle) ? await loadRefs(db) : null;
    const day = args.date ?? colomboDate(task.start_at);
    const startAt = args.date || args.time ? utcIso(day, args.time ?? colomboTime(task.start_at)) : undefined;
    const endBy = args.end_time === undefined ? undefined : args.end_time === null ? null : utcIso(day, args.end_time);
    const out = await changeTask(db, now, actor, task, {
      startAt,
      endBy,
      driver: args.driver && refs ? activeDriver(refs, args.driver) : undefined,
      vehicle: args.vehicle && refs ? activeVehicle(refs, args.vehicle) : undefined,
      title: args.title,
      passengers: args.passengers,
      contactName: cleared(args.contact_name),
      contactPhone: cleared(args.contact_phone),
      notes: cleared(args.notes),
    }, { version: args.plan_version });
    const driver = out.task.employee_id
      ? unwrapMaybe(await db.from("employees").select("name, phone").eq("id", out.task.employee_id).maybeSingle(), "employee")
      : null;
    return {
      result: {
        task_id: task.id,
        title: out.task.title,
        when: colomboDayTime(out.task.start_at),
        leave_by: out.task.leave_by ? colomboDayTime(out.task.leave_by) : undefined,
        until: out.task.end_by ? colomboTime(out.task.end_by) : undefined,
        driver: driver?.name,
        plan_version: out.plan_version,
        changes: out.changes,
        warnings: out.warnings,
        sent: out.driverChanged
          ? `${driver?.name ?? "The new driver"} gets it as a new task to accept.`
          : "The driver's app shows the change (Task changed).",
        links: { whatsapp_driver: waLink(driver?.phone), call_driver: telLink(driver?.phone) },
      },
      summary: `task ${task.id} changed (version ${out.plan_version}): ${changesText(out.changes) || "given back after a decline"}` +
        (out.warnings.length > 0 ? ` (${out.warnings.length} warnings)` : ""),
    };
  },
});

/** "Completed early: 3 km on the odometer for a 50 km plan (12 min for 60 min of driving)", or undefined. */
export function finishFlagText(flag: unknown): { kind: string; text: string } | undefined {
  const f = flag as { kind?: string; odometer_km?: number; planned_km?: number; minutes?: number; planned_minutes?: number } | null;
  if (!f?.kind) return undefined;
  return {
    kind: f.kind,
    text: `Completed early: ${f.odometer_km ?? "?"} km on the odometer for a ${f.planned_km ?? "?"} km plan (${f.minutes ?? "?"} min for ${
      f.planned_minutes ?? "?"
    } min of driving)`,
  };
}

/** How Arrived was marked, in words, when it was not within 300 m of the pin. */
export function arrivalFlagText(flag: string | null, distanceM: number | null): string | undefined {
  const far = distanceM == null
    ? ""
    : distanceM >= 1000
    ? ` ${Math.round(distanceM / 100) / 10} km from the pin`
    : ` ${distanceM} m from the pin`;
  switch (flag) {
    case "override":
      return `Marked arrived${far} ("I'm here, the pin is wrong")`;
    case "no_gps":
      return "Marked arrived with no GPS fix";
    case "no_pin":
      return "Arrived (the stop has no pin)";
    case "not_arrived":
      return "Done without Arrived (older app)";
    default:
      return undefined;
  }
}

export const reopenTask = tool({
  name: "reopen_task",
  title: "Reopen a task completed today",
  description: "Sets a task completed today (Colombo) back to in progress, for example after a wrong end reading: the end odometer and " +
    "the completion time are cleared (the odometer log and the task's history keep them), the stops skipped as not visited at the " +
    "finish open again, and the driver gets a push to finish it again. Not when the driver has another task running.",
  readOnly: false,
  input: z.object({ task_id: zId, reason: zText(300) }),
  async run({ task_id, reason }, { db, actor }) {
    const task = await getTask(db, task_id);
    const { data, error } = await db.rpc("office_reopen_task", { p_task: task.id, p_by: actor.name, p_reason: reason });
    if (error) throw new Error(`reopen task: ${error.message}`);
    const answer = (data as { result?: string } | null)?.result;
    if (answer === "not_completed") throw new ToolError(`This task is ${task.status}, not completed: there is nothing to reopen.`);
    if (answer === "not_today") throw new ToolError("Only a task completed today can be reopened.");
    if (answer === "driver_busy") {
      throw new ToolError("The driver has another task in progress: it must be completed first, then reopen this one.");
    }
    return {
      result: { reopened: task.title, reason, note: "The driver's app shows it in progress again; they finish it with a new end reading." },
      summary: `reopened task ${task.id} (${task.title}): ${reason}`,
    };
  },
});

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
    const reassignChanges: Record<string, FieldChange> = {
      ...(driverChanged && { driver: { from: refs.emp.get(task.employee_id)?.name ?? null, to: newDriver.name } }),
      ...(newVehicle.id !== task.vehicle_id && { vehicle: { from: refs.veh.get(task.vehicle_id)?.reg_no ?? null, to: newVehicle.reg_no } }),
      ...(delta !== 0 && { time: { from: colomboDayTime(task.start_at), to: colomboDayTime(startAt) } }),
    };
    unwrap(
      await db.from("task_assignment_events").insert({
        task_id: task.id,
        action: "reassigned",
        employee_id: newDriver.id,
        vehicle_id: newVehicle.id,
        actor: actor.name,
        note: [wasDeclined ? "after a decline" : null, changesText(reassignChanges) || null].filter(Boolean).join(" · ") || undefined,
        changes: reassignChanges as unknown as Json,
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
