// The Assign-a-task form's rules, kept apart from the screen so they can be
// tested: what is required, how the project split must add up, and the exact
// create_task / plan_task arguments (the connector contract). Phase 7: the
// driver first and the vehicle they bring when none is picked (the call then
// names no vehicle and the server takes the same one); Start from with
// "Passengers get in here".
import { waLink } from "../lib/format";
import { defaultStops, hasDeadline, type StartFields, startInput, type StopDraft, stopsInput } from "./stopsLogic";

export interface ProjectRow {
  project: string;
  percent: string | number;
  match?: string;
  bad?: boolean;
}

export interface AssignFields extends StartFields {
  title: string;
  date: string;
  /** The leave-by time typed by hand; empty = planned from the stops' deadlines. */
  leaveBy: string;
  stops: StopDraft[];
  returnToBase: boolean;
  avoidExpressway: boolean;
  buffer: string;
  driver: string;
  /** The vehicle picked; "" = the one the driver brings (their vehicle today, else their regular one). */
  vehicle: string;
  end: string;
  pax: string;
  cname: string;
  cphone: string;
  notes: string;
  whatsapp: boolean;
}

export const emptyAssign = (date: string): AssignFields => ({
  title: "", date, leaveBy: "", stops: defaultStops(), start: "", startPax: false, returnToBase: false, avoidExpressway: false, buffer: "",
  driver: "", vehicle: "", end: "", pax: "", cname: "", cphone: "", notes: "", whatsapp: false,
});

export const splitTotal = (rows: ProjectRow[]) => rows.reduce((a, r) => a + (Number(r.percent) || 0), 0);

type Base = { id: string; name: string } | null;

/**
 * The part of the form the planner needs, as plan_task takes it; null when it cannot be planned yet.
 * `base`: the base place, named only when passengers get in there (otherwise the server takes it by itself).
 */
export function planInput(f: AssignFields, base: Base = null): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  if (!t(f.date)) return null;
  const s = stopsInput(f.stops, f.startPax ? 1 : 0);
  if ("error" in s) return null;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return null;
  const input: Record<string, unknown> = { date: t(f.date), stops: s.stops };
  if (t(f.leaveBy)) input.leave_by = t(f.leaveBy);
  const start = startInput(f, base);
  if (start) input.start = start;
  if (f.returnToBase) input.return_to_base = true;
  if (f.avoidExpressway) input.avoid_expressway = true;
  if (t(f.buffer) !== "") input.buffer_min = Math.max(0, Math.min(600, parseInt(t(f.buffer), 10) || 0));
  if (t(f.driver)) input.driver = t(f.driver);
  if (t(f.vehicle)) input.vehicle = t(f.vehicle);
  if (t(f.end)) input.end_time = t(f.end);
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
  if (t(f.pax) !== "") input.passengers = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (t(f.cname)) input.contact_name = t(f.cname);
  if (t(f.cphone)) input.contact_phone = t(f.cphone);
  if (t(f.notes)) input.notes = t(f.notes);
  if (used.length) input.projects = used.map((r) => ({ project: r.project.trim(), percent: Number(r.percent) }));
  if (createdBy) input.created_by = createdBy.slice(0, 80);
  return { input };
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
