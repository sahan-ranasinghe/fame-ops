import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useEntry } from "../data/hooks";
import type { Overview } from "../data/types";
import { longDate, today } from "../lib/format";
import { AUTHZ, errText } from "../transport/errors";
import { can, ROLE_LABEL } from "../transport/types";
import { Notice } from "../ui/basics";
import { Icon } from "../ui/icons";
import { PullToRefresh } from "../ui/PullToRefresh";
import { useFleet } from "./FleetContext";
import { InboxBanners, InboxBell, InboxProvider, SoundStrip } from "./inbox";
import { menuFor, moreFor, type NavItem, tabsFor } from "./nav";
import { badgeText, useIssuesCountWatch, useNavBadges } from "./navBadges";
import { usePrefs } from "./prefs";

/**
 * Phase 7 (§19): "2 tasks need a driver · Show" on every Tasks page (board, detail, history, the forms) while any does.
 * It reads the overview (watched every 30 s); on the web a change on the issues table reloads it within a second, since
 * declining and the end of the accept window open an issue.
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

/** The path of My profile (Hotfix 2, F). */
export const PROFILE_PATH = "/settings/profile";

/**
 * Hotfix 2 (F): someone who approves or assigns tasks with no phone number saved (GET /me's phone_required) is asked for
 * it on every page; the banner goes once it is saved (My profile asks /me again). Not on My profile itself.
 */
export function PhoneBanner() {
  const { me } = useFleet();
  const { pathname } = useLocation();
  if (!me.phone_required || pathname === PROFILE_PATH) return null;
  return (
    <div style={{ marginBottom: 16 }} data-testid="phone-banner">
      <Notice tone="info" action={<Link className="btn small" to={PROFILE_PATH}>Add my number</Link>}>
        <b>Add your phone number so drivers can call you.</b>
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

/** A screen is current on its own path and on every page under it (/requests/new, /tasks/:id …). */
const isCurrent = (pathname: string, path: string) => (path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/"));

/**
 * Hotfix 3 (L5): the desktop menu in sections (Today · Fleet · Reports · Admin), only what the person may open. A
 * section's name collapses it (remembered per person with the Overview's sections); a collapsed section still shows the
 * page you are on, and the sum of its counts beside its name.
 */
function RailMenu({ badges }: { badges: Record<string, number> }) {
  const { me } = useFleet();
  const { pathname } = useLocation();
  const { isCollapsed, setCollapsed } = usePrefs();
  const sections = menuFor(me);
  const current = (n: NavItem) => isCurrent(pathname, n.path);
  const badge = (key: string) => (badges[key] ? <span className="badge" data-testid={`nav-badge-${key}`} aria-label={`${badges[key]} ${key === "issues" ? "open" : "waiting"}`}>{badgeText(badges[key])}</span> : null);
  return (
    <nav className="nav nav-sections" aria-label="Menu">
      {sections.map((s) => {
        const collapsed = isCollapsed("menu_collapsed", s.key);
        const items = collapsed ? s.items.filter(current) : s.items;
        const hidden = s.items.filter((n) => !items.includes(n)).reduce((sum, n) => sum + (badges[n.key] ?? 0), 0);
        return (
          <div className="nav-sec" key={s.key} data-testid={`nav-${s.key}`}>
            <button
              type="button"
              className="nav-sec-h"
              aria-expanded={!collapsed}
              aria-controls={`nav-sec-${s.key}`}
              onClick={() => setCollapsed("menu_collapsed", s.key, !collapsed)}
            >
              <span className="grow">{s.label}</span>
              {collapsed && hidden > 0 && <span className="badge" aria-label={`${hidden} inside`}>{badgeText(hidden)}</span>}
              <span className="chev" aria-hidden="true" />
            </button>
            <div id={`nav-sec-${s.key}`} className="nav-sec-items">
              {items.map((n) => (
                <NavLink key={n.key} to={n.path} end={n.path === "/"}>
                  <Icon name={n.key} /><span>{n.label}</span>{badge(n.key)}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
      <NavLink to="/more" className="nav-more"><Icon name="more" /><span>More</span></NavLink>
    </nav>
  );
}

function ShellBody() {
  const { me, store, noConnector } = useFleet();
  const badges = useNavBadges();
  // The phone tab bar follows its own order (the role's most used screens).
  const tabs = tabsFor(me);
  // Hotfix 3 (L4): the issues count, when Issues is not on the bar, shows on More (Issues is listed there).
  const issuesUnderMore = badges.issues > 0 && moreFor(me).some((n) => n.key === "issues");
  const { pathname } = useLocation();

  // The overview feeds the Requests badge and the Home tiles: watched while the app is open.
  useEffect(() => {
    if (noConnector || !can(me, "view")) return;
    store.watch("overview", "fleet_overview", {}, 30000);
    return () => store.unwatch("overview");
  }, [store, noConnector, me]);
  useIssuesCountWatch();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const role = me.name ? ROLE_LABEL[me.role] ?? "Fleet office" : "Fleet office";
  const tabBadge = (key: string) => {
    const n = key === "more" ? (issuesUnderMore ? badges.issues : 0) : badges[key] ?? 0;
    if (!n) return null;
    const what = key === "requests" ? "waiting" : key === "more" ? "open issues" : "open";
    return <span className="tab-badge" data-testid={`tab-badge-${key}`} aria-label={`${n} ${what}`}>{badgeText(n)}</span>;
  };

  return (
    <div className="app">
      <aside className="rail" aria-label="Fame Fleet">
        <div className="brand">
          <div className="logo">FF</div>
          <div><b>Fame Fleet</b><span>Fleet office</span></div>
        </div>
        {/* Hotfix 3 (L4): one notification icon, the tray; the issues count is on the Issues menu item. */}
        <div className="bells"><InboxBell /></div>
        <RailMenu badges={badges} />
        {/* The person's name opens My profile (their phone number, Hotfix 2 F). */}
        <Link className="viewer" to={PROFILE_PATH} title="My profile" data-testid="viewer-profile">
          {me.name
            ? <><span className="avatar sm">{me.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span><span>{me.name}<small>{role}</small></span></>
            : <span className="muted small">Fleet office</span>}
        </Link>
      </aside>

      <main className="main">
        <div className="mhead">
          <div className="logo">FF</div>
          <div className="grow"><b>Fame Fleet</b><div className="muted small">{longDate(today(), true)}</div></div>
          <InboxBell />
        </div>
        <SoundStrip />
        <InboxBanners />
        <Banner />
        <PhoneBanner />
        <NeedsDriverBanner />
        <PullToRefresh><Outlet /></PullToRefresh>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => {
          const cur = isCurrent(pathname, t.path);
          return (
            <NavLink key={t.key} to={t.path} end={t.path === "/"} className={cur ? "active" : undefined} aria-current={cur ? "page" : undefined}>
              <i><Icon name={t.key} /></i>{t.label}{tabBadge(t.key)}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

/** Hotfix 2 (A, B): one notification-centre feed (and its sounds) for the whole page. */
export function Shell() {
  return <InboxProvider><ShellBody /></InboxProvider>;
}
