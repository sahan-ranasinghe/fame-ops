import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useEntry } from "../data/hooks";
import type { IssuesList, Overview } from "../data/types";
import { bellCount, severityTone } from "../screens/issuesLogic";
import { longDate, today } from "../lib/format";
import { AUTHZ, errText } from "../transport/errors";
import { can, ROLE_LABEL } from "../transport/types";
import { Notice } from "../ui/basics";
import { Icon } from "../ui/icons";
import { PullToRefresh } from "../ui/PullToRefresh";
import { useFleet } from "./FleetContext";
import { InboxBanners, InboxBell, InboxProvider, SoundStrip } from "./inbox";
import { allowed, ISSUES_NEED, NAV, tabsFor } from "./nav";

const BELL_ARGS = { status: "active", limit: 10 };

/** The bell: how many issues are open or in progress, the newest ten in a dropdown. */
function Bell() {
  const { me, store, noConnector, realtime } = useFleet();
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
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    return realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load("issues", "list_issues", BELL_ARGS);
      }, 1000);
    });
  }, [store, show, realtime]);
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

/**
 * Phase 7 (§19): "2 tasks need a driver · Show" on every Tasks page (board, detail, history, the forms) while any does.
 * It reads the overview (watched every 30 s); on the web a change on the issues table (the bell's channel) reloads it
 * within a second, since declining and the end of the accept window open an issue.
 */
function NeedsDriverBanner() {
  const { me, store, noConnector, realtime } = useFleet();
  const overview = useEntry<Overview>("overview");
  const { pathname, search } = useLocation();
  const show = !noConnector && can(me, "approve", "assign_tasks");
  useEffect(() => {
    if (!show) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Web only: the artifact has no Realtime (its build carries no Supabase code).
    if (!realtime?.issues) return;
    return realtime.issues(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void store.load("overview", "fleet_overview", {});
      }, 1000);
    });
  }, [store, show, realtime]);
  const count = overview.data?.needs_driver?.count ?? 0;
  // Not on the needs-a-driver list itself (it is the list the banner opens).
  if (!show || count === 0 || !(pathname === "/tasks" || pathname.startsWith("/tasks/"))) return null;
  if (pathname === "/tasks" && new URLSearchParams(search).get("filter") === "needs_driver") return null;
  return (
    <div style={{ marginBottom: 16 }} data-testid="needs-driver-banner">
      <Notice tone="bad" action={<Link className="btn small" to="/tasks?filter=needs_driver">Show</Link>}>
        <b>{count === 1 ? "1 task needs a driver" : `${count} tasks need a driver`}</b>
      </Notice>
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

function ShellBody() {
  const { me, store, noConnector } = useFleet();
  const overview = useEntry<Overview>("overview");
  const waiting = can(me, "approve") ? overview.data?.requests?.waiting ?? 0 : 0;
  // The rail lists only what this person may open; the phone tab bar follows its own order.
  const nav = allowed(NAV, me);
  const tabs = tabsFor(me);
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
  // A tab is current on its own screen and on every page under it (/requests/new, /tasks/:id …).
  const current = (path: string) => (path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/"));

  return (
    <div className="app">
      <aside className="rail" aria-label="Fame Fleet">
        <div className="brand">
          <div className="logo">FF</div>
          <div><b>Fame Fleet</b><span>Fleet office</span></div>
        </div>
        {/* Hotfix 2 (A): the notification centre (a tray) beside the issues bell, which stays as it is. */}
        <div className="bells"><InboxBell /><Bell /></div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.key} to={n.path} end={n.path === "/"}>
              <Icon name={n.key} /><span>{n.label}</span>{badge(n.key)}
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
          <InboxBell />
          <Bell />
        </div>
        <SoundStrip />
        <InboxBanners />
        <Banner />
        <NeedsDriverBanner />
        <PullToRefresh><Outlet /></PullToRefresh>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <NavLink key={t.key} to={t.path} end={t.path === "/"} className={current(t.path) ? "active" : undefined} aria-current={current(t.path) ? "page" : undefined}>
            <i><Icon name={t.key} /></i>{t.label}{t.key === "requests" && waiting ? <span className="tab-badge" aria-label={`${waiting} waiting`}>{waiting}</span> : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Hotfix 2 (A, B): one notification-centre feed (and its sounds) for the whole page. */
export function Shell() {
  return <InboxProvider><ShellBody /></InboxProvider>;
}
