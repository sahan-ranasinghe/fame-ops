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
import { type AnyTool, type Ctx, type Out, tool, zId, zText } from "../tool.ts";

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

type Target = { table: "task_passengers"; column: "task_id"; id: string } | {
  table: "request_passengers";
  column: "request_id";
  id: string;
};

/** Keeps exactly these passengers on a task or a request: the same ones stay, the others are removed (never deleted). */
async function keepPassengers(db: Db, target: Target, rows: readonly PassengerRow[], by: string, now: Date): Promise<void> {
  const current = unwrap(
    // deno-lint-ignore no-explicit-any
    await (db.from(target.table) as any).select("id, employee_id, name, phone").eq(target.column, target.id).is("removed_at", null),
    "passengers",
  ) as { id: string; employee_id: string | null; name: string; phone: string | null }[];
  const same = (a: PassengerRow, b: { employee_id: string | null; name: string; phone: string | null }) =>
    a.employee_id ? a.employee_id === b.employee_id : !b.employee_id && a.name === b.name && a.phone === b.phone;
  const gone = current.filter((c) => !rows.some((r) => same(r, c)));
  const added = rows.filter((r) => !current.some((c) => same(r, c)));
  if (gone.length) {
    // deno-lint-ignore no-explicit-any
    unwrap(await (db.from(target.table) as any).update({ removed_at: now.toISOString() }).in("id", gone.map((g) => g.id)), "passengers");
  }
  if (added.length) {
    unwrap(
      // deno-lint-ignore no-explicit-any
      await (db.from(target.table) as any).insert(added.map((r) => ({ [target.column]: target.id, ...r, added_by: by }))),
      "passengers",
    );
  }
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
 * names), then the names are kept against what it saved. `count`: the tool's own count field; `targets`: where the names go
 * once it answered (created: the task_id and / or request_id of the answer; an edit: the trip it changed).
 */
export function withPassengerList<T extends AnyTool>(
  t: T,
  opts: {
    count: "passengers" | "pax";
    /** An edit's own ids: with nothing else sent, only the names change (the tool itself would say "Nothing to change"). */
    ids?: readonly string[];
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
      const onlyNames = !!opts.ids && Object.entries(rest).every(([k, v]) => opts.ids!.includes(k) || v === undefined);
      const count = countWith(rest[opts.count] as number | null | undefined, checked.rows.length);
      const out = onlyNames
        ? { result: Object.fromEntries(opts.ids!.map((k) => [k, rest[k]])), summary: `passengers of ${opts.ids!.map((k) => rest[k]).join(" ")}` }
        : await t.run({ ...rest, ...(count != null && { [opts.count]: count }) }, ctx);
      const result = (out.result ?? {}) as Record<string, unknown>;
      for (const target of await opts.targets(rest, result, ctx.db)) {
        await keepPassengers(ctx.db, target, checked.rows, ctx.actor.name, ctx.now);
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
    ...(taskId ? [{ table: "task_passengers", column: "task_id", id: taskId } as const] : []),
    ...(requestId ? [{ table: "request_passengers", column: "request_id", id: requestId } as const] : []),
  ];
};

export const taskTarget = (id: string): Target => ({ table: "task_passengers", column: "task_id", id });
export const requestTarget = (id: string): Target => ({ table: "request_passengers", column: "request_id", id });

/** update_request: the request's names, and its task's when it has one (who rides needs no new approval). */
export async function requestTargets(args: Record<string, unknown>, _result: Record<string, unknown>, db: Db): Promise<Target[]> {
  const id = args.request_id as string;
  const r = unwrap(await db.from("vehicle_requests").select("task_id").eq("id", id).single(), "request");
  return [requestTarget(id), ...(r.task_id ? [taskTarget(r.task_id)] : [])];
}
