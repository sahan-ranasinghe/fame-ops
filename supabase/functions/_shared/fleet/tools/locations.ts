// Live locations and a driver's route for a day.

import { z } from "zod";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { type Employee, findDriver, loadLatest, loadRefs, nearestTown, sharing, statusOf, vehicleLabel } from "../fleet.ts";
import { contactLinks, kmh, mapsPoint } from "../format.ts";
import { taskEta } from "../eta.ts";
import { GPS_KM_NOTE } from "../geo.ts";
import { loadSettings } from "../settings.ts";
import { snapLegs, type SnapLeg } from "../matching.ts";
import { buildRoute, type LinePoint, type RouteFix, type Segment, withSpeeds } from "../route.ts";
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
    const [refs, latest, settings, running, openSessions] = await Promise.all([
      loadRefs(db),
      loadLatest(db),
      loadSettings(db),
      db.from("tasks").select("id, title, employee_id, vehicle_id, status, return_to_base, avoid_expressway").eq("status", "in_progress"),
      db.from("duty_sessions").select("employee_id, vehicle_id, started_at").is("ended_at", null),
    ]);
    const tasks = unwrap(running, "tasks");
    const sessions = unwrap(openSessions, "sharing periods");
    const stops = tasks.length > 0
      ? unwrap(
        await db.from("task_stops").select("task_id, seq, place_name, type, what, status, lat, lng, dwell_min, arrive_by")
          .in("task_id", tasks.map((t) => t.id)).neq("status", "removed").order("seq"),
        "stops",
      )
      : [];

    const shown = refs.employees.filter((e) =>
      e.role === "driver" && e.active && (latest.get(e.id)?.sharing || tasks.some((t) => t.employee_id === e.id))
    );
    const cards = await Promise.all(shown.map(async (e) => {
      const pos = latest.get(e.id);
      const share = sharing(pos, now);
      const { fields } = statusOf(pos, now);
      const task = tasks.find((t) => t.employee_id === e.id);
      const session = sessions.find((s) => s.employee_id === e.id);
      const vehicleId = task?.vehicle_id ?? session?.vehicle_id ?? e.current_vehicle_id;
      const hasPosition = pos?.lat != null && pos?.lng != null;
      const taskStops = task ? stops.filter((s) => s.task_id === task.id) : [];
      const eta = task ? await taskEta(db, task, taskStops, pos, settings, now) : null;
      return {
        driver: e.name,
        username: e.username,
        employee_id: e.id,
        state: share.state,
        location: share.text,
        ...fields,
        updated: pos?.recorded_at ? colomboDateTime(pos.recorded_at) : undefined,
        on_duty_since: session?.started_at ? colomboTime(session.started_at) : undefined,
        near: hasPosition ? await nearestTown(db, pos.lat!, pos.lng!) : undefined,
        speed_kmh: share.state === "sharing" ? kmh(pos?.speed_mps) : undefined,
        battery_pct: pos?.battery_pct,
        source: "Fame Driver app",
        vehicle: vehicleId ? vehicleLabel(refs.veh.get(vehicleId)) : undefined,
        task: task?.title,
        going_to: task ? taskStops.at(-1)?.place_name : undefined,
        next_stop: eta?.next_seq != null ? taskStops.find((s) => s.seq === eta.next_seq)?.place_name : undefined,
        eta_next: eta?.next_eta_at ? colomboTime(eta.next_eta_at) : undefined,
        eta_final: eta?.final_eta_at ? colomboTime(eta.final_eta_at) : undefined,
        late_min: eta && eta.late_min > 0 ? eta.late_min : undefined,
        // The position itself (the web map draws it; the maps link stays for Claude), and the heading the marker turns to.
        lat: hasPosition ? pos.lat! : undefined,
        lng: hasPosition ? pos.lng! : undefined,
        heading: hasPosition && pos.heading != null ? Math.round(pos.heading) : undefined,
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
    line_tolerance_m: z.number().min(0.5).max(500).optional()
      .describe("How closely the line follows the points, in metres (Douglas–Peucker; default 12, the web map uses 3)"),
    max_line_points: z.number().int().min(50).max(10000).optional().describe("At most this many points on the line (default 3000)"),
    snap: z.boolean().optional().describe("Also answer the driving legs snapped to roads (route_snapped) when the map_matching setting names a provider"),
  }),
  async run({ driver, date, task_id, from, to, line_tolerance_m, max_line_points, snap }, { db, now }) {
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
          db.from("driver_heartbeats").select("at").eq("employee_id", who.id).gte("at", fromIso).lte("at", toIso)
            .order("at").range(a, b),
        "heartbeats",
        5000,
      ),
      loadSettings(db),
    ]);
    const window = { from: colomboDateTime(fromIso), to: colomboDateTime(toIso) };
    if (rows.length === 0) {
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
          note: beats.length ? "No position was recorded in this time; the phone was on duty with no GPS signal." : "No location was shared in this time.",
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
    const KIND_TEXT: Record<Segment["kind"], string> = { driving: "Driving", stopped: "Stopped", no_gps: "Stopped · no GPS signal", no_data: "App not running" };
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

    // Snap to roads: the driving legs through the provider the setting names (stored per leg, re-matched at most every 2 minutes).
    const provider = settings.map_matching.provider;
    let snapped: { provider: string; status: string; legs?: number; matched?: number } = { provider, status: "off" };
    let routeSnapped: { columns: string[]; points: (string | number | null)[][] } | undefined;
    if (snap && provider !== "none" && route.line.length > 1) {
      const legs: SnapLeg[] = [];
      for (const s of route.segments) {
        if (s.kind !== "driving") continue;
        const prev = legs[legs.length - 1];
        if (prev && prev.to === s.from) prev.to = s.to; // the pieces of one leg (cut for gaps or late uploads) are one road
        else legs.push({ from: s.from, to: s.to, points: [] });
      }
      for (const leg of legs) leg.points = route.line.filter((p) => p.at >= leg.from && p.at <= leg.to).map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, acc: p.acc }));
      const usable = legs.filter((l) => l.points.length >= 2);
      const result = usable.length ? await snapLegs(db, who.id, day, provider, usable, now) : { status: "ok" as const, legs: [] };
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
      snapped = { provider, status: result.status, legs: usable.length, matched: result.legs.filter((l) => l.source === "matched").length };
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
          text: `${KIND_TEXT[h.kind]} · ${h.minutes} min`,
        })),
        uploaded_later: route.late.map((w) => ({ from: t(w.from), to: t(w.to), uploaded: t(w.uploadedAt), from_at: iso(w.from), to_at: iso(w.to) })),
        timeline,
        route: {
          columns: ["time", "lat", "lng", "km/h", "at", "acc"],
          points: route.line.map(linePoint),
        },
        route_snapped: routeSnapped,
        snapped,
      },
      summary: `route ${who.name} ${day}: ${rows.length} points, ${route.km} km, ${route.stopsCount} stops`,
    };
  },
});
