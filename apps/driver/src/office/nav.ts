// Office mode (Phase 8, O1): what a signed-in office person gets, by permission and never by a role name
// (docs/phase8-plan.md section 1): the bottom tabs (4–5, More last), the Home sections and the More list. Pure, so
// scripts/test-office.ts checks every preset and the odd sets.
//
// The designs (02–05, 19) show a Drivers tab for approvers and dispatchers: the Drivers board is not built in O1, so the
// tab would be dead UI and is not shown (Alerts takes its place until the board comes). The trip editor (New request,
// Assign a task: 06–09) is round O2: Home has no big action button yet.

import type { Permission } from './permissions';

export type TabKey = 'home' | 'approve' | 'tasks' | 'live' | 'trips' | 'alerts' | 'more';

export interface Tab {
  key: TabKey;
  /** The i18n key of its label. */
  label: string;
  need: readonly Permission[];
}

const HOME: Tab = { key: 'home', label: 'office.tabs.home', need: [] };
const APPROVE: Tab = { key: 'approve', label: 'office.tabs.approve', need: ['approve'] };
const TASKS: Tab = { key: 'tasks', label: 'office.tabs.tasks', need: ['assign_tasks'] };
const LIVE: Tab = { key: 'live', label: 'office.tabs.live', need: ['view'] };
const TRIPS: Tab = { key: 'trips', label: 'office.tabs.trips', need: ['request'] };
const ALERTS: Tab = { key: 'alerts', label: 'office.tabs.alerts', need: [] };
const MORE: Tab = { key: 'more', label: 'office.tabs.more', need: [] };

/** At most this many tabs; the last is always More (the hub with My profile and Sign out). */
export const TAB_COUNT = 5;

export const has = (permissions: readonly string[], ...any: readonly Permission[]): boolean => any.length === 0 || any.some((p) => permissions.includes(p));

/**
 * The bottom bar: Home, then (by the designs) Approve for approvers, Tasks for dispatchers, My trips for requesters, Live
 * for everyone who sees the fleet, Alerts, then More. Never a tab the person may not use, never one twice.
 */
export function tabsFor(permissions: readonly string[]): Tab[] {
  const order: Tab[] = has(permissions, 'approve') ? [APPROVE, LIVE, ALERTS] : has(permissions, 'assign_tasks') ? [TASKS, LIVE, ALERTS] : [TRIPS, LIVE, ALERTS];
  const picked: Tab[] = [HOME];
  for (const tab of [...order, TRIPS, LIVE, ALERTS]) {
    if (picked.length >= TAB_COUNT - 1) break;
    if (!has(permissions, ...tab.need) || picked.some((p) => p.key === tab.key)) continue;
    picked.push(tab);
  }
  return [...picked, MORE];
}

export type HomeSection = 'requests' | 'needs_driver' | 'critical' | 'tasks' | 'road' | 'trips';

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

export type MoreItem = 'tasks' | 'approve' | 'trips' | 'alerts';

/** What More lists under Work: the screens built in O1 that are not on the bar. */
export function moreFor(permissions: readonly string[]): MoreItem[] {
  const onBar = new Set(tabsFor(permissions).map((t) => t.key));
  const all: { key: MoreItem; need: readonly Permission[] }[] = [
    { key: 'approve', need: ['approve'] },
    { key: 'tasks', need: ['assign_tasks'] },
    { key: 'trips', need: ['request'] },
    { key: 'alerts', need: [] },
  ];
  return all.filter((i) => has(permissions, ...i.need) && !onBar.has(i.key)).map((i) => i.key);
}

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
  return null;
}
