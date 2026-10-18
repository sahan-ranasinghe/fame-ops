// Mileage (/mileage, the vehicles permission): task km, odometer km, km outside
// tasks and fuel for the chosen days (Phase 7 §8: the date-range control,
// default this month, down to a single day), narrowed by vehicle and driver.
// Every filter is in the URL. A whole month is one set of tables with the
// allowance column; shorter days show their own rows and totals, and below
// them the month that contains To with each vehicle against its allowance.
// The previous answer stays on screen, marked "Updating…", while another loads.
import { Link, useLocation, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useLists } from "../data/hooks";
import type { MileageSummary } from "../data/types";
import { useQuery } from "../data/useQuery";
import { num } from "../lib/format";
import { errText } from "../transport/errors";
import { Empty, Loading, Notice, Tile } from "../ui/basics";
import { DateRange, useDateRange } from "../ui/DateRange";
import { GenericTable } from "../ui/GenericTable";
import { Icon } from "../ui/icons";
import { ALLOWANCE_KEYS, mileageView, monthLine, personalLine, rangeArgs } from "./mileageLogic";

/** mileage_summary takes up to 366 days. */
const MAX_DAYS = 366;

/** ?vehicle= and ?driver= beside the dates (Mileage and Fuel share the names, so a link carries them). */
export function useVehicleDriver(): { vehicle: string; driver: string; setVehicle: (v: string) => void; setDriver: (d: string) => void } {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set(key, value);
    else next.delete(key);
    return next;
  }, { replace: true });
  return { vehicle: params.get("vehicle") || "", driver: params.get("driver") || "", setVehicle: (v) => set("vehicle", v), setDriver: (d) => set("driver", d) };
}

export function Mileage() {
  const { noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const { search } = useLocation();
  const dates = useDateRange("month", { maxDays: MAX_DAYS });
  const { vehicle, setVehicle, driver, setDriver } = useVehicleDriver();
  const { from, to } = dates;
  const q = useQuery<MileageSummary>("mileage", "mileage_summary", rangeArgs(from, to, { vehicle, driver }), { keep: true, enabled: !noConnector && !dates.error });

  const d = q.data;
  const v = d ? mileageView(d) : undefined;
  const t = v?.totals;
  const outside = t ? t.between_tasks_km + t.overnight_km : 0;
  const personal = t ? personalLine(t) : undefined;
  const updating = q.updating || q.stale;
  const none = (what: string) => `${what} (${v?.label ?? ""}).`;
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Odometer, task km and fuel</div><h1>Mileage</h1></div>
      </div>
      <div className="stack">
        <div className="card card-b" style={{ display: "grid", gap: 12 }}>
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

        {dates.error || noConnector ? null : !d || !v || !t ? (
          q.err ? (
            <Notice
              tone="bad"
              action={errText(q.err)[1] === "perms" && managePermissions
                ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
                : <button type="button" className="btn small" onClick={q.refetch}>Try again</button>}
            >
              {errText(q.err)[0]}
            </Notice>
          ) : <Loading>Adding up the days…</Loading>
        ) : q.err && q.stale ? (
          // The figures on screen are other days': say what went wrong instead.
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err)[0]}</Notice>
        ) : (
          <div className="stack" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={updating || undefined}>
            {updating && <div className="updated">Updating…</div>}
            {q.err && !q.stale && <div className="stale">{errText(q.err)[0]}</div>}
            <div className="tiles">
              <Tile label="Completed tasks" value={t.tasks} unit="tasks" sub={v.label} />
              <Tile label="Task km" value={num(t.task_km)} unit="km" sub="From odometer readings" />
              <Tile label="Km outside tasks" value={num(outside)} unit="km" sub={outside ? `${num(t.between_tasks_km)} between tasks · ${num(t.overnight_km)} overnight` : "Nothing driven between tasks"} tone={outside > 0 ? "warn" : ""} />
              <Tile label="Fuel" value={num(t.fuel_litres)} unit="litres" sub={`LKR ${num(t.fuel_lkr)}`} />
            </div>
            {personal && <p className="muted small" style={{ margin: 0 }} data-testid="personal-km">{personal}</p>}
            <div className="acts"><Link className="btn" to={`/fuel${search}`}><Icon name="video" />Fuel entries and videos</Link></div>
            <div className="card">
              <div className="card-h"><h2>By vehicle</h2><span className="muted small">Odometer km is everything the vehicle drove; task km only the tasks{v.month ? "; the allowance is monthly (below)" : ""}</span></div>
              {v.vehicles.length ? <GenericTable rows={v.vehicles} hide={v.month ? ALLOWANCE_KEYS : []} /> : <Empty>{none("No completed tasks or fuel logged")}</Empty>}
            </div>
            {v.month && (
              <div className="card" data-testid="month-allowance">
                <div className="card-h"><h2>{v.month.label} (allowance)</h2><span className="muted small">The whole month that contains the last day chosen</span></div>
                <div className="card-b" style={{ paddingTop: 0 }}><span className="muted small">{monthLine(v.month.totals)}</span></div>
                {v.month.rows.length ? <GenericTable rows={v.month.rows} /> : <Empty>No completed tasks or fuel logged in {v.month.label}.</Empty>}
              </div>
            )}
            <div className="card">
              <div className="card-h"><h2>Biggest gaps</h2><span className="muted small">Km between one reading and the next that no task explains</span></div>
              {v.biggest_gaps.length ? <GenericTable rows={v.biggest_gaps} /> : <Empty>{none("No gaps")}</Empty>}
            </div>
            <div className="card">
              <div className="card-h"><h2>Unlogged km</h2><span className="muted small">A task started more than 2 km away from the last reading</span></div>
              {v.unlogged_km.length ? <GenericTable rows={v.unlogged_km} hide={["task_id"]} /> : <Empty>{none("None")}</Empty>}
            </div>
            <div className="card">
              <div className="card-h"><h2>Odometer checks</h2><span className="muted small">Readings whose photo disagrees, was typed, or could not be read{t.check_odometer ? " · photo links work for 1 hour" : ""}</span></div>
              {v.check_odometer.length ? <GenericTable rows={v.check_odometer} hide={["task_id", "log_id"]} /> : <Empty>{none("Every reading matches its photo")}</Empty>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
