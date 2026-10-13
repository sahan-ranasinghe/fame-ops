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
import { Users } from "../screens/settings/Users";
import { Vehicles } from "../screens/Vehicles";
import { can } from "../transport/types";
import { useFleet } from "./FleetContext";
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
      { path: "tasks", element: <Guard need={["view"]}><Tasks /></Guard> },
      { path: "requests", element: <Guard need={["view", "request"]}><Requests /></Guard> },
      { path: "vehicles", element: <Guard need={["view"]}><Vehicles /></Guard> },
      { path: "projects", element: <Guard need={["view", "request"]}><Projects /></Guard> },
      { path: "maintenance", element: <Guard need={["view"]}><Maintenance /></Guard> },
      { path: "mileage", element: <Guard need={["view"]}><Mileage /></Guard> },
      { path: "drivers", element: <Guard need={["view"]}><Drivers /></Guard> },
      { path: "drivers/:username", element: <Guard need={["view"]}><DriverPage /></Guard> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "settings/users", element: <Guard need={["users"]}><Users /></Guard> },
      { path: "accounts", element: <Navigate to="/settings/users" replace /> },
      { path: "more", element: <More /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
