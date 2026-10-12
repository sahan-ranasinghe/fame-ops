import { lazy, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router";
import { More } from "../screens/More";
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
      { path: "tasks", element: <Tasks /> },
      { path: "requests", element: <Requests /> },
      { path: "more", element: <More /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
