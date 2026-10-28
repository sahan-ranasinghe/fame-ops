// Office mode (Phase 8, O2): the Issues screens' pure rules, tested in scripts/test-issues.ts. The status chips and
// list_issues' input, the severity chips filtered on the phone, the tones, the rows' lines, the facts on the page, the
// actions per status and tools, update_issue's inputs, the row patched from the answer, the links by permission and the
// timeline's sentences (as i18n keys: the screens translate).
//
// The rules copied from the site's apps/office/src/screens/issuesLogic.ts (the words there are English, here they are
// keys): isActive, fitsStatus, defaultSort, severityTone / statusTone, mergeIssue, snoozeLine, whoLine, issueFacts,
// eventText. Copy again when the site's change.

import { datesInWords, relativeWords, whenWords } from '@/lib/dateWords';
import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';

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
export function issuesArgs(status: IssueStatusFilter, search = '', cursor?: string, sort?: IssueSort, extra: IssuesExtra = {}): Record<string, unknown> {
  const words = search.trim();
  return {
    status,
    sort: sort ?? defaultSort(status),
    limit: LIMIT,
    ...(words ? { search: words } : {}),
    ...(extra.kind ? { kind: extra.kind } : {}),
    ...(extra.vehicle ? { vehicle: extra.vehicle } : {}),
    ...(extra.from && extra.to ? { from: extra.from, to: extra.to } : {}),
    ...(extra.snoozed !== undefined ? { snoozed: extra.snoozed } : {}),
    ...(extra.severity ? { severity: extra.severity } : {}),
    ...(extra.group ? { group: true } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

// ---- Stage 1 (O3 row 6): the kind, the vehicle and when it was opened, in the same Filter sheet (list_issues' own) ----

/** The issue kinds (the server's KIND_TEXT keys) and the task kinds someone with assign_tasks alone may read. */
export const ISSUE_KINDS = ['vehicle_report', 'odometer_flag', 'km_gap', 'service_due', 'document', 'documents_missing', 'licence', 'allowance', 'rental', 'garage_booked',
  'signal', 'late_start', 'running_late', 'not_accepted', 'declined', 'request_waiting', 'vehicle_conflict', 'app_stopped', 'arrival_override', 'completed_early',
  'vehicle_needed', 'missed_task', 'push_failed', 'routing_failed', 'map_fallback', 'trip_not_confirmed', 'usage_cap'] as const;
export const TASK_ISSUE_KINDS = ['signal', 'late_start', 'running_late', 'not_accepted', 'declined', 'vehicle_conflict', 'arrival_override', 'completed_early', 'vehicle_needed', 'missed_task'] as const;

/** The kinds this person can read: all with issues, the task kinds with assign_tasks alone. */
export function kindsFor(permissions: readonly Permission[] | readonly string[]): readonly string[] {
  return permissions.includes('issues' as never) ? ISSUE_KINDS : permissions.includes('assign_tasks' as never) ? TASK_ISSUE_KINDS : [];
}

export type OpenedFilter = 'any' | 'today' | 'last7' | 'this_month' | 'last_month';
export const OPENED_FILTERS: readonly OpenedFilter[] = ['any', 'today', 'last7', 'this_month', 'last_month'];

export interface IssuesExtra {
  kind?: string;
  vehicle?: string;
  from?: string;
  to?: string;
  /** Round 4–7 (item 8): the tab's own input: Open leaves the snoozed out (false), Snoozed lists only them (true). */
  snoozed?: boolean;
  /** The Open tab's groups by kind (list_issues group: true). */
  group?: boolean;
  /** The groups are narrowed by the server (their counts stay right); a flat list narrows on the phone as before. */
  severity?: string;
}

export function issuesExtraDefs(kinds: readonly string[], plates: readonly string[], tr: (key: string) => string): FilterDef[] {
  const defs: FilterDef[] = [];
  if (kinds.length > 1) {
    defs.push({ key: 'kind', label: tr('office.issues.filterKind'), kind: 'single', default: 'all', options: [{ value: 'all', label: tr('office.common.all') }, ...kinds.map((k) => ({ value: k, label: tr(`office.issues.kind.${k}`) }))] });
  }
  if (plates.length > 0) {
    defs.push({ key: 'vehicle', label: tr('office.issues.filterVehicle'), kind: 'single', default: 'all', options: [{ value: 'all', label: tr('office.common.all') }, ...plates.map((p) => ({ value: p, label: p }))] });
  }
  defs.push({ key: 'opened', label: tr('office.issues.filterOpened'), kind: 'single', default: 'any', options: OPENED_FILTERS.map((o) => ({ value: o, label: o === 'any' ? tr('office.issues.openedAny') : tr(`patterns.preset_${o}`) })) });
  return defs;
}

/** The extra filters chosen, as list_issues takes them (a range from the preset). `range` turns a preset into days. */
export function issuesExtra(values: FilterValues, range: (preset: Exclude<OpenedFilter, 'any'>) => { from: string; to: string }): IssuesExtra {
  const out: IssuesExtra = {};
  if (typeof values.kind === 'string' && values.kind !== 'all' && (ISSUE_KINDS as readonly string[]).includes(values.kind)) out.kind = values.kind;
  if (typeof values.vehicle === 'string' && values.vehicle !== 'all' && values.vehicle) out.vehicle = values.vehicle;
  const o = values.opened;
  if (typeof o === 'string' && o !== 'any' && (OPENED_FILTERS as readonly string[]).includes(o)) Object.assign(out, range(o as Exclude<OpenedFilter, 'any'>));
  return out;
}

/** The Sort menu: list_issues' own `sort` (the most urgent first, or the newest first). */
export type IssueSort = 'urgent' | 'newest';
export const ISSUE_SORTS: readonly IssueSort[] = ['urgent', 'newest'];
export const isIssueSort = (s: unknown): s is IssueSort => (ISSUE_SORTS as readonly unknown[]).includes(s);

/**
 * The Filter sheet's sections (docs/ui-patterns.md §1): the status (list_issues' `status`, Active by default, with the
 * server's counts where the answer has them) and the severity (narrowed on the phone, with the counts of the rows of
 * the status chosen). `tr` turns the i18n keys into words.
 */
export function issuesFilterDefs(
  list: Pick<IssuesList, 'open' | 'in_progress'> | null | undefined,
  severity: Record<SeverityFilter, number> | null | undefined,
  tr: (key: string) => string,
): FilterDef[] {
  const statusCount = (k: IssueStatusFilter): number | undefined =>
    !list ? undefined : k === 'active' ? activeCount(list) : k === 'open' ? list.open : k === 'in_progress' ? list.in_progress : undefined;
  return [
    {
      key: 'status',
      label: tr('office.issues.filterStatus'),
      kind: 'single',
      default: DEFAULT_STATUS,
      options: STATUS_FILTERS.map((k) => ({ value: k, label: tr(`office.issues.filter.${k}`), ...(statusCount(k) !== undefined ? { count: statusCount(k) } : {}) })),
    },
    {
      key: 'severity',
      label: tr('office.issues.filterSeverity'),
      kind: 'single',
      default: 'all',
      options: SEVERITY_FILTERS.map((k) => ({ value: k, label: k === 'all' ? tr('office.common.all') : tr(`office.issues.severity.${k}`), ...(severity ? { count: severity[k] } : {}) })),
    },
  ];
}

/** The status and the severity chosen in the sheet (anything unknown falls back to the default). */
export function issuesChoice(values: FilterValues): { status: IssueStatusFilter; severity: SeverityFilter } {
  const st = values.status;
  const sv = values.severity;
  return { status: isStatusFilter(st) ? st : DEFAULT_STATUS, severity: isSeverityFilter(sv) ? sv : 'all' };
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

/**
 * A row's severity chip (Sahan, 22 October 2026): each group heading says its severity with an icon (and the word for the
 * screen reader), so a row under it no longer repeats Warning or Info. Critical keeps its chip on every row; a flat list (a
 * search, a kind's list: no heading, `group` absent) keeps every chip; and a row whose severity is not its group's (a group
 * takes its worst row's) keeps its own, since the heading does not say it.
 */
export const severityChipShown = (severity: string, group?: string | null): boolean => severity === 'critical' || !group || severity !== group;

/** The icon of a severity on a group's heading (never colour alone): critical an octagon, warning a triangle, info a circle. */
export type SeverityIcon = 'octagon' | 'triangle' | 'info';
export const severityIcon = (severity?: string): SeverityIcon => (severity === 'critical' ? 'octagon' : severity === 'warning' ? 'triangle' : 'info');
export const statusTone = (status?: string): Tone => (status === 'open' ? 'red' : status === 'in_progress' ? 'amber' : status === 'resolved' ? 'green' : 'muted');

/** The kind's name in the phone's language (office.issues.kind.<kind>), else the server's words, else the kind itself. */
export function kindText(i: Pick<Issue, 'kind' | 'kind_text'>, tr: (key: string) => string): string {
  const key = `office.issues.kind.${i.kind}`;
  const found = tr(key);
  return found && found !== key ? found : i.kind_text ?? i.kind;
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

/**
 * An issue's due words in the person's language (Part B, M5; the server's issues.ts writes them in English): "in 5 days",
 * "2 d overdue", "today", "soon", "reported 2 h ago", "logged yesterday 09:00", "for 20 min", "waiting 3 h", "leave by Thu
 * 22 Oct 08:30 · in 3 h", "was to leave …", "completed …", "arrived …", "since 09:10", "final ETA 11:40". Anything else as
 * it came.
 */
export function dueWords(t: Tr, due: string | null | undefined, now: Date | string | number = Date.now()): string {
  const s = (due ?? '').trim();
  if (!s) return '';
  if (s.includes(' · ')) return s.split(' · ').map((part) => dueWords(t, part, now)).join(' · ');
  let m: RegExpMatchArray | null;
  if (s === 'today' || s === 'tomorrow') return t(`date.${s}`);
  if (s === 'soon') return t('office.issues.dueSoon');
  if (s === 'needs a driver') return t('office.issues.dueNeedsDriver');
  if ((m = s.match(/^(\d+) d overdue$/))) return t('office.issues.dueOverdue', { n: m[1] });
  if ((m = s.match(/^in (\d+) days$/))) return t('office.issues.dueInDays', { n: m[1] });
  const prefixed: [RegExp, string, 'when' | 'dur' | 'time'][] = [
    [/^reported (.+)$/, 'dueReported', 'when'], [/^logged (.+)$/, 'dueLogged', 'when'], [/^ended (.+)$/, 'dueEnded', 'when'],
    [/^for (.+)$/, 'dueFor', 'dur'], [/^waiting (.+)$/, 'dueWaiting', 'dur'], [/^leave by (.+)$/, 'dueLeaveBy', 'when'],
    [/^was to leave (.+)$/, 'dueWasToLeave', 'when'], [/^completed (.+)$/, 'dueCompleted', 'when'], [/^arrived (.+)$/, 'dueArrived', 'when'],
    [/^since (\d{2}:\d{2})$/, 'dueSince', 'time'], [/^final ETA (\d{2}:\d{2})$/, 'dueFinalEta', 'time'],
  ];
  for (const [rx, key, slot] of prefixed) {
    if ((m = s.match(rx))) return t(`office.issues.${key}`, { [slot]: slot === 'time' ? m[1] : slot === 'dur' ? relativeWords(t, m[1], now) ?? m[1] : whenWords(t, m[1], now) });
  }
  return relativeWords(t, s, now) ?? datesInWords(t, s, now);
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

/**
 * Who has a row's issue and who closed it, for its words (the review of Round 4–7: the avatar alone said neither, and the
 * closed time was gone): taken = an active issue's person ("taken by Sahan 10:05"; the time when the server gives it);
 * closed = a resolved or dismissed one's how, by whom ('system' = by itself) and when.
 */
export function rowWho(i: Pick<Issue, 'status' | 'taken_by' | 'assigned_to' | 'resolved_by' | 'resolved_at' | 'resolved'>): {
  taken?: { name: string; at?: string };
  closed?: { how: 'resolved' | 'dismissed'; by: string | null; at: string | null };
} {
  if (isActive(i.status)) {
    if (i.taken_by?.name) return { taken: { name: i.taken_by.name, ...(i.taken_by.at ? { at: i.taken_by.at.slice(-5) } : {}) } };
    return i.assigned_to?.name ? { taken: { name: i.assigned_to.name } } : {};
  }
  const at = i.resolved_at ?? i.resolved ?? null;
  if (!at && !i.resolved_by) return {};
  return { closed: { how: i.status === 'dismissed' ? 'dismissed' : 'resolved', by: i.resolved_by ?? null, at } };
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
  /** The server's "2026-10-18 09:12" in words ("Today 09:12", lib/dateWords.ts; Round 3 A4); as it is without. */
  when?: (at: string) => string;
}

/** The issue's facts on the page: opened, opened by, taken by, due, and when closed, at and by; updated last. */
export function issueFacts(i: Issue, w: FactWords): { key: FactKey; value: string }[] {
  const when = w.when ?? ((at: string) => at);
  const rows: { key: FactKey; value: string }[] = [
    { key: 'opened', value: when(i.opened) },
    { key: 'openedBy', value: i.opened_by ?? w.system },
    { key: 'takenBy', value: i.taken_by ? [i.taken_by.name, i.taken_by.at ? when(i.taken_by.at) : ''].filter(Boolean).join(' · ') : i.assigned_to ? i.assigned_to.name : w.nobody },
  ];
  if (i.due) rows.push({ key: 'due', value: i.due });
  const closedAt = i.resolved_at ?? i.resolved;
  if (!isActive(i.status) && (closedAt || i.resolved_by)) {
    rows.push({ key: i.status === 'dismissed' ? 'dismissed' : 'resolved', value: [closedAt ? when(closedAt) : '', i.resolved_by ? w.by(i.resolved_by) : ''].filter(Boolean).join(' ') });
  }
  if (i.updated && i.updated !== i.opened) rows.push({ key: 'updated', value: when(i.updated) });
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

// ---- Round 4–7 (item 8, §33.7): the tabs, the groups by kind, Gmail's rows and the bulk actions ----

/**
 * The tabs (Gmail's Inbox · Snoozed · Done) over the Filter sheet's status: Open = Active, Open or In progress (the snoozed
 * left out), Snoozed = the active ones snoozed, Resolved = Resolved or Dismissed. The sheet keeps its five statuses.
 */
export type IssueTab = 'open' | 'snoozed' | 'resolved';
export const ISSUE_TABS: readonly IssueTab[] = ['open', 'snoozed', 'resolved'];
export const tabFor = (status: IssueStatusFilter, snoozedTab: boolean): IssueTab =>
  snoozedTab ? 'snoozed' : status === 'resolved' || status === 'dismissed' ? 'resolved' : 'open';
/** The status a tab opens on. */
export const TAB_STATUS: Record<IssueTab, IssueStatusFilter> = { open: 'active', snoozed: 'active', resolved: 'resolved' };

/** The Open tab groups by kind until a kind is chosen ("Show all N") or words are searched for (one list of results). */
export const showsGroups = (tab: IssueTab, kind: string | undefined, search: string): boolean => tab === 'open' && !kind && !search.trim();

/** What a tab adds to list_issues' input: the snoozed left out or alone, the groups (with the severity asked of the server). */
export function tabExtra(tab: IssueTab, grouped: boolean, severity: SeverityFilter): IssuesExtra {
  if (tab === 'snoozed') return { snoozed: true };
  if (tab === 'resolved') return {};
  return grouped ? { snoozed: false, group: true, ...(severity !== 'all' ? { severity } : {}) } : { snoozed: false };
}

export type IssueGroup = NonNullable<IssuesList['groups']>[number];

/** A group's heading: office.issues.group.<kind> ("Missed tasks"), else the kind's words. */
export function groupText(g: { kind: string; kind_text?: string }, tr: (key: string) => string): string {
  const key = `office.issues.group.${g.kind}`;
  const found = tr(key);
  return found && found !== key ? found : kindText(g, tr);
}

/** The row's ONE title: the server's specific line (never the kind again), else the title. */
export const rowTitle = (i: Pick<Issue, 'headline' | 'title'>): string => i.headline || i.title;

/**
 * The row's ONE grey line with the plate apart (drawn as its chip): the server's "plate · driver · when", else made from
 * the card (the driver and the due words, or when it was opened).
 */
export function metaParts(i: Pick<Issue, 'meta' | 'vehicle' | 'driver' | 'due' | 'opened'>): { plate?: string; rest: string } {
  const line = i.meta || [i.vehicle, i.driver, i.due || i.opened].filter(Boolean).join(' · ');
  if (i.vehicle && line.startsWith(i.vehicle)) return { plate: i.vehicle, rest: line.slice(i.vehicle.length).replace(/^\s*·\s*/, '') };
  return { rest: line };
}

/** The status chip on a row only when the tab or filter does not say it already. */
export function statusShown(status: IssueStatusFilter, rowStatus: string): boolean {
  if (status === 'active') return rowStatus !== 'open';
  return rowStatus !== status;
}

/** The badge's number: what needs action (critical and warning, not snoozed), else (an older server) the active ones. */
export const needsAction = (list: Pick<IssuesList, 'open' | 'in_progress' | 'needs_action'> | null | undefined): number =>
  list?.needs_action ?? activeCount(list);

/** update_issues takes at most this many ids at a time. */
export const BULK_MAX = 100;
export type BulkAction = 'resolved' | 'dismissed';
/** The reasons offered as chips (office.issues.reason.<key>); the person may write another. */
export const BULK_REASONS = ['test', 'handled', 'notIssue'] as const;

/** update_issues' inputs: the ids once each in calls of 100, one reason; nothing without a reason or an id. */
export function bulkCalls(ids: readonly string[], status: BulkAction, note: string): { ids: string[]; status: BulkAction; note: string }[] {
  const reason = note.trim().slice(0, 500);
  const unique = [...new Set(ids)];
  if (!reason || !unique.length) return [];
  const out: { ids: string[]; status: BulkAction; note: string }[] = [];
  for (let i = 0; i < unique.length; i += BULK_MAX) out.push({ ids: unique.slice(i, i + BULK_MAX), status, note: reason });
  return out;
}

/** The selection after a tick: on adds the ids, off takes them away. */
export function toggled(selected: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** A group's tick: all its rows on screen picked = on, some = mixed, none = off. */
export function groupTick(selected: ReadonlySet<string>, ids: readonly string[]): 'on' | 'mixed' | 'off' {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? 'off' : n === ids.length ? 'on' : 'mixed';
}

/** A group after the bulk action: the issues done leave it, its count drops, an empty group goes. */
export function withoutIssues(list: IssuesList, ids: readonly string[]): IssuesList {
  const gone = new Set(ids);
  const groups = list.groups
    ?.map((g) => {
      const left = g.newest.filter((i) => !gone.has(i.id));
      return { ...g, newest: left, count: Math.max(0, g.count - (g.newest.length - left.length)) };
    })
    .filter((g) => g.count > 0);
  return { ...list, issues: list.issues.filter((i) => !gone.has(i.id)), ...(groups ? { groups } : {}) };
}
