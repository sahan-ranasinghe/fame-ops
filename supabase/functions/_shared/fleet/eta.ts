// The live ETA of a running task: from the driver's last position to the
// current stop (road time from routing.ts), then the remaining stops with
// their dwell, then the base when the task returns there. Kept in task_eta
// and recomputed at most every 2 minutes per task, so the board, the task
// drawer and the live map can all ask for it.

import type { Db, Row } from "./db.ts";
import { unwrap, unwrapMaybe } from "./db.ts";
import { dwellFor, type PlanPoint, type StopType, type What } from "./plan.ts";
import { legMinutes } from "./routing.ts";
import type { Settings } from "./settings.ts";

export const ETA_CACHE_MS = 2 * 60000;

export interface Eta {
  next_seq: number | null;
  next_eta_at: string | null;
  final_eta_at: string | null;
  /** Minutes the final ETA passes the tightest remaining deadline by; 0 when on time. */
  late_min: number;
  source: string;
  computed_at: string;
}

type Task = Pick<Row<"tasks">, "id" | "status" | "return_to_base" | "avoid_expressway">;
type Stop = Pick<Row<"task_stops">, "seq" | "type" | "what" | "status" | "lat" | "lng" | "dwell_min" | "arrive_by">;
type Latest = Pick<Row<"driver_latest">, "lat" | "lng" | "recorded_at"> | undefined;

const addMin = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60000).toISOString();

/** The base place's pin, when a base is set and has one. */
export async function basePoint(db: Db, settings: Settings): Promise<{ id: string; name: string; point: PlanPoint | null } | null> {
  if (!settings.base_place_id) return null;
  const place = unwrapMaybe(
    await db.from("places").select("id, name, lat, lng").eq("id", settings.base_place_id).maybeSingle(),
    "base place",
  );
  if (!place) return null;
  return { id: place.id, name: place.name, point: place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null };
}

/**
 * The ETA of a running task, or null when there is nothing to say (not running,
 * no position, no open stop). Reads the cache first.
 */
export async function taskEta(db: Db, task: Task, stops: Stop[], latest: Latest, settings: Settings, now: Date): Promise<Eta | null> {
  if (task.status !== "in_progress" || !latest || latest.lat == null || latest.lng == null) return null;
  const open = stops.filter((s) => s.status === "pending" || s.status === "arrived").sort((a, b) => a.seq - b.seq);
  if (open.length === 0) return null;

  const cached = unwrapMaybe(await db.from("task_eta").select("*").eq("task_id", task.id).maybeSingle(), "task eta");
  if (cached && now.getTime() - new Date(cached.computed_at).getTime() < ETA_CACHE_MS) {
    return {
      next_seq: cached.next_seq,
      next_eta_at: cached.next_eta_at,
      final_eta_at: cached.final_eta_at,
      late_min: cached.late_min ?? 0,
      source: cached.source ?? "estimate",
      computed_at: cached.computed_at,
    };
  }

  let at = now.toISOString();
  let prev: PlanPoint = { lat: latest.lat, lng: latest.lng };
  let nextEta: string | null = null;
  let late = 0;
  const sources = new Set<string>();
  const opts = { avoid_expressway: task.avoid_expressway };
  for (const stop of open) {
    const dwell = dwellFor(settings, stop.type as StopType, stop.what as What | null, stop.dwell_min);
    let arrive = at;
    if (stop.status !== "arrived" && stop.lat != null && stop.lng != null) {
      const leg = await legMinutes(db, prev, { lat: stop.lat, lng: stop.lng }, at, opts, settings);
      sources.add(leg.source);
      arrive = addMin(at, leg.minutes);
      prev = { lat: stop.lat, lng: stop.lng };
    }
    if (nextEta === null) nextEta = arrive;
    if (stop.arrive_by) late = Math.max(late, Math.round((new Date(arrive).getTime() - new Date(stop.arrive_by).getTime()) / 60000));
    at = addMin(arrive, stop.status === "arrived" ? Math.round(dwell / 2) : dwell);
  }
  if (task.return_to_base) {
    const base = await basePoint(db, settings);
    if (base?.point) {
      const leg = await legMinutes(db, prev, base.point, at, opts, settings);
      sources.add(leg.source);
      at = addMin(at, leg.minutes);
    }
  }
  const eta: Eta = {
    next_seq: open[0].seq,
    next_eta_at: nextEta,
    final_eta_at: at,
    late_min: late,
    source: [...sources].join("+") || "estimate",
    computed_at: now.toISOString(),
  };
  unwrap(
    await db.from("task_eta").upsert({
      task_id: task.id,
      computed_at: eta.computed_at,
      next_seq: eta.next_seq,
      next_eta_at: eta.next_eta_at,
      final_eta_at: eta.final_eta_at,
      late_min: eta.late_min,
      source: eta.source,
    }, { onConflict: "task_id" }),
    "task eta",
  );
  return eta;
}
