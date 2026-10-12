// The screens, in the order of the boss's design. A screen is shown only when
// the person's role may call its tool (the server decides either way).
export interface NavItem {
  key: string;
  label: string;
  tool: string;
  path: string;
}

export const NAV: NavItem[] = [
  { key: "overview", label: "Overview", tool: "fleet_overview", path: "/" },
  { key: "live", label: "Live locations", tool: "live_drivers", path: "/live" },
  { key: "tasks", label: "Tasks", tool: "task_board", path: "/tasks" },
  { key: "requests", label: "Requests", tool: "list_requests", path: "/requests" },
  { key: "vehicles", label: "Vehicles", tool: "list_vehicles", path: "/vehicles" },
  { key: "projects", label: "Projects", tool: "find_project", path: "/projects" },
  { key: "maintenance", label: "Maintenance", tool: "list_vehicle_reports", path: "/maintenance" },
  { key: "mileage", label: "Mileage", tool: "mileage_summary", path: "/mileage" },
  { key: "drivers", label: "Drivers", tool: "list_drivers", path: "/drivers" },
  { key: "accounts", label: "Accounts", tool: "list_office_users", path: "/accounts" },
];

/** Phone tab bar (the boss's design): Home, Map, Tasks, Vehicles, More. */
export const TABS: NavItem[] = [
  { key: "overview", label: "Home", tool: "fleet_overview", path: "/" },
  { key: "live", label: "Map", tool: "live_drivers", path: "/live" },
  { key: "tasks", label: "Tasks", tool: "task_board", path: "/tasks" },
  { key: "vehicles", label: "Vehicles", tool: "list_vehicles", path: "/vehicles" },
  { key: "more", label: "More", tool: "", path: "/more" },
];

/** What the More page lists on a phone: everything that is not on the tab bar. */
export const MORE_KEYS = ["requests", "projects", "maintenance", "mileage", "drivers", "accounts"];

export const allowed = (items: NavItem[], tools: string[]) => items.filter((n) => !n.tool || tools.includes(n.tool));
