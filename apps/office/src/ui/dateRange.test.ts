import { describe, expect, it } from "vitest";
import { colomboDay, customRange, daysIn, isDay, mondayOf, monthOf, rangeDates, rangeText, readRange, tooLong, writeRange } from "./dateRange";

const url = (q: string) => new URLSearchParams(q);

describe("date range: the dates", () => {
  it("weeks run Monday to Sunday", () => {
    // Thursday 15 October 2026
    expect(rangeDates("week", "2026-10-15")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    // A Monday is its own week's start; a Sunday belongs to the week before it.
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    // A week across the new year.
    expect(rangeDates("week", "2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("today and yesterday, across a month and a year", () => {
    expect(rangeDates("today", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-10-15" });
    expect(rangeDates("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(rangeDates("yesterday", "2027-01-01")).toEqual({ from: "2026-12-31", to: "2026-12-31" });
  });

  it("this month and last month, with their edges", () => {
    expect(rangeDates("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeDates("month", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeDates("month", "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeDates("last_month", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeDates("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(rangeDates("last_month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // January: last month is December of the year before.
    expect(rangeDates("last_month", "2027-01-01")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(rangeDates("month", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthOf("2027-01-20")).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("uses Colombo's date near midnight UTC", () => {
    // Colombo is UTC+5:30.
    expect(colomboDay(new Date("2026-10-15T18:29:00Z"))).toBe("2026-10-15");
    expect(colomboDay(new Date("2026-10-15T18:30:00Z"))).toBe("2026-10-16");
    expect(colomboDay(new Date("2026-10-15T23:59:00Z"))).toBe("2026-10-16");
    expect(colomboDay(new Date("2026-10-15T00:10:00Z"))).toBe("2026-10-15");
    // New Year's Eve, 00:15 in Colombo: this month is already January.
    const today = colomboDay(new Date("2026-12-31T18:45:00Z"));
    expect(today).toBe("2027-01-01");
    expect(rangeDates("month", today)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(rangeDates("last_month", today)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("a custom range: From after To is swapped, a non-date refused, the page's limit in words", () => {
    expect(customRange("2026-10-01", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(customRange("2026-10-15", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(customRange("2026-10-15", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-10-15" });
    expect(customRange("", "2026-10-15")).toEqual({ error: "Pick a From date." });
    expect(customRange("2026-10-15", "2026-02-30")).toEqual({ error: "Pick a To date." });
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(daysIn("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysIn("2026-10-15", "2026-10-15")).toBe(1);
    expect(tooLong("2026-08-01", "2026-10-01", 62)).toBeUndefined();
    expect(tooLong("2026-08-01", "2026-10-02", 62)).toBe("At most 62 days at a time: pick a shorter range.");
    expect(tooLong("2026-08-01", "2026-10-01")).toBeUndefined();
    expect(tooLong("2026-09-01", "2026-10-31", 62)).toBeUndefined();
  });

  it("says the range in words, Latin digits", () => {
    expect(rangeText("2026-10-15", "2026-10-15")).toBe("Thu 15 Oct 2026");
    expect(rangeText("2026-10-12", "2026-10-18")).toBe("Mon 12 Oct – Sun 18 Oct 2026");
    expect(rangeText("2026-12-28", "2027-01-03")).toBe("Mon 28 Dec 2026 – Sun 3 Jan 2027");
  });
});

describe("date range: the URL", () => {
  const today = "2026-10-15";

  it("reads the range, the page's default when there is none or it is wrong", () => {
    expect(readRange(url(""), "today", today)).toEqual({ range: "today", from: today, to: today });
    expect(readRange(url(""), "month", today)).toEqual({ range: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(readRange(url("range=week"), "today", today)).toEqual({ range: "week", from: "2026-10-12", to: "2026-10-18" });
    expect(readRange(url("range=fortnight"), "today", today)).toEqual({ range: "today", from: today, to: today });
  });

  it("reads a custom range: swapped when From is after To, one day when To is missing, the default when From is wrong", () => {
    expect(readRange(url("range=custom&from=2026-10-01&to=2026-10-07"), "today", today)).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-07" });
    expect(readRange(url("range=custom&from=2026-10-07&to=2026-10-01"), "today", today)).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-07" });
    expect(readRange(url("range=custom&from=2026-10-03"), "today", today)).toEqual({ range: "custom", from: "2026-10-03", to: "2026-10-03" });
    expect(readRange(url("range=custom&from=nonsense&to=2026-10-03"), "today", today)).toEqual({ range: "today", from: today, to: today });
  });

  it("one-day mode: only today, yesterday or a custom day, To = From", () => {
    expect(readRange(url("range=week"), "today", today, true)).toEqual({ range: "today", from: today, to: today });
    expect(readRange(url("range=yesterday"), "today", today, true)).toEqual({ range: "yesterday", from: "2026-10-14", to: "2026-10-14" });
    expect(readRange(url("range=custom&from=2026-10-03&to=2026-10-09"), "today", today, true)).toEqual({ range: "custom", from: "2026-10-03", to: "2026-10-03" });
  });

  it("writes the choice, keeping the page's other parameters; the default leaves no trace", () => {
    const base = url("driver=kamal&range=week");
    expect(writeRange(base, { range: "month" }, "today").toString()).toBe("driver=kamal&range=month");
    expect(writeRange(base, { range: "today" }, "today").toString()).toBe("driver=kamal");
    expect(writeRange(base, { range: "custom", from: "2026-10-01", to: "2026-10-07" }, "today").toString()).toBe("driver=kamal&range=custom&from=2026-10-01&to=2026-10-07");
    expect(writeRange(url("range=custom&from=2026-10-01&to=2026-10-07"), { range: "custom", from: "2026-10-02", to: "2026-10-09" }, "today", true).toString()).toBe("range=custom&from=2026-10-02");
    // The input is not changed.
    expect(base.toString()).toBe("driver=kamal&range=week");
  });
});
