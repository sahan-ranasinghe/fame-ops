// Round 4–7, feature 6 (phase8-plan.md §33.3): a trip the person rides in (a registered passenger, Uber's "ride for someone
// else" seen by the rider), at /my-trips/:task beside My trips. my_trip answers the passenger's view: the time, where the
// trip is now (live_text, read again every minute), the driver with Call / WhatsApp, the plate, and the stops as they go
// (arrived at, planned for, skipped). View only: no actions.
import type { PassengerTrip } from "../data/types";
import { dayWords } from "../lib/when";
import { Notice, Pill, Plate } from "../ui/basics";
import { ContactButtons, linksOf } from "../ui/ContactButtons";
import { PageTop } from "../ui/Page";

const STOP_TYPE: Record<string, string> = { pickup: "Pickup", drop: "Drop", visit: "Visit" };

/** A my_trip answer for a passenger (the other answer is a no-app trip of the person's own). */
export const isPassengerTrip = (x: unknown): x is PassengerTrip => !!x && (x as PassengerTrip).viewer === "passenger";

/** A stop as it goes: "Arrived 10:52", "Planned 10:30", "Skipped", "Done 11:05". */
export function passengerStopLine(s: PassengerTrip["stops"][number]): string {
  if (s.status === "skipped") return "Skipped";
  if (s.arrived) return `${s.status === "done" ? "Done" : "Arrived"} ${s.arrived}`;
  if (s.status === "done") return "Done";
  return s.planned ? `Planned ${s.planned}` : "";
}

/** The trip's state as a pill: on the way blue, done green, cancelled red, else plain. */
const statusTone = (status: string): "live" | "ok" | "bad" | "" =>
  status === "in_progress" ? "live" : status === "completed" ? "ok" : status === "cancelled" ? "bad" : "";

export function PassengerTripView({ trip, home }: { trip: PassengerTrip; home: string }) {
  const phone = trip.driver_phone ? linksOf(trip.driver_phone) : null;
  return (
    <div data-testid="passenger-trip">
      <PageTop
        title={trip.title}
        sub={<><Pill tone="live">Passenger</Pill> <span className="mono">{dayWords(trip.date)} {trip.leave_at}</span></>}
        backTo={home}
      />
      <Notice tone={trip.status === "cancelled" ? "bad" : "info"}>
        <span data-testid="passenger-live"><Pill tone={statusTone(trip.status)}>{trip.live_text}</Pill></span>
      </Notice>
      <div className="card card-b">
        <dl className="kv">
          <div>
            <dt>Leave · back by</dt>
            <dd className="mono">{trip.leave_at}{trip.back_by ? ` · ${trip.back_by_date && trip.back_by_date !== trip.date ? `${dayWords(trip.back_by_date)} ` : ""}${trip.back_by}` : ""}</dd>
          </div>
          <div><dt>Vehicle</dt><dd>{trip.vehicle ? <Plate v={trip.vehicle} /> : "—"}</dd></div>
          <div style={{ gridColumn: "1/-1" }}>
            <dt>Driver</dt>
            <dd>
              {trip.driver ?? "Not assigned yet"}
              {phone && <div style={{ marginTop: 6 }}><ContactButtons phone={phone} label="Call driver" testId="call-trip-driver" /></div>}
            </dd>
          </div>
          {trip.stops.length > 0 && (
            <div style={{ gridColumn: "1/-1" }}>
              <dt>Stops</dt>
              <dd style={{ fontWeight: 400 }}>
                {trip.stops.map((s) => {
                  const line = passengerStopLine(s);
                  return (
                    <div key={s.n} data-testid="passenger-stop">
                      {s.n}. {STOP_TYPE[s.type] ?? s.type} · {s.place}{line ? <span className={`sub${s.status === "skipped" ? " status warn" : ""}`}> · {line}</span> : null}
                    </div>
                  );
                })}
              </dd>
            </div>
          )}
        </dl>
      </div>
      <p className="muted small" data-testid="passenger-note">You ride in this trip: the fleet office plans it, and you are told when it changes. Updated {trip.seen_at}.</p>
    </div>
  );
}
