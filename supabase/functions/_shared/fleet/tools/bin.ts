// Round 52 (docs/phase8-plan.md §40; Shopify's and Samsara's archive, Gmail's and Google Drive's bin, GitHub's
// type-to-confirm): delete, the bin and archive for the records that had none.
//
//   can_delete          may this record be deleted (it has no history), and what to type to confirm it
//   delete_record       a vehicle, driver, office person, place, project or rental company with NO history, into the bin
//                       (a person or a vehicle only with its name or plate typed); a person's sign-in is banned at once
//   delete_entry        a wrong entry (a fill, an odometer reading, a vehicle check, an issue, a request, a task) with a
//                       reason, into the bin; preview says what goes with it
//   list_bin            Recently deleted: what waits, until when
//   restore_bin_item    puts it back as it was (a person's sign-in unbanned while their account is on)
//   set_vehicle_active  archive / restore a vehicle; archiving one booked from today on asks first, naming the trips
//   set_project_archived, set_rental_company_archived, list_projects, list_rental_companies
//
// Who: delete_record, can_delete, the bin and its Restore need users (the admins); delete_entry needs approve (fleet
// admins and admins, not the Coordinator); archive needs vehicles. None of the delete or bin tools is on the connector
// (media.ts WEB_ONLY_TOOLS): Claude archives, never deletes. The database does the moving (bin_take / bin_restore, as their
// owner: service_role deletes nothing itself); the purge after 30 days is the retention job's (purgeBin below).

import { z } from "zod";
import type { Db } from "../db.ts";
import { ToolError, unwrap, unwrapMaybe } from "../db.ts";
import { findDriver, findVehicle, loadRefs } from "../fleet.ts";
import { colomboDate, colomboTime } from "../time.ts";
import { tool, zId, zPaging, zSearch, zText } from "../tool.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { guard, officeUser, targetOf } from "./accounts.ts";

export const RECORD_KINDS = ["vehicle", "driver", "office_person", "place", "project", "rental_company"] as const;
export const ENTRY_KINDS = ["fuel", "odometer", "check", "issue", "request", "task"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** A kind in words ("a vehicle", "an odometer reading"). */
export const KIND_WORDS: Record<RecordKind | EntryKind, string> = {
  vehicle: "vehicle",
  driver: "driver",
  office_person: "office person",
  place: "place",
  project: "project",
  rental_company: "rental company",
  fuel: "fill",
  odometer: "odometer reading",
  check: "vehicle check",
  issue: "issue",
  request: "request",
  task: "task",
};

/** What a record_history key counts, singular and plural. */
const HISTORY_WORDS: Record<string, [string, string]> = {
  tasks: ["task", "tasks"],
  requests: ["request", "requests"],
  fuel: ["fill", "fills"],
  odometer: ["odometer reading", "odometer readings"],
  odometer_photos: ["odometer photo", "odometer photos"],
  checks: ["vehicle check", "vehicle checks"],
  reports: ["problem report", "problem reports"],
  documents: ["document", "documents"],
  duty: ["day on duty", "days on duty"],
  held: ["time held", "times held"],
  locations: ["location point", "location points"],
  days: ["day on the road", "days on the road"],
  heartbeats: ["phone check-in", "phone check-ins"],
  asks: ["ask", "asks"],
  passenger: ["trip as a passenger", "trips as a passenger"],
  assignments: ["assignment", "assignments"],
  issue_work: ["issue handled", "issues handled"],
  claims: ["claim", "claims"],
  stops: ["stop", "stops"],
  request_stops: ["request stop", "request stops"],
  starts: ["trip start", "trip starts"],
  vehicles: ["vehicle", "vehicles"],
};

/** "3 tasks, 2 fills" (the order record_history gives, the biggest first when it is the same kind of thing). */
export function historyWords(history: Record<string, number>): string {
  return Object.entries(history)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => {
      const [one, many] = HISTORY_WORDS[key] ?? [key, key];
      return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
    })
    .join(", ");
}

/** The sentence a delete refused for history says: archive instead. */
export function hasHistoryText(label: string, history: Record<string, number>): string {
  return `${label} has history (${historyWords(history)}): archive it instead. Nothing was deleted.`;
}

/** A plate or a name as typed in the confirm box, compared loosely (case, spaces and dashes of a plate do not matter). */
export function confirmMatches(kind: RecordKind, typed: string | undefined, expected: string): boolean {
  if (!typed) return false;
  const norm = (s: string) => kind === "vehicle" ? s.toUpperCase().replace(/[\s-]/g, "") : s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) === norm(expected);
}

/** A database refusal (bin_take / bin_restore) in words for the person. */
export function binErrorText(message: string, label: string): string {
  if (message.startsWith("has_history")) return `${label} has history: archive it instead. Nothing was deleted.`;
  if (message.startsWith("task_running")) return "That task is under way: it can be deleted once it is finished or cancelled.";
  if (message.startsWith("base_place")) return `${label} is the base place: choose another one in Settings → Fleet first.`;
  if (message.startsWith("taken")) {
    return "Something with the same name, plate or username exists now. Rename or archive it first, then restore this.";
  }
  const gone = /^gone: public\.(\w+)/.exec(message);
  if (gone) return `It belongs to ${GONE_WORDS[gone[1]] ?? `a ${gone[1].replace(/_/g, " ")}`} that is gone now: it cannot come back.`;
  if (message.startsWith("not_found")) return "It is not there any more (deleted already, or restored by someone else).";
  return message;
}
const GONE_WORDS: Record<string, string> = {
  vehicles: "a vehicle",
  employees: "a person",
  tasks: "a task",
  places: "a place",
  projects: "a project",
  rental_companies: "a rental company",
  vehicle_requests: "a request",
  issues: "an issue",
};

interface Resolved {
  id: string;
  label: string;
  /** What to type to confirm (a person's name, a plate); none for the others. */
  confirmWith?: string;
  /** A person: their account (the guards, the sign-in). */
  person?: { authUserId: string | null; office: boolean; row: { id: string; permissions: unknown; role: string; active: boolean } };
}

async function resolveRecord(db: Db, kind: RecordKind, ref: string): Promise<Resolved> {
  if (kind === "vehicle") {
    const v = findVehicle(await loadRefs(db), ref);
    return { id: v.id, label: v.reg_no, confirmWith: v.reg_no };
  }
  if (kind === "driver") {
    const d = findDriver(await loadRefs(db), ref, { demoToo: true });
    return {
      id: d.id,
      label: d.name,
      confirmWith: d.name,
      person: { authUserId: d.auth_user_id, office: false, row: { id: d.id, permissions: [], role: d.role, active: d.active } },
    };
  }
  if (kind === "office_person") {
    const u = await officeUser(db, ref);
    return {
      id: u.id,
      label: u.name,
      confirmWith: u.name,
      person: { authUserId: u.auth_user_id, office: true, row: { id: u.id, permissions: u.permissions, role: u.role, active: u.active } },
    };
  }
  const table = kind === "place" ? "places" : kind === "project" ? "projects" : "rental_companies";
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const row = unwrapMaybe(
    await (byId ? db.from(table).select("id, name").eq("id", ref) : db.from(table).select("id, name").ilike("name", ref.trim()).limit(1))
      .maybeSingle(),
    KIND_WORDS[kind],
  ) as { id: string; name: string } | null;
  if (!row) throw new ToolError(`No ${KIND_WORDS[kind]} matches "${ref}".`);
  return { id: row.id, label: row.name };
}

async function historyOf(db: Db, kind: RecordKind, id: string): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("record_history", { p_kind: kind, p_id: id });
  if (error) throw new Error(`record history: ${error.message}`);
  return (data ?? {}) as Record<string, number>;
}

/** The person checks: never yourself; an office account under the switch-off rules (the last admin, admins only for an admin). */
async function personProblem(db: Db, actor: Parameters<typeof guard>[1], r: Resolved): Promise<void> {
  if (!r.person) return;
  if (actor.employeeId && actor.employeeId === r.id) throw new ToolError("You cannot delete your own account. Ask another admin.");
  if (r.person.office) await guard(db, actor, { kind: "switch", target: targetOf(r.person.row), active: false });
}

const until = (at: string) => colomboDate(new Date(at));

export const canDelete = tool({
  name: "can_delete",
  title: "Can this be deleted",
  description: "Whether a vehicle, driver, office person, place, project or rental company may be deleted: only one with no history " +
    "(no task, fill, reading, document, …). Answers deletable, the history in words when it has some (archive it instead), " +
    "and confirm_with: what to type to confirm a person or a vehicle.",
  readOnly: true,
  input: z.object({ kind: z.enum(RECORD_KINDS), ref: zText(200).describe("A plate, username, e-mail, or the record's id or name") }),
  async run({ kind, ref }, { db, actor }) {
    const r = await resolveRecord(db, kind, ref);
    const history = await historyOf(db, kind, r.id);
    let problem: string | undefined;
    try {
      await personProblem(db, actor, r);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      problem = e.message;
    }
    const deletable = Object.keys(history).length === 0 && !problem;
    return {
      result: {
        kind,
        id: r.id,
        label: r.label,
        deletable,
        history: Object.keys(history).length ? history : undefined,
        history_words: Object.keys(history).length ? historyWords(history) : undefined,
        problem,
        confirm_with: deletable ? r.confirmWith : undefined,
      },
      summary: `can delete ${KIND_WORDS[kind]} ${r.label}: ${deletable ? "yes" : "no"}`,
    };
  },
});

export const deleteRecord = tool({
  name: "delete_record",
  title: "Delete a record (no history)",
  description: "Deletes a vehicle, driver, office person, place, project or rental company that has NO history: it waits 30 days in " +
    "Recently deleted (list_bin, restore_bin_item), then goes for good. A person or a vehicle needs confirm_text: their name or " +
    "plate, typed. A record with history is refused: archive it instead. A person's sign-in stops at once.",
  readOnly: false,
  input: z.object({
    kind: z.enum(RECORD_KINDS),
    ref: zText(200).describe("A plate, username, e-mail, or the record's id or name"),
    confirm_text: z.string().trim().max(200).optional().describe("A person's name or a vehicle's plate, as typed to confirm"),
  }),
  async run({ kind, ref, confirm_text }, { db, actor }) {
    const r = await resolveRecord(db, kind, ref);
    if (r.confirmWith && !confirmMatches(kind, confirm_text, r.confirmWith)) {
      throw new ToolError(`Type ${kind === "vehicle" ? "the plate" : "the name"} "${r.confirmWith}" to confirm. Nothing was deleted.`);
    }
    await personProblem(db, actor, r);
    const history = await historyOf(db, kind, r.id);
    if (Object.keys(history).length) throw new ToolError(hasHistoryText(r.label, history));
    const { data, error } = await db.rpc("bin_take", {
      p_kind: kind,
      p_id: r.id,
      p_reason: "",
      p_actor: actor.name,
      // The shared key is no person: null (the generated types read every argument as given).
      p_actor_employee: actor.employeeId as string,
    });
    if (error) throw new ToolError(binErrorText(error.message, r.label));
    const taken = data as { bin_id: string; label: string };
    const notes: string[] = [];
    if (r.person?.authUserId) {
      // The sign-in stops now (sessions cannot be renewed); the account itself goes with the purge.
      const { error: banError } = await db.auth.admin.updateUserById(r.person.authUserId, { ban_duration: "876000h" });
      if (banError) notes.push(`The sign-in could not be blocked: ${banError.message}`);
    }
    const item = unwrap(await db.from("bin_items").select("purge_after").eq("id", taken.bin_id).single(), "bin");
    return {
      result: {
        deleted: r.label,
        kind,
        bin_id: taken.bin_id,
        until: until(item.purge_after),
        next: `In Recently deleted until ${until(item.purge_after)}: an admin can restore it there.`,
        notes: notes.length ? notes : undefined,
      },
      summary: `deleted ${KIND_WORDS[kind]} ${r.label} (into the bin)`,
    };
  },
});

/** A wrong entry in words, and what goes with it (the confirm's list). */
async function entryOf(db: Db, kind: EntryKind, id: string): Promise<{ label: string; affects: string[] }> {
  const one = async (table: string, cols: string) => {
    // deno-lint-ignore no-explicit-any
    const row = unwrapMaybe(await (db as any).from(table).select(cols).eq("id", id).maybeSingle(), KIND_WORDS[kind]) as Record<string, unknown> | null;
    if (!row) throw new ToolError(`That ${KIND_WORDS[kind]} is not there (deleted already?).`);
    return row;
  };
  const plate = async (vehicleId: unknown) =>
    vehicleId ? (unwrapMaybe(await db.from("vehicles").select("reg_no").eq("id", vehicleId as string).maybeSingle(), "vehicle")?.reg_no ?? "") : "";
  const when = (at: unknown) => (at ? `${colomboDate(new Date(at as string))} ${colomboTime(new Date(at as string))}` : "");
  switch (kind) {
    case "fuel": {
      const f = await one("fuel_logs", "vehicle_id, litres, logged_at, receipt_photo_id, video_path");
      return {
        label: [`Fill`, await plate(f.vehicle_id), f.litres != null ? `${f.litres} L` : "", when(f.logged_at)].filter(Boolean).join(" · "),
        affects: [f.receipt_photo_id ? "its receipt photo" : "", f.video_path ? "its video" : "", "the month's fuel totals change"].filter(Boolean),
      };
    }
    case "odometer": {
      const o = await one("odometer_logs", "vehicle_id, reading_km, logged_at, kind, task_id");
      return {
        label: [`Odometer`, await plate(o.vehicle_id), `${Number(o.reading_km).toLocaleString("en-US")} km`, when(o.logged_at)].filter(Boolean).join(" · "),
        affects: [
          "its photo",
          "the vehicle's current reading becomes its newest reading left",
          "the month's km change",
          o.task_id ? "its task keeps the km it recorded" : "",
        ].filter(Boolean),
      };
    }
    case "check": {
      const c = await one("vehicle_checks", "vehicle_id, created_at");
      return { label: [`Vehicle check`, await plate(c.vehicle_id), when(c.created_at)].filter(Boolean).join(" · "), affects: ["its photos"] };
    }
    case "issue": {
      const i = await one("issues", "title, auto");
      return {
        label: `Issue · ${i.title}`,
        affects: ["its notes and history", i.auto ? "it opens again by itself while its cause is still there (Dismiss keeps it quiet)" : ""].filter(Boolean),
      };
    }
    case "request": {
      const q = await one("vehicle_requests", "title, requested_by_name, needed_at, task_id");
      const affects = ["its stops, timeline and passengers"];
      if (q.task_id) {
        const t = unwrapMaybe(await db.from("tasks").select("title, status").eq("id", q.task_id as string).maybeSingle(), "task");
        if (t) affects.unshift(`its task ${t.title} and that task's stops`);
      }
      return { label: [`Request`, (q.title ?? q.requested_by_name) as string, when(q.needed_at)].filter(Boolean).join(" · "), affects };
    }
    case "task": {
      const t = await one("tasks", "title, start_at, status");
      if (t.status === "in_progress") throw new ToolError("That task is under way: it can be deleted once it is finished or cancelled.");
      const stops = (await db.from("task_stops").select("id", { count: "exact", head: true }).eq("task_id", id)).count ?? 0;
      return {
        label: [`Task`, t.title as string, when(t.start_at)].filter(Boolean).join(" · "),
        affects: [`its ${stops} stop${stops === 1 ? "" : "s"}`, "its fills and odometer readings stay, unlinked", "its km leave the mileage"],
      };
    }
  }
}

export const deleteEntry = tool({
  name: "delete_entry",
  title: "Delete a wrong entry",
  description: "Deletes a wrong fill, odometer reading, vehicle check, issue, request or task, with a reason (required). It waits 30 " +
    "days in Recently deleted, then goes for good; the totals, km and the vehicle's current reading follow at once. A request " +
    "takes its task with it; a task under way is refused. preview true: what it is and what goes with it, nothing deleted.",
  readOnly: false,
  input: z.object({
    kind: z.enum(ENTRY_KINDS),
    id: zId,
    reason: z.string().trim().max(300).optional().describe("Why it is wrong (required to delete)"),
    preview: z.boolean().optional().describe("Only say what it is and what goes with it"),
  }),
  async run({ kind, id, reason, preview }, { db, actor }) {
    const entry = await entryOf(db, kind, id);
    if (preview) return { result: { kind, id, label: entry.label, affects: entry.affects }, summary: `preview delete ${kind} ${entry.label}` };
    if (!reason || reason.length < 3) throw new ToolError("Say why it is wrong (a few words). Nothing was deleted.");
    const { data, error } = await db.rpc("bin_take", { p_kind: kind, p_id: id, p_reason: reason, p_actor: actor.name, p_actor_employee: actor.employeeId as string });
    if (error) throw new ToolError(binErrorText(error.message, entry.label));
    const taken = data as { bin_id: string };
    const item = unwrap(await db.from("bin_items").select("purge_after").eq("id", taken.bin_id).single(), "bin");
    return {
      result: { deleted: entry.label, kind, bin_id: taken.bin_id, until: until(item.purge_after), affects: entry.affects },
      summary: `deleted ${KIND_WORDS[kind]} ${entry.label}: ${reason}`,
    };
  },
});

export const listBin = tool({
  name: "list_bin",
  title: "Recently deleted",
  description: "What was deleted in the last 30 days, newest first: what it was, who deleted it, why, and until when it can be restored.",
  readOnly: true,
  input: z.object({ kind: z.enum([...RECORD_KINDS, ...ENTRY_KINDS]).optional(), search: zSearch, ...zPaging }),
  async run({ kind, search, limit, cursor }, { db, now }) {
    let q = db.from("bin_items").select("id, kind, record_id, label, detail, reason, deleted_at, deleted_by, purge_after").order("deleted_at", {
      ascending: false,
    });
    if (kind) q = q.eq("kind", kind);
    const rows = unwrap(await q.limit(500), "bin");
    const words = (search ?? "").toLowerCase();
    const shown = rows.filter((r) => !words || `${r.label} ${r.detail ?? ""} ${r.reason ?? ""} ${r.deleted_by}`.toLowerCase().includes(words));
    const items = shown.map((r) => ({
      id: r.id,
      kind: r.kind,
      record_id: r.record_id,
      label: r.label,
      detail: r.detail ?? undefined,
      reason: r.reason ?? undefined,
      deleted_by: r.deleted_by,
      deleted_at: `${colomboDate(new Date(r.deleted_at))} ${colomboTime(new Date(r.deleted_at))}`,
      until: until(r.purge_after),
      days_left: Math.max(0, Math.ceil((Date.parse(r.purge_after) - now.getTime()) / 86400000)),
    }));
    const page = pageOf(items, pageWindow(limit, cursor));
    return {
      result: { items: page.rows, total: page.total ?? items.length, next: page.next },
      summary: `${items.length} in Recently deleted`,
    };
  },
});

export const restoreBinItem = tool({
  name: "restore_bin_item",
  title: "Restore from Recently deleted",
  description: "Puts a deleted record or entry back as it was. Refused when something with the same name, plate or username exists " +
    "now, or what it belonged to is gone. A person comes back with their sign-in working again if their account is on.",
  readOnly: false,
  input: z.object({ id: zId }),
  async run({ id }, { db }) {
    const item = unwrapMaybe(await db.from("bin_items").select("label").eq("id", id).maybeSingle(), "bin");
    if (!item) throw new ToolError("It is not in Recently deleted any more (restored already, or gone after its 30 days).");
    const { data, error } = await db.rpc("bin_restore", { p_id: id });
    if (error) throw new ToolError(binErrorText(error.message, item.label));
    const back = data as { kind: string; record_id: string; label: string; auth_user_id: string | null };
    const notes: string[] = [];
    if (back.auth_user_id) {
      const person = unwrapMaybe(await db.from("employees").select("active").eq("id", back.record_id).maybeSingle(), "person");
      if (person?.active) {
        const { error: banError } = await db.auth.admin.updateUserById(back.auth_user_id, { ban_duration: "none" });
        if (banError) notes.push(`The sign-in could not be unblocked: ${banError.message}`);
      }
    }
    return {
      result: { restored: back.label, kind: back.kind, record_id: back.record_id, notes: notes.length ? notes : undefined },
      summary: `restored ${back.label}`,
    };
  },
});

// --- Archive -----------------------------------------------------------------------------------------------------------------

/** The trips from today on that would lose their driver or vehicle (assigned or declined, not started). */
export async function tripsFromToday(db: Db, column: "employee_id" | "vehicle_id", id: string, now: Date) {
  const from = new Date(`${colomboDate(now)}T00:00:00+05:30`).toISOString();
  const rows = unwrap(
    await db.from("tasks").select("id, title, start_at, status").eq(column, id).in("status", ["assigned", "declined"]).gte("start_at", from)
      .order("start_at").limit(50),
    "tasks",
  );
  return rows.map((t) => ({ task_id: t.id, title: t.title, when: `${colomboDate(new Date(t.start_at))} ${colomboTime(new Date(t.start_at))}` }));
}

export const setVehicleActive = tool({
  name: "set_vehicle_active",
  title: "Archive or restore a vehicle",
  description: "active false archives the vehicle (returned): it leaves the lists and pickers, its history and reports stay. If it is " +
    "booked from today on, the answer is needs_confirm with the trips: reassign them, or call again with confirm true. " +
    "active true restores it.",
  readOnly: false,
  input: z.object({ reg_no: zText(40), active: z.boolean(), confirm: z.boolean().optional() }),
  async run({ reg_no, active, confirm }, { db, now }) {
    const v = findVehicle(await loadRefs(db), reg_no);
    if (!active && !confirm) {
      const trips = await tripsFromToday(db, "vehicle_id", v.id, now);
      if (trips.length) {
        return {
          result: { needs_confirm: true, vehicle: v.reg_no, trips, note: `${v.reg_no} is booked for ${trips.length} trip(s) from today on. Reassign them first, or archive it anyway.` },
          summary: `archive ${v.reg_no}: needs confirm (${trips.length} trips)`,
        };
      }
    }
    unwrap(await db.from("vehicles").update({ active }).eq("id", v.id).select("id"), "vehicle");
    return { result: { vehicle: v.reg_no, active }, summary: `${v.reg_no} ${active ? "restored" : "archived"}` };
  },
});

export const setProjectArchived = tool({
  name: "set_project_archived",
  title: "Archive or restore a project",
  description: "archived true: the project leaves find_project and the pickers (its trips and reports keep it); false restores it. " +
    "An import from Zoho never undoes an archive.",
  readOnly: false,
  input: z.object({ project: zId, archived: z.boolean() }),
  async run({ project, archived }, { db, now, actor }) {
    const row = unwrap(
      await db.from("projects").update(archived ? { archived_at: now.toISOString(), archived_by: actor.name } : { archived_at: null, archived_by: null })
        .eq("id", project).select("name").single(),
      "project",
    );
    return { result: { project: row.name, archived }, summary: `project ${row.name} ${archived ? "archived" : "restored"}` };
  },
});

export const setRentalCompanyArchived = tool({
  name: "set_rental_company_archived",
  title: "Archive or restore a rental company",
  description: "archived true: it leaves the rental company picker (its vehicles keep it); false restores it.",
  readOnly: false,
  input: z.object({ company: zId, archived: z.boolean() }),
  async run({ company, archived }, { db, now, actor }) {
    const row = unwrap(
      await db.from("rental_companies").update(archived ? { archived_at: now.toISOString(), archived_by: actor.name } : { archived_at: null, archived_by: null })
        .eq("id", company).select("name").single(),
      "rental company",
    );
    return { result: { company: row.name, archived }, summary: `rental company ${row.name} ${archived ? "archived" : "restored"}` };
  },
});

export const listRentalCompanies = tool({
  name: "list_rental_companies",
  title: "Rental companies",
  description: "The rental companies with how many vehicles each has; archived ones only with archived true.",
  readOnly: true,
  input: z.object({ archived: z.boolean().optional().describe("The archived ones instead") }),
  async run({ archived }, { db }) {
    let q = db.from("rental_companies").select("id, name, phone, archived_at, archived_by").order("name");
    q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    const rows = unwrap(await q, "rental companies");
    const vehicles = unwrap(await db.from("vehicles").select("rental_company_id").not("rental_company_id", "is", null), "vehicles");
    const count = new Map<string, number>();
    for (const v of vehicles) count.set(v.rental_company_id as string, (count.get(v.rental_company_id as string) ?? 0) + 1);
    const companies = rows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? undefined,
      vehicles: count.get(c.id) ?? 0,
      archived: c.archived_at ? `${colomboDate(new Date(c.archived_at))} by ${c.archived_by ?? "–"}` : undefined,
    }));
    return { result: { companies }, summary: `${companies.length} rental companies${archived ? " (archived)" : ""}` };
  },
});

export const listProjects = tool({
  name: "list_projects",
  title: "Projects",
  description: "The projects, newest first, a page at a time; search by name, short name or job number; archived ones only with archived true.",
  readOnly: true,
  input: z.object({ archived: z.boolean().optional(), search: zSearch, ...zPaging }),
  async run({ archived, search, limit, cursor }, { db }) {
    let q = db.from("projects").select("id, job_no, short_name, name, customer_name, status, archived_at, archived_by").order("updated_at", {
      ascending: false,
    });
    q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    if (search) {
      const s = search.replace(/[%_,()]/g, " ").trim();
      if (s) q = q.or(`name.ilike.%${s}%,short_name.ilike.%${s}%,job_no.ilike.%${s}%`);
    }
    const rows = unwrap(await q.limit(500), "projects");
    const projects = rows.map((p) => ({
      id: p.id,
      job_no: p.job_no ?? undefined,
      short_name: p.short_name ?? undefined,
      name: p.name,
      customer: p.customer_name ?? undefined,
      status: p.status ?? undefined,
      archived: p.archived_at ? `${colomboDate(new Date(p.archived_at))} by ${p.archived_by ?? "–"}` : undefined,
    }));
    const page = pageOf(projects, pageWindow(limit, cursor));
    return {
      result: { projects: page.rows, total: page.total ?? projects.length, next: page.next },
      summary: `${projects.length} projects${archived ? " (archived)" : ""}`,
    };
  },
});

// --- The purge (the retention job) -------------------------------------------------------------------------------------------

/**
 * The bin's items past their 30 days: their storage files removed, a person's sign-in account deleted, then the item itself
 * (bin_forget). A file or an account that fails stays for the next run with its item (nothing half-forgotten).
 */
export async function purgeBin(db: Db, now: Date): Promise<{ purged: number; files: number; accounts: number; failed: number }> {
  const due = unwrap(
    await db.from("bin_items").select("id, files, auth_user_id").lte("purge_after", now.toISOString()).order("purge_after").limit(100),
    "bin",
  );
  const done: string[] = [];
  let files = 0;
  let accounts = 0;
  let failed = 0;
  for (const item of due) {
    const list = (Array.isArray(item.files) ? item.files : []) as { bucket: string; path: string }[];
    const byBucket = new Map<string, string[]>();
    for (const f of list) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
    let ok = true;
    for (const [bucket, paths] of byBucket) {
      const { error } = await db.storage.from(bucket).remove(paths);
      if (error) ok = false;
      else files += paths.length;
    }
    if (ok && item.auth_user_id) {
      const { error } = await db.auth.admin.deleteUser(item.auth_user_id);
      // Already gone is fine; anything else waits for the next run.
      if (error && !/not found/i.test(error.message)) ok = false;
      else accounts += 1;
    }
    if (ok) done.push(item.id);
    else failed += 1;
  }
  let purged = 0;
  if (done.length) {
    const { data, error } = await db.rpc("bin_forget", { p_ids: done });
    if (error) throw new Error(`bin forget: ${error.message}`);
    purged = Number(data ?? 0);
  }
  return { purged, files, accounts, failed };
}
