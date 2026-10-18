import { describe, expect, it } from "vitest";
import type { Stop } from "../data/types";
import { dwellNote, needsDriverText, segmentRows, segmentsTotal, stayLine, stayText, stopTitle, whatOf } from "./taskDetailLogic";

const stop = (extra: Partial<Stop> = {}): Stop => ({ seq: 2, type: "drop", place: "Kurunegala site", status: "pending", ...extra });

describe("a stop on the task page", () => {
  it("is named by its order from the answer, else as before", () => {
    expect(stopTitle(stop({ label: "Stop 2 · Drop · Kurunegala site", what: "people" }))).toBe("Stop 2 · Drop · Kurunegala site");
    expect(whatOf(stop({ label: "Stop 2 · Drop · Kurunegala site", what: "people" }))).toBe("People");
    expect(stopTitle(stop({ what: "goods" }))).toBe("Drop-off · Goods · Kurunegala site");
    expect(whatOf(stop({ what: "goods" }))).toBe("");
    expect(stopTitle(stop({ type: "visit", place: undefined, address: "No. 4, Galle Rd" }))).toBe("Visit · No. 4, Galle Rd");
  });

  it("the time there: planned against what happened", () => {
    expect(stayText(30)).toBe("30 min");
    expect(stayText(60)).toBe("1 h");
    expect(stayText(90)).toBe("1 h 30");
    expect(stayText(125)).toBe("2 h 05");
    expect(stayText(undefined)).toBe("");
    expect(stayLine(stop({
      status: "done",
      planned_stay: { arrive: "09:00", leave: "10:30", minutes: 90 },
      actual_stay: { arrived: "09:04", done: "10:41", minutes: 97 },
    }))).toBe("planned 09:00–10:30 (1 h 30) · actual 09:04–10:41 (1 h 37)");
    expect(stayLine(stop({ status: "arrived", planned_stay: { arrive: "09:00", leave: "09:05", minutes: 5 }, actual_stay: { arrived: "09:12" } })))
      .toBe("planned 09:00–09:05 (5 min) · actual from 09:12 (there now)");
    expect(stayLine(stop({ status: "skipped", actual_stay: { arrived: "09:12" } }))).toBe("arrived 09:12");
    expect(stayLine(stop({ planned_arrive: "09:00", planned_depart: "09:10" }))).toBe("planned 09:00–09:10");
    expect(stayLine(stop())).toBe("");
  });

  it("says when the time there is the place's usual one", () => {
    expect(dwellNote(stop({ dwell_source: "place" }))).toBe("usual here");
    expect(dwellNote(stop({ dwell_source: "default" }))).toBe("");
    expect(dwellNote(stop())).toBe("");
  });
});

describe("the vehicle swap", () => {
  const done = [
    { vehicle: "WP CAB-4521", from: "08:10", to: "10:42", start_km: 45210, end_km: 45262, km: 52, reason: "Breakdown near Kurunegala", by: "Palitha" },
    { vehicle: "WP KL-1234", from: "10:42", to: "12:30", start_km: 80100, end_km: 80131, km: 31 },
  ];
  it("one row per stretch with its readings and km", () => {
    expect(segmentRows(done)).toEqual([
      { vehicle: "WP CAB-4521", window: "08:10–10:42", readings: "45,210 km → 45,262 km", km: "52 km", waiting: false, why: "Breakdown near Kurunegala · by Palitha" },
      { vehicle: "WP KL-1234", window: "10:42–12:30", readings: "80,100 km → 80,131 km", km: "31 km", waiting: false, why: "" },
    ]);
    expect(segmentRows([{ vehicle: "WP CAB-4521", from: "08:10", to: "10:42", start_km: 45210, readings_waiting: true }, { vehicle: "WP KL-1234", from: "10:42", readings_waiting: true }]))
      .toMatchObject([
        { readings: "45,210 km → end to come", km: "", waiting: true, window: "08:10–10:42" },
        { readings: "start to come → in use now", km: "", waiting: true, window: "from 10:42" },
      ]);
    expect(segmentRows(undefined)).toEqual([]);
  });
  it("the total is the stretches added up, or what is known so far", () => {
    expect(segmentsTotal(done)).toEqual({ km: 83, complete: true, line: "Total 52 + 31 = 83 km" });
    expect(segmentsTotal([done[0], { vehicle: "WP KL-1234", from: "10:42", readings_waiting: true }]))
      .toEqual({ km: 52, complete: false, line: "52 km so far · a reading is still to come from the driver" });
    expect(segmentsTotal([{ vehicle: "WP CAB-4521", from: "08:10", readings_waiting: true }]).line).toBe("The readings are still to come from the driver");
  });
});

describe("needs a driver", () => {
  it("says since when and why", () => {
    expect(needsDriverText({ driver: "Kamal Silva", needs_driver: { since: "Fri 16 Oct 08:40", reason: "declined", reason_text: "Vehicle problem" } }))
      .toBe("Needs a driver since Fri 16 Oct 08:40 · Kamal declined: Vehicle problem");
    expect(needsDriverText({ driver: "Kamal Silva", needs_driver: { since: "Fri 16 Oct 08:40", reason: "not_accepted", reason_text: "Not accepted in time" } }))
      .toBe("Needs a driver since Fri 16 Oct 08:40 · Kamal hasn't accepted in time");
    expect(needsDriverText({ driver: "Kamal Silva" })).toBe("");
  });
});
