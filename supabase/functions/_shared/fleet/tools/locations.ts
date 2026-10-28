// Live locations and a driver's route for a day.

import { z } from "zod";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { type Employee, findDriver, loadLatest, loadRefs, nearestTown, sharing, statusOf, vehicleLabel } from "../fleet.ts";
import { contactLinks, kmh, mapsPoint } from "../format.ts";
import { taskEta } from "../eta.ts";
import { GPS_KM_NOTE } from "../geo.ts";
import { googleUse } from "../google.ts";
import { loadSettings, type MapMatchingProvider, type Settings } from "../settings.ts";
import { type SnapLeg, snapLegs } from "../matching.ts";
import { estimatedLines } from "../gapRoutes.ts";
import type { Channel } from "../roles.ts";

/**
 * Who snaps a route to roads: only for the web (a person opening a route; never Claude or the artifact,
 * Phase 7, §26). Google under the google package while its roads caps are above 0 (off until the asset
 * tracking licence is settled: then nothing is asked, refused or counted), else OSRM when the setting names
 * it, else none.
 */
export function snapProvider(settings: Settings, channel: Channel): MapMatchingProvider {
  if (channel !== "web") return "none";
  if (googleUse(settings).roads) {
    const caps = settings.google_caps.roads;
    return caps.day > 0 && caps.month > 0 ? "google_roads" : "none";
  }
  return settings.map_matching.provider === "osrm" ? "osrm" : "none";
}
import { buildRoute, type LinePoint, type RouteFix, type Segment, withSpeeds } from "../route.ts";
import { colomboDate, colomboDateTime, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { duration } from "../durations.ts";
import { driverPhotoLinks, vehiclePhotoLinks } from "../media.ts";
import { seesDriverPhones } from "../phones.ts";
import { lateReportOf, notAvailableNow } from "../presence.ts";
import { presenceOf } from "./driverRows.ts";
import { realDate, tool, zDate, zId, zText, zTime } from "../tool.ts";

/** watch_drivers keeps a driver watched this long; the web calls it again every 30 s while the page is open. */
export const WATCH_SECONDS = 90;

export const watchDrivers = tool({
  name: "watch_drivers",
  title: "Watch drivers (their phones upload faster)",
  description: "The office is looking at these drivers right now (the driver page, the driver selected on Live locations, every " +
    "sharing driver while today's trails are on): their phones upload every 10 s while moving for the next 90 s instead of 20 s. " +
    "The web app calls it every 30 s while the page is open; call it again to keep watching. A driver who has never shared is not " +
    "yet watchable.",
  readOnly: false,
  input: z.object({
    drivers: z.array(zText(80)).min(1).max(20).describe("Usernames, codes or names"),
  }),
  async run({ drivers }, { db, now }) {
    const refs = await loadRefs(db);
    const until = new Date(now.getTime() + WATCH_SECONDS * 1000).toISOString();
    const watched: string[] = [];
    const notYet: string[] = [];
    for (const name of [...new Set(drivers)]) {
      const who = findDriver(refs, name);
      const { data, error } = await db.from("driver_latest").update({ watched_until: until }).eq("employee_id", who.id).select(
        "employee_id",
      );
      if (error) throw new Error(`watch drivers: ${error.message}`);
      (data?.length ? watched : notYet).push(who.name);
    }
    return {
      result: { watched, not_yet_sharing: notYet.length ? notYet : undefined, until: colomboDateTime(until), seconds: WATCH_SECONDS },
      summary: `watch ${watched.join(", ") || "nobody"}${notYet.length ? ` (not yet sharing: ${notYet.join(", ")})` : ""}`,
    };
  },
});

export const liveDrivers = tool({
  name: "live_drivers",
  title: "Live locations",
  description: "Where drivers are now. Lists every active driver with their duty: on_task, on_duty (clocked in) or off_duty, " +
    "since when, the vehicle they hold (the task's, else the one they clocked in with) and since when; for drivers on duty the " +
    "status: live (a GPS point under 3 min old), location_off (the phone reports Location off or the permission missing, since when), " +
    "no_signal (nothing from the phone for over 3 min); not_sharing = off duty. Also the last position time, nearest town, speed, " +
    "current task, how many times the phone stopped the app today, a vehicle hand-over today, and Google Maps / WhatsApp / call " +
    "links. The older state (sharing / stale / not_sharing, 15 min rule) is still answered too.",
  readOnly: true,
  input: z.object({
    filter: z.enum(["all", "sharing", "stale", "not_sharing", "live", "no_signal", "location_off", "on_task", "on_duty", "off_duty"])
      .optional()
      .describe("Default: all. on_task / on_duty / off_duty filter by duty (on_duty includes on_task)"),
  }),
  async run({ filter = "all" }, { db, now, actor }) {
    const phones = seesDriverPhones(actor);
    const dayStart = dayRange(colomboDate(now)).from;
    const [refs, latest, settings, running, openSessions, todaySessions, handovers, stopsToday] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      loadSettings(db),
      db.from("tasks").select(
        "id, title, employee_id, vehicle_id, status, started_at, return_to_base, avoid_expressway, late_report_min, late_report_at",
      ).eq(
        "status",
        "in_progress",
      ),
      db.from("duty_sessions").select("employee_id, vehicle_id, started_at, device_info").is("ended_at", null),
      db.from("duty_sessions").select("employee_id, ended_at, end_reason, device_info").gte("ended_at", dayStart).order("ended_at", {
        ascending: false,
      }),
      db.from("vehicle_assignments").select("employee_id, vehicle_id, to_at, ended_by_name").eq("ended_how", "taken_over").gte(
        "to_at",
        dayStart,
      )
        .order("to_at", { ascending: false }),
      db.rpc("app_stops", { p_from: dayStart, p_to: now.toISOString() }),
    ]);
    // Phase 7 (§19): a task this driver declined, or has not accepted in time, that still needs a driver.
    const needing = unwrap(
      await db.from("tasks").select("employee_id, start_at, leave_by, needs_driver_reason").not("needs_driver_since", "is", null)
        .in("status", ["assigned", "declined"]).gte("start_at", dayStart).order("start_at"),
      "tasks",
    );
    const tasks = unwrap(running, "tasks");
    const sessions = unwrap(openSessions, "sharing periods");
    const ended = unwrap(todaySessions, "sharing periods");
    const taken = unwrap(handovers, "vehicle hand-overs");
    const appStops = new Map(unwrap(stopsToday, "app stops").map((r) => [r.employee_id, r.stops]));
    const holderSince = new Map(
      unwrap(await db.from("vehicle_assignments").select("employee_id, from_at").is("to_at", null), "vehicle holders").map((
        a,
      ) => [a.employee_id, a.from_at]),
    );
    const stops = tasks.length > 0
      ? unwrap(
        await db.from("task_stops").select("task_id, seq, place_name, type, what, status, lat, lng, dwell_min, arrive_by")
          .in("task_id", tasks.map((t) => t.id)).neq("status", "removed").order("seq"),
        "stops",
      )
      : [];

    // Every active driver (Phase 7): on a task, on duty or off duty.
    const shown = refs.employees.filter((e) => e.role === "driver" && e.active);
    // Phase 7 (§5, §6): the drivers' and the vehicles' photos, in one batch each (the same links while they last).
    // Part 3b (H2): for the people who dispatch, the usual start, the next task and whether the driver is not available now.
    const dispatches = actor.permissions.includes("approve") || actor.permissions.includes("assign_tasks");
    const [driverPhotos, vehiclePhotos, presence, awayRes] = await Promise.all([
      driverPhotoLinks(db, shown, now),
      vehiclePhotoLinks(db, refs.vehicles, now),
      // The card has its own "near" town: no second look-up.
      dispatches ? presenceOf(db, shown.map((e) => e.id), now, latest, false) : Promise.resolve(new Map()),
      dispatches
        ? db.from("driver_unavailability").select("employee_id, starts_at, ends_at, part, reason").is("removed_at", null)
          .lte("starts_at", now.toISOString()).gt("ends_at", now.toISOString())
        : Promise.resolve({ data: [], error: null }),
    ]);
    const awayNow = unwrap(
      awayRes as { data: { employee_id: string; starts_at: string; ends_at: string; part: string; reason: string }[] | null; error: null },
      "availability",
    );
    const cards = await Promise.all(shown.map(async (e) => {
      const pos = latest.get(e.id);
      const share = sharing(pos, now);
      const { fields } = statusOf(pos, now);
      const task = tasks.find((t) => t.employee_id === e.id);
      const session = sessions.find((s) => s.employee_id === e.id);
      const lastEnd = ended.find((s) => s.employee_id === e.id);
      // The vehicle is the task's, else the one the driver holds (vehicle_assignments; current_vehicle_id equals it).
      const vehicleId = task?.vehicle_id ?? e.current_vehicle_id;
      const duty: "on_task" | "on_duty" | "off_duty" = task ? "on_task" : session ? "on_duty" : "off_duty";
      const dutySince = duty === "on_task" ? task?.started_at : duty === "on_duty" ? session?.started_at : lastEnd?.ended_at;
      const hasPosition = pos?.lat != null && pos?.lng != null;
      const taskStops = task ? stops.filter((s) => s.task_id === task.id) : [];
      const eta = task ? await taskEta(db, task, taskStops, pos, settings, now) : null;
      const device = ((session ?? lastEnd)?.device_info ?? {}) as { brand?: string; model?: string };
      const stopsCount = appStops.get(e.id) ?? 0;
      // Today's hand-over: the vehicle this driver took from someone, or the one taken from them.
      const lostTo = taken.find((a) => a.employee_id === e.id);
      const tookFrom = vehicleId ? taken.find((a) => a.vehicle_id === vehicleId && a.ended_by_name === e.name) : undefined;
      const handover = tookFrom
        ? `${vehicleLabel(refs.veh.get(tookFrom.vehicle_id))} taken over from ${
          refs.emp.get(tookFrom.employee_id)?.name ?? "another driver"
        } ${colomboTime(tookFrom.to_at!)}`
        : lostTo && lostTo.vehicle_id !== vehicleId
        ? `${vehicleLabel(refs.veh.get(lostTo.vehicle_id))} now with ${lostTo.ended_by_name ?? "another driver"} ${
          colomboTime(lostTo.to_at!)
        }`
        : undefined;
      return {
        driver: e.name,
        username: e.username,
        employee_id: e.id,
        state: share.state,
        location: share.text,
        ...fields,
        duty,
        duty_text: duty === "on_task" ? "On a task" : duty === "on_duty" ? "On duty" : "Off duty",
        duty_since: dutySince ? colomboTime(dutySince) : undefined,
        updated: pos?.recorded_at ? colomboDateTime(pos.recorded_at) : undefined,
        on_duty_since: session?.started_at ? colomboTime(session.started_at) : undefined,
        off_duty_how: duty === "off_duty" && lastEnd
          ? (lastEnd.end_reason === "auto" ? "auto at the cut-off" : lastEnd.end_reason === "admin" ? "by the office" : "by the driver")
          : undefined,
        video_uploads_waiting: pos?.hb_video_uploads_waiting ?? undefined,
        video_bytes_waiting: pos?.hb_video_bytes_waiting ?? undefined,
        near: hasPosition ? await nearestTown(db, pos.lat!, pos.lng!) : undefined,
        speed_kmh: share.state === "sharing" ? kmh(pos?.speed_mps) : undefined,
        battery_pct: pos?.battery_pct,
        source: "Fame Driver app",
        photo_url: driverPhotos.get(e.id),
        vehicle: vehicleId ? vehicleLabel(refs.veh.get(vehicleId)) : undefined,
        vehicle_thumb_url: vehicleId ? vehiclePhotos.get(vehicleId)?.thumb : undefined,
        vehicle_since: !task && e.current_vehicle_id && holderSince.get(e.id) ? colomboTime(holderSince.get(e.id)!) : undefined,
        vehicle_note: handover,
        task_note: (() => {
          const t = needing.find((x) => x.employee_id === e.id);
          if (!t) return undefined;
          // "the 09:00 task" today; a later day names it ("the Fri 17 Oct 09:00 task").
          const leave = t.leave_by ?? t.start_at;
          const at = colomboDate(leave) === colomboDate(now) ? colomboTime(leave) : colomboDayTime(leave);
          return t.needs_driver_reason === "declined" ? `declined the ${at} task` : `hasn't accepted the ${at} task`;
        })(),
        app_stops_today: stopsCount > 0 ? stopsCount : undefined,
        app_stops_text: stopsCount > 0 ? `App stopped by phone ${stopsCount}× today` : undefined,
        phone: [device.brand, device.model].filter(Boolean).join(" ") || undefined,
        task: task?.title,
        task_id: task?.id,
        going_to: task ? taskStops.at(-1)?.place_name : undefined,
        next_stop: eta?.next_seq != null ? taskStops.find((s) => s.seq === eta.next_seq)?.place_name : undefined,
        eta_next: eta?.next_eta_at ? colomboTime(eta.next_eta_at) : undefined,
        eta_final: eta?.final_eta_at ? colomboTime(eta.final_eta_at) : undefined,
        late_min: eta && eta.late_min > 0 ? eta.late_min : undefined,
        // Part 3b (H4): what the driver said ("Running late 15 min · said 08:52").
        late_report: task ? lateReportOf(task, now) : undefined,
        // Part 3b (H2), for the people who dispatch.
        usual_start: presence.get(e.id)?.usual_start,
        next_task: presence.get(e.id)?.next_task,
        not_available: (() => {
          const u = awayNow.find((a) => a.employee_id === e.id);
          return u ? notAvailableNow(u, now) : undefined;
        })(),
        // The position itself (the web map draws it; the maps link stays for Claude), and the heading the marker turns to.
        lat: hasPosition ? pos.lat! : undefined,
        lng: hasPosition ? pos.lng! : undefined,
        heading: hasPosition && pos.heading != null ? Math.round(pos.heading) : undefined,
        links: { maps: hasPosition ? mapsPoint(pos.lat!, pos.lng!) : undefined, ...(phones ? contactLinks(e.phone) : {}) },
        minutes: share.minutes ?? Number.MAX_SAFE_INTEGER,
      };
    }));

    const order = { sharing: 0, stale: 1, not_sharing: 2 };
    const dutyOrder = { on_task: 0, on_duty: 1, off_duty: 2 };
    const count = (state: string) => cards.filter((c) => c.state === state).length;
    const countStatus = (status: string) => cards.filter((c) => c.status === status).length;
    const countDuty = (duty: string) => cards.filter((c) => c.duty === duty).length;
    const drivers = cards
      .filter((c) =>
        filter === "all" || c.state === filter || c.status === filter || c.duty === filter ||
        (filter === "on_duty" && c.duty === "on_task")
      )
      .sort((a, b) => dutyOrder[a.duty] - dutyOrder[b.duty] || order[a.state] - order[b.state] || a.minutes - b.minutes)
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
        duty_counts: { on_task: countDuty("on_task"), on_duty: countDuty("on_duty"), off_duty: countDuty("off_duty") },
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
    "10 minutes (near which town), gaps of over 10 minutes (no_gps: the phone was alive with no GPS signal; no_data: the app " +
    "was not running) and legs uploaded later (the phone was offline), and the route line thinned by shape (corners kept) " +
    "for a map, each point with its accuracy. Only covers the time location sharing was on.",
  readOnly: true,
  input: z.object({
    driver: zText(80).optional().describe("Username, code or name. Not needed with task_id."),
    date: zDate.optional().describe("Default: today. Ignored with task_id."),
    task_id: zId.optional().describe("One task's time: from Start task to Save & finish, or now if it is still running"),
    from: zTime.optional().describe("HH:MM: start of the window on the date"),
    to: zTime.optional().describe("HH:MM: end of the window on the date"),
    line_tolerance_m: z.number().min(0).max(500).optional()
      .describe(
        "How closely the line follows the points, in metres (Douglas–Peucker; default 12 for Claude; 0 removes nothing up to max_line_points and above that uses the smallest tolerance that fits: the web maps pass 0)",
      ),
    max_line_points: z.number().int().min(50).max(10000).optional().describe("At most this many points on the line (default 3000)"),
    snap: z.boolean().optional().describe(
      "Also answer the driving legs snapped to roads (route_snapped) when the map_matching setting names a provider",
    ),
    estimate_gaps: z.boolean().optional().describe(
      "Also answer `estimated`: for each gap of over 300 m and 60 s between two points, the likely road (openrouteservice, cached; for a map, never km)",
    ),
    // Round 48 snap hotfix: which screen asks, counted with each Google Roads call (routing_usage sources).
    source: z.enum(["site_route", "site_live", "site_task", "app_route", "app_live", "app_task"]).optional().describe(
      "The screen asking (the web clients send it): counted with each snap-to-roads call so usage reads by source",
    ),
  }),
  async run({ driver, date, task_id, from, to, line_tolerance_m, max_line_points, snap, estimate_gaps, source: sourceArg }, { db, now, actor }) {
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

    const [rows, beats, settings] = await Promise.all([
      fetchAll(
        (a, b) =>
          db.from("location_points").select("id, recorded_at, lat, lng, speed_mps, accuracy_m, received_at")
            .eq("employee_id", who.id).gte("recorded_at", fromIso).lte("recorded_at", toIso)
            .order("recorded_at").order("id").range(a, b),
        "location points",
        40000,
      ),
      fetchAll(
        (a, b) =>
          db.from("driver_heartbeats").select("at, location_restarts").eq("employee_id", who.id).gte("at", fromIso).lte("at", toIso)
            .order("at").range(a, b),
        "heartbeats",
        5000,
      ),
      loadSettings(db),
    ]);
    const window = { from: colomboDateTime(fromIso), to: colomboDateTime(toIso) };
    // The phone's watchdog restarted the location service this often in the window (no position for 90 s while moving).
    const restarts = beats.reduce((s, b) => s + (b.location_restarts ?? 0), 0) || undefined;
    if (rows.length === 0) {
      // Round 4–7 (item 9): a day older than the points' period answers its summary (km, driving, stops, first and last).
      const kept = task ? null : unwrapMaybe(
        await db.from("driver_day_summaries").select("*").eq("employee_id", who.id).eq("day", day).maybeSingle(),
        "day summary",
      );
      if (kept) {
        return {
          result: {
            driver: who.name,
            date: day,
            window,
            summary_only: true,
            km: Number(kept.km),
            driving_minutes: kept.driving_min,
            stopped_minutes: kept.stopped_min,
            stops: kept.stops,
            first_point: kept.first_at ? colomboTime(kept.first_at) : undefined,
            last_point: kept.last_at ? colomboTime(kept.last_at) : undefined,
            points_stored: kept.points,
            note: "Older than the location points are kept: the day's summary only (no line, no stops on a map).",
          },
          summary: `route ${who.name} ${day}: the day's summary (${kept.km} km)`,
        };
      }
      return {
        result: {
          driver: who.name,
          date: day,
          window,
          task,
          recorded_points: 0,
          points_stored: 0,
          points_shown: 0,
          heartbeats: beats.length,
          location_restarts: restarts,
          note: beats.length
            ? "No position was recorded in this time; the phone was on duty with no GPS signal."
            : "No location was shared in this time.",
        },
        summary: `route ${who.name} ${day}: no points`,
      };
    }
    const fixes: RouteFix[] = rows.map((r) => ({
      at: new Date(r.recorded_at).getTime(),
      lat: r.lat,
      lng: r.lng,
      speedMps: r.speed_mps,
      accuracyM: r.accuracy_m,
      receivedAt: r.received_at ? new Date(r.received_at).getTime() : null,
    }));
    const route = buildRoute(fixes, {
      simplifyM: line_tolerance_m,
      maxPoints: max_line_points,
      heartbeats: beats.map((b) => new Date(b.at).getTime()),
    });

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
    const KIND_TEXT: Record<Segment["kind"], string> = {
      driving: "Driving",
      stopped: "Stopped",
      no_gps: "Stopped · no GPS signal",
      no_data: "App not running",
    };
    const timeline = await Promise.all(route.segments.map(async (s: Segment) => {
      const near = s.kind === "stopped" && s.lat != null && s.lng != null ? await townOf(s.lat, s.lng) : undefined;
      const uploaded = s.uploadedAt ? ` · Offline here · uploaded ${t(s.uploadedAt)}` : "";
      const text = s.kind === "driving"
        ? `${t(s.from)}–${t(s.to)} Driving · ${s.km ?? 0} km${uploaded}`
        : s.kind === "stopped"
        ? `${t(s.from)}–${t(s.to)} Stopped${near ? ` near ${near}` : ""}${uploaded}`
        : `${t(s.from)}–${t(s.to)} ${KIND_TEXT[s.kind]}`;
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
        uploaded_at: s.uploadedAt ? new Date(s.uploadedAt).toISOString() : undefined,
        uploaded: s.uploadedAt ? t(s.uploadedAt) : undefined,
        text,
      };
    }));
    const last = rows[rows.length - 1];
    const lastOnLine = route.line[route.line.length - 1];
    const iso = (ms: number) => new Date(ms).toISOString();
    const linePoint = (p: LinePoint) => [t(p.at), p.lat, p.lng, p.kmh, iso(p.at), p.acc ?? null];

    // Snap to roads: the driving legs through Google (the google package, for a Google map only: the Roads terms
    // forbid its lines on any other map; Round 48: never stored, kept 30 minutes in the isolate's memory) or OSRM
    // when the setting names it (kept per leg in route_matched; a leg still growing goes in whole 5 km chunks, its
    // tail raw meanwhile; Phase 7, §26). The website asks it on its Google map; Office mode and /m/ since Round 48.
    const provider = snapProvider(settings, actor.channel);
    let snapped: { provider: string; status: string; legs?: number; matched?: number; source?: string } = { provider, status: "off" };
    let routeSnapped: { columns: string[]; points: (string | number | null)[][] } | undefined;
    if (snap && provider !== "none" && route.line.length > 1) {
      const legs: SnapLeg[] = [];
      for (const s of route.segments) {
        if (s.kind !== "driving") continue;
        const prev = legs[legs.length - 1];
        if (prev && prev.to === s.from) prev.to = s.to; // the pieces of one leg (cut for gaps or late uploads) are one road
        else legs.push({ from: s.from, to: s.to, points: [] });
      }
      // Today's last leg while the driver is still driving is open: its new part goes only in whole chunks.
      const lastSeg = route.segments[route.segments.length - 1];
      const lastLeg = legs[legs.length - 1];
      if (lastLeg && day === colomboDate(now) && lastSeg?.kind === "driving" && lastLeg.to === lastSeg.to) lastLeg.open = true;
      for (const leg of legs) {
        leg.points = route.line.filter((p) => p.at >= leg.from && p.at <= leg.to).map((p) => ({
          at: p.at,
          lat: p.lat,
          lng: p.lng,
          acc: p.acc,
        }));
      }
      const usable = legs.filter((l) => l.points.length >= 2);
      // Round 48 snap hotfix: the source counted with each call ("_playback" for a past day), and the driver's budget.
      const source = `${sourceArg ?? (actor.channel === "claude" ? "claude" : "web")}${day < colomboDate(now) ? "_playback" : ""}`;
      const result = usable.length
        ? await snapLegs(db, who.id, day, provider, usable, now, fetch, settings.google_caps, undefined, {
          source,
          budget: { employeeId: who.id, cap: settings.roads_trip_daily_cap },
        })
        : { status: "ok" as const, legs: [] };
      // The drawn line with every matched leg replaced by its road geometry; the rest raw.
      const out: (LinePoint & { snapped: boolean })[] = [];
      let i = 0;
      for (const leg of result.legs) {
        while (i < route.line.length && route.line[i].at < leg.from) out.push({ ...route.line[i++], snapped: false });
        if (leg.source === "matched" && leg.points.length) {
          const upto = leg.matchedTo ?? leg.to;
          for (const p of leg.points) out.push({ at: p.at, lat: p.lat, lng: p.lng, kmh: 0, acc: null, snapped: true });
          while (i < route.line.length && route.line[i].at <= upto) i++;
        }
        while (i < route.line.length && route.line[i].at <= leg.to) out.push({ ...route.line[i++], snapped: false });
      }
      while (i < route.line.length) out.push({ ...route.line[i++], snapped: false });
      const timed = withSpeeds(out.sort((a, b) => a.at - b.at));
      routeSnapped = {
        columns: ["time", "lat", "lng", "km/h", "at", "acc", "snapped"],
        points: timed.map((p, k) => [...linePoint(p), out[k].snapped ? 1 : 0]),
      };
      snapped = {
        provider,
        status: result.status,
        legs: usable.length,
        matched: result.legs.filter((l) => l.source === "matched").length,
        source,
      };
    }

    // A gap of over 300 m and 60 s: the likely road, dashed on the map (openrouteservice, cached per gap; never km).
    let estimated: { from_at: string; to_at: string; from: string; to: string; km_road?: number; points: [number, number][] }[] | undefined;
    let estimatedNote: string | undefined;
    if (estimate_gaps && route.jumps.length) {
      const got = await estimatedLines(db, settings, route.jumps, now);
      estimated = got.lines.map((l) => ({
        from_at: iso(l.from),
        to_at: iso(l.to),
        from: t(l.from),
        to: t(l.to),
        km_road: l.km ?? undefined,
        points: l.points,
      }));
      estimatedNote = got.note;
    }

    return {
      result: {
        driver: who.name,
        date: day,
        window,
        task,
        recorded_points: rows.length,
        points_stored: route.pointsStored,
        points_shown: route.pointsShown,
        usable_points: route.usable,
        repeated_points: route.repeats,
        outlier_points: route.outliers,
        heartbeats: beats.length,
        location_restarts: restarts,
        first_point: colomboTime(rows[0].recorded_at),
        last_point: colomboTime(last.recorded_at),
        last_position: lastOnLine ? mapsPoint(lastOnLine.lat, lastOnLine.lng) : mapsPoint(last.lat, last.lng),
        km: route.km,
        km_note: GPS_KM_NOTE,
        driving_minutes: route.drivingMinutes,
        stopped_minutes: route.stoppedMinutes,
        stops_count: route.stopsCount,
        stops_over_10_min: stops,
        gaps: route.gaps.map((g) => ({ from: t(g.from), to: t(g.to), minutes: g.minutes, kind: g.kind, text: KIND_TEXT[g.kind] })),
        holes: route.holes.map((h) => ({
          from_at: iso(h.from),
          to_at: iso(h.to),
          minutes: h.minutes,
          kind: h.kind,
          text: `${KIND_TEXT[h.kind]} · ${duration(h.minutes)}`,
        })),
        uploaded_later: route.late.map((w) => ({
          from: t(w.from),
          to: t(w.to),
          uploaded: t(w.uploadedAt),
          from_at: iso(w.from),
          to_at: iso(w.to),
        })),
        timeline,
        route: {
          columns: ["time", "lat", "lng", "km/h", "at", "acc"],
          points: route.line.map(linePoint),
        },
        route_snapped: routeSnapped,
        snapped,
        jumps: estimate_gaps ? route.jumps.length : undefined,
        estimated,
        estimated_note: estimatedNote,
      },
      summary: `route ${who.name} ${day}: ${rows.length} points, ${route.km} km, ${route.stopsCount} stops`,
    };
  },
});
