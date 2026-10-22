// Round 4–7 (7): the Timeline's layout (screens/scheduleLogic.ts): bars on the 06:00–22:00 track, lanes, ticks, now, words.
import { describe, expect, it } from "vitest";
import { barOf, bookingLabel, bookingTime, bookingTone, busyLine, byStart, hourTicks, lanesOf, minutesOf, MIN_WIDTH, notAvailableText, nowLeft, type Booking } from "./scheduleLogic";

const booking = (over: Partial<Booking> = {}): Booking => ({ task_id: "t1", title: "Team drop", from: "08:00", to: "11:00", status: "assigned", ...over });

describe("the track", () => {
  it("reads HH:MM", () => {
    expect(minutesOf("08:30")).toBe(510);
    expect(minutesOf("8:05")).toBe(485);
    expect(minutesOf("24:00")).toBeNull();
    expect(minutesOf("")).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
  });
  it("places a bar by its time (06:00–22:00 = 0–100 %)", () => {
    expect(barOf("06:00", "22:00")).toEqual({ left: 0, width: 100, before: false, after: false, open: false });
    expect(barOf("08:00", "12:00")).toEqual({ left: 12.5, width: 25, before: false, after: false, open: false });
    expect(barOf("14:00", "14:30")).toMatchObject({ left: 50, width: 3.13 });
  });
  it("no end: an hour, marked open", () => {
    expect(barOf("10:00")).toEqual({ left: 25, width: 6.25, before: false, after: false, open: true });
  });
  it("clamps to the track; past midnight runs to the end; wholly outside is a thin bar at the edge", () => {
    expect(barOf("05:00", "07:00")).toEqual({ left: 0, width: 6.25, before: true, after: false, open: false });
    expect(barOf("21:00", "23:30")).toEqual({ left: 93.75, width: 6.25, before: false, after: true, open: false });
    expect(barOf("20:00", "01:00")).toMatchObject({ left: 87.5, width: 12.5, after: true });
    expect(barOf("04:00", "05:00")).toMatchObject({ left: 0, width: MIN_WIDTH, before: true });
    expect(barOf("22:30", "23:00")).toMatchObject({ left: 100 - MIN_WIDTH, width: MIN_WIDTH, after: true });
    expect(barOf("10:00", "10:05")?.width).toBe(MIN_WIDTH);
    expect(barOf("soon")).toBeNull();
  });
  it("ticks every 2 h from 06:00 to 22:00, and the now line inside the track only", () => {
    expect(hourTicks().map((t) => t.label)).toEqual(["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"]);
    expect(hourTicks()[4]).toEqual({ label: "14:00", left: 50 });
    expect(nowLeft("14:00")).toBe(50);
    expect(nowLeft("05:59")).toBeNull();
    expect(nowLeft("22:01")).toBeNull();
    expect(nowLeft(null)).toBeNull();
  });
  it("overlapping bookings take lanes; back-to-back ones share one", () => {
    expect(lanesOf([])).toEqual({ lanes: [], count: 1 });
    expect(lanesOf([booking({ from: "08:00", to: "10:00" }), booking({ from: "10:00", to: "12:00" })])).toEqual({ lanes: [0, 0], count: 1 });
    expect(lanesOf([booking({ from: "08:00", to: "11:00" }), booking({ from: "09:00", to: "10:00" }), booking({ from: "10:30", to: "12:00" })])).toEqual({ lanes: [0, 1, 1], count: 2 });
    expect(lanesOf([booking({ from: "08:00", to: undefined }), booking({ from: "08:30", to: "09:00" })])).toEqual({ lanes: [0, 1], count: 2 });
  });
});

describe("the words", () => {
  it("a booking's time, tone and label", () => {
    expect(bookingTime(booking())).toBe("08:00–11:00");
    expect(bookingTime(booking({ to: undefined }))).toBe("from 08:00");
    expect([bookingTone("assigned"), bookingTone("in_progress"), bookingTone("completed")]).toEqual(["planned", "live", "done"]);
    expect(bookingLabel(booking({ vehicle: "WP CAB-4521", holder: { name: "Anoja Perera", by: "asked" } }), "drivers"))
      .toBe("Team drop · 08:00–11:00 · Planned · WP CAB-4521 · Anoja Perera asked for it");
    expect(bookingLabel(booking({ status: "in_progress", driver: "Kamal", holder: { name: "Nimal", by: "assigned" } }), "vehicles"))
      .toBe("Team drop · 08:00–11:00 · On the way · Kamal · Nimal assigned it");
    expect(bookingLabel(booking({ status: "completed" }), "drivers")).toBe("Team drop · 08:00–11:00 · Done");
  });
  it("not available in words, never the codes", () => {
    expect(notAvailableText({ from: "13:00", to: "22:00", part: "afternoon", reason: "half_day" })).toBe("Not available 13:00–22:00 · afternoon · half day");
    expect(notAvailableText({ from: "06:00", to: "22:00", part: "full_day", reason: "leave" })).toBe("Not available 06:00–22:00 · all day · leave");
    expect(notAvailableText({ from: "10:00", to: "12:00", part: "hours", reason: "other" })).toBe("Not available 10:00–12:00");
  });
  it("sorted by start; the header's count", () => {
    expect(byStart([booking({ task_id: "b", from: "14:00" }), booking({ task_id: "a", from: "07:00" })]).map((b) => b.task_id)).toEqual(["a", "b"]);
    expect(busyLine({ busy: 3, count: 12 })).toBe("3 of 12 busy");
  });
});
