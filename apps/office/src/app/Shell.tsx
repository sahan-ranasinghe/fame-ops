import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useEntry } from "../data/hooks";
import type { Overview } from "../data/types";
import { longDate, today } from "../lib/format";
import { AUTHZ, errText } from "../transport/errors";
import { ROLE_LABEL } from "../transport/types";
import { Notice } from "../ui/basics";
import { Icon } from "../ui/icons";
import { useFleet } from "./FleetContext";
import { allowed, NAV, TABS } from "./nav";

function Banner() {
  const { noConnector, store, managePermissions } = useFleet();
  const overview = useEntry<Overview>("overview");
  if (noConnector) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Notice tone="bad">
          This page shows the fleet through the Fame Fleet connector. Open it in Claude with Fame Fleet connected (Settings → Connectors).
        </Notice>
      </div>
    );
  }
  const e = overview.err;
  if (!e || !AUTHZ.has(e.code)) return null;
  const [text, fix] = errText(e);
  const action = fix === "perms" && managePermissions
    ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
    : fix === "approve"
    ? <button type="button" className="btn small" onClick={() => void store.load("overview", "fleet_overview", {})}>Allow and load</button>
    : <button type="button" className="btn small" onClick={() => location.reload()}>Reload</button>;
  return (
    <div style={{ marginBottom: 20 }}>
      <Notice tone="bad" action={action}>{text}</Notice>
    </div>
  );
}

export function Shell() {
  const { me, store, noConnector, signOut } = useFleet();
  const overview = useEntry<Overview>("overview");
  const waiting = overview.data?.requests?.waiting ?? 0;
  const nav = allowed(NAV, me.tools);
  const tabs = allowed(TABS, me.tools);
  const { pathname } = useLocation();

  // The overview feeds the Requests badge and the Home tiles: watched while the app is open.
  useEffect(() => {
    if (noConnector || !me.tools.includes("fleet_overview")) return;
    store.watch("overview", "fleet_overview", {}, 30000);
    return () => store.unwatch("overview");
  }, [store, noConnector, me.tools]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const badge = (key: string) => key === "requests" && waiting ? <span className="badge">{waiting}</span> : null;
  const role = me.name ? ROLE_LABEL[me.role] ?? "Fleet office" : "Fleet office";

  return (
    <div className="app">
      <aside className="rail" aria-label="Fame Fleet">
        <div className="brand">
          <div className="logo">FF</div>
          <div><b>Fame Fleet</b><span>Fleet office</span></div>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.key} to={n.path} end={n.path === "/"}>
              <Icon name={n.key} /><span>{n.label}</span>{badge(n.key)}
            </NavLink>
          ))}
          {signOut && <NavLink to="/settings"><Icon name="settings" /><span>Settings</span></NavLink>}
          <NavLink to="/more"><Icon name="more" /><span>More</span></NavLink>
        </nav>
        <div className="viewer">
          {me.name
            ? <><span className="avatar sm">{me.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span><span>{me.name}<small>{role}</small></span></>
            : <span className="muted small">Fleet office</span>}
        </div>
      </aside>

      <main className="main">
        <div className="mhead">
          <div className="logo">FF</div>
          <div><b>Fame Fleet</b><div className="muted small">{longDate(today(), true)}</div></div>
        </div>
        <Banner />
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <NavLink key={t.key} to={t.path} end={t.path === "/"}>
            <i><Icon name={t.key} /></i>{t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
