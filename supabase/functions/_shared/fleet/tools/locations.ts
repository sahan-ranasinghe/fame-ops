// Live locations and a driver's route for a day.

import { z } from "zod";
import { fetchAll, unwrap } from "../db.ts";
import { findDriver, loadLatest, loadRefs, nearestTown, sharing, statusOf, vehicleLabel } from "../fleet.ts";
import { contactLinks, kmh, mapsPoint } from "../format.ts";
import { GPS_KM_NOTE, type Point, summariseRoute, thin } from "../geo.ts";
import { colomboDate, colomboDateTime, colomboTime, dayRange } from "../time.ts";
import { realDate, tool, zDate, zText } from "../tool.ts";

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
  title: "Driver's route for a day",
  description: "Where a driver went on one day, from the points their phone shared: km travelled (GPS, drift filtered; the odometer is " +
    "the true figure), stops longer than 10 minutes, and the route thinned to about 300 points. Only covers the time location sharing was on.",
  readOnly: true,
  input: z.object({
    driver: zText(80).describe("Username, code or name"),
    date: zDate.optional().describe("Default: today"),
  }),
  async run({ driver, date }, { db, now }) {
    const who = findDriver(await loadRefs(db), driver);
    const day = realDate(date ?? colomboDate(now));
    const { from, to } = dayRange(day);

    const rows = await fetchAll(
      (a, b) =>
        db.from("location_points").select("id, recorded_at, lat, lng, speed_mps, accuracy_m")
          .eq("employee_id", who.id).gte("recorded_at", from).lt("recorded_at", to)
          .order("recorded_at").order("id").range(a, b),
      "location points",
    );
    const points: Point[] = rows.map((r) => ({
      at: r.recorded_at,
      lat: r.lat,
      lng: r.lng,
      speedMps: r.speed_mps,
      accuracyM: r.accuracy_m,
    }));
    if (points.length === 0) {
      return {
        result: { driver: who.name, date: day, recorded_points: 0, note: "No location was shared on this day." },
        summary: `route ${who.name} ${day}: no points`,
      };
    }

    const route = summariseRoute(points);
    const stops = await Promise.all(
      route.stops.slice(0, 30).map(async (stop) => ({
        from: colomboTime(stop.from),
        to: colomboTime(stop.to),
        minutes: stop.minutes,
        near: await nearestTown(db, stop.lat, stop.lng),
        maps: mapsPoint(stop.lat, stop.lng),
      })),
    );
    const km = route.km;
    const last = points[points.length - 1];

    return {
      result: {
        driver: who.name,
        date: day,
        recorded_points: points.length,
        usable_points: route.usable,
        first_point: colomboTime(points[0].at),
        last_point: colomboTime(last.at),
        last_position: mapsPoint(last.lat, last.lng),
        km,
        km_note: GPS_KM_NOTE,
        stops_over_10_min: stops,
        route: {
          columns: ["time", "lat", "lng", "km/h"],
          points: thin(points).map((p) => [colomboTime(p.at), p.lat, p.lng, kmh(p.speedMps)]),
        },
      },
      summary: `route ${who.name} ${day}: ${points.length} points, ${km} km, ${stops.length} stops`,
    };
  },
});
