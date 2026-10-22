// Office mode (Round 4–7, item 10; docs/phase8-plan.md §33.9): the trip draft is PER PERSON on the phone, kept 30 days
// (the setting retention.drafts_days when the trip editor has read it). The pure part of the store (draft.ts), tested by
// scripts/test-perperson.ts: the key per person (the signed-in e-mail), the index of whose drafts the phone holds (so an
// expired one of anyone is removed without being read), the keep period, and the one draft of the phone from before
// (`office.trip.draft`), which belonged to the person who signed in last (the old sign-in dropped it for anyone else).

/** The one draft of the phone before Round 4–7, and the start of every person's key. */
export const LEGACY_DRAFT_KEY = 'office.trip.draft';
/** "office.trip.draft.<e-mail>" */
export const DRAFT_PREFIX = `${LEGACY_DRAFT_KEY}.`;
/** { <e-mail>: the draft's last change (ms) }: whose drafts the phone holds. */
export const DRAFT_INDEX_KEY = 'office.trip.drafts';
/** The keep period as the trip editor last read it (get_settings retention.drafts_days). */
export const DRAFT_DAYS_KEY = 'office.trip.draftDays';
/** The e-mail typed at the last office sign-in (office/store.ts OFFICE_KEYS.email; the test checks they match). */
export const LAST_EMAIL_KEY = 'office.email';
/** The server's default for retention.drafts_days. */
export const DRAFT_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/** The person a draft belongs to: the e-mail, trimmed and lower case; null = nobody known (nothing is kept). */
export const personOf = (email?: string | null): string | null => email?.trim().toLowerCase() || null;

export const draftKeyFor = (person: string): string => `${DRAFT_PREFIX}${person}`;

/** Older than the period (a draft changed at `at`, ms). */
export const draftExpired = (at: number, days: number, now = Date.now()): boolean => !Number.isFinite(at) || now - at > days * DAY_MS;

/** The period: a whole number of days over 0, else the default. */
export function keepDaysFrom(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : DRAFT_KEEP_DAYS;
}

/** The index after a write: this person's entry set (or dropped), and every expired entry of anyone dropped (to remove). */
export function nextIndex(
  index: Record<string, number> | null | undefined,
  person: string,
  at: number | null,
  days: number,
  now = Date.now(),
): { index: Record<string, number>; drop: string[] } {
  const out: Record<string, number> = {};
  const drop: string[] = [];
  for (const [p, t] of Object.entries(index ?? {})) {
    if (p === person) continue;
    if (draftExpired(t, days, now)) drop.push(p);
    else out[p] = t;
  }
  if (at !== null) out[person] = at;
  return { index: out, drop };
}

/** The old phone-wide draft goes to this person only when they were the last to sign in and have none of their own. */
export const legacyGoesTo = (person: string, lastEmail: string | null | undefined, hasOwn: boolean): boolean => !hasOwn && personOf(lastEmail) === person;

/**
 * A sign-in, before the e-mail typed replaces the one kept (`previousEmail`): the old phone-wide draft is dropped unless the
 * person signing in is the one who signed in last (it was theirs: their getDraft moves it to them). Without this, the
 * e-mail would already be the new person's when the draft is first read, and another person's draft would move to them.
 */
export const legacyDropAtSignIn = (signingIn: string, previousEmail: string | null | undefined): boolean => {
  const person = personOf(signingIn);
  return !person || personOf(previousEmail) !== person;
};
