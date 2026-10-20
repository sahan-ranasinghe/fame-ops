// Office mode (Stage 1, O3 row 2): the requests beyond the waiting queue, the rules only (pure: no react-native, no i18n).
// The Approve tab lists any status through one Filter (Waiting, the default; Approved; Declined; Cancelled; All) with the
// search box and Load more (list_requests status / search / limit / cursor, as the website's Requests page); a request's
// page shows its timeline (request_events: sent, seen, edited, approved, …) to the approver and to the person who asked;
// Cancel booking (cancel_request, a reason required) for an approver on a waiting, approved or changed request, and
// Withdraw for the person who asked while it waits (the server checks it is theirs).

import type { FilterDef, FilterValues } from '@/lib/patterns/filterLogic';
import { has } from './nav';
import type { RequestCard, RequestEvent, RequestsList } from './types';

export type RequestStatusFilter = 'waiting' | 'approved' | 'declined' | 'cancelled' | 'all';
export const REQUEST_STATUSES: readonly RequestStatusFilter[] = ['waiting', 'approved', 'declined', 'cancelled', 'all'];
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

/** The status pill's tone. */
export function statusTone(status: string): 'amber' | 'green' | 'red' | 'muted' {
  return status === 'waiting' || status === 'changed' ? 'amber' : status === 'approved' ? 'green' : status === 'declined' || status === 'cancelled' ? 'red' : 'muted';
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
