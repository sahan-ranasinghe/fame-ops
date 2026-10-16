// A task's km per vehicle (Phase 7, §2 addition: the vehicle swap during a task). A task with no swap is one
// piece on its own vehicle; a swapped task is one piece per stretch (segment), each on the vehicle that drove it.
// Pure: the mileage tool reads the rows and asks this.

export interface TaskKmRow {
  id: string;
  vehicle_id: string;
  km: number | null;
}

export interface SegmentRow {
  task_id: string;
  seq: number;
  vehicle_id: string;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
}

export interface TaskPiece {
  task_id: string;
  vehicle_id: string;
  km: number;
}

/** One piece per vehicle a task used. A stretch with a reading still missing counts 0 km until the driver enters it. */
export function taskPieces(tasks: readonly TaskKmRow[], segments: readonly SegmentRow[]): TaskPiece[] {
  const byTask = new Map<string, SegmentRow[]>();
  for (const s of segments) byTask.set(s.task_id, [...(byTask.get(s.task_id) ?? []), s]);
  return tasks.flatMap((t) => {
    const own = (byTask.get(t.id) ?? []).sort((a, b) => a.seq - b.seq);
    if (own.length === 0) return [{ task_id: t.id, vehicle_id: t.vehicle_id, km: t.km ?? 0 }];
    return own.map((s) => ({
      task_id: t.id,
      vehicle_id: s.vehicle_id,
      km: s.start_odometer_km != null && s.end_odometer_km != null ? Math.max(0, s.end_odometer_km - s.start_odometer_km) : 0,
    }));
  });
}
