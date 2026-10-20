// Drivers (/drivers): the Fame Driver sign-ins; Add at /drivers/new, Manage at
// /drivers/:username/edit, the route history at /drivers/:username.
// Hotfix 3 (L3): one list pattern. The active drivers by default (?inactive=1 adds the switched-off ones), a search box
// (?q=: name, username, code, plate; on the server), 25 at a time (page numbers on a desktop, Load more and cards on a
// phone) with the count in the header.
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { ROUTES_NEED } from "../app/nav";
import type { Driver, DriversList } from "../data/types";
import { locTone } from "../lib/format";
import { can } from "../transport/types";
import { Avatar, Pill, Plate } from "../ui/basics";
import { FilterBar } from "../ui/FilterBar";
import { pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, usePagedList, useUrlFilter } from "../ui/ListKit";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "./listLocal";
import { docTone } from "./vehicleLogic";

/** The list's query key. */
export const DRIVERS_QUERY = "drivers";

/** list_drivers' filters (the page asks with limit and cursor on top). */
export function driversArgs(inactive: boolean, search: string): Record<string, unknown> {
  return { include_inactive: inactive, ...(search ? { search } : {}) };
}

/** What an empty list means, in words. */
export function driversEmpty(inactive: boolean, search: string, canAdd: boolean): string {
  if (search) return `No ${inactive ? "" : "active "}driver matches "${search}" (name, username, code or plate).`;
  if (inactive) return canAdd ? "No drivers yet. Add the first one with Add driver." : "No drivers yet.";
  return canAdd ? "No active drivers. Add one with Add driver, or show the switched-off ones." : "No active drivers.";
}

export function Drivers() {
  const { me, noConnector } = useFleet();
  const [inactiveFlag, setInactiveFlag] = useUrlFilter<"0" | "1">("inactive", "0", ["0", "1"]);
  const inactive = inactiveFlag === "1";
  const box = useSearchBox();
  const canManage = me.tools.includes("update_driver");
  const canAdd = me.tools.includes("create_driver");
  const routes = can(me, ...ROUTES_NEED);
  const list = usePagedList<Driver, DriversList>(DRIVERS_QUERY, "list_drivers", driversArgs(inactive, box.search), (d) => d.drivers,
    { every: 60000, enabled: !noConnector });
  const q = list.query;
  const d = q.data;

  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Fame Driver sign-ins</div><h1>Drivers</h1></div>
        <div className="ph-actions">
          {me.tools.includes("drivers_board") && <Link className="btn" to="/drivers/board">Drivers board</Link>}
          {me.tools.includes("duty_log") && <Link className="btn" to="/drivers/duty">Duty log</Link>}
          {canAdd && <Link className="btn primary" to="/drivers/new">Add driver</Link>}
        </div>
      </div>
      <FilterBar
        search={<SearchBox label="Find a driver" placeholder="Name, username, code or plate" value={box.text} onChange={box.setText} onBlur={box.flush} />}
        filters={[pairsDef("inactive", "Show", [["0", "Active drivers"], ["1", "All drivers, the switched-off ones too"]], "0")]}
        values={{ inactive: inactiveFlag }}
        onChange={(v) => setInactiveFlag(v.inactive === "1" ? "1" : "0")}
      />
      {!noConnector && <ListWaiting q={q} loading="Loading drivers…" />}
      {d && (
        <div className="card" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="drivers-list">
          <ListHeader title={inactive ? "All drivers" : "Active drivers"} count={list.total} updating={q.updating || q.stale} />
          <ListStale q={q} />
          {list.items.length ? (
            <div className="tbl-wrap">
              <table data-testid="drivers-table">
                <thead><tr><th><span className="sr-only">Photo</span></th><th>Driver</th><th>Code</th><th>Username</th><th>Phone</th><th>Licence expires</th><th>Vehicle</th><th>Location</th><th>Last 30 days</th><th className="r"></th></tr></thead>
                <tbody>
                  {list.items.map((x) => (
                    <tr key={x.username} data-testid="driver-row">
                      <td className="photo-cell"><Avatar name={x.name} src={x.photo_url} /></td>
                      <td data-label="Driver"><span><div className="name">{x.username && routes ? <Link to={`/drivers/${x.username}`}>{x.name}</Link> : x.name}</div>{x.active === false && <Pill tone="bad">Switched off</Pill>}</span></td>
                      <td data-label="Code" className="mono">{x.code || "—"}</td>
                      <td data-label="Username" className="mono">{x.username || "—"}</td>
                      <td data-label="Phone">{x.phone || "—"}</td>
                      <td data-label="Licence expires">{x.licence?.expiry ? <span className={`doc ${docTone(x.licence.chip)}`}>{x.licence.expiry}</span> : "—"}</td>
                      <td data-label="Vehicle">{x.current_vehicle ? <Plate v={x.current_vehicle} /> : "—"}</td>
                      <td data-label="Location">{x.location ? <Pill tone={locTone(x.location)}>{x.location}</Pill> : "—"}{x.on_duty_since ? <div className="sub">On duty since {x.on_duty_since}</div> : x.off_duty_since ? <div className="sub">Off duty since {x.off_duty_since}</div> : null}</td>
                      <td data-label="Last 30 days" className="small">{x.last_30_days ? <span>{x.last_30_days.accepted} accepted{x.last_30_days.declined ? <span className="status bad"> · {x.last_30_days.declined} declined</span> : " · 0 declined"}</span> : "—"}</td>
                      <td className="r">{canManage && <Link className="btn small" to={`/drivers/${x.username}/edit`}>Manage</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{driversEmpty(inactive, box.search, canAdd)}</EmptyLine>}
          <ListFooter list={list} />
        </div>
      )}
    </section>
  );
}
