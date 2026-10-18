// The notifications page's rules (Hotfix 3, L3 and L4), pure: All or Unread (?show=), the History switch (?history=1:
// the archived ones too, read items over 30 days old), the search (?q=), my_inbox's arguments (the kit adds the page),
// the items read on the page before the server says so, and the empty line in words that say what the filters mean.
import type { InboxItem } from "../data/types";

export type InboxShow = "all" | "unread";
export const INBOX_SHOW_OPTIONS: [InboxShow, string][] = [["all", "All"], ["unread", "Unread"]];
export const INBOX_SHOW_KEYS = INBOX_SHOW_OPTIONS.map(([k]) => k);

/** my_inbox's input for the page: only what is chosen (the tool's default is every item of the last 30 days). */
export function inboxArgs(show: InboxShow, history: boolean, search: string): Record<string, unknown> {
  return {
    ...(show === "unread" ? { unread: true } : {}),
    ...(history ? { archived: true } : {}),
    ...(search ? { search } : {}),
  };
}

/** The items as the page shows them: those opened here (or all, after Mark all read) read at once. */
export function readHere(items: InboxItem[], read: { ids: number[]; all: boolean }): InboxItem[] {
  if (!read.all && !read.ids.length) return items;
  return items.map((i) => (!i.read && (read.all || read.ids.includes(i.id)) ? { ...i, read: true } : i));
}

/** Nothing to list, in words: what the filters and the days mean. */
export function inboxEmptyText(show: InboxShow, history: boolean, search: string): string {
  const when = history ? "" : " in the last 30 days";
  if (search) return `No ${show === "unread" ? "unread notification" : "notification"} matches "${search}"${when}.`;
  if (show === "unread") return `No unread notifications${when}.`;
  if (history) return "No notifications yet. When a request is decided, a task needs you or a trip moves, it shows here.";
  return "Nothing in the last 30 days. When a request is decided, a task needs you or a trip moves, it shows here.";
}
