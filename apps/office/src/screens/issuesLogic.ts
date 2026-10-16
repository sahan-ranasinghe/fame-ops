// Pure rules of the issues centre: tabs, filters, the bell's count, tones.
import type { Issue, IssuesList } from "../data/types";
import type { Tone } from "../lib/format";

export type IssueTab = "open" | "in_progress" | "resolved";
export const TABS: [IssueTab, string][] = [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]];

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

/** Which tab an issue belongs to (resolved and dismissed share one). */
export const tabOf = (status: string): IssueTab => status === "open" ? "open" : status === "in_progress" ? "in_progress" : "resolved";

export interface IssueFilters {
  tab: IssueTab;
  kind?: string;
  vehicle?: string;
}

/** The tab's issues, narrowed by kind and vehicle; the active ones most urgent first, the closed ones newest first. */
export function filterIssues(issues: Issue[], f: IssueFilters): Issue[] {
  const rows = issues.filter((i) => tabOf(i.status) === f.tab && (!f.kind || i.kind === f.kind) && (!f.vehicle || i.vehicle === f.vehicle));
  if (f.tab === "resolved") return rows.sort((a, b) => (b.resolved ?? b.updated).localeCompare(a.resolved ?? a.updated));
  return rows;
}

/** Counts per tab (for the chips) from one list of everything. */
export function tabCounts(issues: Issue[]): Record<IssueTab, number> {
  const c: Record<IssueTab, number> = { open: 0, in_progress: 0, resolved: 0 };
  for (const i of issues) c[tabOf(i.status)] += 1;
  return c;
}

/** The kinds and vehicles present, for the filter selects. */
export function filterOptions(issues: Issue[]): { kinds: [string, string][]; vehicles: string[] } {
  const kinds = new Map<string, string>();
  const vehicles = new Set<string>();
  for (const i of issues) {
    kinds.set(i.kind, kindText(i));
    if (i.vehicle) vehicles.add(i.vehicle);
  }
  return { kinds: [...kinds.entries()].sort((a, b) => a[1].localeCompare(b[1])), vehicles: [...vehicles].sort() };
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
