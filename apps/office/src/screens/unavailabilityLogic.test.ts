// Part 3b (H1): the not-available editor's form, its checks and set_unavailability's arguments.
import { describe, expect, it } from "vitest";
import { HALF, LEAVE } from "./__fixtures__/driversBoard";
import { entryChip, entryDays, entryError, entryForm, type EntryForm, partChoices, setUnavailabilityArgs, shortDay, splitOf } from "./unavailabilityLogic";

const TODAY = "2026-10-20";
const form = (over: Partial<EntryForm> = {}): EntryForm => ({ ...entryForm(null, "2026-10-21"), ...over });

describe("the editor's words", () => {
  it("When: the split from the setting half_day_split, 13:00 when it is not a time", () => {
    expect(partChoices("12:30").map(([, l]) => l)).toEqual(["Full day", "Morning until 12:30", "Afternoon from 12:30", "From–to"]);
    expect([splitOf("12:30"), splitOf(undefined), splitOf("1 pm"), splitOf(null)]).toEqual(["12:30", "13:00", "13:00", "13:00"]);
  });

  it("an entry's chip and days", () => {
    expect(entryChip(LEAVE)).toBe("Leave · all day");
    expect(entryChip({ ...LEAVE, reason_text: "half day", part: "morning", end_time: "13:00" })).toBe("Half day · until 13:00");
    expect(entryChip(HALF)).toBe("Half day · until 13:00");
    expect(entryChip({ part: "afternoon", reason_text: "Personal", start_time: "13:00" })).toBe("Personal · from 13:00");
    expect(entryChip({ part: "hours", reason_text: "Other", start_time: "09:00", end_time: "11:30" })).toBe("Other · 09:00–11:30");
    expect(entryDays(LEAVE)).toBe("Wed 21 Oct – Thu 22 Oct");
    expect(entryDays(HALF)).toBe("Tue 20 Oct");
    expect(shortDay("2026-10-25")).toBe("Sun 25 Oct");
  });
});

describe("the form", () => {
  it("a new entry: a full day of leave on the day given", () => {
    expect(entryForm(null, "2026-10-21")).toEqual({ day: "2026-10-21", last_day: "", part: "full_day", from: "", to: "", reason: "leave", note: "" });
  });

  it("an entry to change: its days, its part, its times (from–to only), its reason and note", () => {
    expect(entryForm(LEAVE)).toEqual({ day: "2026-10-21", last_day: "2026-10-22", part: "full_day", from: "", to: "", reason: "leave", note: "Wedding" });
    expect(entryForm(HALF)).toEqual({ day: "2026-10-20", last_day: "", part: "morning", from: "", to: "", reason: "half_day", note: "" });
    expect(entryForm({ ...HALF, part: "hours", start_time: "09:00", end_time: "11:30" })).toMatchObject({ part: "hours", from: "09:00", to: "11:30" });
  });
});

describe("the checks (the server's own)", () => {
  it("accepts a good entry", () => {
    expect(entryError(form(), TODAY)).toBeNull();
    expect(entryError(form({ last_day: "2026-10-23" }), TODAY)).toBeNull();
    expect(entryError(form({ part: "hours", from: "09:00", to: "11:30" }), TODAY)).toBeNull();
    expect(entryError(form({ day: TODAY }), TODAY)).toBeNull();
  });

  it("refuses what the server refuses, in one sentence", () => {
    expect(entryError(form({ day: "" }), TODAY)).toBe("Choose the day.");
    expect(entryError(form({ day: "2026-10-19" }), TODAY)).toBe("That day has passed.");
    expect(entryError(form({ last_day: "2026-10-20" }), TODAY)).toBe("The last day comes after the first.");
    expect(entryError(form({ last_day: "2026-11-21" }), TODAY)).toBe("At most 31 days at a time.");
    expect(entryError(form({ last_day: "2026-11-20" }), TODAY)).toBeNull(); // 31 days
    expect(entryError(form({ part: "hours", from: "09:00", to: "" }), TODAY)).toBe("Give the time from and the time to.");
    expect(entryError(form({ part: "hours", from: "11:00", to: "09:00" }), TODAY)).toBe("The time to comes after the time from.");
    expect(entryError(form({ note: "x".repeat(301) }), TODAY)).toBe("The note can be 300 characters at most.");
    // A running several-day entry that started yesterday can still be changed (its last day is ahead).
    expect(entryError(form({ day: "2026-10-19", last_day: "2026-10-22" }), TODAY)).toBeNull();
    // The last day only counts for full days.
    expect(entryError(form({ part: "morning", last_day: "2026-10-19" }), TODAY)).toBeNull();
  });
});

describe("set_unavailability's arguments", () => {
  it("a full day, several days, a morning, from–to, the note when given, the id when changing", () => {
    expect(setUnavailabilityArgs("kamal.p", form())).toEqual({ driver: "kamal.p", date: "2026-10-21", part: "full_day", reason: "leave" });
    expect(setUnavailabilityArgs("kamal.p", form({ last_day: "2026-10-23", note: "  Wedding " }))).toEqual({
      driver: "kamal.p", date: "2026-10-21", to_date: "2026-10-23", part: "full_day", reason: "leave", note: "Wedding",
    });
    // The same day as the last day: one day, no to_date.
    expect(setUnavailabilityArgs("kamal.p", form({ last_day: "2026-10-21" }))).not.toHaveProperty("to_date");
    // A morning never sends the last day or times typed earlier.
    expect(setUnavailabilityArgs("kamal.p", form({ part: "morning", reason: "half_day", last_day: "2026-10-23", from: "09:00", to: "10:00" }))).toEqual({
      driver: "kamal.p", date: "2026-10-21", part: "morning", reason: "half_day",
    });
    expect(setUnavailabilityArgs("kamal.p", form({ part: "hours", from: "09:00", to: "11:30", reason: "personal" }), "u9")).toEqual({
      driver: "kamal.p", date: "2026-10-21", part: "hours", from: "09:00", to: "11:30", reason: "personal", id: "u9",
    });
  });
});
