// Round 4–7, feature 6 (phase8-plan.md §33.3): a trip the person rides in (a registered passenger, Uber's "ride for someone
// else" seen by the rider), at /my-trips/:task beside My trips. my_trip answers the passenger's view: the time, where the
// trip is now (live_text, read again every minute), the driver with Call / WhatsApp, the plate, and the stops as they go
// (arrived at, planned for, skipped). View only: no actions.
import type { PassengerTrip } from "../data/types";
import { dayWords } from "../lib/when";
import { Pill, Plate } from "../ui/basics";
import { type PtTone, StatusBanner } from "../ui/patterns";
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

/** The banner's tone: on the way blue, done green, cancelled red, else waiting amber. */
const bannerTone = (status: string): PtTone => (status === "in_progress" ? "live" : status === "completed" ? "ok" : status === "cancelled" ? "bad" : "warn");


export function PassengerTripView({ trip, home }: { trip: PassengerTrip; home: string }) {
  const phone = trip.driver_phone ? linksOf(trip.driver_phone) : null;
  return (
    <div data-testid="passenger-trip">
      <PageTop
        title={trip.title}
        sub={<><Pill tone="live">Passenger</Pill> <span className="mono">{dayWords(trip.date)} {trip.leave_at}</span></>}
        backTo={home}
      />
      {/* Round 4–7, item 12 (the approved mockup 4, the passenger's view: the trip page without the office's actions): the
          state as the one status banner, the Passenger chip; the stops on the stepper's rail. */}
      <StatusBanner
        tone={bannerTone(trip.status)}
        icon={trip.status === "in_progress" ? "navigation" : trip.status === "completed" ? "check" : trip.status === "cancelled" ? "x" : "clock"}
        title={<span data-testid="passenger-live">{trip.live_text}</span>}
        line={`Leaves ${trip.leave_at}${trip.back_by ? ` · back by ${trip.back_by}` : ""}`}
        testId="passenger-banner"
      />
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
              <dd style={{ fontWeight: 400 }} className="pt-mini">
                {trip.stops.map((s) => {
                  const line = passengerStopLine(s);
                  return (
                    <div key={s.n} data-testid="passenger-stop" data-mark={s.n} className={s.status === "done" ? "done" : s.status === "arrived" ? "current" : undefined}>
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
