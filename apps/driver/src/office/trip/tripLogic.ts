// Office mode: a copy of apps/office/src/screens/tripLogic.ts, written by scripts/shared-logic.mjs --write. Never edit it here: edit
// the site's file and run the script (the app's test:shared-logic and the site's sharedLogic test fail until you do).

// The trip as every dispatch form holds it (Phase 7, §34): the day, the leave
// time (typed, or planned from the stops' arrive-by times), the back-by time
// ("Vehicle free by" on Assign a task), Start from with "Passengers get in
// here", the stops, Return to office and No expressway; and the exact
// plan_task / create_request / book_vehicle / update_request arguments they
// become (the connector contract). The trip editor (TripEditor.tsx) shows it.
import type { RequestEditFields } from "../types";
import { defaultStops, draftsFromStops, hasDeadline, newStop, openStops, type StartFields, startInput, type StopDraft, stopsInput, type What } from "./stopsLogic";

export interface TripFields extends StartFields {
  date: string;
  /** The leave time typed by hand; empty = planned from the stops' arrive-by times. */
  leaveBy: string;
  stops: StopDraft[];
  returnToBase: boolean;
  avoidExpressway: boolean;
  /** Back by (the vehicle free again), HH:MM the same day; empty = not set. */
  end: string;
}

/** The base place (Settings → Fleet): Start from's default. */
export type Base = { id: string; name: string } | null;

export const emptyTrip = (date: string): TripFields => ({
  date, leaveBy: "", stops: defaultStops(), start: "", startPax: false, returnToBase: true, avoidExpressway: false, end: "",
});

/** The stops before the rows: the start is Stop 1 when passengers get in there. */
export const tripOffset = (f: Pick<StartFields, "startPax">) => (f.startPax ? 1 : 0);

export const NO_LEAVE_TIME = "Add a leave-by time, or an arrive-by time on a stop so it can be planned.";

/**
 * The trip as plan_task takes it; null when it cannot be planned yet. `base`: the base place, named only when
 * passengers get in there (otherwise the server takes it by itself).
 */
export function tripPlanInput(f: TripFields, base: Base = null): Record<string, unknown> | null {
  const t = (s: string) => s.trim();
  if (!t(f.date)) return null;
  const s = stopsInput(f.stops, tripOffset(f));
  if ("error" in s) return null;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return null;
  const input: Record<string, unknown> = { date: t(f.date), stops: s.stops };
  if (t(f.leaveBy)) input.leave_by = t(f.leaveBy);
  const start = startInput(f, base);
  if (start) input.start = start;
  if (f.returnToBase) input.return_to_base = true;
  if (f.avoidExpressway) input.avoid_expressway = true;
  return input;
}

/**
 * The trip as create_request and book_vehicle take it: the day, `time` only when the leave time was typed (else the
 * server plans it from the arrive-by times), the back-by, the stops, the start and the two switches. The server writes
 * route_from and route_to from the first and the last stop.
 */
export function tripRequestInput(f: TripFields, base: Base = null): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date)) return { error: "Add the day." };
  const s = stopsInput(f.stops, tripOffset(f));
  if ("error" in s) return s;
  if (!t(f.leaveBy) && !hasDeadline(f.stops)) return { error: NO_LEAVE_TIME };
  const input: Record<string, unknown> = { date: t(f.date) };
  if (t(f.leaveBy)) input.time = t(f.leaveBy);
  if (t(f.end)) input.back_by = t(f.end);
  input.stops = s.stops;
  const start = startInput(f, base);
  if (start) input.start = start;
  if (f.returnToBase) input.return_to_base = true;
  if (f.avoidExpressway) input.avoid_expressway = true;
  return { input };
}

/** The start stop of a request's trip, as list_requests shows it (its what, note and time there). */
export interface TripStartStop {
  what?: string;
  note?: string;
  dwell_min?: number;
  dwell_source?: string;
}

const WHATS = ["people", "goods", "documents", "other"];

/**
 * A request's trip as the edit form holds it, from the card's fields: its stops and start, the leave time only when
 * it was typed (a planned one stays empty: planned again from the arrive-by times). An older request (From and To
 * only) opens with two stops, a pickup at From and a drop at To, with the times there, and the time as typed.
 */
export function tripFromRequest(fields: RequestEditFields | undefined, startStop?: TripStartStop): TripFields {
  const f = fields;
  const planned = !!f?.stops?.length;
  const stops: StopDraft[] = planned
    ? draftsFromStops(f!.stops!.map((s) => ({
      ...s,
      // A pin with no place behind it was given (typed, or a map pick): it goes back in the pin field.
      pin: !s.place_id && !s.google_place_id && s.lat != null && s.lng != null ? "given" : undefined,
    })))
    // Fix B: an empty From or To of an older request is left out (openStops); the pickup keeps its type.
    : openStops([
      { ...newStop("pickup"), place: f?.route_from ?? "", dwell: f?.from_dwell_min == null ? "" : String(f.from_dwell_min), typeSet: true },
      { ...newStop("drop"), place: f?.route_to ?? "", dwell: f?.to_dwell_min == null ? "" : String(f.to_dwell_min), typeSet: true },
    ], !!f?.return_to_base);
  const st = f?.start;
  const google = !st?.place_id && !!st?.google_place_id;
  const pax = !!st?.passengers;
  const chosen = startStop?.dwell_min != null && (startStop.dwell_source === undefined || startStop.dwell_source === "chosen");
  return {
    date: f?.date ?? "",
    leaveBy: planned ? f?.leave_by ?? "" : f?.time ?? "",
    stops: stops.length ? stops : defaultStops(!!f?.return_to_base),
    start: st?.place ?? "",
    startPlaceId: st?.place_id,
    startGooglePlaceId: google ? st?.google_place_id : undefined,
    startLat: google ? undefined : st?.lat,
    startLng: google ? undefined : st?.lng,
    startPax: pax,
    startWhat: pax && startStop?.what && WHATS.includes(startStop.what) && startStop.what !== "people" ? startStop.what as What : "",
    startNote: pax ? startStop?.note ?? "" : "",
    startDwell: pax && chosen ? String(startStop!.dwell_min) : "",
    returnToBase: !!f?.return_to_base,
    avoidExpressway: !!f?.avoid_expressway,
    end: f?.back_by ?? "",
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The trip's part of update_request: only what differs from the request as loaded. `time` null = planned from the
 * arrive-by times; `back_by` null clears it. A changed route (the stops, the start, Return to office, No expressway)
 * sends the stops with the start (the base place named when Start from is empty, so a start taken away goes back to
 * it); an older request (From and To only) becomes a planned one that way.
 */
export function tripChanges(f: TripFields, was: TripFields, base: Base = null): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  if (!t(f.date)) return { error: "Add the day." };
  const input: Record<string, unknown> = {};
  if (t(f.date) !== t(was.date)) input.date = t(f.date);
  if (t(f.leaveBy) !== t(was.leaveBy)) input.time = t(f.leaveBy) || null;
  if (t(f.end) !== t(was.end)) input.back_by = t(f.end) || null;
  const now = stopsInput(f.stops, tripOffset(f));
  const before = stopsInput(was.stops, tripOffset(was));
  const routeChanged = !same(now, before) || !same(startInput(f, base), startInput(was, base)) ||
    f.returnToBase !== was.returnToBase || f.avoidExpressway !== was.avoidExpressway;
  if (routeChanged) {
    if ("error" in now) return now;
    input.stops = now.stops;
    const start = startInput(f, base) ?? (base ? { place_id: base.id, place: base.name } : undefined);
    if (start) input.start = start;
    if (f.returnToBase !== was.returnToBase) input.return_to_base = f.returnToBase;
    if (f.avoidExpressway !== was.avoidExpressway) input.avoid_expressway = f.avoidExpressway;
  }
  if (("time" in input || "stops" in input) && !t(f.leaveBy) && !hasDeadline(f.stops)) return { error: NO_LEAVE_TIME };
  return { input };
}

/** "Trip · Galle": a booked task's title, from its last stop's place (the server's default when there is none). */
export function tripTitle(f: Pick<TripFields, "stops">): string | undefined {
  const last = [...f.stops].reverse().find((s) => s.place.trim());
  return last ? `Trip · ${last.place.trim()}`.slice(0, 120) : undefined;
}
