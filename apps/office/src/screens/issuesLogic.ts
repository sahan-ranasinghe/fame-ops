// Pure rules of the issues centre: the list's filters (Phase 7 §9: the dates on
// opened_at, a status filter, kind and vehicle; Hotfix 3: the active ones by
// default, most urgent first, the snoozed ones on their own tab, severity, the
// order and the search, all asked of the server a page at a time), the issue's
// facts, the in-place patch after a change, the bell's count, tones and the
// timeline's sentences.
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
/** The page opens on everything that still needs attention (open or in progress), the most urgent first. */
export const DEFAULT_STATUS: IssueStatusFilter = "active";
/** The issues page's store entry (the panel patches it after a change) and the bell's (Shell.tsx: active, 10 rows). */
export const ISSUES_KEY = "issuesAll";
export const BELL_KEY = "issues";

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
  }
  return out;
}

/** The number on the bell: everything open or in progress the person may see. */
export const bellCount = (list: Pick<IssuesList, "open" | "in_progress"> | undefined): number => (list?.open ?? 0) + (list?.in_progress ?? 0);

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
