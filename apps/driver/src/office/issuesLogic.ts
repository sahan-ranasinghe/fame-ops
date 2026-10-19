// Office mode (Phase 8, O2): the Issues screens' pure rules, tested in scripts/test-issues.ts. The status chips and
// list_issues' input, the severity chips filtered on the phone, the tones, the rows' lines, the facts on the page, the
// actions per status and tools, update_issue's inputs, the row patched from the answer, the links by permission and the
// timeline's sentences (as i18n keys: the screens translate).
//
// The rules copied from the site's apps/office/src/screens/issuesLogic.ts (the words there are English, here they are
// keys): isActive, fitsStatus, defaultSort, severityTone / statusTone, mergeIssue, snoozeLine, whoLine, issueFacts,
// eventText. Copy again when the site's change.

import type { Permission } from './permissions';
import type { Issue, IssueEvent, IssueHistory, IssuesList } from './types';
import type { Tone } from './ui';

/** The status chips, the tool's own `status` words (the site's Snoozed tab and All are not on the phone). */
export type IssueStatusFilter = 'active' | 'open' | 'in_progress' | 'resolved' | 'dismissed';
export const STATUS_FILTERS: readonly IssueStatusFilter[] = ['active', 'open', 'in_progress', 'resolved', 'dismissed'];
/** The list opens on everything that still needs attention (open or in progress), the most urgent first. */
export const DEFAULT_STATUS: IssueStatusFilter = 'active';

/** The severity chips: filtered on the phone from the page loaded. */
export type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';
export const SEVERITY_FILTERS: readonly SeverityFilter[] = ['all', 'critical', 'warning', 'info'];

/** One page of the list. */
export const LIMIT = 50;
/** The words typed are sent this long after the last key. */
export const SEARCH_DEBOUNCE_MS = 500;

export const ACTIVE = new Set(['open', 'in_progress']);
export const isActive = (status?: string): boolean => ACTIVE.has(status ?? '');

export const isStatusFilter = (s: unknown): s is IssueStatusFilter => (STATUS_FILTERS as readonly unknown[]).includes(s);
export const isSeverityFilter = (s: unknown): s is SeverityFilter => (SEVERITY_FILTERS as readonly unknown[]).includes(s);

/** The filters that list the issues still to do: the most urgent first; the closed ones: the newest first. */
export const defaultSort = (status: IssueStatusFilter): 'urgent' | 'newest' => (status === 'resolved' || status === 'dismissed' ? 'newest' : 'urgent');

/**
 * list_issues' input: the status, the order, a page of 50, and the words searched for only when there are any. The
 * snoozed ones are not left out (no Snoozed chip on the phone: a row says "Snoozed until …" instead).
 */
export function issuesArgs(status: IssueStatusFilter, search = '', cursor?: string): Record<string, unknown> {
  const words = search.trim();
  return {
    status,
    sort: defaultSort(status),
    limit: LIMIT,
    ...(words ? { search: words } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** Whether an issue belongs under a status chip (Active: open or in progress). */
export function fitsStatus(i: Pick<Issue, 'status'>, status: IssueStatusFilter): boolean {
  if (status === 'active') return isActive(i.status);
  return i.status === status;
}

/**
 * The rows to show, in the server's order: the status is checked here too, so an issue patched after Resolve leaves
 * the Active list at once; the severity chip narrows on the phone.
 */
export function listRows(issues: readonly Issue[], status: IssueStatusFilter, severity: SeverityFilter): Issue[] {
  return issues.filter((i) => fitsStatus(i, status) && (severity === 'all' || i.severity === severity));
}

/** The number on each severity chip, from the rows of the status chosen. */
export function severityCounts(issues: readonly Issue[], status: IssueStatusFilter): Record<SeverityFilter, number> {
  const rows = listRows(issues, status, 'all');
  return {
    all: rows.length,
    critical: rows.filter((i) => i.severity === 'critical').length,
    warning: rows.filter((i) => i.severity === 'warning').length,
    info: rows.filter((i) => i.severity === 'info').length,
  };
}

/** The next page appended to the list shown: the rows after the ones there (an issue never twice), the cursor moved on. */
export function appendPage(list: IssuesList, page: IssuesList): IssuesList {
  const seen = new Set(list.issues.map((i) => i.id));
  const more = page.issues.filter((i) => !seen.has(i.id));
  const out: IssuesList = { ...list, issues: [...list.issues, ...more], count: list.issues.length + more.length };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

/** The header's number: everything open or in progress the person may see (the site's bell), whatever the chips. */
export const activeCount = (list: Pick<IssuesList, 'open' | 'in_progress'> | null | undefined): number => (list?.open ?? 0) + (list?.in_progress ?? 0);

export const severityTone = (severity?: string): Tone => (severity === 'critical' ? 'red' : severity === 'warning' ? 'amber' : 'muted');
export const statusTone = (status?: string): Tone => (status === 'open' ? 'red' : status === 'in_progress' ? 'amber' : status === 'resolved' ? 'green' : 'muted');

/** The kind's name in the phone's language (office.issues.kind.<kind>), else the server's words, else the kind itself. */
export function kindText(i: Pick<Issue, 'kind' | 'kind_text'>, tr: (key: string) => string): string {
  const key = `office.issues.kind.${i.kind}`;
  const found = tr(key);
  return found && found !== key ? found : i.kind_text ?? i.kind;
}

/** The row's first line under the title: the kind, the detail and the due words, the ones there. */
export function rowLine(i: Pick<Issue, 'detail' | 'due'>, kind: string): string {
  return [kind, i.detail, i.due].filter(Boolean).join(' · ');
}

/** The words the screens hand the pure sentences (the i18n keys translated there). */
export interface WhoWords {
  opened: (at: string) => string;
  takenBy: (name: string, at?: string) => string;
  closed: (at: string) => string;
  dismissed: (at: string) => string;
}

/** "Opened 2026-10-18 09:12 · System · Vehicle problem · taken by Sahan 10:05 · closed 2026-10-18 11:00": the row's second line. */
export function whoLine(i: Issue, w: WhoWords): string {
  const parts: (string | undefined)[] = [w.opened(i.opened), i.opened_by];
  if (i.taken_by) parts.push(w.takenBy(i.taken_by.name, i.taken_by.at ? i.taken_by.at.slice(-5) : undefined));
  const closedAt = i.resolved_at ?? i.resolved;
  if (!isActive(i.status) && closedAt) parts.push(i.status === 'dismissed' ? w.dismissed(closedAt) : w.closed(closedAt));
  return parts.filter(Boolean).join(' · ');
}

/** "Snoozed until 2026-10-19 07:00" and by whom, on a snoozed row; nothing when it is not snoozed. */
export function snoozeParts(i: Pick<Issue, 'snoozed_until' | 'snoozed_by'>): { until: string; by?: string } | undefined {
  if (!i.snoozed_until) return undefined;
  return i.snoozed_by ? { until: i.snoozed_until, by: i.snoozed_by } : { until: i.snoozed_until };
}

export type FactKey = 'opened' | 'openedBy' | 'takenBy' | 'resolved' | 'dismissed' | 'due' | 'updated';

export interface FactWords {
  system: string;
  nobody: string;
  by: (name: string) => string;
}

/** The issue's facts on the page: opened, opened by, taken by, due, and when closed, at and by; updated last. */
export function issueFacts(i: Issue, w: FactWords): { key: FactKey; value: string }[] {
  const rows: { key: FactKey; value: string }[] = [
    { key: 'opened', value: i.opened },
    { key: 'openedBy', value: i.opened_by ?? w.system },
    { key: 'takenBy', value: i.taken_by ? [i.taken_by.name, i.taken_by.at].filter(Boolean).join(' · ') : i.assigned_to ? i.assigned_to.name : w.nobody },
  ];
  if (i.due) rows.push({ key: 'due', value: i.due });
  const closedAt = i.resolved_at ?? i.resolved;
  if (!isActive(i.status) && (closedAt || i.resolved_by)) {
    rows.push({ key: i.status === 'dismissed' ? 'dismissed' : 'resolved', value: [closedAt, i.resolved_by ? w.by(i.resolved_by) : ''].filter(Boolean).join(' ') });
  }
  if (i.updated && i.updated !== i.opened) rows.push({ key: 'updated', value: i.updated });
  return rows;
}

export type IssueAction = 'take' | 'note' | 'resolve' | 'dismiss' | 'reopen';

/**
 * The buttons on the page: none without update_issue among the person's tools (the server's rule mirrored); on an
 * active issue Take while nobody has it, Add a note, Resolve and Dismiss; on a closed one Reopen.
 */
export function issueActions(i: Pick<Issue, 'status' | 'assigned_to'>, tools: readonly string[]): IssueAction[] {
  if (!tools.includes('update_issue')) return [];
  if (!isActive(i.status)) return ['reopen'];
  const out: IssueAction[] = [];
  if (!i.assigned_to) out.push('take');
  out.push('note', 'resolve', 'dismiss');
  return out;
}

/** Whether the action's sheet needs words: a note is nothing without them; the others take an optional note. */
export const noteRequired = (action: IssueAction): boolean => action === 'note';

/**
 * update_issue's input for an action. Take = assign to me and in progress (as on the site); a note alone; Resolve,
 * Dismiss and Reopen with the note when one was written (the resolution, the reason, a word). Null when a note is
 * needed and none was written.
 */
export function updateInput(id: string, action: IssueAction, note = ''): Record<string, unknown> | null {
  const words = note.trim();
  const withNote = words ? { note: words } : {};
  switch (action) {
    case 'take':
      return { id, assign_to: 'me', status: 'in_progress' };
    case 'note':
      return words ? { id, note: words } : null;
    case 'resolve':
      return { id, status: 'resolved', ...withNote };
    case 'dismiss':
      return { id, status: 'dismissed', ...withNote };
    case 'reopen':
      return { id, status: 'open', ...withNote };
  }
}

/**
 * update_issue's card in place of the one shown. Its card carries no opened_by / taken_by (only list_issues and
 * issue_history read the events), so the page keeps who opened it, and a new assignee is the taker from `takenAt`
 * until the next read brings the server's time.
 */
export function mergeIssue(old: Issue | undefined, fresh: Issue, takenAt?: string): Issue {
  const assignee = fresh.assigned_to?.name;
  const taken_by = fresh.taken_by ?? (assignee
    ? old?.taken_by?.name === assignee ? old.taken_by : { name: assignee, ...(takenAt ? { at: takenAt } : {}) }
    : undefined);
  const out: Issue = { ...fresh, opened_by: fresh.opened_by ?? old?.opened_by, taken_by };
  for (const k of Object.keys(out) as (keyof Issue)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** The history after a change: the issue merged, the events kept until the page reads them again. */
export function patchHistory(h: IssueHistory, fresh: Issue, takenAt?: string): IssueHistory {
  return { ...h, issue: mergeIssue(h.issue, fresh, takenAt) };
}

/** The links the page may offer: a task with assign_tasks, a request with approve (else no link, the words only). */
export function linksFor(h: Pick<IssueHistory, 'task' | 'request'>, permissions: readonly string[]): { task?: string; request?: string } {
  const has = (p: Permission) => permissions.includes(p);
  const out: { task?: string; request?: string } = {};
  if (h.task && has('assign_tasks')) out.task = `/office/task/${h.task.id}`;
  if (h.request && has('approve')) out.request = `/office/request/${h.request.id}`;
  return out;
}

export type EventKey = 'opened' | 'assigned' | 'note' | 'status' | 'statusFrom' | 'autoResolved' | 'other';

/** The sentence under an event in the timeline, as its key and the words to fill in (the statuses raw: translated there). */
export function eventParts(e: IssueEvent): { key: EventKey; who?: string; to?: string; from?: string; note?: string; action?: string } {
  switch (e.action) {
    case 'opened':
      return { key: 'opened', who: e.actor };
    case 'assigned':
      return { key: 'assigned', who: e.actor, to: e.note };
    case 'note':
      return { key: 'note', who: e.actor, note: e.note ?? '' };
    case 'status':
      return e.from ? { key: 'statusFrom', who: e.actor, from: e.from, to: e.to, note: e.note } : { key: 'status', who: e.actor, to: e.to, note: e.note };
    case 'auto_resolved':
      return { key: 'autoResolved' };
    default:
      return { key: 'other', who: e.actor, action: e.action };
  }
}

/** The vehicle report's status words (report.open / in_garage / closed are the driver's own keys). */
export const REPORT_STATUS_KEYS: Record<string, string> = { open: 'report.open', in_garage: 'report.in_garage', closed: 'report.closed' };
/** The report's category words: the driver app's report.<category> keys. */
export const REPORT_CATEGORIES = new Set(['breakdown', 'accident', 'tyre', 'warning_light', 'other']);
export const reportCategoryKey = (category: string): string | undefined => (REPORT_CATEGORIES.has(category) ? `report.${category}` : undefined);
