// "Where" suggestions (Phase 9 Round 1, item 6; docs/ui-patterns.md "Where suggestions"), the pattern of Google Maps' and
// Uber's destination box: an empty box shows at most 5 rows, our places first (offices first, as search_places {suggest}
// ranks them), then the 3 places used most recently; each row has an icon (a building for ours, a clock for a recent
// one), never a text badge; no towns until the person types; "More places" under the list opens the rest in place
// (Google Maps' "More from recent history"). The same rules as the app's src/lib/placeSuggestLogic.ts. Pure (Vitest).

/** Rows an empty box shows. */
export const WHERE_MAX_ROWS = 5;
/** Of which, at most, the places used before. */
export const WHERE_MAX_RECENT = 3;
/** "More places" shows at most this many in all. */
export const MORE_PLACES_MAX = 50;

export type WhereIcon = "building" | "clock";

export interface WhereRow<T> {
  item: T;
  icon: WhereIcon;
  /** Round 4–7 (item 10): the row's group in an empty box (a small header above its first row); none = no headers. */
  group?: WhereGroup;
  /** The group's header words ("Saved", "Recent", "Anoja's recent"). */
  label?: string;
}

/**
 * Round 4–7 (item 10; Uber's and Google Maps' empty destination box): search_places {suggest} answers each row's group:
 * saved (the company's places), recent (the person's OWN), for (the trip's person's, when someone else's trip is edited
 * or decided: "Anoja's recent").
 */
export type WhereGroup = "saved" | "recent" | "for";
export const WHERE_GROUPS: readonly WhereGroup[] = ["saved", "recent", "for"];
/** An empty box with groups shows at most this many ("about 5": 2 saved + 3 recent, or 2 + 2 + 2 for someone else's trip). */
export const SUGGEST_MAX_ROWS = 7;
const GROUP_WORDS: Record<WhereGroup, string> = { saved: "Saved", recent: "Recent", for: "Their recent" };

export interface WhereLists<T> {
  top: WhereRow<T>[];
  more: WhereRow<T>[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Ours first, then at most 3 recent, 5 rows in all; a recent place that is also one of ours shows once (as ours). */
export function whereRows<T>(ours: readonly T[], recent: readonly T[], nameOf: (item: T) => string): WhereLists<T> {
  const ourNames = new Set(ours.map((o) => norm(nameOf(o))));
  const seen = new Set<string>();
  const recentOnly = recent.filter((r) => {
    const n = norm(nameOf(r));
    if (ourNames.has(n) || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  const recentTop = recentOnly.slice(0, WHERE_MAX_RECENT);
  const oursTop = ours.slice(0, WHERE_MAX_ROWS - recentTop.length);
  const building = (item: T): WhereRow<T> => ({ item, icon: "building" });
  const clock = (item: T): WhereRow<T> => ({ item, icon: "clock" });
  const top = [...oursTop.map(building), ...recentTop.map(clock)];
  const more = [...ours.slice(oursTop.length).map(building), ...recentOnly.slice(recentTop.length).map(clock)]
    .slice(0, Math.max(0, MORE_PLACES_MAX - top.length));
  return { top, more };
}

/** search_places {suggest}: our places and the recent ones; towns (and anything else) left out. */
export function splitSuggestions<T extends { layer: string }>(results: readonly T[]): { ours: T[]; recent: T[] } {
  return { ours: results.filter((r) => r.layer === "place"), recent: results.filter((r) => r.layer === "recent") };
}

/** A row's group: the server's, else (an older answer) by its layer; towns and the rest have none. */
export function groupOf(r: { layer: string; group?: string }): WhereGroup | null {
  if (r.group === "saved" || r.group === "recent" || r.group === "for") return r.group;
  return r.layer === "place" ? "saved" : r.layer === "recent" ? "recent" : null;
}

/**
 * An empty box's rows from search_places {suggest}. With the server's groups (Round 4–7): Saved, Recent, then
 * "<Name>'s recent", each under its header, in the server's order; a name already shown is not repeated; at most
 * SUGGEST_MAX_ROWS, the rest under More places. An answer without groups: ours then 3 recent (whereRows), no headers.
 */
export function groupedWhere<T extends { layer: string; group?: string; group_label?: string }>(results: readonly T[], nameOf: (item: T) => string): WhereLists<T> {
  if (!results.some((r) => r.group)) {
    const { ours, recent } = splitSuggestions(results);
    return whereRows(ours, recent, nameOf);
  }
  const seen = new Set<string>();
  const rows: WhereRow<T>[] = [];
  for (const g of WHERE_GROUPS) {
    for (const r of results) {
      if (groupOf(r) !== g) continue;
      const n = norm(nameOf(r));
      if (seen.has(n)) continue;
      seen.add(n);
      rows.push({ item: r, icon: g === "saved" ? "building" : "clock", group: g, label: r.group_label?.trim() || GROUP_WORDS[g] });
    }
  }
  return { top: rows.slice(0, SUGGEST_MAX_ROWS), more: rows.slice(SUGGEST_MAX_ROWS, MORE_PLACES_MAX) };
}

/** Does row i start a group (its header goes above it)? Only rows with a group have headers. */
export const startsGroup = <T>(rows: readonly WhereRow<T>[], i: number): boolean =>
  !!rows[i]?.group && (i === 0 || rows[i - 1].group !== rows[i].group || rows[i - 1].label !== rows[i].label);

/**
 * The request someone else edits or decides: its requester's recent places come too. Only through the request (the server
 * took for_person away on 22 October 2026: a person's recent places come only from the request being edited or decided,
 * never with their personal trips).
 */
export interface SuggestForWhom {
  request?: string;
}

/** search_places {suggest}, with for_request for someone else's request. */
export function suggestArgs(forWhom?: SuggestForWhom | null): Record<string, unknown> {
  if (forWhom?.request) return { suggest: true, for_request: forWhom.request };
  return { suggest: true };
}

/**
 * Is this someone else's request (deciding or editing it, the place box adds the requester's recent places)? By id when
 * both sides carry one (the request's requested_by_employee_id, the person's employee_id), else by name: two people with
 * the same name are then told apart, and a name typed differently does not make one's own request someone else's.
 */
export function someoneElsesRequest(
  q: { requested_by?: string | null; requested_by_employee_id?: string | null },
  me: { name?: string | null; employee_id?: string | null },
): boolean {
  if (q.requested_by_employee_id && me.employee_id) return q.requested_by_employee_id !== me.employee_id;
  return !!q.requested_by && q.requested_by.trim() !== (me.name ?? "").trim();
}
