// Remove a place (Phase 7, §15), the pure part: the place page's second step
// (the first click only reads place_detail's in_use, so the reasons and the
// tasks show above the second button; the second calls remove_place, with
// confirm when they were shown; a needs_confirm answer, for reasons that came
// up since, shows them above "Remove anyway"), its words, the notice after it,
// which buttons a person sees, and the Removed places view on Places
// (list_places with removed, Restore on each row).
import type { Place, PlaceDetail } from "../data/types";
import type { WhenOptions } from "../lib/when";
import { byWhenText } from "./mediaLogic";

/** One task today or later that starts or stops at the place (remove_place's answer). */
export interface RemovePlaceTask {
  task_id: string;
  title: string;
  /** "Sat 18 Oct 09:00" */
  when: string;
}

/** remove_place's answer: needs_confirm with the reasons and the tasks, or the place removed. */
export interface RemovePlaceAnswer {
  needs_confirm?: boolean;
  place?: string;
  reasons?: string[];
  tasks?: RemovePlaceTask[];
  /** The removed place's name. */
  removed?: string;
  base_place_cleared?: boolean;
  note?: string;
}

/** list_places({ removed: true }) and place_detail carry `removed`: "2026-10-17 10:05 by Sahan" (data/types.ts). */
export type RemovedPlace = Place;
export type PlaceDetailWithRemoved = PlaceDetail;

/** place_detail's in_use: why removing would ask first (absent when nothing would). */
export interface PlaceInUse {
  reasons?: string[];
  tasks?: RemovePlaceTask[];
}

export type RemoveState =
  | { step: "idle" }
  | { step: "armed"; reasons: string[]; tasks: RemovePlaceTask[] }
  | { step: "needs_confirm"; reasons: string[]; tasks: RemovePlaceTask[] }
  | { step: "removed"; name: string; baseCleared: boolean };

export type RemoveEvent = { type: "start"; inUse?: PlaceInUse } | { type: "cancel" } | { type: "answer"; answer: RemovePlaceAnswer };

export const REMOVE_IDLE: RemoveState = { step: "idle" };

/** The second step: Remove arms it with the reasons read (nothing written), Keep it goes back, an answer asks again or ends it. */
export function removeStep(s: RemoveState, e: RemoveEvent): RemoveState {
  if (e.type === "start") return s.step === "idle" ? { step: "armed", reasons: e.inUse?.reasons ?? [], tasks: e.inUse?.tasks ?? [] } : s;
  if (e.type === "cancel") return s.step === "armed" || s.step === "needs_confirm" ? REMOVE_IDLE : s;
  const a = e.answer;
  if (a.needs_confirm) return { step: "needs_confirm", reasons: a.reasons ?? [], tasks: a.tasks ?? [] };
  return { step: "removed", name: a.removed ?? "", baseCleared: a.base_place_cleared === true };
}

/** remove_place's input for the button pressed: confirm only for reasons the person was shown. */
export function removeInput(id: string, s: RemoveState): { id: string; confirm?: true } {
  return s.step === "needs_confirm" || (s.step === "armed" && s.reasons.length > 0) ? { id, confirm: true } : { id };
}

/** The tasks listed above the second button (the armed step's or the server's). */
export const removeTasks = (s: RemoveState): RemovePlaceTask[] => (s.step === "armed" || s.step === "needs_confirm" ? s.tasks : []);

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The server's reasons as one sentence: "Head office is the base place; 2 tasks today or later start or stop there." */
export function reasonsText(reasons: readonly string[]): string {
  const said = reasons.map((r) => r.trim().replace(/[.;]+$/, "")).filter(Boolean);
  return said.length ? `${cap(said.join("; "))}.` : "";
}

/** "Sat 18 Oct 09:00 · Team drop · Kurunegala site" */
export const taskLine = (t: RemovePlaceTask) => `${t.when} · ${t.title}`;

export interface RemoveWords {
  title: string;
  text: string;
  button: string;
  /** Keep it (back to the first step) shows from the second step on. */
  keep: boolean;
}

/** The Remove block's words in each step; null once removed (the notice takes over). */
export function removeWords(name: string, s: RemoveState): RemoveWords | null {
  switch (s.step) {
    case "idle":
      return { title: "Remove this place", text: "It leaves every search, list and picker. Past tasks keep its name. Nothing is deleted: it can be restored.", button: "Remove", keep: false };
    case "armed":
      return {
        title: `Remove ${name}?`,
        text: [reasonsText(s.reasons), s.tasks.length ? "Those tasks keep their stops as they are." : "", "It moves to Removed places and can be restored from there."]
          .filter(Boolean).join(" "),
        button: "Yes, remove",
        keep: true,
      };
    case "needs_confirm":
      return {
        title: `Remove ${name} anyway?`,
        text: [reasonsText(s.reasons), s.tasks.length ? "Those tasks keep their stops as they are." : ""].filter(Boolean).join(" "),
        button: "Remove anyway",
        keep: true,
      };
    case "removed":
      return null;
  }
}

export interface RemovedNotice {
  text: string;
  /** The base place was cleared: say so, with a link to Settings → Fleet when the person can set it. */
  base?: { text: string; link: boolean };
}

/** The notice after removing: where the place went, and the base place when it was the base. */
export function removedNotice(baseCleared: boolean, tools: readonly string[]): RemovedNotice {
  const text = "Removed. It is listed under Removed places.";
  if (!baseCleared) return { text };
  return tools.includes("update_settings")
    ? { text, base: { text: "The base place is no longer set: pick another in Settings → Fleet.", link: true } }
    : { text, base: { text: "The base place is no longer set: someone with Settings → Fleet picks another.", link: false } };
}

/** "Removed by Sahan Sat 17 Oct 10:05" (dates in words, lib/when.ts: the year only when it is not this year's). */
export const removedLine = (removed: string | undefined, opts: WhenOptions = {}) => byWhenText("Removed", removed, opts);

/** Which buttons the place page shows: a removed place is read-only with Restore; one switched off by an undone import has no Remove. */
export function placeActions(tools: readonly string[], removed: boolean, switchedOff = false): { edit: boolean; remove: boolean; restore: boolean } {
  return {
    edit: !removed && tools.includes("update_place"),
    remove: !removed && !switchedOff && tools.includes("remove_place"),
    restore: removed && tools.includes("restore_place"),
  };
}

export type Who = "ours" | "dialog" | "mobitel" | "removed";
const WHO: [Who, string][] = [["ours", "Our places"], ["dialog", "Dialog sites"], ["mobitel", "Mobitel sites"]];

/** Places' chips: Removed places only for people who can restore one. */
export const whoOptions = (tools: readonly string[]): [Who, string][] => (tools.includes("restore_place") ? [...WHO, ["removed", "Removed places"]] : WHO);

/** The chip from the URL's who; an unknown one, or removed without restore_place, is Our places. */
export function whoOf(param: string | null, tools: readonly string[]): Who {
  return whoOptions(tools).some(([k]) => k === param) ? (param as Who) : "ours";
}

/** list_places' input for the chips, the search box and Without a pin (Hotfix 3: no limit = the paged list adds its own). */
export function listArgs(who: Who, text: string, nopin: boolean, limit?: number): Record<string, unknown> {
  const args: Record<string, unknown> = who === "removed" ? { removed: true } : { operator: who === "ours" ? "other" : who };
  if (limit !== undefined) args.limit = limit;
  if (text.trim()) args.search = text.trim();
  if (nopin) args.pinned = false;
  return args;
}
