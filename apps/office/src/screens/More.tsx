import { useFleet } from "../app/FleetContext";
import { LATER } from "../app/nav";
import { ROLE_LABEL } from "../transport/types";

export function More() {
  const { me, signOut, transport } = useFleet();
  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Your account and everything else</div><h1>More</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="card card-b">
          <dl className="kv">
            <div><dt>Name</dt><dd>{me.name || "—"}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[me.role] ?? me.role}</dd></div>
            {me.email && <div><dt>E-mail</dt><dd>{me.email}</dd></div>}
            <div><dt>Fame Fleet</dt><dd>{__VERSION__} · {transport.kind === "api" ? "web" : "Claude"}</dd></div>
          </dl>
          {signOut && (
            <div style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
        <div className="card card-b">
          <h2>Coming next</h2>
          <p className="muted" style={{ margin: "6px 0 0" }}>{LATER.join(" · ")}. Until then the Fame Fleet connector in Claude has all of these.</p>
        </div>
      </div>
    </section>
  );
}
