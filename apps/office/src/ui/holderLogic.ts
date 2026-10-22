// Round 4–7, feature 7 (22 October 2026): who holds a busy driver or vehicle (Google Calendar's room booking: who booked
// it, their photo and the time; Airbnb's host to contact), pure. The words of the holder line ("Anoja Perera · Staff",
// "Asked for it · 08:00–11:00"), of a busy row ("Anoja's · 08:00–11:00"), the Ask for it sheet's sentence, and
// ask_for_it's input (the wanted window only when it is a real day and real times). With the switch holder_contact off
// the server sends no holder: nothing here is ever built for it.
import type { Conflict, Holder, PhoneLinks } from "../data/types";
import { joinDots } from "../lib/format";
import { firstName } from "./driverRowLogic";

export type HolderResource = "driver" | "vehicle";

/** When the trip being planned wants it (YYYY-MM-DD, HH:MM); none = the busy trip's own time (the server's default). */
export interface Wanted {
  date?: string;
  from?: string;
  until?: string;
}

/** "08:00–11:00", or "from 08:00" when the busy trip has no end. */
export const windowText = (h: Pick<Holder, "from" | "to">): string => (h.to ? `${h.from}–${h.to}` : `from ${h.from}`);

/** The holder is the person looking (the server refuses "You hold it yourself"): no Call, WhatsApp or Ask then. */
export const isMe = (h: Pick<Holder, "name">, meName?: string | null): boolean =>
  !!meName && h.name.trim().toLowerCase() === meName.trim().toLowerCase();

/** "Anoja Perera · Staff", or "You". */
export const holderTitle = (h: Pick<Holder, "name" | "label">, meName?: string | null): string => (isMe(h, meName) ? "You" : joinDots([h.name, h.label]));

/** "Asked for it · 08:00–11:00" (the trip's requester) or "Assigned it · 08:00–11:00" (who assigned it). */
export const byLine = (h: Pick<Holder, "by" | "from" | "to">): string => `${h.by === "asked" ? "Asked for it" : "Assigned it"} · ${windowText(h)}`;

/** A busy row's strip: "Anoja's · 08:00–11:00" ("Yours · …" for the person's own trip). */
export const busyWords = (h: Pick<Holder, "name" | "from" | "to">, meName?: string | null): string =>
  `${isMe(h, meName) ? "Yours" : `${firstName(h.name)}'s`} · ${windowText(h)}`;

/** The holder's Call and WhatsApp as the site's contact links (none without a number). */
export function holderPhone(h: Pick<Holder, "phone" | "phone_display" | "call" | "whatsapp">): PhoneLinks | null {
  if (!h.call || !h.phone) return null;
  return { phone: h.phone, phone_display: h.phone_display ?? h.phone, call: h.call, whatsapp: h.whatsapp ?? "" };
}

/** May this person ask for it: the tool, someone else's trip, never a vehicle in the garage. */
export const canAskFor = (tools: readonly string[], h: Pick<Holder, "name">, meName?: string | null, kind?: Conflict["kind"]): boolean =>
  tools.includes("ask_for_it") && !isMe(h, meName) && kind !== "garage";

/** What a conflict card is about, from its sentence ("WP CAB-4521 is on task …" → "WP CAB-4521"); else undefined. */
export function conflictWhat(c: Pick<Conflict, "text">): string | undefined {
  const m = /^(.+?) is on task /.exec(c.text);
  return m ? m[1].trim() : undefined;
}

/** "the vehicle" / "the driver" when the screen does not know which. */
export const askWhat = (resource: HolderResource, what?: string | null): string => what?.trim() || (resource === "driver" ? "the driver" : "the vehicle");

/** The sheet's sentence: "Anoja has WP CAB-4521 08:00–11:00. They get Yes / No in one tap; …". */
export function askSentence(h: Pick<Holder, "name" | "from" | "to">, resource: HolderResource, what?: string | null): string {
  return `${firstName(h.name)} has ${askWhat(resource, what)} ${windowText(h)}. They get Yes / No in one tap; nothing changes until the fleet admin reassigns.`;
}

/** The wanted window from Who's available's arguments ({ at: "YYYY-MM-DD HH:MM", until?: "HH:MM" }); none when unknown. */
export function wantedOfArgs(args: Record<string, unknown> | null | undefined): Wanted | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(typeof args?.at === "string" ? args.at : "");
  if (!m) return null;
  const until = typeof args?.until === "string" ? args.until : undefined;
  return until ? { date: m[1], from: m[2], until } : { date: m[1], from: m[2] };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * ask_for_it's input: the busy trip, the driver or the vehicle, the note when there is one, and the wanted window only
 * when it is a real day with a real start (an end only after the start); otherwise the server takes the busy trip's time.
 */
export function askArgs(taskId: string, resource: HolderResource, note?: string, wanted?: Wanted | null): Record<string, unknown> {
  const out: Record<string, unknown> = { task_id: taskId, resource };
  const n = note?.trim();
  if (n) out.note = n.slice(0, 300);
  const date = wanted?.date?.trim();
  const from = wanted?.from?.trim();
  const until = wanted?.until?.trim();
  if (date && DAY.test(date) && from && TIME.test(from)) {
    out.date = date;
    out.from = from;
    if (until && TIME.test(until) && until > from) out.until = until;
  }
  return out;
}

/** The asks sent from this page in this tab ("<task>:<resource>"): the button says Asked instead of asking twice. */
const asked = new Set<string>();
export const askKey = (taskId: string, resource: HolderResource) => `${taskId}:${resource}`;
export const wasAsked = (taskId: string, resource: HolderResource): boolean => asked.has(askKey(taskId, resource));
export const markAsked = (taskId: string, resource: HolderResource): void => void asked.add(askKey(taskId, resource));
/** Tests only. */
export const forgetAsked = (): void => asked.clear();
