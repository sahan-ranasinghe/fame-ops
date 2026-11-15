// The gap markers and the Gaps list (Phase 7, §21). The tests that read a real recorded day were removed with that day's
// data (a real driver's GPS trace) before the repository went public; only the test that needs no route data is kept.
import { describe, expect, it } from "vitest";
import { middleOf } from "./gapsLogic";

describe("the middle of a line", () => {
  it("is halfway by distance, not by count", () => {
    const m = middleOf([{ lat: 7, lng: 80 }, { lat: 7.001, lng: 80 }, { lat: 7.003, lng: 80 }])!;
    expect(m.lat).toBeCloseTo(7.0015, 6);
    expect(middleOf([{ lat: 7, lng: 80 }, { lat: 7, lng: 80 }])).toEqual({ lat: 7, lng: 80 });
    expect(middleOf([])).toBeNull();
  });
});
