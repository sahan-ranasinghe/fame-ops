// "Who's available" (Phase 6, Phase 7 §3 and §10): every driver for the day and
// time being planned, with a status chip (On duty since 07:12 · Off duty · On a
// task until ~10:40), what is next or what makes them busy, the day's counts,
// the licence and the vehicle they bring; the best match on top with its
// reasons and Use suggestion (fills the driver and the vehicle); the rows in the
// best-match order. A click fills the driver. Fetched 400 ms after the time
// settles and quietly every 60 s; the last answer stays on screen while a new
// one loads ("Updating…" beside the title), so nothing jumps or resets.
import type { Availability, AvailableDriver, BestMatch } from "../data/types";
import { type Query, useQuery } from "../data/useQuery";
import { useFleet } from "../app/FleetContext";
import { errText } from "../transport/errors";
import { Loading, Notice, Pill } from "../ui/basics";
import { bestRow, type DefaultVehicle, defaultVehicle, driverLine, driverTone, licenceTone, rankedRows } from "./availabilityLogic";

export const AVAILABILITY_REFRESH_MS = 60_000;
export const AVAILABILITY_SETTLE_MS = 400;
/** Where "Pick another driver" scrolls to. */
export const AVAILABILITY_ID = "who-available";

/** Who's available for these arguments (shared: the form reads the driver's vehicle from the same answer as the panel). */
export function useAvailability(args: Record<string, unknown> | null): Query<Availability> {
  const { me } = useFleet();
  return useQuery<Availability>("availability", "availability", args, {
    every: AVAILABILITY_REFRESH_MS,
    debounce: AVAILABILITY_SETTLE_MS,
    enabled: me.tools.includes("availability"),
    keep: true,
  });
}

/** The vehicle the picked driver brings, from the availability answer. */
export function vehicleFor(data: Availability | undefined, username: string): DefaultVehicle | null {
  if (!data || !username) return null;
  return defaultVehicle(data.drivers.find((d) => d.username === username));
}

/** The best match's vehicle: its own, else its row's. */
export function bestVehicle(data: Availability | undefined): DefaultVehicle | null {
  if (!data?.best) return null;
  return defaultVehicle({ name: data.best.name, vehicle: data.best.vehicle ?? bestRow(data.best, data.drivers)?.vehicle });
}

export const scrollToAvailability = () => document.getElementById(AVAILABILITY_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function AvailabilityPanel({ args, picked, onPick, onUse, title = "Who's available" }: {
  /** availabilityArgs(...); null = the day and time are not known yet. */
  args: Record<string, unknown> | null;
  picked?: string;
  onPick?: (d: AvailableDriver) => void;
  /** Use suggestion: the best match's driver and the vehicle they bring. */
  onUse?: (best: BestMatch, vehicle: DefaultVehicle | null) => void;
  title?: string;
}) {
  const { me } = useFleet();
  const q = useAvailability(args);
  if (!me.tools.includes("availability")) return null;
  const { data, err, updating } = q;
  const best = data?.best;
  const bestVeh = bestVehicle(data);
  return (
    <div className="card card-b form" data-testid="availability" id={AVAILABILITY_ID} aria-busy={updating || undefined}>
      <div className="section-t" style={{ marginBottom: 2 }}>
        {title}
        {data ? <span className="muted small" style={{ fontWeight: 400 }}> · {data.window.from}{data.window.until !== "end of the day" ? ` – ${data.window.until}` : ""} · {data.counts.free} of {data.counts.all} free</span> : null}
        {updating ? <span className="updated" data-testid="avail-updating" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · Updating…</span> : null}
      </div>
      {!args && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the time to see who is free then.</p>}
      {args && q.loading && <Loading>Looking who is free…</Loading>}
      {err && <Notice tone="bad">{errText(err)[0]}</Notice>}
      {best && (
        <div className="opt" data-testid="best-match" style={{ cursor: "default", alignItems: "flex-start" }}>
          <span className="grow">
            <span className="eyebrow small" style={{ display: "block", fontSize: 13 }}>Best match</span>
            <b>{best.name}</b>{bestVeh ? <span className="muted"> · <span className="plate">{bestVeh.reg_no}</span> {bestVeh.why}</span> : null}
            <span className="sub" style={{ display: "block", marginTop: 4 }}>{best.why}</span>
          </span>
          {onUse && best.username && (
            <button type="button" className="btn small dark" aria-pressed={picked === best.username} onClick={() => onUse(best, bestVeh)}>
              {picked === best.username ? "Using it" : "Use suggestion"}
            </button>
          )}
        </div>
      )}
      {data && (
        <div className="rows" role={onPick ? "listbox" : undefined} aria-label={onPick ? "Free drivers" : undefined} style={updating ? { opacity: 0.75 } : undefined}>
          {rankedRows(data.drivers).map((d) => {
            const Tag = onPick ? "button" : "div";
            const veh = defaultVehicle(d);
            return (
              <Tag
                key={d.username ?? d.name}
                type={onPick ? "button" : undefined}
                className={`row avail-row${picked && d.username === picked ? " picked" : ""}`}
                role={onPick ? "option" : undefined}
                aria-selected={onPick ? (picked ? d.username === picked : undefined) : undefined}
                onClick={onPick ? () => onPick(d) : undefined}
                data-testid="avail-row"
              >
                {d.rank != null && <span className="num" aria-label={`Best match number ${d.rank}`} style={{ flex: "none", minWidth: 20, fontWeight: 700 }}>{d.rank}</span>}
                <span className="grow">
                  <span className="name">{d.name}{d.licence.chip === "red" || d.licence.chip === "orange" ? <> <Pill tone={licenceTone(d.licence.chip)}>licence {d.licence.chip === "red" ? "expired or due" : "expiring"}</Pill></> : null}</span>
                  <span className="sub" style={{ display: "block" }}>{driverLine(d)}</span>
                  {veh && <span className="sub" style={{ display: "block" }}><span className="plate">{veh.reg_no}</span> {veh.why}</span>}
                </span>
                <Pill tone={driverTone(d)}>{d.free ? (d.state === "off_duty" ? "Free · off duty" : "Free") : "Busy"}</Pill>
              </Tag>
            );
          })}
          {data.drivers.length === 0 && <p className="muted small" style={{ margin: 0 }}>No active drivers.</p>}
        </div>
      )}
    </div>
  );
}
