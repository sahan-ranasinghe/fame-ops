// Office mode (Hotfix O2-H1, Part B): the rules the trip forms gained for parity with the site's New request and
// Assign a task: the project split (the site's NewTask rows: find_project's match line, Split equally, the total), the
// request's Book now (the site's NewRequest "Assign now": the free drivers, the vehicle groups, the custodian driving,
// the default-vehicle line), the plan's "Leave by" note, the conflict cards' actions, the outcome after sending (the
// words and the buttons as the site shows them), and the driver's WhatsApp link. Pure: no react-native, no i18n.

import type { Conflict, CreateTaskResult, FindProject, PlanPreview, SuggestedVehicle, Suggestions } from '../types';
import type { ProjectRow } from './assignLogic';

// ---------------------------------------------------------------------------
// The project split (Assign a task)
// ---------------------------------------------------------------------------

/** Percentages that add up to 100 for n rows (the site's splitEqually). */
export function splitEqually(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

/** A row added: the first takes 100, the others start empty (the site). */
export const addProjectRow = (rows: ProjectRow[]): ProjectRow[] => [...rows, { project: '', percent: rows.length ? '' : 100 }];

export const setProjectRow = (rows: ProjectRow[], i: number, patch: Partial<ProjectRow>): ProjectRow[] => rows.map((r, j) => (j === i ? { ...r, ...patch } : r));

export const removeProjectRow = (rows: ProjectRow[], i: number): ProjectRow[] => rows.filter((_, j) => j !== i);

export const splitRows = (rows: ProjectRow[]): ProjectRow[] => {
  const p = splitEqually(rows.length);
  return rows.map((r, i) => ({ ...r, percent: p[i] }));
};

/** find_project's answer as the row's match line: none (bad), several ("first: …"), or one (✓ …). Keys for the words. */
export function projectMatch(p: FindProject): { key: 'none' | 'several' | 'one'; text: string; bad: boolean } {
  const list = p.projects || [];
  if (!list.length) return { key: 'none', text: '', bad: true };
  const x = list[0];
  const text = [x.job_no, x.short_name, x.name, x.customer_name].filter(Boolean).join(' · ');
  return list.length > 1 && p.matched_by === 'contains' ? { key: 'several', text, bad: false } : { key: 'one', text, bad: false };
}

/** The split's state for the footer: the total and whether it is 100 (empty rows do not count). */
export function splitState(rows: ProjectRow[]): { used: number; total: number; ok: boolean } {
  const used = rows.filter((r) => r.project.trim());
  const total = used.reduce((a, r) => a + (Number(r.percent) || 0), 0);
  return { used: used.length, total, ok: used.length === 0 || Math.abs(total - 100) < 0.01 };
}

// ---------------------------------------------------------------------------
// Book now (New request, for someone with book_vehicle)
// ---------------------------------------------------------------------------

export type GroupKey = keyof NonNullable<Suggestions['groups']>;
export const GROUP_ORDER: readonly GroupKey[] = ['free_pool', 'free_assigned', 'busy', 'in_garage'];

/** The groups as rows in the site's order, each with its key; a vehicle in the garage is shown, not offered. */
export function groupRows(sug: Pick<Suggestions, 'groups' | 'vehicles'> | null | undefined): { key: GroupKey | 'all'; rows: SuggestedVehicle[]; disabled: boolean }[] {
  if (!sug) return [];
  if (!sug.groups) return [{ key: 'all', rows: sug.vehicles, disabled: false }];
  return GROUP_ORDER.map((key) => ({ key, rows: sug.groups![key], disabled: key === 'in_garage' })).filter((g) => g.rows.length > 0);
}

/** A vehicle's second line: "Toyota HiAce · 12 seats · Free · back 14:30". */
export function vehicleLine(v: SuggestedVehicle, seatsWord: (n: number) => string): string {
  return [v.make_model, v.seats ? seatsWord(v.seats) : '', v.availability, v.but, v.back].filter(Boolean).join(' · ');
}

/** The free drivers to offer: the picked one stays in the list even when it is no longer free (the site's withPicked). Round 3:
 *  each keeps its photo and vehicle (the driver-first card). */
export function driverOptions<D extends { name: string; username: string }>(free: D[], picked: string, pickedName?: string): (D | { name: string; username: string })[] {
  if (!picked || free.some((d) => d.username === picked)) return free;
  return [...free, { username: picked, name: pickedName ?? picked }];
}

// ---------------------------------------------------------------------------
// The plan's words on Review
// ---------------------------------------------------------------------------

/** The line under "Leave by": planned from the arrive-by times, or as typed; "estimated times" when the road times are an estimate. */
export function leaveNote(p: Pick<PlanPreview, 'timeline' | 'plan'> | null | undefined): { source: 'plan' | 'typed'; estimate: boolean } | null {
  const leave = p?.timeline?.items.find((x) => x.kind === 'leave');
  if (!leave || leave.kind !== 'leave') return null;
  const estimate = p?.plan?.source === 'estimate' || !!p?.timeline?.items.some((x) => x.kind === 'leg' && x.source === 'estimate');
  return { source: leave.source === 'plan' ? 'plan' : 'typed', estimate };
}

/** What a conflict card offers: Open that task (only to who may open tasks), Call / WhatsApp, Pick another vehicle / driver. */
export function conflictActions(c: Conflict, opensTasks: boolean): { openTask?: string; pick: 'vehicle' | 'driver' | null } {
  return {
    openTask: c.task && opensTasks ? c.task.id : undefined,
    pick: c.kind === 'driver' ? 'driver' : 'vehicle',
  };
}

// ---------------------------------------------------------------------------
// After sending: the outcome card
// ---------------------------------------------------------------------------

export type OutcomeKind = 'sent' | 'waiting' | 'request_sent' | 'booked' | 'saved';

export interface Outcome {
  kind: OutcomeKind;
  /** The flow that made it (the draft is gone by then). */
  mode?: 'request' | 'task' | 'edit' | 'stops';
  /** booked: who has the vehicle, and when. */
  who?: string;
  when?: string;
  /** saved: an approved booking changed, the office decides again. */
  needsReapproval?: boolean;
  /** The task or the request the outcome made, when the person may open it. */
  taskId?: string;
  requestId?: string;
  leaveBy?: string;
  /** "WP CAB-4521 · Kamal's vehicle today", or the server's vehicle_changed sentence, or the plate. */
  vehicle?: string;
  warnings: string[];
  conflicts: Conflict[];
  next?: string;
}

/** The outcome of create_task: sent to the driver, or waiting for the fleet admin's OK (the site's assignOutcome). */
export function taskOutcome(p: CreateTaskResult): Outcome {
  const waiting = !!p.waiting_for_approval || (!p.task_id && !!p.request_id);
  return {
    kind: waiting ? 'waiting' : 'sent',
    taskId: p.task_id,
    requestId: p.request_id,
    leaveBy: p.leave_by?.slice(-5),
    vehicle: p.vehicle_changed ?? (p.vehicle_used ? `${p.vehicle_used.reg_no} · ${p.vehicle_used.why === 'chosen' ? '' : p.vehicle_used.why}`.replace(/ · $/, '') : p.vehicle),
    warnings: p.warnings ?? [],
    conflicts: p.conflicts ?? [],
    next: p.next,
  };
}

/** The outcome of book_vehicle: booked, with the task when it was made. */
export function bookOutcome(p: { task_id?: string; request_id?: string; leave_by?: string; when?: string; vehicle?: string; vehicle_used?: { reg_no: string; why: string }; vehicle_changed?: string; warnings?: string[]; conflicts?: Conflict[]; request?: { requested_by?: string; on_behalf_of?: string } }): Outcome {
  return {
    kind: 'booked',
    who: p.request?.on_behalf_of ?? p.request?.requested_by,
    when: p.when,
    taskId: p.task_id,
    requestId: p.request_id,
    leaveBy: p.leave_by?.slice(-5),
    vehicle: p.vehicle_changed ?? (p.vehicle_used ? `${p.vehicle_used.reg_no} · ${p.vehicle_used.why === 'chosen' ? '' : p.vehicle_used.why}`.replace(/ · $/, '') : p.vehicle),
    warnings: p.warnings ?? [],
    // Round 4–7 (7): book_vehicle answers the conflicts too (with who holds the driver or vehicle).
    conflicts: p.conflicts ?? [],
  };
}

/** The outcome of create_request / update_request / update_task_stops: sent, or saved. */
export function requestOutcome(kind: 'request_sent' | 'saved', p: { next?: string; warnings?: string[]; request_id?: string; task_id?: string; needs_reapproval?: boolean }): Outcome {
  return { kind, requestId: p.request_id, taskId: p.task_id, warnings: p.warnings ?? [], conflicts: [], next: p.next, needsReapproval: p.needs_reapproval };
}

/** The driver's WhatsApp link with the task's words, from the number in a wa.me link (the availability rows carry it). */
export function whatsappWithText(whatsappLink: string | undefined, text: string): string {
  if (!whatsappLink) return '';
  const base = whatsappLink.split('?')[0];
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** The message for the driver (the site's driverWhatsApp): the title, the leave-by, the stops, the contact. */
export function driverMessage(input: Record<string, unknown>, leaveBy: string | undefined, words: { pickup: string; drop: string; visit: string; stop: string; contact: string; open: string; newTask: string }): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const stops = (input.stops as { type: string; place?: string }[] | undefined) ?? [];
  const word: Record<string, string> = { pickup: words.pickup, drop: words.drop, visit: words.visit };
  const lines = stops.map((x) => `${word[x.type] ?? words.stop}: ${x.place ?? ''}`.trim());
  const contact = s('contact_name') ? `\n${words.contact}: ${s('contact_name')}${s('contact_phone') ? ` ${s('contact_phone')}` : ''}` : '';
  return `${words.newTask}: ${s('title')}\n${leaveBy ?? `${s('date')} ${s('leave_by')}`}\n${lines.join('\n')}${contact}\n${words.open}`;
}
