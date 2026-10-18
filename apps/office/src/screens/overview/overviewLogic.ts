// The Overview's rules (Hotfix 3, L1 and L2), pure: which sections a person sees and in what order (action first, by
// what they may do), how many rows a section shows, the "View all (N)" words, the requests tile's line, the rows of
// Needs attention and Critical issues and what Snooze or Dismiss acts on, the Overview after issues were acted on (the
// rows go at once; the refresh brings the server's own counts), and My trips' rows.
import type { Attention, AttentionGroup, CreatedTaskCard, Overview, RequestCard, TripLive } from "../../data/types";
import { addDays, joinDots } from "../../lib/format";
import { can, type Me } from "../../transport/types";
import { isRequestTrip, liveOf } from "../myTripsLogic";

/** The Overview's sections; the keys are the ones prefs.overview_collapsed holds. */
export type OverviewSection = "requests" | "needs_driver" | "critical" | "tiles" | "road" | "attention" | "my_trips";

export const SECTION_TITLE: Record<OverviewSection, string> = {
  requests: "Requests to approve",
  needs_driver: "Needs a driver",
  critical: "Critical issues",
  tiles: "At a glance",
  road: "On the road",
  attention: "Needs attention",
  my_trips: "My trips",
};

/** At most this many rows in a section: a desktop shows 5, a phone 3 (the page stays about two screens high). */
export const SECTION_ROWS = { desktop: 5, phone: 3 } as const;
export const rowsFor = (phone: boolean): number => (phone ? SECTION_ROWS.phone : SECTION_ROWS.desktop);

/**
 * The sections for this person, in order (L1):
 * - approve: Requests to approve → Needs a driver → Critical issues → the tiles → On the road → Needs attention;
 * - assign_tasks (no approve): Needs a driver → Critical issues → the tiles → On the road → Needs attention;
 * - request (neither): My trips → the tiles (→ the issues sections, with the issues permission);
 * - view only: the tiles → On the road (→ the issues sections, with the issues permission).
 * Critical issues and Needs attention need issues or assign_tasks (the server answers each person's own share); My
 * trips needs the my_trips tool. Sections with nothing to show are left out by the page, not here.
 */
export function overviewSections(me: Pick<Me, "permissions" | "tools">): OverviewSection[] {
  const issues = can(me, "issues", "assign_tasks");
  const critical: OverviewSection[] = issues ? ["critical"] : [];
  const attention: OverviewSection[] = issues ? ["attention"] : [];
  if (can(me, "approve")) return ["requests", "needs_driver", ...critical, "tiles", "road", ...attention];
  if (can(me, "assign_tasks")) return ["needs_driver", ...critical, "tiles", "road", ...attention];
  if (can(me, "request") && me.tools.includes("my_trips")) return ["my_trips", ...critical, "tiles", ...attention];
  return [...critical, "tiles", "road", ...attention];
}

/** Sections that take a whole line on a desktop; the others go two to a line, an odd one out takes the line. */
export const WIDE: ReadonlySet<OverviewSection> = new Set(["tiles", "critical"]);

/**
 * The sections in lines of the desktop's two columns, in order: a wide one alone; the others in pairs; a run with an odd
 * count ends with one alone (no hole beside it).
 */
export function inLines(sections: OverviewSection[]): OverviewSection[][] {
  const lines: OverviewSection[][] = [];
  let run: OverviewSection[] = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += 2) lines.push(run.slice(i, i + 2));
    run = [];
  };
  for (const s of sections) {
    if (WIDE.has(s)) {
      flush();
      lines.push([s]);
    } else run.push(s);
  }
  flush();
  return lines;
}

/** "View all (12)"; without a number when it is not known. */
export const viewAll = (n?: number | null): string => (typeof n === "number" ? `View all (${n})` : "View all");

/**
 * The line under "Requests to approve" (the tile and the panel): "Nothing waiting" only when nothing waits (proposed
 * tasks and changed bookings count); the oldest one's wait when the server says it; else "Waiting for a decision" (an
 * answer without the age never says "Nothing waiting" beside a count: the Teams copy built before 18 October read
 * `requests.oldest`, which the server never sent, and showed "1 open · Nothing waiting").
 */
export function requestsLine(r: Pick<Overview["requests"], "waiting" | "oldest_waiting"> | undefined): string {
  if (!r || !(r.waiting > 0)) return "Nothing waiting";
  return r.oldest_waiting ? `Oldest waiting ${r.oldest_waiting}` : "Waiting for a decision";
}

/** One row of Needs attention or Critical issues: a group of one kind, or one issue. */
export interface IssueRow {
  key: string;
  title: string;
  /** How many issues it stands for (1 for an issue). */
  count: number;
  severity: "critical" | "warning" | string;
  /** The line under the title: one issue's subject and due; a group's plate or nothing. */
  sub?: string;
  due?: string;
  /** The issues Snooze and Dismiss act on. */
  ids: string[];
  /** One issue: its page. */
  to?: string;
  /** A group: its issues, shown when it is expanded. */
  items?: Attention[];
  kind?: string;
}

/** The issue ids of a list of items (an item without one cannot be acted on). */
const idsOf = (items: Attention[]): string[] => items.map((a) => a.issue_id).filter((x): x is string => !!x);

export function itemRow(a: Attention, i = 0): IssueRow {
  return {
    key: a.issue_id ?? `${a.kind ?? "item"}:${i}`,
    title: a.what,
    count: 1,
    severity: a.severity ?? (a.level === "red" ? "critical" : "warning"),
    sub: joinDots([a.vehicle && !String(a.subject ?? "").includes(a.vehicle) ? a.vehicle : null, a.subject]) || undefined,
    due: a.due || undefined,
    ids: a.issue_id ? [a.issue_id] : [],
    to: a.issue_id ? `/issues/${a.issue_id}` : undefined,
    kind: a.kind,
  };
}

/** A group of Needs attention: one issue stays a plain row; more expand in place. */
export function groupRow(g: AttentionGroup): IssueRow {
  if (g.count <= 1 && g.items.length === 1) return { ...itemRow(g.items[0]), key: g.key, title: g.title || g.items[0].what };
  const ids = g.issue_ids?.length ? g.issue_ids : idsOf(g.items);
  return { key: g.key, title: g.title, count: g.count, severity: g.severity, sub: g.vehicle, ids, items: g.items, kind: g.kind };
}

/** The kinds another section shows (Requests to approve, Needs a driver): never again in Needs attention. */
const OWN_SECTION = new Set(["request_waiting", "not_accepted", "declined"]);
const severityOf = (a: Attention) => a.severity ?? (a.level === "red" ? "critical" : "warning");

/**
 * Critical issues: the server's `critical` (the critical active issues not snoozed, at most 5, and how many). An older
 * answer has only needs_attention: its critical items then, without the kinds another section shows.
 */
export function criticalOf(o: Overview): { count: number; items: Attention[] } {
  if (o.critical) return o.critical;
  const items = o.needs_attention.filter((a) => severityOf(a) === "critical" && !OWN_SECTION.has(a.kind ?? ""));
  return { count: items.length, items };
}

/**
 * Needs attention: the server's groups (critical and warning, nothing another section shows, snoozed ones left out). An
 * older answer: its warning items, one row each, without the kinds another section shows; info stays on Issues.
 */
export function attentionOf(o: Overview): { count: number; rows: IssueRow[] } {
  if (o.attention) return { count: o.attention.count, rows: o.attention.groups.map(groupRow) };
  const items = o.needs_attention.filter((a) => severityOf(a) === "warning" && !OWN_SECTION.has(a.kind ?? ""));
  return { count: items.length, rows: items.map(itemRow) };
}

/** A group expanded shows at most this many of its issues, then "N more on Issues". */
export const GROUP_ITEMS = 10;

/** Where a group's "more on Issues" goes: the Issues page filtered to its kind. */
export const kindLink = (kind?: string): string => (kind ? `/issues?kind=${encodeURIComponent(kind)}` : "/issues");

/** The words of an action on one or more issues: what the toast says when it worked. */
export function actedText(action: "tomorrow" | "week" | "dismiss", n: number): string {
  const what = n === 1 ? "1 issue" : `${n} issues`;
  if (action === "dismiss") return `Dismissed ${what}`;
  return action === "tomorrow" ? `Snoozed ${what} until tomorrow 07:00` : `Snoozed ${what} for a week`;
}

/**
 * The Overview after these issues were snoozed or dismissed: their rows leave Needs attention, Critical issues and the
 * reminders' list at once, and the counts drop; the next refresh brings the server's own answer. A new object (the store
 * keeps the old one for anyone still holding it).
 */
export function withoutIssues(o: Overview, ids: readonly string[]): Overview {
  const gone = new Set(ids);
  if (gone.size === 0) return o;
  const keep = (a: Attention) => !a.issue_id || !gone.has(a.issue_id);
  const out: Overview = { ...o, needs_attention: o.needs_attention.filter(keep) };
  if (o.attention) {
    let removed = 0;
    const groups: AttentionGroup[] = [];
    for (const g of o.attention.groups) {
      const items = g.items.filter(keep);
      const issueIds = (g.issue_ids ?? []).filter((id) => !gone.has(id));
      const left = Math.max(0, g.count - (g.items.length - items.length));
      removed += g.count - left;
      // One issue left: its own words until the refresh brings the server's.
      const shrunk = items.length < g.items.length;
      if (left > 0 && items.length > 0) groups.push({ ...g, items, issue_ids: issueIds, count: left, ...(shrunk && left === 1 && items.length === 1 ? { title: items[0].what } : {}) });
    }
    out.attention = { count: Math.max(0, o.attention.count - removed), groups };
  }
  if (o.critical) {
    const items = o.critical.items.filter(keep);
    out.critical = { count: Math.max(0, o.critical.count - (o.critical.items.length - items.length)), items };
  }
  if (o.reminders) out.reminders = { ...o.reminders, count: Math.max(0, o.reminders.count - (o.needs_attention.length - out.needs_attention.length)) };
  return out;
}

/** My trips on the Overview: the last 30 days and the next 30, the newest 5 (the server pages with limit). */
export const myTripsArgs = (day: string, limit: number): Record<string, unknown> => ({ from: addDays(day, -30), to: addDays(day, 30), limit });

export interface TripRow {
  key: string;
  to: string;
  title: string;
  sub: string;
  live: TripLive;
}

/** A trip's row: a request or proposal opens its page under My trips; a task the person created opens the task. */
export function tripRow(t: RequestCard | CreatedTaskCard): TripRow {
  if (!isRequestTrip(t)) {
    return { key: `task:${t.id}`, to: `/tasks/${t.task_id || t.id}`, title: t.title, sub: joinDots([t.when, t.route]), live: t.live };
  }
  const title = t.kind === "task" ? t.title || "Proposed task" : t.route || t.need || "Vehicle request";
  return { key: t.id, to: `/my-trips/${t.id}`, title, sub: joinDots([t.when, t.kind === "task" ? t.route : t.need]), live: liveOf(t) };
}
