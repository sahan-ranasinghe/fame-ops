// Fuel (/fuel, the vehicles permission; Phase 6, Part 3): the fills of the
// chosen days (Phase 7 §8: the date-range control, default this month) with
// their receipts and videos, filtered by vehicle and driver, all in the URL;
// beside a shorter range, the month that contains To in one line. A row opens
// the fill (/fuel/:id) with its video beside the list on a desktop, full
// screen on a phone; the fill page reads this list's answer by the same key.
import { useLocation, useNavigate, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { FuelList } from "../data/types";
import { useQuery } from "../data/useQuery";
import { num } from "../lib/format";
import { errText } from "../transport/errors";
import { Empty, Loading, Notice, Pill, Tile } from "../ui/basics";
import { DateRange, type DateRangeValue, useDateRange } from "../ui/DateRange";
import { ListWithDetail } from "../ui/Page";
import { megabytes, videoChip, videoTone, videoWords } from "./fuelLogic";
import { useVehicleDriver } from "./Mileage";
import { fuelLabel, fuelMonthLine, rangeArgs } from "./mileageLogic";

/** list_fuel takes up to 366 days. */
const MAX_DAYS = 366;
/** The list's query key (the fill page reads the same entry). */
export const FUEL_QUERY = "fuel";

/** The dates and filters in the URL, and list_fuel's input for them (the list and the fill page agree on it). */
export function useFuelArgs(): { dates: DateRangeValue; vehicle: string; driver: string; setVehicle: (v: string) => void; setDriver: (d: string) => void; args: Record<string, unknown> } {
  const dates = useDateRange("month", { maxDays: MAX_DAYS });
  const vd = useVehicleDriver();
  return { dates, ...vd, args: rangeArgs(dates.from, dates.to, { vehicle: vd.vehicle, driver: vd.driver }) };
}

export function Fuel() {
  const { noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const navigate = useNavigate();
  const { search } = useLocation();
  const { id } = useParams();
  const { dates, vehicle, setVehicle, driver, setDriver, args } = useFuelArgs();
  const q = useQuery<FuelList>(FUEL_QUERY, "list_fuel", args, { keep: true, enabled: !noConnector && !dates.error });
  const d = q.data;
  const t = d?.totals;
  const monthLine = d ? fuelMonthLine(d) : undefined;
  const updating = q.updating || q.stale;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Every fill with its video</div><h1>Fuel</h1></div>
      </div>
      <ListWithDetail>
        <div className="card card-b" style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          <DateRange value={dates} />
          <div className="filters" style={{ marginBottom: 0 }}>
            <label className="field"><span>Vehicle</span>
              <select aria-label="Vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                <option value="">All vehicles</option>
                {vehicle && !lists.vehicles?.some((x) => x.reg_no === vehicle) && <option value={vehicle}>{vehicle}</option>}
                {(lists.vehicles ?? []).map((x) => <option key={x.reg_no} value={x.reg_no}>{x.reg_no}</option>)}
              </select>
            </label>
            <label className="field"><span>Driver</span>
              <select aria-label="Driver" value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="">All drivers</option>
                {driver && !lists.drivers?.some((x) => x.username === driver) && <option value={driver}>{driver}</option>}
                {(lists.drivers ?? []).map((x) => <option key={x.username} value={x.username}>{x.name}</option>)}
              </select>
            </label>
          </div>
        </div>
        {dates.error || noConnector ? null : !d || !t ? (
          q.err ? (
            <Notice
              tone="bad"
              action={errText(q.err)[1] === "perms" && managePermissions
                ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
                : <button type="button" className="btn small" onClick={q.refetch}>Try again</button>}
            >
              {errText(q.err)[0]}
            </Notice>
          ) : <Loading>Adding up the fills…</Loading>
        ) : q.err && q.stale ? (
          // The fills on screen are other days': say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
        ) : (
          <div className="stack" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
            {updating && <div className="updated">Updating…</div>}
            {q.err && !q.stale && <div className="stale">{errText(q.err)[0]}</div>}
            <div className="tiles">
              <Tile label="Fills" value={t.entries} unit="entries" sub={fuelLabel(d)} />
              <Tile label="Fuel" value={num(t.litres)} unit="litres" sub={`LKR ${num(t.lkr)}`} />
              <Tile label="Videos" value={t.videos} unit="uploaded" sub={t.bytes ? megabytes(t.bytes) : "nothing stored yet"} />
              <Tile label="Without a video" value={t.videos_missing + t.videos_waiting} unit="fills" sub={[t.videos_waiting ? `${t.videos_waiting} still on a phone` : "none missing", t.interrupted ? `${t.interrupted} interrupted` : ""].filter(Boolean).join(" · ")} tone={t.videos_missing ? "bad" : t.videos_waiting ? "warn" : ""} />
            </div>
            {monthLine && <p className="muted small" style={{ margin: 0 }} data-testid="fuel-month">{monthLine}</p>}
            <div className="card">
              {d.entries.length ? (
                <div className="tbl-wrap">
                  <table data-testid="fuel-table">
                    <thead><tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Litres</th><th>LKR</th><th>Odometer</th><th>Video</th></tr></thead>
                    <tbody>
                      {d.entries.map((e) => (
                        <tr key={e.id} className={`click${e.id === id ? " selected" : ""}`} onClick={() => navigate(`/fuel/${e.id}${search}`)} aria-current={e.id === id ? "true" : undefined}>
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
              ) : <Empty>{q.stale ? "Loading…" : `No fuel logged (${fuelLabel(d)}).`}</Empty>}
            </div>
          </div>
        )}
      </ListWithDetail>
    </section>
  );
}
