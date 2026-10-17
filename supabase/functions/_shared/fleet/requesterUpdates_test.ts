// "Tell requester" (Phase 7, §4): the moment and the message.
import { assertEquals } from "@std/assert";
import { momentOf, tellLink, tellMessage } from "./requesterUpdates.ts";

Deno.test("the moment follows the request and its task", () => {
  assertEquals(momentOf({ requestStatus: "waiting" }), null);
  assertEquals(momentOf({ requestStatus: "declined" }), null);
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "assigned" }), "approved");
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "assigned", reassigned: true }), "driver_changed");
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "in_progress" }), "on_the_way");
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "in_progress", arrived: true }), "arrived");
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "completed" }), null);
  assertEquals(momentOf({ requestStatus: "cancelled", taskStatus: "cancelled" }), "cancelled");
  assertEquals(momentOf({ requestStatus: "approved", taskStatus: "cancelled" }), "cancelled");
});

Deno.test("the message in English, Latin digits; the link to the number or to WhatsApp's contact picker", () => {
  const base = {
    when: "Sun 18 Oct 08:00",
    driver: "Kamal Perera",
    driverPhone: "077 123 4567",
    plate: "WP CAB-4521",
    model: "Toyota HiAce",
  };
  assertEquals(
    tellMessage({ ...base, moment: "approved" }),
    "Your vehicle for Sun 18 Oct 08:00 is booked: WP CAB-4521 (Toyota HiAce), driver Kamal Perera, 077 123 4567.",
  );
  assertEquals(tellMessage({ ...base, moment: "on_the_way", left: "08:12" }), "Kamal Perera is on the way with WP CAB-4521 (left 08:12).");
  assertEquals(
    tellMessage({ ...base, moment: "arrived", place: "Head office" }),
    "Kamal Perera has arrived at Head office with WP CAB-4521.",
  );
  assertEquals(
    tellMessage({ ...base, moment: "cancelled", reason: "Client postponed" }),
    "Your vehicle for Sun 18 Oct 08:00 is cancelled: Client postponed.",
  );
  assertEquals(tellLink("077 123 4567", "Hi there"), "https://wa.me/94771234567?text=Hi%20there");
  assertEquals(tellLink(null, "Hi"), "https://wa.me/?text=Hi");
});
