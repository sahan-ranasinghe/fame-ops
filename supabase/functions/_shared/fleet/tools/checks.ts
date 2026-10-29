// Round 4–7, feature 4 (Sahan, 22 October 2026): the vehicle check before work (Samsara / Motive's pre-trip inspection,
// Turo's check-in) and the close of a trip nobody drives with the app (Zipcar's and Turo's return). The driver app writes
// its checks itself (RLS, the offline queue); these tools are the office's view of them and the self-driver's own side:
// the person a self-drive or someone-else trip is on checks the vehicle before setting off and enters the odometer at the
// end, in Office mode, /m/ or the site. The rules: checks.ts.

import { z } from "zod";
import { type Db, type Row, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import type { Json } from "../database.types.ts";
import { type Employee, findVehicle, loadRefs, type Refs, vehicleLabel } from "../fleet.ts";
import { contactLinks } from "../format.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { photoLinks } from "../photos.ts";
import { estimateText, type FuelEstimate } from "../fuelCard.ts";
import { haversineKm } from "../geo.ts";
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
  const links = withPhotos && ids.length ? await photoLinks(db, { checkIds: ids, reportIds: reports.map((r) => r.id) }) : null;
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
  // Nothing while the switch vehicle_check is off (the list shows no check then).
  if (!vehicleIds.length || !(await loadSettings(db)).vehicle_check) return out;
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
async function ownNoAppTrip(db: Db, taskId: string, employeeId: string | null, opts: { manual?: boolean } = {}): Promise<Task> {
  if (!employeeId) throw new ToolError("This is personal: it needs a signed-in person (the web app) or a personal connector key.");
  const t = unwrapMaybe(await db.from("tasks").select("*").eq("id", taskId).maybeSingle(), "task");
  if (!t || t.employee_id !== employeeId) throw new ToolError("Not one of your trips.");
  if (t.driven_by === "driver") throw new ToolError("A driver does this trip: the driver checks the vehicle in the app.");
  if (!t.vehicle_id) throw new ToolError("This trip has no vehicle yet.");
  // Round 50: a trip started in the app or on /m/ is finished there (its readings, stops and photos are its own): the manual
  // check and finish refuse it; my_trip still shows it (the trip page and the web page read it).
  if (opts.manual && t.driven_in === "app") throw new ToolError(WEB_IN_APP);
  if (opts.manual && t.driven_in === "web") throw new ToolError("This trip was started on the web: finish it on its trip page.");
  return t;
}

const WEB_IN_APP = "This trip is being driven in the Fame Fleet app";

/** The vehicle's last odometer reading (the prefilled number; never under it). */
/** The vehicle's last known reading: its odometer, unless a vehicle check took a reading after the last logged one (a
 *  check's odometer is a reading too: the next trip's start is prefilled and checked against it). */
async function lastReading(db: Db, vehicleId: string): Promise<number | null> {
  const [veh, log, chk] = await Promise.all([
    db.from("vehicles").select("current_odometer_km").eq("id", vehicleId).maybeSingle(),
    db.from("odometer_logs").select("logged_at").eq("vehicle_id", vehicleId).order("logged_at", { ascending: false }).limit(1),
    db.from("vehicle_checks").select("odometer_km, checked_at").eq("vehicle_id", vehicleId).not("odometer_km", "is", null)
      .order("checked_at", { ascending: false }).limit(1),
  ]);
  const current = unwrapMaybe(veh, "vehicle")?.current_odometer_km ?? null;
  const lastLog = unwrap(log, "odometer logs")[0]?.logged_at;
  const check = unwrap(chk, "vehicle checks")[0];
  if (check?.odometer_km != null && (!lastLog || new Date(check.checked_at) > new Date(lastLog))) return check.odometer_km;
  return current;
}

/** The person's own photos (uploaded to their own folder by the page), unused, of one kind: or a refusal. */
async function ownPhotos(db: Db, employeeId: string, ids: readonly string[], kind: string): Promise<void> {
  if (!ids.length) return;
  const rows = unwrap(
    await db.from("photos").select(
      "id, employee_id, kind, odometer_log_id, fuel_log_id, vehicle_report_id, claim_line_id, vehicle_check_id",
    )
      .in("id", [...ids]),
    "photos",
  );
  const ok = rows.filter((p) =>
    p.employee_id === employeeId && p.kind === kind && !p.odometer_log_id && !p.fuel_log_id && !p.vehicle_report_id &&
    !p.claim_line_id && !p.vehicle_check_id
  );
  if (ok.length !== new Set(ids).size) throw new ToolError("A photo is not yours, not uploaded yet, or already used. Take it again.");
}

/** The vehicle's logged reading nearest before (or after) a moment, with its time. */
async function readingAt(db: Db, vehicleId: string, at: string, side: "before" | "after") {
  const q = db.from("odometer_logs").select("reading_km, logged_at").eq("vehicle_id", vehicleId);
  const rows = unwrap(
    await (side === "before" ? q.lt("logged_at", at).order("logged_at", { ascending: false }) : q.gt("logged_at", at).order("logged_at"))
      .limit(1),
    "odometer logs",
  );
  return rows[0] ?? null;
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
  const [stops, checks, settings, last] = await Promise.all([
    tripStops(db, t.id),
    db.from("vehicle_checks").select("*").eq("task_id", t.id).order("checked_at", { ascending: false }).limit(1),
    loadSettings(db),
    t.vehicle_id ? lastReading(db, t.vehicle_id) : Promise.resolve(null),
  ]);
  const check = unwrap(checks, "vehicle checks")[0];
  const web = t.driven_by === "self" ? await webBlock(db, t, settings, last) : undefined;
  const state = noAppState(t);
  const drivenElsewhere = t.driven_in === "app" || t.driven_in === "web";
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
    last_odometer_km: last ?? v?.current_odometer_km ?? null,
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
    // Round 50: a trip started in the app or on /m/ finishes there: the manual check and finish are not offered.
    can: {
      check: state === "to_check" && !drivenElsewhere,
      finish: !drivenElsewhere && (state === "to_check" || state === "on_the_way" || state === "finish" || state === "not_confirmed"),
    },
    ...(t.finish_ask_sent_at && { finish_asked: colomboDayTime(t.finish_ask_sent_at) }),
    ...(t.driven_in && { driven_in: t.driven_in }),
    ...(web && { web }),
  };
}

// ---- Round 50: /m/ driver-lite (docs/phase8-plan.md §37.5; Zipcar / Turo's trip flow in the browser) --------------

type Settings = Awaited<ReturnType<typeof loadSettings>>;

/** Why a self trip cannot be driven on the web now, or null when it can. */
function webRefusal(t: Task, settings: Settings, canDrive: boolean): string | null {
  if (!settings.self_drive_mode) return "Self-drive with the app is off (Settings).";
  if (!canDrive) return "Driving your trips here needs Can drive (ask an admin: Users).";
  if (t.driven_in === "app") return WEB_IN_APP;
  if (t.driven_in === "office") return "This trip was started from My trip: finish it there.";
  if (!["assigned", "in_progress"].includes(t.status)) return "This trip is over.";
  if (!t.vehicle_id) return "This trip has no vehicle yet.";
  return null;
}

async function canDriveOf(db: Db, employeeId: string): Promise<boolean> {
  const e = unwrapMaybe(await db.from("employees").select("can_drive").eq("id", employeeId).maybeSingle(), "person");
  return e?.can_drive === true;
}

/** The trip page's web block: whether the trip can be driven here, and its stops with their state. */
async function webBlock(db: Db, t: Task, settings: Settings, last: number | null) {
  const [canDrive, stops, fuel] = await Promise.all([
    canDriveOf(db, t.employee_id),
    db.from("task_stops").select("id, seq, type, place_name, status, arrived_at, done_at").eq("task_id", t.id).neq("status", "removed")
      .order("seq"),
    settings.fuel_card && t.vehicle_id ? db.rpc("fuel_estimate", { p_task_id: t.id }) : Promise.resolve({ data: null, error: null }),
  ]);
  const why = webRefusal(t, settings, canDrive);
  const estimate = (fuel.data ?? null) as FuelEstimate | null;
  return {
    allowed: why === null,
    ...(why && { why }),
    started: t.status === "in_progress" && t.driven_in === "web",
    ...(t.driven_in && { driven_in: t.driven_in }),
    check_needed: settings.vehicle_check,
    ...(settings.fuel_card &&
      { fuel_card: { estimate_text: estimate ? estimateText(estimate) ?? undefined : undefined, asked: !!t.fuel_answer } }),
    ...(last != null && { last_km: last }),
    stops: unwrap(stops, "stops").map((x, i) => ({
      id: x.id,
      n: i + 1,
      type: x.type,
      place: x.place_name,
      status: x.status,
      ...(x.arrived_at && { arrived_at: colomboTime(x.arrived_at) }),
      ...(x.done_at && { done_at: colomboTime(x.done_at) }),
    })),
  };
}

/** Within this distance of a stop's pin, a web Arrived is "ok" (the app's own rule: 300 m), else an override. */
const WEB_ARRIVAL_M = 300;

export const webTripAction = tool({
  name: "web_trip_action",
  title: "Drive my trip on the web",
  description: "Round 50: the person's own self-drive trip driven from a browser (/m/), one action at a time: start (the vehicle " +
    "check when it is on, the fuel card's answer, the odometer typed with its photo), arrive / leave a stop, finish (the odometer " +
    "with its photo, fuel with an optional receipt photo). Each action may carry ONE position the browser took at that moment " +
    "(none = saved without). No tracking: the office sees the actions' times and the stops joined by straight lines. A retry " +
    "with the same client_id answers the first outcome. Personal.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    client_id: zId.describe("Made by the page for each action: a retry never doubles it"),
    action: z.enum(["start", "arrive", "leave", "finish"]),
    stop_id: zId.optional().describe("arrive, leave"),
    position: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy_m: z.number().min(0).max(100_000).optional(),
    }).optional(),
    odometer_km: z.number().int().min(0).max(9_999_999).optional().describe("start, finish"),
    odometer_photo_id: zId.optional().describe("start, finish: an odometer photo (kind odometer) the page uploaded"),
    check: z.object({
      result: z.enum(["ok", "problem"]),
      category: z.enum(REPORT_CATEGORIES).optional(),
      note: zText(500).optional(),
      photos: z.array(zId).max(MAX_PROBLEM_PHOTOS).optional(),
      sides: z.array(z.object({ photo_id: zId, side: z.enum(SIDES) })).max(4).optional(),
    }).optional().describe("start, when the vehicle check is on"),
    fuel_answer: z.enum(["enough", "fill_on_way"]).optional().describe("start, when the fuel card asks"),
    fuel: z.object({
      litres: z.number().positive().max(500),
      lkr: z.number().min(0).max(1_000_000).optional(),
      receipt_photo_id: zId.optional(),
    }).optional().describe("finish, optional"),
  }),
  async run(args, { db, now, actor }) {
    const me = actor.employeeId;
    if (!me) throw new ToolError("This is personal: it needs a signed-in person.");
    const repeat = unwrapMaybe(
      await db.from("web_trip_actions").select("answer, employee_id").eq("client_id", args.client_id).maybeSingle(),
      "web trip action",
    );
    if (repeat) {
      if (repeat.employee_id !== me) throw new ToolError("Not one of your trips.");
      return { result: repeat.answer as Record<string, unknown>, summary: `web trip ${args.action} (again)` };
    }
    const t = unwrapMaybe(await db.from("tasks").select("*").eq("id", args.task_id).maybeSingle(), "task");
    if (!t || t.employee_id !== me) throw new ToolError("Not one of your trips.");
    if (t.driven_by !== "self") throw new ToolError("Only a trip you drive yourself can be driven here.");
    const settings = await loadSettings(db);
    // Starting needs the capability and the switch; a web trip already under way can always be driven to its end (an admin
    // taking can_drive away mid-trip must not strand the trip and its vehicle).
    if (args.action === "start") {
      const refused = webRefusal(t, settings, await canDriveOf(db, me));
      if (refused) throw new ToolError(refused);
    } else if (t.driven_in === "app") throw new ToolError(WEB_IN_APP);
    else if (t.driven_in !== "web" || t.status !== "in_progress") {
      throw new ToolError(t.status === "completed" ? "This trip is already finished." : "Start the trip first.");
    }
    const at = now.toISOString();
    const pos = args.position;
    let answer: Record<string, unknown>;
    let stopId: string | null = null;

    if (args.action === "start") {
      const startLog = unwrapMaybe(
        await db.from("odometer_logs").select("id").eq("task_id", t.id).eq("kind", "task_start").limit(1).maybeSingle(),
        "odometer",
      );
      // A start that failed after the trip went on its way (its answer was never kept): finish recording it, never twice.
      const resumed = t.status === "in_progress" && t.driven_in === "web";
      if (t.status !== "assigned" && !resumed) throw new ToolError("This trip is already on its way.");
      const window = tripWindow(t.start_at, now);
      if (!window.open && !resumed) throw new ToolError(`This trip can start from ${window.opens_at}.`);
      if (args.odometer_km == null || !args.odometer_photo_id) throw new ToolError("Take the odometer photo and type the reading.");
      const last = await lastReading(db, t.vehicle_id!);
      const odoWrong = resumed ? null : odometerProblem(args.odometer_km, last);
      if (odoWrong) throw new ToolError(odoWrong);
      if (!startLog) await ownPhotos(db, me, [args.odometer_photo_id], "odometer");
      const check = args.check;
      const checkDone = unwrapMaybe(await db.from("vehicle_checks").select("id").eq("id", args.client_id).maybeSingle(), "vehicle check");
      if (settings.vehicle_check && !checkDone) {
        if (!check) throw new ToolError("Answer the vehicle check first.");
        const problem = check.result === "problem";
        if (problem && !check.category) throw new ToolError("Pick what the problem is.");
        if (problem && (check.photos ?? []).length < MIN_PROBLEM_PHOTOS) throw new ToolError("Add at least one photo of the problem.");
        if (!problem && check.photos?.length) throw new ToolError("Photos of a problem go with result problem.");
        await ownPhotos(db, me, check.photos ?? [], "vehicle_report");
        await ownPhotos(db, me, (check.sides ?? []).map((x) => x.photo_id), "vehicle_check");
        const checkId = args.client_id;
        unwrap(
          await db.from("vehicle_checks").insert({
            id: checkId,
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            checked_at: at,
            result: check.result,
            odometer_km: args.odometer_km,
            how: "trip",
            channel: "web",
          }),
          "vehicle check",
        );
        for (const x of check.sides ?? []) {
          unwrap(await db.from("photos").update({ vehicle_check_id: checkId, side: x.side }).eq("id", x.photo_id), "photos");
        }
        if (problem) {
          const report = unwrap(
            await db.from("vehicle_reports").insert({
              vehicle_id: t.vehicle_id!,
              employee_id: me,
              task_id: t.id,
              category: check.category!,
              note: check.note ?? null,
              check_id: checkId,
            }).select("id").single(),
            "vehicle report",
          );
          unwrap(await db.from("photos").update({ vehicle_report_id: report.id }).in("id", check.photos ?? []), "photos");
        }
      }
      if (!resumed) {
        const started = unwrap(
          await db.from("tasks").update({
            status: "in_progress",
            started_at: at,
            start_odometer_km: args.odometer_km,
            driven_in: "web",
            ...(args.fuel_answer && { fuel_answer: args.fuel_answer, fuel_answer_at: at }),
          }).eq("id", t.id).eq("status", "assigned").select("id"),
          "task",
        );
        if (!started.length) throw new ToolError("This trip is already on its way.");
      }
      if (!startLog) {
        const log = unwrap(
          await db.from("odometer_logs").insert({
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            reading_km: args.odometer_km,
            kind: "task_start",
            logged_at: at,
            entry: "web",
            photo_id: args.odometer_photo_id,
          }).select("id").single(),
          "odometer",
        );
        unwrap(await db.from("photos").update({ odometer_log_id: log.id }).eq("id", args.odometer_photo_id), "photos");
      }
      answer = { task_id: t.id, status: "in_progress", driven_in: "web", next: `On the way · left ${colomboTime(t.started_at ?? now)}` };
    } else if (args.action === "arrive" || args.action === "leave") {
      if (t.status !== "in_progress") throw new ToolError("Start the trip first.");
      if (!args.stop_id) throw new ToolError("Which stop?");
      const stop = unwrapMaybe(
        await db.from("task_stops").select("id, task_id, place_name, status, lat, lng, arrived_at").eq("id", args.stop_id).maybeSingle(),
        "stop",
      );
      if (!stop || stop.task_id !== t.id || stop.status === "removed") throw new ToolError("Not a stop of this trip.");
      stopId = stop.id;
      if (args.action === "arrive") {
        if (stop.status !== "pending") throw new ToolError(`${stop.place_name ?? "This stop"}: already ${stop.status}.`);
        const far = pos && stop.lat != null && stop.lng != null
          ? Math.round(haversineKm(pos, { lat: stop.lat, lng: stop.lng }) * 1000)
          : null;
        const flag = !pos ? "no_gps" : stop.lat == null ? "no_pin" : far! <= WEB_ARRIVAL_M ? "ok" : "override";
        unwrap(
          await db.from("task_stops").update({
            status: "arrived",
            arrived_at: at,
            arrival_flag: flag,
            ...(far != null && { arrival_distance_m: far }),
            ...(pos && { arrival_lat: pos.lat, arrival_lng: pos.lng, arrival_at: at, arrival_accuracy_m: pos.accuracy_m ?? null }),
          }).eq("id", stop.id).eq("status", "pending"),
          "stop",
        );
        answer = {
          task_id: t.id,
          status: "in_progress",
          driven_in: "web",
          stop: { id: stop.id, status: "arrived", at: colomboTime(now) },
          next: `Arrived at ${stop.place_name ?? "the stop"}`,
        };
      } else {
        if (stop.status !== "arrived") throw new ToolError(`${stop.place_name ?? "This stop"}: mark Arrived first.`);
        unwrap(await db.from("task_stops").update({ status: "done", done_at: at }).eq("id", stop.id).eq("status", "arrived"), "stop");
        answer = {
          task_id: t.id,
          status: "in_progress",
          driven_in: "web",
          stop: { id: stop.id, status: "done", at: colomboTime(now) },
          next: `Done at ${stop.place_name ?? "the stop"}`,
        };
      }
    } else {
      if (args.odometer_km == null || !args.odometer_photo_id) throw new ToolError("Take the odometer photo and type the reading.");
      const start = t.start_odometer_km ?? 0;
      // A finish that failed part-way: the rows already written are not written again.
      const [endLogRes, fuelRes] = await Promise.all([
        db.from("odometer_logs").select("id").eq("task_id", t.id).eq("kind", "task_end").limit(1).maybeSingle(),
        db.from("fuel_logs").select("id").eq("task_id", t.id).eq("employee_id", me).gte("logged_at", t.started_at ?? at).limit(1)
          .maybeSingle(),
      ]);
      const endLog = unwrapMaybe(endLogRes, "odometer");
      const fuelDone = unwrapMaybe(fuelRes, "fuel");
      if (args.odometer_km < start) {
        throw new ToolError(`The odometer now (${args.odometer_km} km) is under the start (${start} km). Check the number.`);
      }
      const tooFar = odometerProblem(args.odometer_km, start, "The odometer now");
      if (tooFar) throw new ToolError(tooFar);
      if (!endLog) await ownPhotos(db, me, [args.odometer_photo_id], "odometer");
      if (args.fuel?.receipt_photo_id && !fuelDone) await ownPhotos(db, me, [args.fuel.receipt_photo_id], "fuel_receipt");
      if (!endLog) {
        const log = unwrap(
          await db.from("odometer_logs").insert({
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            reading_km: args.odometer_km,
            kind: "task_end",
            logged_at: at,
            entry: "web",
            photo_id: args.odometer_photo_id,
          }).select("id").single(),
          "odometer",
        );
        unwrap(await db.from("photos").update({ odometer_log_id: log.id }).eq("id", args.odometer_photo_id), "photos");
      }
      if (args.fuel && !fuelDone) {
        const fuel = unwrap(
          await db.from("fuel_logs").insert({
            vehicle_id: t.vehicle_id!,
            employee_id: me,
            task_id: t.id,
            litres: args.fuel.litres,
            amount_cents: args.fuel.lkr != null ? Math.round(args.fuel.lkr * 100) : null,
            odometer_km: args.odometer_km,
            logged_at: at,
            receipt_photo_id: args.fuel.receipt_photo_id ?? null,
          }).select("id").single(),
          "fuel",
        );
        if (args.fuel.receipt_photo_id) {
          unwrap(await db.from("photos").update({ fuel_log_id: fuel.id }).eq("id", args.fuel.receipt_photo_id), "photos");
        }
      }
      // The stops not reached: skipped, not visited (as the app's Save & finish does).
      unwrap(
        await db.from("task_stops").update({ status: "skipped", skip_reason: "not_visited" }).eq("task_id", t.id)
          .in("status", ["pending", "arrived"]),
        "stops",
      );
      unwrap(
        await db.from("tasks").update({ status: "completed", completed_at: at, end_odometer_km: args.odometer_km })
          .eq("id", t.id).eq("status", "in_progress"),
        "task",
      );
      const km = args.odometer_km - start;
      answer = { task_id: t.id, status: "completed", driven_in: "web", km, next: `Trip finished · ${km} km` };
    }

    unwrap(
      await db.from("web_trip_actions").insert({
        client_id: args.client_id,
        task_id: t.id,
        employee_id: me,
        action: args.action,
        stop_id: stopId,
        at,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy_m: pos?.accuracy_m ?? null,
        answer: answer as Json,
      }),
      "web trip action",
    );
    return { result: answer, summary: `web trip ${args.action}: ${t.title}${pos ? "" : " (no position)"}` };
  },
});

/** Round 4–7 (6): a registered passenger's view of a trip: the time, the stops as they go, the driver and the plate. */
async function passengerView(db: Db, t: Task, now: Date) {
  const refs = await loadRefs(db);
  const stops = unwrap(
    await db.from("task_stops").select("seq, type, place_name, status, arrived_at, planned_arrive_at").eq("task_id", t.id)
      .neq("status", "removed").order("seq"),
    "stops",
  );
  const driver = refs.emp.get(t.employee_id);
  const phone = t.driven_by === "other" ? t.driver_phone : driver?.phone ?? null;
  const live = t.status === "cancelled"
    ? "Cancelled"
    : t.status === "completed"
    ? `Completed${t.completed_at ? ` · ${colomboTime(t.completed_at)}` : ""}`
    : t.status === "in_progress"
    ? `On the way${t.started_at ? ` · ${colomboTime(t.started_at)}` : ""}`
    : t.accepted_at
    ? "Driver accepted"
    : "Sent to the driver";
  return {
    viewer: "passenger" as const,
    task_id: t.id,
    title: t.title,
    date: colomboDate(t.start_at),
    leave_at: colomboTime(t.leave_by ?? t.start_at),
    ...(t.end_by && { back_by: colomboTime(t.end_by), back_by_date: colomboDate(t.end_by) }),
    status: t.status,
    live_text: live,
    driver: t.driven_by === "other" ? t.driver_name : driver?.name ?? null,
    ...(phone && { driver_phone: phone, ...contactLinks(phone) }),
    vehicle: t.vehicle_id ? refs.veh.get(t.vehicle_id)?.reg_no ?? null : null,
    stops: stops.map((x, i) => ({
      n: i + 1,
      type: x.type,
      place: x.place_name,
      status: x.status,
      ...(x.arrived_at && { arrived: colomboTime(x.arrived_at) }),
      ...(x.planned_arrive_at && { planned: colomboTime(x.planned_arrive_at) }),
    })),
    seen_at: colomboTime(now),
  };
}

export const myTrip = tool({
  name: "my_trip",
  title: "My trip",
  description: "A registered passenger's view of a trip they ride in (viewer passenger: the time, the stops as they go, the " +
    "driver with their phone, the plate, the live state). Or one of the person's own trips that nobody drives with the app (I'll drive myself, or Someone else): the trip " +
    "(day, leave time, back-by, the vehicle, the stops), where it is (to_check, on_the_way, finish, done, not_confirmed), the " +
    "check of the day, the readings and what can be done now: the vehicle check before setting off (it starts the trip from " +
    '2 h before the planned start, on the trip\'s day) and "Trip finished? Enter the odometer". Personal.',
  readOnly: true,
  input: z.object({ task_id: zId }),
  async run({ task_id }, { db, now, actor }) {
    // A passenger's view only while the switch passengers is on.
    if (actor.employeeId && (await loadSettings(db)).passengers) {
      const riding = unwrapMaybe(
        await db.from("task_passengers").select("id").eq("task_id", task_id).eq("employee_id", actor.employeeId).is("removed_at", null)
          .limit(1).maybeSingle(),
        "passengers",
      );
      const t = riding ? unwrapMaybe(await db.from("tasks").select("*").eq("id", task_id).maybeSingle(), "task") : null;
      if (t && t.employee_id !== actor.employeeId) {
        const view = await passengerView(db, t, now);
        return { result: view, summary: `trip ${t.title} as a passenger` };
      }
    }
    const t = await ownNoAppTrip(db, task_id, actor.employeeId);
    const trip = await tripView(db, t, now);
    return { result: { viewer: "owner" as const, ...trip }, summary: `trip ${t.title} (${trip.state})` };
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
    const t = await ownNoAppTrip(db, args.task_id, actor.employeeId, { manual: true });
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
        await db.from("tasks").update({ status: "in_progress", started_at: at, start_odometer_km: args.odometer_km, driven_in: "office" })
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
    const t = await ownNoAppTrip(db, args.task_id, actor.employeeId, { manual: true });
    const me = actor.employeeId!;
    const state = noAppState(t);
    if (state === "done") throw new ToolError("This trip is already finished.");
    if (state === "cancelled" || state === "other") throw new ToolError(`This trip is ${t.status}: nothing to finish.`);
    const notConfirmed = state === "not_confirmed";
    // A trip closed as not confirmed and confirmed days later: the vehicle may have been driven since. Its readings go in at
    // the trip's own times (the vehicle's odometer only moves for the newest one), the start defaults to the reading before
    // the trip, and the end can never be over a reading logged after it.
    const tripFrom = t.started_at ?? t.start_at;
    const tripTo = notConfirmed ? t.completed_at ?? now.toISOString() : now.toISOString();
    const before = notConfirmed ? await readingAt(db, t.vehicle_id!, tripFrom, "before") : null;
    const after = notConfirmed ? await readingAt(db, t.vehicle_id!, tripTo, "after") : null;
    const last = notConfirmed ? before?.reading_km ?? null : await lastReading(db, t.vehicle_id!);
    const start = t.start_odometer_km ?? args.start_odometer_km ?? last;
    if (start == null) throw new ToolError("Enter the odometer at the start too: the vehicle has no reading yet.");
    if (args.odometer_km < start) {
      throw new ToolError(`The odometer now (${args.odometer_km} km) is under the start (${start} km). Check the number.`);
    }
    const tooFar = odometerProblem(args.odometer_km, start, "The odometer now");
    if (tooFar) throw new ToolError(tooFar);
    if (after && args.odometer_km > after.reading_km) {
      throw new ToolError(
        `The odometer at the end (${args.odometer_km} km) is over a reading logged after this trip (${after.reading_km} km on ` +
          `${colomboDate(after.logged_at)}). Check the number.`,
      );
    }
    if (args.fuel && args.fuel.litres == null && args.fuel.amount_lkr == null) throw new ToolError("Fuel: litres, the amount or both.");
    if (args.photo) await ownPhotos(db, me, [args.photo], "odometer");

    const at = notConfirmed ? tripTo : now.toISOString();
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
export function noAppAction(
  t: Pick<Task, "driven_by" | "status" | "started_at" | "finish_flag" | "finish_ask_sent_at" | "start_at"> & { driven_in?: string | null },
  now: Date,
) {
  if (t.driven_by === "driver") return undefined;
  // Round 50: a trip under way in the app or on /m/ asks nothing of My trips (it finishes where it started).
  if (t.driven_in === "app" || t.driven_in === "web") return undefined;
  const state = noAppState(t);
  if (state === "to_check") return tripWindow(t.start_at, now).past ? "finish" : "check";
  if (state === "finish" || state === "not_confirmed") return state === "finish" ? "finish" : "confirm";
  if (state === "on_the_way") return "finish";
  return undefined;
}
