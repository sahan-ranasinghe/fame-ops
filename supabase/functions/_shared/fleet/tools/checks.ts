// Round 4–7, feature 4 (Sahan, 22 October 2026): the vehicle check before work (Samsara / Motive's pre-trip inspection,
// Turo's check-in) and the close of a trip nobody drives with the app (Zipcar's and Turo's return). The driver app writes
// its checks itself (RLS, the offline queue); these tools are the office's view of them and the self-driver's own side:
// the person a self-drive or someone-else trip is on checks the vehicle before setting off and enters the odometer at the
// end, in Office mode, /m/ or the site. The rules: checks.ts.

import { z } from "zod";
import { type Db, type Row, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { type Employee, findVehicle, loadRefs, type Refs, vehicleLabel } from "../fleet.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { photoLinks } from "../photos.ts";
import { loadSettings } from "../settings.ts";
import { colomboDate, colomboDayTime, colomboTime, dayRange } from "../time.ts";
import { daySpan, realDate, tool, zDate, zId, zPaging, zText } from "../tool.ts";
import {
  CATEGORY_TEXT,
  CHECK_HOW_TEXT,
  MAX_PROBLEM_PHOTOS,
  MIN_PROBLEM_PHOTOS,
  noAppState,
  odometerProblem,
  REPORT_CATEGORIES,
  type ReportCategory,
  resultText,
  SIDES,
  tripWindow,
} from "../checks.ts";

type Check = Row<"vehicle_checks">;
type Task = Row<"tasks">;

/** Anyone by name, username, code or e-mail (a check is a driver's or an office self-driver's). */
function findAnyone(refs: Refs, typed: string): Employee {
  const want = typed.trim().toLowerCase();
  const people = refs.employees;
  const exact = people.filter((e) =>
    e.name.toLowerCase() === want || (e.username ?? "").toLowerCase() === want || e.code.toLowerCase() === want ||
    (e.email ?? "").toLowerCase() === want
  );
  const found = exact.length ? exact : people.filter((e) => e.name.toLowerCase().includes(want));
  if (found.length === 1) return found[0];
  if (found.length === 0) throw new ToolError(`Nobody matches "${typed}".`);
  throw new ToolError(`"${typed}" matches more than one person: ${found.slice(0, 8).map((e) => e.name).join("; ")}. Be more specific.`);
}

/** The checks as the office reads them, with their report and, for vehicles or issues, the photo links. */
export async function checkCards(db: Db, refs: Refs, checks: readonly Check[], withPhotos: boolean) {
  const ids = checks.map((c) => c.id);
  const reports = ids.length
    ? unwrap(await db.from("vehicle_reports").select("id, check_id, category, note, status").in("check_id", ids), "vehicle reports")
    : [];
  const byCheck = new Map(reports.map((r) => [r.check_id!, r]));
  const links = withPhotos && ids.length
    ? await photoLinks(db, { checkIds: ids, reportIds: reports.map((r) => r.id) })
    : null;
  const taskIds = [...new Set(checks.flatMap((c) => (c.task_id ? [c.task_id] : [])))];
  const tasks = taskIds.length ? unwrap(await db.from("tasks").select("id, title").in("id", taskIds), "tasks") : [];
  const title = new Map(tasks.map((t) => [t.id, t.title]));
  return checks.map((c) => {
    const r = byCheck.get(c.id);
    const v = refs.veh.get(c.vehicle_id);
    return {
      id: c.id,
      date: colomboDate(c.checked_at),
      at: colomboTime(c.checked_at),
      when: colomboDayTime(c.checked_at),
      vehicle: v?.reg_no ?? null,
      vehicle_label: vehicleLabel(v),
      person: refs.emp.get(c.employee_id)?.name ?? null,
      employee_id: c.employee_id,
      result: c.result,
      result_text: resultText(c.result, r?.category),
      odometer_km: c.odometer_km,
      how: c.how,
      how_text: CHECK_HOW_TEXT[c.how] ?? c.how,
      channel: c.channel,
      ...(c.task_id && { task: { id: c.task_id, title: title.get(c.task_id) ?? null } }),
      ...(r && {
        report: {
          id: r.id,
          category: r.category,
          category_text: CATEGORY_TEXT[r.category as ReportCategory] ?? r.category,
          note: r.note,
          status: r.status,
        },
      }),
      ...(links && {
        photos: [
          ...(links.byCheck.get(c.id) ?? []),
          ...(r ? (links.byReport.get(r.id) ?? []).map((url) => ({ url, side: null })) : []),
        ],
      }),
    };
  });
}

/** Today's check of each vehicle, newest (list_vehicles' check_today; the vehicle page). */
export async function checksToday(db: Db, refs: Refs, vehicleIds: readonly string[], now: Date) {
  const out = new Map<string, { result: string; result_text: string; at: string; by: string | null; report_id?: string }>();
  if (!vehicleIds.length) return out;
  const day = dayRange(colomboDate(now));
  const rows = unwrap(
    await db.from("vehicle_checks").select("*").in("vehicle_id", [...vehicleIds]).gte("checked_at", day.from).lt("checked_at", day.to)
      .eq("demo", false).order("checked_at", { ascending: false }),
    "vehicle checks",
  );
  const latest = rows.filter((c, i) => rows.findIndex((x) => x.vehicle_id === c.vehicle_id) === i);
  const reports = latest.some((c) => c.result === "problem")
    ? unwrap(
      await db.from("vehicle_reports").select("id, check_id, category").in("check_id", latest.map((c) => c.id)),
      "vehicle reports",
    )
    : [];
  for (const c of latest) {
    const r = reports.find((x) => x.check_id === c.id);
    out.set(c.vehicle_id, {
      result: c.result,
      result_text: resultText(c.result, r?.category),
      at: colomboTime(c.checked_at),
      by: refs.emp.get(c.employee_id)?.name ?? null,
      ...(r && { report_id: r.id }),
    });
  }
  return out;
}

export const vehicleChecks = tool({
  name: "vehicle_checks",
  title: "Vehicle checks",
  description: "The vehicle checks before work (Round 4–7): whenever a driver takes a vehicle (Start work, Change vehicle, " +
    "Start task, the vehicle confirmed on the day), and before a self-drive or someone-else trip, the person answers " +
    '"Any damage or problem with <plate>?": All good, or a problem with a category and photos that became a pre-trip vehicle ' +
    "report (and an issue). For one day (default today) or a range, newest first: who, when, the vehicle, the result, the " +
    "odometer, how, the trip, the report. Photo links (1 hour) only for the vehicles or issues permission.",
  readOnly: true,
  input: z.object({
    vehicle: zText(40).optional().describe("A plate (spaces and dashes do not matter)"),
    person: zText(80).optional().describe("The driver or self-driver: name, username or e-mail"),
    date: zDate.optional().describe("One day (default today)"),
    from: zDate.optional().describe("First day of a range (with to)"),
    to: zDate.optional().describe("Last day of a range"),
    result: z.enum(["ok", "problem"]).optional(),
    ...zPaging,
  }),
  async run({ vehicle, person, date, from, to, result, limit, cursor }, { db, now, actor }) {
    const span = daySpan(from, to, 92) ?? (() => {
      const d = realDate(date ?? colomboDate(now));
      return { from: d, to: d, start: dayRange(d).from, end: dayRange(d).to };
    })();
    const refs = await loadRefs(db);
    let q = db.from("vehicle_checks").select("*").gte("checked_at", span.start).lt("checked_at", span.end).eq("demo", false)
      .order("checked_at", { ascending: false }).limit(1000);
    if (vehicle) q = q.eq("vehicle_id", findVehicle(refs, vehicle).id);
    if (person) q = q.eq("employee_id", findAnyone(refs, person).id);
    if (result) q = q.eq("result", result);
    const rows = unwrap(await q, "vehicle checks");
    const page = pageOf(rows, pageWindow(limit, cursor));
    const withPhotos = actor.permissions.includes("vehicles") || actor.permissions.includes("issues");
    const checks = await checkCards(db, refs, page.rows, withPhotos);
    return {
      result: {
        from: span.from,
        to: span.to,
        count: checks.length,
        total: page.total,
        next: page.next,
        problems: rows.filter((c) => c.result === "problem").length,
        checks,
      },
      summary: `${checks.length} vehicle checks ${span.from}..${span.to}`,
    };
  },
});

// ---- The self-driver's side: a trip nobody drives with the app ----------------------------------------------------

/** The person's own no-app trip (self-drive, or booked for someone else), or a clear refusal. */
async function ownNoAppTrip(db: Db, taskId: string, employeeId: string | null): Promise<Task> {
  if (!employeeId) throw new ToolError("This is personal: it needs a signed-in person (the web app) or a personal connector key.");
  const t = unwrapMaybe(await db.from("tasks").select("*").eq("id", taskId).maybeSingle(), "task");
  if (!t || t.employee_id !== employeeId) throw new ToolError("Not one of your trips.");
  if (t.driven_by === "driver") throw new ToolError("A driver does this trip: the driver checks the vehicle in the app.");
  if (!t.vehicle_id) throw new ToolError("This trip has no vehicle yet.");
  return t;
}

/** The vehicle's last odometer reading (the prefilled number; never under it). */
async function lastReading(db: Db, vehicleId: string): Promise<number | null> {
  const v = unwrapMaybe(await db.from("vehicles").select("current_odometer_km").eq("id", vehicleId).maybeSingle(), "vehicle");
  return v?.current_odometer_km ?? null;
}

/** The person's own photos (uploaded to their own folder by the page), unused, of one kind: or a refusal. */
async function ownPhotos(db: Db, employeeId: string, ids: readonly string[], kind: string): Promise<void> {
  if (!ids.length) return;
  const rows = unwrap(
    await db.from("photos").select("id, employee_id, kind, odometer_log_id, fuel_log_id, vehicle_report_id, claim_line_id, vehicle_check_id")
      .in("id", [...ids]),
    "photos",
  );
  const ok = rows.filter((p) =>
    p.employee_id === employeeId && p.kind === kind && !p.odometer_log_id && !p.fuel_log_id && !p.vehicle_report_id &&
    !p.claim_line_id && !p.vehicle_check_id
  );
  if (ok.length !== new Set(ids).size) throw new ToolError("A photo is not yours, not uploaded yet, or already used. Take it again.");
}

async function tripStops(db: Db, taskId: string) {
  const stops = unwrap(
    await db.from("task_stops").select("seq, type, place_name, status").eq("task_id", taskId).neq("status", "removed").order("seq"),
    "stops",
  );
  return stops.map((s, i) => ({ n: i + 1, type: s.type, place: s.place_name }));
}

/** The trip page's answer (my_trip, and what my_trip_check / finish_my_trip answer after they write). */
async function tripView(db: Db, t: Task, now: Date) {
  const refs = await loadRefs(db);
  const v = refs.veh.get(t.vehicle_id ?? "");
  const [stops, checks, settings] = await Promise.all([
    tripStops(db, t.id),
    db.from("vehicle_checks").select("*").eq("task_id", t.id).order("checked_at", { ascending: false }).limit(1),
    loadSettings(db),
  ]);
  const check = unwrap(checks, "vehicle checks")[0];
  const state = noAppState(t);
  const window = tripWindow(t.start_at, now);
  const flag = t.finish_flag as { kind?: string } | null;
  const plannedKm = ((t.plan_json as { legs?: { km?: number; to_seq?: number }[] } | null)?.legs ?? [])
    .reduce((sum, l) => sum + (l.km ?? 0), 0);
  return {
    task_id: t.id,
    title: t.title,
    date: colomboDate(t.start_at),
    leave_at: colomboTime(t.leave_by ?? t.start_at),
    ...(t.end_by && { back_by: colomboTime(t.end_by), back_by_date: colomboDate(t.end_by) }),
    vehicle: v?.reg_no ?? null,
    vehicle_label: vehicleLabel(v),
    driven_by: t.driven_by,
    ...(t.driven_by === "other" && { driver_name: t.driver_name, driver_phone: t.driver_phone }),
    stops,
    ...(plannedKm > 0 && { planned_km: Math.round(plannedKm) }),
    state,
    ...(flag?.kind === "not_confirmed" && { not_confirmed: true }),
    started: t.started_at ? colomboTime(t.started_at) : null,
    start_odometer_km: t.start_odometer_km,
    end_odometer_km: t.end_odometer_km,
    km: t.km,
    last_odometer_km: v?.current_odometer_km ?? null,
    // The check of the day starts the trip from 2 h before its planned start; earlier it only records the check.
    window: { opens_at: window.opens_at, open: window.open, past: window.past },
    check_needed: settings.vehicle_check,
    ...(check && {
      check: {
        id: check.id,
        at: colomboTime(check.checked_at),
        date: colomboDate(check.checked_at),
        result: check.result,
        odometer_km: check.odometer_km,
      },
    }),
    can: {
      check: state === "to_check",
      finish: state === "to_check" || state === "on_the_way" || state === "finish" || state === "not_confirmed",
    },
    ...(t.finish_ask_sent_at && { finish_asked: colomboDayTime(t.finish_ask_sent_at) }),
  };
}

export const myTrip = tool({
  name: "my_trip",
  title: "My trip",
  description: "One of the person's own trips that nobody drives with the app (I'll drive myself, or Someone else): the trip " +
    "(day, leave time, back-by, the vehicle, the stops), where it is (to_check, on_the_way, finish, done, not_confirmed), the " +
    "check of the day, the readings and what can be done now: the vehicle check before setting off (it starts the trip from " +
    "2 h before the planned start, on the trip's day) and \"Trip finished? Enter the odometer\". Personal.",
  readOnly: true,
  input: z.object({ task_id: zId }),
  async run({ task_id }, { db, now, actor }) {
    const t = await ownNoAppTrip(db, task_id, actor.employeeId);
    const trip = await tripView(db, t, now);
    return { result: trip, summary: `trip ${t.title} (${trip.state})` };
  },
});

export const myTripCheck = tool({
  name: "my_trip_check",
  title: "Vehicle check before my trip",
  description: "The person's own vehicle check before a trip they drive themselves or booked for someone else: " +
    '"Any damage or problem with <plate>?" result ok (all good) or problem (a category: breakdown, accident, tyre, ' +
    "warning_light, damage, other; 1–6 photos the page uploaded to the person's own folder as kind vehicle_report; a note), " +
    "and the odometer now (typed; never under the vehicle's last reading). On the trip's day from 2 h before its planned " +
    "start it starts the trip (On the way, the start reading logged); earlier it only records the check. A problem becomes a " +
    "pre-trip vehicle report and the people with the issues permission are told once. Optional photos of the four sides " +
    "(front, back, left, right; kind vehicle_check) with an all-good check. Personal.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    check_id: zId.optional().describe("Made by the page so a retry never doubles the check"),
    result: z.enum(["ok", "problem"]),
    odometer_km: z.number().int().min(0).max(9_999_999),
    category: z.enum(REPORT_CATEGORIES).optional().describe("With a problem"),
    note: zText(500).optional(),
    photos: z.array(zId).max(MAX_PROBLEM_PHOTOS).optional().describe("A problem's photos (kind vehicle_report)"),
    sides: z.array(z.object({ photo_id: zId, side: z.enum(SIDES) })).max(4).optional().describe("All good: the four sides"),
  }),
  async run(args, { db, now, actor }) {
    const t = await ownNoAppTrip(db, args.task_id, actor.employeeId);
    const me = actor.employeeId!;
    if (t.status !== "assigned") {
      throw new ToolError(
        t.status === "in_progress" ? "This trip is already on its way." : `This trip is ${t.status}: nothing to check.`,
      );
    }
    const problem = args.result === "problem";
    if (problem && !args.category) throw new ToolError("Pick what the problem is.");
    const photos = args.photos ?? [];
    if (problem && photos.length < MIN_PROBLEM_PHOTOS) throw new ToolError("Add at least one photo of the problem.");
    if (!problem && photos.length) throw new ToolError("Photos of a problem go with result problem.");
    const last = await lastReading(db, t.vehicle_id!);
    const odoWrong = odometerProblem(args.odometer_km, last);
    if (odoWrong) throw new ToolError(odoWrong);
    await ownPhotos(db, me, photos, "vehicle_report");
    await ownPhotos(db, me, (args.sides ?? []).map((s) => s.photo_id), "vehicle_check");

    const settings = await loadSettings(db);
    const window = tripWindow(t.start_at, now);
    const at = now.toISOString();
    const checkId = args.check_id ?? crypto.randomUUID();
    if (settings.vehicle_check) {
      const exists = unwrapMaybe(await db.from("vehicle_checks").select("id").eq("id", checkId).maybeSingle(), "vehicle check");
      if (!exists) {
        unwrap(
          await db.from("vehicle_checks").insert({
            id: checkId,
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            checked_at: at,
            result: args.result,
            odometer_km: args.odometer_km,
            how: "trip",
            channel: "office",
          }),
          "vehicle check",
        );
        if (args.sides?.length) {
          for (const s of args.sides) {
            unwrap(await db.from("photos").update({ vehicle_check_id: checkId, side: s.side }).eq("id", s.photo_id), "photos");
          }
        }
        if (problem) {
          const report = unwrap(
            await db.from("vehicle_reports").insert({
              vehicle_id: t.vehicle_id!,
              employee_id: me,
              task_id: t.id,
              category: args.category!,
              note: args.note ?? null,
              check_id: checkId,
            }).select("id").single(),
            "vehicle report",
          );
          unwrap(await db.from("photos").update({ vehicle_report_id: report.id }).in("id", photos), "photos");
        }
      }
    }

    let started = false;
    if (window.open) {
      // On its day from 2 h before: the check starts the trip, with the start reading logged against it (no km gap).
      const done = unwrap(
        await db.from("tasks").update({ status: "in_progress", started_at: at, start_odometer_km: args.odometer_km })
          .eq("id", t.id).eq("status", "assigned").select("id"),
        "task",
      );
      if (done.length) {
        unwrap(
          await db.from("odometer_logs").insert({
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            reading_km: args.odometer_km,
            kind: "task_start",
            logged_at: at,
            entry: "office",
          }),
          "odometer",
        );
        started = true;
      }
    }
    const fresh = unwrap(await db.from("tasks").select("*").eq("id", t.id).single(), "task");
    const trip = await tripView(db, fresh, now);
    return {
      result: {
        ...trip,
        check_id: settings.vehicle_check ? checkId : undefined,
        started_now: started,
        next: started
          ? `On the way · left ${colomboTime(now)}`
          : `Check recorded. The trip starts on ${trip.date} from ${window.opens_at}: check again then.`,
      },
      summary: `check ${args.result} of ${trip.vehicle} for trip ${t.title}${started ? " (started)" : ""}`,
    };
  },
});

export const finishMyTrip = tool({
  name: "finish_my_trip",
  title: "Trip finished",
  description: '"Trip finished? Enter the odometer" for the person\'s own trip nobody drives with the app: the odometer now ' +
    "(typed; never under the start), optionally the start reading when the trip was never started (default the vehicle's " +
    "last reading), fuel added (litres and / or LKR; no video) and an odometer photo (kind odometer, the person's own folder). " +
    "Completes the trip (or confirms one closed as Completed · not confirmed): the readings go into the vehicle's odometer " +
    "log with the trip, so the vehicle's km this month and its allowance follow. Personal.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    odometer_km: z.number().int().min(0).max(9_999_999),
    start_odometer_km: z.number().int().min(0).max(9_999_999).optional(),
    fuel: z.object({
      litres: z.number().positive().max(500).optional(),
      amount_lkr: z.number().min(0).max(1_000_000).optional(),
    }).optional(),
    photo: zId.optional().describe("An odometer photo (kind odometer) the page uploaded"),
  }),
  async run(args, { db, now, actor }) {
    const t = await ownNoAppTrip(db, args.task_id, actor.employeeId);
    const me = actor.employeeId!;
    const state = noAppState(t);
    if (state === "done") throw new ToolError("This trip is already finished.");
    if (state === "cancelled" || state === "other") throw new ToolError(`This trip is ${t.status}: nothing to finish.`);
    const last = await lastReading(db, t.vehicle_id!);
    const start = t.start_odometer_km ?? args.start_odometer_km ?? last;
    if (start == null) throw new ToolError("Enter the odometer at the start too: the vehicle has no reading yet.");
    if (args.odometer_km < start) {
      throw new ToolError(`The odometer now (${args.odometer_km} km) is under the start (${start} km). Check the number.`);
    }
    const tooFar = odometerProblem(args.odometer_km, start, "The odometer now");
    if (tooFar) throw new ToolError(tooFar);
    if (args.fuel && args.fuel.litres == null && args.fuel.amount_lkr == null) throw new ToolError("Fuel: litres, the amount or both.");
    if (args.photo) await ownPhotos(db, me, [args.photo], "odometer");

    const at = now.toISOString();
    const logs = unwrap(await db.from("odometer_logs").select("kind").eq("task_id", t.id), "odometer");
    if (!logs.some((l) => l.kind === "task_start")) {
      unwrap(
        await db.from("odometer_logs").insert({
          vehicle_id: t.vehicle_id!,
          employee_id: me,
          task_id: t.id,
          reading_km: start,
          kind: "task_start",
          logged_at: t.started_at ?? t.start_at,
          entry: "office",
        }),
        "odometer",
      );
    }
    if (!logs.some((l) => l.kind === "task_end")) {
      unwrap(
        await db.from("odometer_logs").insert({
          vehicle_id: t.vehicle_id!,
          employee_id: me,
          task_id: t.id,
          reading_km: args.odometer_km,
          kind: "task_end",
          logged_at: at,
          entry: "office",
          photo_id: args.photo ?? null,
        }),
        "odometer",
      );
    }
    const notConfirmed = state === "not_confirmed";
    unwrap(
      await db.from("tasks").update({
        status: "completed",
        started_at: t.started_at ?? t.start_at,
        start_odometer_km: start,
        end_odometer_km: args.odometer_km,
        // A trip closed at 09:00 keeps the time it was closed at; one finished now ends now.
        completed_at: notConfirmed ? t.completed_at : at,
        finish_flag: null,
      }).eq("id", t.id),
      "task",
    );
    if (args.fuel) {
      unwrap(
        await db.from("fuel_logs").insert({
          vehicle_id: t.vehicle_id!,
          employee_id: me,
          task_id: t.id,
          litres: args.fuel.litres ?? null,
          amount_cents: args.fuel.amount_lkr != null ? Math.round(args.fuel.amount_lkr * 100) : null,
          odometer_km: args.odometer_km,
          logged_at: at,
        }),
        "fuel",
      );
    }
    const fresh = unwrap(await db.from("tasks").select("*").eq("id", t.id).single(), "task");
    const trip = await tripView(db, fresh, now);
    return {
      result: { ...trip, next: `Trip finished · ${args.odometer_km - start} km${notConfirmed ? " · confirmed" : ""}` },
      summary: `finished trip ${t.title}: ${start} → ${args.odometer_km} km${args.fuel ? " + fuel" : ""}`,
    };
  },
});

/** For my_trips: what a no-app trip on the person's account asks of them now (the row's button), or nothing. */
export function noAppAction(t: Pick<Task, "driven_by" | "status" | "started_at" | "finish_flag" | "finish_ask_sent_at" | "start_at">, now: Date) {
  if (t.driven_by === "driver") return undefined;
  const state = noAppState(t);
  if (state === "to_check") return tripWindow(t.start_at, now).past ? "finish" : "check";
  if (state === "finish" || state === "not_confirmed") return state === "finish" ? "finish" : "confirm";
  if (state === "on_the_way") return "finish";
  return undefined;
}
