import { PERMISSION_TEXT } from "@fleet/permissions";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { moreFor } from "../app/nav";
import { ROLE_LABEL } from "../transport/types";
import { Icon } from "../ui/icons";

/** Everything the person may open that is not on the phone's tab bar, and their account. */
export function More() {
  const { me, signOut, transport } = useFleet();
  const more = moreFor(me);
  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Your account and everything else</div><h1>More</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        {more.length > 0 && (
          <div className="more-list" data-testid="more-list">
            {more.map((n) => (
              <Link key={n.key} to={n.path}><Icon name={n.key} />{n.label}</Link>
            ))}
          </div>
        )}
        <div className="card card-b">
          <dl className="kv">
            <div><dt>Name</dt><dd>{me.name || "—"}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd></div>
            {me.email && <div><dt>E-mail</dt><dd>{me.email}</dd></div>}
            <div><dt>Fame Fleet</dt><dd>{__VERSION__} · {transport.kind === "api" ? "web" : "Claude"}</dd></div>
            <div style={{ gridColumn: "1/-1" }}>
              <dt>Permissions</dt>
              <dd>{me.permissions.length ? me.permissions.map((p) => <span key={p} className="perm">{PERMISSION_TEXT[p].label}</span>) : "None"}</dd>
            </div>
          </dl>
          {signOut && (
            <div className="acts" style={{ marginTop: 16 }}>
              <Link className="btn" to="/settings">Sign-in and security</Link>
              <button type="button" className="btn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
