import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import { allowed, MORE_KEYS, NAV } from "../app/nav";
import { ROLE_LABEL } from "../transport/types";
import { Icon } from "../ui/icons";

export function More() {
  const { me, signOut, transport } = useFleet();
  const more = allowed(NAV, me.tools).filter((n) => MORE_KEYS.includes(n.key));
  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Your account and everything else</div><h1>More</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        {more.length > 0 && (
          <div className="more-list">
            {more.map((n) => <Link key={n.key} to={n.path}><Icon name={n.key} />{n.label}</Link>)}
            {signOut && <Link to="/settings"><Icon name="settings" />Settings</Link>}
          </div>
        )}
        <div className="card card-b">
          <dl className="kv">
            <div><dt>Name</dt><dd>{me.name || "—"}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd></div>
            {me.email && <div><dt>E-mail</dt><dd>{me.email}</dd></div>}
            <div><dt>Fame Fleet</dt><dd>{__VERSION__} · {transport.kind === "api" ? "web" : "Claude"}</dd></div>
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
          <p className="muted" style={{ margin: "6px 0 0" }}>Project costs, Zoho sync and an audit page. Until then the Fame Fleet connector in Claude answers those questions.</p>
        </div>
      </div>
    </section>
  );
}
