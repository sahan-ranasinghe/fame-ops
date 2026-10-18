// Who the driver can call about a task, and the office (Hotfix 2, F and K). Pure: no React, so scripts/test-preview.ts
// runs it.
//
//   - The numbers come from the server: my_task_contacts(task) (who asked, who assigned it, who approved it, else the
//     approvers, the office's number; the driver's own tasks only) and my_office_contacts() (Me: the office and the
//     approvers). Phones are E.164 (+94…); a field is left out when unknown. The phone keeps the last answer per task,
//     so the buttons show offline.
//   - The task's own contact person (tasks.contact_phone) is typed by the office, local or international.
//   - Each button opens the dialler with the number filled (tel:) or WhatsApp (https://wa.me/<digits>); nothing dials
//     by itself (no CALL_PHONE permission). A button without a number is not shown; the same number twice is shown once.
//   - Numbers read "077 123 4567" (Latin digits in both languages).

import { phoneDigits } from './format';

export interface Person {
  name: string | null;
  phone: string | null;
}

export interface TaskContacts {
  /** Who asked for the trip (the request's asker, or the person it was made on behalf of). */
  requester: Person | null;
  /** Who gave the task to the driver. */
  assigner: Person | null;
  /** Who approved it, and when (ISO). */
  approver: (Person & { at: string | null }) | null;
  /** The people who approve, with a number (to call when the approver has none, or none is named). */
  approvers: Person[];
  officePhone: string | null;
}

export interface OfficeContacts {
  officePhone: string | null;
  approvers: Person[];
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function person(v: unknown): Person | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = text(o.name);
  const phone = text(o.phone);
  return name || phone ? { name, phone } : null;
}

function people(v: unknown): Person[] {
  return Array.isArray(v) ? v.map(person).filter((p): p is Person => p !== null) : [];
}

/** my_task_contacts' answer, read defensively (null: not the driver's task, or no answer). */
export function parseTaskContacts(raw: unknown): TaskContacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const approver = person(o.approver);
  const at = o.approver && typeof o.approver === 'object' ? text((o.approver as Record<string, unknown>).at) : null;
  return {
    requester: person(o.requester),
    assigner: person(o.assigner),
    approver: approver ? { ...approver, at } : null,
    approvers: people(o.approvers),
    officePhone: text(o.office_phone),
  };
}

/** my_office_contacts' answer (null for anyone but an active driver). */
export function parseOfficeContacts(raw: unknown): OfficeContacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return { officePhone: text(o.office_phone), approvers: people(o.approvers) };
}

/** "+94771234567" → "077 123 4567" (Sri Lankan mobiles and landlines, as the office shows them); anything else as given. */
export function phoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '');
  const local = d.startsWith('94') && d.length === 11 ? `0${d.slice(2)}` : d.length === 10 && d.startsWith('0') ? d : null;
  return local ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone.trim();
}

/** WhatsApp chat with the number (international digits, no plus), or null. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${digits}` : null;
}

export type CallKind = 'contact' | 'requester' | 'fleetAdmin' | 'office';

/** One person to call: what the button says (an i18n key), their name and number, and the two links. */
export interface CallTarget {
  kind: CallKind;
  /** call.contact, call.requester, call.fleetAdmin, call.office */
  label: string;
  name: string | null;
  /** "077 123 4567" */
  display: string;
  /** tel:+94771234567 (the dialler opens with the number filled; nothing dials by itself) */
  tel: string;
  /** https://wa.me/94771234567 */
  whatsapp: string;
}

const LABEL: Record<CallKind, string> = { contact: 'call.contact', requester: 'call.requester', fleetAdmin: 'call.fleetAdmin', office: 'call.office' };

function target(kind: CallKind, name: string | null, phone: string | null | undefined): CallTarget | null {
  const digits = phoneDigits(phone);
  if (!phone || !digits) return null;
  return { kind, label: LABEL[kind], name, display: phoneDisplay(phone), tel: `tel:+${digits}`, whatsapp: `https://wa.me/${digits}` };
}

/** Fleet admins to offer when the approver has no number: at most this many. */
export const MAX_APPROVERS = 3;

/** The same number twice (the requester is the approver, say) is shown once: the first wins. */
function unique(list: (CallTarget | null)[]): CallTarget[] {
  const seen = new Set<string>();
  return list.filter((c): c is CallTarget => {
    if (!c || seen.has(c.tel)) return false;
    seen.add(c.tel);
    return true;
  });
}

/** The fleet admin to call: who approved the task; else the approvers with a number. */
function fleetAdmins(approver: Person | null, approvers: Person[]): (CallTarget | null)[] {
  const approved = approver ? target('fleetAdmin', approver.name, approver.phone) : null;
  if (approved) return [approved];
  return approvers.slice(0, MAX_APPROVERS).map((p) => target('fleetAdmin', p.name, p.phone));
}

/**
 * The task's call buttons, in order: Call contact (the task's contact person), Call requester (who asked; else who
 * assigned it), Call fleet admin (who approved it; else the approvers), Call office. Without a number, no button.
 */
export function taskCalls(task: { contact_name: string | null; contact_phone: string | null }, contacts: TaskContacts | null): CallTarget[] {
  const asker = contacts?.requester?.phone ? contacts.requester : contacts?.assigner?.phone ? contacts.assigner : null;
  return unique([
    target('contact', task.contact_name, task.contact_phone),
    asker ? target('requester', asker.name, asker.phone) : null,
    ...fleetAdmins(contacts?.approver ?? null, contacts?.approvers ?? []),
    target('office', null, contacts?.officePhone),
  ]);
}

/** Me: Call office and Call fleet admin (the approvers with a number). */
export function officeCalls(contacts: OfficeContacts | null): CallTarget[] {
  return unique([target('office', null, contacts?.officePhone), ...fleetAdmins(null, contacts?.approvers ?? [])]);
}

/** "Asked by Nimal" (the request's asker) or "Given by Palitha" (no request: who assigned it); null when neither is known. */
export function askedBy(contacts: TaskContacts | null): { key: 'preview.askedBy' | 'preview.assignedBy'; name: string } | null {
  if (contacts?.requester?.name) return { key: 'preview.askedBy', name: contacts.requester.name };
  if (contacts?.assigner?.name) return { key: 'preview.assignedBy', name: contacts.assigner.name };
  return null;
}

/**
 * "Approved by Palitha · 10:42" (K): the approver's name and time, with Call: the approver's number, else the office's.
 * Null when the server named no approver.
 */
export function approvedBy(contacts: TaskContacts | null): { name: string; at: string | null; call: CallTarget | null } | null {
  const approver = contacts?.approver;
  if (!approver?.name) return null;
  const call = target('fleetAdmin', approver.name, approver.phone) ?? target('office', null, contacts?.officePhone);
  return { name: approver.name, at: approver.at, call };
}
