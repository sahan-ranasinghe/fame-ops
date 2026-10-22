// Round 4–7, feature 7 (Sahan, 22 October 2026): who holds a busy driver or vehicle (Google Calendar's room booking: who
// booked it, their photo and the time; Airbnb's host to contact). The holder of a trip is the person who asked for it (its
// request), else the person who assigned it. Office users only see them; with the switch holder_contact off nobody is shown
// (the warnings say only that it is busy).

import type { Db, Row } from "./db.ts";
import { unwrap } from "./db.ts";
import { contactLinks, phoneDisplay } from "./format.ts";
import { driverPhotoLinks } from "./media.ts";
import { colomboTime } from "./time.ts";

type Task = Row<"tasks">;

export interface Holder {
  task_id: string;
  employee_id?: string;
  name: string;
  /** Their role as a label ("Fleet admin", "Staff"). */
  label?: string;
  photo_url?: string;
  /** asked = the trip's requester; assigned = the person who assigned it. */
  by: "asked" | "assigned";
  /** "08:00–11:00" (the planned end when the task has none). */
  window: string;
  from: string;
  to?: string;
  phone?: string;
  phone_display?: string;
  call?: string;
  whatsapp?: string;
}

const ROLE_TEXT: Record<string, string> = {
  admin: "Admin",
  fleet_admin: "Fleet admin",
  office: "Office",
  coordinator: "Coordinator",
  staff: "Staff",
  viewer: "Viewer",
};

/** Whether holders are shown (the switch holder_contact; no row = on). */
export async function holderContactOn(db: Db): Promise<boolean> {
  const { data } = await db.from("fleet_settings").select("value").eq("key", "holder_contact").maybeSingle();
  return data?.value !== false;
}

/** The holder of each task (task id → Holder): its requester, else who assigned it. Empty when the switch is off. */
export async function holdersOf(
  db: Db,
  tasks: readonly Pick<Task, "id" | "request_id" | "assigned_by_employee_id" | "start_at" | "end_by" | "plan_json">[],
  now = new Date(),
  on?: boolean,
): Promise<Map<string, Holder>> {
  const out = new Map<string, Holder>();
  if (!tasks.length || !(on ?? await holderContactOn(db))) return out;
  const requestIds = [...new Set(tasks.flatMap((t) => (t.request_id ? [t.request_id] : [])))];
  const requests = new Map(
    requestIds.length
      ? unwrap(
        await db.from("vehicle_requests").select("id, requested_by_employee_id, requested_by_name").in("id", requestIds),
        "vehicle requests",
      ).map((r) => [r.id, r])
      : [],
  );
  const holderId = (t: (typeof tasks)[number]) => {
    const r = t.request_id ? requests.get(t.request_id) : undefined;
    return r?.requested_by_employee_id ?? (r ? null : t.assigned_by_employee_id);
  };
  const ids = [...new Set(tasks.flatMap((t) => (holderId(t) ? [holderId(t)!] : [])))];
  const people = ids.length
    ? unwrap(await db.from("employees").select("id, name, role, phone, photo_id").in("id", ids), "employees")
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const photos = people.length ? await driverPhotoLinks(db, people, now) : new Map<string, string>();
  for (const t of tasks) {
    const r = t.request_id ? requests.get(t.request_id) : undefined;
    const id = holderId(t);
    const p = id ? byId.get(id) : undefined;
    const name = p?.name ?? r?.requested_by_name;
    if (!name) continue;
    const end = t.end_by ?? (t.plan_json as { ends_at?: string } | null)?.ends_at ?? null;
    const links = contactLinks(p?.phone ?? null);
    out.set(t.id, {
      task_id: t.id,
      employee_id: p?.id,
      name,
      label: p ? ROLE_TEXT[p.role] ?? undefined : undefined,
      photo_url: p ? photos.get(p.id) : undefined,
      by: r ? "asked" : "assigned",
      window: end ? `${colomboTime(t.start_at)}–${colomboTime(end)}` : `from ${colomboTime(t.start_at)}`,
      from: colomboTime(t.start_at),
      to: end ? colomboTime(end) : undefined,
      phone: p?.phone ?? undefined,
      phone_display: phoneDisplay(p?.phone),
      call: links.call ?? undefined,
      whatsapp: links.whatsapp ?? undefined,
    });
  }
  return out;
}
