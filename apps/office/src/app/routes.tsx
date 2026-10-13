import type { Permission } from "@fleet/permissions";
import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router";
import { DriverPage } from "../screens/DriverPage";
import { Drivers } from "../screens/Drivers";
import { Live } from "../screens/Live";
import { Maintenance } from "../screens/Maintenance";
import { Mileage } from "../screens/Mileage";
import { More } from "../screens/More";
import { NoAccess } from "../screens/NoAccess";
import { Overview } from "../screens/Overview";
import { Projects } from "../screens/Projects";
import { Requests } from "../screens/Requests";
import { Tasks } from "../screens/Tasks";
import { FleetSettings } from "../screens/settings/FleetSettings";
import { Users } from "../screens/settings/Users";
import { Vehicles } from "../screens/Vehicles";
import { can } from "../transport/types";
import { useFleet } from "./FleetContext";
import { ROUTES_NEED, ISSUES_NEED } from "./nav";
import { Shell } from "./Shell";

/** The screen, or "No access" when the person holds none of the permissions (the server refuses the tools either way). */
function Guard({ need, children }: { need: Permission[]; children: ReactNode }) {
  const { me } = useFleet();
  return can(me, ...need) ? <>{children}</> : <NoAccess need={need} />;
}

/** Overview when the person may see the fleet; otherwise their requests; otherwise Settings. */
function Home() {
  const { me } = useFleet();
  if (can(me, "view")) return <Overview />;
  if (can(me, "request")) return <Navigate to="/requests" replace />;
  return <Navigate to="/settings" replace />;
}

// The Settings home talks to Supabase Auth (2-step sign-in) in the web build: loaded on demand.
const SettingsHome = lazy(() => import("../screens/settings/SettingsHome"));
const Issues = lazy(() => import("../screens/Issues"));
const IssuePage = lazy(() => import("../screens/IssuePage"));
function SettingsRoute() {
  return <Suspense fallback={<div className="loading">Opening settings…</div>}><SettingsHome /></Suspense>;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: "live", element: <Guard need={["view"]}><Live /></Guard> },
      { path: "tasks", element: <Guard need={["assign_tasks"]}><Tasks /></Guard> },
      { path: "issues", element: <Guard need={ISSUES_NEED}><Suspense fallback={<div className="loading">Opening issues…</div>}><Issues /></Suspense></Guard> },
      { path: "issues/:id", element: <Guard need={ISSUES_NEED}><Suspense fallback={<div className="loading">Opening the issue…</div>}><IssuePage /></Suspense></Guard> },
      { path: "requests", element: <Guard need={["view", "request"]}><Requests /></Guard> },
      { path: "vehicles", element: <Guard need={["view"]}><Vehicles /></Guard> },
      { path: "projects", element: <Guard need={["view", "request"]}><Projects /></Guard> },
      { path: "maintenance", element: <Guard need={["vehicles"]}><Maintenance /></Guard> },
      { path: "mileage", element: <Guard need={["vehicles"]}><Mileage /></Guard> },
      { path: "drivers", element: <Guard need={["view"]}><Drivers /></Guard> },
      { path: "drivers/:username", element: <Guard need={ROUTES_NEED}><DriverPage /></Guard> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "settings/users", element: <Guard need={["users"]}><Users /></Guard> },
      { path: "settings/fleet", element: <Guard need={["users"]}><FleetSettings /></Guard> },
      { path: "accounts", element: <Navigate to="/settings/users" replace /> },
      { path: "more", element: <More /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
