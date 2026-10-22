// Round 4–7, feature 6 (Sahan, 22 October 2026): passengers on trips. find_people for the Passengers field (Google
// Calendar's guest search: registered office people with their photo); passenger_list on the trip tools (one wrapper:
// the list is checked before the trip is saved, then kept against the task and / or the request the tool answered); the
// passengers on the answers. The rules: passengers.ts; the notices: the database.

import { z } from "zod";
import { type Db, ToolError, unwrap } from "../db.ts";
import { type Employee, loadRefs } from "../fleet.ts";
import { contactLinks, phoneDisplay } from "../format.ts";
import { driverPhotoLinks } from "../media.ts";
import { countWith, MAX_PASSENGERS, type PassengerIn, type PassengerRow, passengerRows } from "../passengers.ts";
import type { Json } from "../database.types.ts";
import { type AnyTool, type Ctx, type Out, type PassengersToKeep, tool, zId, zText } from "../tool.ts";

export const zPassengerList = z.array(z.object({
  person: zId.optional().describe("A registered office person's id (find_people)"),
  name: zText(120).optional().describe("Someone without an account: their name"),
  phone: zText(30).optional().describe("Their phone (Sri Lankan), optional"),
})).max(MAX_PASSENGERS).describe(
  "Who rides, by name (optional; the passenger count stays and is never under the names): registered office people are " +
    "told about the trip and see it in My trips; a typed name and phone can be sent the trip by WhatsApp",
);

const isOffice = (e: Employee) => e.role !== "driver" && e.active && !e.demo;

/** The role as a label beside a name (the permissions decide; the role is the label: permissions.ts). */
const ROLE_TEXT: Record<string, string> = {
  admin: "Admin",
  fleet_admin: "Fleet admin",
  office: "Office",
  coordinator: "Coordinator",
  staff: "Staff",
  viewer: "Viewer",
};
const roleLabel = (role: string) => ROLE_TEXT[role] ?? role;

export const findPeople = tool({
  name: "find_people",
  title: "Find people",
  description: "Active office people by name for the Passengers field: id, name, label (their role) and photo. No phone or " +
    "e-mail. At most 20.",
  readOnly: true,
  input: z.object({ text: zText(80).describe("Part of a name") }),
  async run({ text }, { db, now }) {
    const refs = await loadRefs(db);
    const want = text.trim().toLowerCase();
    const found = refs.employees.filter(isOffice).filter((e) =>
      e.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(want)) || e.name.toLowerCase().includes(want)
    ).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
    const photos = found.length ? await driverPhotoLinks(db, found, now) : new Map<string, string>();
    return {
      result: {
        count: found.length,
        people: found.map((e) => ({ id: e.id, name: e.name, label: roleLabel(e.role), photo_url: photos.get(e.id) })),
      },
      summary: `${found.length} people for "${text}"`,
    };
  },
});

/** The active office people a passenger list may name (id → name, phone). */
async function officePeople(db: Db): Promise<Map<string, { name: string; phone: string | null }>> {
  const refs = await loadRefs(db);
  return new Map(refs.employees.filter(isOffice).map((e) => [e.id, { name: e.name, phone: e.phone }]));
}

/** A trip whose passengers are kept: a task or a request (its task follows it in the database). */
type Target = { table: "tasks" | "vehicle_requests"; id: string };

/**
 * The trip write's own passenger_list: the database applies it in the same statement (the triggers of
 * 20261022130000_round6_passengers_tx.sql), so the trip is never saved without its passengers. Marks the list as written.
 */
export function passengerColumn(keep: PassengersToKeep | undefined): { passenger_list?: Json } {
  if (!keep) return {};
  keep.written = true;
  return { passenger_list: keep.list as unknown as Json };
}

/** The names alone (or a tool that did not carry them): one statement on the trip, applied by the database. */
async function writePassengerColumn(db: Db, target: Target, list: PassengersToKeep["list"]): Promise<void> {
  // deno-lint-ignore no-explicit-any
  unwrap(await (db.from(target.table) as any).update({ passenger_list: list }).eq("id", target.id), "passengers");
}

export interface PassengerCard {
  name: string;
  registered: boolean;
  employee_id?: string;
  photo_url?: string;
  phone?: string;
  phone_display?: string;
  call?: string;
  whatsapp?: string;
}

/** The passengers of tasks or requests, for the answers (registered with their photo; a typed one with Call / WhatsApp). */
export async function passengerCards(
  db: Db,
  pick: { taskIds?: readonly string[]; requestIds?: readonly string[] },
  now: Date,
): Promise<Map<string, PassengerCard[]>> {
  const out = new Map<string, PassengerCard[]>();
  const rows: { owner: string; employee_id: string | null; name: string; phone: string | null }[] = [];
  if (pick.taskIds?.length) {
    for (
      const r of unwrap(
        await db.from("task_passengers").select("task_id, employee_id, name, phone").in("task_id", [...pick.taskIds]).is(
          "removed_at",
          null,
        ).order("created_at"),
        "passengers",
      )
    ) rows.push({ owner: r.task_id, employee_id: r.employee_id, name: r.name, phone: r.phone });
  }
  if (pick.requestIds?.length) {
    for (
      const r of unwrap(
        await db.from("request_passengers").select("request_id, employee_id, name, phone").in("request_id", [...pick.requestIds])
          .is("removed_at", null).order("created_at"),
        "passengers",
      )
    ) rows.push({ owner: r.request_id, employee_id: r.employee_id, name: r.name, phone: r.phone });
  }
  if (!rows.length) return out;
  const refs = await loadRefs(db);
  const registered = [...new Set(rows.flatMap((r) => (r.employee_id ? [r.employee_id] : [])))].flatMap((id) => refs.emp.get(id) ?? []);
  const photos = registered.length ? await driverPhotoLinks(db, registered, now) : new Map<string, string>();
  for (const r of rows) {
    const phone = r.employee_id ? refs.emp.get(r.employee_id)?.phone ?? null : r.phone;
    const links = contactLinks(phone);
    const list = out.get(r.owner) ?? [];
    list.push({
      name: r.employee_id ? refs.emp.get(r.employee_id)?.name ?? r.name : r.name,
      registered: !!r.employee_id,
      employee_id: r.employee_id ?? undefined,
      photo_url: r.employee_id ? photos.get(r.employee_id) : undefined,
      phone: phone ?? undefined,
      phone_display: phoneDisplay(phone),
      call: links.call ?? undefined,
      whatsapp: links.whatsapp ?? undefined,
    });
    out.set(r.owner, list);
  }
  return out;
}

/**
 * A trip tool with passenger_list: checked first, then the tool runs as before (the count it saves is never under the
 * names) and writes the names WITH its own row (ctx.passengers → passengerColumn: one transaction). `count`: the tool's own
 * count field; `targets`: the trip (created: the task_id and / or request_id of the answer; an edit: the trip it changes),
 * for names alone and, never expected, a tool that did not carry them.
 */
export function withPassengerList<T extends AnyTool>(
  t: T,
  opts: {
    count: "passengers" | "pax";
    /** An edit's own ids: with nothing else sent, only the names change (the tool itself would say "Nothing to change"). */
    ids?: readonly string[];
    /** With `ids`: the tool's own first checks (whose trip, the version loaded, its state), run before names alone are kept. */
    guard?: (args: Record<string, unknown>, ctx: Ctx) => Promise<void>;
    targets: (args: Record<string, unknown>, result: Record<string, unknown>, db: Db) => Promise<Target[]> | Target[];
  },
): T {
  return {
    ...t,
    description: `${t.description} passenger_list names who rides (find_people for office people; a name and phone for anyone else).`,
    input: t.input.extend({ passenger_list: zPassengerList.optional() }),
    async run(args: Record<string, unknown>, ctx: Ctx): Promise<Out> {
      const { passenger_list, ...rest } = args as Record<string, unknown> & { passenger_list?: PassengerIn[] };
      if (passenger_list === undefined) return await t.run(rest, ctx);
      const checked = passengerRows(passenger_list, await officePeople(ctx.db));
      if ("error" in checked) throw new ToolError(checked.error);
      const keep: PassengersToKeep = { list: { by: ctx.actor.name, rows: checked.rows }, written: false };
      const onlyNames = !!opts.ids && Object.entries(rest).every(([k, v]) => opts.ids!.includes(k) || v === undefined);
      // Names alone never skip the tool's checks: an edit tool without its guard always runs.
      if (onlyNames && !opts.guard) throw new ToolError("Nothing to change.");
      if (onlyNames) {
        await opts.guard!(rest, ctx);
        for (const target of await opts.targets(rest, {}, ctx.db)) await writePassengerColumn(ctx.db, target, keep.list);
        return {
          result: { ...Object.fromEntries(opts.ids!.map((k) => [k, rest[k]])), passengers_named: checked.rows.length },
          summary: `passengers of ${opts.ids!.map((k) => rest[k]).join(" ")}`,
        };
      }
      const count = countWith(rest[opts.count] as number | null | undefined, checked.rows.length);
      const out = await t.run({ ...rest, ...(count != null && { [opts.count]: count }) }, { ...ctx, passengers: keep });
      const result = (out.result ?? {}) as Record<string, unknown>;
      if (!keep.written) {
        // Never expected (every trip write carries them): the names still go on the trip, in their own statement.
        console.error(`withPassengerList: ${t.name} saved without passenger_list; written after`);
        for (const target of await opts.targets(rest, result, ctx.db)) await writePassengerColumn(ctx.db, target, keep.list);
      }
      return { ...out, result: { ...result, passengers_named: checked.rows.length } };
    },
  } as T;
}

/** The targets of a tool that made a trip: its answer's task and / or request. */
export const createdTargets = (_args: Record<string, unknown>, result: Record<string, unknown>): Target[] => {
  // create_task: task_id (or request_id for a proposed task); create_request: the request card; book_vehicle: both.
  const taskId = result.task_id as string | undefined;
  const requestId = (result.request_id as string | undefined) ?? (result.request as { id?: string } | undefined)?.id;
  return [
    ...(taskId ? [{ table: "tasks", id: taskId } as const] : []),
    ...(requestId ? [{ table: "vehicle_requests", id: requestId } as const] : []),
  ];
};

export const taskTarget = (id: string): Target => ({ table: "tasks", id });
export const requestTarget = (id: string): Target => ({ table: "vehicle_requests", id });

/** update_request: the request's names (the database gives its task, when it has one, the same: no new approval). */
export function requestTargets(args: Record<string, unknown>): Target[] {
  return [requestTarget(args.request_id as string)];
}
