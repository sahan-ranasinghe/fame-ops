// "Where" suggestions (Phase 9 Round 1, item 6; docs/ui-patterns.md "Where suggestions"), the pattern of Google Maps' and
// Uber's destination box: an empty box shows at most 5 rows, our places first (offices first, then the saved ones), then
// the 3 places used most recently; each row has an icon (a building for ours, a clock for a recent one), never a text
// badge; no towns until the person types; "More places" under the list opens the rest in place (Google Maps' "More from
// recent history"). While typing, the server's badge words are shown in the person's language (badgeKey).
// Pure (no i18n import): the office's box (components/office/PlaceSearch.tsx) and the driver's (components/PlaceSearch.tsx).

/** Rows an empty box shows. */
export const WHERE_MAX_ROWS = 5;
/** Of which, at most, the places used before. */
export const WHERE_MAX_RECENT = 3;
/** "More places" shows at most this many in all (a longer list is for typing). */
export const MORE_PLACES_MAX = 50;

export type WhereIcon = 'building' | 'clock';

export interface WhereRow<T> {
  item: T;
  icon: WhereIcon;
  /** Round 4–7 (item 10): the row's group in an empty box (a small header above its first row); none = no headers. */
  group?: WhereGroup;
  /** The server's header words ("Anoja's recent"): the app shows its own words, with the name read from them. */
  label?: string;
}

/**
 * Round 4–7 (item 10; Uber's and Google Maps' empty destination box): search_places {suggest} answers each row's group:
 * saved (the company's places), recent (the person's OWN), for (the trip's person's, when someone else's trip is edited
 * or decided: "Anoja's recent").
 */
export type WhereGroup = 'saved' | 'recent' | 'for';
export const WHERE_GROUPS: readonly WhereGroup[] = ['saved', 'recent', 'for'];
/** An empty box with groups shows at most this many ("about 5": 2 saved + 3 recent, or 2 + 2 + 2 for someone else's trip). */
export const SUGGEST_MAX_ROWS = 7;

export interface WhereLists<T> {
  /** What the empty box shows. */
  top: WhereRow<T>[];
  /** What "More places" adds below them (empty: no link). */
  more: WhereRow<T>[];
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Ours first, then at most 3 recent, 5 rows in all; a recent place that is also one of ours shows once (as ours).
 * The rest (ours, then recent) is what "More places" opens.
 */
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
  const building = (item: T): WhereRow<T> => ({ item, icon: 'building' });
  const clock = (item: T): WhereRow<T> => ({ item, icon: 'clock' });
  const top = [...oursTop.map(building), ...recentTop.map(clock)];
  const more = [...ours.slice(oursTop.length).map(building), ...recentOnly.slice(recentTop.length).map(clock)]
    .slice(0, Math.max(0, MORE_PLACES_MAX - top.length));
  return { top, more };
}

/** The office's empty-box answer (search_places {suggest}): our places and the recent ones; towns and the map left out. */
export function splitSuggestions<T extends { layer: string }>(results: readonly T[]): { ours: T[]; recent: T[] } {
  return { ours: results.filter((r) => r.layer === 'place'), recent: results.filter((r) => r.layer === 'recent') };
}

/** A row's group: the server's, else (an older answer) by its layer; towns and the rest have none. */
export function groupOf(r: { layer: string; group?: string }): WhereGroup | null {
  if (r.group === 'saved' || r.group === 'recent' || r.group === 'for') return r.group;
  return r.layer === 'place' ? 'saved' : r.layer === 'recent' ? 'recent' : null;
}

/**
 * The office's empty box from search_places {suggest}. With the server's groups (Round 4–7): Saved, Recent, then
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
      rows.push({ item: r, icon: g === 'saved' ? 'building' : 'clock', group: g, ...(r.group_label?.trim() ? { label: r.group_label.trim() } : {}) });
    }
  }
  return { top: rows.slice(0, SUGGEST_MAX_ROWS), more: rows.slice(SUGGEST_MAX_ROWS, MORE_PLACES_MAX) };
}

/** Does row i start a group (its header goes above it)? Only rows with a group have headers. */
export const startsGroup = <T>(rows: readonly WhereRow<T>[], i: number): boolean =>
  !!rows[i]?.group && (i === 0 || rows[i - 1].group !== rows[i].group || rows[i - 1].label !== rows[i].label);

/** The person's name in the server's "Anoja's recent" (the app says it in the person's language); null = not there. */
export function forName(label?: string | null): string | null {
  const m = label?.trim().match(/^(.+?)['’]s recent$/i);
  return m ? m[1].trim() : null;
}

/** A group's header as an i18n key and its values (where.group.*). */
export function groupHeader(row: Pick<WhereRow<unknown>, 'group' | 'label'>): { key: string; vars?: Record<string, string> } | null {
  if (!row.group) return null;
  if (row.group === 'for') {
    const name = forName(row.label);
    return name ? { key: 'where.group.for', vars: { name } } : { key: 'where.group.forSomeone' };
  }
  return { key: `where.group.${row.group}` };
}

export const GROUP_I18N_KEYS = ['where.group.saved', 'where.group.recent', 'where.group.for', 'where.group.forSomeone'];

/** Offices first, the rest in their order (the driver's own list of our places, which has no "used before"). */
export function officesFirst<T extends { kind?: string | null }>(places: readonly T[]): T[] {
  return [...places.filter((p) => p.kind === 'office'), ...places.filter((p) => p.kind !== 'office')];
}

const BADGE_KEYS: Record<string, string> = {
  Office: 'where.badge.office',
  'Site · Dialog': 'where.badge.siteDialog',
  'Site · Mobitel': 'where.badge.siteMobitel',
  Site: 'where.badge.site',
  Saved: 'where.badge.saved',
  'Used before': 'where.badge.usedBefore',
  Map: 'where.badge.map',
  Google: 'where.badge.google',
  Town: 'where.badge.town',
  Pin: 'where.badge.pin',
  Link: 'where.badge.link',
};

const LAYER_KEYS: Record<string, string> = {
  place: 'where.badge.saved',
  known: 'where.badge.saved',
  recent: 'where.badge.usedBefore',
  map: 'where.badge.map',
  google: 'where.badge.google',
  town: 'where.badge.town',
  pin: 'where.badge.pin',
};

/** The i18n key of a server badge ("Office", "Site · Dialog", …); an unknown word falls back to its layer's; null = none. */
export function badgeKey(badge: string | null | undefined, layer?: string | null): string | null {
  if (badge && BADGE_KEYS[badge]) return BADGE_KEYS[badge];
  if (layer && LAYER_KEYS[layer]) return LAYER_KEYS[layer];
  return null;
}

/** Every key badgeKey can answer (the strings test checks each in en and si). */
export const BADGE_I18N_KEYS = [...new Set([...Object.values(BADGE_KEYS), ...Object.values(LAYER_KEYS)])];
