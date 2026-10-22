// Settings → Data retention (Round 4–7, item 9; docs/phase8-plan.md §33.8; Slack's and Google Workspace's retention
// settings): the rules of the page, pure (Vitest). Each kind of data with how long it is kept (the setting `retention`, in
// days, with the server's minimums), what the next run removes (before which day), and the two presses of Run now: the
// preview (retention_preview: counts only) and the run (run_retention {confirm: true}). The app's twin is
// apps/driver/src/office/retentionLogic.ts (the same keys and rules, its words in the i18n files).
import type { RetentionDays, RetentionPreview } from "../../data/types";
import { addDays } from "../../lib/format";

export type RetentionKey = keyof RetentionDays;

/** The periods in the page's order, with what each covers and, where something stays for good, what it is. */
export const RETENTION_ROWS: readonly { key: RetentionKey; what: string; note?: string }[] = [
  { key: "inbox_read_days", what: "Read notifications" },
  { key: "inbox_unread_days", what: "Unread notifications" },
  { key: "delivery_days", what: "Notification and push delivery records" },
  { key: "audit_routine_days", what: "Activity log: routine entries", note: "Reads and everyday actions" },
  { key: "audit_changes_days", what: "Activity log: changes" },
  { key: "issues_resolved_days", what: "Resolved or dismissed issues", note: "With their history" },
  { key: "location_days", what: "Location points", note: "Each driver's day stays as a summary: km, driving time, stops" },
  { key: "heartbeats_days", what: "Phone heartbeats" },
  { key: "counters_days", what: "Usage counters", note: "Google, routing and map search" },
  { key: "drafts_days", what: "Unsent trip drafts", note: "On each browser and phone" },
  { key: "app_errors_days", what: "App errors" },
];

/** The server's defaults (supabase/functions/_shared/fleet/settings.ts RETENTION_DEFAULTS), for an answer without them. */
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

/** The floors no one goes under (the server's RETENTION_MINIMUMS): GPS 30 days, the activity log's changes 6 months. */
export const MINIMUMS_FALLBACK: Partial<RetentionDays> = { location_days: 30, audit_changes_days: 183 };
/** The longest period the server takes (10 years). */
export const MAX_DAYS = 3650;

/** The periods in force: the saved setting over the defaults. */
export const periodsOf = (saved?: Partial<RetentionDays> | null): RetentionDays => ({ ...RETENTION_DEFAULTS, ...(saved ?? {}) });

/** A kind's minimum: the preview's, else the known floors, else 1 day. */
export const minimumOf = (key: RetentionKey, minimums?: Partial<RetentionDays> | null): number => minimums?.[key] ?? MINIMUMS_FALLBACK[key] ?? 1;

/** What was typed as a number of days, checked before saving (the server says the same in its words). */
export function daysInput(text: string, min: number): { days: number } | { error: string } {
  const t = text.trim();
  if (t === "") return { error: "Type a number of days." };
  if (!/^\d+$/.test(t)) return { error: "Whole days only." };
  const days = Number(t);
  if (days < min) return { error: min > 1 ? `At least ${min} days.` : "At least 1 day." };
  if (days > MAX_DAYS) return { error: `At most ${MAX_DAYS.toLocaleString("en-US")} days.` };
  return { days };
}

/**
 * The whole setting with one period changed. The server's update_settings stores the object it is given over its defaults
 * (it does not merge with what is saved), so the page sends every period with the one change: a period changed earlier is
 * never put back to its default.
 */
export const withPeriod = (periods: RetentionDays, key: RetentionKey, days: number): RetentionDays => ({ ...periods, [key]: days });

/** "1 day", "30 days", "730 days". */
export const daysText = (n: number): string => `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`;

/** The first day the next run keeps (anything from before it goes): today in Colombo minus the period. */
export const firstKeptDay = (today: string, days: number): string => addDays(today, -days);

/** "02:45 Colombo" → "02:45" (the preview's nightly); the job's time when there is none. */
export function nightlyTime(nightly?: string | null): string {
  return nightly?.match(/\b\d{2}:\d{2}\b/)?.[0] ?? "02:45";
}

/** The kinds a run would remove now (count over 0), in the server's order, and their total. */
export function previewLines(p: Pick<RetentionPreview, "rules" | "would_remove">): { lines: RetentionPreview["rules"]; total: number } {
  const lines = p.rules.filter((r) => r.count > 0);
  return { lines, total: p.would_remove ?? lines.reduce((s, r) => s + r.count, 0) };
}

/** The second press's words: "Remove 4,522 now". */
export const removeLabel = (total: number): string => `Remove ${total.toLocaleString("en-US")} now`;

/** "Read notifications kept 60 days" (the toast after a save). */
export function savedText(key: RetentionKey, days: number): string {
  const row = RETENTION_ROWS.find((r) => r.key === key);
  return `${row?.what ?? "Saved"}: kept ${daysText(days)}`;
}
