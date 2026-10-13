// Who is free at a given time: the suggestions shown when a declined task needs
// a new driver (task_detail.suggestions). Same wording as suggest_vehicles.

import type { Db } from "./db.ts";
import { loadRefs, openTasksOn, type Task, taskWindow } from "./fleet.ts";
import { colomboDate, dayRange } from "./time.ts";

export interface FreeDriver {
  name: string;
  username: string | null;
  availability: string;
}
export interface FreeVehicle {
  reg_no: string;
  make_model: string | null;
  type: string;
  seats: number | null;
  availability: string;
}

/** Active drivers and vehicles (not in the garage) with no task overlapping the window, free-all-day first. */
export async function freeAt(
  db: Db,
  startAt: string,
  endBy: string | null,
  ignoreTaskId?: string,
): Promise<{ drivers: FreeDriver[]; vehicles: FreeVehicle[] }> {
  const day = colomboDate(startAt);
  const dayEnd = new Date(dayRange(day).to).getTime();
  const from = new Date(startAt).getTime();
  const to = endBy ? new Date(endBy).getTime() : dayEnd;
  const [refs, open] = await Promise.all([loadRefs(db), openTasksOn(db, day)]);
  const tasks = open.filter((t) => t.id !== ignoreTaskId);
  const busy = (t: Task) => new Date(t.start_at).getTime() < to && from < (t.end_by ? new Date(t.end_by).getTime() : dayEnd);
  const availability = (mine: Task[]): string | null => {
    if (mine.some(busy)) return null;
    return mine.length === 0 ? "free all day" : `free at that time (other task ${taskWindow(mine[0])})`;
  };
  const rank = (a: { availability: string }, b: { availability: string }) =>
    Number(b.availability === "free all day") - Number(a.availability === "free all day");

  const drivers = refs.employees
    .filter((e) => e.role === "driver" && e.active)
    .flatMap((e) => {
      const text = availability(tasks.filter((t) => t.employee_id === e.id));
      return text ? [{ name: e.name, username: e.username, availability: text }] : [];
    })
    .sort(rank);
  const vehicles = refs.vehicles
    .filter((v) => v.active && !v.in_garage)
    .flatMap((v) => {
      const text = availability(tasks.filter((t) => t.vehicle_id === v.id));
      return text ? [{ reg_no: v.reg_no, make_model: v.make_model, type: v.vehicle_type, seats: v.seats, availability: text }] : [];
    })
    .sort(rank);
  return { drivers, vehicles };
}
