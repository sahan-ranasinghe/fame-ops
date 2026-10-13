import { PERMISSION_TEXT } from "@fleet/permissions";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { LOCK_HINT, MORE_KEYS, NAV, navState } from "../app/nav";
import { ROLE_LABEL } from "../transport/types";
import { Icon } from "../ui/icons";

export function More() {
  const { me, signOut, transport } = useFleet();
  const more = navState(NAV, me).filter((n) => MORE_KEYS.includes(n.key));
  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Your account and everything else</div><h1>More</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="more-list">
          {more.map((n) => (
            <Link key={n.key} to={n.path} className={n.locked ? "locked" : undefined} aria-disabled={n.locked || undefined} title={n.locked ? LOCK_HINT : undefined}>
              <Icon name={n.key} />{n.label}{n.locked && <i className="lock"><Icon name="lock" /></i>}
            </Link>
          ))}
        </div>
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
        <div className="card card-b">
          <h2>Coming next</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>Stops and leave-by times, issues and notifications, driver accept/decline, booking by vehicle type. Until then the Fame Fleet connector in Claude answers those questions.</p>
        </div>
      </div>
    </section>
  );
}
