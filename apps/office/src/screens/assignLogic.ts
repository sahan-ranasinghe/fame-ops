// The Assign-a-task form's rules, kept apart from the screen so they can be
// tested: what is required, how the project split must add up, and the exact
// create_task / plan_task arguments (the connector contract).
import { waLink } from "../lib/format";
import { defaultStops, hasDeadline, type StopDraft, stopsInput } from "./stopsLogic";

export interface ProjectRow {
  project: string;
  percent: string | number;
  match?: string;
  bad?: boolean;
}

export interface AssignFields {
  title: string;
  date: string;
  /** The leave-by time typed by hand; empty = planned from the stops' deadlines. */
  leaveBy: string;
  stops: StopDraft[];
  start: string;
  /** The start picked in the search box (Part 4). */
  startPlaceId?: string;
  /** The start picked from Google's place search (Part 5). */
  startGooglePlaceId?: string;
  returnToBase: boolean;
  avoidExpressway: boolean;
  buffer: string;
  driver: string;
  vehicle: string;
  end: string;
  pax: string;
  cname: string;
  cphone: string;
  notes: string;
  whatsapp: boolean;
}

export const emptyAssign = (date: string): AssignFields => ({
  title: "", date, leaveBy: "", stops: defaultStops(), start: "", returnToBase: false, avoidExpressway: false, buffer: "",
  driver: "", vehicle: "", end: "", pax: "", cname: "", cphone: "", notes: "", whatsapp: false,
});

export const splitTotal = (rows: ProjectRow[]) => rows.reduce((a, r) => a + (Number(r.percent) || 0), 0);

/** The part of the form the planner needs, as plan_task takes it; null when it cannot be planned yet. */
export function planInput(f: AssignFields): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  if (!t(f.date)) return null;
  const s = stopsInput(f.stops);
  if ("error" in s) return null;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return null;
  const input: Record<string, unknown> = { date: t(f.date), stops: s.stops };
  if (t(f.leaveBy)) input.leave_by = t(f.leaveBy);
  if (t(f.start) || f.startPlaceId || f.startGooglePlaceId) {
    input.start = {
      ...(f.startPlaceId ? { place_id: f.startPlaceId } : f.startGooglePlaceId ? { google_place_id: f.startGooglePlaceId } : {}),
      ...(t(f.start) ? { place: t(f.start) } : {}),
    };
  }
  if (f.returnToBase) input.return_to_base = true;
  if (f.avoidExpressway) input.avoid_expressway = true;
  if (t(f.buffer) !== "") input.buffer_min = Math.max(0, Math.min(600, parseInt(t(f.buffer), 10) || 0));
  if (t(f.driver)) input.driver = t(f.driver);
  if (t(f.vehicle)) input.vehicle = t(f.vehicle);
  if (t(f.end)) input.end_time = t(f.end);
  return input;
}

export function validateAssign(f: AssignFields, rows: ProjectRow[], createdBy?: string): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const need: [string, string][] = [[t(f.title), "the task"], [t(f.date), "the date"], [t(f.driver), "a driver"], [t(f.vehicle), "a vehicle"]];
  const miss = need.filter(([v]) => !v).map((n) => n[1]);
  if (miss.length) return { error: `Add ${miss.join(", ")}.` };
  const s = stopsInput(f.stops);
  if ("error" in s) return s;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return { error: "Add a leave-by time, or an arrive-by time on a stop so it can be planned." };
  const used = rows.filter((r) => r.project.trim());
  const total = splitTotal(used);
  if (used.length && Math.abs(total - 100) > 0.01) {
    return { error: `Project percentages add up to ${total}%. They must total 100%.` };
  }
  const input: Record<string, unknown> = { ...planInput(f), title: t(f.title), driver: t(f.driver), vehicle: t(f.vehicle) };
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
