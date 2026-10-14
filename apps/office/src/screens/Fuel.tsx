// Fuel (/fuel, the vehicles permission; Phase 6, Part 3): the month's fills
// with their receipts and videos, filtered by month, vehicle and driver; a row
// opens the fill (/fuel/:id) with its video beside the list on a desktop, full
// screen on a phone.
import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { FuelList } from "../data/types";
import { num, today } from "../lib/format";
import { Empty, ErrBox, Loading, Pill, StaleNote, Tile } from "../ui/basics";
import { ListWithDetail } from "../ui/Page";
import { megabytes, videoChip, videoTone, videoWords } from "./fuelLogic";

export function useFuelList(): { entry: ReturnType<typeof useEntry<FuelList>>; month: string; setMonth: (m: string) => void; vehicle: string; setVehicle: (v: string) => void; driver: string; setDriver: (d: string) => void; reload: () => void } {
  const { store, noConnector } = useFleet();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") || today().slice(0, 7);
  const vehicle = params.get("vehicle") || "";
  const driver = params.get("driver") || "";
  const entry = useEntry<FuelList>("fuel");
  const args = () => {
    const input: Record<string, unknown> = { month };
    if (vehicle) input.vehicle = vehicle;
    if (driver) input.driver = driver;
    return input;
  };
  const reload = () => void store.load("fuel", "list_fuel", args());
  useEffect(() => {
    if (noConnector) return;
    void store.load("fuel", "list_fuel", args());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, month, vehicle, driver, noConnector]);
  const set = (key: string, value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  return { entry, month, setMonth: (m) => set("month", m), vehicle, setVehicle: (v) => set("vehicle", v), driver, setDriver: (d) => set("driver", d), reload };
}

export function Fuel() {
  const { noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const navigate = useNavigate();
  const { id } = useParams();
  const { entry, month, setMonth, vehicle, setVehicle, driver, setDriver, reload } = useFuelList();
  const d = entry.data;
  const t = d?.totals;
  const q = `?${new URLSearchParams({ month, ...(vehicle ? { vehicle } : {}), ...(driver ? { driver } : {}) }).toString()}`;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Every fill with its video</div><h1>Fuel</h1></div>
        <div className="ph-actions">
          <input type="month" aria-label="Month" style={{ width: "auto" }} value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} />
          <select aria-label="Vehicle" style={{ width: "auto" }} value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="">All vehicles</option>
            {(lists.vehicles ?? []).map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}</option>)}
          </select>
          <select aria-label="Driver" style={{ width: "auto" }} value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">All drivers</option>
            {(lists.drivers ?? []).map((x) => <option key={x.username} value={x.username}>{x.name}</option>)}
          </select>
        </div>
      </div>
      <ListWithDetail>
        {!d && !noConnector && (
          <>
            <ErrBox entry={entry} onRetry={reload} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
            {!entry.err && <Loading>Adding up the fills…</Loading>}
          </>
        )}
        {d && t && (
          <div className="stack">
            <StaleNote entry={entry} />
            <div className="tiles">
              <Tile label="Fills" value={t.entries} unit="entries" sub={d.month} />
              <Tile label="Fuel" value={num(t.litres)} unit="litres" sub={`LKR ${num(t.lkr)}`} />
              <Tile label="Videos" value={t.videos} unit="uploaded" sub={t.bytes ? megabytes(t.bytes) : "nothing stored yet"} />
              <Tile label="Without a video" value={t.videos_missing + t.videos_waiting} unit="fills" sub={t.videos_waiting ? `${t.videos_waiting} still on a phone` : "none missing"} tone={t.videos_missing ? "bad" : t.videos_waiting ? "warn" : ""} />
            </div>
            <div className="card">
              {d.entries.length ? (
                <div className="tbl-wrap">
                  <table data-testid="fuel-table">
                    <thead><tr><th>When</th><th>Vehicle</th><th>Driver</th><th>Litres</th><th>LKR</th><th>Odometer</th><th>Video</th></tr></thead>
                    <tbody>
                      {d.entries.map((e) => (
                        <tr key={e.id} className={`click${e.id === id ? " selected" : ""}`} onClick={() => navigate(`/fuel/${e.id}${q}`)} aria-current={e.id === id ? "true" : undefined}>
                          <td data-label="When" className="mono">{e.at}</td>
                          <td data-label="Vehicle">{e.vehicle ? <span className="plate">{e.vehicle}</span> : "—"}</td>
                          <td data-label="Driver">{e.driver ?? "—"}</td>
                          <td data-label="Litres" className="num">{e.litres != null ? num(e.litres) : "—"}</td>
                          <td data-label="LKR" className="num">{e.lkr != null ? num(e.lkr) : "—"}</td>
                          <td data-label="Odometer" className="num">{e.odometer_km != null ? `${num(e.odometer_km)} km` : "—"}</td>
                          <td data-label="Video"><Pill tone={videoTone(e.video.status)}>{videoChip(e.video.status)}</Pill>{e.video.status === "uploaded" && <div className="sub">{videoWords(e.video)}</div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No fuel logged this month.</Empty>}
            </div>
          </div>
        )}
      </ListWithDetail>
    </section>
  );
}
