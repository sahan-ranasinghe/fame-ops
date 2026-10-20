// Office mode (Phase 8, O1): what a signed-in office person gets, by permission and never by a role name
// (docs/phase8-plan.md section 1): the bottom tabs (4–5, More last), the Home sections and the More list. Pure, so
// scripts/test-office.ts checks every preset and the odd sets.
//
// The designs (02–05, 19) show a Drivers tab for approvers and dispatchers: the Drivers board is not built in O1, so the
// tab would be dead UI and is not shown (Alerts takes its place until the board comes). The trip editor (New request,
// Assign a task: 06–09) is round O2: Home has no big action button yet.

import type { Permission } from './permissions';

export type TabKey = 'home' | 'approve' | 'tasks' | 'drivers' | 'live' | 'trips' | 'alerts' | 'more';

export interface Tab {
  key: TabKey;
  /** The i18n key of its label. */
  label: string;
  need: readonly Permission[];
}

const HOME: Tab = { key: 'home', label: 'office.tabs.home', need: [] };
const APPROVE: Tab = { key: 'approve', label: 'office.tabs.approve', need: ['approve'] };
const TASKS: Tab = { key: 'tasks', label: 'office.tabs.tasks', need: ['assign_tasks'] };
/** O2: the Drivers board (design 12), on the bar of approvers and dispatchers as designs 02, 03, 12 and 15 show it. */
const DRIVERS: Tab = { key: 'drivers', label: 'office.tabs.drivers', need: ['approve', 'assign_tasks'] };
const LIVE: Tab = { key: 'live', label: 'office.tabs.live', need: ['view'] };
const TRIPS: Tab = { key: 'trips', label: 'office.tabs.trips', need: ['request'] };
const ALERTS: Tab = { key: 'alerts', label: 'office.tabs.alerts', need: [] };
const MORE: Tab = { key: 'more', label: 'office.tabs.more', need: [] };

/** At most this many tabs; the last is always More (the hub with My profile and Sign out). */
export const TAB_COUNT = 5;

export const has = (permissions: readonly string[], ...any: readonly Permission[]): boolean => any.length === 0 || any.some((p) => permissions.includes(p));

/**
 * The bottom bar: Home, then (by the designs) Approve · Live · Drivers for approvers, Tasks · Live · Drivers for
 * dispatchers (O2: Drivers on the bar, Alerts under More and the bell on every header), My trips · Live · Alerts for
 * requesters, Live for everyone who sees the fleet, Alerts, then More. Never a tab the person may not use, never one twice.
 */
export function tabsFor(permissions: readonly string[]): Tab[] {
  const order: Tab[] = has(permissions, 'approve') ? [APPROVE, LIVE, DRIVERS, ALERTS] : has(permissions, 'assign_tasks') ? [TASKS, LIVE, DRIVERS, ALERTS] : [TRIPS, LIVE, ALERTS];
  const picked: Tab[] = [HOME];
  for (const tab of [...order, TRIPS, LIVE, ALERTS]) {
    if (picked.length >= TAB_COUNT - 1) break;
    if (!has(permissions, ...tab.need) || picked.some((p) => p.key === tab.key)) continue;
    picked.push(tab);
  }
  return [...picked, MORE];
}

export type HomeSection = 'requests' | 'needs_driver' | 'critical' | 'tasks' | 'road' | 'trips';

/** O2: Home's big actions (designs 02–04): Assign a task with assign_tasks, Request a vehicle with request. */
export type HomeAction = 'assign' | 'request';
export function homeActions(permissions: readonly string[]): HomeAction[] {
  const out: HomeAction[] = [];
  if (has(permissions, 'assign_tasks')) out.push('assign');
  if (has(permissions, 'request')) out.push('request');
  return out;
}

/** Home's sections (designs 02–05), in their order, each shown when the person holds what it needs. */
export const HOME_SECTIONS: { key: HomeSection; need: readonly Permission[] }[] = [
  { key: 'requests', need: ['approve'] },
  { key: 'needs_driver', need: ['approve', 'assign_tasks'] },
  { key: 'critical', need: ['issues'] },
  { key: 'tasks', need: ['assign_tasks'] },
  { key: 'road', need: ['view'] },
  { key: 'trips', need: ['request'] },
];

export const homeSections = (permissions: readonly string[]): HomeSection[] =>
  HOME_SECTIONS.filter((s) => has(permissions, ...s.need)).map((s) => s.key);

/** Home's header chips (design 03, 04): on the road and free for everyone; waiting for OK with approve; in garage with vehicles or issues. */
export type HomeChip = 'road' | 'free' | 'waiting' | 'garage';

export function homeChips(permissions: readonly string[]): HomeChip[] {
  const chips: HomeChip[] = ['road', 'free'];
  if (has(permissions, 'approve')) chips.push('waiting');
  if (has(permissions, 'vehicles', 'issues')) chips.push('garage');
  return chips;
}

export type MoreItem = 'tasks' | 'approve' | 'drivers' | 'asks' | 'trips' | 'alerts' | 'issues' | 'vehicles' | 'reports' | 'people_drivers' | 'people_users' | 'settings';

/** What More lists under Work: the screens built so far that are not on the bar. */
export function moreFor(permissions: readonly string[]): MoreItem[] {
  const onBar = new Set<string>(tabsFor(permissions).map((t) => t.key));
  const all: { key: MoreItem; need: readonly Permission[] }[] = [
    { key: 'approve', need: ['approve'] },
    { key: 'tasks', need: ['assign_tasks'] },
    { key: 'drivers', need: ['approve', 'assign_tasks'] },
    { key: 'trips', need: ['request'] },
    { key: 'issues', need: ['issues', 'assign_tasks'] },
    // Stage 1 (O3 item 7): the questions asked to drivers in the last 7 days.
    { key: 'asks', need: ['approve', 'assign_tasks'] },
    { key: 'alerts', need: [] },
    // O2 item 7 (design 19): management by permission. Vehicles with view (plan section 2: the list and the page are
    // read; Register / Edit by their tools), Reports with vehicles or assign_tasks (the duty log); Drivers' management
    // with users or vehicles (decision 1); office users and the quick settings with users.
    { key: 'vehicles', need: ['view'] },
    { key: 'reports', need: ['vehicles', 'assign_tasks'] },
    { key: 'people_drivers', need: ['users', 'vehicles'] },
    { key: 'people_users', need: ['users'] },
    { key: 'settings', need: ['users'] },
  ];
  return all.filter((i) => has(permissions, ...i.need) && !onBar.has(i.key)).map((i) => i.key);
}

/** More's sections (design 19): Work (the screens), People (drivers, office users), then Quick settings. */
export type MoreSection = 'work' | 'people' | 'settings';
export const MORE_SECTION: Record<MoreItem, MoreSection> = {
  approve: 'work', tasks: 'work', drivers: 'work', asks: 'work', trips: 'work', issues: 'work', alerts: 'work', vehicles: 'work', reports: 'work',
  people_drivers: 'people', people_users: 'people', settings: 'settings',
};

/** A notification's link on the site (InboxItem.url) → the office screen in the app, or null when O1 has no such screen. */
export function routeForUrl(url: string | undefined, permissions: readonly string[]): string | null {
  if (!url) return null;
  // The site's query form (/tasks?task=<id>): a push tap on the site opens that task.
  const q = url.match(/[?&]task=([0-9a-f-]{36})/);
  if (q) return has(permissions, 'assign_tasks') ? `/office/task/${q[1]}` : null;
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];
  let m = path.match(/^\/requests\/([0-9a-f-]{36})(?:\/decide)?$/);
  if (m) return has(permissions, 'approve') ? `/office/request/${m[1]}` : has(permissions, 'request') ? '/office/(tabs)/trips' : null;
  m = path.match(/^\/tasks\/([0-9a-f-]{36})\/edit$/);
  if (m) return has(permissions, 'assign_tasks') ? `/office/task/${m[1]}/driver` : null;
  m = path.match(/^\/tasks\/([0-9a-f-]{36})/);
  if (m) return has(permissions, 'assign_tasks') ? `/office/task/${m[1]}` : null;
  if (path === '/tasks' || path.startsWith('/tasks?')) return has(permissions, 'assign_tasks') ? '/office/(tabs)/tasks' : null;
  if (path === '/requests') return has(permissions, 'approve') ? '/office/(tabs)/approve' : null;
  if (path === '/my-trips') return has(permissions, 'request') ? '/office/(tabs)/trips' : null;
  if (path === '/live' || path.startsWith('/live?')) return has(permissions, 'view') ? '/office/(tabs)/live' : null;
  // Stage 1 item 2: the site's home (a "needs a driver" push links to /) opens Home.
  if (path === '/' || path === '') return '/office';
  // An answer to a question the office asked (/drivers/asks/<id>): the question's page.
  m = path.match(/^\/drivers\/asks\/([0-9a-f-]{36})$/);
  if (m) return has(permissions, 'approve', 'assign_tasks') ? `/office/asks/${m[1]}` : null;
  if (path === '/drivers/asks') return has(permissions, 'approve', 'assign_tasks') ? '/office/asks' : null;
  // O2: the Drivers board and a driver's page (the site's /drivers/board, /drivers/<username>).
  if (path === '/drivers/board' || path === '/drivers' || path === '/drivers/ask') return has(permissions, 'approve', 'assign_tasks') ? '/office/(tabs)/drivers' : null;
  m = path.match(/^\/drivers\/([A-Za-z0-9._-]+)$/);
  if (m) return has(permissions, 'approve', 'assign_tasks') ? `/office/driver/${m[1]}` : null;
  // O2: the issues centre (issue.opened / issue.assigned link to the issue; the site's list).
  m = path.match(/^\/issues\/([0-9a-f-]{36})/);
  if (m) return has(permissions, 'issues', 'assign_tasks') ? `/office/issues/${m[1]}` : null;
  if (path === '/issues') return has(permissions, 'issues', 'assign_tasks') ? '/office/issues' : null;
  return null;
}
