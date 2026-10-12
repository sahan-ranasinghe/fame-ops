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
  { key: "tasks", label: "Tasks", tool: "task_board", path: "/tasks" },
  { key: "requests", label: "Requests", tool: "list_requests", path: "/requests" },
];

/** Phone tab bar: Home, Tasks, Requests, More. */
export const TABS: NavItem[] = [
  { key: "overview", label: "Home", tool: "fleet_overview", path: "/" },
  { key: "tasks", label: "Tasks", tool: "task_board", path: "/tasks" },
  { key: "requests", label: "Requests", tool: "list_requests", path: "/requests" },
  { key: "more", label: "More", tool: "", path: "/more" },
];

export const LATER = ["Live locations", "Vehicles", "Projects", "Maintenance", "Mileage", "Drivers"];

export const allowed = (items: NavItem[], tools: string[]) => items.filter((n) => !n.tool || tools.includes(n.tool));
