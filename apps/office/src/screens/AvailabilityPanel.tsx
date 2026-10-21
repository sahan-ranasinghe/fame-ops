// "Who's available" (Phase 6, Phase 7 §3 and §10): every driver for the day and
// time being planned, with a status chip (On duty since 07:12 · Off duty · On a
// task until ~10:40), what is next or what makes them busy, the day's counts,
// the licence and the vehicle they bring; the best match on top with its
// reasons and Use suggestion (fills the driver and the vehicle); the rows in the
// best-match order. A click or Enter on a row (a toggle button) picks that
// driver like Use suggestion (the driver and the vehicle they bring) and marks
// the row picked. Each row starts with the driver's photo (§5).
// Fetched 400 ms after the time settles and quietly every 60 s; the last answer
// stays on screen while a new one loads ("Updating…" beside the title), and a
// refresh for the same day and time keeps the ranking and the best match
// (steadyAvailability), so nothing jumps, swaps or resets.
// Part 3b (H2, H3): every row is the one driver row (ui/DriverRow: the status now, the window's "Not available · …", last
// seen, the usual start, the next task, Call and WhatsApp).
// Hotfix 4 (c): no tick boxes on the rows (a click picks, as before). "Ask drivers" is its own step: a sheet (asks/
// AskSheet) with its own list, the free drivers ticked, the question and Send; the answers come back live as chips under
// the rows, and a Yes has "Use this driver" (it picks that driver as a click on the row does). The question is kept for the
// page's task or request while the tab is open (sessionStorage), so a refresh keeps the answers.
// Round 3 (the driver-first card of Uber Fleet's and Samsara's driver lists): every row and the best match carry the
// vehicle as a chip under the name (the plate, "regular", "Vehicle: on the day" or "No vehicle yet"); the best match is
// the same driver card with its photo, its reasons and Use suggestion.
import { useState } from "react";
import { Link } from "react-router";
import type { Availability, AvailableDriver, BestMatch } from "../data/types";
import { type Query, useQuery } from "../data/useQuery";
import { useFleet } from "../app/FleetContext";
import { errText } from "../transport/errors";
import { Notice, Pill } from "../ui/basics";
import { DriverRow } from "../ui/DriverRow";
import { firstName, toPhoneLinks, vehicleChipWords } from "../ui/driverRowLogic";
import { useFleetSettings, vehicleOnTheDay } from "./dispatchParts";
import { askWindow, bestRow, type DefaultVehicle, defaultVehicle, driverTone, licenceTone, rankedRows, steadyAvailability, windowLine } from "./availabilityLogic";
import { countsLine } from "./asks/askLogic";
import { AnswerLine, AskSheet, useAskAnswers, usePageAsk } from "./asks/AskSheet";
import { SkeletonRows } from "../ui/ListKit";

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
    merge: steadyAvailability,
  });
}

/** Every driver's name in the answer: "Test Driver's vehicle today" when another driver is a "Test" too. */
const namesOf = (data: Availability) => data.drivers.map((d) => d.name);

/** The vehicle the picked driver brings, from the availability answer. */
export function vehicleFor(data: Availability | undefined, username: string): DefaultVehicle | null {
  if (!data || !username) return null;
  return defaultVehicle(data.drivers.find((d) => d.username === username), namesOf(data));
}

/** The best match's vehicle: its own, else its row's. */
export function bestVehicle(data: Availability | undefined): DefaultVehicle | null {
  if (!data?.best) return null;
  return defaultVehicle({ name: data.best.name, vehicle: data.best.vehicle ?? bestRow(data.best, data.drivers)?.vehicle }, namesOf(data));
}

export const scrollToAvailability = () => document.getElementById(AVAILABILITY_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function AvailabilityPanel({ args, picked, onPick, onUse, title = "Who's available", askFor }: {
  /** availabilityArgs(...); null = the day and time are not known yet. */
  args: Record<string, unknown> | null;
  /** The driver the form holds (picked, or its default): that row is marked picked. */
  picked?: string;
  /** A row clicked (or Enter on it): the form takes the driver and the vehicle they bring, as Use suggestion does. */
  onPick?: (d: AvailableDriver, vehicle: DefaultVehicle | null) => void;
  /** Use suggestion: the best match's driver and the vehicle they bring. */
  onUse?: (best: BestMatch, vehicle: DefaultVehicle | null) => void;
  title?: string;
  /** Part 3b (H3): the task or the request this page is about, for Ask drivers. */
  askFor?: { task?: string; request?: string };
}) {
  const { me } = useFleet();
  const q = useAvailability(args);
  const [sheet, setSheet] = useState(false);
  const [sent, keepSent] = usePageAsk(askFor?.task ? `task.${askFor.task}` : askFor?.request ? `request.${askFor.request}` : null);
  const ask = useAskAnswers(sent);
  // The chip of a driver with no vehicle known: "Vehicle: on the day" while the fleet setting is on.
  const onTheDay = vehicleOnTheDay(useFleetSettings().data);
  if (!me.tools.includes("availability")) return null;
  const canAsk = me.tools.includes("ask_drivers");
  const { data, err, updating } = q;
  const best = data?.best;
  const bestVeh = bestVehicle(data);
  const names = data ? namesOf(data) : [];
  const answers = new Map((ask?.drivers ?? []).map((r) => [r.username ?? r.name, r]));
  return (
    <div className="card card-b form" data-testid="availability" id={AVAILABILITY_ID} aria-busy={updating || undefined}>
      <div className="avail-h">
        <div className="section-t" style={{ marginBottom: 2 }}>
          {title}
          {data ? <span className="muted small" style={{ fontWeight: 400 }}> · {data.window.from}{data.window.until !== "end of the day" ? ` – ${data.window.until}` : ""} · {data.counts.free} of {data.counts.all} free</span> : null}
          {updating ? <span className="updated" data-testid="avail-updating" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> · Updating…</span> : null}
        </div>
        {canAsk && data && (
          <button type="button" className="btn small" onClick={() => setSheet(true)} data-testid="avail-ask">Ask drivers</button>
        )}
      </div>
      {ask && (
        <p className="ask-status sub" data-testid="avail-ask-status">
          <span>{ask.question} · {countsLine(ask)}</span>
          {me.tools.includes("ask_answers") && <Link to={`/drivers/asks/${ask.id}`}>All answers →</Link>}
        </p>
      )}
      {sheet && data && (
        <AskSheet
          candidates={data.drivers.filter((d) => !!d.username).map((d) => ({
            username: d.username!,
            name: d.name,
            photo_url: d.photo_url,
            line: windowLine(d) || d.now_status?.text,
            free: d.free,
          }))}
          window={askWindow(args, data.window.day)}
          askFor={askFor}
          onSent={keepSent}
          onClose={() => setSheet(false)}
        />
      )}
      {!args && <p className="muted small" style={{ margin: 0 }}>Fill in the day and the time to see who is free then.</p>}
      {args && q.loading && <SkeletonRows rows={3} label="Looking who is free…" />}
      {err && <Notice tone="bad">{errText(err)[0]}</Notice>}
      {best && (
        <div className="opt" data-testid="best-match" style={{ cursor: "default", display: "block", padding: 0 }}>
          <span className="eyebrow small" style={{ display: "block", fontSize: 13, padding: "10px 10px 0" }}>Best match</span>
          <DriverRow
            d={{ name: best.name, username: best.username, photo_url: best.photo_url ?? bestRow(best, data?.drivers)?.photo_url }}
            vehicle={vehicleChipWords(best.vehicle ?? bestRow(best, data?.drivers)?.vehicle, { onTheDay })}
            right={onUse && best.username
              ? (
                <button type="button" className="btn small dark" aria-pressed={picked === best.username} onClick={() => onUse(best, bestVeh)}>
                  {picked === best.username ? "Using it" : "Use suggestion"}
                </button>
              )
              : undefined}
            testId="best-match-row"
          >
            <span className="sub drow-line">{best.why}</span>
            {bestVeh && <span className="sub drow-line">{bestVeh.why}</span>}
          </DriverRow>
        </div>
      )}
      {data && (
        <div className="rows avail-rows" role={onPick ? "group" : undefined} aria-label={onPick ? "Drivers: pick one" : undefined} style={updating ? { opacity: 0.75 } : undefined}>
          {rankedRows(data.drivers).map((d) => {
            const veh = defaultVehicle(d, names);
            const on = !!picked && d.username === picked;
            const user = d.username;
            const answer = user ? answers.get(user) : undefined;
            return (
              <DriverRow
                key={user ?? d.name}
                d={d}
                // Hotfix 2 (F): Call and WhatsApp the driver, beside the row (never inside its button).
                phone={toPhoneLinks(d.phone)}
                contactLabel={`Call ${firstName(d.name)}`}
                onPick={onPick && user ? () => onPick(d, veh) : undefined}
                picked={on}
                rank={d.rank ?? undefined}
                nameExtra={d.licence.chip === "red" || d.licence.chip === "orange"
                  ? <Pill tone={licenceTone(d.licence.chip)}>licence {d.licence.chip === "red" ? "expired or due" : "expiring"}</Pill>
                  : null}
                badge={<Pill tone={driverTone(d)}>{d.free ? (d.state === "off_duty" ? "Free · off duty" : "Free") : "Busy"}</Pill>}
                right={answer?.answer === "yes" && answer.assignable && onPick && user
                  ? <button type="button" className="btn small primary" onClick={() => onPick(d, veh)} data-testid="avail-use">Use this driver</button>
                  : undefined}
                testId="avail-row"
                contactTestId="avail-contact"
                vehicle={vehicleChipWords(d.vehicle, { onTheDay })}
              >
                {windowLine(d) && <span className="sub drow-line">{windowLine(d)}</span>}
                {answer && <AnswerLine row={answer} testId="avail-answer" />}
                {/* Hotfix 2 (J): "no vehicle yet · regular: WP CAB-4521" says it in words (information only, never a block); else whose vehicle it is. */}
                {d.vehicle_note
                  ? <span className="sub drow-line" data-testid="avail-vehicle-note">{d.vehicle_note}</span>
                  : veh && <span className="sub drow-line" data-testid="avail-vehicle-why">{veh.why}</span>}
              </DriverRow>
            );
          })}
          {data.drivers.length === 0 && <p className="muted small" style={{ margin: 0 }}>No active drivers.</p>}
        </div>
      )}
    </div>
  );
}
