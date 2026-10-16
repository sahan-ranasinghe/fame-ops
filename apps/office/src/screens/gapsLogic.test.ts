// The gap markers and the Gaps list (Phase 7, §21) on test.driver2's 15 October as the web asks for it.
import { describe, expect, it } from "vitest";
import { distanceM } from "@fleet/track";
import { routeOf } from "../data/route";
import type { DriverRoute } from "../data/types";
import fixture from "./__fixtures__/route-driver2-2026-10-15.json";
import { gapMarkers, gapsOf, middleOf } from "./gapsLogic";

const answer = fixture as unknown as DriverRoute;
const route = routeOf("test.driver2", answer);
const at = (iso: string) => Date.parse(iso);
const pointAt = (iso: string) => route.points.find((p) => p.at === at(iso))!;

describe("the gaps of a route", () => {
  const rows = gapsOf(route);

  it("one row per hole of the line and per stretch uploaded late, in time order, with the words of §21", () => {
    expect(rows).toHaveLength(answer.holes!.length + answer.uploaded_later!.length);
    expect(rows.map((r) => r.fromAt)).toEqual([...rows.map((r) => r.fromAt)].sort((a, b) => a - b));
    expect(rows[0]).toMatchObject({ kind: "no_data", when: "06:12–06:20", what: "App not running", minutes: 7, text: "App not running · 06:12–06:20 · 7 min" });
    expect(rows[1]).toMatchObject({ kind: "no_gps", what: "Stopped · no GPS signal", text: "Stopped · no GPS signal · 06:20–06:23 · 3 min" });
    expect(rows.find((r) => r.minutes === 42)?.text).toBe("App not running · 06:31–07:12 · 42 min");
    const late = rows.filter((r) => r.kind === "late");
    expect(late.map((r) => [r.when, r.what, r.text])).toEqual([
      ["06:49", "Offline here · uploaded 07:06", "Offline here · 06:49 · uploaded 07:06"],
      ["16:05", "Offline here · uploaded 16:12", "Offline here · 16:05 · uploaded 16:12"],
    ]);
    expect(rows.every((r) => r.km === undefined)).toBe(true); // no estimated lines in this answer
  });

  it("puts a hole's marker at the middle of its dashed line, between the line points around it", () => {
    const a = pointAt("2026-10-15T00:42:46.153Z"), b = pointAt("2026-10-15T00:50:05.399Z");
    expect(rows[0].lat).toBeCloseTo((a.lat + b.lat) / 2, 4);
    expect(rows[0].lng).toBeCloseTo((a.lng + b.lng) / 2, 4);
    expect(rows[0].focus).toEqual([{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }]);
  });

  it("puts a stretch uploaded late on the line where it was: inside a hole, on that hole's dashed line", () => {
    const late = rows.find((r) => r.id === `late-${at("2026-10-15T01:19:52.060Z")}`)!;
    const a = pointAt("2026-10-15T01:01:09.153Z"), b = pointAt("2026-10-15T01:42:49.509Z");
    // On the straight line between the hole's ends: the two parts add up to the whole.
    expect(distanceM(a, late) + distanceM(late, b)).toBeCloseTo(distanceM(a, b), 0);
    const parked = rows.find((r) => r.id === `late-${at("2026-10-15T10:35:57.322Z")}`)!;
    expect([parked.lat, parked.lng]).toEqual([6.9672476, 79.9060218]);
  });

  it("an estimated road line over a hole carries the marker to its middle and the km by road", () => {
    const h = answer.holes![3];
    const a = pointAt(h.from_at), b = pointAt(h.to_at);
    const bend: [number, number] = [(a.lat + b.lat) / 2 + 0.05, (a.lng + b.lng) / 2];
    const withLine = routeOf("test.driver2", { ...answer, estimated: [{ from_at: h.from_at, to_at: h.to_at, from: "06:31", to: "07:12", km_road: 21.3, points: [[a.lat, a.lng], bend, [b.lat, b.lng]] }] });
    const row = gapsOf(withLine).find((r) => r.fromAt === at(h.from_at))!;
    expect(row.text).toBe("App not running · 06:31–07:12 · 42 min · about 21.3 km by road");
    expect(row.km).toBe(21.3);
    const mid = middleOf([a, { lat: bend[0], lng: bend[1] }, b])!;
    expect(row.lat).toBeCloseTo(mid.lat, 6);
    expect(row.lng).toBeCloseTo(mid.lng, 6);
    expect(row.focus).toHaveLength(5); // the two ends and the line's three points
  });

  it("the same answer gives the same ids (an open card survives a refresh); markers carry the card's words", () => {
    expect(gapsOf(routeOf("test.driver2", answer)).map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(gapMarkers(rows)[0]).toEqual({ id: rows[0].id, kind: "no_data", lat: rows[0].lat, lng: rows[0].lng, text: "App not running · 06:12–06:20 · 7 min" });
    expect(gapsOf(null)).toEqual([]);
  });
});

describe("the middle of a line", () => {
  it("is halfway by distance, not by count", () => {
    const m = middleOf([{ lat: 7, lng: 80 }, { lat: 7.001, lng: 80 }, { lat: 7.003, lng: 80 }])!;
    expect(m.lat).toBeCloseTo(7.0015, 6);
    expect(middleOf([{ lat: 7, lng: 80 }, { lat: 7, lng: 80 }])).toEqual({ lat: 7, lng: 80 });
    expect(middleOf([])).toBeNull();
  });
});
