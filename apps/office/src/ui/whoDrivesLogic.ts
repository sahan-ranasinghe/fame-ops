// "Who drives?" (Round 3, docs/phase8-plan.md §30; the rental and car-sharing booking forms' "Who's driving?", e.g.
// Turo, Enterprise): one question, three choices, the details under the chosen one. A driver (a Fame Fleet driver with
// the app; the default), I'll drive myself (the person asking), Someone else (a name and a phone; not in Fame Fleet).
// The last two only while the fleet setting self_drive_allowed is on, and on a form that picks a vehicle they need a
// plate (no app to confirm one on the day). The pure part: the words, the check and the arguments every request and
// task tool takes (driven_by, driver_name, driver_phone), and what a request asked in words. Pure.
import type { AskedDriver, DrivenBy } from "../data/types";
import { firstName } from "./driverRowLogic";
import { PHONE_BAD, phoneE164 } from "../screens/settings/profileLogic";

export type { AskedDriver, DrivenBy };

/** The question's answer on a form. */
export interface WhoDrivesValue {
  by: DrivenBy;
  /** Someone else's name and phone (kept while another choice is picked, so a slip back keeps them). */
  name: string;
  phone: string;
}

export const emptyWho = (): WhoDrivesValue => ({ by: "driver", name: "", phone: "" });

/** The self choice's words for the person asking. */
export const SELF_WORDS = "I'll drive myself";

/**
 * The words of "I'll drive myself": the asker's first name when the form is someone else's request (an approver changing
 * it: the server takes the asker as the one who drives), else "I'll drive myself".
 */
export function selfLabel(asker?: string | null, me?: string | null): string {
  const a = asker?.trim();
  if (a && me?.trim() && a !== me.trim()) return `${firstName(a)} drives`;
  return SELF_WORDS;
}

/** The three choices in order, with their words. */
export function whoChoices(selfWords = SELF_WORDS): [DrivenBy, string][] {
  return [["driver", "A driver"], ["self", selfWords], ["other", "Someone else"]];
}

/** The line under the choices: what the chosen one means. Empty for a driver. */
export function whoHint(by: DrivenBy, o: { picksVehicle?: boolean; selfWords?: string } = {}): string {
  const mine = !o.selfWords || o.selfWords === SELF_WORDS;
  if (by === "self") {
    return `${mine ? "You drive it yourself" : "They drive it themselves"}: no app and nothing is sent.${o.picksVehicle ? " Pick the vehicle below." : " The office picks the vehicle."}`;
  }
  if (by === "other") return `Not in Fame Fleet: no app. The office calls them on this number.${o.picksVehicle ? " Pick the vehicle below." : ""}`;
  return "";
}

/** No driver with the app: the trip needs a specific vehicle (a plate). */
export const needsPlate = (by: DrivenBy | AskedDriver | undefined): boolean => !!by && by !== "driver";

/** Why a self or someone-else trip cannot be saved yet (under the disabled button): no plate picked. */
export function plateReason(v: Pick<WhoDrivesValue, "by" | "name">, selfWords = SELF_WORDS): string {
  const who = v.by === "other" ? `${v.name.trim() || "Someone else"} drives` : selfWords === SELF_WORDS ? "You drive" : selfWords;
  return `${who} it: pick the vehicle (nobody confirms one on the day).`;
}

/**
 * The arguments for create_request, update_request, book_vehicle and create_task, or what is missing. A driver sends
 * nothing (the default) unless `always` (update_request: going back to a driver must be said).
 */
export function whoInput(v: WhoDrivesValue, o: { always?: boolean } = {}): { error: string } | { input: { driven_by?: DrivenBy; driver_name?: string; driver_phone?: string } } {
  if (v.by === "driver") return { input: o.always ? { driven_by: "driver" } : {} };
  if (v.by === "self") return { input: { driven_by: "self" } };
  const name = v.name.trim();
  if (!name) return { error: "Someone else drives: type their name." };
  const phone = phoneE164(v.phone);
  if (phone === null) return { error: "Someone else drives: type their phone, e.g. 077 123 4567, so the office can call them." };
  if (phone === "bad") return { error: `Their phone: ${PHONE_BAD}` };
  return { input: { driven_by: "other", driver_name: name.slice(0, 120), driver_phone: v.phone.trim() } };
}

/** What a request asked, from its card (driven_by, else the older driver_required: false = the custodian). */
export function askedOf(q: { driven_by?: AskedDriver; driver_required?: boolean }): AskedDriver {
  return q.driven_by ?? (q.driver_required === false ? "custodian" : "driver");
}

/** The form's value from what a request asked (custodian reads as a driver: the form no longer offers it). */
export function whoFromRequest(q: { driven_by?: AskedDriver; driver_required?: boolean; driver_name?: string; driver_phone?: string }): WhoDrivesValue {
  const asked = askedOf(q);
  return { by: asked === "self" || asked === "other" ? asked : "driver", name: q.driver_name ?? "", phone: q.driver_phone ?? "" };
}

/**
 * What a request asked, in words (the decide pages, the request's page): "Drives themselves", "Someone else: Nimal ·
 * 077 123 4567", "The custodian drives", "A driver". `phoneShown`: the number as the page shows it.
 */
export function askedWords(q: { driven_by?: AskedDriver; driver_required?: boolean; driver_name?: string; driver_phone?: string }, phoneShown?: (p: string) => string): string {
  switch (askedOf(q)) {
    case "self":
      return "Drives themselves";
    case "other": {
      const phone = q.driver_phone ? (phoneShown ? phoneShown(q.driver_phone) : q.driver_phone) : "";
      return `Someone else: ${[q.driver_name || "no name given", phone].filter(Boolean).join(" · ")}`;
    }
    case "custodian":
      return "The custodian drives";
    default:
      return "A driver";
  }
}
