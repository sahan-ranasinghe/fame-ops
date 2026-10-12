import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import { useEntry, useLists } from "../data/hooks";
import type { MileageSummary } from "../data/types";
import { num, today } from "../lib/format";
import { Empty, ErrBox, Loading, StaleNote, Tile } from "../ui/basics";
import { GenericTable } from "../ui/GenericTable";

export function Mileage() {
  const { store, noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const entry = useEntry<MileageSummary>("mileage");

  const args = () => {
    const input: Record<string, unknown> = { month };
    if (vehicle) input.vehicle = vehicle;
    if (driver) input.driver = driver;
    return input;
  };
  useEffect(() => {
    if (noConnector) return;
    void store.load("mileage", "mileage_summary", args());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, month, vehicle, driver, noConnector]);

  const d = entry.data;
  const t = d?.totals;
  const outside = t ? t.between_tasks_km + t.overnight_km : 0;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Odometer, task km and fuel</div><h1>Mileage</h1></div>
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
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("mileage", "mileage_summary", args())} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Adding up the month…</Loading>}
        </>
      )}
      {d && t && (
        <div className="stack">
          <StaleNote entry={entry} />
          <div className="tiles">
            <Tile label="Completed tasks" value={t.tasks} unit="tasks" sub={d.month} />
            <Tile label="Task km" value={num(t.task_km)} unit="km" sub="From odometer readings" />
            <Tile label="Km outside tasks" value={num(outside)} unit="km" sub={outside ? `${num(t.between_tasks_km)} between tasks · ${num(t.overnight_km)} overnight` : "Nothing driven between tasks"} tone={outside > 0 ? "warn" : ""} />
            <Tile label="Fuel" value={num(t.fuel_litres)} unit="litres" sub={`LKR ${num(t.fuel_lkr)}`} />
          </div>
          <div className="card">
            <div className="card-h"><h2>By vehicle</h2><span className="muted small">Odometer km is everything the vehicle drove; task km only the tasks</span></div>
            {d.vehicles.length ? <GenericTable rows={d.vehicles} /> : <Empty>No completed tasks or fuel logged this month.</Empty>}
          </div>
          <div className="card">
            <div className="card-h"><h2>Biggest gaps</h2><span className="muted small">Km between one reading and the next that no task explains</span></div>
            {d.biggest_gaps.length ? <GenericTable rows={d.biggest_gaps} /> : <Empty>No gaps this month.</Empty>}
          </div>
          <div className="card">
            <div className="card-h"><h2>Unlogged km</h2><span className="muted small">A task started more than 2 km away from the last reading</span></div>
            {d.unlogged_km.length ? <GenericTable rows={d.unlogged_km} hide={["task_id"]} /> : <Empty>None this month.</Empty>}
          </div>
          <div className="card">
            <div className="card-h"><h2>Odometer checks</h2><span className="muted small">Readings whose photo disagrees, was typed, or could not be read{t.check_odometer ? " · photo links work for 1 hour" : ""}</span></div>
            {d.check_odometer.length ? <GenericTable rows={d.check_odometer} hide={["task_id", "log_id"]} /> : <Empty>Every reading this month matches its photo.</Empty>}
          </div>
        </div>
      )}
    </section>
  );
}
