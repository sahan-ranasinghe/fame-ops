// Round 52 (docs/phase8-plan.md §40; Shopify's and Samsara's archive, Gmail's and Google Drive's bin, GitHub's
// type-to-confirm), the pure rules of Office mode's archive, delete and Recently deleted (scripts/test-bin.ts runs them in
// node; the screens and components/office/BinParts.tsx use them):
//   - a person or a vehicle is deleted only after typing its name or plate, compared as the server compares (a plate
//     ignoring spaces, dashes and case; a name ignoring case and extra spaces);
//   - a wrong entry needs a reason of a few words (3 characters, as delete_entry);
//   - archiving a driver or a vehicle with trips from today on answers needs_confirm: the trips are listed first;
//   - the lists' inputs (list_projects pages with the search, list_bin) and the rows' words.

import type { FilterDef } from '../lib/patterns/filterLogic';
import type { ArchiveNeedsConfirm, BinItem, CanDeleteResult, EntryKind, ProjectRow, ProjectsList, RecordKind, RentalCompanyRow } from './types';

export type Words = (key: string, vars?: Record<string, string | number>) => string;

/** A page of the lists. */
export const BIN_PAGE = 25;
/** The words typed go to the server this long after the last key. */
export const BIN_SEARCH_MS = 500;
/** delete_entry's shortest reason. */
export const MIN_REASON = 3;

/** The typed confirm against the name or plate (the server's confirmMatches in tools/bin.ts). */
export function confirmMatches(kind: RecordKind, typed: string | undefined, expected: string | undefined): boolean {
  if (!typed || !expected) return false;
  const norm = (s: string) => (kind === 'vehicle' ? s.toUpperCase().replace(/[\s-]/g, '') : s.trim().replace(/\s+/g, ' ').toLowerCase());
  return norm(typed) === norm(expected);
}

/** Whether the record needs its name or plate typed (a person or a vehicle; the server says which by confirm_with). */
export const needsTyping = (a: Pick<CanDeleteResult, 'confirm_with'>): boolean => !!a.confirm_with;

/** What the record's page shows under Delete permanently: the button, why not (history / the account guard), or nothing. */
export type DeleteState = { kind: 'button' } | { kind: 'history'; words: string } | { kind: 'problem'; text: string } | { kind: 'none' };
export function deleteState(a: CanDeleteResult | null | undefined, t?: Words): DeleteState {
  if (!a) return { kind: 'none' };
  if (a.deletable) return { kind: 'button' };
  if (a.problem) return { kind: 'problem', text: a.problem };
  const words = historyText(a, t);
  if (words) return { kind: 'history', words };
  return { kind: 'none' };
}

/** What record_history counts (tools/bin.ts HISTORY_WORDS), each with its words in both languages (office.bin.h1 / h). */
export const HISTORY_KEYS = [
  'tasks', 'requests', 'fuel', 'odometer', 'odometer_photos', 'checks', 'reports', 'documents', 'duty', 'held', 'locations', 'days', 'heartbeats', 'asks',
  'passenger', 'assignments', 'issue_work', 'claims', 'stops', 'request_stops', 'starts', 'vehicles',
] as const;

/** "3 tasks, 2 fills" in the person's language from the counts; the server's English when a count is one we do not know. */
export function historyText(a: Pick<CanDeleteResult, 'history' | 'history_words'>, t?: Words): string {
  const counts = Object.entries(a.history ?? {}).filter(([, n]) => n > 0);
  if (!t || counts.length === 0 || counts.some(([k]) => !(HISTORY_KEYS as readonly string[]).includes(k))) return a.history_words ?? '';
  return counts.map(([k, n]) => t(n === 1 ? `office.bin.h1.${k}` : `office.bin.h.${k}`, { n: n.toLocaleString('en-US') })).join(', ');
}

/** delete_record's input: the name or plate typed goes with a person or a vehicle. */
export function deleteRecordInput(kind: RecordKind, ref: string, typed: string, a: Pick<CanDeleteResult, 'confirm_with'>): Record<string, unknown> {
  return { kind, ref, ...(a.confirm_with ? { confirm_text: typed.trim() } : {}) };
}

/** Whether Delete may be pressed: deletable, and for a person or a vehicle the name or plate typed. */
export function deleteReady(kind: RecordKind, a: CanDeleteResult | null | undefined, typed: string): boolean {
  if (!a?.deletable) return false;
  return needsTyping(a) ? confirmMatches(kind, typed, a.confirm_with) : true;
}

/** A wrong entry's reason is enough (a few words). */
export const reasonOk = (reason: string): boolean => reason.trim().length >= MIN_REASON;

export function deleteEntryInput(kind: EntryKind, id: string, reason: string): Record<string, unknown> {
  return { kind, id, reason: reason.trim() };
}

export const previewInput = (kind: EntryKind, id: string): Record<string, unknown> => ({ kind, id, preview: true });

/** Whether an archive answer asks first (trips from today on). */
export function asksFirst(out: unknown): out is ArchiveNeedsConfirm {
  return !!out && typeof out === 'object' && (out as { needs_confirm?: unknown }).needs_confirm === true && Array.isArray((out as { trips?: unknown }).trips);
}

/** set_vehicle_active's input; confirm only on the second call. */
export function vehicleActiveInput(reg: string, active: boolean, confirm = false): Record<string, unknown> {
  return { reg_no: reg, active, ...(confirm ? { confirm: true } : {}) };
}

/** list_projects' input: the archived ones only when asked, the search trimmed, a page at a time. */
export function projectsArgs(archived: boolean, search: string, cursor?: string): Record<string, unknown> {
  const s = search.trim().slice(0, 80);
  return { limit: BIN_PAGE, ...(archived ? { archived: true } : {}), ...(s ? { search: s } : {}), ...(cursor ? { cursor } : {}) };
}

/** list_bin's input. */
export function binArgs(search: string, cursor?: string): Record<string, unknown> {
  const s = search.trim().slice(0, 80);
  return { limit: BIN_PAGE, ...(s ? { search: s } : {}), ...(cursor ? { cursor } : {}) };
}

/** The next page appended: a row never twice, the cursor and the total the page's. */
export function appendPage<K extends string, T extends { id: string }>(prev: { [k in K]: T[] } & { total?: number; next?: string }, page: { [k in K]: T[] } & { total?: number; next?: string }, key: K) {
  const seen = new Set(prev[key].map((r) => r.id));
  const out = { ...prev, [key]: [...prev[key], ...page[key].filter((r) => !seen.has(r.id))] } as typeof prev;
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

export const appendProjects = (prev: ProjectsList, page: ProjectsList): ProjectsList => appendPage(prev, page, 'projects');

/** A project's title and its line: "13021 · TRKAN1" over the name, the customer and the status. */
export function projectTitle(p: ProjectRow): string {
  return p.short_name ? `${p.short_name} · ${p.name}` : p.name;
}
export function projectLine(p: ProjectRow): string {
  return [p.job_no, p.customer, p.status].filter(Boolean).join(' · ');
}

/** Projects' and Rental companies' Filter: Active (the default) or Show archived (the archived ones only, as the server
 *  answers archived true). */
export function archivedFilterDefs(t: Words): FilterDef[] {
  return [{
    key: 'show',
    label: t('office.bin.show'),
    kind: 'single',
    default: 'active',
    options: [{ value: 'active', label: t('office.bin.showActive') }, { value: 'archived', label: t('office.bin.showArchived') }],
  }];
}

/** The "Show archived" filter (one choice; its value: 'active' or 'archived'). */
export const showArchivedOf = (values: Record<string, unknown>): boolean => values.show === 'archived';

/** A rental company may go for good only when no vehicle names it (the server checks again). */
export const companyDeletable = (c: Pick<RentalCompanyRow, 'vehicles' | 'archived'>): boolean => c.vehicles === 0;

/** The rental companies whose words match the search (the list comes whole). */
export function companiesShown(list: RentalCompanyRow[], search: string): RentalCompanyRow[] {
  const s = search.trim().toLowerCase();
  if (!s) return list;
  return list.filter((c) => `${c.name} ${c.phone ?? ''}`.toLowerCase().includes(s));
}

/** A Recently deleted row in words: what it was, by whom and when, the reason, until when (`when` says a date in words:
 *  the screen passes lib/dateWords' dateWords). */
export function binRowWords(item: BinItem, t: Words, when: (s: string) => string = (s) => s): { title: string; line: string; reason?: string; restoreLine: string } {
  return {
    title: item.label,
    line: [item.detail, t('office.bin.deletedBy', { name: item.deleted_by, at: when(item.deleted_at) })].filter(Boolean).join(' · '),
    reason: item.reason ? t('office.bin.reason', { reason: item.reason }) : undefined,
    restoreLine: item.days_left === 1 ? t('office.bin.untilOne', { date: when(item.until) }) : t('office.bin.until', { date: when(item.until), n: item.days_left }),
  };
}

/** When it was archived and by whom, in the app's own words ("Archived 1 Oct by Sahan"); nothing from an older server
 *  that sends only its English sentence (the pill still says archived). `when` says the date in words. */
export function archivedWords(row: { archived_on?: string; archived_by?: string }, t: Words, when: (s: string) => string = (s) => s): string | undefined {
  if (!row.archived_on) return undefined;
  const date = when(row.archived_on);
  return row.archived_by ? t('office.bin.archivedOnBy', { date, name: row.archived_by }) : t('office.bin.archivedOn', { when: date });
}

/** The kind of a bin row in words (its chip). */
export const binKindKey = (kind: string): string => `office.bin.kind_${kind}`;
