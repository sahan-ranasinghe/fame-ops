// Round 4–7, feature 7 (22 October 2026): the Asks page's rules, pure (/tasks/asks): asks for a busy driver or vehicle
// (holder_asks), To me · By me · All (All with approve), each row's title, grey meta line and answer chip (Gmail's rows:
// one title, one meta line, a small chip), who may answer, one trip's asks (?task=), and the empty line in words.
import type { HolderAsks } from "../data/types";
import { joinDots, type Tone } from "../lib/format";

export type AskWhich = HolderAsks["which"];
export type HolderAsk = HolderAsks["asks"][number];

/** The tabs this person gets: All only with approve (the tool refuses it otherwise). */
export function askTabs(approve: boolean): [AskWhich, string][] {
  return [["to_me", "To me"], ["by_me", "By me"], ...(approve ? [["all", "All"] as [AskWhich, string]] : [])];
}

export const ASK_WHICH: readonly AskWhich[] = ["to_me", "by_me", "all"];

/** "WP CAB-4521 · Team drop Kurunegala" (a driver's name for a driver). */
export const askTitle = (a: Pick<HolderAsk, "what" | "resource" | "trip">): string =>
  joinDots([a.what || (a.resource === "driver" ? "A driver" : "A vehicle"), a.trip]);

/**
 * The grey line: when it is wanted, then who: "asked by Nimal" (to me), "asked Anoja" (by me), "Nimal asked Anoja" (all);
 * who answered when it was not the holder (a fleet admin for them); the note in quotes.
 */
export function askMeta(a: Pick<HolderAsk, "wanted" | "asked_by" | "holder" | "note" | "answer" | "answered_by">, which: AskWhich): string {
  const who = which === "to_me"
    ? a.asked_by ? `asked by ${a.asked_by}` : ""
    : which === "by_me"
    ? `asked ${a.holder ?? "the fleet admin"}`
    : a.asked_by ? `${a.asked_by} asked ${a.holder ?? "the fleet admin"}` : "";
  const answeredBy = a.answer && a.answered_by && a.answered_by !== a.holder ? `answered by ${a.answered_by}` : "";
  return joinDots([a.wanted, who, answeredBy, a.note ? `“${a.note}”` : ""]);
}

/** The answer as a chip: Yes (green), No (red), Waiting (amber). */
export function answerChip(a: Pick<HolderAsk, "answer">): { text: string; tone: Tone } {
  if (a.answer === "yes") return { text: "Yes", tone: "ok" };
  if (a.answer === "no") return { text: "No", tone: "bad" };
  return { text: "Waiting", tone: "warn" };
}

/** Yes / No on a row: an ask to the person, not answered yet. */
export const canAnswer = (a: Pick<HolderAsk, "answer">, which: AskWhich): boolean => which === "to_me" && !a.answer;

/** One trip's asks (?task=<id>), else all. */
export const asksFor = (asks: readonly HolderAsk[], taskId?: string | null): HolderAsk[] =>
  taskId ? asks.filter((a) => a.task_id === taskId) : [...asks];

/** The rows with an answer given on this page before the server's next answer says so. */
export const withAnswers = (asks: readonly HolderAsk[], given: ReadonlyMap<string, "yes" | "no">): HolderAsk[] =>
  asks.map((a) => (given.has(a.id) ? { ...a, answer: given.get(a.id) } : a));

/** Nothing to list, in words. */
export function asksEmpty(which: AskWhich, oneTrip: boolean): string {
  if (oneTrip) return "No asks about this trip in the last 14 days.";
  if (which === "to_me") return "No asks to you in the last 14 days.";
  if (which === "by_me") return "You have not asked for anything in the last 14 days.";
  return "No asks in the last 14 days.";
}

/** How many asks are about one task, across the answers asked for (an ask in two lists counts once). */
export function taskAskCount(lists: readonly (HolderAsks | undefined)[], taskId: string): number {
  const ids = new Set<string>();
  for (const l of lists) for (const a of l?.asks ?? []) if (a.task_id === taskId) ids.add(a.id);
  return ids.size;
}
