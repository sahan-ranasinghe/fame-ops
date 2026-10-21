import { assertEquals } from "jsr:@std/assert";
import { licenceState, noLicenceWarning } from "./licence.ts";

const none = { licence_no: null, licence_expiry: null, licence_front_photo_id: null, licence_back_photo_id: null };

Deno.test("a self-driver's licence: on file (a number or a photo), none, or expired on the trip's day", () => {
  assertEquals(licenceState(undefined, "2026-10-22"), "none");
  assertEquals(licenceState(none, "2026-10-22"), "none");
  assertEquals(licenceState({ ...none, licence_no: "B1234567" }, "2026-10-22"), "on_file");
  assertEquals(licenceState({ ...none, licence_front_photo_id: "p1" }, "2026-10-22"), "on_file");
  assertEquals(licenceState({ ...none, licence_no: "B1234567", licence_expiry: "2026-10-22" }, "2026-10-22"), "on_file");
  assertEquals(licenceState({ ...none, licence_no: "B1234567", licence_expiry: "2026-10-21" }, "2026-10-22"), "expired");
});

Deno.test("the warning is only for no licence on file (an expired one is the assign check's own warning)", () => {
  assertEquals(noLicenceWarning("Asha", none, "2026-10-22"), "Asha has no driving licence on file (self-drive).");
  assertEquals(noLicenceWarning("Asha", { ...none, licence_no: "B1" }, "2026-10-22"), null);
  assertEquals(noLicenceWarning("Asha", { ...none, licence_no: "B1", licence_expiry: "2026-01-01" }, "2026-10-22"), null);
});
