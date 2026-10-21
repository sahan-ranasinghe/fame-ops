import { describe, expect, it } from "vitest";
import { datesInWords, dayWords, whenText } from "./when";

// 21 October 2026, 10:00 in Colombo (04:30 UTC).
const now = new Date("2026-10-21T04:30:00Z");

describe("dates in words (Round 3 A4)", () => {
  it("today, yesterday and tomorrow with the time", () => {
    expect(whenText("2026-10-21 20:47", { now })).toBe("Today 20:47");
    expect(whenText("2026-10-20 20:47", { now })).toBe("Yesterday 20:47");
    expect(whenText("2026-10-22 07:00", { now })).toBe("Tomorrow 07:00");
  });
  it("another day of this year: the weekday, the day and the month, no year", () => {
    expect(whenText("2026-10-19 20:47", { now })).toBe("Mon 19 Oct 20:47");
    expect(whenText("2026-01-02 08:05", { now })).toBe("Fri 2 Jan 08:05");
  });
  it("another year: the year after the month", () => {
    expect(whenText("2025-10-19 20:47", { now })).toBe("Sun 19 Oct 2025 20:47");
    expect(whenText("2027-04-02", { now })).toBe("Fri 2 Apr 2027");
  });
  it("a date alone", () => {
    expect(whenText("2026-10-21", { now })).toBe("Today");
    expect(whenText("2026-10-20", { now })).toBe("Yesterday");
    expect(whenText("2026-11-02", { now })).toBe("Mon 2 Nov");
    expect(dayWords("2026-10-23", { now })).toBe("Fri 23 Oct");
  });
  it("Colombo's midnight decides today, not UTC's", () => {
    // 23:59:59 in Colombo on the 20th (18:29:59 UTC): the 20th is still today.
    const lateOn20 = new Date("2026-10-20T18:29:59Z");
    expect(whenText("2026-10-20 23:59", { now: lateOn20 })).toBe("Today 23:59");
    // 00:00 in Colombo on the 21st (18:30 UTC on the 20th): the 20th is yesterday.
    const midnight = new Date("2026-10-20T18:30:00Z");
    expect(whenText("2026-10-20 23:59", { now: midnight })).toBe("Yesterday 23:59");
    expect(whenText("2026-10-21 00:00", { now: midnight })).toBe("Today 00:00");
    // New Year in Colombo: 31 December is yesterday, and last year's.
    const newYear = new Date("2026-12-31T18:30:00Z");
    expect(whenText("2026-12-31 22:00", { now: newYear })).toBe("Yesterday 22:00");
    expect(whenText("2026-12-30", { now: newYear })).toBe("Wed 30 Dec 2026");
  });
  it("an ISO time is moved to Colombo first", () => {
    expect(whenText("2026-10-20T18:30:00Z", { now })).toBe("Today 00:00");
    expect(whenText("2026-10-20T18:29:00.000Z", { now })).toBe("Yesterday 23:59");
    expect(whenText("2026-10-19T20:47:00+05:30", { now })).toBe("Mon 19 Oct 20:47");
  });
  it("anything else is given back unchanged", () => {
    expect(whenText("08:41", { now })).toBe("08:41");
    expect(whenText("never", { now })).toBe("never");
    expect(whenText("Thu 8 Oct 06:30", { now })).toBe("Thu 8 Oct 06:30");
    expect(whenText(null, { now })).toBe("");
    expect(whenText(undefined, { now })).toBe("");
    expect(whenText("2026-13-45 99:99x", { now })).toBe("2026-13-45 99:99x");
  });
  it("inside a sentence: small letters, a capital at the start or after a dot", () => {
    expect(whenText("2026-10-21 20:47", { now, inline: true })).toBe("today 20:47");
    expect(datesInWords("Snoozed until 2026-10-22 07:00 · by Kamal", { now })).toBe("Snoozed until tomorrow 07:00 · by Kamal");
    expect(datesInWords("2026-10-20 20:47 by Kamal", { now })).toBe("Yesterday 20:47 by Kamal");
    expect(datesInWords("Sent · 2026-10-19 09:10", { now })).toBe("Sent · Mon 19 Oct 09:10");
    expect(datesInWords("Licence expires 2027-04-02", { now })).toBe("Licence expires Fri 2 Apr 2027");
    expect(datesInWords("No date here, 12:30", { now })).toBe("No date here, 12:30");
  });
});
