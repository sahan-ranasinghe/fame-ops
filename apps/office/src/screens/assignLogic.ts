// The Assign-a-task form's rules, kept apart from the screen so they can be
// tested: what is required, how the project split must add up, and the exact
// create_task arguments (the connector contract).
import { waLink } from "../lib/format";

export interface ProjectRow {
  project: string;
  percent: string | number;
  match?: string;
  bad?: boolean;
}

export interface AssignFields {
  title: string;
  date: string;
  start: string;
  pickup: string;
  dropoff: string;
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
  title: "", date, start: "", pickup: "", dropoff: "", driver: "", vehicle: "", end: "", pax: "", cname: "", cphone: "", notes: "", whatsapp: false,
});

export const splitTotal = (rows: ProjectRow[]) => rows.reduce((a, r) => a + (Number(r.percent) || 0), 0);

export function validateAssign(f: AssignFields, rows: ProjectRow[], createdBy?: string): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const need: [string, string][] = [
    [t(f.title), "the task"], [t(f.date), "the date"], [t(f.start), "the start time"], [t(f.pickup), "the pickup"],
    [t(f.dropoff), "the drop-off"], [t(f.driver), "a driver"], [t(f.vehicle), "a vehicle"],
  ];
  const miss = need.filter(([v]) => !v).map((n) => n[1]);
  if (miss.length) return { error: `Add ${miss.join(", ")}.` };
  const used = rows.filter((r) => r.project.trim());
  const total = splitTotal(used);
  if (used.length && Math.abs(total - 100) > 0.01) {
    return { error: `Project percentages add up to ${total}%. They must total 100%.` };
  }
  const input: Record<string, unknown> = {
    title: t(f.title), date: t(f.date), start_time: t(f.start), driver: t(f.driver), vehicle: t(f.vehicle), pickup: t(f.pickup), dropoff: t(f.dropoff),
  };
  if (t(f.end)) input.end_time = t(f.end);
  if (t(f.pax) !== "") input.passengers = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (t(f.cname)) input.contact_name = t(f.cname);
  if (t(f.cphone)) input.contact_phone = t(f.cphone);
  if (t(f.notes)) input.notes = t(f.notes);
  if (used.length) input.projects = used.map((r) => ({ project: r.project.trim(), percent: Number(r.percent) }));
  if (createdBy) input.created_by = createdBy.slice(0, 80);
  return { input };
}

/** The WhatsApp message for the driver, when the office asked for one. */
export function driverWhatsApp(input: Record<string, unknown>, phone?: string | null): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const contact = s("contact_name") ? `\nContact: ${s("contact_name")}${s("contact_phone") ? " " + s("contact_phone") : ""}` : "";
  return waLink(phone, `New task: ${s("title")}\n${s("date")} ${s("start_time")}\nPickup: ${s("pickup")}\nDrop-off: ${s("dropoff")}${contact}\nOpen Fame Driver for the details.`);
}
