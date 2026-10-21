// My trips' rules (Hotfix 2, A), pure: the status filter in the URL (?status=, All by default: nothing disappears
// after a decision), the tool's arguments, a trip's live state as a pill, who decided it, and the phone links of the
// driver and the person who approved (Call and WhatsApp).
// Hotfix 3 (Hotfix 2's decision 2, L3): what to show (?show=all|requests|tasks: All · Requests · Tasks I created, into
// my_trips' include), the search (?q=), and the rows of the tasks the person created directly (they open the task).
import type { CreatedTaskCard, PersonAt, PhoneLinks, RequestCard, TripLive } from "../data/types";
import { cap, type Tone } from "../lib/format";
import { linksOf, phoneDisplay } from "../ui/ContactButtons";
import { rangeText } from "../ui/dateRange";

export type TripStatus = "waiting" | "approved" | "under_way" | "completed" | "declined" | "cancelled" | "expired" | "all";

/** The filter's chips, in the order of the plan; All (the default) last. Round 3 (A6): Expired (my_trips status expired). */
export const TRIP_STATUS_OPTIONS: [TripStatus, string][] = [
  ["waiting", "Waiting"],
  ["approved", "Approved"],
  ["under_way", "Under way"],
  ["completed", "Completed"],
  ["declined", "Declined"],
  ["cancelled", "Cancelled"],
  ["expired", "Expired"],
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

/** What My trips lists (Hotfix 2's decision 2): everything, the requests and proposals, or the tasks the person created. */
export type TripShow = "all" | "requests" | "tasks";
export const TRIP_SHOW_OPTIONS: [TripShow, string][] = [["all", "All"], ["requests", "Requests"], ["tasks", "Tasks I created"]];
export const TRIP_SHOW_KEYS = TRIP_SHOW_OPTIONS.map(([k]) => k);

/** ?show= as what to list; anything else (or nothing) is All. */
export function readShow(params: Pick<URLSearchParams, "get">): TripShow {
  const s = params.get("show");
  return TRIP_SHOW_OPTIONS.some(([k]) => k === s) ? s as TripShow : "all";
}

/**
 * my_trips' arguments: the days, the status unless All (the tool's default), what to include (always said when the page
 * asks, so a tool with another default lists what the page shows) and the words searched for.
 */
export function tripsArgs(from: string, to: string, status: TripStatus, show?: TripShow, search = ""): Record<string, unknown> {
  return {
    from,
    to,
    ...(status === "all" ? {} : { status }),
    ...(show ? { include: show } : {}),
    ...(search ? { search } : {}),
  };
}

/** A live state as one short word for its chip (Gmail's label; the full sentence goes on the line under the title). */
const LIVE_WORD: Record<string, string> = {
  waiting: "Waiting", approved: "Approved", accepted: "Accepted", sent: "Sent", on_the_way: "On the way", arrived: "Arrived",
  completed: "Done", declined: "Declined", cancelled: "Cancelled", missed: "Missed", changed: "Changed", expired: "Expired",
};
export function liveWord(state: string | undefined): string {
  return LIVE_WORD[state ?? ""] ?? "Waiting";
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
    case "expired":
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
    case "expired":
      return { state: "expired", text: "Expired · nobody decided it in time", at: q.expired };
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

/** The empty list: what the filter, what is shown, the words searched for and the days mean. */
export function emptyText(status: TripStatus, canAsk: boolean, show: TripShow = "all", search = ""): string {
  const label = TRIP_STATUS_OPTIONS.find(([k]) => k === status)?.[1].toLowerCase() ?? status;
  const what = show === "tasks" ? "task you created" : show === "requests" ? "request" : "trip";
  if (search) return `No ${status === "all" ? "" : `${label} `}${what} matches "${search}" in these dates.`;
  if (show === "tasks") return status === "all" ? "You created no task in these dates." : `No ${label} tasks you created in these dates.`;
  if (status !== "all") return `No ${label} ${show === "requests" ? "requests" : "trips"} in these dates.`;
  const none = show === "requests" ? "No requests in these dates." : "No trips in these dates.";
  return canAsk ? `${none} Ask for a vehicle with New request.` : none;
}

/** Hotfix 3: a request or proposal (a request card), not a task the person created directly. */
export const isRequestTrip = (t: RequestCard | CreatedTaskCard): t is RequestCard => (t as CreatedTaskCard).source !== "task";

/** Hotfix 3: a task the person created directly (no request): its row opens the task. */
export const isCreatedTask = (t: RequestCard | CreatedTaskCard): t is CreatedTaskCard => (t as CreatedTaskCard).source === "task";

/** The task page a created task's row opens (beside the board). */
export const createdTaskLink = (t: Pick<CreatedTaskCard, "id" | "task_id">): string => `/tasks/${t.task_id || t.id}`;

/** A created task's live state: the server's, else one from the task's status. */
export function createdLive(t: Pick<CreatedTaskCard, "live" | "status">): TripLive {
  if (t.live) return t.live;
  switch (t.status) {
    case "in_progress":
      return { state: "on_the_way", text: "Under way" };
    case "completed":
      return { state: "completed", text: "Completed" };
    case "cancelled":
      return { state: "cancelled", text: "Cancelled" };
    case "declined":
      return { state: "declined", text: "Declined by the driver" };
    case "missed":
      return { state: "cancelled", text: "Missed · never started" };
    default:
      return { state: "approved", text: "Assigned" };
  }
}
