// Hotfix O2-H2, Part 1b: what a save said besides "saved" (its warnings and conflicts), carried to the screen the person
// lands on (Google Calendar shows a conflict on the event itself). Kept by the item it is about ("task:<id>",
// "request:<id>", or the list "tasks" / "trips"), shown once by that screen's SavedNotice card, gone when dismissed or
// shown elsewhere. In memory only.

import { useSyncExternalStore } from 'react';

import type { Conflict } from './types';

export interface SavedNoticeValue {
  lines: string[];
  /** The card's heading when it is not the warnings' (a swap's readings: "Vehicle swapped"). */
  title?: string;
  /** Round 4–7 (7): the conflicts that name who holds the driver or vehicle, shown as cards (Call, WhatsApp, Ask for it). */
  conflicts?: Conflict[];
}

const notices = new Map<string, SavedNoticeValue>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setSavedNotice(key: string, lines: readonly string[], title?: string, conflicts?: readonly Conflict[]): void {
  // Round 4–7 (7): a conflict with its holder is a card of its own; its sentence is not repeated as a line.
  const cards = (conflicts ?? []).filter((c) => !!c.holder && (c.kind === 'driver' || c.kind === 'vehicle'));
  const carded = new Set(cards.map((c) => c.text.trim()));
  const clean = [...new Set(lines.map((l) => l.trim()).filter((l) => l && !carded.has(l)))];
  if (clean.length || cards.length) notices.set(key, { lines: clean, ...(title ? { title } : {}), ...(cards.length ? { conflicts: cards } : {}) });
  else notices.delete(key);
  emit();
}

export function dismissSavedNotice(key: string): void {
  if (notices.delete(key)) emit();
}

export const savedNotice = (key: string): SavedNoticeValue | null => notices.get(key) ?? null;

export function useSavedNotice(key: string | null | undefined): SavedNoticeValue | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => (key ? notices.get(key) ?? null : null),
    () => (key ? notices.get(key) ?? null : null),
  );
}
