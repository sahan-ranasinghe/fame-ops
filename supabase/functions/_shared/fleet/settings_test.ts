// The fleet settings' checks (docs/dispatch-plan.md, section 6), pure.
import { assertEquals, assertThrows } from "@std/assert";
import { SETTING_KEYS, SETTINGS_DEFAULTS, validateSetting } from "./settings.ts";

Deno.test("self-drive bookings are on by default and take only true or false", () => {
  assertEquals(SETTINGS_DEFAULTS.self_drive_allowed, true);
  assertEquals(SETTING_KEYS.includes("self_drive_allowed"), true);
  assertEquals(validateSetting("self_drive_allowed", false), false);
  assertEquals(validateSetting("self_drive_allowed", true), true);
  assertThrows(() => validateSetting("self_drive_allowed", "no"), Error, "true or false");
  assertThrows(() => validateSetting("self_drive_allowed", 1), Error, "true or false");
});

Deno.test("the numbers keep their ranges", () => {
  assertEquals(validateSetting("buffer_min", 20), 20);
  assertThrows(() => validateSetting("buffer_min", 2.5), Error, "whole number");
  assertThrows(() => validateSetting("road_factor", 4), Error, "from 1 to 3");
});
