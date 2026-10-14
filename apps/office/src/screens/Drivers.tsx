// Drivers (/drivers): the Fame Driver sign-ins; Add at /drivers/new, Manage at
// /drivers/:username/edit, the route history at /drivers/:username.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { DriversList } from "../data/types";
import { locTone } from "../lib/format";
import { ROUTES_NEED } from "../app/nav";
import { can } from "../transport/types";
import { Avatar, Empty, ErrBox, Loading, Pill, Plate, StaleNote } from "../ui/basics";
import { docTone } from "./vehicleLogic";

export function Drivers() {
  const { me, store, noConnector, managePermissions } = useFleet();
  const [inactive, setInactive] = useState(false);
  const entry = useEntry<DriversList>("drivers");
  const canManage = me.tools.includes("update_driver");
  const routes = can(me, ...ROUTES_NEED);

  useEffect(() => {
    if (noConnector) return;
    store.reset("drivers");
    store.watch("drivers", "list_drivers", { include_inactive: inactive }, 60000);
    return () => store.unwatch("drivers");
  }, [store, inactive, noConnector]);

  const d = entry.data;
  const list = d?.drivers ?? [];
  return (
    <section className="view">
      <div className="ph">
        <div><div className="eyebrow">Fame Driver sign-ins</div><h1>Drivers</h1></div>
        <div className="ph-actions">
          <span className="check"><input type="checkbox" id="drv-inactive" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> <label htmlFor="drv-inactive">Show switched-off drivers</label></span>
          {me.tools.includes("create_driver") && <Link className="btn primary" to="/drivers/new">Add driver</Link>}
        </div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("drivers", "list_drivers", { include_inactive: inactive })} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading drivers…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card">
            {list.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Driver</th><th>Code</th><th>Username</th><th>Phone</th><th>Licence expires</th><th>Vehicle</th><th>Location</th><th>Last 30 days</th><th className="r"></th></tr></thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.username}>
                        <td data-label="Driver"><span><div className="name"><Avatar name={x.name} small />{x.username && routes ? <Link to={`/drivers/${x.username}`}>{x.name}</Link> : x.name}</div>{x.active === false && <Pill tone="bad">Switched off</Pill>}</span></td>
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
            ) : <Empty>No drivers yet. Add the first one with Add driver.</Empty>}
          </div>
        </>
      )}
    </section>
  );
}
