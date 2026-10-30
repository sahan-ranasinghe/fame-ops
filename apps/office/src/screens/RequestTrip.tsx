// A request's trip, read only (Phase 7, §34): where it starts, the stops with
// their times, the plan as a timeline and on the map; the stops once (30 October 2026): the plan's timeline when there is
// one, else the From → stops → To line (Fix B) with each stop's times. On the request page and
// the trip decide page; the person who asked sees it too (the plan has no
// driver, vehicle or conflict in it, §35 19). The web asks for each leg's
// Google road line (list_requests with_line: the stored lines, no Google call),
// drawn on Google's map only; a Google stop on any other map is listed instead.
import { useEffect } from "react";
import { useFleet } from "../app/FleetContext";
import type { RequestCard, RequestsList, RequestTrip } from "../data/types";
import { useQuery } from "../data/useQuery";
import { cap, joinDots } from "../lib/format";
import { Notice } from "../ui/basics";
import { PlanWithMap } from "./PlanMap";
import { startWhatWords } from "./dispatchParts";
import { RouteLine } from "./StopsEditor";
import { tripKey } from "./requestLogic";

/** The request's trip with its road lines (web), the card's own trip until they answer or after an edit. */
export function useTripLine(q: RequestCard | undefined): RequestTrip | undefined {
  const { me } = useFleet();
  const args = q?.trip && __BUILD__ === "web" ? { status: "all", id: q.id, with_line: true } : null;
  const line = useQuery<RequestsList>("request-line", "list_requests", args, { enabled: me.tools.includes("list_requests") });
  const lined = line.data?.requests.find((r) => r.id === q?.id);
  // Edited since (a new version), or its task changed by the office (the same version, another trip): asked again once;
  // the card's trip meanwhile. Never an older plan than the card's.
  const key = tripKey(q?.trip);
  const fresh = !!lined?.trip && lined.version === q?.version && tripKey(lined.trip) === key;
  useEffect(() => {
    if (lined && q && !fresh) line.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.version, key]);
  return fresh ? lined!.trip : q?.trip;
}

/**
 * The trip's route, read only (Fix B, 29 October 2026: the same From → stops → To line as the forms): From with the start
 * (passengers get in there: Stop 1), the stops by their names, To, and "Then back to the office" / "No expressway". With
 * `times` (no plan stored) each stop shows the time planned there and its arrive-by, as the stops list did.
 */
export function TripRouteLine({ trip, times = false }: { trip: RequestTrip; times?: boolean }) {
  const startStop = trip.stops.find((s) => s.is_start);
  const atStart = !!startStop;
  const rows = trip.stops.filter((s) => !s.is_start);
  const offset = atStart ? 1 : 0;
  return (
    <RouteLine from={joinDots([
      trip.start?.name ?? "The base place",
      startStop ? `${startWhatWords(startStop.what)} (Stop 1)` : "",
      // The start stop's own times, as the stops list showed them (no plan stored).
      times && startStop?.planned_arrive ? `arrive ${startStop.planned_arrive}` : "",
      times && startStop?.arrive_by ? `by ${startStop.arrive_by}` : "",
    ])} offset={offset}
      back={trip.return_to_base} noExpressway={trip.avoid_expressway} rowTestId={times ? "trip-stop" : "route-stop"}
      stops={rows.map((s, i) => ({
        key: `${s.seq}-${i}`,
        label: s.label ?? `Stop ${offset + i + 1} · ${cap(s.type)} · ${s.place ?? ""}`,
        extra: times && (s.planned_arrive || s.arrive_by)
          ? <span className="num small muted">{joinDots([s.planned_arrive ? `arrive ${s.planned_arrive}` : "", s.arrive_by ? `by ${s.arrive_by}` : ""])}</span>
          : undefined,
      }))} />
  );
}

export function TripSection({ trip, leaveNote, title = "Stops and plan" }: {
  trip: RequestTrip;
  /** Where a leave time given by hand came from: "the time asked for", "as proposed". */
  leaveNote?: string;
  title?: string;
}) {
  // Once approved the trip is the task's as it is now: the leave time is the task's own, and a change by the office says so.
  const fromTask = trip.source === "task";
  return (
    <div className="card card-b form" data-testid="request-trip">
      <div className="section-t" style={{ marginBottom: 2 }}>{title}</div>
      {trip.changed && <Notice tone="info"><span data-testid="trip-changed">{trip.changed.text}</span></Notice>}
      {/* The stops once: the timeline names each stop and the way back; what it does not say (no expressway) under it. */}
      {!trip.timeline && <TripRouteLine trip={trip} times />}
      {trip.timeline && trip.avoid_expressway && <p className="muted small" style={{ margin: 0 }} data-testid="route-after">No expressway</p>}
      {trip.timeline && <PlanWithMap timeline={trip.timeline} stops={trip.stops} start={trip.start} startName={trip.start?.name} leaveNote={fromTask ? undefined : leaveNote} />}
    </div>
  );
}
