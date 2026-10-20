// Office mode (Stage 1, O3 row 5): the Overview's lists on the phone, the rules only (pure: no react-native, no i18n).
// The website's (screens/overviewLinks.ts, Phase 7 §16, Hotfix 3 L1–L3) ported to the app's routes:
//   - each header chip opens its list (a phone has no side panel: the full page): on the road → Live, free now and in
//     garage → Vehicles with that filter, waiting → Approve, reminders → the Reminders page; a chip opens only for a
//     person who may open the list, else it stays a plain number;
//   - Reminders: fleet_overview's needs_attention split into the documents and services due (each row to its vehicle)
//     and the rest (each row to its issue), in the server's order (overdue first);
//   - Needs attention as groups (fleet_overview attention.groups): a group expands in place; Snooze (tomorrow / a week)
//     acts on every issue behind it (update_issue snooze).

import { has } from './nav';
import type { Attention, AttentionGroup, Overview } from './types';

export type OverviewChip = 'road' | 'free' | 'waiting' | 'garage' | 'reminders';

/** Where a chip goes in the app, or null when this person may not open its list. */
export function chipTarget(chip: OverviewChip, me: { permissions: readonly string[]; tools: readonly string[] }): string | null {
  const tool = (t: string) => me.tools.includes(t);
  switch (chip) {
    case 'road':
      return has(me.permissions, 'view') ? '/office/(tabs)/live' : null;
    case 'free':
      return has(me.permissions, 'view', 'vehicles') && tool('list_vehicles') ? '/office/vehicles?filter=available' : null;
    case 'garage':
      return has(me.permissions, 'view', 'vehicles') && tool('list_vehicles') ? '/office/vehicles?filter=in_garage' : null;
    case 'waiting':
      // The count opens the filtered list (docs/phase8-plan.md §16): the waiting ones, whatever the tab showed last.
      return has(me.permissions, 'approve') && tool('list_requests') ? '/office/(tabs)/approve?status=waiting' : null;
    case 'reminders':
      return has(me.permissions, 'issues', 'assign_tasks') && tool('fleet_overview') ? '/office/reminders' : null;
  }
}

/** The Vehicles screen's filter from a link's `?filter=` (its own key, or the website's word); anything else is All. */
export function vehicleFilterParam(v: string | undefined): string {
  const words: Record<string, string> = { free: 'available', garage: 'in_garage', documents: 'documents_expiring', returned: 'inactive' };
  const keys = ['all', 'on_task', 'available', 'in_garage', 'documents_expiring', 'inactive'];
  if (!v) return 'all';
  if (keys.includes(v)) return v;
  return words[v] ?? 'all';
}

// ---- Reminders ----

const VEHICLE_KINDS = new Set(['document', 'documents_missing', 'service_due', 'rental', 'garage_booked', 'allowance']);
const DUE_KINDS = new Set([...VEHICLE_KINDS, 'licence']);

export interface ReminderRow {
  key: string;
  what: string;
  plate?: string;
  subject?: string;
  due?: string;
  level?: string;
  /** The vehicle's page, else the issue's; none when neither is known. */
  to?: { pathname: '/office/vehicles/[reg]'; params: { reg: string } } | { pathname: '/office/issues/[id]'; params: { id: string } };
}

export interface ReminderGroups {
  due: ReminderRow[];
  other: ReminderRow[];
}

export function reminderGroups(items: readonly Attention[] | undefined): ReminderGroups {
  const out: ReminderGroups = { due: [], other: [] };
  (items ?? []).forEach((a, i) => {
    const vehicleKind = !!a.kind && VEHICLE_KINDS.has(a.kind);
    const [head, ...rest] = a.subject ? String(a.subject).split(' · ') : [];
    const plate = vehicleKind ? a.vehicle ?? (head?.trim() || undefined) : undefined;
    const subject = plate && head?.trim() === plate ? rest.join(' · ') || undefined : a.subject || undefined;
    const row: ReminderRow = {
      key: a.issue_id ?? `${i}`,
      what: a.what,
      plate,
      subject,
      due: a.due || undefined,
      level: a.level,
      to: plate ? { pathname: '/office/vehicles/[reg]', params: { reg: plate } } : a.issue_id ? { pathname: '/office/issues/[id]', params: { id: a.issue_id } } : undefined,
    };
    (a.kind && DUE_KINDS.has(a.kind) ? out.due : out.other).push(row);
  });
  return out;
}

/** The tone of a reminder's due date (red overdue / within 7 days, amber soon). */
export function levelTone(level: string | undefined): 'red' | 'amber' | 'muted' {
  return level === 'red' || level === 'critical' ? 'red' : level === 'orange' || level === 'amber' || level === 'warning' ? 'amber' : 'muted';
}

// ---- Needs attention ----

/** The groups to show: the server's (Hotfix 3), else the critical items one per group (an older answer). */
export function attentionGroups(ov: Pick<Overview, 'attention' | 'critical'> | null | undefined): AttentionGroup[] {
  if (!ov) return [];
  if (ov.attention?.groups) return ov.attention.groups;
  return (ov.critical?.items ?? []).map((a, i) => ({
    key: a.issue_id ?? `critical:${i}`,
    kind: a.kind ?? 'other',
    title: a.what,
    count: 1,
    severity: 'critical' as const,
    issue_ids: a.issue_id ? [a.issue_id] : [],
    items: [a],
    ...(a.vehicle ? { vehicle: a.vehicle } : {}),
  }));
}

/** How many the section counts. */
export const attentionCount = (ov: Pick<Overview, 'attention' | 'critical'> | null | undefined): number =>
  ov?.attention?.count ?? ov?.critical?.count ?? 0;

/** update_issue's calls for a Snooze on a group: one per issue behind it. */
export function snoozeCalls(g: Pick<AttentionGroup, 'issue_ids'>, when: 'tomorrow' | 'week'): { id: string; snooze: 'tomorrow' | 'week' }[] {
  return [...new Set(g.issue_ids)].map((id) => ({ id, snooze: when }));
}

/** The overview without the groups just snoozed (the next answer leaves them out too). */
export function withoutGroups<T extends Pick<Overview, 'attention'>>(ov: T, keys: readonly string[]): T {
  if (!ov.attention) return ov;
  const groups = ov.attention.groups.filter((g) => !keys.includes(g.key));
  const gone = ov.attention.groups.filter((g) => keys.includes(g.key)).reduce((s, g) => s + g.issue_ids.length, 0);
  return { ...ov, attention: { count: Math.max(0, ov.attention.count - gone), groups } };
}
