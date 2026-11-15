// Playback on a constant time scale (Phase 7, §22). The tests that read a real recorded day (a real driver's GPS trace) were
// removed with that data before the repository went public; the tests that need no route data are kept.
import { describe, expect, it } from "vitest";
import { advance, bearing, clockText, playbackPath, SPEEDS } from "./playbackLogic";

const at = (iso: string) => Date.parse(iso);

describe("the path the marker follows", () => {
  it("spreads points that share a time over the time before them, so nothing jumps", () => {
    const p = playbackPath([{ at: 0, lat: 7, lng: 80 }, { at: 60000, lat: 7.001, lng: 80 }, { at: 60000, lat: 7.002, lng: 80 }, { at: 120000, lat: 7.003, lng: 80 }]);
    expect(p.map((x) => Math.round(x.at))).toEqual([0, 30000, 60000, 120000]);
    const q = playbackPath([{ at: 0, lat: 7, lng: 80 }, { at: 0, lat: 7.001, lng: 80 }, { at: 60000, lat: 7.002, lng: 80 }]);
    expect(q[1].at).toBeCloseTo(30000, 0);
  });
});

describe("the direction", () => {
  it("is 0° going north and 90° going east", () => {
    expect(bearing({ lat: 7, lng: 80 }, { lat: 7.01, lng: 80 })).toBeCloseTo(0, 6);
    expect(bearing({ lat: 7, lng: 80 }, { lat: 7, lng: 80.01 })).toBeCloseTo(90, 1);
  });
});

describe("the clock", () => {
  it("runs at 1×, 5×, 20× and 60×", () => {
    expect([...SPEEDS]).toEqual([1, 5, 20, 60]);
    expect(advance(0, 1000 / 60, 60, 1e9)).toBeCloseTo(1000, 6);
    expect(advance(0, 1000 / 60, 1, 1e9)).toBeCloseTo(1000 / 60, 6);
  });

  it("a stalled frame (a tab in the background) moves it 250 ms of real time at most; never past the end", () => {
    expect(advance(0, 60000, 60, 1e9)).toBe(250 * 60);
    expect(advance(990, 1000, 60, 1000)).toBe(1000);
    expect(advance(0, -5, 60, 1000)).toBe(0);
  });

  it("shows the recorded time with seconds, and estimated in a gap", () => {
    expect(clockText(at("2026-10-15T09:02:05Z"), false)).toBe("14:32:05");
    expect(clockText(at("2026-10-15T09:02:05Z"), true)).toBe("14:32:05 · estimated");
  });
});
