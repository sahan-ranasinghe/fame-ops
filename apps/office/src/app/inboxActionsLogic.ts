// Round 4–7, feature 7 (22 October 2026): the notification centre's buttons (Gmail's and Slack's actionable
// notifications), pure: an item's actions (an Ask for it's Yes / No: a tool and its arguments, called as they are), the
// answer given in this tab (kept by item while the page lives, so a reload of the list still shows "You said Yes"), its
// words, and where an ask's item opens for someone who cannot open tasks (the Asks page, never "No access").
import { linkOf } from "../data/inboxLogic";
import type { InboxAction, InboxItem } from "../data/types";

/** The answer given to each item in this tab (item id → the button's label). */
const answered = new Map<number, string>();

export const answeredLabel = (itemId: number): string | undefined => answered.get(itemId);
export const keepAnswered = (itemId: number, label: string): void => void answered.set(itemId, label);
/** Tests only. */
export const forgetAnswered = (): void => answered.clear();

/** "You said Yes". */
export const saidText = (label: string): string => `You said ${label}`;

/** The item's buttons: only well-formed ones (a label and a tool). */
export const actionsOf = (item: Pick<InboxItem, "actions">): InboxAction[] =>
  (item.actions ?? []).filter((a) => !!a?.label && !!a?.tool);

const TASK_PAGE = /^\/tasks\/[0-9a-f-]{36}(?:[/?#]|$)/i;

/**
 * Where an item opens: its link, except an ask about a busy driver or vehicle (holder.*) pointing at a task page for
 * someone who cannot open tasks (a requester holding the trip): the Asks page.
 */
export function itemLink(item: Pick<InboxItem, "event" | "url">, opensTasks: boolean): ReturnType<typeof linkOf> {
  const link = linkOf(item.url);
  if (!opensTasks && item.event?.startsWith("holder.") && link && "to" in link && TASK_PAGE.test(link.to)) return { to: "/tasks/asks" };
  return link;
}
