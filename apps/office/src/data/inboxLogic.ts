// The notification centre's rules (Hotfix 2, A and B), pure: which items are new since the page loaded (they play a
// sound and show a banner; the first load never does), an item's link inside the app, and the inbox after items are
// marked read on the page (before the server answers).
import type { Inbox, InboxItem } from "./types";

/** An item's time ("2026-10-18 10:42", Colombo) as ms; NaN when it is not one. */
export function itemTime(at: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(at ?? "");
  return m ? Date.parse(`${m[1]}T${m[2]}:00+05:30`) : Number.NaN;
}

/**
 * Items that arrived after the last answer: an id above the highest seen and not read yet. `seen` null = the first
 * answer since the page opened: it only sets the mark (nothing is new on the first load). `since` (ms, the page's
 * opening): an item from an earlier minute is never new either (the artifact may first show a copy fetched before the
 * page opened, so its next answer can carry items that came in before). Answers the new mark too.
 */
export function freshItems(seen: number | null, items: InboxItem[], since?: number): { fresh: InboxItem[]; seen: number } {
  const top = items.reduce((m, i) => Math.max(m, i.id), seen ?? 0);
  if (seen === null) return { fresh: [], seen: top };
  const from = since === undefined ? Number.NEGATIVE_INFINITY : since - (since % 60000);
  return { fresh: items.filter((i) => i.id > seen && !i.read && !(itemTime(i.at) < from)), seen: top };
}

/** At most this many banners at once; older ones give way. */
export const MAX_BANNERS = 3;

/** The banners after new items: the newest first, each once, at most MAX_BANNERS. */
export function addBanners(shown: InboxItem[], fresh: InboxItem[]): InboxItem[] {
  const byNew = [...fresh].sort((a, b) => b.id - a.id);
  const out = [...byNew, ...shown.filter((s) => !byNew.some((f) => f.id === s.id))];
  return out.slice(0, MAX_BANNERS);
}

/**
 * Where an item's url goes: a path inside the app (a Link), the same with this site's address in front, or another
 * site (opened in a new tab). None = the item only informs.
 */
export function linkOf(url: string | null | undefined, origin = typeof location !== "undefined" ? location.origin : ""): { to: string } | { href: string } | null {
  const u = (url ?? "").trim();
  if (!u) return null;
  if (u.startsWith("/")) return { to: u };
  if (origin && u.startsWith(origin + "/")) return { to: u.slice(origin.length) };
  if (/^https?:\/\//i.test(u)) return { href: u };
  return { to: "/" + u.replace(/^#?\/?/, "") };
}

/** The inbox once these items (or all) are read here: the count drops at once, the server's answer settles it. */
export function markedRead(inbox: Inbox, ids: number[] | "all"): Inbox {
  const hit = (i: InboxItem) => ids === "all" || ids.includes(i.id);
  const newlyRead = inbox.items.filter((i) => !i.read && hit(i)).length;
  if (newlyRead === 0 && ids !== "all") return inbox;
  return {
    ...inbox,
    unread: ids === "all" ? 0 : Math.max(0, inbox.unread - newlyRead),
    items: inbox.items.map((i) => (!i.read && hit(i) ? { ...i, read: true } : i)),
  };
}

/** "Who · what": the first line of an item in the list and on the banner. */
export const headline = (i: Pick<InboxItem, "who" | "title">): string => (i.who ? `${i.who} · ${i.title}` : i.title);

/** The badge: 1–99, then "99+". */
export const unreadBadge = (n: number): string => (n > 99 ? "99+" : String(n));

/** The banner's tone per kind (the CSS colours its edge). */
export const KIND_TONE: Record<InboxItem["kind"], "warn" | "live" | "ok" | "bad" | ""> = {
  urgent: "warn",
  alert: "live",
  soft: "ok",
  alarm: "bad",
  info: "",
};
