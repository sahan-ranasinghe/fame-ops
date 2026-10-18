// My trips' rules (Hotfix 2, A), pure: the status filter in the URL (?status=, All by default: nothing disappears
// after a decision), the tool's arguments, a trip's live state as a pill, who decided it, and the phone links of the
// driver and the person who approved (Call and WhatsApp).
import type { CreatedTaskCard, PersonAt, PhoneLinks, RequestCard, TripLive } from "../data/types";
import { cap, type Tone } from "../lib/format";
import { linksOf, phoneDisplay } from "../ui/ContactButtons";
import { rangeText } from "../ui/dateRange";

export type TripStatus = "waiting" | "approved" | "under_way" | "completed" | "declined" | "cancelled" | "all";

/** The filter's chips, in the order of the plan; All (the default) last. */
export const TRIP_STATUS_OPTIONS: [TripStatus, string][] = [
  ["waiting", "Waiting"],
  ["approved", "Approved"],
  ["under_way", "Under way"],
  ["completed", "Completed"],
  ["declined", "Declined"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
];

/** my_trips answers at most a year at a time. */
export const TRIPS_MAX_DAYS = 366;

/** ?status= as a filter; anything else (or nothing) is All. */
export function readStatus(params: Pick<URLSearchParams, "get">): TripStatus {
  const s = params.get("status");
  return TRIP_STATUS_OPTIONS.some(([k]) => k === s) ? s as TripStatus : "all";
}

/** The URL after a status choice, other parameters kept; All leaves no trace. */
export function writeStatus(params: URLSearchParams, status: TripStatus): URLSearchParams {
  const out = new URLSearchParams(params);
  if (status === "all") out.delete("status");
  else out.set("status", status);
  return out;
}

/** my_trips' arguments: the days, and the status unless All (the tool's default). */
export function tripsArgs(from: string, to: string, status: TripStatus): Record<string, unknown> {
  return status === "all" ? { from, to } : { from, to, status };
}

/** The pill's colour for a live state: waiting amber, approved and accepted green, moving blue, done grey, declined red. */
export function liveTone(state: TripLive["state"] | undefined): Tone {
  switch (state) {
    case "waiting":
      return "warn";
    case "approved":
    case "accepted":
      return "ok";
    case "on_the_way":
    case "arrived":
      return "live";
    case "declined":
      return "bad";
    case "completed":
    case "cancelled":
      return "muted";
    default:
      return "";
  }
}

/** The trip's live state: the server's, else one from the request's status (an older answer has no `live`). */
export function liveOf(q: RequestCard): TripLive {
  if (q.live) return q.live;
  switch (q.status) {
    case "approved":
      return { state: "approved", text: "Approved" };
    case "changed":
      return { state: "waiting", text: "Changed · waiting for the office" };
    case "declined":
      return { state: "declined", text: q.decline_reason ? `Declined · ${q.decline_reason}` : "Declined" };
    case "cancelled":
      return { state: "cancelled", text: q.cancel_reason ? `Cancelled · ${q.cancel_reason}` : "Cancelled" };
    default:
      return { state: "waiting", text: cap(q.status || "waiting") };
  }
}

/** "Approved by Palitha · 10:42", "Declined by Palitha · 10:42 · no vehicle that day", "Cancelled by … · reason". */
export function decisionLines(q: Pick<RequestCard, "approved_by" | "declined_by" | "cancelled_by">): string[] {
  const line = (verb: string, p: PersonAt & { reason?: string }) => [`${verb} by ${p.name}`, p.at, p.reason].filter(Boolean).join(" · ");
  const out: string[] = [];
  if (q.approved_by) out.push(line("Approved", q.approved_by));
  if (q.declined_by) out.push(line("Declined", q.declined_by));
  if (q.cancelled_by) out.push(line("Cancelled", q.cancelled_by));
  return out;
}

/** The driver's Call and WhatsApp from the card's `assigned` (the server's links when it gives them). */
export function driverPhone(a: RequestCard["assigned"]): PhoneLinks | null {
  if (!a) return null;
  if (a.call) return { phone: a.phone ?? "", phone_display: a.phone ? phoneDisplay(a.phone) : "", call: a.call, whatsapp: a.whatsapp ?? "" };
  return linksOf(a.phone);
}

/** A person's Call and WhatsApp (the approver), or null when they have no number. */
export function personPhone(p: PersonAt | undefined): PhoneLinks | null {
  if (!p?.call) return p?.phone ? linksOf(p.phone) : null;
  return { phone: p.phone ?? "", phone_display: p.phone_display ?? (p.phone ? phoneDisplay(p.phone) : ""), call: p.call, whatsapp: p.whatsapp ?? "" };
}

/** The office's number for Call office: the first trip that carries it. */
export const officePhoneOf = (trips: RequestCard[]): PhoneLinks | null => trips.find((t) => t.office_phone?.call)?.office_phone ?? null;

/** The vehicle as the row names it: the plate, else the words for one chosen on the day ("Vehicle: on the day"). */
export const vehicleOf = (a: NonNullable<RequestCard["assigned"]>): { plate?: string; text?: string } =>
  a.vehicle ? { plate: a.vehicle } : { text: a.vehicle_text || "Vehicle: on the day" };

/** "3 trips · Thu 1 Oct – Sat 31 Oct 2026". */
export const totalsLine = (count: number, from: string, to: string): string => `${count === 1 ? "1 trip" : `${count} trips`} · ${rangeText(from, to)}`;

/** The empty list: what the filter and the days mean. */
export function emptyText(status: TripStatus, canAsk: boolean): string {
  if (status !== "all") {
    const label = TRIP_STATUS_OPTIONS.find(([k]) => k === status)?.[1].toLowerCase() ?? status;
    return `No ${label} trips in these dates.`;
  }
  return canAsk ? "No trips in these dates. Ask for a vehicle with New request." : "No trips in these dates.";
}

/** Hotfix 3: a request or proposal (a request card), not a task the person created directly. */
export const isRequestTrip = (t: RequestCard | CreatedTaskCard): t is RequestCard => (t as CreatedTaskCard).source !== "task";
