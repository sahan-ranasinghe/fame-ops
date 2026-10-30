// Settings: the pages under it (Users, Fleet, Notifications on the web) that
// the person may open, and on the web the sign-in and security cards (2-step
// sign-in, password).
import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useFleet } from "../../app/FleetContext";
import { allowed, SETTINGS_PAGES } from "../../app/nav";
import { Notice } from "../../ui/basics";
import { Icon } from "../../ui/icons";

const SecurityCard = __BUILD__ === "web" ? lazy(() => import("./SecurityCard")) : null;

const PAGE_TEXT: Record<string, string> = {
  profile: "Your phone number, so drivers and requesters can call you",
  users: "Office users, their permissions, set-password links, connector keys",
  fleet: "Dispatch defaults: minutes at stops, the buffer, the base place, rush hour, the routing provider's usage",
  notifications: "What reaches you, pause all, this browser and its sounds",
  retention: "How long notifications, the activity log, locations and other records are kept; Run now",
  "rental-companies": "Who the vehicles are rented from, how many each has; archive one no longer used",
  "recently-deleted": "What was deleted in the last 30 days; restore it before it goes for good",
};

export default function SettingsHome() {
  const { me, signOut } = useFleet();
  const pages = allowed(__BUILD__ === "web" ? SETTINGS_PAGES : SETTINGS_PAGES.filter((p) => p.key !== "notifications"), me)
    // Round 52: Recently deleted only with its tool (the web app's: the connector keeps no delete).
    .filter((p) => p.key !== "recently-deleted" || me.tools.includes("list_bin"));
  return (
    <section className="view" data-testid="settings">
      <div className="ph"><div><div className="eyebrow">{signOut ? "Sign-in, security and the office" : "The office"}</div><h1>Settings</h1></div></div>
      <div className="stack" style={{ maxWidth: 560 }}>
        <div className="more-list">
          {pages.map((p) => (
            <Link key={p.key} to={p.path}>
              <Icon name={p.key === "fleet" ? "settings" : p.key === "notifications" ? "issues" : p.key === "profile" ? "phone" : p.key === "retention" || p.key === "recently-deleted" ? "clock" : p.key === "rental-companies" ? "vehicles" : "accounts"} />
              <span className="grow">{p.label}<span className="sub" style={{ display: "block", fontWeight: 400 }}>{PAGE_TEXT[p.key]}</span></span>
            </Link>
          ))}
        </div>
        {signOut && SecurityCard && <Suspense fallback={<div className="loading">Checking…</div>}><SecurityCard /></Suspense>}
        {!signOut && <Notice tone="info">Sign-in and security settings (password, 2-step sign-in) are on the web app.</Notice>}
      </div>
    </section>
  );
}
