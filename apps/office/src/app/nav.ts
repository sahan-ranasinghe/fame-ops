// The screens, in the order of the boss's design, each with the permission it
// needs (any one of the list; an empty list = everyone). View is the narrow
// one: the overview counts and who is on the road, live locations, the drivers
// list, the vehicles board, one's own requests. Tasks need assign_tasks;
// Maintenance and Mileage need vehicles; the driver page (routes) needs
// assign_tasks or vehicles. A screen the person
// may not open stays in the menu, greyed with a lock: the server refuses the
// tools either way, and a direct URL shows the "No access" page.
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
  { key: "drivers", label: "Drivers", need: ["view"], path: "/drivers" },
  { key: "settings", label: "Settings", need: [], path: "/settings" },
];

/** Phone tab bar (the boss's design): Home, Map, Tasks, Vehicles, More. Locked tabs are hidden; More always shows. */
export const TABS: NavItem[] = [
  { key: "overview", label: "Home", need: ["view"], path: "/" },
  { key: "live", label: "Map", need: ["view"], path: "/live" },
  { key: "tasks", label: "Tasks", need: ["assign_tasks"], path: "/tasks" },
  { key: "vehicles", label: "Vehicles", need: ["view"], path: "/vehicles" },
  { key: "more", label: "More", need: [], path: "/more" },
];

/** What the More page lists on a phone: everything that is not on the tab bar. */
export const MORE_KEYS = ["issues", "requests", "projects", "maintenance", "mileage", "drivers", "settings"];

/** The driver page (route history) and everything that calls driver_route. */
export const ROUTES_NEED: Permission[] = ["assign_tasks", "vehicles"];

/** The pages under Settings and what they need. */
export const SETTINGS_PAGES: NavItem[] = [
  { key: "users", label: "Users", need: ["users"], path: "/settings/users" },
  { key: "fleet", label: "Fleet", need: ["users"], path: "/settings/fleet" },
];

/** Every item, marked locked when the person lacks all of its permissions. */
export const navState = (items: NavItem[], me: Pick<Me, "permissions">): NavState[] => items.map((n) => ({ ...n, locked: !can(me, ...n.need) }));

/** Only the items the person may open. */
export const allowed = (items: NavItem[], me: Pick<Me, "permissions">): NavItem[] => items.filter((n) => can(me, ...n.need));
