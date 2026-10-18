// Trips a driver starts and the date-range spans (Phase 7, §13 and §8), the pure parts.
import { assertEquals, assertThrows } from "@std/assert";
import { SETTING_KEYS, SETTINGS_DEFAULTS, validateSetting } from "./settings.ts";
import { daySpan } from "./tool.ts";
import { personalAllowed, tripTime, tripTitle } from "./trips.ts";

Deno.test("driver_personal_trips: allowed by default; the four values; off is the only no", () => {
  assertEquals(SETTINGS_DEFAULTS.driver_personal_trips, "allowed");
  assertEquals(SETTING_KEYS.includes("driver_personal_trips"), true);
  for (const v of ["allowed", "default", "off", "ask_first"]) assertEquals(validateSetting("driver_personal_trips", v), v);
  assertThrows(() => validateSetting("driver_personal_trips", "sometimes"), Error, "allowed, default, off, ask_first");
  assertEquals(personalAllowed({ driver_personal_trips: "allowed" }), true);
  assertEquals(personalAllowed({ driver_personal_trips: "default" }), true);
  assertEquals(personalAllowed({ driver_personal_trips: "ask_first" }), true, "reserved: behaves as allowed");
  assertEquals(personalAllowed({ driver_personal_trips: "off" }), false);
});

Deno.test("a trip's title says personal; at most 120 characters", () => {
  assertEquals(tripTitle("company", "Kadawatha"), "Trip · Kadawatha");
  assertEquals(tripTitle("personal", "Kadawatha"), "Personal trip · Kadawatha");
  assertEquals(tripTitle("company", "x".repeat(200)).length, 120);
});

Deno.test("the trip's time: the phone's, never in the future, at most a day back", () => {
  const now = new Date("2026-10-18T05:00:00Z");
  assertEquals(tripTime(undefined, now), now.toISOString());
  assertEquals(tripTime("2026-10-18T04:30:00Z", now), "2026-10-18T04:30:00.000Z", "an offline start sent later keeps its time");
  assertEquals(tripTime("2026-10-18T06:00:00Z", now), now.toISOString(), "a phone clock ahead is cut to now");
  assertEquals(tripTime("2026-10-16T05:00:00Z", now), "2026-10-17T05:00:00.000Z", "two days back is cut to one");
  assertThrows(() => tripTime("yesterday", now), Error, "not a time");
});

Deno.test("daySpan: Colombo days, both counted, as the UTC range to query", () => {
  assertEquals(daySpan(undefined, undefined), null);
  // 2026-10-18 in Colombo starts at 18:30 UTC the day before.
  assertEquals(daySpan("2026-10-18", "2026-10-18"), {
    from: "2026-10-18",
    to: "2026-10-18",
    start: "2026-10-17T18:30:00.000Z",
    end: "2026-10-18T18:30:00.000Z",
  });
  assertEquals(daySpan("2026-10-01", "2026-10-31")?.end, "2026-10-31T18:30:00.000Z");
  assertThrows(() => daySpan("2026-10-18", undefined), Error, "together");
  assertThrows(() => daySpan("2026-10-19", "2026-10-18"), Error, "after");
  assertThrows(() => daySpan("2026-02-30", "2026-03-01"), Error, "not a real date");
  assertThrows(() => daySpan("2025-01-01", "2026-10-18"), Error, "too long");
  assertEquals(daySpan("2025-10-19", "2026-10-18")?.from, "2025-10-19", "366 days is the most");
});
