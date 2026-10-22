// Office mode (Stage 1, O3 row 2): the requests beyond the waiting queue, the rules only (pure: no react-native, no i18n).
// The Approve tab lists any status through one Filter (Waiting, the default; Approved; Declined; Cancelled; All) with the
// search box and Load more (list_requests status / search / limit / cursor, as the website's Requests page); a request's
// page shows its timeline (request_events: sent, seen, edited, approved, …) to the approver and to the person who asked;
// Cancel booking (cancel_request, a reason required) for an approver on a waiting, approved or changed request, and
// Withdraw for the person who asked while it waits (the server checks it is theirs).

import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';
import { has } from './nav';
import type { RequestCard, RequestEvent, RequestsList } from './types';

// Round 3 (A6): Expired, its own choice (list_requests status expired): a request nobody decided before its day was over.
export type RequestStatusFilter = 'waiting' | 'approved' | 'declined' | 'cancelled' | 'expired' | 'all';
export const REQUEST_STATUSES: readonly RequestStatusFilter[] = ['waiting', 'approved', 'declined', 'cancelled', 'expired', 'all'];
export const REQUESTS_PAGE = 25;

type Words = (key: string, vars?: Record<string, string | number>) => string;

/** The one filter: the status (Waiting by default, which includes changed bookings). */
export function requestsFilterDefs(tr: Words): FilterDef[] {
  return [{
    key: 'status',
    label: tr('office.requests.filterStatus'),
    kind: 'single',
    default: 'waiting',
    options: REQUEST_STATUSES.map((s) => ({ value: s, label: tr(`office.requests.status_${s}`) })),
  }];
}

export function requestsChoice(v: FilterValues): RequestStatusFilter {
  const s = v.status;
  return typeof s === 'string' && (REQUEST_STATUSES as readonly string[]).includes(s) ? (s as RequestStatusFilter) : 'waiting';
}

/** list_requests' input: the status, the search when typed, a page. */
export function requestsArgs(status: RequestStatusFilter, search: string, cursor?: string): Record<string, unknown> {
  return { status, limit: REQUESTS_PAGE, ...(search.trim() ? { search: search.trim().slice(0, 80) } : {}), ...(cursor ? { cursor } : {}) };
}

/** The next page after the rows on screen (never a request twice). */
export function appendRequests(list: RequestsList, page: RequestsList): RequestsList {
  const seen = new Set(list.requests.map((r) => r.id));
  const out: RequestsList = { ...list, requests: [...list.requests, ...page.requests.filter((r) => !seen.has(r.id))] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

/** The status pill's tone (expired: grey, with its own icon, office/ui.tsx StatusChip). */
export function statusTone(status: string): 'amber' | 'green' | 'red' | 'muted' {
  return status === 'waiting' || status === 'changed' ? 'amber' : status === 'approved' ? 'green' : status === 'declined' || status === 'cancelled' ? 'red' : 'muted';
}

/** Round 3 (A6): the state that has its own badge with an icon (the calendar with a cross): an expired request. */
export const isExpired = (q: { status?: string; live?: { state?: string } } | null | undefined): boolean =>
  q?.status === 'expired' || q?.live?.state === 'expired';

/** Round 3 (A6): "Nobody decided it in time · expired Today 00:15", the time in words by `when` (lib/dateWords.ts). */
export function expiredText(q: Pick<RequestCard, 'expired' | 'timeline'>, tr: Words, when: (at: string) => string): string {
  const at = q.expired ?? q.timeline?.expired;
  return at ? tr('office.requests.expiredLine', { at: when(at) }) : tr('office.requests.expiredLineNoTime');
}

/**
 * Round 3 (A6): "Request again" on an expired request (its page, its My trips row): a new request with everything copied
 * but the day (office/trip/draftLogic.ts requestAgainDraft). The person who asked, with create_request; a proposed task
 * is not a vehicle request (it is assigned again instead).
 */
export function canRequestAgain(q: Pick<RequestCard, 'status' | 'kind'>, tools: readonly string[], own: boolean): boolean {
  return own && q.status === 'expired' && q.kind !== 'task' && tools.includes('create_request');
}

const KNOWN_ACTIONS = ['created', 'seen', 'edited', 'approved', 'declined', 'changed', 'redecided', 'postponed', 'cancelled'];

/** A timeline row: "Approved by Palitha", with the note under it. */
export function eventLine(e: Pick<RequestEvent, 'action' | 'actor'>, tr: Words): string {
  const key = KNOWN_ACTIONS.includes(e.action) ? e.action : 'other';
  return e.actor ? tr(`office.requests.ev_${key}_by`, { name: e.actor, action: e.action }) : tr(`office.requests.ev_${key}`, { action: e.action });
}

/** The person reading is the one deciding (approve), not the person who asked. */
export const decides = (permissions: readonly string[]): boolean => has(permissions, 'approve');

/** Cancel booking: an approver, on a request not yet over. */
export function canCancelBooking(q: Pick<RequestCard, 'status'>, permissions: readonly string[], tools: readonly string[]): boolean {
  return decides(permissions) && tools.includes('cancel_request') && (q.status === 'waiting' || q.status === 'approved' || q.status === 'changed');
}

/** Withdraw: the person who asked (no approve), while it waits. */
export function canWithdrawOwn(q: Pick<RequestCard, 'status'>, permissions: readonly string[], tools: readonly string[]): boolean {
  return !decides(permissions) && tools.includes('cancel_request') && q.status === 'waiting';
}

/** The reasons a booking is cancelled for, as the office reads them (the note is added after a dash). */
export const CANCEL_TEXT: Record<'not_needed' | 'vehicle_problem' | 'other', string> = { not_needed: 'Not needed any more', vehicle_problem: 'Vehicle problem', other: 'Other' };

export function cancelReason(label: string, note: string): string {
  return [label, note.trim()].filter(Boolean).join(' — ').slice(0, 300);
}

// ---------------------------------------------------------------------------
// New requests while the list is open (Sahan, 20 October 2026; Twitter's and Gmail's "New ↑"): the list never jumps by
// itself. A quiet look at the first page every minute updates the rows already on screen in place and counts the ones
// that are not; the pill shows them on a tap.
// ---------------------------------------------------------------------------

/** The rows on screen with their newer versions from the first page (same order), and the first page's new ones. A row
 *  on screen above the first page's last known row that the first page no longer has has left this list (another approver
 *  decided it under Waiting, or it was cancelled): it goes, never left looking undecided. */
export function arrivals(current: readonly RequestCard[], first: readonly RequestCard[]): { updated: RequestCard[]; fresh: RequestCard[] } {
  const byId = new Map(first.map((r) => [r.id, r]));
  const have = new Set(current.map((r) => r.id));
  let last = -1;
  current.forEach((r, i) => { if (byId.has(r.id)) last = i; });
  const updated = current.filter((r, i) => byId.has(r.id) || i > last).map((r) => byId.get(r.id) ?? r);
  return { updated, fresh: first.filter((r) => !have.has(r.id)) };
}

/** The list with the new ones in their place: the first page in the server's order, then the rest already loaded. */
export function withArrivals(current: readonly RequestCard[], first: readonly RequestCard[]): RequestCard[] {
  const inFirst = new Set(first.map((r) => r.id));
  return [...first, ...current.filter((r) => !inFirst.has(r.id))];
}

/**
 * A request's state as the one chip of docs/design-pass.md §3 (Part B): Waiting (Waiting · late once its leave-by passed)
 * and Changed · decide again amber, Approved green, Declined, Cancelled and Expired grey.
 */
export function requestStateChip(status: string | undefined, late = false): { key: string; tone: 'green' | 'amber' | 'muted' } {
  if (status === 'waiting' && late) return { key: 'office.chip.waitingLate', tone: 'amber' };
  if (status === 'changed') return { key: 'office.chip.changedDecide', tone: 'amber' };
  const known = ['waiting', 'approved', 'declined', 'cancelled', 'expired'];
  const key = `office.requests.status_${known.includes(status ?? '') ? status : 'waiting'}`;
  return { key, tone: status === 'waiting' ? 'amber' : status === 'approved' ? 'green' : 'muted' };
}
