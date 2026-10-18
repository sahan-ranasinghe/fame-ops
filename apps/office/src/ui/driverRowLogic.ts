// Part 3b (H2): one driver row everywhere a driver is listed for dispatch (Who's available, Live, the Drivers board), the
// pure part: the status chip's tone, the facts line ("Last seen 17:42 near Kadawatha · usually starts 07:40"), the next
// task, and the Call / WhatsApp links of an answer that carries only some of them. Pure.
import type { NowStatus, PersonLinks, PhoneLinks } from "../data/types";
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
