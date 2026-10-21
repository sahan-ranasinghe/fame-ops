// The Requests list's rules (Hotfix 3, L3), pure: the status filter in the URL (?status=, Waiting by default: the queue),
// the search (?q=), list_requests' arguments (the server pages them: waiting soonest first, the others newest first) and
// the empty line in words that say what the filter means.

export type RequestsFilter = "waiting" | "changed" | "approved" | "declined" | "cancelled" | "expired" | "all";

/** Round 3 (A6): Expired = nobody decided it before its day was over (list_requests status expired; never waiting). */
export const REQUEST_FILTERS: [RequestsFilter, string][] = [
  ["waiting", "Waiting"],
  ["changed", "Changed"],
  ["approved", "Approved"],
  ["declined", "Declined"],
  ["cancelled", "Cancelled"],
  ["expired", "Expired"],
  ["all", "All"],
];
export const REQUEST_FILTER_KEYS = REQUEST_FILTERS.map(([k]) => k);
export const DEFAULT_REQUESTS_FILTER: RequestsFilter = "waiting";
/** The Requests page's store entry: the request pages opened from it (detail, decide, edit) find their card there. */
export const REQUESTS_KEY = "reqs";

/** list_requests' input for the list: the status, and the words searched for when there are any. */
export function requestsArgs(status: RequestsFilter, search: string): Record<string, unknown> {
  return search ? { status, search } : { status };
}

/** The list's title: what the filter shows ("Waiting", "All requests"). */
export const filterTitle = (status: RequestsFilter): string => (status === "all" ? "All requests" : REQUEST_FILTERS.find(([k]) => k === status)?.[1] ?? status);

/** Nothing to list, in words: what the filter means, and what to do about it. */
export function requestsEmptyText(status: RequestsFilter, search: string, staff: boolean): string {
  const label = REQUEST_FILTERS.find(([k]) => k === status)?.[1].toLowerCase() ?? status;
  if (search) return status === "all" ? `No request matches "${search}".` : `No ${label} request matches "${search}".`;
  switch (status) {
    case "waiting":
      return staff ? "You have no request waiting. Add one with New request." : "No requests are waiting. Add one with New request when someone asks for a vehicle.";
    case "changed":
      return "No approved booking was changed: nothing waits for a new decision.";
    case "expired":
      return staff ? "None of your requests expired: each was decided before its day." : "No request expired: each was decided before its day.";
    case "all":
      return staff ? "You have not asked for a vehicle yet. Add a request with New request." : "No requests yet.";
    default:
      return `No ${label} requests.`;
  }
}
