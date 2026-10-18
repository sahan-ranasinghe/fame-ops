// My trips' query (Hotfix 2, A), shared by the list and the request page opened from it (/my-trips/:id): both read
// the dates, the status, what is shown and the search from the same URL, and the request page finds the trip in the
// list on screen (and follows it as the list refreshes every minute) instead of asking again; its back arrow returns to
// the same list. Hotfix 3: the list is paged (ui/ListKit.tsx), so its store entry carries the page's limit and cursor:
// My trips hands its rows to the page beside it through TripCardsContext.
import { createContext, useContext } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { RequestCard } from "../data/types";
import { type DateRangeValue, useDateRange } from "../ui/DateRange";
import { useUrlSearch } from "../ui/ListKit";
import { readShow, readStatus, type TripShow, type TripStatus, tripsArgs, TRIPS_MAX_DAYS, writeStatus } from "./myTripsLogic";

export const TRIPS_KEY = "myTrips";
export const TRIPS_PATH = "/my-trips";

export interface MyTripsArgs {
  dates: DateRangeValue;
  status: TripStatus;
  setStatus: (s: TripStatus) => void;
  show: TripShow;
  setShow: (s: TripShow) => void;
  search: string;
  setSearch: (s: string) => void;
  /** my_trips' filters (null while the dates are wrong); the list adds the page's limit and cursor. */
  args: Record<string, unknown> | null;
}

export function useMyTripsArgs(): MyTripsArgs {
  const dates = useDateRange("month", { maxDays: TRIPS_MAX_DAYS });
  const [params, setParams] = useSearchParams();
  const status = readStatus(params);
  const show = readShow(params);
  const [search, setSearch] = useUrlSearch();
  return {
    dates,
    status,
    setStatus: (s) => setParams((p) => writeStatus(p, s), { replace: true }),
    show,
    setShow: (s) => setParams((p) => {
      const out = new URLSearchParams(p);
      if (s === "all") out.delete("show");
      else out.set("show", s);
      return out;
    }, { replace: true }),
    search,
    setSearch,
    args: dates.error ? null : tripsArgs(dates.from, dates.to, status, show, search),
  };
}

/** The request cards My trips shows, for the request page beside it; `waiting` while the list has not answered yet. */
export interface TripCards {
  cards: RequestCard[];
  waiting: boolean;
}
export const TripCardsContext = createContext<TripCards | null>(null);

/**
 * The trip from My trips' list on screen (only under /my-trips). `waiting` while that list has not answered yet: the
 * request page then waits for it instead of asking list_requests too (a trip outside the list's page or dates is asked
 * for).
 */
export function useTripCard(id: string): { card?: RequestCard; waiting: boolean } {
  const list = useContext(TripCardsContext);
  const { pathname } = useLocation();
  const mine = !!list && (pathname === TRIPS_PATH || pathname.startsWith(TRIPS_PATH + "/"));
  if (!mine) return { waiting: false };
  return { card: list.cards.find((t) => t.id === id), waiting: list.waiting };
}

/**
 * Where the request page goes back to: My trips (with its dates and filters) when opened from it, else Requests (with
 * its filter and search when opened from the list).
 */
export function useRequestsHome(): string {
  const { pathname, search } = useLocation();
  if (pathname.startsWith(TRIPS_PATH + "/")) return TRIPS_PATH + search;
  return /^\/requests\/[^/]+$/.test(pathname) ? "/requests" + search : "/requests";
}
