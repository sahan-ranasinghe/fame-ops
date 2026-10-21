// The Assign-a-task form's rules, kept apart from the screen so they can be
// tested: what is required, how the project split must add up, and the exact
// create_task / plan_task arguments (the connector contract). Phase 7: the
// driver first and the vehicle they bring when none is picked (the call then
// names no vehicle and the server takes the same one); Start from with
// "Passengers get in here". The trip part is the trip editor's (§34); a task
// proposed by someone without approve waits for the fleet admin's OK (§33).
import type { CreateTaskResult } from "../data/types";
import { waLink } from "../lib/format";
import { emptyWho, plateReason, type WhoDrivesValue, whoInput } from "../ui/whoDrivesLogic";
import { hasDeadline, stopsInput } from "./stopsLogic";
import { type Base, emptyTrip, type TripFields, tripPlanInput } from "./tripLogic";
import { isChoice } from "./vehicleChoiceLogic";

export interface ProjectRow {
  project: string;
  percent: string | number;
  match?: string;
  bad?: boolean;
}

/** The trip (the day, the leave-by, the stops, the start, "Vehicle free by" as `end`), then the task's own fields. */
export interface AssignFields extends TripFields {
  title: string;
  buffer: string;
  driver: string;
  /** The vehicle picked; "" = the one the driver brings (their vehicle today, else their regular one). */
  vehicle: string;
  pax: string;
  cname: string;
  cphone: string;
  notes: string;
  whatsapp: boolean;
  /** Round 3: who drives (ui/WhoDrives); absent in a draft from before Round 3 = a driver. */
  who?: WhoDrivesValue;
}

/** The form's "Who drives?" (a driver when a draft has none). */
export const assignWho = (f: Pick<AssignFields, "who">): WhoDrivesValue => f.who ?? emptyWho();

export const emptyAssign = (date: string): AssignFields => ({
  ...emptyTrip(date), title: "", buffer: "", driver: "", vehicle: "", pax: "", cname: "", cphone: "", notes: "", whatsapp: false,
});

export const splitTotal = (rows: ProjectRow[]) => rows.reduce((a, r) => a + (Number(r.percent) || 0), 0);

/**
 * The part of the form the planner needs, as plan_task takes it (the trip, then the buffer, the driver and vehicle for
 * the overlaps and the end time); null when it cannot be planned yet. `base`: the base place, named only when
 * passengers get in there (otherwise the server takes it by itself).
 */
export function planInput(f: AssignFields, base: Base = null): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  const input = tripPlanInput(f, base);
  if (!input) return null;
  if (t(f.buffer) !== "") input.buffer_min = Math.max(0, Math.min(600, parseInt(t(f.buffer), 10) || 0));
  if (t(f.driver)) input.driver = t(f.driver);
  if (t(f.vehicle)) input.vehicle = t(f.vehicle);
  if (t(f.end)) input.end_time = t(f.end);
  // Round 3: no driver of ours when the person or someone else drives (the plan checks the vehicle only).
  if (assignWho(f).by !== "driver") delete input.driver;
  return input;
}

/**
 * create_task's arguments, or what is missing. `opts.defaultVehicle`: the vehicle the driver brings (Who's
 * available); with it no vehicle needs picking and the call names none (the server takes the same one).
 * null = known to bring none (a vehicle must be picked); undefined = not known yet (the server decides).
 */
export function validateAssign(
  f: AssignFields,
  rows: ProjectRow[],
  createdBy?: string,
  opts: { defaultVehicle?: string | null; base?: Base } = {},
): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const who = assignWho(f);
  // Round 3: the person or someone else drives: no driver, and a plate (nobody confirms a vehicle on the day).
  if (who.by !== "driver") return validateNoApp(f, rows, who, createdBy, opts.base ?? null);
  // The vehicle fills itself when the driver brings one, or when that is not known yet (the server then decides).
  const fills = !!t(f.driver) && "defaultVehicle" in opts && opts.defaultVehicle !== null;
  const need: [string, string][] = [[t(f.title), "the task"], [t(f.date), "the date"], [t(f.driver), "a driver"], [t(f.vehicle) || (fills ? "filled" : ""), "a vehicle"]];
  const miss = need.filter(([v]) => !v).map((n) => n[1]);
  if (miss.length) return { error: `Add ${miss.join(", ")}.` };
  const s = stopsInput(f.stops, f.startPax ? 1 : 0);
  if ("error" in s) return s;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return { error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." };
  const used = rows.filter((r) => r.project.trim());
  const total = splitTotal(used);
  if (used.length && Math.abs(total - 100) > 0.01) {
    return { error: `Project percentages add up to ${total}%. They must total 100%.` };
  }
  const input: Record<string, unknown> = { ...planInput(f, opts.base ?? null), title: t(f.title), driver: t(f.driver) };
  if (t(f.vehicle)) input.vehicle = t(f.vehicle);
  return { input: { ...input, ...taskExtras(f, used, createdBy) } };
}

/** The task's own fields after the trip: passengers, the contact, the notes, the projects, who assigned it. */
function taskExtras(f: AssignFields, used: ProjectRow[], createdBy?: string): Record<string, unknown> {
  const t = (s: string) => s.trim();
  const input: Record<string, unknown> = {};
  if (t(f.pax) !== "") input.passengers = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (t(f.cname)) input.contact_name = t(f.cname);
  if (t(f.cphone)) input.contact_phone = t(f.cphone);
  if (t(f.notes)) input.notes = t(f.notes);
  if (used.length) input.projects = used.map((r) => ({ project: r.project.trim(), percent: Number(r.percent) }));
  if (createdBy) input.created_by = createdBy.slice(0, 80);
  return input;
}

/** create_task when the person (self) or someone else (other) drives: no driver, a plate, who drives. */
function validateNoApp(f: AssignFields, rows: ProjectRow[], who: WhoDrivesValue, createdBy: string | undefined, base: Base): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const miss = ([[t(f.title), "the task"], [t(f.date), "the date"]] as [string, string][]).filter(([v]) => !v).map((n) => n[1]);
  if (miss.length) return { error: `Add ${miss.join(", ")}.` };
  const w = whoInput(who);
  if ("error" in w) return w;
  if (!t(f.vehicle) || isChoice(t(f.vehicle))) return { error: plateReason(who) };
  const s = stopsInput(f.stops, f.startPax ? 1 : 0);
  if ("error" in s) return s;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return { error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." };
  const used = rows.filter((r) => r.project.trim());
  const total = splitTotal(used);
  if (used.length && Math.abs(total - 100) > 0.01) return { error: `Project percentages add up to ${total}%. They must total 100%.` };
  const input: Record<string, unknown> = { ...planInput(f, base), title: t(f.title), vehicle: t(f.vehicle), ...w.input };
  return { input: { ...input, ...taskExtras(f, used, createdBy) } };
}

/**
 * What Assign a task says after create_task: sent to the driver, or (§33: no approve permission while new tasks need
 * the fleet admin's OK) waiting in the approval queue as a request, with no task yet and nothing sent.
 */
export function assignOutcome(p: Pick<CreateTaskResult, "waiting_for_approval" | "request_id" | "next" | "task_id">, driverName: string, drivenBy: WhoDrivesValue["by"] = "driver"): {
  waiting: boolean;
  head: string;
  toast: string;
  /** The request while it waits; the task once sent. */
  link?: { to: string; label: string };
} {
  if (p.waiting_for_approval || (!p.task_id && p.request_id)) {
    return {
      waiting: true,
      head: p.next ?? "Waiting for the fleet admin's OK · you'll be notified.",
      toast: "Waiting for the fleet admin's OK",
      link: p.request_id ? { to: `/requests/${p.request_id}`, label: "Open the request" } : undefined,
    };
  }
  const link = p.task_id ? { to: `/tasks/${p.task_id}`, label: "Open task →" } : undefined;
  // Round 3: nothing is sent when the person or someone else drives (no app).
  if (drivenBy === "self") return { waiting: false, head: "Saved. You drive it yourself: nothing is sent.", toast: "Task saved · you drive it", link };
  if (drivenBy === "other") return { waiting: false, head: `Saved. ${driverName} drives it: no app, nothing is sent.`, toast: `Task saved · ${driverName} drives it`, link };
  return { waiting: false, head: `Sent to ${driverName}.`, toast: `Task sent to ${driverName}`, link };
}

/** The WhatsApp message for the driver, when the office asked for one. */
export function driverWhatsApp(input: Record<string, unknown>, phone?: string | null, leaveBy?: string): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const stops = (input.stops as { type: string; place?: string }[] | undefined) ?? [];
  const word: Record<string, string> = { pickup: "Pickup", drop: "Drop-off", visit: "Visit" };
  const lines = stops.map((x) => `${word[x.type] ?? "Stop"}: ${x.place ?? ""}`.trim());
  const contact = s("contact_name") ? `\nContact: ${s("contact_name")}${s("contact_phone") ? " " + s("contact_phone") : ""}` : "";
  return waLink(phone, `New task: ${s("title")}\n${leaveBy ?? `${s("date")} ${s("leave_by")}`}\n${lines.join("\n")}${contact}\nOpen Fame Driver for the details.`);
}
