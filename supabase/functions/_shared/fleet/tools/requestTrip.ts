// A request's trip (Phase 7, §34): its stops in the model of the task stops (request_stops), where it starts, and its
// plan. A requester plans it with the same editor as Assign a task; approving copies the stops into the task with nothing
// retyped. Only types come from tasks.ts, so tasks.ts (a proposed task, §33) and requests.ts can both use this module.

import type { Json } from "../database.types.ts";
import type { Db, Row } from "../db.ts";
import { unwrap } from "../db.ts";
import type { What } from "../plan.ts";
import type { ResolvedStart, ResolvedStop, StoredPlan } from "./tasks.ts";

export type RequestStop = Row<"request_stops">;
type VehicleRequest = Row<"vehicle_requests">;

export interface RequestTrip {
  start: ResolvedStart | null;
  stops: ResolvedStop[];
  plan: StoredPlan;
  returnToBase: boolean;
  avoidExpressway: boolean;
  leaveBy: string;
  leaveBySource: "plan" | "manual";
  bufferMin: number | null;
}

/** Writes the trip on a request: its stops (the ones it had are marked removed, never deleted), the start and the plan. */
export async function saveRequestTrip(db: Db, requestId: string, t: RequestTrip, now: Date): Promise<void> {
  unwrap(
    await db.from("request_stops").update({ removed_at: now.toISOString() }).eq("request_id", requestId).is("removed_at", null)
      .select("id"),
    "request stops",
  );
  unwrap(
    await db.from("request_stops").insert(t.stops.map((s) => ({
      request_id: requestId,
      seq: s.seq,
      type: s.type,
      what: s.what,
      place_id: s.place_id,
      place_name: s.place_name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      dwell_min: s.dwell_min,
      arrive_by: s.arrive_by,
      note: s.note,
      planned_arrive_at: s.planned_arrive_at ?? null,
      planned_depart_at: s.planned_depart_at ?? null,
      is_start: s.is_start,
      dwell_source: s.dwell_source,
    }))).select("id"),
    "request stops",
  );
  unwrap(
    await db.from("vehicle_requests").update({
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
    }).eq("id", requestId).select("id"),
    "vehicle request",
  );
}

/** A stored stop, a request's or a task's (the same planning columns). */
export type StopRowLike = Pick<
  RequestStop,
  | "seq"
  | "type"
  | "what"
  | "place_id"
  | "place_name"
  | "address"
  | "lat"
  | "lng"
  | "dwell_min"
  | "arrive_by"
  | "note"
  | "google_place_id"
  | "planned_arrive_at"
  | "planned_depart_at"
  | "is_start"
  | "dwell_source"
>;

/** A stored stop as the planner reads it. */
export function resolvedFromRow(s: StopRowLike): ResolvedStop {
  return {
    seq: s.seq,
    type: s.type as ResolvedStop["type"],
    what: (s.what ?? null) as What | null,
    place_id: s.place_id,
    place_name: s.place_name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    dwell_min: s.dwell_min,
    arrive_by: s.arrive_by,
    note: s.note,
    pin_from: s.lat == null ? null : s.google_place_id ? "google" : s.place_id ? "place" : "given",
    planned_arrive_at: s.planned_arrive_at ?? undefined,
    planned_depart_at: s.planned_depart_at ?? undefined,
    is_start: s.is_start,
    dwell_source: (s.dwell_source ?? "default") as ResolvedStop["dwell_source"],
  };
}

/** The request's start as the planner reads it, or null when it has none stored (the base place then). */
export function startOfRequest(r: VehicleRequest): ResolvedStart | null {
  if (!r.start_name) return null;
  return {
    place_id: r.start_place_id,
    name: r.start_name,
    lat: r.start_lat,
    lng: r.start_lng,
    google: r.start_google_place_id ? true : undefined,
  };
}

/** The current stops of these requests (one query), by request. */
export async function requestStopsOf(db: Db, ids: string[]): Promise<Map<string, RequestStop[]>> {
  const out = new Map<string, RequestStop[]>();
  if (ids.length === 0) return out;
  const rows = unwrap(
    await db.from("request_stops").select("*").in("request_id", ids).is("removed_at", null).order("seq").limit(5000),
    "request stops",
  );
  for (const s of rows) out.set(s.request_id, [...(out.get(s.request_id) ?? []), s]);
  return out;
}
