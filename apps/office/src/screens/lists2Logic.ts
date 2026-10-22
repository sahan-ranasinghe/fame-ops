// Round 4–7, item 8 (the lists cleaned up, second part; docs/phase8-plan.md §33.7 rule 7, docs/phase8-parity.md "the list
// audit"): the rules that let a list row say each fact once. A word the filter, the column or the group already says is
// left out of the row; a fact the row alone carries (a time, a size, who decided) always stays. Pure (lists2.test.tsx).
import type { BoardFilter, NowStatus, TripLive, VideoCard } from "../data/types";
import { dayWords } from "../lib/when";
import { clockOf, megabytes } from "./fuelLogic";
import type { RequestsFilter } from "./requestsListLogic";
import { docTone } from "./vehicleLogic";

// ---- Fuel ----------------------------------------------------------------------------------------------------------

/**
 * The Video cell of an uploaded video, without the word "Video" (the column says it; the pill said it again): "0:47 ·
 * 16 MB", "5:12 · 38 MB · interrupted, 2 pieces"; "Uploaded" when the answer has neither the length nor the size. A fill
 * without its video keeps its pill (On the phone, Uploading, Upload failed, No video, Pruned).
 */
export function videoCellWords(v: Pick<VideoCard, "duration_s" | "bytes" | "interrupted" | "segments">): string {
  const parts = [
    v.duration_s != null ? clockOf(v.duration_s) : null,
    v.bytes ? megabytes(v.bytes) : null,
    v.interrupted ? `interrupted, ${v.segments?.length ?? 2} pieces` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Uploaded";
}

// ---- Vehicles ------------------------------------------------------------------------------------------------------

/** A vehicle's three roadside documents on the board (list_vehicles' `documents`: Lic, Ins, Emi). */
type BoardDocs = Partial<Record<"lic" | "ins" | "emi", { chip?: string; expiry?: string }>>;
const DOC_NAMES: ["lic" | "ins" | "emi", string][] = [["lic", "licence"], ["ins", "insurance"], ["emi", "emission test"]];

/**
 * Round 4–7 (the list audit's proposed removal, approved by Sahan 22 October 2026): the three documents valid and none
 * missing = ONE quiet line "Documents valid" instead of three chips. Any expiring, expired or not set document, or a
 * missing one ("no document"), keeps the chips as before.
 */
export function docsAllValid(v: { documents?: BoardDocs; documents_missing?: readonly string[] }): boolean {
  const d = v.documents ?? {};
  return DOC_NAMES.every(([k]) => docTone(d[k]?.chip) === "ok") && !v.documents_missing?.length;
}

/** What follows "Documents valid" for the screen reader (and on hover): "licence to Fri 12 Mar 2027, insurance to …". */
export function validDocsWords(docs: BoardDocs | undefined, now?: Date): string {
  return DOC_NAMES.map(([k, name]) => {
    const expiry = docs?.[k]?.expiry;
    return expiry ? `${name} to ${dayWords(expiry, { inline: true, now })}` : name;
  }).join(", ");
}

/**
 * The board's one status (Samsara's and Fleetio's vehicle lists: one status line). The availability line says it ("Free",
 * "On a task · back ~14:30 (live)", "Booked later today · 15:00"); the pill only for In garage (and then no line saying
 * "In garage" again). An older answer without the line keeps the status pill.
 */
export function vehicleStatusShown(v: { status?: string | null; availability?: string | null }): { pill: string | null; line: string | null } {
  const status = String(v.status || "");
  const line = String(v.availability || "");
  if (/garage/i.test(status)) return { pill: status, line: line && !/garage/i.test(line) ? line : null };
  if (line) return { pill: null, line };
  return { pill: status || "—", line: null };
}

// ---- My trips ------------------------------------------------------------------------------------------------------

/** The first words of the server's live text that say the pill's own word again (tools/requests.ts liveOf / taskLive). */
const LIVE_SAME: Record<string, readonly string[]> = {
  waiting: ["waiting"],
  approved: ["approved"],
  accepted: ["driver accepted", "accepted"],
  on_the_way: ["on the way", "under way"],
  arrived: ["arrived"],
  completed: ["completed", "done"],
  declined: ["declined"],
  cancelled: ["cancelled"],
  missed: ["missed"],
  expired: ["expired"],
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * What the live text adds to the pill: "Waiting" under the Waiting pill adds nothing (""), "Completed · 14:20" under Done
 * adds "14:20", "Waiting · its leave time has passed" adds "Its leave time has passed"; a text that starts otherwise
 * ("Changed · waiting for the office", "Sent to the driver") is kept whole.
 */
export function liveRest(live: Pick<TripLive, "state" | "text">): string {
  const parts = String(live.text || "").split(" · ");
  const first = parts[0].trim().toLowerCase();
  if (!(LIVE_SAME[live.state] ?? []).includes(first)) return live.text || "";
  return cap(parts.slice(1).join(" · ").trim());
}

/** A decision line split for the row: the verb the pill already says goes to the screen reader only. */
export interface DecisionShown {
  /** "Approved": said to the screen reader (the pill shows it); absent when the line is shown whole. */
  verb?: string;
  /** " by Palitha · 10:42", or the whole line ("Approved by Palitha · 10:40" under the Accepted pill). */
  text: string;
}

/**
 * The trip's status said once (Uber's trip list: one status, then who and when): the pill's word, what the live text adds,
 * and who decided it. "Approved" was up to three times (the pill, "Approved", "Approved by Palitha · 10:42"); now the pill
 * and "by Palitha · 10:42" beside it. A decision with another verb than the pill's ("Approved by …" under On the way) is
 * a line of its own, as before. The live text's rest is left out when a decision line already carries it (a decline's
 * reason).
 */
export function tripStatusShown(word: string, live: Pick<TripLive, "state" | "text">, decisions: string[]): { rest: string; merged: DecisionShown[]; lines: string[] } {
  const merged: DecisionShown[] = [];
  const lines: string[] = [];
  for (const d of decisions) {
    if (word && d.startsWith(`${word} by `)) merged.push({ verb: word, text: d.slice(word.length) });
    else lines.push(d);
  }
  const rest = liveRest(live);
  const told = (s: string) => decisions.some((d) => d.toLowerCase().includes(s.toLowerCase()));
  return { rest: rest && !told(rest) ? rest : "", merged, lines };
}

/** "Task I created" on a created task's row only where the list mixes it with requests (All); Passenger always. */
export const createdTagShown = (show: "all" | "requests" | "tasks"): boolean => show !== "tasks";

// ---- Requests ------------------------------------------------------------------------------------------------------

/**
 * The row's status pill only when the filter does not say it already (Gmail's label view): every row under All; under
 * Waiting (which also holds the changed bookings) only a Changed one; none under a filter of one status.
 */
export function requestPillShown(filter: RequestsFilter, status: string | undefined): boolean {
  if (filter === "all") return true;
  if (filter === "waiting") return status !== "waiting";
  return status !== filter;
}

/**
 * The line under a request's status: the timeline's last step with when ("Seen by the office · 10:42", "sent 2 h ago").
 * A step that is the request's own status (Approved, Declined, Cancelled, Changed, Expired: the pill or the filter says
 * it) says only what it adds: "10:42 by Palitha", "Needs re-approval · 11:05".
 */
export function requestStepWords(step: { label: string; at?: string } | undefined, at: string, status: string | undefined, oneStep = false): string {
  if (oneStep) return "booked directly";
  if (!step || step.label === "Sent") return at ? `sent ${at}` : "";
  const word = String(status || "").toLowerCase();
  const label = step.label;
  if (word && label.toLowerCase().startsWith(word)) {
    const rest = label.slice(word.length).replace(/^[\s·]+/, "");
    return cap([rest, at].filter(Boolean).join(" · "));
  }
  return `${label}${at ? ` · ${at}` : ""}`;
}

// ---- Drivers board -------------------------------------------------------------------------------------------------

/** The words of a state that the Show filter of the same name already says (presence.ts: the board's status texts). */
const STATE_WORDS: Partial<Record<BoardFilter, RegExp>> = {
  on_task: /^On a task[\s·,]*/i,
  off_duty: /^Off duty[\s·,]*/i,
  not_available: /^Not available[\s·,]*/i,
};

/**
 * The status chip under a Show filter that says the state already: only what it adds ("Until ~10:40 (live)", "Since
 * 07:40", "Back 13:00", "End time not set"), no chip when it adds nothing ("Off duty" under Off duty). All and Free now
 * (whose word is not the chip's) keep the whole status.
 */
export function boardStatusShown<S extends Pick<NowStatus, "kind" | "text">>(s: S | undefined, filter: BoardFilter): S | undefined {
  const re = STATE_WORDS[filter];
  if (!s || !re || !re.test(s.text)) return s;
  const rest = s.text.replace(re, "").trim();
  return rest ? { ...s, text: cap(rest) } : undefined;
}

// ---- Tasks board ---------------------------------------------------------------------------------------------------

/** A finish flag's chip in the Completed column: "Completed · not confirmed" says "Not confirmed" (the column says Completed). */
export function boardFinishText(text: string, column: string): string {
  return column === "completed" ? cap(text.replace(/^Completed · /, "")) : text;
}

// ---- Places --------------------------------------------------------------------------------------------------------

/** The Kind column only where the rows' kinds differ: Dialog sites and Mobitel sites are all "Site · Dialog" / "Site · Mobitel". */
export const placeKindShown = (who: "ours" | "dialog" | "mobitel" | "removed"): boolean => who !== "dialog" && who !== "mobitel";
