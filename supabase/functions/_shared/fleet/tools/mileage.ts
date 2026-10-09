// Mileage and fuel for a month, and vehicle problem reports.

import { z } from "zod";
import { fetchAll, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { describeGap, findDriver, findVehicle, gapPlaces, loadGaps, loadRefs, odometerCheck } from "../fleet.ts";
import { centsToLkr, contactLinks } from "../format.ts";
import { PHOTO_LINK_NOTE, photoLinks, photoOrNote } from "../photos.ts";
import { colomboDate, colomboDateTime, monthRange } from "../time.ts";
import { tool, zId, zMonth, zText } from "../tool.ts";

/** A start reading this far from the last logged one means unlogged driving. */
const UNLOGGED_KM = 2;

export const mileageSummary = tool({
  name: "mileage_summary",
  title: "Mileage and fuel for a month",
  description: "Per vehicle for one month: completed tasks and their km, km by odometer against the allowance, fuel in litres and LKR, " +
    '"unlogged km" flags (a task started with an odometer more than 2 km away from the last logged reading), and check_odometer: ' +
    "readings the office should look at (number changed after the photo was read, typed because the photo could not be read, " +
    "typed with no connection and the photo disagrees or is not checked yet), with photo links. " +
    "Km outside tasks per vehicle: between_tasks_km (one reading to the next on the same day) and overnight_km (last reading " +
    "of a day to the first of the next), with the biggest gaps (time window, the driver who had the vehicle, where it was at " +
    "both readings from the photos' GPS). With a driver, the gaps that start with that driver's reading. " +
    "Can be narrowed to one vehicle and/or one driver.",
  readOnly: true,
  input: z.object({
    month: zMonth.optional().describe("YYYY-MM. Default: this month"),
    vehicle: zText(20).optional().describe("Plate"),
    driver: zText(80).optional().describe("Username, code or name"),
  }),
  async run({ month, vehicle, driver }, { db, now }) {
    const which = month ?? colomboDate(now).slice(0, 7);
    const { from, to } = monthRange(which);
    const refs = await loadRefs(db);
    const onlyVehicle = vehicle ? findVehicle(refs, vehicle) : null;
    const onlyDriver = driver ? findDriver(refs, driver) : null;
    const vehicleIds = onlyVehicle ? [onlyVehicle.id] : refs.vehicles.map((v) => v.id);

    const [tasks, fuel, logs, before] = await Promise.all([
      fetchAll((a, b) => {
        let q = db.from("tasks").select("id, title, vehicle_id, employee_id, km, completed_at")
          .eq("status", "completed").gte("completed_at", from).lt("completed_at", to);
        if (onlyVehicle) q = q.eq("vehicle_id", onlyVehicle.id);
        if (onlyDriver) q = q.eq("employee_id", onlyDriver.id);
        return q.order("completed_at").order("id").range(a, b);
      }, "tasks"),
      fetchAll((a, b) => {
        let q = db.from("fuel_logs").select("id, vehicle_id, employee_id, litres, amount_cents")
          .gte("logged_at", from).lt("logged_at", to);
        if (onlyVehicle) q = q.eq("vehicle_id", onlyVehicle.id);
        if (onlyDriver) q = q.eq("employee_id", onlyDriver.id);
        return q.order("logged_at").order("id").range(a, b);
      }, "fuel logs"),
      // Every reading of the month for these vehicles, whoever logged it: the
      // reading before a task start may have come from another driver.
      vehicleIds.length > 0
        ? fetchAll((a, b) =>
          db.from("odometer_logs").select(
            "id, vehicle_id, employee_id, task_id, kind, reading_km, logged_at, entry, ai_value, ai_status, ai_checked_at, flag, photo_id",
          )
            .in("vehicle_id", vehicleIds).gte("logged_at", from).lt("logged_at", to)
            .order("logged_at").order("id").range(a, b), "odometer logs")
        : [],
      Promise.all(vehicleIds.map(async (id) => {
        const rows = unwrap(
          await db.from("odometer_logs").select("reading_km").eq("vehicle_id", id).lt("logged_at", from)
            .order("logged_at", { ascending: false }).limit(1),
          "odometer logs",
        );
        return [id, rows[0]?.reading_km ?? null] as const;
      })),
    ]);

    const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));
    const previous = new Map<string, number | null>(before);
    const firstReading = new Map<string, number>();
    const lastReading = new Map<string, number>();
    const flags: Record<string, unknown>[] = [];
    for (const log of logs) {
      const prev = previous.get(log.vehicle_id) ?? null;
      const gap = prev === null ? 0 : log.reading_km - prev;
      if (log.kind === "task_start" && Math.abs(gap) > UNLOGGED_KM && (!onlyDriver || log.employee_id === onlyDriver.id)) {
        flags.push({
          at: colomboDateTime(log.logged_at),
          vehicle: refs.veh.get(log.vehicle_id)?.reg_no,
          driver: refs.emp.get(log.employee_id)?.name,
          task: log.task_id ? taskTitle.get(log.task_id) : undefined,
          task_id: log.task_id,
          last_logged_km: prev,
          start_km: log.reading_km,
          unlogged_km: gap,
        });
      }
      if (!firstReading.has(log.vehicle_id)) firstReading.set(log.vehicle_id, log.reading_km);
      lastReading.set(log.vehicle_id, log.reading_km);
      previous.set(log.vehicle_id, log.reading_km);
    }
    const baseline = new Map(before);

    // Km nobody drove inside a task: between one reading and the next.
    const allGaps = await loadGaps(db, vehicleIds, from, to);
    const gaps = onlyDriver ? allGaps.filter((g) => g.from.employee_id === onlyDriver.id) : allGaps;
    const gapKm = (vehicleId: string, type: "between_tasks" | "overnight") =>
      gaps.filter((g) => g.vehicle_id === vehicleId && g.type === type).reduce((sum, g) => sum + g.km, 0);
    const biggest = [...gaps].filter((g) => g.km > 0).sort((a, b) => b.km - a.km).slice(0, 10);
    const places = await gapPlaces(db, biggest);
    const biggestGaps = biggest.map((g) => describeGap(g, refs, places, (id) => id ? taskTitle.get(id) : undefined));

    // Readings the office should look at, with their photos.
    const checks = logs.filter((l) => (!onlyDriver || l.employee_id === onlyDriver.id) && odometerCheck(l) !== null);
    const checkLinks = await photoLinks(db, { ids: checks.flatMap((l) => l.photo_id ? [l.photo_id] : []) });
    const checkOdometer = checks.map((l) => ({
      at: colomboDateTime(l.logged_at),
      vehicle: refs.veh.get(l.vehicle_id)?.reg_no,
      driver: refs.emp.get(l.employee_id)?.name,
      task: l.task_id ? taskTitle.get(l.task_id) : undefined,
      task_id: l.task_id,
      kind: l.kind,
      reading_km: l.reading_km,
      photo_reading: l.ai_value,
      photo_status: l.ai_status,
      entry: l.entry,
      reason: odometerCheck(l),
      photo: photoOrNote(checkLinks, l.photo_id),
    }));

    const rows = vehicleIds.map((id) => {
      const v = refs.veh.get(id)!;
      const mine = tasks.filter((t) => t.vehicle_id === id);
      const myFuel = fuel.filter((f) => f.vehicle_id === id);
      const taskKm = mine.reduce((sum, t) => sum + (t.km ?? 0), 0);
      const end = lastReading.get(id);
      const start = baseline.get(id) ?? firstReading.get(id);
      const odometerKm = end != null && start != null ? Math.max(0, end - start) : 0;
      return {
        vehicle: v.reg_no,
        tasks: mine.length,
        task_km: taskKm,
        // The odometer figures describe the whole vehicle, so they are left out when looking at one driver.
        odometer_km: onlyDriver ? undefined : odometerKm,
        km_allowance: onlyDriver ? undefined : v.monthly_km_allowance,
        over_allowance: !onlyDriver && v.monthly_km_allowance != null && odometerKm > v.monthly_km_allowance ? true : undefined,
        km_outside_tasks: !onlyDriver && odometerKm - taskKm > UNLOGGED_KM ? odometerKm - taskKm : undefined,
        between_tasks_km: gapKm(id, "between_tasks"),
        overnight_km: gapKm(id, "overnight"),
        fuel_litres: Math.round(myFuel.reduce((sum, f) => sum + Number(f.litres ?? 0), 0) * 100) / 100,
        fuel_lkr: centsToLkr(myFuel.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0)),
        fuel_entries: myFuel.length,
      };
    }).filter((row) =>
      onlyVehicle || row.tasks > 0 || row.fuel_entries > 0 || (row.odometer_km ?? 0) > 0 || row.between_tasks_km > 0 || row.overnight_km > 0
    );

    const total = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
    return {
      result: {
        month: which,
        vehicle: onlyVehicle?.reg_no,
        driver: onlyDriver?.name,
        totals: {
          tasks: total((r) => r.tasks),
          task_km: total((r) => r.task_km),
          fuel_litres: Math.round(total((r) => r.fuel_litres) * 100) / 100,
          fuel_lkr: total((r) => r.fuel_lkr ?? 0),
          unlogged_km_flags: flags.length,
          check_odometer: checkOdometer.length,
          between_tasks_km: total((r) => r.between_tasks_km),
          overnight_km: total((r) => r.overnight_km),
        },
        vehicles: rows,
        biggest_gaps: biggestGaps,
        unlogged_km: flags,
        check_odometer: checkOdometer,
        photo_links: checkOdometer.length > 0 ? PHOTO_LINK_NOTE : undefined,
      },
      summary: `mileage ${which}: ${rows.length} vehicles, ${total((r) => r.task_km)} task km, ` +
        `${total((r) => r.between_tasks_km)} km between tasks, ${total((r) => r.overnight_km)} km overnight, ` +
        `${flags.length} unlogged flags, ${checkOdometer.length} odometer checks`,
    };
  },
});

export const listVehicleReports = tool({
  name: "list_vehicle_reports",
  title: "Vehicle problem reports",
  description: "Problems drivers reported (breakdown, accident, tyre, warning light, other) with their photos (links valid 1 hour). " +
    "By default the ones not closed yet.",
  readOnly: true,
  input: z.object({
    status: z.enum(["not_closed", "open", "in_garage", "closed", "all"]).optional().describe("Default: not_closed"),
  }),
  async run({ status = "not_closed" }, { db }) {
    let query = db.from("vehicle_reports").select("*");
    if (status === "not_closed") query = query.neq("status", "closed");
    else if (status !== "all") query = query.eq("status", status);
    const [refs, reports] = await Promise.all([
      loadRefs(db),
      query.order("created_at", { ascending: false }).limit(50),
    ]);
    const rows = unwrap(reports, "vehicle reports");
    const links = await photoLinks(db, { reportIds: rows.map((r) => r.id) });

    return {
      result: {
        status,
        count: rows.length,
        reports: rows.map((r) => {
          const driver = refs.emp.get(r.employee_id);
          const vehicle = refs.veh.get(r.vehicle_id);
          return {
            id: r.id,
            reported: colomboDateTime(r.created_at),
            vehicle: vehicle?.reg_no,
            vehicle_in_garage: vehicle?.in_garage ? true : undefined,
            driver: driver?.name,
            category: r.category,
            note: r.note,
            status: r.status,
            office_note: r.office_note,
            closed: r.closed_at ? colomboDateTime(r.closed_at) : undefined,
            task_id: r.task_id,
            photos: links.byReport.get(r.id) ?? [],
            driver_links: contactLinks(driver?.phone),
          };
        }),
        photo_links: PHOTO_LINK_NOTE,
      },
      summary: `${rows.length} vehicle reports (${status})`,
    };
  },
});

export const updateVehicleReport = tool({
  name: "update_vehicle_report",
  title: "Update a vehicle problem report",
  description: "Sets a report to open, in_garage or closed, with an optional office note the driver can read. " +
    "This does not change the vehicle itself: use update_vehicle (in_garage) to take the vehicle off the road.",
  readOnly: false,
  input: z.object({
    id: zId,
    status: z.enum(["open", "in_garage", "closed"]),
    office_note: zText(500).optional(),
  }),
  async run({ id, status, office_note }, { db, now }) {
    const report = unwrapMaybe(await db.from("vehicle_reports").select("*").eq("id", id).maybeSingle(), "vehicle report");
    if (!report) throw new ToolError(`No vehicle report has the id ${id}. Use list_vehicle_reports to find it.`);

    const updated = unwrap(
      await db.from("vehicle_reports").update({
        status,
        closed_at: status === "closed" ? report.closed_at ?? now.toISOString() : null,
        ...(office_note !== undefined && { office_note }),
      }).eq("id", id).select("*").single(),
      "vehicle report",
    );
    const vehicle = unwrapMaybe(await db.from("vehicles").select("reg_no, in_garage").eq("id", report.vehicle_id).maybeSingle(), "vehicle");
    return {
      result: {
        id: updated.id,
        vehicle: vehicle?.reg_no,
        category: updated.category,
        status: updated.status,
        office_note: updated.office_note,
        vehicle_marked_in_garage: vehicle?.in_garage ?? false,
        note: status === "in_garage" && !vehicle?.in_garage
          ? `${vehicle?.reg_no} is not marked as in the garage yet. Use update_vehicle with in_garage=true if it is off the road.`
          : status === "closed" && vehicle?.in_garage
          ? `${vehicle.reg_no} is still marked as in the garage. Use update_vehicle with in_garage=false when it is back.`
          : undefined,
      },
      summary: `report ${id} (${vehicle?.reg_no ?? "?"}) -> ${status}`,
    };
  },
});
