// Settings: the pages under it (Users, later Fleet and Notifications), each
// locked when the person lacks its permission, and on the web the sign-in and
// security cards (2-step sign-in, password).
import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { LOCK_HINT, navState, SETTINGS_PAGES } from "../../app/nav";
import { Notice } from "../../ui/basics";
import { Icon } from "../../ui/icons";

const SecurityCard = __BUILD__ === "web" ? lazy(() => import("./SecurityCard")) : null;

const PAGE_TEXT: Record<string, string> = {
  users: "Office users, their permissions, set-password links, connector keys",
  fleet: "Dispatch defaults: minutes at stops, the buffer, the base place, rush hour, the routing provider's usage",
};

export default function SettingsHome() {
  const { me, signOut } = useFleet();
  const pages = navState(SETTINGS_PAGES, me);
  return (
    <section className="view" data-testid="settings">
      <div className="ph"><div><div className="eyebrow">{signOut ? "Sign-in, security and the office" : "The office"}</div><h1>Settings</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="more-list">
          {pages.map((p) => (
            <Link key={p.key} to={p.path} className={p.locked ? "locked" : undefined} aria-disabled={p.locked || undefined} title={p.locked ? LOCK_HINT : undefined}>
              <Icon name={p.key === "fleet" ? "settings" : "accounts"} />
              <span className="grow">{p.label}<span className="sub" style={{ display: "block", fontWeight: 400 }}>{PAGE_TEXT[p.key]}</span></span>
              {p.locked && <i className="lock"><Icon name="lock" /></i>}
            </Link>
          ))}
        </div>
        {signOut && SecurityCard && <Suspense fallback={<div className="loading">Checking…</div>}><SecurityCard /></Suspense>}
        {!signOut && <Notice tone="info">Sign-in and security settings (password, 2-step sign-in) are on the web app.</Notice>}
      </div>
    </section>
  );
}
