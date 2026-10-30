// Round 52 (docs/phase8-plan.md §40): archive, delete and restore, the pure part. The server's answers (tools/bin.ts:
// can_delete, delete_record, delete_entry, list_bin, restore_bin_item; set_driver_active and set_vehicle_active's
// needs_confirm), GitHub's type-to-confirm compared as the server compares it (a plate ignoring spaces, dashes and case; a
// name ignoring case and extra spaces), the words of each step, and the archive step's state (Shopify's and Samsara's
// archive: a record with trips from today on asks first, naming them).
import { dayWords, whenText } from "../../lib/when";

export const RECORD_KINDS = ["vehicle", "driver", "office_person", "place", "project", "rental_company"] as const;
export const ENTRY_KINDS = ["fuel", "odometer", "check", "issue", "request", "task"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type BinKind = RecordKind | EntryKind;

/** A kind in words (never the server's code name on a screen). */
export const KIND_TEXT: Record<BinKind, string> = {
  vehicle: "Vehicle",
  driver: "Driver",
  office_person: "Office person",
  place: "Place",
  project: "Project",
  rental_company: "Rental company",
  fuel: "Fill",
  odometer: "Odometer reading",
  check: "Vehicle check",
  issue: "Issue",
  request: "Request",
  task: "Task",
};

/** can_delete's answer. */
export interface CanDeleteAnswer {
  kind: RecordKind;
  id: string;
  label: string;
  deletable: boolean;
  history?: Record<string, number>;
  /** "3 tasks, 2 fills" */
  history_words?: string;
  /** Why this person's account cannot be deleted by you (the account guards), in a sentence. */
  problem?: string;
  /** What to type to confirm: a person's name or a vehicle's plate (absent for the others). */
  confirm_with?: string;
}

/** delete_record's and delete_entry's answer. */
export interface DeletedAnswer {
  deleted: string;
  kind: BinKind;
  bin_id: string;
  /** "2026-11-29": the last day it can be restored. */
  until: string;
  next?: string;
  affects?: string[];
  notes?: string[];
}

/** delete_entry with preview: what it is and what goes with it (nothing deleted). */
export interface EntryPreview {
  kind: EntryKind;
  id: string;
  label: string;
  affects: string[];
}

/** One row of Recently deleted (list_bin). */
export interface BinItem {
  id: string;
  kind: BinKind;
  record_id: string;
  label: string;
  detail?: string;
  reason?: string;
  deleted_by: string;
  /** "2026-10-30 14:05" (Colombo) */
  deleted_at: string;
  until: string;
  days_left: number;
}

export interface BinList {
  items: BinItem[];
  total?: number;
  next?: string;
}

/** restore_bin_item's answer. */
export interface RestoredAnswer {
  restored: string;
  kind: BinKind;
  record_id: string;
  notes?: string[];
}

/** A typed confirm compared as the server compares it (tools/bin.ts confirmMatches). */
export function typedMatches(kind: RecordKind, typed: string, expected: string): boolean {
  if (!typed.trim()) return false;
  const norm = (s: string) => kind === "vehicle" ? s.toUpperCase().replace(/[\s-]/g, "") : s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) === norm(expected);
}

/** What the page says instead of Delete permanently: the account rule's sentence, or the history (archive instead). */
export function notDeletableLines(c: CanDeleteAnswer): string[] {
  if (c.deletable) return [];
  const lines: string[] = [];
  if (c.problem) lines.push(c.problem);
  if (c.history_words) lines.push(`Has history (${c.history_words}): archive instead`);
  if (!lines.length) lines.push("It cannot be deleted: archive it instead.");
  return lines;
}

/** The type-to-confirm prompt: "Type the plate WP CAB-4521 to confirm" / "Type the name Kamal Perera to confirm". */
export const typePrompt = (kind: RecordKind, expected: string) => `Type ${kind === "vehicle" ? "the plate" : "the name"} ${expected} to confirm`;

/** The toast after a delete: "Deleted · in Recently deleted until Sun 29 Nov". */
export const deletedToast = (until?: string) => (until ? `Deleted · in Recently deleted until ${dayWords(until, { inline: true })}` : "Deleted · in Recently deleted");

/** A wrong entry's reason: a few words (the server's minimum, 3 characters). */
export const REASON_MIN = 3;
export const reasonOk = (reason: string) => reason.trim().length >= REASON_MIN;

/** "Deleted by Sahan · Today 14:05" */
export const deletedByLine = (i: Pick<BinItem, "deleted_by" | "deleted_at">) => `Deleted by ${i.deleted_by} · ${whenText(i.deleted_at, { inline: true })}`;

/** "Restore until Sun 29 Nov (30 days)" / "(1 day)" / "(today)". */
export function restoreLine(i: Pick<BinItem, "until" | "days_left">): string {
  const left = i.days_left <= 0 ? "today" : `${i.days_left} day${i.days_left === 1 ? "" : "s"}`;
  return `Restore until ${dayWords(i.until, { inline: true })} (${left})`;
}

/** The kinds for Recently deleted's Filter, with "All kinds" first. */
export const BIN_KIND_CHOICES: [string, string][] = [["", "All kinds"], ...[...RECORD_KINDS, ...ENTRY_KINDS].map((k): [string, string] => [k, KIND_TEXT[k]])];

/** list_bin's input. */
export function binArgs(kind: string, search: string): Record<string, unknown> {
  return { ...(kind ? { kind } : {}), ...(search.trim() ? { search: search.trim() } : {}) };
}

// --- Archive ----------------------------------------------------------------------------------------------------------------

/** One trip from today on that would lose its driver or vehicle. */
export interface ArchiveTrip {
  task_id: string;
  title: string;
  /** "2026-10-31 09:00" (Colombo) */
  when: string;
}

/** set_driver_active / set_vehicle_active archiving one with trips from today on. */
export interface NeedsConfirmAnswer {
  needs_confirm: true;
  trips: ArchiveTrip[];
  note?: string;
  driver?: string;
  vehicle?: string;
  username?: string;
}

export const isNeedsConfirm = (a: unknown): a is NeedsConfirmAnswer => !!a && (a as { needs_confirm?: unknown }).needs_confirm === true;

/** "Sat 31 Oct 09:00 · Team drop · Kurunegala site" */
export const archiveTripLine = (t: ArchiveTrip) => `${whenText(t.when, { inline: true })} · ${t.title}`;

export type ArchiveState = { step: "idle" } | { step: "armed" } | { step: "trips"; trips: ArchiveTrip[]; note?: string };
export const ARCHIVE_IDLE: ArchiveState = { step: "idle" };

/** The input of set_*_active for this step: confirm only once the trips were shown ("Archive anyway"). */
export function archiveConfirm(s: ArchiveState): { confirm?: true } {
  return s.step === "trips" ? { confirm: true } : {};
}

/** The person's archive words: the confirm keeps "switch off" for the sign-in (§40.1). */
export function personArchiveText(name: string, s: ArchiveState): { title: string; text: string; button: string } {
  if (s.step === "trips") {
    return {
      title: `Archive ${name} anyway?`,
      text: `${name} has ${s.trips.length} trip${s.trips.length === 1 ? "" : "s"} from today on. Reassign ${s.trips.length === 1 ? "it" : "them"} first, or archive anyway: the trips stay as they are.`,
      button: "Archive anyway",
    };
  }
  if (s.step === "armed") {
    return {
      title: `Archive ${name}?`,
      text: "They can no longer sign in (their sign-in is switched off). Their trips, fills and readings stay.",
      button: "Yes, archive",
    };
  }
  return { title: "Archive", text: "They can no longer sign in. Their trips, fills and readings stay, and Restore brings them back.", button: "Archive" };
}

/** A vehicle's archive words. */
export function vehicleArchiveText(plate: string, s: ArchiveState): { title: string; text: string; button: string } {
  if (s.step === "trips") {
    return {
      title: `Archive ${plate} anyway?`,
      text: `${plate} is booked for ${s.trips.length} trip${s.trips.length === 1 ? "" : "s"} from today on. Reassign ${s.trips.length === 1 ? "it" : "them"} first, or archive anyway: the trips stay as they are.`,
      button: "Archive anyway",
    };
  }
  if (s.step === "armed") {
    return { title: `Archive ${plate}?`, text: "It is returned: it leaves the lists and pickers. Its trips, fills, readings and reports stay.", button: "Yes, archive" };
  }
  return { title: "Archive", text: "Returned: it leaves the lists and pickers. Its history stays, and Restore brings it back.", button: "Archive" };
}
