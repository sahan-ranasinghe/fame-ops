// Office mode (Round 4–7, item 9; docs/phase8-plan.md §33.8): Settings → Data retention, the rules of the screen, pure
// (scripts/test-perperson.ts). The site's twin is apps/office/src/screens/settings/retentionLogic.ts (the same keys, defaults,
// minimums and checks; the site's words are English, the app's are i18n keys under office.retention.*). Each kind of data
// with the days it is kept (the setting `retention`), the minimum checked before Save, the whole setting sent with the one
// change (update_settings stores what it is sent over the server's defaults), and Run now's two presses: retention_preview
// (counts only), then run_retention {confirm: true} (a write: never asked again by itself).

import type { RetentionDays, RetentionPreview } from './types';

export type RetentionKey = keyof RetentionDays;

/** The periods in the screen's order; `note` = the i18n key of a second line (what stays, where it lives). */
export const RETENTION_ROWS: readonly { key: RetentionKey; note?: string }[] = [
  { key: 'inbox_read_days' },
  { key: 'inbox_unread_days' },
  { key: 'delivery_days' },
  { key: 'audit_routine_days', note: 'office.retention.note.audit_routine_days' },
  { key: 'audit_changes_days' },
  { key: 'issues_resolved_days', note: 'office.retention.note.issues_resolved_days' },
  { key: 'location_days', note: 'office.retention.note.location_days' },
  { key: 'heartbeats_days' },
  { key: 'counters_days', note: 'office.retention.note.counters_days' },
  { key: 'drafts_days', note: 'office.retention.note.drafts_days' },
  { key: 'app_errors_days' },
];

/** The i18n key of a period's name ("Read notifications"). */
export const whatKey = (key: RetentionKey): string => `office.retention.what.${key}`;

/** The server's defaults (supabase/functions/_shared/fleet/settings.ts RETENTION_DEFAULTS). */
export const RETENTION_DEFAULTS: RetentionDays = {
  inbox_read_days: 30,
  inbox_unread_days: 90,
  delivery_days: 14,
  audit_routine_days: 30,
  audit_changes_days: 730,
  issues_resolved_days: 365,
  location_days: 183,
  heartbeats_days: 90,
  counters_days: 90,
  drafts_days: 30,
  app_errors_days: 90,
};

/** The floors (the server's RETENTION_MINIMUMS): GPS 30 days, the activity log's changes 6 months. */
export const MINIMUMS_FALLBACK: Partial<RetentionDays> = { location_days: 30, audit_changes_days: 183 };
export const MAX_DAYS = 3650;

export const periodsOf = (saved?: Partial<RetentionDays> | null): RetentionDays => ({ ...RETENTION_DEFAULTS, ...(saved ?? {}) });
export const minimumOf = (key: RetentionKey, minimums?: Partial<RetentionDays> | null): number => minimums?.[key] ?? MINIMUMS_FALLBACK[key] ?? 1;

/** What a typed number of days is: the days, or why it cannot be saved (an i18n key with its values). */
export type DaysProblem = { key: 'office.retention.err.empty' | 'office.retention.err.whole' | 'office.retention.err.min' | 'office.retention.err.max'; vars?: Record<string, number> };
export function daysInput(text: string, min: number): { days: number } | { error: DaysProblem } {
  const t = text.trim();
  if (t === '') return { error: { key: 'office.retention.err.empty' } };
  if (!/^\d+$/.test(t)) return { error: { key: 'office.retention.err.whole' } };
  const days = Number(t);
  if (days < min) return { error: { key: 'office.retention.err.min', vars: { n: min } } };
  if (days > MAX_DAYS) return { error: { key: 'office.retention.err.max', vars: { n: MAX_DAYS } } };
  return { days };
}

/** The whole setting with one period changed (a period changed earlier is never put back to its default). */
export const withPeriod = (periods: RetentionDays, key: RetentionKey, days: number): RetentionDays => ({ ...periods, [key]: days });

/** "02:45 Colombo" → "02:45". */
export function nightlyTime(nightly?: string | null): string {
  return nightly?.match(/\b\d{2}:\d{2}\b/)?.[0] ?? '02:45';
}

/** The kinds a run would remove now (count over 0), in the server's order, and their total. */
export function previewLines(p: Pick<RetentionPreview, 'rules' | 'would_remove'>): { lines: RetentionPreview['rules']; total: number } {
  const lines = p.rules.filter((r) => r.count > 0);
  return { lines, total: p.would_remove ?? lines.reduce((s, r) => s + r.count, 0) };
}

/** The server's rule keys (supabase/functions/_shared/fleet/retention.ts RULES), each with its words in both languages. */
export const RULE_KEYS = [
  'inbox_read', 'inbox_unread', 'delivery', 'push_log', 'audit_routine', 'audit_changes', 'issue_events', 'issues_resolved', 'location_points',
  'route_matched', 'heartbeats', 'google_calls', 'routing_calls', 'api_minute_calls', 'app_errors',
] as const;
/** The i18n key of a rule's words, or null for a rule this app does not know (its server words are shown). */
export const ruleKey = (key: string): string | null => ((RULE_KEYS as readonly string[]).includes(key) ? `office.retention.rule.${key}` : null);

/** The server's "never removed" list (retention.ts NEVER), each with its words in both languages. */
export const NEVER_KEYS: Record<string, string> = {
  'tasks and their stops': 'office.retention.never.tasks',
  requests: 'office.retention.never.requests',
  'odometer and fuel logs and their photos': 'office.retention.never.logs',
  'vehicle reports': 'office.retention.never.reports',
  'vehicle documents': 'office.retention.never.documents',
  employees: 'office.retention.never.employees',
  vehicles: 'office.retention.never.vehicles',
  places: 'office.retention.never.places',
  projects: 'office.retention.never.projects',
  'duty sessions (attendance)': 'office.retention.never.duty',
};

/** The never-removed list in the person's language (an item this app does not know keeps the server's words). */
export const neverWords = (never: readonly string[], t: (key: string) => string): string[] => never.map((n) => (NEVER_KEYS[n] ? t(NEVER_KEYS[n]) : n));

/** The i18n keys this screen uses (the strings test checks each in both languages). */
export const RETENTION_I18N_KEYS: string[] = [
  ...RETENTION_ROWS.map((r) => whatKey(r.key)),
  ...RETENTION_ROWS.flatMap((r) => (r.note ? [r.note] : [])),
  ...RULE_KEYS.map((k) => `office.retention.rule.${k}`),
  ...Object.values(NEVER_KEYS),
  'office.retention.err.empty', 'office.retention.err.whole', 'office.retention.err.min', 'office.retention.err.max',
];
