// Office mode (Phase 8, O2): the trip editor's draft on the phone: one for the whole phone, kept in the kv store so a flow
// left half-way is there when the app opens again (Sahan's brief). The rules are in draftLogic.ts (pure, tested).

import { useSyncExternalStore } from 'react';

import { getJson, remove, setJson } from '@/lib/kv';
import type { TripDraft } from './draftLogic';

export * from './draftLogic';

export const DRAFT_KEY = 'office.trip.draft';

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: TripDraft | null | undefined;

export function getDraft(): TripDraft | null {
  if (cached === undefined) cached = getJson<TripDraft>(DRAFT_KEY);
  return cached;
}

export function setDraft(next: TripDraft | null): void {
  cached = next;
  if (next) setJson(DRAFT_KEY, next);
  else remove(DRAFT_KEY);
  listeners.forEach((l) => l());
}

export function updateDraft(fn: (d: TripDraft) => TripDraft): void {
  const d = getDraft();
  if (d) setDraft({ ...fn(d), at: Date.now() });
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useTripDraft(): TripDraft | null {
  return useSyncExternalStore(subscribe, getDraft, getDraft);
}

