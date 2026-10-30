// Phase 7 (§16): the Overview's tiles open their lists. On a desktop a tile opens a side panel beside the Overview and the
// open list is in the URL (/?open=road), so a reload or a shared link opens it again; on a phone (and for a shared link
// opened on one) the tile goes to the full page (/live?filter=road, /vehicles?filter=free …) and Back returns to the
// Overview. The list screens read the same words from their URL (`filter`) and write them when a chip changes. Pure.
import { ISSUES_NEED } from "../app/nav";
import type { LiveFilter } from "../data/live";
import type { Attention } from "../data/types";
import { can, type Me } from "../transport/types";

export type OverviewOpen = "road" | "free" | "garage" | "tasks" | "requests" | "reminders";
export const OVERVIEW_OPENS: readonly OverviewOpen[] = ["road", "free", "garage", "tasks", "requests", "reminders"];

export const isOverviewOpen = (s: string | null | undefined): s is OverviewOpen => !!s && (OVERVIEW_OPENS as readonly string[]).includes(s);

/** Each tile's full page: the phone's link, the panel's "Open the full page". */
export const FULL_PATH: Record<OverviewOpen, string> = {
  road: "/live?filter=road",
  free: "/vehicles?filter=free",
  garage: "/vehicles?filter=garage",
  tasks: "/tasks",
  requests: "/requests",
  reminders: "/reminders",
};

/** The panel's title and the full page's name ("Open Live locations"). */
export const OPEN_TEXT: Record<OverviewOpen, { title: string; page: string }> = {
  road: { title: "Vehicles on the road", page: "Live locations" },
  free: { title: "Free now", page: "Vehicles" },
  garage: { title: "In garage", page: "Vehicles" },
  tasks: { title: "Tasks today", page: "Tasks" },
  requests: { title: "Requests to approve", page: "Requests" },
  reminders: { title: "Reminders", page: "Reminders" },
};

/**
 * Whether the tile opens anything for this person: the list's own page and tool (the routes' guards), else the tile stays
 * a plain number. Requests and Reminders are shown only to the people whose block they are (approve; issues or
 * assign_tasks), so a link to someone else's list is never made.
 */
export function canOpen(me: Pick<Me, "permissions" | "tools">, open: OverviewOpen): boolean {
  const tool = (t: string) => me.tools.includes(t);
  switch (open) {
    case "road":
      return can(me, "view");
    case "free":
    case "garage":
      return can(me, "view") && tool("list_vehicles");
    case "tasks":
      return can(me, "assign_tasks") && tool("task_board");
    case "requests":
      return can(me, "approve") && tool("list_requests");
    case "reminders":
      return can(me, ...ISSUES_NEED) && tool("fleet_overview");
  }
}

/** Where a tile goes: the side panel on a desktop (the open list in the URL), the full page on a phone. */
export const tileTarget = (open: OverviewOpen, phone: boolean): string => (phone ? FULL_PATH[open] : `/?open=${open}`);

/** The `open` the URL asks for, when this person may open it; anything else is ignored (no panel). */
export function openFrom(params: URLSearchParams, me: Pick<Me, "permissions" | "tools">): OverviewOpen | null {
  const o = params.get("open");
  return isOverviewOpen(o) && canOpen(me, o) ? o : null;
}

// ---- The list screens' filters in the URL (`?filter=`); "all" is no parameter. ----

/** A chip key ↔ its word in the URL. */
export type FilterWords<K extends string> = Record<K, string | null>;

/** Live with the driver on a task selected (the task page's on-the-way banner): /live?task=<id>. */
export const liveForTask = (taskId: string): string => `/live?task=${encodeURIComponent(taskId)}`;

/**
 * The driver Live selects first: the one on the task the URL names (?task=, from a task page), else the first of the chip
 * in the URL (the Overview's "on the road"), else anyone.
 */
export function firstSelected<T extends { task_id?: string }>(all: readonly T[], shown: readonly T[], task: string | null | undefined): T | undefined {
  return (task ? all.find((x) => x.task_id === task) : undefined) ?? shown[0] ?? all[0];
}

/** Live locations: the Overview's "on the road" is the chip On a task. */
export const LIVE_FILTER_WORDS: FilterWords<LiveFilter> = { all: null, on_task: "road", on_duty: "on_duty", off_duty: "off_duty", problems: "problems" };

export type VehicleFilter = "all" | "on_task" | "available" | "in_garage" | "documents_expiring" | "inactive";
export const VEHICLE_FILTERS: [VehicleFilter, string][] = [
  ["all", "All"],
  ["on_task", "On a task"],
  ["available", "Available"],
  ["in_garage", "In garage"],
  ["documents_expiring", "Documents expiring"],
  ["inactive", "Archived (returned)"],
];
/** Vehicles: the Overview's "free now" is the chip Available, "in garage" In garage. */
export const VEHICLE_FILTER_WORDS: FilterWords<VehicleFilter> = {
  all: null,
  on_task: "on_task",
  available: "free",
  in_garage: "garage",
  documents_expiring: "documents",
  inactive: "returned",
};

/** The chip a URL word names (the word, or the chip's own key); anything else is All. */
export function filterFromWord<K extends string>(words: FilterWords<K>, value: string | null | undefined, all: K): K {
  if (!value) return all;
  const keys = Object.keys(words) as K[];
  return keys.find((k) => words[k] === value) ?? keys.find((k) => k === value) ?? all;
}

/** The URL's parameters with one changed (null removes it); every other parameter is kept. A new object. */
export function withParam(params: URLSearchParams, name: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null || value === "") next.delete(name);
  else next.set(name, value);
  return next;
}

// ---- Reminders (/reminders and the panel): fleet_overview's needs_attention, the list the tile counts. ----

/** The kinds about one vehicle: the issue's detail starts with its plate ("WP CAB-4521 · Toyota HiAce"). */
const VEHICLE_KINDS = new Set(["document", "documents_missing", "service_due", "rental", "garage_booked", "allowance"]);
/** Documents and services due (and the driver's licence): the reminders proper, first on the page. */
const DUE_KINDS = new Set([...VEHICLE_KINDS, "licence"]);

/**
 * Round 4–7 (item 8, §33.7): Reminders and Maintenance hold only service and documents (Fleetio). These kinds are the
 * reminders shown per vehicle and counted on the tile; the driver's licence is a document too (its own rows); everything
 * else (the km allowance, missed tasks, odometer checks…) is in Issues, counted on the page's link there.
 */
export const CARE_KINDS = new Set(["document", "documents_missing", "service_due", "rental", "garage_booked"]);
export const isReminderKind = (kind?: string): boolean => !!kind && (CARE_KINDS.has(kind) || kind === "licence");

/**
 * The Reminders tile's numbers (Round 4–7, item 8): the service and document reminders the page shows (and how many are
 * red), not every issue the overview lists (those are counted on Issues' badge).
 */
export function reminderTile(items: readonly Pick<Attention, "kind" | "level">[] | undefined): { count: number; red: number } {
  const mine = (items ?? []).filter((a) => isReminderKind(a.kind));
  return { count: mine.length, red: mine.filter((a) => a.level === "red").length };
}

/**
 * The reminders in numbers (the fresh reviewer, 22 October 2026: the tile said 3, the panel 1): how many reminders (the
 * tile's number, reminderTile), on how many vehicles, and how many drivers' licences.
 */
export function reminderCounts(items: readonly Attention[] | undefined): { reminders: number; vehicles: number; licences: number } {
  const mine = (items ?? []).filter((a) => isReminderKind(a.kind));
  const plates = new Set(reminderGroups(mine).due.flatMap((r) => (r.plate ? [r.plate] : [])));
  return { reminders: mine.length, vehicles: plates.size, licences: mine.filter((a) => a.kind === "licence").length };
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 reminders · 1 vehicle · 1 driver licence": the panel's and the page's first line, the tile's number first. */
export function reminderSummary(c: { reminders: number; vehicles: number; licences: number }): string {
  return [counted(c.reminders, "reminder"), c.vehicles ? counted(c.vehicles, "vehicle") : "", c.licences ? counted(c.licences, "driver licence") : ""]
    .filter(Boolean).join(" · ");
}

export interface ReminderRow {
  what: string;
  /** The vehicle's plate, when the reminder is about one. */
  plate?: string;
  /** Who or what else it is about (the model, the km to go, the driver). */
  subject?: string;
  due?: string;
  level?: string;
  /** Where the row goes: the vehicle's page, else the issue's. */
  to?: string;
  key: string;
}

export interface ReminderGroups {
  /** Documents, services, rentals, garage bookings, km allowances and licences: with the vehicle and the date. */
  due: ReminderRow[];
  /** Everything else the tile counts (vehicle problems, odometer checks, late tasks …): each opens its issue. */
  other: ReminderRow[];
}

/**
 * The reminders as the tile counts them, in the server's order (the soonest due first, overdue at the top), split into
 * the documents and services due and the rest. A vehicle's row links to the vehicle; any other row to its issue.
 */
export function reminderGroups(items: Attention[] | undefined): ReminderGroups {
  const out: ReminderGroups = { due: [], other: [] };
  (items ?? []).forEach((a, i) => {
    const vehicleKind = !!a.kind && VEHICLE_KINDS.has(a.kind);
    const [head, ...rest] = a.subject ? String(a.subject).split(" · ") : [];
    // A vehicle reminder: the server names the plate (vehicle); an older answer has it first in the subject ("WP CAB-4521 · …").
    const plate = vehicleKind ? a.vehicle ?? (head?.trim() || undefined) : undefined;
    const subject = plate && head?.trim() === plate ? rest.join(" · ") || undefined : a.subject || undefined;
    const row: ReminderRow = {
      what: a.what,
      plate,
      subject,
      due: a.due || undefined,
      level: a.level,
      to: plate ? `/vehicles/${encodeURIComponent(plate)}` : a.issue_id ? `/issues/${a.issue_id}` : undefined,
      key: a.issue_id ?? `${i}`,
    };
    (a.kind && DUE_KINDS.has(a.kind) ? out.due : out.other).push(row);
  });
  return out;
}
