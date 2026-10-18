// The screens, in the order of the boss's design, each with the permission it
// needs (any one of the list; an empty list = everyone). View is the narrow
// one: the overview counts and who is on the road, live locations, the drivers
// list, the vehicles board, one's own requests. Tasks need assign_tasks;
// Maintenance and Mileage need vehicles; the driver page (routes) needs
// assign_tasks or vehicles. Since Phase 6 a screen the person may not open is
// not in the menu at all (a direct URL shows the "No access" page; the server
// refuses the tools either way).
import type { Permission } from "@fleet/permissions";
import { can, type Me } from "../transport/types";

export interface NavItem {
  key: string;
  label: string;
  need: Permission[];
  path: string;
}

export interface NavState extends NavItem {
  locked: boolean;
}

export const LOCK_HINT = "Ask an admin for access";

/** Phase 7: the duty log, the office's clock-out and "Move to vehicle" (duty_log, clock_out_driver, move_driver_vehicle). */
export const DUTY_NEED: Permission[] = ["assign_tasks", "vehicles"];

/** The issues centre and the bell: everything with issues, the task kinds with assign_tasks. */
export const ISSUES_NEED: Permission[] = ["issues", "assign_tasks"];

export const NAV: NavItem[] = [
  { key: "overview", label: "Overview", need: ["view"], path: "/" },
  { key: "live", label: "Live locations", need: ["view"], path: "/live" },
  { key: "tasks", label: "Tasks", need: ["assign_tasks"], path: "/tasks" },
  { key: "issues", label: "Issues", need: ISSUES_NEED, path: "/issues" },
  { key: "requests", label: "Requests", need: ["view", "request"], path: "/requests" },
  { key: "vehicles", label: "Vehicles", need: ["view"], path: "/vehicles" },
  { key: "projects", label: "Projects", need: ["view", "request"], path: "/projects" },
  { key: "maintenance", label: "Maintenance", need: ["vehicles"], path: "/maintenance" },
  { key: "mileage", label: "Mileage", need: ["vehicles"], path: "/mileage" },
  { key: "fuel", label: "Fuel", need: ["vehicles"], path: "/fuel" },
  { key: "places", label: "Places", need: ["vehicles"], path: "/places" },
  { key: "drivers", label: "Drivers", need: ["view"], path: "/drivers" },
  { key: "duty", label: "Duty log", need: DUTY_NEED, path: "/drivers/duty" },
  { key: "settings", label: "Settings", need: [], path: "/settings" },
];

/** At most this many tabs on a phone, the last one always More. */
export const TAB_COUNT = 5;

/**
 * The phone tab bar: Home first, then the first screens of this list the person
 * may open, in this order, until four are filled; More is always the fifth.
 * So a requester gets Home, My requests, Map, Vehicles, More; a fleet admin
 * Home, Requests, Tasks, Map, More; a dispatcher (who may also ask) Home,
 * Tasks, My requests, Map, More; a viewer Home, Map, Vehicles, Drivers, More.
 */
export const TAB_ORDER: NavItem[] = [
  { key: "requests", label: "Requests", need: ["approve"], path: "/requests" },
  { key: "tasks", label: "Tasks", need: ["assign_tasks"], path: "/tasks" },
  { key: "requests", label: "My requests", need: ["request"], path: "/requests" },
  { key: "live", label: "Map", need: ["view"], path: "/live" },
  { key: "vehicles", label: "Vehicles", need: ["view"], path: "/vehicles" },
  { key: "issues", label: "Issues", need: ISSUES_NEED, path: "/issues" },
  { key: "drivers", label: "Drivers", need: ["view"], path: "/drivers" },
];

export const HOME_TAB: NavItem = { key: "overview", label: "Home", need: [], path: "/" };
export const MORE_TAB: NavItem = { key: "more", label: "More", need: [], path: "/more" };

export function tabsFor(me: Pick<Me, "permissions">): NavItem[] {
  const picked: NavItem[] = [HOME_TAB];
  for (const t of TAB_ORDER) {
    if (picked.length >= TAB_COUNT - 1) break;
    if (!can(me, ...t.need) || picked.some((p) => p.key === t.key)) continue;
    picked.push(t);
  }
  return [...picked, MORE_TAB];
}

/**
 * Pages under a section, not in the rail (a desktop opens them from the section's page): the phone's More list shows
 * them right after their section's place. Phase 7 (§8): Tasks → History.
 */
export const SUB_PAGES: (NavItem & { after: string })[] = [
  { key: "task_history", label: "Task history", need: ["assign_tasks"], path: "/tasks/history", after: "tasks" },
];

/** NAV with the sub-pages in place, for the More list. */
const MORE_ORDER: NavItem[] = NAV.flatMap((n) => [n, ...SUB_PAGES.filter((s) => s.after === n.key).map(({ after: _after, ...s }) => s)]);

/** What the More page lists on a phone: every screen the person may open that is not on the tab bar. On a desktop the rail has them all. */
export function moreFor(me: Pick<Me, "permissions">): NavItem[] {
  const onBar = new Set(tabsFor(me).map((t) => t.key));
  return allowed(MORE_ORDER, me).filter((n) => !onBar.has(n.key));
}

/** The driver page (route history) and everything that calls driver_route. */
export const ROUTES_NEED: Permission[] = ["assign_tasks", "vehicles"];

/** The pages under Settings and what they need. */
export const SETTINGS_PAGES: NavItem[] = [
  { key: "users", label: "Users", need: ["users"], path: "/settings/users" },
  { key: "fleet", label: "Fleet", need: ["users"], path: "/settings/fleet" },
  { key: "import-sites", label: "Import sites", need: ["vehicles"], path: "/settings/import-sites" },
  // Web only (the browser's push subscription); the artifact points to the web app.
  { key: "notifications", label: "Notifications", need: [], path: "/settings/notifications" },
];

/** Every item, marked locked when the person lacks all of its permissions. */
export const navState = (items: NavItem[], me: Pick<Me, "permissions">): NavState[] => items.map((n) => ({ ...n, locked: !can(me, ...n.need) }));

/** Only the items the person may open. */
export const allowed = (items: NavItem[], me: Pick<Me, "permissions">): NavItem[] => items.filter((n) => can(me, ...n.need));

/** The one thing this person does most, as the big button on a phone's Home. */
export function homeAction(me: Pick<Me, "permissions">, waiting = 0): { label: string; path: string } | null {
  const has = (p: Permission) => me.permissions.includes(p);
  if (has("approve") && (waiting > 0 || !has("assign_tasks"))) return { label: waiting ? `Requests to approve (${waiting})` : "Requests to approve", path: "/requests" };
  if (has("assign_tasks")) return { label: "Assign a task", path: "/tasks/new" };
  if (has("request")) return { label: "New request", path: "/requests/new" };
  if (has("view")) return { label: "Live locations", path: "/live" };
  return null;
}
