// Live locations and a driver's route for a day.

import { z } from "zod";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { type Employee, findDriver, loadLatest, loadRefs, nearestTown, sharing, statusOf, vehicleLabel } from "../fleet.ts";
import { contactLinks, kmh, mapsPoint } from "../format.ts";
import { GPS_KM_NOTE } from "../geo.ts";
import { buildRoute, type Segment } from "../route.ts";
import type { Fix } from "../track.ts";
import { colomboDate, colomboDateTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zText, zTime } from "../tool.ts";

export const liveDrivers = tool({
  name: "live_drivers",
  title: "Live locations",
  description: "Where drivers are now. Lists every driver who is sharing their location or has a task in progress, with the " +
    "status: live (a GPS point under 3 min old), location_off (the phone reports Location off or the permission missing, since when), " +
    "no_signal (sharing on but nothing from the phone for over 3 min) or not_sharing; last position time, nearest town, speed, " +
    "vehicle, current task and Google Maps / WhatsApp / call links. The older state (sharing / stale / not_sharing, 15 min rule) " +
    "is still answered too.",
  readOnly: true,
  input: z.object({
    filter: z.enum(["all", "sharing", "stale", "not_sharing", "live", "no_signal", "location_off"]).optional().describe("Default: all"),
  }),
  async run({ filter = "all" }, { db, now }) {
    const [refs, latest, running, openSessions] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      db.from("tasks").select("id, title, employee_id, vehicle_id").eq("status", "in_progress"),
      db.from("duty_sessions").select("employee_id, vehicle_id").is("ended_at", null),
    ]);
    const tasks = unwrap(running, "tasks");
    const sessions = unwrap(openSessions, "sharing periods");
    const stops = tasks.length > 0
      ? unwrap(await db.from("task_stops").select("task_id, seq, place_name").in("task_id", tasks.map((t) => t.id)).order("seq"), "stops")
      : [];

    const shown = refs.employees.filter((e) =>
      e.role === "driver" && e.active && (latest.get(e.id)?.sharing || tasks.some((t) => t.employee_id === e.id))
    );
    const cards = await Promise.all(shown.map(async (e) => {
      const pos = latest.get(e.id);
      const share = sharing(pos, now);
      const { fields } = statusOf(pos, now);
      const task = tasks.find((t) => t.employee_id === e.id);
      const vehicleId = task?.vehicle_id ?? sessions.find((s) => s.employee_id === e.id)?.vehicle_id ?? e.current_vehicle_id;
      const hasPosition = pos?.lat != null && pos?.lng != null;
      return {
        driver: e.name,
        username: e.username,
        employee_id: e.id,
        state: share.state,
        location: share.text,
        ...fields,
        updated: pos?.recorded_at ? colomboDateTime(pos.recorded_at) : undefined,
        near: hasPosition ? await nearestTown(db, pos.lat!, pos.lng!) : undefined,
        speed_kmh: share.state === "sharing" ? kmh(pos?.speed_mps) : undefined,
        battery_pct: pos?.battery_pct,
        source: "Fame Driver app",
        vehicle: vehicleId ? vehicleLabel(refs.veh.get(vehicleId)) : undefined,
        task: task?.title,
        going_to: task ? stops.filter((s) => s.task_id === task.id).at(-1)?.place_name : undefined,
        // The position itself (the web map draws it; the maps link stays for Claude).
        lat: hasPosition ? pos.lat! : undefined,
        lng: hasPosition ? pos.lng! : undefined,
        links: { maps: hasPosition ? mapsPoint(pos.lat!, pos.lng!) : undefined, ...contactLinks(e.phone) },
        minutes: share.minutes ?? Number.MAX_SAFE_INTEGER,
      };
    }));

    const order = { sharing: 0, stale: 1, not_sharing: 2 };
    const count = (state: string) => cards.filter((c) => c.state === state).length;
    const countStatus = (status: string) => cards.filter((c) => c.status === status).length;
    const drivers = cards
      .filter((c) => filter === "all" || c.state === filter || c.status === filter)
      .sort((a, b) => order[a.state] - order[b.state] || a.minutes - b.minutes)
      .map(({ minutes: _minutes, ...card }) => card);

    return {
      result: {
        as_of: colomboDateTime(now),
        counts: { all: cards.length, sharing: count("sharing"), stale: count("stale"), not_sharing: count("not_sharing") },
        status_counts: {
          live: countStatus("live"),
          no_signal: countStatus("no_signal"),
          location_off: countStatus("location_off"),
          not_sharing: countStatus("not_sharing"),
        },
        drivers,
      },
      summary: `${drivers.length} drivers (${filter})`,
    };
  },
});

export const driverRoute = tool({
  name: "driver_route",
  title: "Driver's route: a day, a task or a time window",
  description: "Where a driver went, from the points their phone shared: on one day (default today), during one task (task_id: " +
    "from Start task to Save & finish, or now), or between two times of the day (from, to). Answers the km (GPS, drift filtered; " +
    "the odometer is the true figure), driving and stopped minutes, the number of stops, a timeline of driving legs, stops over " +
    "10 minutes (near which town) and gaps of over 10 minutes with no data, and the route line thinned by shape (corners kept) " +
    "for a map. Only covers the time location sharing was on.",
  readOnly: true,
  input: z.object({
    driver: zText(80).optional().describe("Username, code or name. Not needed with task_id."),
    date: zDate.optional().describe("Default: today. Ignored with task_id."),
    task_id: zId.optional().describe("One task's time: from Start task to Save & finish, or now if it is still running"),
    from: zTime.optional().describe("HH:MM: start of the window on the date"),
    to: zTime.optional().describe("HH:MM: end of the window on the date"),
  }),
  async run({ driver, date, task_id, from, to }, { db, now }) {
    const refs = await loadRefs(db);
    let who: Employee;
    let fromIso: string;
    let toIso: string;
    let task: { id: string; title: string; started: string; completed: string | null } | undefined;
    if (task_id) {
      const t = unwrapMaybe(
        await db.from("tasks").select("id, title, employee_id, started_at, completed_at").eq("id", task_id).maybeSingle(),
        "task",
      );
      if (!t) throw new ToolError(`No task with id ${task_id}.`);
      const e = refs.emp.get(t.employee_id);
      if (!e) throw new ToolError("The task's driver is not an employee any more.");
      who = e;
      if (!t.started_at) {
        return {
          result: { driver: who.name, task: { id: t.id, title: t.title }, recorded_points: 0, note: "The task has not started yet." },
          summary: `route of task ${t.id}: not started`,
        };
      }
      fromIso = t.started_at;
      toIso = t.completed_at ?? now.toISOString();
      task = {
        id: t.id,
        title: t.title,
        started: colomboDateTime(t.started_at),
        completed: t.completed_at ? colomboDateTime(t.completed_at) : null,
      };
    } else {
      if (!driver) throw new ToolError("Say which driver (username, code or name), or give a task_id.");
      who = findDriver(refs, driver);
      const day = realDate(date ?? colomboDate(now));
      const range = dayRange(day);
      fromIso = from ? utcIso(day, from) : range.from;
      toIso = to ? utcIso(day, to) : range.to;
      if (toIso <= fromIso) throw new ToolError("The window ends before it starts.");
    }
    const day = colomboDate(fromIso);

    const rows = await fetchAll(
      (a, b) =>
        db.from("location_points").select("id, recorded_at, lat, lng, speed_mps, accuracy_m")
          .eq("employee_id", who.id).gte("recorded_at", fromIso).lte("recorded_at", toIso)
          .order("recorded_at").order("id").range(a, b),
      "location points",
    );
    const window = { from: colomboDateTime(fromIso), to: colomboDateTime(toIso) };
    if (rows.length === 0) {
      return {
        result: { driver: who.name, date: day, window, task, recorded_points: 0, note: "No location was shared in this time." },
        summary: `route ${who.name} ${day}: no points`,
      };
    }
    const fixes: Fix[] = rows.map((r) => ({
      at: new Date(r.recorded_at).getTime(),
      lat: r.lat,
      lng: r.lng,
      speedMps: r.speed_mps,
      accuracyM: r.accuracy_m,
    }));
    const route = buildRoute(fixes);

    // The nearest town of every place the vehicle stood: once per place, also for a stop cut in two by a data gap.
    const towns = new Map<string, string | null>();
    const townOf = async (lat: number, lng: number) => {
      const key = `${lat},${lng}`;
      if (!towns.has(key)) towns.set(key, await nearestTown(db, lat, lng));
      return towns.get(key) ?? null;
    };
    const stops = await Promise.all(
      route.stops.slice(0, 40).map(async (stop) => ({
        from: colomboTime(new Date(stop.from).toISOString()),
        to: colomboTime(new Date(stop.to).toISOString()),
        minutes: stop.minutes,
        near: await townOf(stop.lat, stop.lng),
        maps: mapsPoint(stop.lat, stop.lng),
        lat: stop.lat,
        lng: stop.lng,
      })),
    );
    const t = (ms: number) => colomboTime(new Date(ms).toISOString());
    const timeline = await Promise.all(route.segments.map(async (s: Segment) => {
      const near = s.kind === "stopped" && s.lat != null && s.lng != null ? await townOf(s.lat, s.lng) : undefined;
      const text = s.kind === "driving"
        ? `${t(s.from)}–${t(s.to)} Driving · ${s.km ?? 0} km`
        : s.kind === "stopped"
        ? `${t(s.from)}–${t(s.to)} Stopped${near ? ` near ${near}` : ""}`
        : `${t(s.from)}–${t(s.to)} No data`;
      return {
        kind: s.kind,
        from: t(s.from),
        to: t(s.to),
        from_at: new Date(s.from).toISOString(),
        to_at: new Date(s.to).toISOString(),
        minutes: s.minutes,
        km: s.km,
        near: near ?? undefined,
        lat: s.lat,
        lng: s.lng,
        text,
      };
    }));
    const last = rows[rows.length - 1];
    const lastOnLine = route.line[route.line.length - 1];

    return {
      result: {
        driver: who.name,
        date: day,
        window,
        task,
        recorded_points: rows.length,
        usable_points: route.usable,
        repeated_points: route.repeats,
        first_point: colomboTime(rows[0].recorded_at),
        last_point: colomboTime(last.recorded_at),
        last_position: lastOnLine ? mapsPoint(lastOnLine.lat, lastOnLine.lng) : mapsPoint(last.lat, last.lng),
        km: route.km,
        km_note: GPS_KM_NOTE,
        driving_minutes: route.drivingMinutes,
        stopped_minutes: route.stoppedMinutes,
        stops_count: route.stopsCount,
        stops_over_10_min: stops,
        gaps: route.gaps.map((g) => ({ from: t(g.from), to: t(g.to), minutes: g.minutes })),
        timeline,
        route: {
          columns: ["time", "lat", "lng", "km/h", "at"],
          points: route.line.map((p) => [t(p.at), p.lat, p.lng, p.kmh, new Date(p.at).toISOString()]),
        },
      },
      summary: `route ${who.name} ${day}: ${rows.length} points, ${route.km} km, ${route.stopsCount} stops`,
    };
  },
});
