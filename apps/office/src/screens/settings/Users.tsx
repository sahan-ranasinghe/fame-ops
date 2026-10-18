// Office users (Settings → Users, the users permission): who can sign in to
// the web app and Claude and what each may do. Add at /settings/users/new,
// Manage at /settings/users/:email/edit.
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { useWatch } from "../../data/hooks";
import type { OfficeUsers } from "../../data/types";
import { Avatar, Empty, ErrBox, Loading, Pill, StaleNote } from "../../ui/basics";
import { phoneDisplay } from "../../ui/ContactButtons";
import { PermissionChips, userPath } from "./userParts";

export { PermissionChips } from "./userParts";

export function Users() {
  const { store, noConnector, managePermissions } = useFleet();
  const entry = useWatch<OfficeUsers>("officeUsers", "list_office_users", {}, 60000, !noConnector);
  const d = entry.data;
  return (
    <section className="view" data-testid="users">
      <div className="ph">
        <div><div className="eyebrow">Settings · who can use the web app and Claude</div><h1>Users</h1></div>
        <div className="ph-actions"><Link className="btn primary" to="/settings/users/new">Add office user</Link></div>
      </div>
      {!d && !noConnector && (
        <>
          <ErrBox entry={entry} onRetry={() => void store.load("officeUsers", "list_office_users", {})} onFix={(f) => { if (f === "perms") void managePermissions?.(); }} />
          {!entry.err && <Loading>Loading users…</Loading>}
        </>
      )}
      {d && (
        <>
          <StaleNote entry={entry} />
          <div className="card">
            {d.users.length ? (
              <div className="tbl-wrap">
                <table>
                  <thead><tr><th>Person</th><th>E-mail</th><th>Phone</th><th>Permissions</th><th>Since</th><th>Claude keys</th><th className="r"></th></tr></thead>
                  <tbody>
                    {d.users.map((u) => (
                      <tr key={u.email ?? u.name}>
                        <td data-label="Person"><span><div className="name"><Avatar name={u.name} small />{u.name}</div>{!u.active && <Pill tone="bad">Switched off</Pill>}</span></td>
                        <td data-label="E-mail">{u.email || "—"}</td>
                        <td data-label="Phone" className="num">{u.phone_display ?? (u.phone ? phoneDisplay(u.phone) : "—")}</td>
                        <td data-label="Permissions"><span><PermissionChips permissions={u.permissions} /></span></td>
                        <td data-label="Since">{u.since || "—"}</td>
                        <td data-label="Claude keys">{u.connector_keys.length || "—"}</td>
                        <td className="r">{u.email && <Link className="btn small" to={userPath(u.email)}>Manage</Link>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>No office accounts yet.</Empty>}
          </div>
          <p className="muted small">Drivers are not here: they sign in to the Fame Driver app with a username and PIN (Drivers page).</p>
        </>
      )}
    </section>
  );
}
