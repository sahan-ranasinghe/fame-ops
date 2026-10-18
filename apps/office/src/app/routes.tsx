import type { Permission } from "@fleet/permissions";
import { lazy, type ReactNode, Suspense } from "react";
import { Navigate, type RouteObject } from "react-router";
import { DriverForm } from "../screens/DriverForm";
import { DriverManage } from "../screens/DriverManage";
import { DriverPage } from "../screens/DriverPage";
import { Drivers } from "../screens/Drivers";
import { DutyLog } from "../screens/DutyLog";
import { MoveVehicle } from "../screens/MoveVehicle";
import { Live } from "../screens/Live";
import { Maintenance } from "../screens/Maintenance";
import { Fuel } from "../screens/Fuel";
import { FuelDetail } from "../screens/FuelDetail";
import { Mileage } from "../screens/Mileage";
import { More } from "../screens/More";
import { NewRequest } from "../screens/NewRequest";
import { NewTask } from "../screens/NewTask";
import { NoAccess } from "../screens/NoAccess";
import { Overview } from "../screens/Overview";
import { PlacePage } from "../screens/PlacePage";
import { Places } from "../screens/Places";
import { Projects } from "../screens/Projects";
import { Reminders } from "../screens/Reminders";
import { RequestDecide } from "../screens/RequestDecide";
import { RequestDetail } from "../screens/RequestDetail";
import { RequestEdit } from "../screens/RequestEdit";
import { Requests } from "../screens/Requests";
import { TaskDetail } from "../screens/TaskDetail";
import { TaskEdit } from "../screens/TaskEdit";
import { TaskHistory } from "../screens/TaskHistory";
import { Tasks } from "../screens/Tasks";
import { TaskStops } from "../screens/TaskStops";
import { FleetSettings } from "../screens/settings/FleetSettings";
import { MyProfile } from "../screens/settings/MyProfile";
import { UserForm } from "../screens/settings/UserForm";
import { UserManage } from "../screens/settings/UserManage";
import { Users } from "../screens/settings/Users";
import { VehicleDetail } from "../screens/VehicleDetail";
import { VehicleForm } from "../screens/VehicleForm";
import { Vehicles } from "../screens/Vehicles";
import { can } from "../transport/types";
import { useFleet } from "./FleetContext";
import { DUTY_NEED, ROUTES_NEED, ISSUES_NEED } from "./nav";
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
const Notifications = lazy(() => import("../screens/settings/Notifications"));
// The site import reads spreadsheets with SheetJS in the browser: web build, loaded on demand.
const ImportSites = __BUILD__ === "web" ? lazy(() => import("../screens/settings/ImportSites")) : null;
function ImportRoute() {
  if (!ImportSites) return <div className="card card-b">The site import reads a spreadsheet in your browser: open the Fame Fleet web app for it. Claude can import rows with the import_places tool.</div>;
  return <Suspense fallback={<div className="loading">Opening the import…</div>}><ImportSites /></Suspense>;
}
function SettingsRoute() {
  return <Suspense fallback={<div className="loading">Opening settings…</div>}><SettingsHome /></Suspense>;
}

const VR: Permission[] = ["view", "request"];
const RA: Permission[] = ["request", "approve"];

/**
 * Every form is a page with its own URL; a detail is a child route of its list
 * (a panel beside the list on a desktop, a full screen on a phone). A static
 * segment such as /requests/new outranks /requests/:id in react-router.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Home /> },
      { path: "live", element: <Guard need={["view"]}><Live /></Guard> },
      {
        path: "tasks",
        element: <Guard need={["assign_tasks"]}><Tasks /></Guard>,
        children: [{ path: ":id", element: <TaskDetail /> }],
      },
      { path: "tasks/new", element: <Guard need={["assign_tasks"]}><NewTask /></Guard> },
      // Phase 7 (§8): Tasks → History (list_tasks); a static segment outranks the board's /tasks/:id.
      { path: "tasks/history", element: <Guard need={["assign_tasks"]}><TaskHistory /></Guard> },
      { path: "tasks/:id/edit", element: <Guard need={["assign_tasks"]}><TaskEdit /></Guard> },
      { path: "tasks/:id/stops", element: <Guard need={["assign_tasks"]}><TaskStops /></Guard> },
      // Phase 7 (§16): the Overview's "Reminders due" as a page (the same permission as the Overview's block).
      { path: "reminders", element: <Guard need={ISSUES_NEED}><Reminders /></Guard> },
      // Phase 7 (§9): an issue is a child of the list (a panel beside it on a desktop, a full page on a phone).
      {
        path: "issues",
        element: <Guard need={ISSUES_NEED}><Suspense fallback={<div className="loading">Opening issues…</div>}><Issues /></Suspense></Guard>,
        children: [{ path: ":id", element: <Suspense fallback={<div className="loading">Opening the issue…</div>}><IssuePage /></Suspense> }],
      },
      {
        path: "requests",
        element: <Guard need={VR}><Requests /></Guard>,
        children: [{ path: ":id", element: <RequestDetail /> }],
      },
      { path: "requests/new", element: <Guard need={RA}><NewRequest /></Guard> },
      { path: "requests/:id/decide", element: <Guard need={["approve"]}><RequestDecide /></Guard> },
      { path: "requests/:id/edit", element: <Guard need={RA}><RequestEdit /></Guard> },
      {
        path: "vehicles",
        element: <Guard need={["view"]}><Vehicles /></Guard>,
        children: [{ path: ":reg", element: <VehicleDetail /> }],
      },
      { path: "vehicles/new", element: <Guard need={["vehicles"]}><VehicleForm /></Guard> },
      { path: "vehicles/:reg/edit", element: <Guard need={["vehicles"]}><VehicleForm /></Guard> },
      { path: "projects", element: <Guard need={VR}><Projects /></Guard> },
      { path: "maintenance", element: <Guard need={["vehicles"]}><Maintenance /></Guard> },
      { path: "mileage", element: <Guard need={["vehicles"]}><Mileage /></Guard> },
      {
        path: "fuel",
        element: <Guard need={["vehicles"]}><Fuel /></Guard>,
        children: [{ path: ":id", element: <FuelDetail /> }],
      },
      {
        path: "places",
        element: <Guard need={["vehicles"]}><Places /></Guard>,
        children: [{ path: ":id", element: <PlacePage /> }],
      },
      { path: "drivers", element: <Guard need={["view"]}><Drivers /></Guard> },
      { path: "drivers/new", element: <Guard need={["vehicles"]}><DriverForm /></Guard> },
      // Phase 7: the duty log and the office's "Move to vehicle" (a static segment outranks :username).
      { path: "drivers/duty", element: <Guard need={DUTY_NEED}><DutyLog /></Guard> },
      { path: "drivers/:username/vehicle", element: <Guard need={DUTY_NEED}><MoveVehicle /></Guard> },
      { path: "drivers/:username", element: <Guard need={ROUTES_NEED}><DriverPage /></Guard> },
      { path: "drivers/:username/edit", element: <Guard need={["vehicles"]}><DriverManage /></Guard> },
      { path: "settings", element: <SettingsRoute /> },
      // Hotfix 2 (F): everyone's own page (their phone number).
      { path: "settings/profile", element: <MyProfile /> },
      { path: "settings/users", element: <Guard need={["users"]}><Users /></Guard> },
      { path: "settings/users/new", element: <Guard need={["users"]}><UserForm /></Guard> },
      { path: "settings/users/:email/edit", element: <Guard need={["users"]}><UserManage /></Guard> },
      { path: "settings/fleet", element: <Guard need={["users"]}><FleetSettings /></Guard> },
      { path: "settings/import-sites", element: <Guard need={["vehicles"]}><ImportRoute /></Guard> },
      { path: "settings/notifications", element: <Suspense fallback={<div className="loading">Opening notifications…</div>}><Notifications /></Suspense> },
      { path: "accounts", element: <Navigate to="/settings/users" replace /> },
      { path: "more", element: <More /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
