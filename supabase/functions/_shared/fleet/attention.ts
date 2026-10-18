// Hotfix 3 (L1, L2): the Overview's Needs attention and Critical issues, from the active issues the person may see.
// Pure (the tests run it with no database):
// - nothing another Overview section shows: requests waiting (Requests to approve), tasks declined or not accepted (Needs
//   a driver), and, for the people whose Overview has Critical issues, the critical ones;
// - critical and warning only (info stays on Issues and Reminders); snoozed ones are left out before this is called;
// - items of one kind become one group with the count ("Odometer typed by hand · 9", "Documents missing on 3 vehicles"),
//   most urgent first; a kind with one item stays its own row.

export interface AttentionItem {
  what: string;
  subject: string;
  vehicle?: string;
  due: string;
  level: string;
  issue_id: string;
  kind: string;
  severity: string;
}

export interface AttentionGroup {
  key: string;
  kind: string;
  title: string;
  count: number;
  severity: "critical" | "warning";
  issue_ids: string[];
  items: AttentionItem[];
  vehicle?: string;
}

/** Which sections the person's Overview has (the same rule as the page: L1). */
export interface Sections {
  /** Requests to approve (approve). */
  requests: boolean;
  /** Needs a driver (approve or assign_tasks). */
  needsDriver: boolean;
  /** Critical issues (the issues or the assign_tasks permission). */
  critical: boolean;
}

const IN_REQUESTS = new Set(["request_waiting"]);
const IN_NEEDS_DRIVER = new Set(["not_accepted", "declined"]);
const RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

/** True when another section of this person's Overview already shows the item. */
function elsewhere(i: AttentionItem, s: Sections): boolean {
  return (s.requests && IN_REQUESTS.has(i.kind)) || (s.needsDriver && IN_NEEDS_DRIVER.has(i.kind));
}

/** The group's words: "Odometer typed by hand · 9", "Documents missing on 3 vehicles", "Km outside tasks · 2 vehicles". */
export function groupTitle(kind: string, items: readonly AttentionItem[], kindText: Record<string, string>): string {
  const n = items.length;
  const vehicles = new Set(items.map((i) => i.vehicle).filter(Boolean)).size;
  switch (kind) {
    case "odometer_flag":
      return items.every((i) => /typed/i.test(i.what)) ? `Odometer typed by hand · ${n}` : `Odometer checks · ${n}`;
    case "documents_missing":
      return `Documents missing on ${vehicles || n} vehicle${(vehicles || n) === 1 ? "" : "s"}`;
    case "km_gap":
      return `Km outside tasks · ${vehicles || n} vehicle${(vehicles || n) === 1 ? "" : "s"}`;
    case "service_due":
      return `Service due · ${vehicles || n} vehicle${(vehicles || n) === 1 ? "" : "s"}`;
    case "document":
      return `Documents due · ${n}`;
    case "missed_task":
      return `Missed tasks · ${n}`;
    default:
      return `${kindText[kind] ?? kind} · ${n}`;
  }
}

/** Needs attention for one person: their visible, not snoozed, active items in urgency order. */
export function attentionGroups(
  items: readonly AttentionItem[],
  s: Sections,
  kindText: Record<string, string>,
): { count: number; groups: AttentionGroup[] } {
  const kept = items.filter((i) => RANK[i.severity] >= RANK.warning && !elsewhere(i, s) && !(s.critical && i.severity === "critical"));
  const byKind = new Map<string, AttentionItem[]>();
  for (const i of kept) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
  const groups: AttentionGroup[] = [];
  const done = new Set<string>();
  for (const i of kept) {
    if (done.has(i.kind)) continue;
    done.add(i.kind);
    const all = byKind.get(i.kind)!;
    const severity = all.some((x) => x.severity === "critical") ? "critical" : "warning";
    const vehicles = [...new Set(all.map((x) => x.vehicle).filter(Boolean))];
    groups.push({
      key: i.kind,
      kind: i.kind,
      title: all.length === 1 ? i.what : groupTitle(i.kind, all, kindText),
      count: all.length,
      severity,
      issue_ids: all.map((x) => x.issue_id),
      items: all,
      vehicle: vehicles.length === 1 ? vehicles[0] : undefined,
    });
  }
  return { count: kept.length, groups };
}

/** Critical issues for one person: the critical ones no other section shows; at most `max`, with the count. */
export function criticalItems(items: readonly AttentionItem[], s: Sections, max = 5): { count: number; items: AttentionItem[] } {
  const all = items.filter((i) => i.severity === "critical" && !elsewhere(i, s));
  return { count: all.length, items: all.slice(0, max) };
}
