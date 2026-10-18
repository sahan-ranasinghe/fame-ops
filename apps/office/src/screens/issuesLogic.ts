// Pure rules of the issues centre: the list's filters (Phase 7 §9: the dates on
// opened_at, a status filter, kind and vehicle), whether an answer is the one
// asked for, the issue's facts, the in-place patch after a change, the bell's
// count, tones and the timeline's sentences.
import type { Issue, IssuesList } from "../data/types";
import type { Tone } from "../lib/format";
import { rangeText } from "../ui/dateRange";

export type IssueStatusFilter = "open" | "in_progress" | "resolved" | "dismissed" | "all";
export const STATUS_FILTERS: [IssueStatusFilter, string][] = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["resolved", "Resolved"],
  ["dismissed", "Dismissed"],
  ["all", "All"],
];
/** The page opens on the open issues (as the old Open tab did). */
export const DEFAULT_STATUS: IssueStatusFilter = "open";
/** The issues page's store entry (the panel patches it after a change) and the bell's (Shell.tsx: active, 10 rows). */
export const ISSUES_KEY = "issuesAll";
export const BELL_KEY = "issues";
/** list_issues answers at most this many rows. */
export const ISSUES_LIMIT = 200;

export const KIND_TEXT: Record<string, string> = {
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
  // Phase 7.
  vehicle_conflict: "Vehicle taken",
  app_stopped: "App stopped",
  arrival_override: "Arrived away from the stop",
  completed_early: "Completed early",
};

export const kindText = (i: Pick<Issue, "kind" | "kind_text">) => i.kind_text ?? KIND_TEXT[i.kind] ?? i.kind;

const ACTIVE = new Set(["open", "in_progress"]);
export const isActive = (status?: string) => ACTIVE.has(status ?? "");

/** ?status=…; the old links' ?tab=resolved / ?tab=in_progress still work. Anything else: the default. */
export function readStatus(params: Pick<URLSearchParams, "get">): IssueStatusFilter {
  const asked = params.get("status") ?? params.get("tab");
  return STATUS_FILTERS.some(([k]) => k === asked) ? asked as IssueStatusFilter : DEFAULT_STATUS;
}

/** list_issues' input for the list: the status, the opened_at days, newest first. Kind and vehicle are narrowed on screen. */
export function issuesArgs(status: IssueStatusFilter, from: string, to: string): Record<string, unknown> {
  return { status, from, to, sort: "newest", limit: ISSUES_LIMIT };
}

/** Whether the answer on screen is the one for these filters (another one stays on screen, marked "Updating…", until it lands). */
export function answerFor(d: Pick<IssuesList, "status" | "from" | "to" | "sort">, want: { status: string; from: string; to: string }): boolean {
  return d.status === want.status && d.from === want.from && d.to === want.to && d.sort === "newest";
}

export interface IssueFilters {
  status: IssueStatusFilter;
  kind?: string;
  vehicle?: string;
}

/**
 * The rows to show, in the server's order (newest first). The status is checked here too, so an issue patched after
 * Take, Resolve or Dismiss leaves a list it no longer belongs in at once.
 */
export function listRows(issues: Issue[], f: IssueFilters): Issue[] {
  return issues.filter((i) => (f.status === "all" || i.status === f.status) && (!f.kind || i.kind === f.kind) && (!f.vehicle || i.vehicle === f.vehicle));
}

/** The kinds and vehicles present, for the filter selects (a chosen one stays listed when no row has it). */
export function filterOptions(issues: Issue[], chosen: { kind?: string; vehicle?: string } = {}): { kinds: [string, string][]; vehicles: string[] } {
  const kinds = new Map<string, string>();
  const vehicles = new Set<string>();
  for (const i of issues) {
    kinds.set(i.kind, kindText(i));
    if (i.vehicle) vehicles.add(i.vehicle);
  }
  if (chosen.kind && !kinds.has(chosen.kind)) kinds.set(chosen.kind, KIND_TEXT[chosen.kind] ?? chosen.kind);
  if (chosen.vehicle) vehicles.add(chosen.vehicle);
  return { kinds: [...kinds.entries()].sort((a, b) => a[1].localeCompare(b[1])), vehicles: [...vehicles].sort() };
}

/**
 * The active issues opened outside the chosen days (the server's open / in-progress counts cover every day), in a
 * sentence; none when the list was cut at the limit (the count would be wrong) or the filter shows no active issues.
 */
export function outsideNote(d: Pick<IssuesList, "open" | "in_progress" | "issues" | "count">, status: IssueStatusFilter): string | undefined {
  if (d.count >= ISSUES_LIMIT || status === "resolved" || status === "dismissed") return undefined;
  const inRange = (s: string) => d.issues.filter((i) => i.status === s).length;
  const n = status === "open" ? d.open - inRange("open")
    : status === "in_progress" ? d.in_progress - inRange("in_progress")
    : d.open + d.in_progress - inRange("open") - inRange("in_progress");
  if (n <= 0) return undefined;
  const what = status === "open" ? "open" : status === "in_progress" ? "in progress" : "active";
  return n === 1 ? `1 more ${what} issue was opened outside these dates.` : `${n} more ${what} issues were opened outside these dates.`;
}

/** The list was cut at the limit: say so. */
export const limitNote = (d: Pick<IssuesList, "count">): string | undefined =>
  d.count >= ISSUES_LIMIT ? `Showing the newest ${ISSUES_LIMIT}: pick fewer days or a status to see the rest.` : undefined;

/** Nothing to list, in words that fit the filter and the days. */
export function emptyText(status: IssueStatusFilter, from: string, to: string, narrowed: boolean): string {
  const days = rangeText(from, to);
  if (narrowed) return `No issue matches the kind and vehicle chosen (${days}).`;
  switch (status) {
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
