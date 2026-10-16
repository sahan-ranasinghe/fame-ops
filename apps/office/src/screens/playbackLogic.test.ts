// Playback on a constant time scale (Phase 7, §22), tested with test.driver2's route of 15 October as the web asks for it:
// the position is continuous across every gap and stop, and a full pass at 60× takes the day's span ÷ 60.
import { describe, expect, it } from "vitest";
import { distanceM } from "@fleet/track";
import { drawnLine, routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import fixture from "./__fixtures__/route-driver2-2026-10-15.json";
import { advance, bearing, clockText, gapWindowsOf, inGap, type PathPoint, playbackPath, positionOn, SPEEDS } from "./playbackLogic";

const answer = fixture as unknown as DriverRoute;
const route = routeOf("test.driver2", answer);
const path = playbackPath(drawnLine(route), route.estimated);
const windows = gapWindowsOf(route);
const start = path[0].at;
const end = path[path.length - 1].at;
const at = (iso: string) => Date.parse(iso);

/** The length of the path between two times: what the marker may cover in that time. */
function pathLength(p: PathPoint[], t0: number, t1: number): number {
  let total = 0;
  let prev = positionOn(p, t0)!;
  for (const q of p) {
    if (q.at <= t0 || q.at >= t1) continue;
    total += distanceM(prev, q);
    prev = { ...prev, lat: q.lat, lng: q.lng };
  }
  return total + distanceM(prev, positionOn(p, t1)!);
}

describe("the path the marker follows", () => {
  it("is the drawn line in time order, every step taking time (no two places at one moment)", () => {
    expect(path).toHaveLength(route.points.length);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].at).toBeGreaterThanOrEqual(path[i - 1].at);
      if (distanceM(path[i - 1], path[i]) > 0) expect(path[i].at).toBeGreaterThan(path[i - 1].at);
    }
  });

  it("spreads points that share a time over the time before them, so nothing jumps", () => {
    const p = playbackPath([{ at: 0, lat: 7, lng: 80 }, { at: 60000, lat: 7.001, lng: 80 }, { at: 60000, lat: 7.002, lng: 80 }, { at: 120000, lat: 7.003, lng: 80 }]);
    expect(p.map((x) => Math.round(x.at))).toEqual([0, 30000, 60000, 120000]);
    const q = playbackPath([{ at: 0, lat: 7, lng: 80 }, { at: 0, lat: 7.001, lng: 80 }, { at: 60000, lat: 7.002, lng: 80 }]);
    expect(q[1].at).toBeCloseTo(30000, 0);
  });

  it("follows a gap's estimated road line, its time spread along it by distance, marked estimated", () => {
    const h = answer.holes![3]; // 06:31–07:12, 42 min, App not running
    const a = route.points.find((x) => x.at === at(h.from_at))!, b = route.points.find((x) => x.at === at(h.to_at))!;
    const bend = { lat: (a.lat + b.lat) / 2 + 0.05, lng: (a.lng + b.lng) / 2 };
    const est = [{ fromAt: a.at, toAt: b.at, points: [{ lat: a.lat, lng: a.lng }, bend, { lat: b.lat, lng: b.lng }] }];
    const curved = playbackPath(drawnLine(route), est);
    expect(curved).toHaveLength(path.length + 1);
    const inner = curved.find((x) => x.lat === bend.lat && x.lng === bend.lng)!;
    expect(inner.est).toBe(true);
    const share = distanceM(a, bend) / (distanceM(a, bend) + distanceM(bend, b));
    expect(inner.at).toBeCloseTo(a.at + (b.at - a.at) * share, 0);
    const there = positionOn(curved, inner.at)!;
    expect(there).toMatchObject({ lat: bend.lat, lng: bend.lng, estimated: true });
  });
});

describe("the position at a time", () => {
  it("is continuous across every gap and every stop: in a second it never covers more than the path between", () => {
    const dt = 1000;
    let worst = 0;
    for (let t = start; t < end; t += dt) {
      const a = positionOn(path, t, windows)!, b = positionOn(path, t + dt, windows)!;
      const moved = distanceM(a, b);
      const allowed = pathLength(path, t, Math.min(end, t + dt));
      expect(moved).toBeLessThanOrEqual(allowed + 0.01);
      worst = Math.max(worst, moved);
    }
    // The fastest second of the day is under 150 km/h (≈ 42 m): no jump hides in it.
    expect(worst).toBeLessThan(42);
  });

  it("has no step at the edges of a gap or a stop", () => {
    const edges = [...route.holes.flatMap((h) => [h.fromAt, h.toAt]), ...route.timeline.flatMap((r) => [r.fromAt, r.toAt]), ...route.late.flatMap((w) => [w.fromAt, w.toAt])];
    for (const e of edges) {
      const before = positionOn(path, e - 1, windows)!, after = positionOn(path, e + 1, windows)!;
      expect(distanceM(before, after)).toBeLessThan(1);
    }
  });

  it("is estimated inside a gap and real on the recorded line", () => {
    // 06:35 is inside the 42-minute hole (App not running); 06:11:50 is the first driving minutes.
    expect(positionOn(path, at("2026-10-15T01:05:00Z"), windows)!.estimated).toBe(true);
    expect(positionOn(path, at("2026-10-15T00:41:50Z"), windows)!.estimated).toBe(false);
    // The phone was off at Dalugama 08:12–16:05: the marker stays there, hollow.
    const off = [at("2026-10-15T03:00:00Z"), at("2026-10-15T07:00:00Z"), at("2026-10-15T10:30:00Z")].map((t) => positionOn(path, t, windows)!);
    expect(off.every((p) => p.estimated)).toBe(true);
    expect(off.every((p) => distanceM(p, { lat: 6.9672476, lng: 79.9060218 }) < 1)).toBe(true);
    expect(inGap(windows, at("2026-10-15T10:40:00Z"))).toBe(false);
  });

  it("is still at a stop and keeps facing the way it came", () => {
    const stop = route.timeline.find((r) => r.kind === "stopped" && r.from === "16:05")!;
    const a = positionOn(path, stop.fromAt + 60000, windows)!, b = positionOn(path, stop.toAt - 60000, windows)!;
    expect(distanceM(a, b)).toBe(0);
    expect(a.heading).not.toBeNull();
    expect(a.heading).toBe(b.heading);
  });

  it("turns to the path's direction while driving", () => {
    const i = 5;
    const mid = (path[i - 1].at + path[i].at) / 2;
    expect(positionOn(path, mid)!.heading).toBeCloseTo(bearing(path[i - 1], path[i]), 6);
    expect(bearing({ lat: 7, lng: 80 }, { lat: 7.01, lng: 80 })).toBeCloseTo(0, 6);
    expect(bearing({ lat: 7, lng: 80 }, { lat: 7, lng: 80.01 })).toBeCloseTo(90, 1);
  });

  it("stays at the ends before and after the route", () => {
    expect(positionOn(path, start - 60000)).toMatchObject({ lat: path[0].lat, lng: path[0].lng });
    expect(positionOn(path, end + 60000)).toMatchObject({ lat: path[path.length - 1].lat, lng: path[path.length - 1].lng });
    expect(positionOn([], start)).toBeNull();
  });
});

describe("the clock", () => {
  it("runs at 1×, 5×, 20× and 60×", () => {
    expect([...SPEEDS]).toEqual([1, 5, 20, 60]);
    expect(advance(0, 1000 / 60, 60, 1e9)).toBeCloseTo(1000, 6);
    expect(advance(0, 1000 / 60, 1, 1e9)).toBeCloseTo(1000 / 60, 6);
  });

  it("a full pass at 60× takes the day's span ÷ 60 (simulated frames at 60 Hz)", () => {
    const frame = 1000 / 60;
    let t = start;
    let real = 0;
    while (t < end) {
      t = advance(t, frame, 60, end);
      real += frame;
    }
    expect(t).toBe(end);
    expect(Math.abs(real - (end - start) / 60)).toBeLessThanOrEqual(frame);
    // About ten minutes for the day's ten hours.
    expect(Math.round(real / 60000)).toBe(Math.round((end - start) / 3600000));
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
