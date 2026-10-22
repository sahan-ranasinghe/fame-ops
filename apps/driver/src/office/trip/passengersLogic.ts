// Office mode: a copy of apps/office/src/screens/passengersLogic.ts, written by scripts/shared-logic.mjs --write. Never edit it here: edit
// the site's file and run the script (the app's test:shared-logic and the site's sharedLogic test fail until you do).

// Round 4–7, feature 6 (phase8-plan.md §33.3): the Passengers field's rules (Google Calendar's guests, Uber's ride for
// someone else). The picked people (a registered office person by their find_people id, with the photo and label for the
// chip) and the people without an account (a name and an optional Sri Lankan phone), as passenger_list takes them on
// create_request, book_vehicle, create_task, update_request and update_task; the riders back from an answer's
// passengers_list (the edit forms); "Asha, Kamal +3". The passenger count stays beside the names (the server keeps it never
// under them). Office mode keeps a copy (scripts/shared-logic.mjs). Pure.
import type { Passenger, PassengerIn, SettingsResult } from "../types";
import { phoneE164 } from "./phones";

/** The fleet switch `passengers` (Settings → Fleet → Dispatch; absent = on): off hides the field, the names on trips still show. */
export const passengersOn = (s: Pick<SettingsResult, "settings"> | undefined | null): boolean => s?.settings.passengers !== false;

/** The server's limit (passengers.ts MAX_PASSENGERS). */
export const MAX_PASSENGERS = 20;

/** One person in the field: `person` = a registered office person's id; else someone without an account. */
export interface Rider {
  person?: string;
  name: string;
  /** Their role as find_people labels it ("Office", "Fleet admin"). */
  label?: string;
  photo_url?: string;
  /** Someone without an account: their phone as typed or +94… (optional). */
  phone?: string;
}

/** The same rider: the same person, or the same name and the same number. */
export function riderKey(r: Rider): string {
  if (r.person) return `p:${r.person}`;
  const phone = phoneE164(r.phone);
  return `n:${r.name.trim().replace(/\s+/g, " ").toLowerCase()}|${phone === "bad" ? (r.phone ?? "").trim() : phone ?? ""}`;
}

/** A rider added at the end; never twice, never over the limit (the list as it was). */
export function addRider(list: readonly Rider[], r: Rider): Rider[] {
  if (list.length >= MAX_PASSENGERS || list.some((x) => riderKey(x) === riderKey(r))) return [...list];
  return [...list, r];
}

/** A rider taken off (its ✕). */
export const removeRider = (list: readonly Rider[], key: string): Rider[] => list.filter((x) => riderKey(x) !== key);

/** "Add someone without an account": the name is needed, the phone optional and Sri Lankan (kept as +94…). */
export function typedRider(name: string, phone: string): { error: "name" | "phone" } | { rider: Rider } {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { error: "name" };
  const p = phoneE164(phone);
  if (p === "bad") return { error: "phone" };
  return { rider: { name: n.slice(0, 120), ...(p ? { phone: p } : {}) } };
}

/** passenger_list as the trip tools take it. */
export function passengerList(list: readonly Rider[]): PassengerIn[] {
  return list.map((r) => (r.person ? { person: r.person } : { name: r.name, ...(r.phone ? { phone: phoneE164(r.phone) || r.phone } : {}) }));
}

/** The riders on an answer (a request card's or a task's passengers_list), for an edit form. */
export function ridersFrom(list: readonly Passenger[] | undefined): Rider[] {
  return (list ?? []).map((p) =>
    p.registered && p.employee_id
      ? { person: p.employee_id, name: p.name, ...(p.photo_url ? { photo_url: p.photo_url } : {}) }
      : { name: p.name, ...(p.phone ? { phone: p.phone } : {}) }
  );
}

/** The same people, whatever the order. */
export function sameRiders(a: readonly Rider[] | undefined, b: readonly Rider[] | undefined): boolean {
  const x = (a ?? []).map(riderKey).sort(), y = (b ?? []).map(riderKey).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

/** What a create sends beside the trip: passenger_list when anyone is named. */
export function ridersInput(list: readonly Rider[] | undefined): { passenger_list?: PassengerIn[] } {
  return list?.length ? { passenger_list: passengerList(list) } : {};
}

/**
 * What an edit sends about the names (update_request, update_task): passenger_list when they changed (an empty list takes
 * everyone off). With other changes in the same call the count as it was goes too, so the server (which keeps the count
 * never under the names) does not take the names' number for it. Names alone: only the ids and the list (the server's
 * names-only path). `now` undefined = the field is not on the form: nothing about the names.
 */
export function ridersEdit(
  input: Record<string, unknown>,
  now: readonly Rider[] | undefined,
  was: readonly Rider[] | undefined,
  count: { key: "pax" | "passengers"; was: number | null | undefined },
  ids: readonly string[],
): Record<string, unknown> {
  if (now === undefined || sameRiders(now, was)) return input;
  const out: Record<string, unknown> = { ...input, passenger_list: passengerList(now) };
  const others = Object.keys(input).some((k) => !ids.includes(k));
  if (others && !(count.key in input) && count.was != null) out[count.key] = count.was;
  return out;
}

/** The count a trip shows: never under the names (the server's countWith). */
export const countWithNames = (count: number | null | undefined, names: number): number | null =>
  names > 0 ? Math.max(count ?? 0, names) : count ?? null;

/** "Asha, Kamal +3": the first two names, then how many more ride (the count when it is bigger than the names). */
export function ridersLine(names: readonly string[], count?: number | null): string {
  if (!names.length) return "";
  const shown = names.slice(0, 2);
  const more = Math.max(count ?? 0, names.length) - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` +${more}` : ""}`;
}

/** A passenger's row: registered (the photo, told in the app) or typed with Call / WhatsApp and Share trip when there is a number. */
export function passengerRow(p: Passenger): { registered: boolean; call?: string; whatsapp?: string; share?: string; phone?: string } {
  if (p.registered) return { registered: true };
  return { registered: false, call: p.call, whatsapp: p.whatsapp, share: p.share, phone: p.phone_display ?? p.phone };
}
