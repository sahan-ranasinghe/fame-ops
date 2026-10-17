// "Tell requester" (Phase 7, §4): for a person who asked without an office account, the request page offers a WhatsApp
// message for the trip's current moment, in English (§32 5). Nothing is sent by itself: the office taps it. Pure.

import { phoneDigits } from "./format.ts";

export type Moment = "approved" | "driver_changed" | "on_the_way" | "arrived" | "cancelled";

export interface TripState {
  requestStatus: string;
  taskStatus?: string | null;
  /** The first pickup reached (the Arrived tap or the arrival nudge). */
  arrived?: boolean;
  /** The driver was changed after the approval. */
  reassigned?: boolean;
}

/** The moment to tell, or none (still waiting, declined, or the trip is over). */
export function momentOf(s: TripState): Moment | null {
  if (s.requestStatus === "cancelled" || s.taskStatus === "cancelled") return "cancelled";
  if (s.requestStatus !== "approved" && s.requestStatus !== "changed") return null;
  if (s.taskStatus === "in_progress") return s.arrived ? "arrived" : "on_the_way";
  if (s.taskStatus === "assigned" || s.taskStatus === "declined") return s.reassigned ? "driver_changed" : "approved";
  return null;
}

export interface TellInput {
  moment: Moment;
  /** "Sun 18 Oct 08:00" */
  when: string;
  driver?: string;
  driverPhone?: string | null;
  plate?: string;
  model?: string | null;
  /** The first pickup's name. */
  place?: string;
  /** "08:12" */
  left?: string;
  reason?: string | null;
}

export function tellMessage(i: TellInput): string {
  const vehicle = i.plate ? `${i.plate}${i.model ? ` (${i.model})` : ""}` : "the vehicle";
  const driver = i.driver ? `${i.driver}${i.driverPhone ? `, ${i.driverPhone}` : ""}` : "the driver";
  switch (i.moment) {
    case "approved":
      return `Your vehicle for ${i.when} is booked: ${vehicle}, driver ${driver}.`;
    case "driver_changed":
      return `Your driver for ${i.when} is now ${driver}, with ${vehicle}.`;
    case "on_the_way":
      return `${i.driver ?? "The driver"} is on the way with ${i.plate ?? "the vehicle"}${i.left ? ` (left ${i.left})` : ""}.`;
    case "arrived":
      return `${i.driver ?? "The driver"} has arrived${i.place ? ` at ${i.place}` : ""} with ${i.plate ?? "the vehicle"}.`;
    case "cancelled":
      return `Your vehicle for ${i.when} is cancelled${i.reason ? `: ${i.reason}` : ""}.`;
  }
}

/** A WhatsApp link with the message: to the number when there is one, else WhatsApp lets the office pick the contact. */
export function tellLink(phone: string | null | undefined, message: string): string {
  const digits = phoneDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
}
