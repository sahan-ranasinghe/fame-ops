// The fleet settings' checks (docs/dispatch-plan.md, section 6), pure.
import { assertEquals, assertThrows } from "@std/assert";
import { ToolError } from "./db.ts";
import {
  SETTING_KEYS,
  SETTINGS_DEFAULTS,
  validateSetting,
} from "./settings.ts";

Deno.test("self-drive bookings are on by default and take only true or false", () => {
  assertEquals(SETTINGS_DEFAULTS.self_drive_allowed, true);
  assertEquals(SETTING_KEYS.includes("self_drive_allowed"), true);
  assertEquals(validateSetting("self_drive_allowed", false), false);
  assertEquals(validateSetting("self_drive_allowed", true), true);
  assertThrows(
    () => validateSetting("self_drive_allowed", "no"),
    Error,
    "true or false",
  );
  assertThrows(
    () => validateSetting("self_drive_allowed", 1),
    Error,
    "true or false",
  );
});

Deno.test("the numbers keep their ranges", () => {
  assertEquals(validateSetting("buffer_min", 20), 20);
  assertThrows(() => validateSetting("buffer_min", 2.5), Error, "whole number");
  assertThrows(() => validateSetting("road_factor", 4), Error, "from 1 to 3");
});

Deno.test("map_matching takes a provider of none, google_roads or osrm and nothing else", () => {
  assertEquals(validateSetting("map_matching", { provider: "osrm" }), {
    provider: "osrm",
  });
  assertEquals(validateSetting("map_matching", { provider: "none" }), {
    provider: "none",
  });
  assertThrows(
    () => validateSetting("map_matching", { provider: "here" }),
    ToolError,
  );
  assertThrows(() => validateSetting("map_matching", "osrm"), ToolError);
  assertEquals(SETTINGS_DEFAULTS.map_matching.provider, "none");
});

Deno.test("the fuel video checklist: 1 to 8 steps in order with a key and texts; Sinhala falls back to the English; a short word for the timeline", () => {
  assertEquals(SETTINGS_DEFAULTS.fuel_video_checklist.map((i) => i.key), [
    "plate",
    "zero",
    "pumping",
    "final",
  ]);
  assertEquals(SETTINGS_DEFAULTS.fuel_video_checklist.map((i) => i.short), [
    "Plate",
    "Zero",
    "Pumping",
    "Final",
  ]);
  assertEquals(
    validateSetting("fuel_video_checklist", [{
      key: "Pump Display",
      en: " Pump ",
      si: "",
    }]),
    [{ key: "pump_display", en: "Pump", si: "Pump" }],
  );
  assertEquals(
    validateSetting("fuel_video_checklist", [{
      key: "zero",
      en: "Pump display at zero",
      si: "",
      short: " Zero ",
    }]),
    [{
      key: "zero",
      en: "Pump display at zero",
      si: "Pump display at zero",
      short: "Zero",
    }],
  );
  assertThrows(
    () => validateSetting("fuel_video_checklist", []),
    ToolError,
    "1 to 8",
  );
  assertThrows(
    () =>
      validateSetting("fuel_video_checklist", [{ key: "a", en: "A" }, {
        key: "a",
        en: "B",
      }]),
    ToolError,
    "twice",
  );
  assertThrows(
    () => validateSetting("fuel_video_checklist", [{ en: "no key" }]),
    ToolError,
    "needs a key",
  );
});

Deno.test("the map search's daily cap and throttle: 2,500 a day and 90 a minute by default (the dashboard's shared Geocoding quota)", () => {
  assertEquals(SETTINGS_DEFAULTS.ors_autocomplete_daily_cap, 2500);
  assertEquals(SETTINGS_DEFAULTS.ors_autocomplete_per_minute, 90);
  assertEquals(validateSetting("ors_autocomplete_per_minute", 60), 60);
  assertThrows(
    () => validateSetting("ors_autocomplete_per_minute", 150),
    ToolError,
    "1 to 100",
  );
  assertEquals(SETTINGS_DEFAULTS.shift_days, [1, 2, 3, 4, 5]);
  assertEquals(validateSetting("ors_autocomplete_daily_cap", 500), 500);
  assertThrows(
    () => validateSetting("ors_autocomplete_daily_cap", 1.5),
    ToolError,
    "whole number",
  );
  assertThrows(
    () => validateSetting("ors_autocomplete_daily_cap", -1),
    ToolError,
  );
});

Deno.test("the fuel video quality and the keep months take only their two values", () => {
  assertEquals(SETTINGS_DEFAULTS.fuel_video_quality, "480p");
  assertEquals(SETTINGS_DEFAULTS.fuel_video_keep_months, 12);
  assertEquals(validateSetting("fuel_video_quality", "720p"), "720p");
  assertThrows(
    () => validateSetting("fuel_video_quality", "1080p"),
    ToolError,
    "480p or 720p",
  );
  assertEquals(validateSetting("fuel_video_keep_months", 6), 6);
  assertThrows(
    () => validateSetting("fuel_video_keep_months", 9),
    ToolError,
    "6 or 12",
  );
});
