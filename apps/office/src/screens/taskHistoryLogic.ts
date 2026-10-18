// Tasks → History (Phase 7 §8), pure: the filters as the URL keeps them, the
// tool's input, and the words of a row (tags, route, status) and of the totals.
// Hotfix 3 (L3): a page at a time (ui/ListKit.tsx), the search box (?q= → search)
// and the missed tasks (never started, their leave-by over a day ago).
import type { HistoryTask, TaskHistory, TaskKind } from "../data/types";
import { cap, num, type Tone } from "../lib/format";
import { rangeText } from "../ui/dateRange";

export type KindFilter = "" | TaskKind;
export const KIND_OPTIONS: [KindFilter, string][] = [["", "All"], ["dispatch", "Office tasks"], ["self", "Driver-started"]];

export type StatusFilter = "" | "assigned" | "in_progress" | "completed" | "cancelled" | "declined" | "missed";
export const STATUS_OPTIONS: [StatusFilter, string][] = [
  ["", "All statuses"],
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["declined", "Declined"],
  ["missed", "Missed"],
];

export interface HistoryFilters {
  driver: string;
  vehicle: string;
  status: StatusFilter;
  kind: KindFilter;
}

/** ?driver=&vehicle=&status=&kind= (a status or kind the tool does not know is ignored). */
export function readFilters(params: Pick<URLSearchParams, "get">): HistoryFilters {
  const status = params.get("status") ?? "";
  const kind = params.get("kind") ?? "";
  return {
    driver: params.get("driver") ?? "",
    vehicle: params.get("vehicle") ?? "",
    status: STATUS_OPTIONS.some(([k]) => k === status) ? status as StatusFilter : "",
    kind: KIND_OPTIONS.some(([k]) => k === kind) ? kind as KindFilter : "",
  };
}

/** list_tasks' input: the days and only the filters chosen (and the words searched for). */
export function historyArgs(from: string, to: string, f: HistoryFilters, search = ""): Record<string, unknown> {
  return {
    from,
    to,
    ...(f.driver ? { driver: f.driver } : {}),
    ...(f.vehicle ? { vehicle: f.vehicle } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(search ? { search } : {}),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/**
 * "14 tasks · 9 completed · 2 cancelled · 184 km · 3 driver-started · 1 personal" (the parts that are not zero). A paged
 * answer counts every task the filters match (`total`), not only the page's.
 */
export function totalsLine(d: Pick<TaskHistory, "count" | "totals" | "total">): string {
  const t = d.totals;
  return [
    plural(d.total ?? d.count, "task"),
    t.completed ? `${num(t.completed)} completed` : "",
    t.cancelled ? `${num(t.cancelled)} cancelled` : "",
    t.km ? `${num(t.km)} km` : "",
    t.driver_started ? `${num(t.driver_started)} driver-started` : "",
    t.personal ? `${num(t.personal)} personal` : "",
  ].filter(Boolean).join(" · ");
}

/** The tags beside a title: "Driver-started" for a trip the driver started, "Personal" for a personal one. */
export function tagsOf(t: Pick<HistoryTask, "kind" | "purpose">): { text: string; tone: Tone }[] {
  const tags: { text: string; tone: Tone }[] = [];
  if (t.kind === "self") tags.push({ text: "Driver-started", tone: "live" });
  if (t.purpose === "personal") tags.push({ text: "Personal", tone: "warn" });
  return tags;
}

/** "Head office → Kurunegala site · 4 stops", "Head office", "—". */
export function routeText(t: Pick<HistoryTask, "from" | "to" | "stops_count">): string {
  const line = t.from && t.to ? `${t.from} → ${t.to}` : t.from ?? t.to ?? "—";
  return t.stops_count > 2 ? `${line} · ${t.stops_count} stops` : line;
}

export const STATUS_TONE: Record<string, Tone> = { assigned: "warn", in_progress: "live", completed: "ok", cancelled: "bad", declined: "bad", missed: "bad" };

/** The status chip and the line under it: when it started and finished, or why it was cancelled. */
export function statusOf(t: Pick<HistoryTask, "status" | "started" | "completed" | "cancelled_reason">): { text: string; tone: Tone; sub?: string } {
  const hm = (s?: string) => (s ? s.slice(-5) : "");
  const sub = t.status === "cancelled"
    ? t.cancelled_reason
    : t.started
    ? `${hm(t.started)}–${t.completed ? hm(t.completed) : "now"}`
    : undefined;
  return { text: cap(t.status), tone: STATUS_TONE[t.status] ?? "muted", ...(sub ? { sub } : {}) };
}

/** A row opens the task beside the board of its day (as the duty log does). */
export const taskLink = (t: Pick<HistoryTask, "id" | "date">, today: string) => `/tasks/${t.id}${t.date !== today ? `?date=${t.date}` : ""}`;

/** Nothing found, in words: the words searched for, the filters, the days. */
export function emptyText(from: string, to: string, narrowed: boolean, search = ""): string {
  const days = rangeText(from, to);
  if (search) return `No task matches "${search}"${narrowed ? " with these filters" : ""} (${days}).`;
  return narrowed ? `No task matches these filters (${days}).` : `No tasks (${days}).`;
}
