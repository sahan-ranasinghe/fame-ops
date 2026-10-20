// Office users (Settings → Users, the users permission): who can sign in to
// the web app and Claude and what each may do. Add at /settings/users/new,
// Manage at /settings/users/:email/edit.
// Hotfix 3 (L3): one list pattern. A search box (?q=: name, e-mail, role; on the server), 25 at a time (page numbers on a
// desktop, Load more and cards on a phone), the count in the header. By name, as the server sorts them; list_office_users
// has no active filter, so the switched-off people are listed with their pill.
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import type { OfficeUser, OfficeUsers } from "../../data/types";
import { Avatar, Pill } from "../../ui/basics";
import { phoneDisplay } from "../../ui/ContactButtons";
import { EmptyLine, ListHeader, usePagedList, SkeletonRows } from "../../ui/ListKit";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "../listLocal";
import { PermissionChips, userPath } from "./userParts";

export { PermissionChips } from "./userParts";

/** The list's query key. */
export const USERS_QUERY = "officeUsers";

/** What an empty list means, in words. */
export function usersEmpty(search: string): string {
  return search ? `Nobody matches "${search}" (name, e-mail or role).` : "No office accounts yet.";
}

export function Users() {
  const { noConnector } = useFleet();
  const box = useSearchBox();
  const list = usePagedList<OfficeUser, OfficeUsers>(USERS_QUERY, "list_office_users", box.search ? { search: box.search } : {}, (d) => d.users,
    { every: 60000, enabled: !noConnector });
  const q = list.query;
  const d = q.data;
  return (
    <section className="view" data-testid="users">
      <div className="ph">
        <div><div className="eyebrow">Settings · who can use the web app and Claude</div><h1>Users</h1></div>
        <div className="ph-actions"><Link className="btn primary" to="/settings/users/new">Add office user</Link></div>
      </div>
      <div className="list-tools">
        <SearchBox label="Find a person" placeholder="Name, e-mail or role" value={box.text} onChange={box.setText} onBlur={box.flush} />
      </div>
      {!noConnector && <ListWaiting q={q} loading="Loading users…" />}
      {d && (
        <>
          <div className="card" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="users-list">
            <ListHeader title="Office users" count={list.total} updating={q.updating || q.stale} />
            <ListStale q={q} />
            {list.items.length ? (
              <div className="tbl-wrap">
                <table data-testid="users-table">
                  <thead><tr><th>Person</th><th>E-mail</th><th>Phone</th><th>Permissions</th><th>Since</th><th>Claude keys</th><th className="r"></th></tr></thead>
                  <tbody>
                    {list.items.map((u) => (
                      <tr key={u.email ?? u.name} data-testid="user-row">
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
            ) : (q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{usersEmpty(box.search)}</EmptyLine>)}
            <ListFooter list={list} />
          </div>
          <p className="muted small">Drivers are not here: they sign in to the Fame Driver app with a username and PIN (Drivers page).</p>
        </>
      )}
    </section>
  );
}
