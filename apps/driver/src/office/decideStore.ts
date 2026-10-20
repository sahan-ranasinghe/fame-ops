// Office mode (Stage 1, O3 row 1): the time changes an approver made for a request, held while Approve a request and its
// Change time screen are open (one per request id; the Change time screen writes, Approve reads and sends them, Undo or a
// decision clears them). In memory only: a change is a few taps, and an app restart starts from the request as asked.

import { useSyncExternalStore } from 'react';

import type { TimeChange } from './decideLogic';

const changes = new Map<string, TimeChange>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const decideStore = {
  get: (id: string): TimeChange | null => changes.get(id) ?? null,
  set(id: string, c: TimeChange | null) {
    if (c) changes.set(id, c);
    else changes.delete(id);
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** The change held for a request (null = as asked). */
export function useTimeChange(id: string): TimeChange | null {
  return useSyncExternalStore(decideStore.subscribe, () => decideStore.get(id), () => null);
}
