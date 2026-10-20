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
import { argsKey, useQuery } from "../data/useQuery";
import { num } from "../lib/format";
import { errText } from "../transport/errors";
import { Notice, Tile } from "../ui/basics";
import { FilterBar } from "../ui/FilterBar";
import { type FilterValues, listDef } from "../ui/filterLogic";
import { SkeletonRows } from "../ui/ListKit";
import { DateRangePicker, useDateRange } from "../ui/DateRangePicker";
import { Icon } from "../ui/icons";
import { ALLOWANCE_KEYS, fuelSearch, mileageView, monthLine, personalLine, rangeArgs } from "./mileageLogic";
import { MileageTable } from "./MileageTable";

/** mileage_summary takes up to 366 days. */
const MAX_DAYS = 366;

/** ?vehicle= and ?driver= beside the dates (Mileage and Fuel share the names, so a link carries them). */
export function useVehicleDriver(): { vehicle: string; driver: string; setVehicle: (v: string) => void; setDriver: (d: string) => void; setBoth: (v: FilterValues) => void } {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return next;
  }, { replace: true });
  return {
    vehicle: params.get("vehicle") || "",
    driver: params.get("driver") || "",
    setVehicle: (v) => set({ vehicle: v }),
    setDriver: (d) => set({ driver: d }),
    setBoth: (v) => set({ vehicle: (v.vehicle as string) ?? "", driver: (v.driver as string) ?? "" }),
  };
}

/** The Vehicle and Driver filters (Mileage, Fuel): one Filter button, their chips (docs/ui-patterns.md §1). */
export function VehicleDriverFilter({ vehicle, driver, onChange, lists }: {
  vehicle: string;
  driver: string;
  onChange: (v: FilterValues) => void;
  lists: { vehicles?: { reg_no: string }[]; drivers?: { username: string; name: string }[] };
}) {
  const defs = [
    listDef("vehicle", "Vehicle", "All vehicles", (lists.vehicles ?? []).map((x) => ({ value: x.reg_no, label: x.reg_no })), vehicle),
    listDef("driver", "Driver", "All drivers", (lists.drivers ?? []).map((x) => ({ value: x.username, label: x.name })), driver),
  ];
  return <FilterBar filters={defs} values={{ vehicle, driver }} onChange={onChange} />;
}

export function Mileage() {
  const { noConnector, managePermissions } = useFleet();
  const lists = useLists(!noConnector);
  const { search } = useLocation();
  const dates = useDateRange("month", { maxDays: MAX_DAYS });
  const { vehicle, driver, setBoth } = useVehicleDriver();
  const { from, to } = dates;
  const args = rangeArgs(from, to, { vehicle, driver });
  const q = useQuery<MileageSummary>("mileage", "mileage_summary", args, { keep: true, enabled: !noConnector && !dates.error });
  // Hotfix 3 (L3): each table pages in the browser; other days or filters start them on their first page.
  const reset = argsKey(args);

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
          <DateRangePicker value={dates} />
          <VehicleDriverFilter vehicle={vehicle} driver={driver} onChange={setBoth} lists={lists} />
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
          ) : <div className="card"><SkeletonRows label="Adding up the days…" /></div>
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
            <div className="acts"><Link className="btn" to={`/fuel${fuelSearch(search)}`}><Icon name="video" />Fuel entries and videos</Link></div>
            <MileageTable title="By vehicle" testId="mileage-vehicles" resetKey={reset} rows={v.vehicles} hide={v.month ? ALLOWANCE_KEYS : []}
              note={`Odometer km is everything the vehicle drove; task km only the tasks${v.month ? "; the allowance is monthly (below)" : ""}`}
              empty={none("No completed tasks or fuel logged")} />
            {v.month && (
              <MileageTable title={`${v.month.label} (allowance)`} testId="month-allowance" resetKey={reset} rows={v.month.rows}
                note="The whole month that contains the last day chosen"
                intro={<span className="muted small">{monthLine(v.month.totals)}</span>}
                empty={`No completed tasks or fuel logged in ${v.month.label}.`} />
            )}
            <MileageTable title="Biggest gaps" testId="mileage-gaps" resetKey={reset} rows={v.biggest_gaps}
              note="Km between one reading and the next that no task explains" empty={none("No gaps")} />
            <MileageTable title="Unlogged km" testId="mileage-unlogged" resetKey={reset} rows={v.unlogged_km} hide={["task_id"]}
              note="A task started more than 2 km away from the last reading" empty={none("None")} />
            <MileageTable title="Odometer checks" testId="mileage-checks" resetKey={reset} rows={v.check_odometer} hide={["task_id", "log_id"]}
              note={`Readings whose photo disagrees, was typed, or could not be read${t.check_odometer ? " · photo links work for 1 hour" : ""}`}
              empty={none("Every reading matches its photo")} />
          </div>
        )}
      </div>
    </section>
  );
}
