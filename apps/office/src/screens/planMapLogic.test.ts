// The plan on the map (Phase 7, §20): the pins and Google's line from a plan answer, and rule 10.
import { describe, expect, it } from "vitest";
import { encodePolyline } from "@fleet/polyline";
import type { PlanTimeline } from "../data/types";
import { missed, type PlanMapStop, planMapOf, START_PIN, stopPin } from "./planMapLogic";

const head = { lat: 6.9271, lng: 79.8612 };
const kur = { lat: 7.4863, lng: 80.3623 };
const town = { lat: 7.4818, lng: 80.3609 };
const leg1 = encodePolyline([head, { lat: 7.2, lng: 80.1 }, kur]);
const leg2 = encodePolyline([kur, town]);

const timeline: PlanTimeline = {
  items: [
    { kind: "leave", at: "07:24", source: "plan" },
    { kind: "leg", from_n: "start", to_n: 1, km: 94, minutes: 96, source: "google", line: leg1 } as PlanTimeline["items"][number],
    { kind: "stop", n: 1, label: "Stop 1 · Drop · Kurunegala site", place: "Kurunegala site", planned_arrive: "09:00", planned_leave: "10:30", arrive_by: "09:00", dwell_min: 90 },
    { kind: "leg", from_n: 1, to_n: 2, km: 2, minutes: 8, source: "google", line: leg2 } as PlanTimeline["items"][number],
    { kind: "stop", n: 2, label: "Stop 2 · Visit · Kurunegala town", place: "Kurunegala town", planned_arrive: "10:38", planned_leave: "11:38", arrive_by: "10:30", late_min: 8, dwell_min: 60 },
  ],
  totals: { drive_min: 104, km: 96, ends: "11:38" },
};
const stops: PlanMapStop[] = [{ n: 1, place: "Kurunegala site", ...kur }, { n: 2, place: "Kurunegala town", ...town, google: true }];
const start = { name: "Head office", ...head };

describe("the plan's pins", () => {
  it("the start as S, then every stop by its number with its arrive and leave, a missed arrive-by red", () => {
    const v = planMapOf({ timeline, stops, start, google: true })!;
    expect(v.plan.pins).toEqual([
      { id: START_PIN, n: "S", label: "S · Head office · leave 07:24", ...head },
      { id: stopPin(1), n: 1, label: "1 · Kurunegala site · 09:00–10:30", ...kur },
      { id: stopPin(2), n: 2, label: "2 · Kurunegala town · 10:38–11:38", late: true, google: true, ...town },
    ]);
    expect(v.googleNotDrawn).toEqual([]);
    expect(v.noPin).toEqual([]);
  });

  it("no S pin when passengers get in at the start (it is Stop 1)", () => {
    const t: PlanTimeline = { ...timeline, items: timeline.items.map((x) => (x.kind === "stop" && x.n === 1 ? { ...x, is_start: true } : x)) };
    const v = planMapOf({ timeline: t, stops, start, google: true })!;
    expect(v.plan.pins.map((p) => p.n)).toEqual([1, 2]);
  });

  it("follows the task's numbers after the stops already reached (offset)", () => {
    const v = planMapOf({ timeline, stops, start, google: true, offset: 2 })!;
    expect(v.plan.pins.map((p) => [p.id, p.n, p.label])).toEqual([
      [START_PIN, "S", "S · Head office · leave 07:24"],
      [stopPin(1), 3, "3 · Kurunegala site · 09:00–10:30"],
      [stopPin(2), 4, "4 · Kurunegala town · 10:38–11:38"],
    ]);
  });

  it("lists a stop with no pin under the map", () => {
    const v = planMapOf({ timeline, stops: [{ n: 1, place: "Kurunegala site" }, stops[1]], start, google: true })!;
    expect(v.plan.pins.map((p) => p.id)).toEqual([START_PIN, stopPin(2)]);
    expect(v.noPin).toEqual(["1 · Kurunegala site"]);
  });

  it("reads the stops alone when there is no timeline yet, and nothing at all is null", () => {
    const v = planMapOf({ stops: [{ place: "Kurunegala site", planned_arrive: "09:00", planned_depart: "10:30", ...kur }], google: false })!;
    expect(v.plan.pins).toEqual([{ id: stopPin(1), n: 1, label: "1 · Kurunegala site · 09:00–10:30", ...kur }]);
    expect(planMapOf({ google: false })).toBeNull();
  });

  it("a missed arrive-by: the timeline's late minutes, else the times themselves", () => {
    expect([missed("09:05", "09:00"), missed("08:55", "09:00"), missed("09:05", undefined), missed("09:05", "09:00", 0)]).toEqual([true, false, false, false]);
  });
});

describe("rule 10: Google's pins and lines on Google's map only", () => {
  it("on Google's map: every leg's road line, decoded, leg by leg with its ends", () => {
    const v = planMapOf({ timeline, stops, start, google: true })!;
    expect(v.plan.legs!.map((l) => `${l.from}>${l.to}:${l.points.length}:${l.google}`)).toEqual([`${START_PIN}>${stopPin(1)}:3:true`, `${stopPin(1)}>${stopPin(2)}:2:true`]);
    expect(v.plan.legs![0].points[0]).toEqual(head);
    expect(v.plan.legs![0].points[2]).toEqual(kur);
  });

  it("on any other map: Google's lines are not even decoded, no Google pin; the Google place is listed instead", () => {
    const v = planMapOf({ timeline, stops, start, google: false })!;
    expect(v.plan.legs!.every((l) => l.points.length === 0 && l.google)).toBe(true);
    expect(v.plan.pins.map((p) => p.id)).toEqual([START_PIN, stopPin(1)]);
    expect(v.plan.pins.some((p) => p.google)).toBe(false);
    expect(v.googleNotDrawn).toEqual(["2 · Kurunegala town"]);
  });

  it("a Google start is Google's pin too", () => {
    const v = planMapOf({ timeline, stops: stops.slice(0, 1), start: { ...start, google: true }, google: false })!;
    expect(v.plan.pins.map((p) => p.id)).toEqual([stopPin(1)]);
    expect(v.googleNotDrawn).toEqual(["S · Head office"]);
    expect(planMapOf({ timeline, stops: stops.slice(0, 1), start: { ...start, google: true }, google: true })!.plan.pins[0]).toMatchObject({ id: START_PIN, google: true });
  });

  it("a broken polyline draws nothing rather than a wrong line", () => {
    const t: PlanTimeline = { ...timeline, items: timeline.items.map((x) => (x.kind === "leg" ? { ...x, line: "~" } as PlanTimeline["items"][number] : x)) };
    expect(planMapOf({ timeline: t, stops, start, google: true })!.plan.lines).toBeUndefined();
  });
});

describe("Part 6: openrouteservice's road line is ours (any map)", () => {
  it("an ors leg keeps its line on the free map; a google leg does not", () => {
    const t: PlanTimeline = { ...timeline, items: timeline.items.map((x) => (x.kind === "leg" && x.to_n === 1 ? { ...x, source: "ors" } : x)) };
    const v = planMapOf({ timeline: t, stops, start, google: false })!;
    expect(v.plan.legs!.map((l) => `${l.points.length}:${l.google}`)).toEqual(["3:false", "0:true"]);
  });
});

