// Fuel (/fuel, the vehicles permission; Phase 6, Part 3): the fills of the
// chosen days (Phase 7 §8: the date-range control) with their receipts and
// videos, filtered by vehicle and driver, all in the URL; beside a shorter
// range, the month that contains To in one line. A row opens the fill
// (/fuel/:id) with its video beside the list on a desktop, full screen on a
// phone; the fill page reads the rows this list shows.
// Hotfix 3 (L3): this week by default (the month's figures in one line beside it), the newest fill first, 25 at a time
// (page numbers on a desktop, Load more and cards on a phone) with the count in the header; the tiles are the whole
// range's (the server adds them up), the video links only the page's.
import { createContext } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { FuelEntry, FuelList } from "../data/types";
import { num } from "../lib/format";
import { Pill, Tile } from "../ui/basics";
import { DateRangePicker, type DateRangeValue, useDateRange } from "../ui/DateRangePicker";
import type { FilterValues } from "../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, usePagedList } from "../ui/ListKit";
import { ListWithDetail } from "../ui/Page";
import { megabytes, videoChip, videoTone, videoWords } from "./fuelLogic";
import { ListFooter, ListStale, ListWaiting } from "./listLocal";
import { useVehicleDriver, VehicleDriverFilter } from "./Mileage";
import { fuelLabel, fuelMonthLine, rangeArgs } from "./mileageLogic";

/** list_fuel takes up to 366 days. */
const MAX_DAYS = 366;
/** The list's query key. */
export const FUEL_QUERY = "fuel";
/** Fuel opens on this week (the month's figures in one line beside it). */
export const FUEL_DEFAULT_RANGE = "week";

/** The fills the list shows (the page, or every page loaded), for the fill page beside it. */
export const FuelShown = createContext<{ entries: FuelEntry[]; loaded: boolean; total: number } | null>(null);

/** The dates and filters in the URL, and list_fuel's input for them (the list and the fill page agree on it). */
export function useFuelArgs(): { dates: DateRangeValue; vehicle: string; driver: string; setVehicle: (v: string) => void; setDriver: (d: string) => void; setBoth: (v: FilterValues) => void; args: Record<string, unknown> } {
  const dates = useDateRange(FUEL_DEFAULT_RANGE, { maxDays: MAX_DAYS });
  const vd = useVehicleDriver();
  return { dates, ...vd, args: rangeArgs(dates.from, dates.to, { vehicle: vd.vehicle, driver: vd.driver }) };
}

/** What an empty list means, in words: "No fuel logged (Mon 12 Oct – Sun 18 Oct 2026) for WP CAB-4521." */
export function fuelEmpty(label: string, vehicle: string, driver: string): string {
  const who = [vehicle ? `for ${vehicle}` : "", driver ? `by ${driver}` : ""].filter(Boolean).join(" ");
  return `No fuel logged (${label})${who ? ` ${who}` : ""}.`;
}

export function Fuel() {
  const { noConnector } = useFleet();
  const lists = useLists(!noConnector);
  const navigate = useNavigate();
  const { search } = useLocation();
  const { id } = useParams();
  const { dates, vehicle, driver, setBoth, args } = useFuelArgs();
  const list = usePagedList<FuelEntry, FuelList>(FUEL_QUERY, "list_fuel", dates.error ? null : args, (d) => d.entries, { enabled: !noConnector });
  const q = list.query;
  const d = q.data;
  const t = d?.totals;
  const monthLine = d ? fuelMonthLine(d) : undefined;
  const updating = q.updating || q.stale;
  const driverName = lists.drivers?.find((x) => x.username === driver)?.name ?? driver;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Every fill with its video</div><h1>Fuel</h1></div>
      </div>
      <FuelShown.Provider value={{ entries: list.items, loaded: !!d && !q.stale && !q.loading, total: list.total }}>
        <ListWithDetail>
          <div className="card card-b" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
            <DateRangePicker value={dates} />
            <VehicleDriverFilter vehicle={vehicle} driver={driver} onChange={setBoth} lists={lists} />
          </div>
          {dates.error || noConnector ? null : !d || !t ? (
            <ListWaiting q={q} loading="Adding up the fills…" />
          ) : q.err && q.stale ? (
            // The fills on screen are other days': say what went wrong instead.
            <ListStale q={q} />
          ) : (
            <div className="stack" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
              <div className="tiles">
                <Tile label="Fills" value={t.entries} unit="entries" sub={fuelLabel(d)} />
                <Tile label="Fuel" value={num(t.litres)} unit="litres" sub={`LKR ${num(t.lkr)}`} />
                <Tile label="Videos" value={t.videos} unit="uploaded" sub={t.bytes ? megabytes(t.bytes) : "nothing stored yet"} />
                <Tile label="Without a video" value={t.videos_missing + t.videos_waiting} unit="fills" sub={[t.videos_waiting ? `${t.videos_waiting} still on a phone` : "none missing", t.interrupted ? `${t.interrupted} interrupted` : ""].filter(Boolean).join(" · ")} tone={t.videos_missing ? "bad" : t.videos_waiting ? "warn" : ""} />
              </div>
              {monthLine && <p className="muted small" style={{ margin: 0 }} data-testid="fuel-month">{monthLine}</p>}
              <div className="card">
                <ListHeader title="Fills" count={list.total} updating={updating} />
                <ListStale q={q} />
                {list.items.length ? (
                  <div className="tbl-wrap">
                    <table data-testid="fuel-table">
                      <thead><tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Litres</th><th>LKR</th><th>Odometer</th><th>Video</th></tr></thead>
                      <tbody>
                        {list.items.map((e) => (
                          <tr key={e.id} className={`click${e.id === id ? " selected" : ""}`} onClick={() => navigate(`/fuel/${e.id}${search}`)} aria-current={e.id === id ? "true" : undefined} data-testid="fuel-row">
                            <td data-label="When" className="mono">{e.at}</td>
                            <td data-label="Vehicle">{e.vehicle ? <span className="plate">{e.vehicle}</span> : "—"}</td>
                            <td data-label="Driver">{e.driver ?? "—"}</td>
                            <td data-label="Litres" className="num">{e.litres != null ? num(e.litres) : "—"}</td>
                            <td data-label="LKR" className="num">{e.lkr != null ? num(e.lkr) : "—"}</td>
                            <td data-label="Odometer" className="num">{e.odometer_km != null ? `${num(e.odometer_km)} km` : "—"}</td>
                            <td data-label="Video"><Pill tone={videoTone(e.video.status)}>{videoChip(e.video.status, e.video.interrupted)}</Pill>{e.video.status === "uploaded" && <div className="sub">{videoWords(e.video)}</div>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{fuelEmpty(fuelLabel(d), vehicle, driverName)}</EmptyLine>}
                <ListFooter list={list} />
              </div>
            </div>
          )}
        </ListWithDetail>
      </FuelShown.Provider>
    </section>
  );
}
