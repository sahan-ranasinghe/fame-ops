// A driver's day (Phase 7, Part 1; docs/phase7-plan.md §1–2): the duty log, the office's clock-out and
// "Move to vehicle". The rules live in the database (take_vehicle, office_clock_out, office_move_vehicle);
// these tools name the driver and the vehicle, call them and say the outcome in words.

import { z } from "zod";
import { type Db, fetchAll, ToolError, unwrap } from "../db.ts";
import { findDriver, findVehicle, loadRefs, vehicleLabel } from "../fleet.ts";
import { buildRoute } from "../route.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange } from "../time.ts";
import { realDate, tool, zDate, zId, zText } from "../tool.ts";

/** GPS km come from the route builder; over a longer range the log leaves them out (the odometer km stay). */
export const DUTY_LOG_GPS_DAYS = 7;
export const DUTY_LOG_MAX_DAYS = 62;

const HOW_TEXT: Record<string, string> = {
  clock_in: "clocked in",
  change: "changed",
  task_start: "task start",
  office: "office",
  taken_over: "taken over",
  clock_out: "clocked out",
  auto: "cut-off",
};

const END_TEXT: Record<string, string> = { driver: "driver", auto: "auto at the cut-off", admin: "office" };

export const dutyLog = tool({
  name: "duty_log",
  title: "Duty log",
  description: "Every duty period (Start work → Finish work) in a date range: the driver, clock in, clock out and how (the driver, " +
    "auto at the cut-off, the office), the vehicles held in it with their times and how each began and ended (clocked in, changed, " +
    "task start, office, taken over), the tasks, the odometer km of those tasks and, for a range of up to 7 days, the GPS km. " +
    "Newest first.",
  readOnly: true,
  input: z.object({
    date: zDate.optional().describe("One day (default today)"),
    from: zDate.optional().describe("First day of a range (with to)"),
    to: zDate.optional().describe("Last day of a range"),
    driver: zText(80).optional().describe("Username, code or name"),
  }),
  async run({ date, from, to, driver }, { db, now }) {
    const first = realDate(from ?? date ?? colomboDate(now), from ? "from" : "date");
    const last = realDate(to ?? (from ? colomboDate(now) : first), "to");
    if (last < first) throw new ToolError("to is before from.");
    const days = Math.round((new Date(`${last}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86400000) + 1;
    if (days > DUTY_LOG_MAX_DAYS) throw new ToolError(`At most ${DUTY_LOG_MAX_DAYS} days at a time.`);
    const fromIso = dayRange(first).from;
    const toIso = dayRange(last).to;
    const refs = await loadRefs(db);
    const who = driver ? findDriver(refs, driver) : null;

    let sq = db.from("duty_sessions").select("id, employee_id, vehicle_id, started_at, ended_at, end_reason, device_info")
      .lt("started_at", toIso).or(`ended_at.is.null,ended_at.gte.${fromIso}`).order("started_at", { ascending: false }).limit(500);
    if (who) sq = sq.eq("employee_id", who.id);
    const sessions = unwrap(await sq, "duty sessions");
    const ids = [...new Set(sessions.map((s) => s.employee_id))];
    const earliest = sessions.reduce((m, s) => (s.started_at < m ? s.started_at : m), fromIso);
    const [assignRes, taskRes] = ids.length
      ? await Promise.all([
        db.from("vehicle_assignments").select("employee_id, vehicle_id, from_at, to_at, how, ended_how, by_name, ended_by_name")
          .in("employee_id", ids).lt("from_at", toIso).or(`to_at.is.null,to_at.gte.${earliest}`).order("from_at"),
        db.from("tasks").select(
          "id, title, employee_id, vehicle_id, started_at, completed_at, status, start_odometer_km, end_odometer_km, km",
        )
          .in("employee_id", ids).not("started_at", "is", null).lt("started_at", toIso).gte("started_at", earliest).order("started_at"),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];
    const assignments = unwrap(assignRes, "vehicle assignments");
    const tasks = unwrap(taskRes, "tasks");

    const withGps = days <= DUTY_LOG_GPS_DAYS && sessions.length <= 60;
    const rows = await Promise.all(sessions.map(async (s) => {
      const end = s.ended_at ?? now.toISOString();
      const inside = (at: string) => at >= s.started_at && at <= end;
      const held = assignments.filter((a) =>
        a.employee_id === s.employee_id && a.from_at <= end && (a.to_at === null || a.to_at >= s.started_at)
      );
      const mine = tasks.filter((t) => t.employee_id === s.employee_id && t.started_at && inside(t.started_at));
      const taskKm = mine.reduce(
        // tasks.km: end − start, or after a vehicle swap the stretches added up (Phase 7).
        (sum, t) => sum + (t.km ?? 0),
        0,
      );
      let gpsKm: number | undefined;
      if (withGps) {
        const points = await fetchAll(
          (a, b) =>
            db.from("location_points").select("id, recorded_at, lat, lng, speed_mps, accuracy_m").eq("employee_id", s.employee_id)
              .gte("recorded_at", s.started_at).lte("recorded_at", end).order("recorded_at").order("id").range(a, b),
          "location points",
          40000,
        );
        gpsKm = points.length > 1
          ? Math.round(
            buildRoute(points.map((p) => ({
              at: new Date(p.recorded_at).getTime(),
              lat: p.lat,
              lng: p.lng,
              speedMps: p.speed_mps,
              accuracyM: p.accuracy_m,
            }))).km * 10,
          ) / 10
          : 0;
      }
      const device = (s.device_info ?? {}) as { brand?: string; model?: string; opened_by?: string };
      const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(s.started_at).getTime()) / 60000));
      return {
        driver: refs.emp.get(s.employee_id)?.name,
        username: refs.emp.get(s.employee_id)?.username,
        day: colomboDate(s.started_at),
        clock_in: colomboDayTime(s.started_at),
        clock_out: s.ended_at
          ? (colomboDate(s.ended_at) === colomboDate(s.started_at) ? colomboTime(s.ended_at) : colomboDayTime(s.ended_at))
          : "on duty",
        out_how: s.ended_at ? END_TEXT[s.end_reason ?? ""] ?? s.end_reason ?? undefined : undefined,
        opened_by_server: device.opened_by === "server" ? true : undefined,
        hours: Math.round(minutes / 6) / 10,
        vehicles: held.map((a) => ({
          vehicle: vehicleLabel(refs.veh.get(a.vehicle_id)),
          from: colomboTime(a.from_at),
          to: a.to_at ? colomboTime(a.to_at) : undefined,
          how: HOW_TEXT[a.how] ?? a.how,
          ended: a.ended_how ? HOW_TEXT[a.ended_how] ?? a.ended_how : undefined,
          by: a.by_name,
          ended_by: a.ended_by_name ?? undefined,
        })),
        tasks: mine.map((t) => ({
          task_id: t.id,
          title: t.title,
          started: colomboTime(t.started_at!),
          completed: t.completed_at ? colomboTime(t.completed_at) : undefined,
          status: t.status,
          km: t.km ?? undefined,
        })),
        task_km: taskKm,
        gps_km: gpsKm,
        phone: [device.brand, device.model].filter(Boolean).join(" ") || undefined,
      };
    }));
    return {
      result: {
        from: first,
        to: last,
        driver: who?.name,
        periods: rows,
        totals: {
          periods: rows.length,
          hours: Math.round(rows.reduce((h, r) => h + r.hours, 0) * 10) / 10,
          task_km: rows.reduce((k, r) => k + r.task_km, 0),
          gps_km: withGps ? Math.round(rows.reduce((k, r) => k + (r.gps_km ?? 0), 0) * 10) / 10 : undefined,
        },
        gps_note: withGps
          ? undefined
          : `GPS km are shown for ranges of up to ${DUTY_LOG_GPS_DAYS} days; the odometer km of the tasks are always shown.`,
      },
      summary: `duty log ${first}${last !== first ? `..${last}` : ""}${who ? ` ${who.name}` : ""}: ${rows.length} periods`,
    };
  },
});

export const clockOutDriver = tool({
  name: "clock_out_driver",
  title: "Clock a driver out",
  description: "Ends a driver's duty (as Finish work would): their location stops being recorded, the vehicle they hold is given up, " +
    "and their phone gets a push. Not while the driver has a task in progress.",
  readOnly: false,
  input: z.object({ driver: zText(80).describe("Username, code or name"), reason: zText(200).optional() }),
  async run({ driver, reason }, { db, actor, now }) {
    const who = findDriver(await loadRefs(db), driver);
    const { data, error } = await db.rpc("office_clock_out", { p_employee: who.id, p_by: actor.name, p_reason: reason ?? undefined });
    if (error) throw new Error(`clock out: ${error.message}`);
    const answer = (data as { result?: string } | null)?.result;
    if (answer === "task_in_progress") {
      throw new ToolError(`${who.name} has a task in progress: it must be completed or cancelled first.`);
    }
    if (answer === "off_duty") {
      return {
        result: { clocked_out: false, note: `${who.name} is already off duty.` },
        summary: `clock out ${who.name}: already off duty`,
      };
    }
    return {
      result: {
        clocked_out: who.name,
        at: colomboDateTime(now),
        reason,
        note: "The driver's phone gets a push and stops recording location.",
      },
      summary: `clocked out ${who.name}${reason ? `: ${reason}` : ""}`,
    };
  },
});

export const moveDriverVehicle = tool({
  name: "move_driver_vehicle",
  title: "Move a driver to a vehicle",
  description: "Gives a driver who is on duty another vehicle (or none): whoever held that vehicle no longer does and is told (one " +
    "vehicle, one driver), and the driver gets a push. For a driver on a task it is a swap (a breakdown): the task goes on in the " +
    "new vehicle and keeps both stretches; the old vehicle's end reading and the new one's start reading are typed here " +
    "(old_end_km, new_start_km) or the driver enters them on the phone when asked. Never onto a vehicle on someone's running task.",
  readOnly: false,
  input: z.object({
    driver: zText(80).describe("Username, code or name"),
    vehicle: zText(40).nullable().describe('Number plate, or null (or "none") for no vehicle'),
    old_end_km: z.number().int().min(0).max(9_999_999).optional().describe(
      "On a task: the old vehicle's odometer at the swap. Leave out to let the driver enter it",
    ),
    new_start_km: z.number().int().min(0).max(9_999_999).optional().describe(
      "On a task: the new vehicle's odometer at the swap. Leave out to let the driver enter it",
    ),
    reason: zText(200).optional().describe('On a task: why ("Breakdown near Kurunegala")'),
  }),
  async run({ driver, vehicle, old_end_km, new_start_km, reason }, { db, actor }) {
    const refs = await loadRefs(db);
    const who = findDriver(refs, driver);
    const target = vehicle === null || vehicle.toLowerCase() === "none" ? null : findVehicle(refs, vehicle);
    const running = unwrap(
      await db.from("tasks").select("id, title, vehicle_id").eq("employee_id", who.id).eq("status", "in_progress").limit(1),
      "tasks",
    )[0];
    // A task under way always has its vehicle (the database's check): the swap moves it.
    if (running?.vehicle_id) {
      return await swapDuringTask(db, actor.name, who.name, { ...running, vehicle_id: running.vehicle_id }, target, {
        old_end_km,
        new_start_km,
        reason,
      });
    }
    if (old_end_km !== undefined || new_start_km !== undefined) {
      throw new ToolError(`${who.name} is not on a task: the readings are only for a swap during a task.`);
    }
    // null = no vehicle: sent as null (the function has no default for it).
    const { data, error } = await db.rpc("office_move_vehicle", {
      p_employee: who.id,
      p_vehicle: (target?.id ?? null) as string,
      p_by: actor.name,
    });
    if (error) throw new Error(`move driver: ${error.message}`);
    const answer = data as { result?: string; taken_from?: string | null } | null;
    switch (answer?.result) {
      case "off_duty":
        throw new ToolError(`${who.name} is off duty: the vehicle is chosen at Start work.`);
      case "task_in_progress":
        throw new ToolError(`${who.name} has just started a task: try again (it becomes a swap during the task).`);
      case "vehicle_on_task":
        throw new ToolError(`${target?.reg_no ?? "That vehicle"} is on another driver's running task.`);
    }
    return {
      result: {
        driver: who.name,
        vehicle: target ? vehicleLabel(target) : "none",
        taken_from: answer?.taken_from ?? undefined,
        note: answer?.taken_from ? `${answer.taken_from} no longer holds it and was told.` : undefined,
      },
      summary: `moved ${who.name} to ${target?.reg_no ?? "no vehicle"}${answer?.taken_from ? ` (from ${answer.taken_from})` : ""}`,
    };
  },
});

/** The swap during a task (Phase 7, §2 addition): office_swap_vehicle ends the stretch so far and starts the next. */
async function swapDuringTask(
  db: Db,
  by: string,
  driverName: string,
  task: { id: string; title: string; vehicle_id: string },
  target: ReturnType<typeof findVehicle> | null,
  r: { old_end_km?: number; new_start_km?: number; reason?: string },
) {
  if (!target) throw new ToolError(`${driverName} is on a task: the task needs a vehicle. Name the vehicle to swap to.`);
  const { data, error } = await db.rpc("office_swap_vehicle", {
    p_task: task.id,
    p_vehicle: target.id,
    p_by: by,
    p_old_end: r.old_end_km,
    p_new_start: r.new_start_km,
    p_reason: r.reason,
  });
  if (error) {
    if (/below its start reading/.test(error.message)) {
      throw new ToolError(`old_end_km ${r.old_end_km} is below the old vehicle's start reading for this task. Check the number.`);
    }
    throw new Error(`swap vehicle: ${error.message}`);
  }
  const answer = data as { result?: string; segment?: number; from?: string; to?: string } | null;
  switch (answer?.result) {
    case "not_running":
      throw new ToolError(`${driverName}'s task has just ended: move the driver again (no swap needed).`);
    case "same_vehicle":
      throw new ToolError(`${driverName}'s task is already in ${target.reg_no}.`);
    case "vehicle_on_task":
      throw new ToolError(`${target.reg_no} is on another driver's running task.`);
  }
  const asked = [
    r.old_end_km === undefined ? `${answer?.from}'s end reading` : null,
    r.new_start_km === undefined ? `${target.reg_no}'s start reading` : null,
  ]
    .filter(Boolean);
  return {
    result: {
      driver: driverName,
      task: task.title,
      task_id: task.id,
      swapped: { from: answer?.from, to: answer?.to, segment: answer?.segment },
      vehicle: vehicleLabel(target),
      readings: {
        old_end: r.old_end_km !== undefined ? `typed: ${r.old_end_km} km` : "the driver enters it on the phone",
        new_start: r.new_start_km !== undefined ? `typed: ${r.new_start_km} km` : "the driver enters it on the phone",
      },
      note: asked.length
        ? `The task goes on in ${target.reg_no}. ${driverName} is asked on the phone for ${asked.join(" and ")}.`
        : `The task goes on in ${target.reg_no}; both readings are logged. Task km = the two stretches added up.`,
    },
    summary: `swapped ${driverName}'s task "${task.title}" ${answer?.from} → ${answer?.to}`,
  };
}

/** A swap reading still owed, typed by the office afterwards (Phase 7, §2 addition). */
export const swapReading = tool({
  name: "swap_reading",
  title: "Type a reading after a vehicle swap",
  description: "After a vehicle swap during a task (move_driver_vehicle), a reading the driver's phone has not sent: the old vehicle's " +
    "odometer at the swap (end_km) or the new vehicle's at the swap (start_km). For a towed vehicle, or a phone that never sent it; " +
    "also after the task is completed. task_detail's segments say which readings are still to come. The task km is then the " +
    "stretches added up.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    vehicle: zText(40).describe("The plate of the vehicle the reading is for"),
    end_km: z.number().int().min(0).max(9_999_999).optional().describe("The old vehicle's odometer when it was swapped out"),
    start_km: z.number().int().min(0).max(9_999_999).optional().describe("The new vehicle's odometer when it was swapped in"),
  }),
  async run({ task_id, vehicle, end_km, start_km }, { db, actor }) {
    if ((end_km === undefined) === (start_km === undefined)) throw new ToolError("Give end_km or start_km (one reading at a time).");
    const refs = await loadRefs(db);
    const v = findVehicle(refs, vehicle);
    const kind = end_km !== undefined ? "end" : "start";
    const km = (end_km ?? start_km) as number;
    const { data, error } = await db.rpc("office_swap_reading", {
      p_task: task_id,
      p_vehicle: v.id,
      p_kind: kind,
      p_km: km,
      p_by: actor.name,
    });
    if (error) throw new Error(`swap reading: ${error.message}`);
    const answer = data as { result?: string; start_km?: number; task_km?: number | null } | null;
    switch (answer?.result) {
      case "no_task":
        throw new ToolError(`No task has the id ${task_id}.`);
      case "not_owed":
        throw new ToolError(`No ${kind} reading of ${v.reg_no} is still to come on this task (task_detail's segments show the stretches).`);
      case "below_start":
        throw new ToolError(`${km} km is below ${v.reg_no}'s start reading for this task (${answer.start_km} km). Check the number.`);
    }
    return {
      result: {
        task_id,
        vehicle: v.reg_no,
        reading: `${kind === "end" ? "end" : "start"} ${km} km`,
        task_km: answer?.task_km ?? undefined,
        note: answer?.task_km != null ? `Task km now ${answer.task_km} (the stretches added up).` : "Another reading is still to come.",
      },
      summary: `swap reading ${v.reg_no} ${kind} ${km} km on task ${task_id}`,
    };
  },
});
