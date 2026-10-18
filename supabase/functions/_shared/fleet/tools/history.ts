// Task history and the trips drivers start (Phase 7, §8 and §13): list_tasks over a range of days (Tasks → History), and
// set_trip_purpose (a driver-started trip switched between company work and personal, with a project attached).

import { z } from "zod";
import { fetchAll, inChunks, ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { findDriver, findVehicle, loadRefs } from "../fleet.ts";
import { colomboDate, colomboDateTime, colomboTime } from "../time.ts";
import { daySpan, tool, zDate, zId, zPaging, zSearch, zText } from "../tool.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { plain } from "../format.ts";
import { findOneProject } from "./projects.ts";

const STATUSES = ["assigned", "in_progress", "completed", "cancelled", "declined", "missed"] as const;

export const listTasks = tool({
  name: "list_tasks",
  title: "Task history",
  description: "Every task that starts in a range of days (Colombo dates, both counted, at most 366), newest first: the time, " +
    "title, project label, driver, vehicle, status, the first and last stop, km once completed, and kind (dispatch = the " +
    "office's, self = started by the driver in the app) with purpose (company or personal). Narrow by driver, vehicle, status " +
    "or kind. At most 500 rows; more says so.",
  readOnly: true,
  input: z.object({
    from: zDate.describe("First day, YYYY-MM-DD"),
    to: zDate.describe("Last day, YYYY-MM-DD"),
    driver: zText(80).optional().describe("Username, code or name"),
    vehicle: zText(20).optional().describe("Plate"),
    status: z.enum(STATUSES).optional(),
    kind: z.enum(["dispatch", "self"]).optional(),
    // Hotfix 3 (L3): a page at a time (the totals stay the whole range's), and the search box (title, label, driver, plate).
    search: zSearch,
    ...zPaging,
  }),
  async run({ from, to, driver, vehicle, status, kind, search, limit, cursor }, { db }) {
    const span = daySpan(from, to)!;
    const refs = await loadRefs(db);
    const onlyDriver = driver ? findDriver(refs, driver) : null;
    const onlyVehicle = vehicle ? findVehicle(refs, vehicle) : null;
    const w = pageWindow(limit, cursor);
    // Paged: every task of the range (up to 5,000) for the totals, the stops for the page only. Not paged: 500, as before.
    const LIMIT = w.limit === null ? 500 : 5000;
    const words = search?.replace(/[%_,()*]/g, " ").trim();
    const key = words ? plain(words) : "";
    // At most 60 people and 40 plates in the filter: every id is in the URL (the hosted gateway refuses a long one); a word
    // that matches more is too short to narrow anything by name.
    const people = key ? refs.employees.filter((e) => plain(e.name).includes(key)).map((e) => e.id).slice(0, 60) : [];
    const plates = key ? refs.vehicles.filter((v) => plain(v.reg_no).includes(key)).map((v) => v.id).slice(0, 40) : [];
    // A fresh query each time (a page of fetchAll orders and ranges its own).
    const build = () => {
      let q = db.from("tasks").select("*").gte("start_at", span.start).lt("start_at", span.end);
      if (words) {
        q = q.or([
          `title.ilike.*${words}*`,
          `label.ilike.*${words}*`,
          ...(people.length ? [`employee_id.in.(${people.join(",")})`] : []),
          ...(plates.length ? [`vehicle_id.in.(${plates.join(",")})`] : []),
        ].join(","));
      }
      if (onlyDriver) q = q.eq("employee_id", onlyDriver.id);
      if (onlyVehicle) q = q.eq("vehicle_id", onlyVehicle.id);
      if (status) q = q.eq("status", status);
      if (kind) q = q.eq("kind", kind);
      return q.order("start_at", { ascending: false }).order("id");
    };
    const rows = w.limit === null
      ? unwrap(await build().limit(LIMIT + 1), "tasks")
      : await fetchAll((a, b) => build().range(a, b), "tasks", LIMIT + 1);
    const inRange = rows.slice(0, LIMIT);
    const page = pageOf(inRange, w);
    const shown = page.rows;
    // 100 ids a request: each id is in the URL (the hosted gateway refuses a long one).
    const stops = (await Promise.all(
      inChunks(shown.map((t) => t.id)).map((ids) =>
        fetchAll(
          (a, b) =>
            db.from("task_stops").select("task_id, seq, place_name, status").in("task_id", ids).neq("status", "removed")
              .order("task_id").order("seq").range(a, b),
          "stops",
        )
      ),
    )).flat();
    const tasks = shown.map((t) => {
      const mine = stops.filter((s) => s.task_id === t.id);
      return {
        id: t.id,
        date: colomboDate(t.start_at),
        time: colomboTime(t.start_at),
        title: t.title,
        label: t.label ?? undefined,
        kind: t.kind,
        purpose: t.purpose,
        status: t.status,
        driver: refs.emp.get(t.employee_id)?.name,
        driver_username: refs.emp.get(t.employee_id)?.username ?? undefined,
        vehicle: refs.veh.get(t.vehicle_id ?? "")?.reg_no,
        from: mine[0]?.place_name,
        to: mine.length > 1 ? mine[mine.length - 1].place_name : undefined,
        stops_count: mine.length,
        started: t.started_at ? colomboDateTime(t.started_at) : undefined,
        completed: t.completed_at ? colomboDateTime(t.completed_at) : undefined,
        km: t.km ?? undefined,
        cancelled_reason: t.cancelled_reason ?? undefined,
        created_by: t.created_by ?? undefined,
      };
    });
    // The totals are the whole range's (every page shows the same ones).
    const count = (pick: (t: (typeof inRange)[number]) => boolean) => inRange.filter(pick).length;
    return {
      result: {
        from: span.from,
        to: span.to,
        count: tasks.length,
        total: page.total,
        next: page.next,
        more: rows.length > LIMIT ? `Over ${LIMIT} tasks: narrow the days or the filters to see the rest.` : undefined,
        totals: {
          completed: count((t) => t.status === "completed"),
          cancelled: count((t) => t.status === "cancelled"),
          km: inRange.reduce((sum, t) => sum + (t.status === "completed" ? t.km ?? 0 : 0), 0),
          driver_started: count((t) => t.kind === "self"),
          personal: count((t) => t.purpose === "personal"),
          missed: count((t) => t.status === "missed") || undefined,
        },
        tasks,
      },
      summary: `tasks ${span.from}…${span.to}: ${tasks.length}${rows.length > LIMIT ? "+" : ""}`,
    };
  },
});

export const setTripPurpose = tool({
  name: "set_trip_purpose",
  title: "Company or personal trip",
  description: "For a trip a driver started in the app (kind self): switch it between company work and personal, and attach a " +
    "project to a company trip (job number, short name or name; the whole trip goes to it). Personal km are counted apart in " +
    "mileage_summary and never charged to a job; a project stays recorded but is not charged while the trip is personal.",
  readOnly: false,
  input: z.object({
    task_id: zId,
    purpose: z.enum(["company", "personal"]),
    project: zText(200).optional().describe(
      'A company trip\'s project: job number (13021), short name (TRKAN1) or name; "internal" = Fame internal',
    ),
  }),
  async run({ task_id, purpose, project }, { db }) {
    const task = unwrapMaybe(await db.from("tasks").select("*").eq("id", task_id).maybeSingle(), "task");
    if (!task) throw new ToolError(`No task has the id ${task_id}.`);
    if (task.kind !== "self") {
      throw new ToolError("Only a trip a driver started in the app is switched: the office's tasks are company work.");
    }
    if (project && purpose === "personal") throw new ToolError("A personal trip has no project: choose company to attach one.");
    const internal = project ? /^(fame\s+)?internal$/i.test(project.trim()) : false;
    const found = project && !internal ? await findOneProject(db, project) : null;
    const label = project ? (found ? found.short_name ?? found.name : "Fame internal") : undefined;
    if (project) {
      // One row, 100 %: the trip's existing row takes the project (never deleted), else one is added.
      const rows = unwrap(await db.from("task_projects").select("*").eq("task_id", task.id), "task projects");
      if (rows.length > 1) throw new ToolError("This trip is split across projects already; change it with the projects' split.");
      if (rows[0]) {
        unwrap(
          await db.from("task_projects").update({ project_id: found?.id ?? null, percent: 100 }).eq("id", rows[0].id).select("id"),
          "task projects",
        );
      } else {
        unwrap(
          await db.from("task_projects").insert({ task_id: task.id, project_id: found?.id ?? null, percent: 100 }).select("id"),
          "task projects",
        );
      }
    }
    const changed = unwrap(
      await db.from("tasks").update({ purpose, ...(label !== undefined && { label }) }).eq("id", task.id).select("id, purpose, label")
        .single(),
      "task",
    );
    return {
      result: {
        task_id: task.id,
        purpose: changed.purpose,
        project: label,
        was: task.purpose !== purpose ? task.purpose : undefined,
        note: purpose === "personal" ? "Its km are counted as personal, apart from the jobs." : undefined,
      },
      summary: `trip ${task.title}: ${purpose}${label ? ` · ${label}` : ""}`,
    };
  },
});
