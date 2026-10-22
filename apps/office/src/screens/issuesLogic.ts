// Pure rules of the issues centre: the list's tabs and filters (Phase 7 §9; Hotfix 3: the most urgent first, the snoozed
// ones on their own tab; Round 4–7 item 8, §33.7: Gmail's rows and Samsara / Sentry / GitHub's groups), the issue's facts,
// the in-place patch after a change, the bell's count (needs_action: critical and warning only), the bulk Resolve /
// Dismiss (update_issues), tones and the timeline's sentences.
//
// The tabs: Open (list_issues status active, the snoozed left out; grouped by kind with each group's 3 newest and "Show
// all N", the most urgent group first; a kind chosen lists that kind 25 at a time), Snoozed and Resolved (flat, the
// newest first, 25 at a time; Resolved over the opened days).
import type { Issue, IssuesList } from "../data/types";
import type { Tone } from "../lib/format";
import { rangeText } from "../ui/dateRange";

/** "snoozed" = the active issues someone snoozed (list_issues snoozed=true); the other active tabs leave them out. */
export type IssueStatusFilter = "active" | "open" | "in_progress" | "snoozed" | "resolved" | "dismissed" | "all";
export const STATUS_FILTERS: [IssueStatusFilter, string][] = [
  ["active", "Active"],
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["snoozed", "Snoozed"],
  ["resolved", "Resolved"],
  ["dismissed", "Dismissed"],
  ["all", "All"],
];
/** The page opens on everything that still needs attention (open or in progress), the most urgent group first. */
export const DEFAULT_STATUS: IssueStatusFilter = "active";
/** The issues page's store entry (the panel patches it after a change) and the bell's (navBadges.ts). */
export const ISSUES_KEY = "issuesAll";
export const BELL_KEY = "issues";

/**
 * The three tabs (Round 4–7, item 8; Gmail's Inbox · Snoozed · Done): shortcuts to the statuses. The Filter panel's
 * Status keeps every status (Active, Open, In progress, Snoozed, Resolved, Dismissed, All); Resolved, Dismissed and All
 * light the Resolved tab.
 */
export type IssueTab = "open" | "snoozed" | "resolved";
export const TABS: [IssueTab, string][] = [["open", "Open"], ["snoozed", "Snoozed"], ["resolved", "Resolved"]];
export const tabOf = (status: IssueStatusFilter): IssueTab =>
  status === "snoozed" ? "snoozed" : status === "resolved" || status === "dismissed" || status === "all" ? "resolved" : "open";
/** The status a tab opens on. */
export const TAB_STATUS: Record<IssueTab, IssueStatusFilter> = { open: "active", snoozed: "snoozed", resolved: "resolved" };

export type IssueSort = "urgent" | "newest";
export const SORT_OPTIONS: [IssueSort, string][] = [["urgent", "Most urgent first"], ["newest", "Newest first"]];
export type SeverityFilter = "" | "critical" | "warning" | "info";
export const SEVERITY_OPTIONS: [SeverityFilter, string][] = [["", "All severities"], ["critical", "Critical"], ["warning", "Warning"], ["info", "Info"]];

/** The filters that list the issues still to do: the most urgent first; the closed ones and All: the newest first. */
const ACTIVE_FILTERS = new Set<IssueStatusFilter>(["active", "open", "in_progress", "snoozed"]);
export const defaultSort = (status: IssueStatusFilter): IssueSort => (ACTIVE_FILTERS.has(status) ? "urgent" : "newest");

/** Everything the list asks for besides the page. */
export interface IssueListFilters {
  status: IssueStatusFilter;
  from: string;
  to: string;
  sort: IssueSort;
  kind?: string;
  vehicle?: string;
  severity?: SeverityFilter;
  search?: string;
}

export const KIND_TEXT: Record<string, string> = {
  missed_task: "Missed task",
  vehicle_report: "Vehicle problem",
  odometer_flag: "Odometer check",
  km_gap: "Km outside tasks",
  service_due: "Service",
  document: "Vehicle document",
  licence: "Driver licence",
  allowance: "Km allowance",
  rental: "Rental agreement",
  garage_booked: "Garage booked",
  signal: "Driver's signal",
  late_start: "Late start",
  running_late: "Running late",
  not_accepted: "Not accepted",
  declined: "Declined",
  request_waiting: "Request waiting",
  push_failed: "Push failed",
  routing_failed: "Routing failed",
  map_fallback: "Google map failed",
  // Phase 7.
  vehicle_conflict: "Vehicle taken",
  app_stopped: "App stopped",
  arrival_override: "Arrived away from the stop",
  completed_early: "Completed early",
  documents_missing: "Documents missing",
  vehicle_needed: "Needs another vehicle",
  // Round 4–7 (4b): a trip nobody drives with the app, closed at 09:00 the next day without its odometer.
  trip_not_confirmed: "Trip not confirmed",
};

export const kindText = (i: Pick<Issue, "kind" | "kind_text">) => i.kind_text ?? KIND_TEXT[i.kind] ?? i.kind;

const ACTIVE = new Set(["open", "in_progress"]);
export const isActive = (status?: string) => ACTIVE.has(status ?? "");

/** ?status=…; the old links' ?tab=resolved / ?tab=in_progress still work. Anything else: the default. */
export function readStatus(params: Pick<URLSearchParams, "get">): IssueStatusFilter {
  const asked = params.get("status") ?? params.get("tab");
  return STATUS_FILTERS.some(([k]) => k === asked) ? asked as IssueStatusFilter : DEFAULT_STATUS;
}

/** ?sort=, else the status's own order. */
export function readSort(params: Pick<URLSearchParams, "get">, status: IssueStatusFilter): IssueSort {
  const s = params.get("sort");
  return s === "urgent" || s === "newest" ? s : defaultSort(status);
}

/** ?severity= (anything else: every severity). */
export function readSeverity(params: Pick<URLSearchParams, "get">): SeverityFilter {
  const s = params.get("severity") ?? "";
  return SEVERITY_OPTIONS.some(([k]) => k === s) ? s as SeverityFilter : "";
}

/**
 * list_issues' input for the list (the kit adds the page): the status (Snoozed = the active ones snoozed; the other
 * active tabs leave the snoozed out, as the Overview and the counts do), the opened_at days, the order, and only the
 * filters chosen.
 */
export function issuesArgs(f: IssueListFilters): Record<string, unknown> {
  const snoozed = f.status === "snoozed" ? { snoozed: true } : ACTIVE_FILTERS.has(f.status) ? { snoozed: false } : {};
  return {
    status: f.status === "snoozed" ? "active" : f.status,
    from: f.from,
    to: f.to,
    sort: f.sort,
    ...snoozed,
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.vehicle ? { vehicle: f.vehicle } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
    ...(f.search ? { search: f.search } : {}),
  };
}

/**
 * The Open tab shows groups (one per kind) until a kind is chosen ("Show all N") or words are searched for (the results
 * are one list, as Gmail's search).
 */
export const showsGroups = (f: Pick<IssueListFilters, "status" | "kind" | "search">): boolean => tabOf(f.status) === "open" && !f.kind && !f.search;

/** list_issues' input for the groups: the same filters and days, group: true (each kind's count and its 3 newest; no paging). */
export function groupArgs(f: IssueListFilters): Record<string, unknown> {
  const { sort: _sort, ...rest } = issuesArgs(f);
  return { ...rest, group: true };
}

export type IssueGroup = NonNullable<IssuesList["groups"]>[number];

/** A group's heading in the plural ("Missed tasks · 12"); a kind the page does not know: the server's words. */
export const GROUP_TEXT: Record<string, string> = {
  missed_task: "Missed tasks",
  vehicle_report: "Vehicle problems",
  odometer_flag: "Odometer checks",
  km_gap: "Km outside tasks",
  service_due: "Services due",
  document: "Vehicle documents",
  documents_missing: "Documents missing",
  licence: "Driver licences",
  allowance: "Km allowances",
  rental: "Rental agreements",
  garage_booked: "Garage bookings",
  signal: "Drivers' signal",
  late_start: "Late starts",
  running_late: "Running late",
  not_accepted: "Not accepted",
  declined: "Declined tasks",
  request_waiting: "Requests waiting",
  vehicle_conflict: "Vehicles taken",
  app_stopped: "App stopped",
  arrival_override: "Arrived away from the stop",
  completed_early: "Completed early",
  vehicle_needed: "Another vehicle needed",
  push_failed: "Pushes failed",
  routing_failed: "Routing failed",
  map_fallback: "Google map failed",
  trip_not_confirmed: "Trips not confirmed",
};
export const groupText = (g: Pick<IssueGroup, "kind" | "kind_text">): string => GROUP_TEXT[g.kind] ?? g.kind_text ?? g.kind;

/** Each kind's icon (Gmail's leading icon): the row never repeats the kind in words. */
const KIND_ICON: Record<string, string> = {
  vehicle_report: "alert", odometer_flag: "gauge", km_gap: "route", service_due: "wrench", document: "doc", documents_missing: "doc",
  licence: "licence", allowance: "gauge", rental: "calendar", garage_booked: "maintenance", signal: "live", late_start: "clock",
  running_late: "clock", not_accepted: "person", declined: "person", request_waiting: "requests", vehicle_conflict: "car",
  app_stopped: "phone", arrival_override: "pin", completed_early: "check", vehicle_needed: "vehicles", missed_task: "calendar",
  push_failed: "inbox", routing_failed: "route", map_fallback: "live", trip_not_confirmed: "tasks",
};
export const kindIcon = (kind: string): string => KIND_ICON[kind] ?? "alert";

/** The row's ONE title: the server's specific line (never the kind again), else the title. */
export const rowTitle = (i: Pick<Issue, "headline" | "title">): string => i.headline || i.title;

/** The status pill on a row only when the filter does not say it already (Active: only "in progress"; All: every one). */
export function statusShown(filter: IssueStatusFilter, status: string): boolean {
  if (filter === "all") return true;
  if (filter === "active" || filter === "snoozed") return status !== "open";
  return status !== filter;
}

/** The grey line with its plate apart (drawn as the plate chip): "WP CAB-4521 · Kamal · 2 h ago" → the plate, "Kamal · 2 h ago". */
export function metaParts(i: Pick<Issue, "meta" | "vehicle" | "driver" | "due" | "opened">): { plate?: string; rest: string } {
  const line = rowMeta(i);
  if (i.vehicle && line.startsWith(i.vehicle)) {
    return { plate: i.vehicle, rest: line.slice(i.vehicle.length).replace(/^\s*·\s*/, "") };
  }
  return { rest: line };
}

/** The row's ONE grey line: plate · driver · when (the server's), else made from the card. */
export function rowMeta(i: Pick<Issue, "meta" | "vehicle" | "driver" | "due" | "opened">): string {
  if (i.meta) return i.meta;
  return [i.vehicle, i.driver, i.due || i.opened].filter(Boolean).join(" · ");
}

// ---- Bulk: select rows → Resolve / Dismiss with one reason (update_issues; Gmail's bulk actions) ----

/** update_issues takes at most this many ids at a time. */
export const BULK_MAX = 100;
export type BulkAction = "resolved" | "dismissed";
/** The reasons offered as chips (the person may write another). */
export const BULK_REASONS = ["Test data", "Already handled", "Not an issue"];

/** update_issues' inputs: the ids in calls of 100, one reason; nothing without a reason or an id. */
export function bulkCalls(ids: readonly string[], status: BulkAction, note: string): { ids: string[]; status: BulkAction; note: string }[] {
  const reason = note.trim().slice(0, 500);
  const unique = [...new Set(ids)];
  if (!reason || !unique.length) return [];
  const out: { ids: string[]; status: BulkAction; note: string }[] = [];
  for (let i = 0; i < unique.length; i += BULK_MAX) out.push({ ids: unique.slice(i, i + BULK_MAX), status, note: reason });
  return out;
}

/** "3 issues resolved", "1 issue dismissed". */
export const bulkDoneText = (n: number, status: BulkAction): string => `${n} issue${n === 1 ? "" : "s"} ${status}`;

/** update_issues' answer: how many were done, and the ones that were not with why. */
export interface BulkAnswer {
  done: number;
  failed?: { id: string; error: string }[];
}

/**
 * Sends the calls one after another. After each, the ids it did are handed to `onDone` (the page drops them from the
 * selection, so Try again sends only the rest, never a done one twice); a call that fails, or that leaves some undone,
 * stops there with its error and the count done so far. A failed call did none of its ids (its error is the reason).
 */
export async function sendBulk(
  calls: readonly { ids: string[]; status: BulkAction; note: string }[],
  send: (call: { ids: string[]; status: BulkAction; note: string }) => Promise<BulkAnswer>,
  onDone: (ids: string[]) => void,
): Promise<{ done: number; error: { code: string; message: string } | null }> {
  let done = 0;
  for (const c of calls) {
    let r: BulkAnswer;
    try {
      r = await send(c);
    } catch (e) {
      return { done, error: e as { code: string; message: string } };
    }
    const failed = new Set((r.failed ?? []).map((f) => f.id));
    const did = c.ids.filter((id) => !failed.has(id));
    done += did.length;
    if (did.length) onDone(did);
    if (r.failed?.length) return { done, error: { code: "partial", message: r.failed[0].error } };
  }
  return { done, error: null };
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
export function groupTick(selected: ReadonlySet<string>, ids: readonly string[]): "on" | "mixed" | "off" {
  const n = ids.filter((id) => selected.has(id)).length;
  return n === 0 ? "off" : n === ids.length ? "on" : "mixed";
}

export interface IssueFilters {
  status: IssueStatusFilter;
  kind?: string;
  vehicle?: string;
}

/** Whether an issue belongs under a status filter (Active and Snoozed: open or in progress). */
export function fitsStatus(i: Pick<Issue, "status">, status: IssueStatusFilter): boolean {
  if (status === "all") return true;
  if (status === "active" || status === "snoozed") return isActive(i.status);
  return i.status === status;
}

/**
 * The rows to show, in the server's order. The status is checked here too, so an issue patched after Take, Resolve or
 * Dismiss leaves a list it no longer belongs in at once.
 */
export function listRows(issues: Issue[], f: IssueFilters): Issue[] {
  return issues.filter((i) => fitsStatus(i, f.status) && (!f.kind || i.kind === f.kind) && (!f.vehicle || i.vehicle === f.vehicle));
}

/**
 * The kinds (every kind the centre knows, by name) and the vehicles (the fleet's when known, else those on screen) for
 * the filter selects; a chosen one stays listed when nothing else has it.
 */
export function filterOptions(issues: Issue[], chosen: { kind?: string; vehicle?: string } = {}, fleet?: string[]): { kinds: [string, string][]; vehicles: string[] } {
  const kinds = new Map<string, string>(Object.entries(KIND_TEXT));
  const vehicles = new Set<string>(fleet ?? []);
  for (const i of issues) {
    if (!kinds.has(i.kind)) kinds.set(i.kind, kindText(i));
    if (i.vehicle && !fleet) vehicles.add(i.vehicle);
  }
  if (chosen.kind && !kinds.has(chosen.kind)) kinds.set(chosen.kind, chosen.kind);
  if (chosen.vehicle) vehicles.add(chosen.vehicle);
  return { kinds: [...kinds.entries()].sort((a, b) => a[1].localeCompare(b[1])), vehicles: [...vehicles].sort() };
}

/**
 * The active issues opened outside the chosen days (the server's open / in-progress counts cover every day and leave
 * the snoozed out, as the Active tabs do), in a sentence. Only for the unnarrowed Active, Open and In progress tabs: the
 * list's `total` (else its count) is how many of them the days hold.
 */
export function outsideNote(d: Pick<IssuesList, "open" | "in_progress" | "count" | "total">, status: IssueStatusFilter, narrowed = false): string | undefined {
  if (narrowed || (status !== "active" && status !== "open" && status !== "in_progress")) return undefined;
  const inRange = d.total ?? d.count;
  const all = status === "open" ? d.open : status === "in_progress" ? d.in_progress : d.open + d.in_progress;
  const n = all - inRange;
  if (n <= 0) return undefined;
  const what = status === "open" ? "open" : status === "in_progress" ? "in progress" : "active";
  return n === 1 ? `1 more ${what} issue was opened outside these dates.` : `${n} more ${what} issues were opened outside these dates.`;
}

/** "Snoozed until 2026-10-19 07:00 · by Sahan" on a snoozed row (none when it is not snoozed). */
export function snoozeLine(i: Pick<Issue, "snoozed_until" | "snoozed_by">): string | undefined {
  if (!i.snoozed_until) return undefined;
  return `Snoozed until ${i.snoozed_until}${i.snoozed_by ? ` · by ${i.snoozed_by}` : ""}`;
}

/** Nothing to list, in words that fit the filter, the words searched for and the days. */
export function emptyText(status: IssueStatusFilter, from: string, to: string, narrowed: boolean, search = ""): string {
  const days = rangeText(from, to);
  if (search) return `No issue matches "${search}"${narrowed ? " with the filters chosen" : ""} (${days}).`;
  if (narrowed) return `No issue matches the filters chosen (${days}).`;
  switch (status) {
    case "active":
      return `Nothing needs attention (${days}). The fleet is in order.`;
    case "snoozed":
      return `Nothing is snoozed (${days}).`;
    case "open":
      return `Nothing open (${days}). The fleet is in order.`;
    case "in_progress":
      return `Nothing in progress (${days}).`;
    case "resolved":
      return `Nothing resolved (${days}).`;
    case "dismissed":
      return `Nothing dismissed (${days}).`;
    default:
      return `No issues were opened (${days}).`;
  }
}

/** "Opened 2026-10-18 09:12 · System · Vehicle problem · taken by Sahan 10:05": the list row's second line. */
export function whoLine(i: Issue): string {
  const parts = [`Opened ${i.opened}`, i.opened_by];
  if (i.taken_by) parts.push(`taken by ${i.taken_by.name}${i.taken_by.at ? ` ${i.taken_by.at.slice(-5)}` : ""}`);
  const closedAt = i.resolved_at ?? i.resolved;
  if (!isActive(i.status) && closedAt) parts.push(`${i.status === "dismissed" ? "dismissed" : "closed"} ${closedAt}`);
  return parts.filter(Boolean).join(" · ");
}

/** The issue's facts (§9): opened, opened by, taken by, and when closed, at and by. */
export function issueFacts(i: Issue): [label: string, value: string][] {
  const rows: [string, string][] = [
    ["Opened", i.opened],
    ["Opened by", i.opened_by ?? "System"],
    ["Taken by", i.taken_by ? `${i.taken_by.name}${i.taken_by.at ? ` · ${i.taken_by.at}` : ""}` : i.assigned_to ? i.assigned_to.name : "Nobody yet"],
  ];
  const closedAt = i.resolved_at ?? i.resolved;
  if (!isActive(i.status) && (closedAt || i.resolved_by)) {
    rows.push([i.status === "dismissed" ? "Dismissed" : "Resolved", [closedAt, i.resolved_by ? `by ${i.resolved_by}` : ""].filter(Boolean).join(" ")]);
  }
  return rows;
}

/**
 * update_issue's card in place of the row shown. Its card carries no opened_by / taken_by (only list_issues and
 * issue_history read the events), so the row keeps who opened it, and a new assignee is the taker from `takenAt`
 * until the next refresh brings the server's time.
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

/**
 * A list after one issue changed: the row replaced in place (the bell drops it once closed: it lists the active ones),
 * and the open / in-progress counts moved from the old status to the new one.
 */
export function patchIssues(list: IssuesList, fresh: Issue, oldStatus: string, opts: { activeOnly?: boolean; takenAt?: string } = {}): IssuesList {
  const issues = list.issues
    .map((i) => (i.id === fresh.id ? mergeIssue(i, fresh, opts.takenAt) : i))
    .filter((i) => !opts.activeOnly || isActive(i.status));
  const move = (s: string, by: number) => (s === "open" ? { open: by } : s === "in_progress" ? { in_progress: by } : {});
  const out = { ...list, issues, count: list.count - (list.issues.length - issues.length) };
  if (oldStatus !== fresh.status) {
    const from = move(oldStatus, -1);
    const to = move(fresh.status, 1);
    out.open = Math.max(0, out.open + (from.open ?? 0) + (to.open ?? 0));
    out.in_progress = Math.max(0, out.in_progress + (from.in_progress ?? 0) + (to.in_progress ?? 0));
    // Round 4–7 (item 8): the badge's count (critical and warning) moves when an issue closes or opens again.
    const by = isActive(oldStatus) && !isActive(fresh.status) ? -1 : !isActive(oldStatus) && isActive(fresh.status) ? 1 : 0;
    if (by && fresh.severity !== "info" && out.needs_action !== undefined) out.needs_action = Math.max(0, out.needs_action + by);
    if (by && fresh.severity === "critical" && out.critical !== undefined) out.critical = Math.max(0, out.critical + by);
  }
  return out;
}

/**
 * The number on the menu's badge (Round 4–7, item 8): what needs action (active, not snoozed, critical or warning; the
 * information kinds never), else (an older server) everything open or in progress.
 */
export const bellCount = (list: Pick<IssuesList, "open" | "in_progress" | "needs_action"> | undefined): number =>
  list?.needs_action ?? (list?.open ?? 0) + (list?.in_progress ?? 0);

export const severityTone = (severity?: string): Tone => severity === "critical" ? "bad" : severity === "warning" ? "warn" : "";
export const statusTone = (status?: string): Tone => status === "open" ? "bad" : status === "in_progress" ? "warn" : status === "resolved" ? "ok" : "muted";

/** The sentence under an event in the timeline. */
export function eventText(e: { action: string; actor?: string; note?: string; from?: string; to?: string }): string {
  const who = e.actor ?? "someone";
  switch (e.action) {
    case "opened":
      return `Opened by ${who}`;
    case "assigned":
      return `${who} assigned it to ${e.note ?? "nobody"}`;
    case "note":
      return `${who}: ${e.note ?? ""}`;
    case "status":
      return `${who} set it ${e.from ? `from ${e.from.replace("_", " ")} ` : ""}to ${e.to?.replace("_", " ") ?? "?"}${e.note ? ` · ${e.note}` : ""}`;
    case "auto_resolved":
      return "Resolved by itself: the condition cleared";
    default:
      return `${who}: ${e.action}`;
  }
}
