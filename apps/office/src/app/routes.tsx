import { lazy, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router";
import { Accounts } from "../screens/Accounts";
import { DriverPage } from "../screens/DriverPage";
import { Drivers } from "../screens/Drivers";
import { Live } from "../screens/Live";
import { Maintenance } from "../screens/Maintenance";
import { Mileage } from "../screens/Mileage";
import { More } from "../screens/More";
import { Projects } from "../screens/Projects";
import { Vehicles } from "../screens/Vehicles";
import { Overview } from "../screens/Overview";
import { Requests } from "../screens/Requests";
import { Tasks } from "../screens/Tasks";
import { useFleet } from "./FleetContext";
import { Shell } from "./Shell";

/** Overview when the role may read it; otherwise the first screen it may. */
function Home() {
  const { me } = useFleet();
  if (me.tools.includes("fleet_overview")) return <Overview />;
  if (me.tools.includes("task_board")) return <Navigate to="/tasks" replace />;
  return <Navigate to="/requests" replace />;
}

// Settings (2-step sign-in) talks to Supabase Auth: web build only, loaded on demand.
const Settings = __BUILD__ === "web" ? lazy(() => import("../screens/Settings")) : null;
function SettingsRoute() {
  if (!Settings) return <Navigate to="/more" replace />;
  return <Suspense fallback={<div className="loading">Opening settings…</div>}><Settings /></Suspense>;
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: "live", element: <Live /> },
      { path: "tasks", element: <Tasks /> },
      { path: "requests", element: <Requests /> },
      { path: "vehicles", element: <Vehicles /> },
      { path: "projects", element: <Projects /> },
      { path: "maintenance", element: <Maintenance /> },
      { path: "mileage", element: <Mileage /> },
      { path: "drivers", element: <Drivers /> },
      { path: "drivers/:username", element: <DriverPage /> },
      { path: "accounts", element: <Accounts /> },
      { path: "more", element: <More /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
