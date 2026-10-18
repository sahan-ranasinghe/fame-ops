// My trips' query (Hotfix 2, A), shared by the list and the request page opened from it (/my-trips/:id): both read
// the dates and the status from the same URL, so the page finds the trip in the list already loaded (and follows it
// as the list refreshes every minute) instead of asking again, and its back arrow returns to the same list.
import { useLocation, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { MyTrips, RequestCard } from "../data/types";
import { queryKey } from "../data/useQuery";
import { type DateRangeValue, useDateRange } from "../ui/DateRange";
import { readStatus, type TripStatus, tripsArgs, TRIPS_MAX_DAYS, writeStatus } from "./myTripsLogic";

export const TRIPS_KEY = "myTrips";
export const TRIPS_PATH = "/my-trips";

export function useMyTripsArgs(): { dates: DateRangeValue; status: TripStatus; setStatus: (s: TripStatus) => void; args: Record<string, unknown> | null } {
  const dates = useDateRange("month", { maxDays: TRIPS_MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const status = readStatus(params);
  return {
    dates,
    status,
    setStatus: (s) => setParams((p) => writeStatus(p, s), { replace: true }),
    args: dates.error ? null : tripsArgs(dates.from, dates.to, status),
  };
}

/**
 * The trip from My trips' list on screen (only under /my-trips). `waiting` while that list has not answered yet: the
 * request page then waits for it instead of asking list_requests too (a trip outside the list's dates is asked for).
 */
export function useTripCard(id: string): { card?: RequestCard; waiting: boolean } {
  const { me, noConnector } = useFleet();
  const { pathname } = useLocation();
  const { args } = useMyTripsArgs();
  const mine = !noConnector && me.tools.includes("my_trips") && !!args && (pathname === TRIPS_PATH || pathname.startsWith(TRIPS_PATH + "/"));
  const entry = useEntry<MyTrips>(mine && args ? queryKey(TRIPS_KEY, args) : "");
  if (!mine) return { waiting: false };
  return { card: entry.data?.trips?.find((t) => t.id === id), waiting: entry.data === undefined && !entry.err };
}

/** Where the request page goes back to: My trips (with its dates and filter) when opened from it, else Requests. */
export function useRequestsHome(): string {
  const { pathname, search } = useLocation();
  return pathname.startsWith(TRIPS_PATH + "/") ? TRIPS_PATH + search : "/requests";
}
