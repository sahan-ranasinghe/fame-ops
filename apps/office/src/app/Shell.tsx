import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useEntry } from "../data/hooks";
import { subscribeIssues } from "../data/realtime";
import type { IssuesList, Overview } from "../data/types";
import { bellCount, severityTone } from "../screens/issuesLogic";
import { longDate, today } from "../lib/format";
import { AUTHZ, errText } from "../transport/errors";
import { can, ROLE_LABEL } from "../transport/types";
import { Notice } from "../ui/basics";
import { Icon } from "../ui/icons";
import { useFleet } from "./FleetContext";
import { allowed, ISSUES_NEED, LOCK_HINT, NAV, navState, TABS } from "./nav";

const BELL_ARGS = { status: "active", limit: 10 };

/** The bell: how many issues are open or in progress, the newest ten in a dropdown. */
function Bell() {
  const { me, store, noConnector } = useFleet();
  const show = !noConnector && can(me, ...ISSUES_NEED);
  const entry = useEntry<IssuesList>("issues");
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!show) return;
    store.watch("issues", "list_issues", BELL_ARGS, 60000);
    return () => store.unwatch("issues");
  }, [store, show]);
  // Web: a change on the issues table refreshes the count at once (one reload a second at most).
  useEffect(() => {
    if (!show) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return subscribeIssues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load("issues", "list_issues", BELL_ARGS);
      }, 1000);
    });
  }, [store, show]);
  useEffect(() => setOpen(false), [pathname]);

  if (!show) return null;
  const count = bellCount(entry.data);
  const items = entry.data?.issues ?? [];
  return (
    <div className="bell">
      <button type="button" className="bell-btn" aria-label={`Issues: ${count} open`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="issues" />
        {count > 0 && <span className="badge" data-testid="bell-count">{count}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="menu" data-testid="bell-menu">
          {items.length
            ? items.map((i) => (
              <Link key={i.id} role="menuitem" to={`/issues/${i.id}`} className="bell-item">
                <i className={`dot ${severityTone(i.severity)}`} />
                <span className="grow"><b>{i.title}</b><small>{i.detail ?? ""}</small></span>
              </Link>
            ))
            : <div className="bell-item muted">Nothing needs attention.</div>}
          <Link role="menuitem" to="/issues" className="bell-all">All issues{count > items.length ? ` (${count})` : ""}</Link>
        </div>
      )}
    </div>
  );
}

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
  const { me, store, noConnector } = useFleet();
  const overview = useEntry<Overview>("overview");
  const waiting = can(me, "approve") ? overview.data?.requests?.waiting ?? 0 : 0;
  const nav = navState(NAV, me);
  const tabs = allowed(TABS, me);
  const { pathname } = useLocation();

  // The overview feeds the Requests badge and the Home tiles: watched while the app is open.
  useEffect(() => {
    if (noConnector || !can(me, "view")) return;
    store.watch("overview", "fleet_overview", {}, 30000);
    return () => store.unwatch("overview");
  }, [store, noConnector, me]);

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
        <Bell />
        <nav className="nav">
          {nav.map((n) => (
            <NavLink
              key={n.key}
              to={n.path}
              end={n.path === "/"}
              className={n.locked ? "locked" : undefined}
              aria-disabled={n.locked || undefined}
              title={n.locked ? LOCK_HINT : undefined}
            >
              <Icon name={n.key} /><span>{n.label}</span>{n.locked ? <i className="lock"><Icon name="lock" /></i> : badge(n.key)}
            </NavLink>
          ))}
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
          <div className="grow"><b>Fame Fleet</b><div className="muted small">{longDate(today(), true)}</div></div>
          <Bell />
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
