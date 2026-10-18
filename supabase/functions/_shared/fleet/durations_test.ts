import { assertEquals } from "@std/assert";
import { duration, whenText } from "./durations.ts";

// Sunday 18 October 2026, 14:00 in Colombo.
const now = new Date("2026-10-18T08:30:00Z");
const at = (minutes: number) => new Date(now.getTime() + minutes * 60000);

Deno.test("a length: minutes, hours and minutes, whole hours, days", () => {
  assertEquals(duration(0), "0 min");
  assertEquals(duration(45), "45 min");
  assertEquals(duration(60), "1 h");
  assertEquals(duration(75), "1 h 15 min");
  assertEquals(duration(200), "3 h 20 min");
  assertEquals(duration(-75), "1 h 15 min");
  assertEquals(duration(26 * 60 + 10), "1 d 2 h");
  assertEquals(duration(48 * 60), "2 d");
  assertEquals(duration(75, "si"), "පැය 1 මිනිත්තු 15");
  assertEquals(duration(45, "si"), "මිනිත්තු 45");
});

Deno.test("soon and a while ago: now, minutes, hours", () => {
  assertEquals(whenText(at(0.3), now), "now");
  assertEquals(whenText(at(45), now), "in 45 min");
  assertEquals(whenText(at(-45), now), "45 min ago");
  assertEquals(whenText(at(200), now), "in 3 h 20 min");
  assertEquals(whenText(at(-180), now), "3 h ago");
  assertEquals(whenText(at(45), now, "si"), "මිනිත්තු 45 කින්");
  assertEquals(whenText(at(-200), now, "si"), "පැය 3 මිනිත්තු 20 කට පෙර");
});

Deno.test("another day: tomorrow and yesterday with the clock time, later with the day and how many days", () => {
  // 09:00 tomorrow (19 hours away) is "tomorrow 09:00", not "in 19 h".
  assertEquals(whenText(new Date("2026-10-19T03:30:00Z"), now), "tomorrow 09:00");
  assertEquals(whenText(new Date("2026-10-17T03:30:00Z"), now), "yesterday 09:00");
  assertEquals(whenText(new Date("2026-10-20T03:30:00Z"), now), "Tue 20 Oct 09:00 (in 2 days)");
  assertEquals(whenText(new Date("2026-10-15T03:30:00Z"), now), "Thu 15 Oct 09:00 (3 days ago)");
  assertEquals(whenText(new Date("2026-10-19T03:30:00Z"), now, "si"), "හෙට 09:00");
  assertEquals(whenText(new Date("2026-10-20T03:30:00Z"), now, "si"), "Tue 20 Oct 09:00 (දින 2 කින්)");
});

Deno.test("late in the evening, a time after midnight under 6 hours away is still in hours", () => {
  const evening = new Date("2026-10-18T16:30:00Z"); // 22:00 Colombo
  assertEquals(whenText(new Date("2026-10-18T21:30:00Z"), evening), "in 5 h"); // 03:00 on the 19th
  assertEquals(whenText(new Date("2026-10-19T00:30:00Z"), evening), "tomorrow 06:00"); // 8 hours away
  // Just after midnight in Colombo (18:31 UTC), 23:50 the evening before is 41 minutes ago, not "yesterday".
  assertEquals(whenText(new Date("2026-10-18T18:20:00Z"), new Date("2026-10-18T19:01:00Z")), "41 min ago");
});
