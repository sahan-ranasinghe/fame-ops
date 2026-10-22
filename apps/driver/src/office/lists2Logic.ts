// Office mode (Round 4–7, item 8, the lists cleaned up, second part; docs/phase8-plan.md §33.7 rule 7, docs/phase8-parity.md
// "the list audit"): the rules that let a row say each fact once. A word the section, the filter or the row's own line
// already says is left out; a fact the row alone carries (a time, who decided, an action) always stays. Pure: tested in
// scripts/test-lists2.ts (and tests/officeLists2.test.tsx through the screens).

import { dateWords } from '@/lib/dateWords';

import { keyExists } from '../i18n/keys';
import { availabilityText } from './availabilityWords';
import { docTone } from './manageLogic';
import { sentenceWords, wordsText, type Words } from './statusWords';
import type { BoardColumn } from './statusWords';
import type { BoardDriver, Inbox, MyTrips, RequestCard, VehicleCard } from './types';

type T = (key: string, vars?: Record<string, string | number>) => string;

// ---- Vehicles ------------------------------------------------------------------------------------------------------

/**
 * A vehicle's row (Samsara's and Fleetio's vehicle lists): the plate on the left (said once: the title is never the plate
 * again), the make · seats as the title (else the type in words, else "Make not set"), ONE status: the availability line
 * ("Free", "On a task · back ~14:30 (live)"), the pill only for In garage (the line then without "In garage") and for a
 * returned vehicle. An older answer without the line keeps the status pill.
 */
export function vehicleRowShown(
  v: Pick<VehicleCard, 'reg_no' | 'make_model' | 'type' | 'seats' | 'status' | 'availability' | 'active'>,
  t: T,
): { title: string; availability: string; pill: { text: string; tone: 'amber' | 'muted' | 'blue' | 'green' } | null } {
  const typeKey = v.type ? `office.vehicles.type_${v.type}` : '';
  const typeWord = typeKey && keyExists(typeKey) ? t(typeKey) : '';
  const title = [v.make_model || typeWord, v.seats ? t('office.vehicles.seats', { n: v.seats }) : ''].filter(Boolean).join(' · ') || t('office.lists2.vehicles.noMake');
  const status = String(v.status ?? '');
  const line = String(v.availability ?? '');
  const garage = /garage/i.test(status);
  const pill = v.active === false
    ? { text: t('office.vehicles.returned'), tone: 'muted' as const }
    : garage
      ? { text: t('office.vehicles.filter_in_garage'), tone: 'amber' as const }
      : !line && status
        ? { text: status, tone: /task/i.test(status) ? 'blue' as const : 'green' as const }
        : null;
  // The line in the person's language (Round 4–7 unify: office/availabilityWords.ts; a sentence it does not know as sent).
  return { title, availability: garage && /garage/i.test(line) ? '' : availabilityText(t, line), pill };
}

/** A document chip is quiet (its name with a tick, no fill) when valid; expiring, expired and not set keep their colour. */
export const docQuiet = (tone: 'red' | 'amber' | 'green' | 'muted'): boolean => tone === 'green';

/** The three roadside documents, in the order the chips show them. */
export const DOC_KEYS = ['lic', 'ins', 'emi'] as const;

/**
 * Sahan's removals (22 October 2026): when the licence, the insurance and the emission test are all valid and no document
 * is missing, the vehicle (list and page) shows one quiet line "Documents valid" (a tick and the words) instead of three
 * chips. Anything expiring, expired, not set or missing keeps the chips as before.
 */
export function docsAllValid(v: Pick<VehicleCard, 'documents' | 'documents_missing' | 'documents_missing_text'>): boolean {
  if (v.documents_missing?.length || v.documents_missing_text) return false;
  return DOC_KEYS.every((k) => docTone(v.documents?.[k]?.chip) === 'green');
}

/** What the screen reader hears on that line: "Documents valid, Lic valid until 12 Mar 2027, Ins valid until …" (each expiry). */
export function docsValidLabel(v: Pick<VehicleCard, 'documents'>, t: T): string {
  const each = DOC_KEYS.map((k) => {
    const doc = t(`office.vehicles.doc_${k}`);
    const expiry = v.documents?.[k]?.expiry;
    return expiry ? t('office.lists2.vehicles.docValidUntil', { doc, date: dateWords(t, expiry) }) : t('office.lists2.vehicles.docValid', { doc });
  });
  return [t('office.lists2.vehicles.docsValid'), ...each].join(', ');
}

// ---- My trips ------------------------------------------------------------------------------------------------------

/** My trips' page: 25 at a time with Load more (before: 100 at once). */
export const TRIPS_PAGE = 25;

/** The chip key of a live state that is the section's own word (Waiting under WAITING, Done under DONE, Expired under EXPIRED). */
const GROUP_CHIP: Record<string, string> = { waiting: 'waiting', done: 'done', expired: 'expired' };

/**
 * The trip's chip only when it says something the section and the line under the title do not: never "Waiting" in
 * Waiting, "Done" in Done or "Expired" in Expired; never "Approved" beside "Approved by Palitha · Sun 16:40".
 */
export function tripChipShown(chipKey: string, group: string, approvedLine: boolean): boolean {
  if (GROUP_CHIP[group] === chipKey) return false;
  if (chipKey === 'approved' && approvedLine) return false;
  return true;
}

/** The next page of trips after those on screen (never one twice; a request and a created task may share an id). */
export function appendTrips(list: MyTrips, page: MyTrips): MyTrips {
  const key = (x: MyTrips['trips'][number]) => `${(x as { source?: string }).source === 'task' ? 't' : 'r'}-${x.id}`;
  const seen = new Set(list.trips.map(key));
  const out: MyTrips = { ...list, trips: [...list.trips, ...page.trips.filter((x) => !seen.has(key(x)))] };
  if (page.next) out.next = page.next;
  else delete out.next;
  if (page.total !== undefined) out.total = page.total;
  return out;
}

// ---- Approve -------------------------------------------------------------------------------------------------------

/**
 * A request's row: the avatar is the requester; the title is the trip (its title, else the route, else the project) and
 * the line says who asked · when · the need · the proposal. A request with none of those keeps the requester as its
 * title, and the line then leaves the name out (it was up to three times: the avatar, the title, the line).
 */
export function approveRowShown(r: Pick<RequestCard, 'title' | 'route' | 'project' | 'requested_by' | 'need' | 'proposed'>, when: string): { title: string; line: string } {
  const trip = r.title || r.route || r.project;
  const parts = [trip ? r.requested_by : '', when, r.need];
  if (r.proposed?.driver) parts.push(`${r.proposed.driver}${r.proposed.vehicle ? ` · ${r.proposed.vehicle}` : ''}`);
  return { title: trip || r.requested_by, line: parts.filter(Boolean).join(' · ') };
}

/** The status chip only when the section does not say it: every row under All; under Waiting only a Changed one. */
export function requestChipShown(section: string, status: string | undefined): boolean {
  if (section === 'all') return true;
  return status !== section;
}

// ---- Alerts --------------------------------------------------------------------------------------------------------

/** my_inbox's input with the Unread filter asked of the server (my_inbox `unread`: Load more pages the unread ones only). */
export const inboxWithUnread = (args: Record<string, unknown>, filter: 'all' | 'unread'): Record<string, unknown> =>
  (filter === 'unread' ? { ...args, unread: true } : args);

/** The unread count after a page of unread ones came: the server's count wins. */
export const inboxUnread = (d: Pick<Inbox, 'unread'> | null | undefined, fallback: number): number => d?.unread ?? fallback;

// ---- Mileage (Reports) ---------------------------------------------------------------------------------------------

/** A Mileage section shows its first 5 rows; Show all N shows 25, then Load more 25 at a time (all local: one answer). */
export const SECTION_FIRST = 5;
export const SECTION_PAGE = 25;

/** How many rows a section shows now (`shown` = what was asked; never more than there are). */
export const sectionShown = (rows: number, shown: number): number => Math.min(rows, shown);

/** After Show all (the first press) or Load more: the next count. */
export const sectionNext = (shown: number): number => (shown <= SECTION_FIRST ? SECTION_PAGE : shown + SECTION_PAGE);

// ---- Drivers -------------------------------------------------------------------------------------------------------

/** The status sentences (statusWords' keys) said without the state's own words: what is left after "On a task", "Off duty", "Not available". */
const REST: Record<string, string> = {
  'office.line.onTaskUntil': 'office.lists2.rest.until',
  'office.line.onTaskUntil_live': 'office.lists2.rest.untilLive',
  'office.line.onTaskUntil_planned': 'office.lists2.rest.untilPlanned',
  'office.line.onTaskNoEnd': 'office.lists2.rest.noEnd',
  'office.line.offDuty': '',
  'office.line.offDutySince': 'office.lists2.rest.since',
  'office.line.notAvailableBack': 'office.lists2.rest.back',
  'office.line.notAvailableToday': 'office.lists2.rest.today',
  'office.line.notAvailableUntil': 'office.lists2.rest.untilWhen',
  // "Not available · leave, all day": the detail alone, in the person's words.
  'office.line.notAvailable': '@detail',
};

/**
 * What a status sentence adds once its state is said elsewhere (the Show filter, the Not available pill): "Since 07:40",
 * "Until ~10:40 (live)", "Back 13:00"; "" when it adds nothing ("Off duty"); null for a sentence this app does not read
 * (then it is shown whole).
 */
export function statusRest(t: T, text: string | undefined | null): string | null {
  const w = sentenceWords(text);
  if (!w || !(w.key in REST)) return null;
  const key = REST[w.key];
  if (!key) return '';
  if (key === '@detail') return typeof w.vars?.detail === 'object' ? wordsText(t, w.vars.detail as Words) : String(w.vars?.detail ?? '');
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(w.vars ?? {})) if (k !== 'refused') vars[k] = typeof v === 'object' ? wordsText(t, v as Words) : v;
  const refused = typeof w.vars?.refused === 'number' ? ` · ${t('office.line.refused', { n: w.vars.refused })}` : '';
  return t(key, vars) + refused;
}

export type BoardShow = 'all' | 'free_now' | 'on_task' | 'off_duty' | 'not_available';

/**
 * A driver row's state said once. The Not available pill (in the Call button's place, as before) shows unless the Show
 * filter is Not available; the first line then says only what the state adds. Under On a task / Off duty the same: the
 * filter says the state. The avatar's dot stays (the presence colour, as Slack's and Teams').
 */
export function driverStateShown(d: Pick<BoardDriver, 'status'>, filter: BoardShow): { pill: boolean; restOnly: boolean } {
  const pill = d.status.kind === 'not_available' && filter !== 'not_available';
  const echo = filter !== 'all' && filter !== 'free_now' && d.status.kind === filter;
  return { pill, restOnly: echo || pill };
}

// ---- Tasks ---------------------------------------------------------------------------------------------------------

/** The status sentence keys a row's chip would say again (statusWords taskChip → the line's own sentence). */
const CHIP_SAID_BY: Record<string, readonly string[]> = {
  sent: ['office.line.sent'],
  seen: ['office.line.seen'],
  accepted: ['office.line.accepted'],
};

/**
 * A task row's chip only when neither the section nor the row's line says it (it was "Done" three times in DONE): never
 * Done in Done, Under way in On the way, Sent / Seen / Accepted beside the same sentence, Self-drive / Someone else beside
 * "Drives themselves" / "Someone else" (the line always names who drives). Late N min, Not confirmed and Needs driver stay.
 */
export function taskChipShown(column: BoardColumn, chipKey: string, card: { status?: string }): boolean {
  if (column === 'completed') return chipKey !== 'done';
  if (column === 'in_progress') return chipKey !== 'underWay';
  if (chipKey === 'selfDrive' || chipKey === 'someoneElse') return false;
  const said = CHIP_SAID_BY[chipKey];
  return !said || !said.includes(sentenceWords(card.status)?.key ?? '');
}

/**
 * A Waiting for approval row's chip (Sahan, 22 October 2026): the section already says Waiting, so the row has a chip only
 * when the request is late (its leave-by passed, not decided: task_board's `late`): "Late", in words, red. Before, every row
 * said Waiting and only its red told a late one apart.
 */
export const waitingChip = (w: { late?: boolean }): boolean => w.late === true;
