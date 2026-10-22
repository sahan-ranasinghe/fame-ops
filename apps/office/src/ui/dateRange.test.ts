import { describe, expect, it } from "vitest";
import {
  ANY_TIME,
  addMonths,
  colomboDay,
  customRange,
  dayDisabled,
  dayRole,
  daysIn,
  isDay,
  mondayOf,
  monthGrid,
  monthOf,
  monthTitle,
  pickedRange,
  type Picking,
  pickerText,
  PRESETS,
  rangeDates,
  rangeText,
  readRange,
  shiftWeek,
  stripCell,
  tapDay,
  tooLong,
  tripDayText,
  weekDays,
  weekTitle,
  writeRange,
} from "./dateRange";

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

  // Round 4–7: "Any time", only on a page whose default it is (the Issues page's Open tab).
  it("Any time: no dates; read only where it is the default; written like any other choice", () => {
    expect(readRange(url(""), "any", today)).toEqual({ range: "any", from: "", to: "" });
    expect(readRange(url("range=month"), "any", today)).toEqual({ range: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(readRange(url("range=custom&from=nonsense"), "any", today)).toEqual({ range: "any", from: "", to: "" });
    // Another page's default: range=any is not one of its ranges.
    expect(readRange(url("range=any"), "month", today)).toEqual({ range: "month", from: "2026-10-01", to: "2026-10-31" });
    expect(readRange(url("range=any"), "any", today, true)).toEqual({ range: "today", from: today, to: today });
    expect(writeRange(url("status=open&range=month"), { range: "any" }, "any").toString()).toBe("status=open");
    expect(writeRange(url("status=open"), { range: "month" }, "any").toString()).toBe("status=open&range=month");
    expect(writeRange(url("status=resolved"), { range: "any" }, "month").toString()).toBe("status=resolved&range=any");
    expect(pickerText("any", "", "", today)).toBe("Any time");
    expect(ANY_TIME).toEqual(["any", "Any time"]);
    expect(PRESETS.map(([k]) => k)).not.toContain("any");
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

describe("the presets and the picker's words", () => {
  it("Last 7 days ends today; every preset is listed, Custom is not", () => {
    expect(rangeDates("last7", "2026-10-20")).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(PRESETS.map(([k]) => k)).toEqual(["today", "yesterday", "last7", "week", "month", "last_month"]);
    expect(readRange(url("range=last7"), "today", "2026-10-20")).toEqual({ range: "last7", from: "2026-10-14", to: "2026-10-20" });
  });

  it("the button says the range in short words; the year only when it is not this year's", () => {
    const today = "2026-10-20";
    expect(pickerText("month", "2026-10-01", "2026-10-31", today)).toBe("This month · 1–31 Oct");
    expect(pickerText("week", "2026-10-19", "2026-10-25", today)).toBe("This week · Mon 19 – Sun 25 Oct");
    expect(pickerText("today", today, today, today)).toBe("Today · Tue 20 Oct");
    expect(pickerText("custom", "2026-09-28", "2026-10-04", today)).toBe("Mon 28 Sep – Sun 4 Oct");
    expect(pickerText("custom", "2026-08-28", "2026-10-04", today)).toBe("28 Aug – 4 Oct");
    expect(pickerText("custom", "2025-12-20", "2026-01-10", today)).toBe("20 Dec 2025 – 10 Jan 2026");
  });
});

describe("the calendar", () => {
  it("tap the start, then the end; an earlier end swaps; the same day twice is one day; a new tap starts again", () => {
    let p: Picking = { from: null, to: null };
    p = tapDay(p, "2026-10-10");
    expect(p).toEqual({ from: "2026-10-10", to: null });
    expect(pickedRange(p)).toEqual({ from: "2026-10-10", to: "2026-10-10" });
    p = tapDay(p, "2026-10-14");
    expect(p).toEqual({ from: "2026-10-10", to: "2026-10-14" });
    p = tapDay(p, "2026-10-12");
    expect(p).toEqual({ from: "2026-10-12", to: null });
    p = tapDay(p, "2026-10-05");
    expect(p).toEqual({ from: "2026-10-05", to: "2026-10-12" });
    p = tapDay({ from: null, to: null }, "2026-10-08");
    expect(tapDay(p, "2026-10-08")).toEqual({ from: "2026-10-08", to: "2026-10-08" });
    expect(pickedRange({ from: null, to: null })).toBeNull();
  });

  it("the days between are shaded, the ends marked", () => {
    const p = { from: "2026-10-10", to: "2026-10-12" };
    expect(dayRole("2026-10-10", p)).toBe("start");
    expect(dayRole("2026-10-11", p)).toBe("between");
    expect(dayRole("2026-10-12", p)).toBe("end");
    expect(dayRole("2026-10-13", p)).toBeNull();
    expect(dayRole("2026-10-10", { from: "2026-10-10", to: null })).toBe("single");
  });

  it("a page's limit greys the days past it while the end is picked (both days counted); min and max too", () => {
    const picking = { from: "2026-10-10", to: null };
    expect(dayDisabled("2026-10-16", { maxDays: 7, picking })).toBe(false); // 7 days
    expect(dayDisabled("2026-10-17", { maxDays: 7, picking })).toBe(true); // 8 days
    expect(dayDisabled("2026-10-04", { maxDays: 7, picking })).toBe(false);
    expect(dayDisabled("2026-10-03", { maxDays: 7, picking })).toBe(true);
    // Once the range is whole, a new start may be anywhere.
    expect(dayDisabled("2026-12-01", { maxDays: 7, picking: { from: "2026-10-10", to: "2026-10-12" } })).toBe(false);
    expect(dayDisabled("2026-10-19", { min: "2026-10-20" })).toBe(true);
    expect(dayDisabled("2026-10-21", { max: "2026-10-20" })).toBe(true);
  });

  it("a month's grid starts on Monday, blanks around it; months move across the year", () => {
    const oct = monthGrid("2026-10"); // 1 October 2026 is a Thursday
    expect(oct[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(oct.flat().filter(Boolean)).toHaveLength(31);
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid("2026-02").flat().filter(Boolean)).toHaveLength(28);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(monthTitle("2026-10")).toBe("October 2026");
  });
});

describe("the week strip and the trip day", () => {
  it("seven days from Monday; ‹ › move by a week; the week's title", () => {
    expect(weekDays("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(shiftWeek("2026-10-19", -1)).toBe("2026-10-12");
    expect(shiftWeek("2026-10-22", 1)).toBe("2026-10-26"); // any day: its week's Monday, moved
    expect(weekTitle("2026-10-19")).toBe("19–25 Oct 2026");
    expect(weekTitle("2026-09-28")).toBe("28 Sep – 4 Oct 2026");
    expect(weekTitle("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(stripCell("2026-10-20")).toEqual({ weekday: "Tue", date: 20 });
  });

  it("a trip's day on its chip: Today, Tomorrow, else the date", () => {
    expect(tripDayText("2026-10-20", "2026-10-20")).toBe("Today");
    expect(tripDayText("2026-10-21", "2026-10-20")).toBe("Tomorrow");
    expect(tripDayText("2026-10-23", "2026-10-20")).toBe("Fri 23 Oct");
    expect(tripDayText("2027-01-05", "2026-10-20")).toBe("Tue 5 Jan 2027");
  });
});
