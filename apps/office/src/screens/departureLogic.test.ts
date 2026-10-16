import { describe, expect, it } from "vitest";
import type { PlanTimeline } from "../data/types";
import { ceil5, checkDeparture, departurePlan, fromMin, toMin } from "./departureLogic";

/** Planned from the deadline: leave 07:24, Kurunegala site at 09:00 (by 09:00). */
const timeline = (source = "plan", leave = "07:24", arrive = "09:00"): PlanTimeline => ({
  items: [
    { kind: "leave", at: leave, source },
    { kind: "stop", n: 1, label: "Stop 1 · Pickup · Head office", place: "Head office", planned_arrive: "07:40", planned_leave: "07:45", dwell_min: 5, dwell_source: "default" },
    { kind: "leg", from_n: 1, to_n: 2, km: 94, minutes: 75, source: "google" },
    { kind: "stop", n: 2, label: "Stop 2 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: arrive, planned_leave: "10:30", arrive_by: "09:00", dwell_min: 90, dwell_source: "chosen" },
  ],
  totals: { drive_min: 91, km: 104, ends: "10:30" },
});

describe("the departure check", () => {
  it("reads the plan's leave time, the buffer and the stops with their deadlines; none without a deadline", () => {
    expect(departurePlan(timeline(), 0)).toEqual({
      leave: "07:24", source: "plan", buffer: 0,
      stops: [{ n: 1, place: "Head office", arrive: "07:40", arriveBy: undefined }, { n: 2, place: "Kurunegala site", arrive: "09:00", arriveBy: "09:00" }],
    });
    const none = timeline();
    none.items = none.items.map((x) => (x.kind === "stop" ? { ...x, arrive_by: undefined } : x));
    expect(departurePlan(none)).toBeNull();
    expect(departurePlan(null)).toBeNull();
  });

  it("fills an empty departure with the plan's leave-by when it was planned from the deadlines", () => {
    expect(checkDeparture("", departurePlan(timeline()))).toEqual({ kind: "fill", leaveBy: "07:24" });
    expect(checkDeparture("", departurePlan(timeline("manual")))).toBeNull();
  });

  it("says a late departure in §20's words, with the leave-by and the arrive-by to move to", () => {
    const c = checkDeparture("08:00", departurePlan(timeline()));
    expect(c).toEqual({
      kind: "late", tone: "bad", n: 2, place: "Kurunegala site",
      text: "Leaving 08:00 you reach Kurunegala site at 09:36, 36 min after 09:00. Leave by 07:24.",
      leaveBy: "07:24", moveTo: "09:40",
    });
  });

  it("uses the plan made with the typed time as it is (no shift)", () => {
    const c = checkDeparture("08:00", departurePlan(timeline("manual", "08:00", "09:36")));
    expect(c).toMatchObject({ kind: "late", leaveBy: "07:24", moveTo: "09:40" });
  });

  it("counts the buffer: inside it is a warning, not a missed deadline", () => {
    const c = checkDeparture("07:20", departurePlan(timeline("manual", "07:20", "08:56"), 10));
    expect(c).toEqual({
      kind: "late", tone: "warn", n: 2, place: "Kurunegala site",
      text: "Leaving 07:20 you reach Kurunegala site at 08:56, only 4 min before 09:00. Leave by 07:14.",
      leaveBy: "07:14",
    });
  });

  it("notes an arrival 20 minutes or more early, and nothing in between", () => {
    expect(checkDeparture("06:59", departurePlan(timeline()))).toEqual({ kind: "early", text: "Arrives 25 min early", minutes: 25 });
    expect(checkDeparture("07:10", departurePlan(timeline()))).toBeNull();
    expect(checkDeparture("07:24", departurePlan(timeline()))).toBeNull();
    expect(checkDeparture("7:5", departurePlan(timeline()))).toBeNull();
  });

  it("leaves the plan without an end when the form has no back-by", () => {
    expect(departurePlan(timeline(), 0, "")?.end).toBeUndefined();
    expect(departurePlan(timeline(), 0, null)?.end).toBeUndefined();
  });

  it("reads and writes clock times", () => {
    expect([toMin("09:36"), toMin("2026-10-17 07:24"), toMin(""), toMin("x")]).toEqual([576, 444, null, null]);
    expect([fromMin(576), fromMin(-10), fromMin(1450)]).toEqual(["09:36", "23:50", "00:10"]);
    expect([ceil5(576), ceil5(580)]).toEqual([580, 580]);
  });
});

/** A day out and back (§20's words for "back by"): leave 08:00 as typed, Kurunegala site 09:36–16:00, back at the base 18:20. */
const dayOut = (opts: { back?: boolean; arriveBy?: string; leave?: string; ends?: string } = {}): PlanTimeline => ({
  items: [
    { kind: "leave", at: opts.leave ?? "08:00", source: opts.arriveBy ? "plan" : "manual" },
    { kind: "leg", from_n: "start", to_n: 1, km: 94, minutes: 96, source: "google" },
    { kind: "stop", n: 1, label: "Stop 1 · Visit · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:36", planned_leave: "16:00", arrive_by: opts.arriveBy, dwell_min: 384 },
    ...(opts.back === false ? [] : [{ kind: "leg" as const, from_n: 1, to_n: "base" as const, km: 94, minutes: 140, source: "google" }]),
  ],
  totals: { drive_min: 236, km: 188, ends: opts.ends ?? (opts.back === false ? "16:00" : "18:20") },
});

describe("the departure check against back by (§20)", () => {
  it("reads the end of the trip and the back-by; a back-by alone is enough to check", () => {
    expect(departurePlan(dayOut(), 0, "18:00")).toEqual({
      leave: "08:00", source: "manual", buffer: 0,
      stops: [{ n: 1, place: "Kurunegala site", arrive: "09:36", arriveBy: undefined }],
      end: { at: "18:20", by: "18:00", back: true, n: 1, place: "Kurunegala site" },
    });
    expect(departurePlan(dayOut(), 0, "")).toBeNull();
    expect(departurePlan(dayOut(), 0, "6pm")).toBeNull();
  });

  it("says a late return in §20's words, with Use 07:40 and Move back by to 18:20", () => {
    expect(checkDeparture("08:00", departurePlan(dayOut(), 0, "18:00"))).toEqual({
      kind: "late", tone: "bad", n: 1, place: "Kurunegala site", back: true,
      text: "Leaving 08:00 you are back at 18:20, 20 min after 18:00. Leave by 07:40.",
      leaveBy: "07:40", moveBackTo: "18:20",
    });
    // A departure typed after the plan was made: the end moves with it, rounded up to 5 minutes for the button.
    expect(checkDeparture("08:03", departurePlan(dayOut(), 0, "18:00"))).toMatchObject({
      text: "Leaving 08:03 you are back at 18:23, 23 min after 18:00. Leave by 07:40.", leaveBy: "07:40", moveBackTo: "18:25",
    });
  });

  it("without the drive back the trip ends at the last stop", () => {
    expect(checkDeparture("08:00", departurePlan(dayOut({ back: false }), 0, "15:30"))).toMatchObject({
      text: "Leaving 08:00 you finish at Kurunegala site at 16:00, 30 min after 15:30. Leave by 07:30.", leaveBy: "07:30", moveBackTo: "16:00",
    });
  });

  it("back in time says nothing; it is never an early note and never a fill", () => {
    expect(checkDeparture("08:00", departurePlan(dayOut(), 0, "18:30"))).toBeNull();
    expect(checkDeparture("06:00", departurePlan(dayOut(), 0, "18:30"))).toBeNull();
    expect(checkDeparture("", departurePlan(dayOut(), 0, "18:00"))).toBeNull();
  });

  it("the deadline that needs the earlier departure wins: the arrive-by or the back-by", () => {
    // Kurunegala site by 09:30 (6 min short) and back by 18:00 (20 min short): the back-by binds.
    const both = departurePlan(dayOut({ arriveBy: "09:30" }), 0, "18:00");
    expect(checkDeparture("08:00", both)).toMatchObject({ back: true, leaveBy: "07:40" });
    // By 09:00 (36 min short) binds before the back-by.
    const stop = checkDeparture("08:00", departurePlan(dayOut({ arriveBy: "09:00" }), 0, "18:00"));
    expect(stop).toMatchObject({ kind: "late", leaveBy: "07:24", moveTo: "09:40" });
    expect(stop).not.toHaveProperty("back");
    // The fill still comes from the arrive-by alone.
    expect(checkDeparture("", departurePlan(dayOut({ arriveBy: "09:00", leave: "07:24" }), 0, "18:00"))).toEqual({ kind: "fill", leaveBy: "07:24" });
  });
});
