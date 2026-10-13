// Service and document reminders for the Maintenance page when the person
// holds vehicles but not issues: fleet_overview then answers no
// needs-attention items, so the same reminders are read off the vehicles
// list (document chips, next service, rent end, garage date).
import type { Attention, VehicleCard } from "../data/types";

const DOC_NAME: Record<string, string> = { lic: "Revenue licence", ins: "Insurance", emi: "Emission test" };
const DAY_MS = 86400000;

/** Whole days from one plain date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function dueText(days: number, date: string): string {
  if (days < 0) return `${-days} d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days <= 7 ? `in ${days} days` : date;
}

/** The reminders fleet_overview would list for these vehicles, within 14 days, red within 7 or overdue. */
export function dueFromVehicles(vehicles: VehicleCard[], today: string, windowDays = 14): Attention[] {
  const out: (Attention & { days: number })[] = [];
  for (const v of vehicles) {
    if (v.active === false) continue;
    const label = [v.reg_no, v.make_model].filter(Boolean).join(" · ");
    for (const [key, doc] of Object.entries(v.documents ?? {})) {
      if (!doc?.expiry) continue;
      const days = daysBetween(today, doc.expiry);
      if (days > windowDays) continue;
      out.push({ what: `${DOC_NAME[key] ?? key} ${days < 0 ? "expired" : "expires"}`, subject: label, due: dueText(days, doc.expiry), level: days <= 7 ? "red" : "amber", days });
    }
    const svc = String(v.service_state ?? "").toLowerCase();
    if (svc === "overdue" || svc === "due soon") {
      out.push({ what: svc === "overdue" ? "Service overdue" : "Service due", subject: `${v.reg_no} · ${v.next_service ?? ""}`.trim(), due: svc === "overdue" ? "now" : "soon", level: svc === "overdue" ? "red" : "amber", days: svc === "overdue" ? -1 : 8 }); // "soon": after anything due this week
    }
    if (v.rent_until) {
      const days = daysBetween(today, v.rent_until);
      if (days <= windowDays) {
        out.push({ what: days < 0 ? "Rental agreement ended" : "Rental agreement ends", subject: [v.reg_no, v.rented_from].filter(Boolean).join(" · "), due: dueText(days, v.rent_until), level: days <= 7 ? "red" : "amber", days });
      }
    }
    if (v.garage_booked) {
      const days = daysBetween(today, v.garage_booked);
      if (days >= 0 && days <= windowDays) out.push({ what: "Garage booked", subject: label, due: dueText(days, v.garage_booked), level: "amber", days });
    }
  }
  return out.sort((a, b) => a.days - b.days).map(({ days: _days, ...item }) => item);
}
