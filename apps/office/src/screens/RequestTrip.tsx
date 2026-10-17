// A request's trip, read only (Phase 7, §34): where it starts, the stops with
// their times, the plan as a timeline and on the map. On the request page and
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

/** The request's trip with its road lines (web), the card's own trip until they answer or after an edit. */
export function useTripLine(q: RequestCard | undefined): RequestTrip | undefined {
  const { me } = useFleet();
  const args = q?.trip && __BUILD__ === "web" ? { status: "all", id: q.id, with_line: true } : null;
  const line = useQuery<RequestsList>("request-line", "list_requests", args, { enabled: me.tools.includes("list_requests") });
  const lined = line.data?.requests.find((r) => r.id === q?.id);
  // Edited since (a new version): asked again once; the card's trip meanwhile.
  useEffect(() => {
    if (lined && q && lined.version !== q.version) line.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.version]);
  return lined?.trip && lined.version === q?.version ? lined.trip : q?.trip;
}

/** The stops when no plan was stored: the label, the time planned there and the arrive-by. */
function TripStops({ stops }: { stops: RequestTrip["stops"] }) {
  return (
    <ol className="plan-stops" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {stops.map((s, i) => (
        <li key={`${s.seq}-${i}`} data-testid="trip-stop" style={{ display: "grid", gap: 2, padding: "6px 0" }}>
          <b>{s.label ?? `Stop ${i + 1} · ${cap(s.type)} · ${s.place ?? ""}`}</b>
          {(s.planned_arrive || s.arrive_by) && (
            <span className="num small muted">{joinDots([s.planned_arrive ? `arrive ${s.planned_arrive}` : "", s.arrive_by ? `by ${s.arrive_by}` : ""])}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function TripSection({ trip, leaveNote, title = "Stops and plan" }: {
  trip: RequestTrip;
  /** Where a leave time given by hand came from: "the time asked for", "as proposed". */
  leaveNote?: string;
  title?: string;
}) {
  const atStart = trip.stops.some((s) => s.is_start);
  // Once approved the trip is the task's as it is now: the leave time is the task's own, and a change by the office says so.
  const fromTask = trip.source === "task";
  return (
    <div className="card card-b form" data-testid="request-trip">
      <div className="section-t" style={{ marginBottom: 2 }}>{title}</div>
      {trip.changed && <Notice tone="info"><span data-testid="trip-changed">{trip.changed.text}</span></Notice>}
      {trip.start && (
        <p className="muted small" style={{ margin: 0 }}>
          {joinDots([`Start from ${trip.start.name}`, atStart ? "passengers get in here (Stop 1)" : "", trip.return_to_base ? "back to the base at the end" : "", trip.avoid_expressway ? "no expressway" : ""])}
        </p>
      )}
      {trip.timeline
        ? <PlanWithMap timeline={trip.timeline} stops={trip.stops} start={trip.start} startName={trip.start?.name} leaveNote={fromTask ? undefined : leaveNote} />
        : <TripStops stops={trip.stops} />}
    </div>
  );
}
