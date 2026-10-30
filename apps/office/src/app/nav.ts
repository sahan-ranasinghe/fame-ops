// The screens, in the order of the boss's design, each with the permission it
// needs (any one of the list; an empty list = everyone). View is the narrow
// one: the overview counts and who is on the road, live locations, the drivers
// list, the vehicles board, one's own requests. Tasks need assign_tasks;
// Maintenance and Mileage need vehicles; the driver page (routes) needs
// assign_tasks or vehicles. Since Phase 6 a screen the person may not open is
// not in the menu at all (a direct URL shows the "No access" page; the server
// refuses the tools either way). Hotfix 3 (L5): the desktop menu in sections
// (Today · Fleet · Reports · Admin), each collapsible; the phone's bottom bar
// holds the four most used screens for the person's role, then More.
import type { Permission } from "@fleet/permissions";
import { can, type Me } from "../transport/types";
import { type FeatureKey, pageSwitchedOn } from "../screens/switchLogic";

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

/** The issues centre and its count: everything with issues, the task kinds with assign_tasks. */
export const ISSUES_NEED: Permission[] = ["issues", "assign_tasks"];

/** Hotfix 2 (A): My trips (my_trips): the requests and proposed tasks a person made, for request or assign_tasks. */
export const TRIPS_NEED: Permission[] = ["request", "assign_tasks"];

/** Part 3b (H5): the Drivers board (drivers_board), and who adds or changes when a driver is not available. */
export const BOARD_NEED: Permission[] = ["approve", "assign_tasks"];

/** Every screen of the menu, in the menu's order (its sections below). */
export const NAV: NavItem[] = [
  // Today
  { key: "overview", label: "Overview", need: ["view"], path: "/" },
  { key: "live", label: "Live locations", need: ["view"], path: "/live" },
  { key: "tasks", label: "Tasks", need: ["assign_tasks"], path: "/tasks" },
  { key: "requests", label: "Requests", need: ["view", "request"], path: "/requests" },
  { key: "my_trips", label: "My trips", need: TRIPS_NEED, path: "/my-trips" },
  { key: "issues", label: "Issues", need: ISSUES_NEED, path: "/issues" },
  { key: "drivers_board", label: "Drivers board", need: BOARD_NEED, path: "/drivers/board" },
  // Round 4–7 (7): a day per driver or per vehicle, each booking with its holder (day_timeline: view).
  { key: "timeline", label: "Timeline", need: ["view"], path: "/schedule" },
  // Fleet
  { key: "vehicles", label: "Vehicles", need: ["view"], path: "/vehicles" },
  { key: "drivers", label: "Drivers", need: ["view"], path: "/drivers" },
  { key: "places", label: "Places", need: ["vehicles"], path: "/places" },
  { key: "maintenance", label: "Maintenance", need: ["vehicles"], path: "/maintenance" },
  // Reports
  { key: "mileage", label: "Mileage", need: ["vehicles"], path: "/mileage" },
  { key: "fuel", label: "Fuel", need: ["vehicles"], path: "/fuel" },
  { key: "duty", label: "Duty log", need: DUTY_NEED, path: "/drivers/duty" },
  // Admin
  { key: "projects", label: "Projects", need: ["view", "request"], path: "/projects" },
  { key: "settings", label: "Settings", need: [], path: "/settings" },
];

/** Hotfix 3 (L5): the desktop menu's sections, each collapsible (prefs.menu_collapsed holds the collapsed keys). */
export type NavSectionKey = "today" | "fleet" | "reports" | "admin";

export interface NavSection {
  key: NavSectionKey;
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: { key: NavSectionKey; label: string; keys: string[] }[] = [
  { key: "today", label: "Today", keys: ["overview", "live", "tasks", "requests", "my_trips", "issues", "drivers_board", "timeline"] },
  { key: "fleet", label: "Fleet", keys: ["vehicles", "drivers", "places", "maintenance"] },
  { key: "reports", label: "Reports", keys: ["mileage", "fuel", "duty"] },
  { key: "admin", label: "Admin", keys: ["projects", "settings"] },
];

/** The menu's sections with only what the person may open, in NAV's order; a section with nothing in it is left out. */
export function menuFor(me: Pick<Me, "permissions">): NavSection[] {
  // Round 2b (Gmail / Drive / GitHub): Settings is in the profile menu under the person's name, never twice in the rail.
  const mine = allowed(NAV, me).filter((n) => n.key !== "settings");
  return NAV_SECTIONS
    .map((s) => ({ key: s.key, label: s.label, items: mine.filter((n) => s.keys.includes(n.key)) }))
    .filter((s) => s.items.length > 0);
}

/** At most this many tabs on a phone, the last one always More. */
export const TAB_COUNT = 5;

/**
 * Hotfix 3 (L5): the phone's bottom bar is Home, the most used screens for the person's role, then More. The role is
 * read from the permissions: approve = an approver, else assign_tasks = a dispatcher, else request = a requester, else
 * a viewer. A role's tab the person may not open is skipped and the bar is filled from TAB_FILL, in order. Items sharing
 * a `slot` take one tab between them: an approver keeps the queue there and finds My trips under More.
 */
export type TabRole = "approver" | "dispatcher" | "requester" | "viewer";

export const TABS: Record<string, NavItem & { slot?: string }> = {
  requests: { key: "requests", label: "Requests", need: ["approve"], path: "/requests", slot: "requests" },
  tasks: { key: "tasks", label: "Tasks", need: ["assign_tasks"], path: "/tasks" },
  my_trips: { key: "my_trips", label: "My trips", need: ["request"], path: "/my-trips", slot: "requests" },
  live: { key: "live", label: "Live", need: ["view"], path: "/live" },
  vehicles: { key: "vehicles", label: "Vehicles", need: ["view"], path: "/vehicles" },
  issues: { key: "issues", label: "Issues", need: ISSUES_NEED, path: "/issues" },
  drivers: { key: "drivers", label: "Drivers", need: ["view"], path: "/drivers" },
};

/** Each role's tabs after Home (Sahan's defaults, Hotfix 3 question 6). */
export const ROLE_TABS: Record<TabRole, string[]> = {
  approver: ["requests", "tasks", "live"],
  dispatcher: ["tasks", "live", "issues"],
  requester: ["my_trips", "vehicles", "live"],
  viewer: ["live", "vehicles", "drivers"],
};

/** What fills the bar when a role's own tabs are not all open to the person (mixed permissions). */
export const TAB_FILL = ["requests", "tasks", "my_trips", "live", "issues", "vehicles", "drivers"];

export function tabRole(me: Pick<Me, "permissions">): TabRole {
  if (can(me, "approve")) return "approver";
  if (can(me, "assign_tasks")) return "dispatcher";
  if (can(me, "request")) return "requester";
  return "viewer";
}

export const HOME_TAB: NavItem = { key: "overview", label: "Home", need: [], path: "/" };
export const MORE_TAB: NavItem = { key: "more", label: "More", need: [], path: "/more" };

export function tabsFor(me: Pick<Me, "permissions">): NavItem[] {
  const picked: NavItem[] = [HOME_TAB];
  const slots = new Set<string>();
  for (const key of [...ROLE_TABS[tabRole(me)], ...TAB_FILL]) {
    if (picked.length >= TAB_COUNT - 1) break;
    const tab = TABS[key];
    if (!tab) continue;
    const { slot, ...t } = tab;
    const s = slot ?? t.key;
    if (!can(me, ...t.need) || slots.has(s) || picked.some((p) => p.key === t.key)) continue;
    slots.add(s);
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
  // Round 4–7 (7): the asks for a busy driver or vehicle (holder_asks: everyone's own; a desktop opens it from the
  // Timeline, a task page and the notifications). Not listed while the switch holder_contact is off (switchLogic PAGE_SWITCH).
  { key: "holder_asks", label: "Asks", need: ["request", "approve", "assign_tasks"], path: "/tasks/asks", after: "timeline" },
];

/** NAV with the sub-pages in place, for the More list. */
const MORE_ORDER: NavItem[] = NAV.flatMap((n) => [n, ...SUB_PAGES.filter((s) => s.after === n.key).map(({ after: _after, ...s }) => s)]);

/**
 * What the More page lists on a phone: every screen the person may open that is not on the tab bar. On a desktop the rail
 * has them all. `off`: the feature switches saved off (Round 4–7): a page one of them turns off is not listed (Asks with
 * holder_contact off).
 */
export function moreFor(me: Pick<Me, "permissions">, off: readonly FeatureKey[] = []): NavItem[] {
  const onBar = new Set(tabsFor(me).map((t) => t.key));
  return allowed(MORE_ORDER, me).filter((n) => !onBar.has(n.key) && pageSwitchedOn(n.key, off));
}

/** The driver page (route history) and everything that calls driver_route. */
export const ROUTES_NEED: Permission[] = ["assign_tasks", "vehicles"];

/** The pages under Settings and what they need. */
export const SETTINGS_PAGES: NavItem[] = [
  // Hotfix 2 (F): everyone's own phone number.
  { key: "profile", label: "My profile", need: [], path: "/settings/profile" },
  { key: "users", label: "Users", need: ["users", "office_users"], path: "/settings/users" },
  { key: "fleet", label: "Fleet", need: ["users"], path: "/settings/fleet" },
  { key: "import-sites", label: "Import sites", need: ["vehicles"], path: "/settings/import-sites" },
  // Round 52: the rental companies with their vehicles, Archive / Restore, + Add.
  { key: "rental-companies", label: "Rental companies", need: ["vehicles"], path: "/settings/rental-companies" },
  // Hotfix O2-H2: the app's crash reports (list_app_errors).
  { key: "app-errors", label: "App errors", need: ["users"], path: "/settings/app-errors" },
  // Round 2b: the Activity log (office_audit's changes).
  { key: "activity", label: "Activity log", need: ["users"], path: "/settings/activity" },
  // Round 4–7 (item 9): how long each kind of data is kept, and Run now.
  { key: "retention", label: "Data retention", need: ["users"], path: "/settings/retention" },
  // Round 52: Recently deleted (the bin: 30 days, Restore).
  { key: "recently-deleted", label: "Recently deleted", need: ["users"], path: "/settings/recently-deleted" },
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
