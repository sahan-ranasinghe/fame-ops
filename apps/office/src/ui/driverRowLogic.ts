// Part 3b (H2): one driver row everywhere a driver is listed for dispatch (Who's available, Live, the Drivers board), the
// pure part: the status chip's tone, the facts line ("Last seen 17:42 near Kadawatha · usually starts 07:40"), the next
// task, and the Call / WhatsApp links of an answer that carries only some of them. Pure.
import type { DriverVehicleRef, DrivenBy, NowStatus, PersonLinks, PhoneLinks } from "../data/types";
import type { Tone } from "../lib/format";
import { phoneDisplay } from "./ContactButtons";

/** What a row shows about a driver (every list that names drivers for dispatch has these fields, some optional). */
export interface DriverRowInfo {
  name: string;
  username?: string | null;
  photo_url?: string;
  /** The status now (H2): on a task until, not available, on duty, off duty. */
  now_status?: NowStatus;
  /** The window's "Not available · half day, back 13:00" (Who's available) when an entry overlaps it. */
  not_available?: string;
  /** "Last seen 17:42 near Kadawatha" */
  last_seen?: string;
  next_task?: { title: string; when: string };
  /** "07:40" */
  usual_start?: string;
}

/**
 * Round 3 (Uber Fleet's and Samsara's driver lists: the person first, the vehicle under them): the vehicle chip's words.
 * The plate ("regular" beside it when it is their regular one, not held today), else the answer's own words for a task
 * with no plate yet ("Vehicle: on the day", "Any van"), else "Vehicle: on the day" while the fleet setting
 * vehicle_on_the_day is on, else "No vehicle yet".
 */
export interface VehicleChipWords {
  plate?: string;
  /** Beside the plate: "regular", "since 08:40". */
  note?: string;
  /** No plate: the words alone. */
  text?: string;
}

export const NO_VEHICLE_YET = "No vehicle yet";
export const VEHICLE_ON_THE_DAY = "Vehicle: on the day";

export function vehicleChipWords(
  v: DriverVehicleRef | string | null | undefined,
  o: { onTheDay?: boolean; text?: string | null; note?: string } = {},
): VehicleChipWords {
  const plate = typeof v === "string" ? v : v?.reg_no;
  if (plate) {
    const note = o.note ?? (typeof v === "object" && v?.source === "regular" ? "regular" : undefined);
    return note ? { plate, note } : { plate };
  }
  if (o.text) return { text: o.text };
  return { text: o.onTheDay ? VEHICLE_ON_THE_DAY : NO_VEHICLE_YET };
}

/** Round 3: the small word that takes the duty state's place on a trip with no app ("Drives themselves", "Someone else"). */
export function drivenByWord(by: DrivenBy | string | null | undefined): string | null {
  if (by === "self") return "Drives themselves";
  if (by === "other") return "Someone else";
  return null;
}

/** The status chip: on a task blue, on duty green, off duty grey, not available amber. */
export function nowTone(kind: NowStatus["kind"] | undefined): Tone {
  switch (kind) {
    case "on_task":
      return "live";
    case "on_duty":
      return "ok";
    case "not_available":
      return "warn";
    default:
      return "muted";
  }
}

/** "Last seen 17:42 near Kadawatha · usually starts 07:40", or "" when the answer has neither. */
export function factsLine(d: Pick<DriverRowInfo, "last_seen" | "usual_start">): string {
  return [d.last_seen, d.usual_start ? `usually starts ${d.usual_start}` : null].filter(Boolean).join(" · ");
}

/** "Next: Team drop · 14:30", or "" when there is no next task. */
export function nextLine(d: Pick<DriverRowInfo, "next_task">): string {
  return d.next_task ? `Next: ${d.next_task.title} · ${d.next_task.when}` : "";
}

/**
 * The links ContactButtons takes from a person's links (drivers_board, driver_profile: each part optional). Null without a
 * call link (nothing to show then); WhatsApp is "" when there is none.
 */
export function toPhoneLinks(l: PersonLinks | PhoneLinks | null | undefined): PhoneLinks | null {
  if (!l?.call) return null;
  const phone = l.phone || l.call.replace(/^tel:/i, "");
  return { phone, phone_display: l.phone_display || phoneDisplay(phone), call: l.call, whatsapp: l.whatsapp ?? "" };
}

/**
 * Live's extra lines for a driver (Part 3b, H2 and H4; the answer carries them only for approve and assign_tasks): in amber
 * the late report and "not available" now, in grey the next task and the usual start. Empty strings when there are none.
 */
export function livePresence(x: {
  late_report?: { text: string };
  not_available?: string;
  next_task?: { title: string; when: string };
  usual_start?: string;
}): { warn: string; facts: string } {
  return {
    warn: [x.late_report?.text, x.not_available].filter(Boolean).join(" · "),
    facts: [nextLine(x), x.usual_start ? `usually starts ${x.usual_start}` : null].filter(Boolean).join(" · "),
  };
}

/** The first name, for "Call Kamal". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
