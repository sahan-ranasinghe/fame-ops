// Office mode (Phase 8, O1): My trips' pure rules (design 17), tested in scripts/test-inbox.ts: the range (the last 30
// days to the next 60), the three buckets by a trip's live state (Waiting, Coming up, Done) and the All / bucket filter,
// the line under a title, who may withdraw (the person's own request while it waits), the reason cancel_request gets,
// and where a row opens (an approver opens a request's page; nothing else opens in O1).

import type { FilterDef, FilterValues } from '../lib/patterns/filterLogic';
import { addDays } from '../lib/time';

import { isCreatedTask, tripLive } from './homeLogic';
import type { CreatedTaskCard, RequestCard } from './types';

export type Trip = RequestCard | CreatedTaskCard;

export type TripBucket = 'waiting' | 'coming' | 'done';
export type TripFilter = 'all' | TripBucket;

/** The sections in their order on the screen (the i18n keys are office.trips.<key>). */
export const TRIP_BUCKETS: readonly TripBucket[] = ['waiting', 'coming', 'done'];

export const TRIPS_DAYS_BACK = 30;
export const TRIPS_DAYS_AHEAD = 60;

/** Waiting = waiting; done = completed, declined, cancelled, missed; everything else is still to come. */
export function bucketOf(trip: Trip): TripBucket {
  switch (tripLive(trip).state) {
    case 'waiting':
      return 'waiting';
    case 'completed':
    case 'declined':
    case 'cancelled':
    case 'missed':
      return 'done';
    default:
      return 'coming';
  }
}

export function bucketCounts(trips: readonly Trip[]): Record<TripBucket, number> {
  const counts: Record<TripBucket, number> = { waiting: 0, coming: 0, done: 0 };
  for (const trip of trips) counts[bucketOf(trip)] += 1;
  return counts;
}

/** The sections to show: every bucket with a trip (All), or just the one chosen; the trips keep the server's order. */
export function tripBuckets(trips: readonly Trip[], filter: TripFilter): { key: TripBucket; trips: Trip[] }[] {
  return TRIP_BUCKETS.filter((key) => filter === 'all' || key === filter)
    .map((key) => ({ key, trips: trips.filter((t) => bucketOf(t) === key) }))
    .filter((g) => g.trips.length > 0);
}

/** The Filter sheet's one section: All or a bucket (on the phone), with the counts of the trips loaded beside each. */
export function tripsFilterDefs(trips: readonly Trip[] | undefined, tr: (key: string) => string): FilterDef[] {
  const counts = trips ? bucketCounts(trips) : undefined;
  return [{
    key: 'show',
    label: tr('office.trips.filterShow'),
    kind: 'single',
    default: 'all',
    options: [
      { value: 'all', label: tr('office.common.all'), ...(trips ? { count: trips.length } : {}) },
      ...TRIP_BUCKETS.map((k) => ({ value: k, label: tr(`office.trips.${k}`), ...(counts ? { count: counts[k] } : {}) })),
    ],
  }];
}

export const tripsChoice = (values: FilterValues): TripFilter =>
  ((TRIP_BUCKETS as readonly unknown[]).includes(values.show) ? values.show : 'all') as TripFilter;

/** my_trips' input: the last 30 days to the next 60, everything the person made, and the words searched for (the tool's own `search`) only when there are any. */
export function tripsArgs(today: string, limit: number, search = ''): Record<string, unknown> {
  const words = search.trim();
  return { from: addDays(today, -TRIPS_DAYS_BACK), to: addDays(today, TRIPS_DAYS_AHEAD), include: 'all', limit, ...(words ? { search: words } : {}) };
}

/** A stable key for a row: a request and a created task may share an id. */
export const tripKey = (trip: Trip): string => (isCreatedTask(trip) ? `t-${trip.id}` : `r-${trip.id}`);

/** "Tue 20 Oct 11:00 · back by 17:00 · 1 pax · Sunil · WP CAB-4521" (design 17). */
export function tripLine(trip: Trip, backByWord: string): string {
  const a = trip.assigned;
  return [
    trip.when,
    trip.back_by ? `${backByWord} ${trip.back_by}` : '',
    isCreatedTask(trip) ? '' : (trip.need ?? ''),
    a?.driver ?? '',
    a ? (a.vehicle || a.vehicle_text || '') : '',
  ].filter(Boolean).join(' · ');
}

/** "Changed by the office · was 14:00 · stops changed" on an approved request whose task the office changed. */
export const changedText = (trip: Trip): string | undefined => (isCreatedTask(trip) ? undefined : trip.trip?.changed?.text);

/** Withdraw: the person's own request (never a created task) while it still waits. The server checks the same. */
export const canWithdraw = (trip: Trip): trip is RequestCard => !isCreatedTask(trip) && trip.status === 'waiting';

export type WithdrawReason = 'not_needed' | 'plans_changed' | 'other';

/** The sheet's reasons in their order, with their i18n labels. */
export const WITHDRAW_REASONS: readonly { value: WithdrawReason; label: string }[] = [
  { value: 'not_needed', label: 'office.trips.reasonNotNeeded' },
  { value: 'plans_changed', label: 'office.trips.reasonPlansChanged' },
  { value: 'other', label: 'office.trips.reasonOther' },
];

/** The reason as the office reads it on the site and in Claude (English, whatever the phone's language). */
export const WITHDRAW_TEXT: Record<WithdrawReason, string> = {
  not_needed: 'Not needed any more',
  plans_changed: 'Plans changed',
  other: 'Other',
};

/** "Plans changed — the meeting moved", or just the reason when there is no note. */
export function withdrawReason(reason: WithdrawReason, note: string): string {
  const n = note.trim();
  return n ? `${WITHDRAW_TEXT[reason]} — ${n}` : WITHDRAW_TEXT[reason];
}

/** Where a row opens: an approver opens a request's page (O1); a created task has no page yet, nor has a requester. */
export function tripRoute(trip: Trip, _permissions?: readonly string[]): string | null {
  // O3 row 2: the person who asked opens their own request too (the page shows them the trip, the timeline, Edit and Withdraw).
  return !isCreatedTask(trip) ? `/office/request/${trip.id}` : null;
}

/** O2: an own request may be changed while it waits or is approved (changed = approved and edited since): the trip editor's edit mode. */
export function canEdit(trip: Trip): boolean {
  if (isCreatedTask(trip)) return false;
  return trip.status === 'waiting' || trip.status === 'approved' || trip.status === 'changed';
}
