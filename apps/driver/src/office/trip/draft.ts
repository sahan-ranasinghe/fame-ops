// Office mode (Phase 8, O2): the trip editor's draft on the phone, kept in the kv store so a flow left half-way is there
// when the app opens again (Sahan's brief). The rules are in draftLogic.ts (pure, tested).
// Round 4–7 (item 10, docs/phase8-plan.md §33.9): one draft PER PERSON (the signed-in e-mail in the key, draftKeys.ts), never
// another person's; kept 30 days (retention.drafts_days once the trip editor has read it, setDraftKeepDays): an older one
// is dropped when read, and anyone's expired draft when a draft is written. Sign-out forgets only what is on screen
// (forgetDraftCache): every person's draft stays for their own next sign-in, within the period.

import { useSyncExternalStore } from 'react';

import { getJson, remove, setJson } from '@/lib/kv';
import { getOfficeMe } from '../store';
import type { TripDraft } from './draftLogic';
import {
  DRAFT_DAYS_KEY, DRAFT_INDEX_KEY, draftExpired, draftKeyFor, keepDaysFrom, LAST_EMAIL_KEY, LEGACY_DRAFT_KEY, legacyGoesTo, nextIndex, personOf,
} from './draftKeys';

export * from './draftLogic';

/** The phone-wide key before Round 4–7 (each person's key starts with it). */
export const DRAFT_KEY = LEGACY_DRAFT_KEY;

type Listener = () => void;
const listeners = new Set<Listener>();
/** The draft on screen and whose it is. */
let cached: { person: string | null; draft: TripDraft | null } | undefined;

/** The signed-in office person (null = nobody: a draft then lives on screen only). */
function currentPerson(): string | null {
  const me = getOfficeMe();
  return me ? personOf(me.email) ?? personOf(getJson<string>(LAST_EMAIL_KEY)) : null;
}

const keepDays = (): number => keepDaysFrom(getJson<number>(DRAFT_DAYS_KEY));

/** Writes the person's entry in the index and removes anyone's expired draft. */
function writeIndex(person: string, at: number | null): void {
  const next = nextIndex(getJson<Record<string, number>>(DRAFT_INDEX_KEY), person, at, keepDays());
  for (const p of next.drop) remove(draftKeyFor(p));
  setJson(DRAFT_INDEX_KEY, next.index);
}

/** The person's draft from the phone: the old phone-wide one moved to them first when it was theirs; an expired one goes. */
function load(person: string): TripDraft | null {
  const legacy = getJson<TripDraft>(LEGACY_DRAFT_KEY);
  if (legacy) {
    remove(LEGACY_DRAFT_KEY);
    if (legacyGoesTo(person, getJson<string>(LAST_EMAIL_KEY), !!getJson(draftKeyFor(person)))) {
      setJson(draftKeyFor(person), legacy);
      writeIndex(person, legacy.at);
    }
  }
  const d = getJson<TripDraft>(draftKeyFor(person));
  if (d && draftExpired(d.at, keepDays())) {
    remove(draftKeyFor(person));
    writeIndex(person, null);
    return null;
  }
  return d;
}

export function getDraft(): TripDraft | null {
  const person = currentPerson();
  if (!cached || cached.person !== person) cached = { person, draft: person ? load(person) : null };
  return cached.draft;
}

export function setDraft(next: TripDraft | null): void {
  const person = currentPerson();
  cached = { person, draft: next };
  if (person) {
    if (next) setJson(draftKeyFor(person), next);
    else remove(draftKeyFor(person));
    writeIndex(person, next ? next.at : null);
  }
  listeners.forEach((l) => l());
}

export function updateDraft(fn: (d: TripDraft) => TripDraft): void {
  const d = getDraft();
  if (d) setDraft({ ...fn(d), at: Date.now() });
}

/** Sign-out: nothing of the person's is shown any more; their draft stays on the phone for their own next sign-in. */
export function forgetDraftCache(): void {
  cached = undefined;
  listeners.forEach((l) => l());
}

/** The keep period from get_settings (retention.drafts_days), remembered on the phone for the next start. */
export function setDraftKeepDays(days: number | null | undefined): void {
  if (days == null) return;
  const v = keepDaysFrom(days);
  if (getJson<number>(DRAFT_DAYS_KEY) !== v) setJson(DRAFT_DAYS_KEY, v);
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
