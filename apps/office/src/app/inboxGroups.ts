// The notification tray's grouping (Hotfix 3, L4), pure: the items by day (Today, Yesterday, Earlier, by the item's
// Colombo date; the server's order kept inside each), and the All / Unread filter.
import type { InboxItem } from "../data/types";
import { addDays } from "../lib/format";

export type InboxDay = "Today" | "Yesterday" | "Earlier";
export type InboxFilter = "all" | "unread";

export interface InboxDayGroup {
  label: InboxDay;
  items: InboxItem[];
}

/** The groups that have items, in the order Today, Yesterday, Earlier. `day` = today in Colombo (YYYY-MM-DD). */
export function groupByDay(items: InboxItem[], day: string): InboxDayGroup[] {
  const yesterday = addDays(day, -1);
  const groups: Record<InboxDay, InboxItem[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const i of items) {
    const d = String(i.at ?? "").slice(0, 10);
    // An item dated after today (a clock ahead) is today's.
    groups[d >= day ? "Today" : d === yesterday ? "Yesterday" : "Earlier"].push(i);
  }
  return (["Today", "Yesterday", "Earlier"] as InboxDay[]).filter((l) => groups[l].length).map((label) => ({ label, items: groups[label] }));
}

export const filterInbox = (items: InboxItem[], f: InboxFilter): InboxItem[] => (f === "unread" ? items.filter((i) => !i.read) : items);
