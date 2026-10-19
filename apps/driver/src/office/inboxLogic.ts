// Office mode (Phase 8, O1): the notification centre's pure rules (design 16), tested in scripts/test-inbox.ts: the
// All / Unread filter, the items grouped by day (Today, Yesterday, Earlier, by the item's Colombo date against today's),
// the line under an item, the rows patched read after a tap or "Mark all read", and the tone of each kind's icon tile.

import { type DateNames, shortDate } from '@/lib/durations';
import { addDays } from '@/lib/time';
import type { InboxItem } from './types';
import type { Tone } from './ui';

export type InboxFilter = 'all' | 'unread';

export type DayKey = 'today' | 'yesterday' | 'earlier';

/** The groups in their order on the screen (the i18n keys are office.common.<key>). */
export const DAY_ORDER: readonly DayKey[] = ['today', 'yesterday', 'earlier'];

/** "2026-10-18 10:42" (Colombo) → its date, its time and an ISO instant; a malformed `at` gives empty strings. */
export function atParts(at: string | undefined): { date: string; time: string; iso: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(at ?? '');
  if (!m) return { date: '', time: '', iso: '' };
  return { date: m[1], time: m[2], iso: `${m[1]}T${m[2]}:00+05:30` };
}

/** Which group an item belongs to, by its date against today's (both Colombo dates). Anything unreadable is Earlier. */
export function dayKey(at: string | undefined, today: string): DayKey {
  const { date } = atParts(at);
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return 'earlier';
}

/** All, or only what is not read yet. */
export function filterInbox(items: readonly InboxItem[], filter: InboxFilter): InboxItem[] {
  return filter === 'unread' ? items.filter((i) => !i.read) : [...items];
}

/** The items grouped Today, Yesterday, Earlier (in the order the server gave them); empty groups left out. */
export function groupByDay(items: readonly InboxItem[], today: string): { key: DayKey; items: InboxItem[] }[] {
  const groups = new Map<DayKey, InboxItem[]>(DAY_ORDER.map((k) => [k, []]));
  for (const item of items) groups.get(dayKey(item.at, today))?.push(item);
  return DAY_ORDER.map((key) => ({ key, items: groups.get(key) ?? [] })).filter((g) => g.items.length > 0);
}

/** The line under an item: "08:14 · 48 min ago" today, "Sun 18 Oct 16:40" on another day. */
export function inboxLine(item: Pick<InboxItem, 'at' | 'ago'>, today: string, names: DateNames): string {
  const { date, time, iso } = atParts(item.at);
  if (!date) return item.ago ?? '';
  if (date === today) return [time, item.ago].filter(Boolean).join(' · ');
  return `${shortDate(names, iso)} ${time}`;
}

/** The rows patched read (the ids given, or every row with 'all'); the others untouched. */
export function markRead(items: readonly InboxItem[], ids: readonly number[] | 'all'): InboxItem[] {
  return items.map((i) => (!i.read && (ids === 'all' || ids.includes(i.id)) ? { ...i, read: true } : i));
}

/** The unread count after `n` items were marked read: never below zero. */
export const unreadAfter = (unread: number, n: number): number => Math.max(0, unread - n);

/** The icon tile's tone (design 16): urgent and alarm red, alert amber, soft blue, info grey. */
export function kindTone(kind: InboxItem['kind'] | undefined): Tone {
  switch (kind) {
    case 'urgent':
    case 'alarm':
      return 'red';
    case 'alert':
      return 'amber';
    case 'soft':
      return 'blue';
    default:
      return 'muted';
  }
}
