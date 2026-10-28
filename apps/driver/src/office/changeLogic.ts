// Office mode, Round 48 (item 1): a change to an existing task proposed by someone without the approve permission
// (reassign_task, update_task's day / time / end / driver / vehicle, update_task_stops) while tasks need the fleet admin's
// OK. The pattern is the changed booking's decide-again flow (Phase 6 Part 2): the proposal waits in the approval queue as
// a request of kind "change", the task is untouched until an approver decides, the proposer may withdraw it. The website's
// side is apps/office/src/screens/approvalLogic.ts (changeOutcome, changeLine, pendingChangeTarget); here the words are the
// app's i18n keys (office.change.*), never the server's English on a Sinhala screen. Pure: tested by
// scripts/test-proposed-change.ts.

import type { FieldChanges, Me, PendingChange, RequestCard, RequestChange, WaitingChange } from './types';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A change to an existing task proposed by someone without approve. */
export const isChange = (q: Pick<RequestCard, 'kind'> | null | undefined): boolean => q?.kind === 'change';

/**
 * What a change screen does after update_task / update_task_stops / reassign_task answered: the task changed (the normal
 * landing), or the change waits in the approval queue and the task is as it was (back, a snackbar, nothing flashed).
 */
export function changeOutcome(p: WaitingChange | null | undefined): { waiting: boolean; requestId?: string } {
  if (p?.waiting_for_approval) return { waiting: true, requestId: p.request_id };
  return { waiting: false };
}

/** Where a pending change's line opens: the request's page (an approver decides there; the proposer reads and may withdraw). */
export function pendingChangeTarget(requestId: string, _me?: Pick<Me, 'tools'>): string {
  return `/office/request/${requestId}`;
}

/** The server's field names in a change ("driver", "end by", "return to base") → the i18n key under office.change; null = unknown. */
export function changeFieldKey(field: string): string | null {
  const known = ['driver', 'vehicle', 'time', 'end by', 'leave by', 'stops', 'start', 'return to base', 'avoid expressway', 'title', 'passengers', 'contact', 'notes', 'day'];
  return known.includes(field) ? `office.change.field_${field.replace(/ /g, '_')}` : null;
}

export interface ChangeLine {
  /** The field in the person's language (the server's word when unknown). */
  label: string;
  from?: string | null;
  to?: string | null;
  /** "Nuwan Perera → Kamal Silva" */
  text: string;
}

/** The from → to rows of a change, each field in the person's language. */
export function changeLines(changes: FieldChanges | undefined | null, t: T): ChangeLine[] {
  return Object.entries(changes ?? {}).map(([field, c]) => {
    const key = changeFieldKey(field);
    const label = key ? t(key) : field;
    const none = t('office.change.none');
    return { label, from: c.from, to: c.to, text: t('office.change.fromTo', { from: c.from ?? none, to: c.to ?? none }) };
  });
}

/**
 * One line in the person's language: "Driver Kamal Silva (was Nuwan Perera) · Time 10:00 (was 09:00)"; the server's
 * summary when the change names no fields (never empty: "a change").
 */
export function changeSummary(c: Pick<RequestChange, 'changes' | 'summary'> | Pick<PendingChange, 'changes' | 'summary'> | undefined | null, t: T): string {
  const lines = changeLines(c?.changes, t).map((l) => {
    if (l.from == null && l.to != null) return t('office.change.setLine', { label: l.label, to: l.to });
    if (l.to == null) return t('office.change.clearedLine', { label: l.label });
    return t('office.change.wasLine', { label: l.label, to: l.to, from: l.from ?? t('office.change.none') });
  });
  if (lines.length) return lines.join(' · ');
  return c?.summary || t('office.change.aChange');
}

/** "Change · Team drop · Galle" (the queue's rows, Home, My trips, the request's header). */
export function changeTitle(q: Pick<RequestCard, 'title' | 'change'>, t: T): string {
  return t('office.change.titleOf', { title: q.title || q.change?.task_title || t('office.change.aChange') });
}

/** "Driver Kamal Silva (was Nuwan Perera) · proposed by Sashen" */
export function changeLine(q: Pick<RequestCard, 'change' | 'requested_by'>, t: T): string {
  return [changeSummary(q.change, t), t('office.change.proposedBy', { name: q.requested_by })].join(' · ');
}

/** "Change waiting for approval · Sashen · Driver Kamal Silva (was Nuwan Perera)" on the task, the board and the needs-a-driver rows. */
export function pendingChangeText(pc: Pick<PendingChange, 'by' | 'changes' | 'summary'>, t: T): string {
  return t('office.change.waitingLine', { name: pc.by, summary: changeSummary(pc, t) });
}

export type ChangeDecision = 'approve' | 'decline';

/** decide_request for a change: the id, the decision and the version the page loaded (a stale one is refused), the reason on a decline. */
export function changeDecideInput(q: Pick<RequestCard, 'id' | 'version'>, decision: ChangeDecision, reason?: string): Record<string, unknown> {
  const input: Record<string, unknown> = { request_id: q.id, decision, version: q.version ?? 0 };
  if (decision === 'decline') input.reason = (reason ?? '').trim().slice(0, 300);
  return input;
}

/** The decline reasons' words for the office (the site and Claude read them), whatever the phone's language. */
export type ChangeDeclineKey = 'keep' | 'not_approved' | 'other';
export const CHANGE_DECLINE_TEXT: Record<ChangeDeclineKey, string> = { keep: 'Keep the task as it is', not_approved: 'Not approved', other: 'Other' };

/** Who sees what on a change's page: an approver decides while it waits; the proposer (no approve) may withdraw it while it waits. */
export function changeView(q: Pick<RequestCard, 'status' | 'requested_by'>, me: Pick<Me, 'permissions' | 'tools' | 'name'>): { decides: boolean; withdraw: boolean; own: boolean } {
  const approver = me.permissions.includes('approve');
  const own = !approver || q.requested_by === me.name;
  return {
    decides: approver && q.status === 'waiting' && me.tools.includes('decide_request'),
    withdraw: !approver && own && q.status === 'waiting' && me.tools.includes('cancel_request'),
    own,
  };
}

/** The note under the change by its state: waiting (the task is as it was), approved (applied), declined or withdrawn (left as it was). */
export function changeStateKey(status: RequestCard['status'] | undefined): 'untouched' | 'applied' | 'left' {
  if (status === 'approved') return 'applied';
  if (status === 'waiting' || status === 'changed') return 'untouched';
  return 'left';
}
